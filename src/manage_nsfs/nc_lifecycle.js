/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../util/debug_module')(__filename);
const os = require('os');
const _ = require('lodash');
const path = require('path');
const util = require('util');
const P = require('../util/promise');
const config = require('../../config');
const nb_native = require('../util/nb_native');
const NsfsObjectSDK = require('../sdk/nsfs_object_sdk');
const native_fs_utils = require('../util/native_fs_utils');
const { NoobaaEvent } = require('./manage_nsfs_events_utils');
const notifications_util = require('../util/notifications_util');
const ManageCLIError = require('./manage_nsfs_cli_errors').ManageCLIError;
const { throw_cli_error, get_service_status, NOOBAA_SERVICE_NAME,
    is_desired_time, record_current_time } = require('./manage_nsfs_cli_utils');
const SensitiveString = require('../util/sensitive_string');

// TODO:
// implement
// 1. notifications
// 2. POSIX scanning and filtering per rule
// 3. GPFS ILM policy and apply for scanning and filtering optimization
// TODO - we will filter during the scan except for get_candidates_by_expiration_rule on GPFS that does the filter on the file system

const LIFECYCLE_CLUSTER_LOCK = 'lifecycle_cluster.lock';
const LIFECYLE_TIMESTAMP_FILE = 'lifecycle.timestamp';
const config_fs_options = { silent_if_missing: true };

const lifecycle_run_status = {
    running_host: os.hostname(), lifecycle_run_times: {},
    total_stats: _get_default_stats(), buckets_statuses: {}
};

let return_short_status = false;

const TIMED_OPS = Object.freeze({
    RUN_LIFECYLE: 'run_lifecycle',
    LIST_BUCKETS: 'list_buckets',
    PROCESS_BUCKETS: 'process_buckets',
    PROCESS_BUCKET: 'process_bucket',
    PROCESS_RULE: 'process_rule',
    GET_CANDIDATES: 'get_candidates',
    ABORT_MPUS: 'abort_mpus',
    DELETE_MULTIPLE_OBJECTS: 'delete_multiple_objects'
});

/**
 * run_lifecycle_under_lock runs the lifecycle workflow under a file system lock
 * lifecycle workflow is being locked to prevent multiple instances from running the lifecycle workflow
 * @param {import('../sdk/config_fs').ConfigFS} config_fs
 * @param {{disable_service_validation?: boolean, disable_runtime_validation?: boolean, short_status?: boolean}} flags
 * @returns {Promise<{should_run: Boolean, lifecycle_run_status: Object}>}
 */
async function run_lifecycle_under_lock(config_fs, flags) {
    const { disable_service_validation = false, disable_runtime_validation = false, short_status = false } = flags;
    return_short_status = short_status;
    const fs_context = config_fs.fs_context;
    const lifecyle_logs_dir_path = config.NC_LIFECYCLE_LOGS_DIR;
    const lifecycle_config_dir_path = path.join(config_fs.config_root, config.NC_LIFECYCLE_CONFIG_DIR_NAME);
    const lock_path = path.join(lifecycle_config_dir_path, LIFECYCLE_CLUSTER_LOCK);
    const lifecycle_timestamp_file_path = path.join(lifecycle_config_dir_path, LIFECYLE_TIMESTAMP_FILE);
    await config_fs.create_dir_if_missing(lifecyle_logs_dir_path);
    await config_fs.create_dir_if_missing(lifecycle_config_dir_path);

    let should_run = true;
    await native_fs_utils.lock_and_run(fs_context, lock_path, async () => {
        dbg.log0('run_lifecycle_under_lock acquired lock - verifying');
        should_run = await _should_lifecycle_run(fs_context, lifecycle_timestamp_file_path, disable_runtime_validation);
        if (!should_run) return;

        try {
            dbg.log0('run_lifecycle_under_lock acquired lock - start lifecycle');
            new NoobaaEvent(NoobaaEvent.LIFECYCLE_STARTED).create_event();
            await run_lifecycle_or_timeout(config_fs, disable_service_validation);
        } catch (err) {
            dbg.error('run_lifecycle_under_lock failed with error', err, err.code, err.message);
            throw err;
        } finally {
            await record_current_time(fs_context, lifecycle_timestamp_file_path);
            await write_lifecycle_log_file(config_fs.fs_context, lifecyle_logs_dir_path);
            dbg.log0('run_lifecycle_under_lock done lifecycle - released lock');
        }
    });
    return { should_run, lifecycle_run_status };
}

