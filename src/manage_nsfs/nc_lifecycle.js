/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../util/debug_module')(__filename);
const _ = require('lodash');
const util = require('util');
const P = require('../util/promise');
const config = require('../../config');
const nb_native = require('../util/nb_native');
const NsfsObjectSDK = require('../sdk/nsfs_object_sdk');
const ManageCLIError = require('./manage_nsfs_cli_errors').ManageCLIError;
const { throw_cli_error, get_service_status, NOOBAA_SERVICE_NAME } = require('./manage_nsfs_cli_utils');

// TODO: 
// implement 
// 1. notifications
// 2. POSIX scanning and filtering per rule
// 3. GPFS ILM policy and apply for scanning and filtering optimization

/**
 * run_lifecycle runs the lifecycle workflow
 * @param {import('../sdk/config_fs').ConfigFS} config_fs 
 * @returns {Promise<Void>}
 */
async function run_lifecycle(config_fs) {
    const options = { silent_if_missing: true };
    const system_json = await config_fs.get_system_config_file(options);
    await throw_if_noobaa_not_active(config_fs, system_json);

    const bucket_names = await config_fs.list_buckets();
    const concurrency = 10; // TODO - think about it 
    await P.map_with_concurrency(concurrency, bucket_names, async bucket_name => {
        const bucket_json = await config_fs.get_bucket_by_name(bucket_name, options);
        const account = { email: '', nsfs_account_config: config_fs.fs_context, access_keys: [] };
        const object_sdk = new NsfsObjectSDK('', config_fs, account, bucket_json.versioning, config_fs.config_root, system_json);
        await P.all(_.map(bucket_json.lifecycle_configuration_rules,
            async (lifecycle_rule, j) => {
                dbg.log0('NC LIFECYCLE READ BUCKETS configuration handle_bucket_rule bucket name:', bucket_json.name, 'rule', lifecycle_rule, 'j', j);
                return handle_bucket_rule(lifecycle_rule, j, bucket_json, object_sdk);
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
    const delete_candidates = await get_delete_candidates(bucket_json, lifecycle_rule);
    const delete_objects_reply = await object_sdk.delete_multiple_objects({
        bucket: bucket_json.name,
        objects: delete_candidates // probably need to convert to the format expected by delete_multiple_objects
    });
    // TODO - implement notifications for the deleted objects
    await update_lifecycle_rules_last_sync(config_fs, bucket_json, j, delete_objects_reply.num_objects_deleted);
}

/**
 * get_delete_candidates gets the delete candidates for the lifecycle rule
 * @param {Object} bucket_json 
 * @param {*} lifecycle_rule 
 */
async function get_delete_candidates(bucket_json, lifecycle_rule) {
    // let reply_objects = []; // TODO: needed for the notification log file
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
        await get_candidates_by_abort_incomplete_multipart_upload_rule(lifecycle_rule, bucket_json);
    }
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
exports.run_lifecycle = run_lifecycle;

