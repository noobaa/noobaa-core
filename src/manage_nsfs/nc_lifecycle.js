/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../util/debug_module')(__filename);
const _ = require('lodash');
const path = require('path');
const util = require('util');
const P = require('../util/promise');
const config = require('../../config');
const nb_native = require('../util/nb_native');
const NsfsObjectSDK = require('../sdk/nsfs_object_sdk');
const native_fs_utils = require('../util/native_fs_utils');
const ManageCLIError = require('./manage_nsfs_cli_errors').ManageCLIError;
const { throw_cli_error, get_service_status, NOOBAA_SERVICE_NAME } = require('./manage_nsfs_cli_utils');
const { is_desired_time, record_current_time } = require('./manage_nsfs_cli_utils');

// TODO:
// implement 
// 1. notifications
// 2. POSIX scanning and filtering per rule
// 3. GPFS ILM policy and apply for scanning and filtering optimization

const CLUSTER_LOCK = 'cluster.lock';
const LIFECYLE_TIMESTAMP_FILE = 'lifecycle.timestamp';

/**
 * run_lifecycle_under_lock runs the lifecycle workflow under a file system lock
 * lifecycle workflow is being locked to prevent multiple instances from running the lifecycle workflow
 * @param {import('../sdk/config_fs').ConfigFS} config_fs 
 * @param {boolean} disable_service_validation 
 * @param {boolean} disable_runtime_validation
 */
async function run_lifecycle_under_lock(config_fs, disable_service_validation, disable_runtime_validation) {
    const lifecyle_logs_dir_path = config.LIFECYCLE_LOGS_DIR;
    await config_fs.create_dir_if_missing(lifecyle_logs_dir_path);
    const lock_path = path.join(lifecyle_logs_dir_path, CLUSTER_LOCK);
    const fs_context = config_fs.fs_context;

    await native_fs_utils.lock_and_run(fs_context, lock_path, async () => {
        dbg.log0('run_lifecycle_under_lock acquired lock - start lifecycle');
        const lifecycle_timestamp_file_path = path.join(lifecyle_logs_dir_path, LIFECYLE_TIMESTAMP_FILE);
        const should_run = disable_runtime_validation ? true :
            await is_desired_time(
                fs_context,
                new Date(),
                config.NC_LIFECYCLE_RUN_TIME,
                config.NC_LIFECYCLE_RUN_DELAY_LIMIT_MINS,
                lifecycle_timestamp_file_path,
                config.NC_LIFECYCLE_TZ);
        dbg.log0('run_lifecycle_under_lock should_run', should_run);
        if (should_run) {
            await run_lifecycle(config_fs, disable_service_validation);
            await record_current_time(fs_context, lifecycle_timestamp_file_path);
        }
        dbg.log0('run_lifecycle_under_lock done lifecycle - released lock');
    });
}

/**
 * run_lifecycle runs the lifecycle workflow
 * @param {import('../sdk/config_fs').ConfigFS} config_fs 
 * @param {boolean} disable_service_validation
 * @returns {Promise<Void>}
 */
async function run_lifecycle(config_fs, disable_service_validation) {
    const options = { silent_if_missing: true };
    const system_json = await config_fs.get_system_config_file(options);
    if (!disable_service_validation) await throw_if_noobaa_not_active(config_fs, system_json);

    const bucket_names = await config_fs.list_buckets();
    const concurrency = 10; // TODO - think about it
    await P.map_with_concurrency(concurrency, bucket_names, async bucket_name => {
        const bucket_json = await config_fs.get_bucket_by_name(bucket_name, options);
        const account = { email: '', nsfs_account_config: config_fs.fs_context, access_keys: [] };
        const object_sdk = new NsfsObjectSDK('', config_fs, account, bucket_json.versioning, config_fs.config_root, system_json);
        //TODO temporary - need to check if we want to use a real account
        object_sdk._simple_load_requesting_account();
        await P.all(_.map(bucket_json.lifecycle_configuration_rules,
            async (lifecycle_rule, j) => {
                dbg.log0('NC LIFECYCLE READ BUCKETS configuration handle_bucket_rule bucket name:', bucket_json.name, 'rule', lifecycle_rule, 'j', j);
                return await handle_bucket_rule(config_fs, lifecycle_rule, j, bucket_json, object_sdk);
            }
        ));
    });
}