/**
 * run_lifecycle_or_timeout runs the lifecycle workflow or times out while calculating
 * and saving times and stats of the run on the global lifecycle status
 * @param {import('../sdk/config_fs').ConfigFS} config_fs
 * @param {boolean} disable_service_validation
 * @returns {Promise<Void>}
 */
async function run_lifecycle_or_timeout(config_fs, disable_service_validation) {
    await _call_op_and_update_status({
        op_name: TIMED_OPS.RUN_LIFECYLE,
        op_func: async () => {
            await P.timeout(
                config.NC_LIFECYCLE_TIMEOUT_MS,
                run_lifecycle(config_fs, disable_service_validation),
                () => ManageCLIError.LifecycleWorkerReachedTimeout
            );
        }
    });
}

/**
 * run_lifecycle runs the lifecycle workflow
 * @param {import('../sdk/config_fs').ConfigFS} config_fs
 * @param {boolean} disable_service_validation
 * @returns {Promise<Void>}
 */
async function run_lifecycle(config_fs, disable_service_validation) {
    const system_json = await config_fs.get_system_config_file(config_fs_options);
    if (!disable_service_validation) await throw_if_noobaa_not_active(config_fs, system_json);

    const bucket_names = await _call_op_and_update_status({
        op_name: TIMED_OPS.LIST_BUCKETS,
        op_func: async () => config_fs.list_buckets()
    });

    await _call_op_and_update_status({
        op_name: TIMED_OPS.PROCESS_BUCKETS,
        op_func: async () => process_buckets(config_fs, bucket_names, system_json)
    });
}

/**
 * process_buckets iterates over buckets and handles their rules
 * @param {import('../sdk/config_fs').ConfigFS} config_fs
 * @param {String[]} bucket_names
 * @param {Object} system_json
 * @returns {Promise<Void>}
 */
async function process_buckets(config_fs, bucket_names, system_json) {
    const buckets_concurrency = 10; // TODO - think about it
    await P.map_with_concurrency(buckets_concurrency, bucket_names, async bucket_name =>
        await _call_op_and_update_status({
            bucket_name,
            op_name: TIMED_OPS.PROCESS_BUCKET,
            op_func: async () => process_bucket(config_fs, bucket_name, system_json)
        })
    );
}

/**
 * process_bucket processes the lifecycle rules for a bucket
 * @param {import('../sdk/config_fs').ConfigFS} config_fs
 * @param {string} bucket_name
 * @param {Object} system_json
 */
async function process_bucket(config_fs, bucket_name, system_json) {
    const bucket_json = await config_fs.get_bucket_by_name(bucket_name, config_fs_options);
    const account = { email: '', nsfs_account_config: config_fs.fs_context, access_keys: [] };
    const object_sdk = new NsfsObjectSDK('', config_fs, account, bucket_json.versioning, config_fs.config_root, system_json);
    await object_sdk._simple_load_requesting_account();
    const should_notify = notifications_util.should_notify_on_event(bucket_json, notifications_util.OP_TO_EVENT.lifecycle_delete.name);
    if (!bucket_json.lifecycle_configuration_rules) return {};
    await process_rules(config_fs, bucket_json, object_sdk, should_notify);
}

