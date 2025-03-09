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
const ManageCLIError = require('./manage_nsfs_cli_errors').ManageCLIError;
const ManageCLIResponse = require('../manage_nsfs/manage_nsfs_cli_responses').ManageCLIResponse;
const { write_stdout_response, throw_cli_error, get_service_status, NOOBAA_SERVICE_NAME } = require('./manage_nsfs_cli_utils');

// TODO:
// implement 
// 1. notifications
// 2. POSIX scanning and filtering per rule
// 3. GPFS ILM policy and apply for scanning and filtering optimization

const CLUSTER_LOCK = 'cluster.lock';
const config_fs_options = { silent_if_missing: true };

/**
 * lifecycle_timeout returns a promise that rejects with a timeout error
 * @returns {Promise}
 */
async function lifecycle_timeout() {
    // TODO - change to manage_nsfs_error?
    return new Promise((resolve, reject) => setTimeout(() => reject(new Error('lifecycle worker reached timeout')), config.NC_LIFECYCLE_TIMEOUT_MS));
}

/**
 * run_lifecycle_under_lock runs the lifecycle workflow under a file system lock
 * lifecycle workflow is being locked to prevent multiple instances from running the lifecycle workflow
 * @param {import('../sdk/config_fs').ConfigFS} config_fs 
 */
async function run_lifecycle_under_lock(config_fs) {
    const lifecyle_logs_dir_path = config.LIFECYCLE_LOGS_DIR;
    await config_fs.create_dir_if_missing(lifecyle_logs_dir_path);
    const lock_path = path.join(lifecyle_logs_dir_path, CLUSTER_LOCK);

    await native_fs_utils.lock_and_run(config_fs.fs_context, lock_path, async () => {
        const start_time = Date.now();
        let lifecycle_run_status;
        try {
            dbg.log0('run_lifecycle_under_lock acquired lock - start lifecycle');
            new NoobaaEvent(NoobaaEvent.LIFECYCLE_STARTED).create_event();
            lifecycle_run_status = await Promise.race([run_lifecycle(config_fs, start_time), lifecycle_timeout()]);
            write_stdout_response(ManageCLIResponse.LifecycleSuccessful, lifecycle_run_status);
        } catch (err) {
            dbg.error('run_lifecycle_under_lock failed with error', err, err.code, err.message);
            const end_time = Date.now();
            const lifecycle_run_times = { start_time, end_time };
            const error = { code: err.code, message: err.message, stack: err.stack };
            lifecycle_run_status = {
                ...get_lifecycle_run_status(lifecycle_run_times),
                errors: [error]
            };
            throw_cli_error(ManageCLIError.LifecycleFailed, error);
        } finally {
            await write_lifecycle_log_file(config_fs.fs_context, lifecyle_logs_dir_path, lifecycle_run_status);
            dbg.log0('run_lifecycle_under_lock done lifecycle - released lock');
        }
    });
}

/**
 * write_lifecycle_log_file
 */
async function write_lifecycle_log_file(fs_context, lifecyle_logs_dir_path, lifecycle_run_status) {
    const log_file_name = `lifecycle_run_${lifecycle_run_status.lifecycle_run_times.start_time}.json`;
    await nb_native().fs.writeFile(
        fs_context,
        path.join(lifecyle_logs_dir_path, log_file_name),
        Buffer.from(JSON.stringify(lifecycle_run_status)),
        { mode: native_fs_utils.get_umasked_mode(config.BASE_MODE_FILE) }
    );
}

/**
 * run_lifecycle runs the lifecycle workflow
 * @param {import('../sdk/config_fs').ConfigFS} config_fs 
 * @param {number} start_time
 * @returns {Promise<Object>}
 */
async function run_lifecycle(config_fs, start_time) {
    const system_json = await config_fs.get_system_config_file(config_fs_options);
    await throw_if_noobaa_not_active(config_fs, system_json);

    const buckets_list_start_time = Date.now();
    const bucket_names = await config_fs.list_buckets();
    const buckets_list_end_time = Date.now();

    const concurrency = 10; // TODO - think about it 

    const buckets_statuses = await P.map_with_concurrency(concurrency, bucket_names, async bucket_name =>
        handle_bucket(config_fs, bucket_name, system_json));

    const end_time = Date.now();
    const lifecycle_run_times = { start_time, end_time, buckets_list_start_time, buckets_list_end_time
    };
    const non_empty_buckets_statuses = buckets_statuses.filter(status => Object.keys(status).length > 0);
    return get_lifecycle_run_status(lifecycle_run_times, non_empty_buckets_statuses);
}