/**
 * throw_if_noobaa_not_active checks if system.json exists and the noobaa service is active
 * @param {import('../sdk/config_fs').ConfigFS} config_fs 
 * @param {Object} system_json
 */
async function throw_if_noobaa_not_active(config_fs, system_json) {
    if (!system_json) {
        dbg.error('throw_if_noobaa_not_active: system.json is missing');
        throw_cli_error(ManageCLIError.SystemJsonIsMissing);
    }

    const service_status = await get_service_status(NOOBAA_SERVICE_NAME);
    if (service_status !== 'active') {
        dbg.error('throw_if_noobaa_not_active: noobaa service is not active');
        throw_cli_error(ManageCLIError.NooBaaServiceIsNotActive);
    }
}

/**
 * get file time since last modified in days
 * @param {nb.NativeFSStats} stat
 */
function _get_file_age_days(stat) {
    //TODO how much do we care about rounding errors? (it is by days after all)
    return (Date.now() - Number(stat.mtimeNsBigint) / 1e6) / 24 / 60 / 60 / 1000;
}

/**
 * checks if tag query_tag is in the list tag_set
 * @param {Object} query_tag
 * @param {Array<Object>} tag_set
 */
function _list_contain_tag(query_tag, tag_set) {
    for (const t of tag_set) {
        if (t.key === query_tag.key && t.value === query_tag.value) return true;
    }
    return false;
}

/**
 * checks if object has all the tags in filter_tags
 * @param {Object} object_info
 * @param {Array<Object>} filter_tags
 * @returns
 */
function _file_contain_tags(object_info, filter_tags) {
    if (object_info.tags === undefined) return false;
    for (const tag of filter_tags) {
        if (!_list_contain_tag(tag, object_info.tags)) {
            return false;
        }
    }
    return true;
}

/**
 * @param {*} create_params_parsed
 * @param {nb.NativeFSStats} stat
 */
function _get_lifecycle_object_info_for_mpu(create_params_parsed, stat) {
    return {
        key: create_params_parsed.key,
        age: _get_file_age_days(stat),
        tags: create_params_parsed.tagging,
    };
}


/**
 * @typedef {{
 *     filter: Object
 *     expiration: Number
 * }} filter_params
 *
 * @param {filter_params} params
 * @returns
 */
function _build_lifecycle_filter(params) {
    /**
     * @param {Object} object_info
     */
    return function(object_info) {
        if (params.filter?.prefix && !object_info.key.startsWith(params.filter.prefix)) return false;
        if (params.expiration && object_info.age < params.expiration) return false;
        if (params.filter?.tags && !_file_contain_tags(object_info, params.filter.tags)) return false;
        if (params.filter?.object_size_greater_than && object_info.size < params.filter.object_size_greater_than) return false;
        if (params.filter?.object_size_less_than && object_info.size > params.filter.object_size_less_than) return false;
        return true;
    };
}

/**
 * handle_bucket_rule processes the lifecycle rule for a bucket
 * @param {*} lifecycle_rule
 * @param {*} j
 * @param {Object} bucket_json
 * @param {Object} object_sdk
 */