/**
 * process_rules processes the lifecycle rules for a bucket
 * @param {import('../sdk/config_fs').ConfigFS} config_fs
 * @param {Object} bucket_json
 * @param {nb.ObjectSDK} object_sdk
 */
async function process_rules(config_fs, bucket_json, object_sdk, should_notify) {
    try {
        await P.all(_.map(bucket_json.lifecycle_configuration_rules,
            async (lifecycle_rule, index) =>
                await _call_op_and_update_status({
                    bucket_name: bucket_json.name,
                    rule_id: lifecycle_rule.id,
                    op_name: TIMED_OPS.PROCESS_RULE,
                    op_func: async () => process_rule(config_fs, lifecycle_rule, index, bucket_json, object_sdk, should_notify)
                })
            )
        );
    } catch (err) {
        dbg.error('process_rules failed with error', err, err.code, err.message);
    }
}

async function send_lifecycle_notifications(delete_res, bucket_json, object_sdk) {
    const writes = [];
    for (const deleted_obj of delete_res) {
        if (delete_res.err_code) continue;
        for (const notif of bucket_json.notifications) {
            if (notifications_util.check_notif_relevant(notif, {
                op_name: 'lifecycle_delete',
                s3_event_method: deleted_obj.delete_marker_created ? 'DeleteMarkerCreated' : 'Delete',
            })) {
                //remember that this deletion needs a notif for this specific notification conf
                writes.push({notif, deleted_obj});
            }
        }
    }

    //required format by compose_notification_lifecycle
    bucket_json.bucket_owner = new SensitiveString(bucket_json.bucket_owner);

    //if any notifications are needed, write them in notification log file
    //(otherwise don't do any unnecessary filesystem actions)
    if (writes.length > 0) {
        let logger;
        try {
            logger = notifications_util.get_notification_logger('SHARED');
            await P.map_with_concurrency(100, writes, async write => {
                const notif = notifications_util.compose_notification_lifecycle(write.deleted_obj, write.notif, bucket_json, object_sdk);
                logger.append(JSON.stringify(notif));
            });
        } finally {
            if (logger) logger.close();
        }
    }
}

/**
 * process_rule processes the lifecycle rule for a bucket
 * TODO - implement notifications for the deleted objects (check if needed for abort mpus as well)
 * @param {import('../sdk/config_fs').ConfigFS} config_fs
 * @param {Object} lifecycle_rule
 * @param {number} index
 * @param {Object} bucket_json
 * @param {nb.ObjectSDK} object_sdk
 * @returns {Promise<Void>}
 */
async function process_rule(config_fs, lifecycle_rule, index, bucket_json, object_sdk, should_notify) {
    dbg.log0('nc_lifecycle.process_rule: start bucket name:', bucket_json.name, 'rule', lifecycle_rule, 'index', index);
    const bucket_name = bucket_json.name;
    const rule_id = lifecycle_rule.id;
    const should_process_lifecycle_rule = validate_rule_enabled(lifecycle_rule, bucket_json);
    if (!should_process_lifecycle_rule) return;

    dbg.log0('nc_lifecycle.process_rule: processing rule:', bucket_name, '(bucket id:', bucket_json._id, ') rule', util.inspect(lifecycle_rule));
    try {
        const candidates = await _call_op_and_update_status({
            bucket_name,
            rule_id,
            op_name: TIMED_OPS.GET_CANDIDATES,
            op_func: async () => get_candidates(bucket_json, lifecycle_rule, object_sdk, config_fs.fs_context)
        });

        if (candidates.delete_candidates?.length > 0) {
            const delete_res = await _call_op_and_update_status({
                bucket_name,
                rule_id,
                op_name: TIMED_OPS.DELETE_MULTIPLE_OBJECTS,
                op_func: async () => object_sdk.delete_multiple_objects({
                    bucket: bucket_json.name,
                    objects: candidates.delete_candidates
                })
            });
            if (should_notify) {
                await send_lifecycle_notifications(delete_res, bucket_json, object_sdk);
            }
        }

        if (candidates.abort_mpu_candidates?.length > 0) {
            await _call_op_and_update_status({
                bucket_name,
                rule_id,
                op_name: TIMED_OPS.ABORT_MPUS,
                op_func: async () => abort_mpus(candidates, object_sdk)
            });
        }
        await update_lifecycle_rules_last_sync(config_fs, bucket_json, rule_id, index);
    } catch (err) {
        dbg.error('process_rule failed with error', err, err.code, err.message);
    }
}