/**
 * get_lifecycle_run_status calculates and returns the lifecycle run status
 * @param {*} lifecycle_times 
 * @param {*} buckets_statuses 
 * @returns 
 */
function get_lifecycle_run_status(lifecycle_times, buckets_statuses) {
    const { start_time, end_time, buckets_list_start_time, buckets_list_end_time } = lifecycle_times;

    const took_ms = end_time - start_time;
    const buckets_list_took_ms = buckets_list_end_time - buckets_list_start_time;
    const buckets_process_took_ms = end_time - buckets_list_end_time;

    const errors = [];
    const lifecycle_run_status = {
        running_host: os.hostname(),
        lifecycle_run_times: {
            start_time,
            end_time,
            took_ms,
            buckets_list_start_time,
            buckets_list_end_time,
            buckets_list_took_ms,
            buckets_process_took_ms,
        },
        errors,
        buckets_statuses
    };
    return lifecycle_run_status;
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
 * handle_bucket processes the lifecycle rules for a bucket
 * @param {import('../sdk/config_fs').ConfigFS} config_fs
 * @param {string} bucket_name
 * @param {Object} system_json
 */
async function handle_bucket(config_fs, bucket_name, system_json) {
    const start_time = Date.now();

    const bucket_json = await config_fs.get_bucket_by_name(bucket_name, config_fs_options);
    const account = { email: '', nsfs_account_config: config_fs.fs_context, access_keys: [] };
    const object_sdk = new NsfsObjectSDK('', config_fs, account, bucket_json.versioning, config_fs.config_root, system_json);
    await object_sdk._simple_load_requesting_account();
    if (!bucket_json.lifecycle_configuration_rules) return {};

    let rules_statuses = [];
    let error;
    try {
        rules_statuses = await P.all(_.map(bucket_json.lifecycle_configuration_rules,
            async (lifecycle_rule, index) => handle_bucket_rule(config_fs, lifecycle_rule, index, bucket_json, object_sdk)
        ));
    } catch (err) {
        dbg.error('handle_bucket failed with error', err, err.code, err.message);
        error = { code: err.code, message: err.message, stack: err.stack };
    }
    const end_time = Date.now();
    const took_ms = end_time - start_time;
    const bucket_process_status = {
        bucket_name: bucket_json.name,
        bucket_process_times: { start_time, end_time, took_ms },
        rules_statuses,
    };
    if (error) bucket_process_status.error = error;
    return bucket_process_status;
}

/**
 * handle_bucket_rule processes the lifecycle rule for a bucket
 * @param {*} lifecycle_rule 
 * @param {number} index 
 * @param {Object} bucket_json 
 * @param {Object} object_sdk
 */
async function handle_bucket_rule(config_fs, lifecycle_rule, index, bucket_json, object_sdk) {
    // TODO - implement notifications
    dbg.log0('NC LIFECYCLE READ BUCKETS configuration handle_bucket_rule bucket name:', bucket_json.name, 'rule', lifecycle_rule, 'index', index);

    const start_time = Date.now();
    const should_process_lifecycle_rule = validate_rule_enabled(lifecycle_rule, bucket_json, start_time);
    if (!should_process_lifecycle_rule) return;

    dbg.log0('LIFECYCLE PROCESSING bucket:', bucket_json.name, '(bucket id:', bucket_json._id, ') rule', util.inspect(lifecycle_rule));
    let delete_objects_reply = [];
    const rule_process_times = { start_time };
    let error;
    try {
        rule_process_times.list_candidates_start_time = Date.now();
        const delete_candidates = await get_delete_candidates(bucket_json, lifecycle_rule);

        rule_process_times.delete_candidates_start_time = Date.now();
        delete_objects_reply = delete_candidates.length > 0 ? [] : await object_sdk.delete_multiple_objects({
            bucket: bucket_json.name,
            objects: delete_candidates // probably need to convert to the format expected by delete_multiple_objects
        });
        rule_process_times.delete_candidates_end_time = Date.now();

        // TODO - implement notifications for the deleted objects
        rule_process_times.update_last_sync_time = Date.now();
        await update_lifecycle_rules_last_sync(config_fs, bucket_json, index, delete_objects_reply.num_objects_deleted);
    } catch (err) {
        dbg.error('handle_bucket_rule failed with error', err, err.code, err.message);
        error = { code: err.code, message: err.message, stack: err.stack };
    }
    rule_process_times.end_time = Date.now();
    return get_lifecycle_rule_status(lifecycle_rule, rule_process_times, delete_objects_reply, error);
}

/**
 * get_lifecycle_rule_status calculates and returns the lifecycle rule status
 * @param {*} lifecycle_rule 
 * @param {*} rule_times
 * @param {*} delete_objects_reply 
 * @param {*} error
 * @returns 
 */
function get_lifecycle_rule_status(lifecycle_rule, rule_times, delete_objects_reply, error) {
    const { start_time, end_time, list_candidates_start_time, delete_candidates_start_time,
        delete_candidates_end_time, update_last_sync_time } = rule_times;

    const objects_delete_errors = delete_objects_reply.filter(obj => obj.err_code);
    const num_objects_delete_failed = objects_delete_errors.length;
    const took_ms = end_time - start_time;
    const list_candidates_took_ms = delete_candidates_start_time - list_candidates_start_time;
    const delete_candidates_took_ms = delete_candidates_end_time - delete_candidates_start_time;
    const update_last_sync_took_ms = end_time - update_last_sync_time;
    const num_objects_deleted = delete_objects_reply.length - num_objects_delete_failed;

    const rule_status = {
        lifecycle_rule: lifecycle_rule.id,
        rule_process_times: {
            start_time,
            end_time,
            took_ms,
            list_candidates_start_time,
            list_candidates_took_ms,
            delete_candidates_start_time,
            delete_candidates_took_ms,
            update_last_sync_time,
            update_last_sync_took_ms,
        },
        num_objects_deleted,
        num_objects_delete_failed,
        objects_delete_errors
    };
    if (error) rule_status.error = error;
    return rule_status;
}
/**
 * get_delete_candidates gets the delete candidates for the lifecycle rule
 * @param {Object} bucket_json 
 * @param {*} lifecycle_rule 
 */
async function get_delete_candidates(bucket_json, lifecycle_rule) {
    let reply_objects = []; // TODO: needed for the notification log file
    let candidates;
    if (lifecycle_rule.expiration) {
        candidates = await get_candidates_by_expiration_rule(lifecycle_rule, bucket_json);
        reply_objects = reply_objects.concat(candidates);
        if (lifecycle_rule.expiration.days || lifecycle_rule.expiration.expired_object_delete_marker) {
            candidates = await get_candidates_by_expiration_delete_marker_rule(lifecycle_rule, bucket_json);
            reply_objects = reply_objects.concat(candidates);
        }
    }
    if (lifecycle_rule.noncurrent_version_expiration) {
        candidates = await get_candidates_by_noncurrent_version_expiration_rule(lifecycle_rule, bucket_json);
        reply_objects = reply_objects.concat(candidates);

    }
    if (lifecycle_rule.abort_incomplete_multipart_upload) {
        candidates = await get_candidates_by_abort_incomplete_multipart_upload_rule(lifecycle_rule, bucket_json);
        reply_objects = reply_objects.concat(candidates);
    }
    return reply_objects;
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
    return [];
}

/**
 * 
 * @param {*} lifecycle_rule 
 * @param {Object} bucket_json 
 */
async function get_candidates_by_expiration_rule_posix(lifecycle_rule, bucket_json) {
    // TODO - implement
    return [];
}

/**
 * get_candidates_by_expiration_delete_marker_rule processes the expiration delete marker rule
 * @param {*} lifecycle_rule 
 * @param {Object} bucket_json 
 */
async function get_candidates_by_expiration_delete_marker_rule(lifecycle_rule, bucket_json) {
    // TODO - implement
    return [];
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
async function get_candidates_by_abort_incomplete_multipart_upload_rule(lifecycle_rule, bucket_json) {
    // TODO - implement
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