async function handle_bucket_rule(config_fs, lifecycle_rule, j, bucket_json, object_sdk) {
    // TODO - implement notifications
    const now = Date.now();
    const should_process_lifecycle_rule = validate_rule_enabled(lifecycle_rule, bucket_json, now);
    if (!should_process_lifecycle_rule) return;
    dbg.log0('LIFECYCLE PROCESSING bucket:', bucket_json.name, '(bucket id:', bucket_json._id, ') rule', util.inspect(lifecycle_rule));
    const candidates = await get_delete_candidates(bucket_json, lifecycle_rule, object_sdk, config_fs.fs_context);
    const delete_objects_reply = await object_sdk.delete_multiple_objects({
        bucket: bucket_json.name,
        objects: candidates.delete_candidates // probably need to convert to the format expected by delete_multiple_objects
    });
    await candidates.abort_mpus?.forEach(async element => {
        await object_sdk.abort_object_upload(element);
    });
    // TODO - implement notifications for the deleted objects
    await update_lifecycle_rules_last_sync(config_fs, bucket_json, j, delete_objects_reply.num_objects_deleted);
}

/**
 * get_delete_candidates gets the delete candidates for the lifecycle rule
 * @param {Object} bucket_json
 * @param {*} lifecycle_rule
 */
async function get_delete_candidates(bucket_json, lifecycle_rule, object_sdk, fs_context) {
    // let reply_objects = []; // TODO: needed for the notification log file
    const candidates = {delete_candidates: []};
    if (lifecycle_rule.expiration) {
        await get_candidates_by_expiration_rule(lifecycle_rule, bucket_json);
        if (lifecycle_rule.expiration.days || lifecycle_rule.expiration.expired_object_delete_marker) {
            await get_candidates_by_expiration_delete_marker_rule(lifecycle_rule, bucket_json);
        }
    }
    if (lifecycle_rule.noncurrent_version_expiration) {
        await get_candidates_by_noncurrent_version_expiration_rule(lifecycle_rule, bucket_json);
    }
    if (lifecycle_rule.abort_incomplete_multipart_upload) {
        candidates.abort_mpus = await get_candidates_by_abort_incomplete_multipart_upload_rule(
            lifecycle_rule, bucket_json, object_sdk, fs_context);
    }
    return candidates;
}

/**
 * validate_rule_enabled checks if the rule is enabled and should be processed
 * @param {*} rule 
 * @param {Object} bucket 
 * @param {*} now 
 * @returns {boolean}
 */
function validate_rule_enabled(rule, bucket, now) {
    if (rule.status !== 'Enabled') {
        dbg.log0('LIFECYCLE SKIP bucket:', bucket.name, '(bucket id:', bucket._id, ') rule', util.inspect(rule), 'not Enabled');
        return false;
    }
    if (rule.last_sync && now - rule.last_sync < config.LIFECYCLE_SCHEDULE_MIN) {
        dbg.log0('LIFECYCLE SKIP bucket:', bucket.name, '(bucket id:', bucket._id, ') rule', util.inspect(rule), 'now', now, 'last_sync', rule.last_sync, 'schedule min', config.LIFECYCLE_SCHEDULE_MIN);
        return false;
    }
    return true;
}

// TODO - we will filter during the scan except for get_candidates_by_expiration_rule on GPFS that does the filter on the file system

/**
 * get_candidates_by_expiration_rule processes the expiration rule
 * @param {*} lifecycle_rule 
 * @param {Object} bucket_json 
 */
async function get_candidates_by_expiration_rule(lifecycle_rule, bucket_json) {
    const is_gpfs = nb_native().fs.gpfs;
    if (is_gpfs) {
        await get_candidates_by_expiration_rule_gpfs(lifecycle_rule, bucket_json);
    } else {
        await get_candidates_by_expiration_rule_posix(lifecycle_rule, bucket_json);
    }
}

/**
 * 
 * @param {*} lifecycle_rule 
 * @param {Object} bucket_json 
 */
async function get_candidates_by_expiration_rule_gpfs(lifecycle_rule, bucket_json) {
    // TODO - implement
}

/**
 * 
 * @param {*} lifecycle_rule 
 * @param {Object} bucket_json 
 */
async function get_candidates_by_expiration_rule_posix(lifecycle_rule, bucket_json) {
    // TODO - implement
}