/**
 * abort_mpus iterates over the abort mpu candidates and calls abort_object_upload
 * since abort_object_upload is not returning anything, we catch it in case of an error and assign err_code
 * so it can be translated to error on stats
 * @param {*} candidates
 * @param {nb.ObjectSDK} object_sdk
 * @returns {Promise<Object[]>}
 */
async function abort_mpus(candidates, object_sdk) {
    const aborts_concurrency = 10; // TODO - think about it
    const abort_mpus_reply = await P.map_with_concurrency(aborts_concurrency, candidates.abort_mpu_candidates,
        async candidate => {
            const candidate_info = { key: candidate.key, upload_id: candidate.obj_id };
            try {
                await object_sdk.abort_object_upload(candidate);
            } catch (err) {
                candidate_info.err_code = err.code || err.message;
                dbg.log0('process_rule: abort_mpu_failed candidate_info', candidate_info);
            }
            return candidate_info;
        }
    );
    return abort_mpus_reply;
}

/////////////////////////////////
//////// GENERAL HELPERS ////////
/////////////////////////////////

/**
 * _should_lifecycle_run checks if lifecycle worker should run based on the followings -
 * 1. lifecycle workrer can be disabled
 * 2. lifecycle worker might run at time that does not match config.NC_LIFECYCLE_RUN_TIME
 * 3. previous run was in the delay time frame
 * @param {nb.NativeFSContext} fs_context
 * @param {String} lifecycle_timestamp_file_path
 * @param {Boolean} disable_runtime_validation
 * @returns {Promise<Boolean>}
 */