/**
 * get_candidates_by_expiration_delete_marker_rule processes the expiration delete marker rule
 * @param {*} lifecycle_rule 
 * @param {Object} bucket_json 
 */
async function get_candidates_by_expiration_delete_marker_rule(lifecycle_rule, bucket_json) {
    // TODO - implement
}

/**
 * get_candidates_by_noncurrent_version_expiration_rule processes the noncurrent version expiration rule
 * TODO:
 * POSIX - need to support both noncurrent_days and newer_noncurrent_versions
 * GPFS - implement noncurrent_days using GPFS ILM policy as an optimization
 * @param {*} lifecycle_rule
 * @param {Object} bucket_json
 */
async function get_candidates_by_noncurrent_version_expiration_rule(lifecycle_rule, bucket_json) {
    // TODO - implement
}

/**
 * get_candidates_by_abort_incomplete_multipart_upload_rule processes the abort incomplete multipart upload rule
 * @param {*} lifecycle_rule
 * @param {Object} bucket_json
 */
async function get_candidates_by_abort_incomplete_multipart_upload_rule(lifecycle_rule, bucket_json, object_sdk, fs_context) {
    const nsfs = await object_sdk._get_bucket_namespace(bucket_json.name);
    const mpu_path = nsfs._mpu_root_path();
    const filter = lifecycle_rule.filter;
    const expiration = lifecycle_rule.abort_incomplete_multipart_upload.days_after_initiation;
    const res = [];

    const filter_func = _build_lifecycle_filter({filter, expiration});
    let dir_handle;
    //TODO this is almost identical to list_uploads except for error handling and support for pagination. should modify list-upload and use it in here instead
    try {
        dir_handle = await nb_native().fs.opendir(fs_context, mpu_path);
    } catch (err) {
        if (err.code !== 'ENOENT') throw err;
        return;
    }
    for (;;) {
        try {
            const dir_entry = await dir_handle.read(fs_context);
            if (!dir_entry) break;
            const create_path = path.join(mpu_path, dir_entry.name, 'create_object_upload');
            const { data: create_params_buffer } = await nb_native().fs.readFile(fs_context, create_path);
            const create_params_parsed = JSON.parse(create_params_buffer.toString());
            const stat = await nb_native().fs.stat(fs_context, path.join(mpu_path, dir_entry.name));
            const object_lifecycle_info = _get_lifecycle_object_info_for_mpu(create_params_parsed, stat);
            if (filter_func(object_lifecycle_info)) {
                res.push({obj_id: dir_entry.name, key: create_params_parsed.key, bucket: bucket_json.name});
            }
        } catch (err) {
            if (err.code !== 'ENOENT' || err.code !== 'ENOTDIR') throw err;
        }
    }
    await dir_handle.close(fs_context);
    dir_handle = null;
    return res;
}

/**
 * update_lifecycle_rules_last_sync updates the last sync time of the lifecycle rule
 * @param {import('../sdk/config_fs').ConfigFS} config_fs
 * @param {Object} bucket_json
 * @param {number} j
 * @param {number} num_objects_deleted
 */
async function update_lifecycle_rules_last_sync(config_fs, bucket_json, j, num_objects_deleted) {
    bucket_json.lifecycle_configuration_rules[j].last_sync = Date.now();
    // if (res.num_objects_deleted >= config.LIFECYCLE_BATCH_SIZE) should_rerun = true; // TODO - think if needed
    dbg.log0('LIFECYCLE Done bucket:', bucket_json.name, '(bucket id:', bucket_json._id, ') done deletion of objects per rule',
        bucket_json.lifecycle_configuration_rules[j],
        'time:', bucket_json.lifecycle_configuration_rules[j].last_sync,
        'objects deleted:', num_objects_deleted);
    await config_fs.update_bucket_config_file(bucket_json);
}

// EXPORTS
exports.run_lifecycle_under_lock = run_lifecycle_under_lock;