async function _should_lifecycle_run(fs_context, lifecycle_timestamp_file_path, disable_runtime_validation) {
    const should_run = disable_runtime_validation ? true : await is_desired_time(
        fs_context,
        new Date(),
        config.NC_LIFECYCLE_RUN_TIME,
        config.NC_LIFECYCLE_RUN_DELAY_LIMIT_MINS,
        lifecycle_timestamp_file_path,
        config.NC_LIFECYCLE_TZ);
    dbg.log0('_should_lifecycle_run should_run', should_run);
    return should_run;
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
 * get_candidates gets the delete and abort candidates for the lifecycle rule
 * @param {Object} bucket_json
 * @param {*} lifecycle_rule
 */
async function get_candidates(bucket_json, lifecycle_rule, object_sdk, fs_context) {
    const candidates = { abort_mpu_candidates: [], delete_candidates: [] };
    if (lifecycle_rule.expiration) {
        candidates.delete_candidates = await get_candidates_by_expiration_rule(lifecycle_rule, bucket_json, object_sdk);
        if (lifecycle_rule.expiration.days || lifecycle_rule.expiration.expired_object_delete_marker) {
            const dm_candidates = await get_candidates_by_expiration_delete_marker_rule(lifecycle_rule, bucket_json);
            candidates.delete_candidates = candidates.delete_candidates.concat(dm_candidates);
        }
    }
    if (lifecycle_rule.noncurrent_version_expiration) {
        const non_current_candidates = await get_candidates_by_noncurrent_version_expiration_rule(lifecycle_rule, bucket_json);
        candidates.delete_candidates = candidates.delete_candidates.concat(non_current_candidates);
    }
    if (lifecycle_rule.abort_incomplete_multipart_upload) {
        candidates.abort_mpu_candidates = await get_candidates_by_abort_incomplete_multipart_upload_rule(
            lifecycle_rule, bucket_json, object_sdk, fs_context);
    }
    return candidates;
}


/**
 * validate_rule_enabled checks if the rule is enabled and should be processed
 * @param {*} rule
 * @param {Object} bucket
 * @returns {boolean}
 */
function validate_rule_enabled(rule, bucket) {
    const now = Date.now();
    if (rule.status !== 'Enabled') {
        dbg.log0('validate_rule_enabled: SKIP bucket:', bucket.name, '(bucket id:', bucket._id, ') rule', util.inspect(rule), 'not Enabled');
        return false;
    }
    if (rule.last_sync && now - rule.last_sync < config.LIFECYCLE_SCHEDULE_MIN) {
        dbg.log0('validate_rule_enabled: SKIP bucket:', bucket.name, '(bucket id:', bucket._id, ') rule', util.inspect(rule), 'now', now, 'last_sync', rule.last_sync, 'schedule min', config.LIFECYCLE_SCHEDULE_MIN);
        return false;
    }
    return true;
}

////////////////////////////////////
//////// EXPIRATION HELPERS ////////
////////////////////////////////////

/**
 * @param {Object} entry list object entry
 */
function _get_lifecycle_object_info_from_list_object_entry(entry) {
    return {
        key: entry.key,
        age: _get_file_age_days(entry.create_time),
        size: entry.size,
        tags: entry.tagging,
    };
}

/**
 * get_candidates_by_expiration_rule processes the expiration rule
 * @param {*} lifecycle_rule
 * @param {Object} bucket_json
 * @returns {Promise<Object[]>}
 */
async function get_candidates_by_expiration_rule(lifecycle_rule, bucket_json, object_sdk) {
    const is_gpfs = nb_native().fs.gpfs;
    if (is_gpfs && config.NC_LIFECYCLE_GPFS_ILM_ENABLED) {
        return get_candidates_by_expiration_rule_gpfs(lifecycle_rule, bucket_json);
    } else {
        return get_candidates_by_expiration_rule_posix(lifecycle_rule, bucket_json, object_sdk);
    }
}

/**
 *
 * @param {*} lifecycle_rule
 * @param {Object} bucket_json
 * @returns {Promise<Object[]>}
 */
async function get_candidates_by_expiration_rule_gpfs(lifecycle_rule, bucket_json) {
    // TODO - implement
    return [];
}

/**
 *
 * @param {*} lifecycle_rule
 * @param {Object} bucket_json
 * @returns {Promise<Object[]>}
 */
async function get_candidates_by_expiration_rule_posix(lifecycle_rule, bucket_json, object_sdk) {
    const expiration = _get_expiration_time(lifecycle_rule.expiration);
    if (expiration < 0) return [];
    const filter_func = _build_lifecycle_filter({filter: lifecycle_rule.filter, expiration});

    const filtered_objects = [];
    // TODO list_objects does not accept a filter and works in batch sizes of 1000. should handle batching
    // also should maybe create a helper function or add argument for a filter in list object
    const objects_list = await object_sdk.list_objects({bucket: bucket_json.name, prefix: lifecycle_rule.filter?.prefix});
    objects_list.objects.forEach(obj => {
        const object_info = _get_lifecycle_object_info_from_list_object_entry(obj);
        if (filter_func(object_info)) {
            filtered_objects.push({key: object_info.key});
        }
    });
    return filtered_objects;

}

/**
 * get_candidates_by_expiration_delete_marker_rule processes the expiration delete marker rule
 * @param {*} lifecycle_rule
 * @param {Object} bucket_json
 * @returns {Promise<Object[]>}
 */
async function get_candidates_by_expiration_delete_marker_rule(lifecycle_rule, bucket_json) {
    // TODO - implement
    return [];
}

/////////////////////////////////////////////
//////// NON CURRENT VERSION HELPERS ////////
/////////////////////////////////////////////

/**
 * get_candidates_by_noncurrent_version_expiration_rule processes the noncurrent version expiration rule
 * TODO:
 * POSIX - need to support both noncurrent_days and newer_noncurrent_versions
 * GPFS - implement noncurrent_days using GPFS ILM policy as an optimization
 * @param {*} lifecycle_rule
 * @param {Object} bucket_json
 * @returns {Promise<Object[]>}
 */
async function get_candidates_by_noncurrent_version_expiration_rule(lifecycle_rule, bucket_json) {
    // TODO - implement
    return [];
}

////////////////////////////////////
///////// ABORT MPU HELPERS ////////
////////////////////////////////////

/**
 * get_candidates_by_abort_incomplete_multipart_upload_rule processes the abort incomplete multipart upload rule
 * @param {*} lifecycle_rule
 * @param {Object} bucket_json
 * @returns {Promise<Object[]>}
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
                res.push({ obj_id: dir_entry.name, key: create_params_parsed.key, bucket: bucket_json.name});
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
 * @param {Object} create_params_parsed
 * @param {nb.NativeFSStats} stat
 */
function _get_lifecycle_object_info_for_mpu(create_params_parsed, stat) {
    return {
        key: create_params_parsed.key,
        age: _get_file_age_days(stat.mtime.getTime()),
        tags: create_params_parsed.tagging,
    };
}

////////////////////////////////////
/////////   FILTER HELPERS  ////////
////////////////////////////////////

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
 * get file time since last modified in days
 * @param {Number} mtime
 * @returns {Number} days since object was last modified
 */
function _get_file_age_days(mtime) {
    return Math.floor((Date.now() - mtime) / 24 / 60 / 60 / 1000);
}

/**
 * get the expiration time in days of an object
 * if rule is set with date, then rule is applied for all objects after that date
 * return -1 to indicate that the date hasn't arrived, so rule should not be applied
 * return 0 in case date has arrived so expiration is true for all elements
 * return days in case days was defined and not date
 * @param {Object} expiration_rule
 * @returns {Number}
 */
function _get_expiration_time(expiration_rule) {
    if (expiration_rule.date) {
        const expiration_date = new Date(expiration_rule.date).getTime();
        if (Date.now() < expiration_date) return -1;
        return 0;
    }
    return expiration_rule.days;
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

/////////////////////////////////
//////// STATUS HELPERS ////////
/////////////////////////////////

/**
 * update_lifecycle_rules_last_sync updates the last sync time of the lifecycle rule
 * @param {import('../sdk/config_fs').ConfigFS} config_fs
 * @param {Object} bucket_json
 * @param {String} rule_id
 * @param {number} index
 * @returns {Promise<Void>}
 */
async function update_lifecycle_rules_last_sync(config_fs, bucket_json, rule_id, index) {
    bucket_json.lifecycle_configuration_rules[index].last_sync = Date.now();
    const { num_objects_deleted = 0, num_mpu_aborted = 0 } =
    lifecycle_run_status.buckets_statuses[bucket_json.name].rules_statuses[rule_id].rule_stats;
    // if (res.num_objects_deleted >= config.LIFECYCLE_BATCH_SIZE) should_rerun = true; // TODO - think if needed and add something about mpu abort
    dbg.log0('nc_lifecycle.update_lifecycle_rules_last_sync Done bucket:', bucket_json.name, '(bucket id:', bucket_json._id, ') done deletion of objects per rule',
        bucket_json.lifecycle_configuration_rules[index],
        'time:', bucket_json.lifecycle_configuration_rules[index].last_sync,
        'num_objects_deleted:', num_objects_deleted, 'num_mpu_aborted:', num_mpu_aborted);
    await config_fs.update_bucket_config_file(bucket_json);
}

/**
 * _call_op_and_update_status calls the op and report time and error to the lifecycle status.
 *
 * @template T
 * @param {{
*      op_name: string;
*      op_func: () => Promise<T>;
*      bucket_name?: string,
*      rule_id?: string
* }} params
* @returns {Promise<T>}
*/
async function _call_op_and_update_status({ bucket_name = undefined, rule_id = undefined, op_name, op_func }) {
    const start_time = Date.now();
    const update_options = { op_name, bucket_name, rule_id };
    let end_time;
    let took_ms;
    let error;
    let reply;
    try {
        if (!return_short_status) update_status({ ...update_options, op_times: { start_time } });
        reply = await op_func();
        return reply;
    } catch (e) {
        error = e;
        throw e;
    } finally {
        end_time = Date.now();
        took_ms = end_time - start_time;
        const op_times = return_short_status ? { took_ms } : { end_time, took_ms };
        update_status({ ...update_options, op_times, reply, error });
    }
}

/**
 * update_status updates rule/bucket/global based on the given parameters
 * 1. initalize statuses/times/stats per level
 * 2. update times
 * 3. update errors
 * 4. update stats if the op is at rule level
 * @param {{
 * op_name: string,
 * bucket_name?: string,
 * rule_id?: string,
 * op_times: { start_time?: number, end_time?: number, took_ms?: number },
 * reply?: Object[],
 * error?: Error}
 * } params
 * @returns {Void}
*/
function update_status({ bucket_name, rule_id, op_name, op_times, reply = [], error = undefined }) {
    // TODO - check errors
    if (op_times.start_time) {
        if (op_name === TIMED_OPS.PROCESS_RULE) {
            lifecycle_run_status.buckets_statuses[bucket_name].rules_statuses[rule_id] = { rule_process_times: {}, rule_stats: {} };
        } else if (op_name === TIMED_OPS.PROCESS_BUCKET) {
            lifecycle_run_status.buckets_statuses[bucket_name] = { bucket_process_times: {}, bucket_stats: {}, rules_statuses: {} };
        }
    }
    _update_times_on_status({ op_name, op_times, bucket_name, rule_id });
    _update_error_on_status({ error, bucket_name, rule_id });
    if (bucket_name && rule_id) {
        update_stats_on_status({ bucket_name, rule_id, op_name, op_times, reply });
    }
}

/**
 * _calc_stats accumulates stats for global/bucket stats
 * @param {Object} stats_acc
 * @param {Object} [cur_op_stats]
 * @returns {Object}
 */
function _acc_stats(stats_acc, cur_op_stats = {}) {
    const stats_res = stats_acc;

    for (const [stat_key, stat_value] of Object.entries(cur_op_stats)) {
        if (typeof stat_value === 'number') {
            stats_res[stat_key] += stat_value;
        }
        if (Array.isArray(stat_value)) {
            stats_res[stat_key].concat(stat_value);
        }
    }
    return stats_res;
}

/**
 * update_stats_on_status updates stats on rule context status and adds the rule status to the summarized bucket/global context stats
 * @param {{
 * op_name: string,
 * bucket_name: string,
 * rule_id: string,
 * op_times: {
 *  start_time?: number,
 *  end_time?: number,
 *  took_ms?: number
 * },
 * reply?: Object[],
 * }} params
 * @returns {Void}
 */
function update_stats_on_status({ bucket_name, rule_id, op_name, op_times, reply = [] }) {
    if (op_times.end_time === undefined || ![TIMED_OPS.DELETE_MULTIPLE_OBJECTS, TIMED_OPS.ABORT_MPUS].includes(op_name)) return;

    const rule_stats_acc = lifecycle_run_status.buckets_statuses[bucket_name].rules_statuses[rule_id].rule_stats || _get_default_stats();
    const bucket_stats_acc = lifecycle_run_status.buckets_statuses[bucket_name].bucket_stats || _get_default_stats();
    const lifecycle_stats_acc = lifecycle_run_status.total_stats || _get_default_stats();

    let cur_op_stats;
    if (op_name === TIMED_OPS.DELETE_MULTIPLE_OBJECTS) {
        const objects_delete_errors = reply.filter(obj => obj.err_code);
        const num_objects_delete_failed = objects_delete_errors.length;
        const num_objects_deleted = reply.length - num_objects_delete_failed;
        cur_op_stats = { num_objects_deleted, num_objects_delete_failed, objects_delete_errors };
    }
    if (op_name === TIMED_OPS.ABORT_MPUS) {
        const mpu_abort_errors = reply.filter(obj => obj.err_code);
        const num_mpu_abort_failed = mpu_abort_errors.length;
        const num_mpu_aborted = reply.length - num_mpu_abort_failed;
        cur_op_stats = { num_mpu_aborted, num_mpu_abort_failed, mpu_abort_errors };
    }
    lifecycle_run_status.buckets_statuses[bucket_name].rules_statuses[rule_id].rule_stats = { ...rule_stats_acc, ...cur_op_stats };
    lifecycle_run_status.buckets_statuses[bucket_name].bucket_stats = _acc_stats({ stats_acc: bucket_stats_acc, cur_op_stats });
    lifecycle_run_status.total_stats = _acc_stats({ stats_acc: lifecycle_stats_acc, cur_op_stats });
}

/**
 * _update_times_on_status updates start/end & took times in lifecycle status
 * @param {{op_name: String, op_times: {start_time?: number, end_time?: number, took_ms?: number },
 * bucket_name?: String, rule_id?: String}} params
 * @returns
 */
function _update_times_on_status({ op_name, op_times, bucket_name = undefined, rule_id = undefined }) {
    for (const [key, value] of Object.entries(op_times)) {
        const status_key = op_name + '_' + key;
        if (bucket_name && rule_id) {
            lifecycle_run_status.buckets_statuses[bucket_name].rules_statuses[rule_id].rule_process_times[status_key] = value;
        } else if (bucket_name) {
            lifecycle_run_status.buckets_statuses[bucket_name].bucket_process_times[status_key] = value;
        } else {
            lifecycle_run_status.lifecycle_run_times[status_key] = value;
        }
    }
}

/**
 * _update_error_on_status updates an error occured in lifecycle status
 * @param {{error: Error, bucket_name?: string, rule_id?: string}} params
 * @returns
 */
function _update_error_on_status({ error, bucket_name = undefined, rule_id = undefined }) {
    if (!error) return;
    if (bucket_name && rule_id) {
        (lifecycle_run_status.buckets_statuses[bucket_name].rules_statuses[rule_id].errors ??= []).push(error.message);
    } else if (bucket_name) {
        (lifecycle_run_status.buckets_statuses[bucket_name].errors ??= []).push(error.message);
    } else {
        (lifecycle_run_status.errors ??= []).push(error.message);
    }
}

function _get_default_stats() {
    return {
        num_objects_deleted: 0, num_objects_delete_failed: 0, objects_delete_errors: [],
        num_mpu_aborted: 0, num_mpu_abort_failed: 0, mpu_abort_errors: []
    };
}

/**
 * write_lifecycle_log_file
 */
async function write_lifecycle_log_file(fs_context, lifecyle_logs_dir_path) {
    const log_file_name = `lifecycle_run_${lifecycle_run_status.lifecycle_run_times.run_lifecycle_start_time}.json`;
    await nb_native().fs.writeFile(
        fs_context,
        path.join(lifecyle_logs_dir_path, log_file_name),
        Buffer.from(JSON.stringify(lifecycle_run_status)),
        { mode: native_fs_utils.get_umasked_mode(config.BASE_MODE_FILE) }
    );
}

// EXPORTS
exports.run_lifecycle_under_lock = run_lifecycle_under_lock;

