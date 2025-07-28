/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../util/debug_module')(__filename);
const os = require('os');
const _ = require('lodash');
const path = require('path');
const util = require('util');
const P = require('../util/promise');
const config = require('../../config');
const os_utils = require('../util/os_utils');
const nb_native = require('../util/nb_native');
const { CONFIG_TYPES } = require('../sdk/config_fs');
const NsfsObjectSDK = require('../sdk/nsfs_object_sdk');
const { NewlineReader } = require('../util/file_reader');
const lifecycle_utils = require('../util/lifecycle_utils');
const native_fs_utils = require('../util/native_fs_utils');
const SensitiveString = require('../util/sensitive_string');
const { GPFS_EXTERNAL_BINS } = require('../nc/nc_constants');
const { NoobaaEvent } = require('./manage_nsfs_events_utils');
const notifications_util = require('../util/notifications_util');
const ManageCLIError = require('./manage_nsfs_cli_errors').ManageCLIError;
const { throw_cli_error, get_service_status, NOOBAA_SERVICE_NAME,
    is_desired_time, record_current_time } = require('./manage_nsfs_cli_utils');

// TODO:
// implement
// 2. POSIX scanning and filtering per rule - non current + expired delete marker
// 3. GPFS ILM policy and apply for scanning and filtering optimization
// TODO - we will filter during the scan except for get_candidates_by_expiration_rule on GPFS that does the filter on the file system

const LIFECYCLE_CLUSTER_LOCK = 'lifecycle_cluster.lock';
const LIFECYLE_TIMESTAMP_FILE = 'lifecycle.timestamp';
const config_fs_options = { silent_if_missing: true };
const ILM_POLICIES_TMP_DIR = path.join(config.NC_LIFECYCLE_LOGS_DIR, 'lifecycle_ilm_policies');
const ILM_CANDIDATES_TMP_DIR = path.join(config.NC_LIFECYCLE_LOGS_DIR, 'lifecycle_ilm_candidates');
const escape_backslash_str = "ESCAPE '\\'";
const underscore_wildcard_regex = /_/g;
const precentage_wildcard_regex = /%/g;
const single_quote_regex = /'/g;
const backslash_regex = /\\/g;

const TIMED_OPS = Object.freeze({
    RUN_LIFECYLE: 'run_lifecycle',
    LIST_BUCKETS: 'list_buckets',
    CREATE_GPFS_CANDIDATES_FILES: 'create_gpfs_candidates_files',
    CREATE_GPFS_CANDIDATE_FILE_BY_ILM_POLICY: 'create_candidates_file_by_gpfs_ilm_policy',
    PROCESS_BUCKETS: 'process_buckets',
    PROCESS_BUCKET: 'process_bucket',
    PROCESS_RULE: 'process_rule',
    GET_CANDIDATES: 'get_candidates',
    ABORT_MPUS: 'abort_mpus',
    DELETE_MULTIPLE_OBJECTS: 'delete_multiple_objects'
});

/**
 * @typedef {{
 * is_finished?: Boolean | Undefined,
 * expire?: { is_finished?: Boolean | Undefined, key_marker?: String | Undefined, candidates_file_offset?: number | undefined}
 * noncurrent?: { is_finished?: Boolean | Undefined, key_marker_versioned?: String | Undefined, version_id_marker?: String | Undefined }
 * }} RuleState
*/

/**
 * get_bin_path returns the full path to the binary file.
 * @param {String} bin_dir 
 * @param {String} bin_name 
 * @returns {String}
 */
function get_bin_path(bin_dir, bin_name) {
    return path.join(bin_dir, bin_name);
}

class NCLifecycle {
    constructor(config_fs, options = {}) {
        this.lifecycle_config_dir_path = path.join(config_fs.config_root, config.NC_LIFECYCLE_CONFIG_DIR_NAME);
        this.lifecyle_logs_dir_path = config.NC_LIFECYCLE_LOGS_DIR;
        this.config_fs = config_fs;
        this.fs_context = config_fs.fs_context;
        // used for reading/writing policies/candidates file which are not on gpfs file system
        this.non_gpfs_fs_context = { ...this.fs_context, backend: undefined };
        this.lock_path = path.join(this.lifecycle_config_dir_path, LIFECYCLE_CLUSTER_LOCK);
        this.lifecycle_timestamp_file_path = path.join(this.lifecycle_config_dir_path, LIFECYLE_TIMESTAMP_FILE);

        this.lifecycle_run_status = {
            running_host: os.hostname(),
            lifecycle_run_times: {},
            total_stats: this._get_default_stats(),
            state: { is_finished: false },
            buckets_statuses: {},
            mount_points_statuses: {}
        };
        this.return_short_status = options.short_status || false;
        this.disable_service_validation = options.disable_service_validation || false;
        this.disable_runtime_validation = options.disable_runtime_validation || false;
        this.should_continue_last_run = options.should_continue_last_run || false;
        // used for GPFS optimization - maps bucket names to their mount points
        // example - { 'bucket1': '/gpfs/mount/point1', 'bucket2': '/gpfs/mount/point2' }
        this.bucket_to_mount_point_map = {};
    }

    /**
     * run_lifecycle_under_lock runs the lifecycle workflow under a file system lock
     * lifecycle workflow is being locked to prevent multiple instances from running the lifecycle workflow
     * @returns {Promise<{should_run: Boolean, lifecycle_run_status: Object}>}
     */
    async run_lifecycle_under_lock() {
        await native_fs_utils._create_path(this.lifecyle_logs_dir_path, this.non_gpfs_fs_context, config.BASE_MODE_CONFIG_DIR);
        await this.config_fs.create_dir_if_missing(this.lifecycle_config_dir_path);

        let should_run = true;
        await native_fs_utils.lock_and_run(this.fs_context, this.lock_path, async () => {
            dbg.log0('run_lifecycle_under_lock acquired lock - verifying');
            should_run = await this._should_lifecycle_run();
            if (!should_run) return;

            try {
                dbg.log0('run_lifecycle_under_lock acquired lock - start lifecycle');
                new NoobaaEvent(NoobaaEvent.LIFECYCLE_STARTED).create_event();
                await this.run_lifecycle_or_timeout();
            } catch (err) {
                dbg.error('run_lifecycle_under_lock failed with error', err, err.code, err.message);
                throw err;
            } finally {
                await record_current_time(this.fs_context, this.lifecycle_timestamp_file_path);
                await this.write_lifecycle_log_file();
                dbg.log0('run_lifecycle_under_lock done lifecycle - released lock');
            }
        });
        return { should_run, lifecycle_run_status: this.lifecycle_run_status };
    }

    /**
     * run_lifecycle_or_timeout runs the lifecycle workflow or times out while calculating
     * and saving times and stats of the run on the global lifecycle status
     * @returns {Promise<Void>}
     */
    async run_lifecycle_or_timeout() {
        await this._call_op_and_update_status({
            op_name: TIMED_OPS.RUN_LIFECYLE,
            op_func: async () => {
                await P.timeout(
                    config.NC_LIFECYCLE_TIMEOUT_MS,
                    this.run_lifecycle(),
                    () => ManageCLIError.LifecycleWorkerReachedTimeout
                );
            }
        });
    }

    /**
     * run_lifecycle runs the lifecycle workflow
     * @returns {Promise<Void>}
     */
    async run_lifecycle() {
        const system_json = await this.config_fs.get_system_config_file(config_fs_options);
        if (!this.disable_service_validation) await this.throw_if_noobaa_not_active(system_json);

        const bucket_names = await this._call_op_and_update_status({
            op_name: TIMED_OPS.LIST_BUCKETS,
            op_func: async () => this.config_fs.list_buckets()
        });

        if (this.should_continue_last_run) {
            await this.load_previous_run_state(bucket_names);
        }

        await this._call_op_and_update_status({
            op_name: TIMED_OPS.PROCESS_BUCKETS,
            op_func: async () => this.process_buckets(bucket_names, system_json)
        });
    }

    /**
     * process_buckets does the following -
     * 1. if it's a GPFS optimization - create candidates files
     * 2. iterates over buckets and handles their rules
     * @param {String[]} bucket_names
     * @param {Object} system_json
     * @returns {Promise<Void>}
     */
    async process_buckets(bucket_names, system_json) {
        const buckets_concurrency = 10; // TODO - think about it

        if (this._should_use_gpfs_optimization()) {
            await this._call_op_and_update_status({
                op_name: TIMED_OPS.CREATE_GPFS_CANDIDATES_FILES,
                op_func: async () => this.create_gpfs_candidates_files(bucket_names)
            });
        }

        while (!this.lifecycle_run_status.state.is_finished) {
            await P.map_with_concurrency(buckets_concurrency, bucket_names, async bucket_name => {
                try {
                    await this._call_op_and_update_status({
                        bucket_name,
                        op_name: TIMED_OPS.PROCESS_BUCKET,
                        op_func: async () => this.process_bucket(bucket_name, system_json)
                    });
                } catch (err) {
                    dbg.error('process_bucket failed with error', err, err.code, err.message);
                    if (!this.lifecycle_run_status.buckets_statuses[bucket_name]) this.init_bucket_status(bucket_name);
                    this.lifecycle_run_status.buckets_statuses[bucket_name].state.is_finished = true;
                }
            });
            this.lifecycle_run_status.state.is_finished = Object.values(this.lifecycle_run_status.buckets_statuses).reduce(
                (acc, bucket) => acc && (bucket.state?.is_finished),
                true
            );
        }
    }

    /**
     * process_bucket processes the lifecycle rules for a bucket
     * @param {string} bucket_name
     * @param {Object} system_json
     */
    async process_bucket(bucket_name, system_json) {
        const bucket_json = await this.config_fs.get_bucket_by_name(bucket_name, config_fs_options);
        const account = await this.config_fs.get_identity_by_id(bucket_json.owner_account, CONFIG_TYPES.ACCOUNT,
            { silent_if_missing: true });
        if (!account) {
            dbg.warn(`process_bucket - bucket owner ${bucket_json.owner_account} does not exist for bucket ${bucket_name}. skipping lifecycle for this bucket`);
            return;
        }
        const bucket_storage_path_exists = await native_fs_utils.is_path_exists(this.config_fs.fs_context, bucket_json.path);
        if (!bucket_storage_path_exists) throw new Error(`process_bucket - bucket storage path ${bucket_json.path} does not exist for bucket ${bucket_name}.`);
        const object_sdk = new NsfsObjectSDK('', this.config_fs, account, bucket_json.versioning, this.config_fs.config_root, system_json);
        await object_sdk._simple_load_requesting_account();
        const should_notify = notifications_util.should_notify_on_event(bucket_json, notifications_util.OP_TO_EVENT.lifecycle_delete.name);
        if (!bucket_json.lifecycle_configuration_rules) {
            this.lifecycle_run_status.buckets_statuses[bucket_name].state = { is_finished: true };
            return;
        }
        await this.process_rules(bucket_json, object_sdk, should_notify);
    }

    /**
     * process_rules processes the lifecycle rules for a bucket
     * @param {Object} bucket_json
     * @param {nb.ObjectSDK} object_sdk
     */
    async process_rules(bucket_json, object_sdk, should_notify) {
        const bucket_name = bucket_json.name;
        const bucket_state = this.lifecycle_run_status.buckets_statuses[bucket_name].state;
        bucket_state.num_processed_objects = 0;
        while (!bucket_state.is_finished && bucket_state.num_processed_objects < config.NC_LIFECYCLE_BUCKET_BATCH_SIZE) {
            if (this._should_use_gpfs_optimization()) {
                const bucket_mount_point = this.bucket_to_mount_point_map[bucket_name];
                if (this.lifecycle_run_status.mount_points_statuses[bucket_mount_point]?.errors?.length > 0) {
                    throw new Error(`Lifecycle run failed for bucket ${bucket_name} on mount point ${bucket_mount_point} due to errors: ${this.lifecycle_run_status.mount_points_statuses[bucket_mount_point].errors}`);
                }
            }
            await P.all(_.map(bucket_json.lifecycle_configuration_rules,
                    async (lifecycle_rule, index) =>
                        await this._call_op_and_update_status({
                            bucket_name,
                            rule_id: lifecycle_rule.id,
                            op_name: TIMED_OPS.PROCESS_RULE,
                            op_func: async () => this.process_rule(
                                lifecycle_rule,
                                index,
                                bucket_json,
                                object_sdk,
                                should_notify
                            )
                        })
                    )
            );
            bucket_state.is_finished = Object.values(this.lifecycle_run_status.buckets_statuses[bucket_name].rules_statuses)
                .reduce(
                (acc, rule) => acc && (_.isEmpty(rule.state) || rule.state.is_finished),
                true
            );
        }
    }

    /**
     * process_rule processes the lifecycle rule for a bucket
     * TODO - implement notifications for the deleted objects (check if needed for abort mpus as well)
     * @param {Object} lifecycle_rule
     * @param {number} index
     * @param {Object} bucket_json
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<Void>}
     */
    async process_rule(lifecycle_rule, index, bucket_json, object_sdk, should_notify) {
        dbg.log0('nc_lifecycle.process_rule: start bucket name:', bucket_json.name, 'rule', lifecycle_rule, 'index', index);
        const bucket_name = bucket_json.name;
        const rule_id = lifecycle_rule.id;
        const should_process_lifecycle_rule = this.validate_rule_enabled(lifecycle_rule, bucket_json);
        if (!should_process_lifecycle_rule) return;

        dbg.log0('nc_lifecycle.process_rule: processing rule:', bucket_name, '(bucket id:', bucket_json._id, ') rule', util.inspect(lifecycle_rule));
        try {
            const candidates = await this._call_op_and_update_status({
                bucket_name,
                rule_id,
                op_name: TIMED_OPS.GET_CANDIDATES,
                op_func: async () => this.get_candidates(bucket_json, lifecycle_rule, object_sdk)
            });

            if (candidates.delete_candidates?.length > 0) {
                const expiration = lifecycle_rule.expiration ? this._get_expiration_time(lifecycle_rule.expiration) : 0;
                const filter_func = this._build_lifecycle_filter({filter: lifecycle_rule.filter, expiration});
                dbg.log0('process_rule: calling delete_multiple_objects, num of objects to be deleted', candidates.delete_candidates.length);
                const delete_res = await this._call_op_and_update_status({
                    bucket_name,
                    rule_id,
                    op_name: TIMED_OPS.DELETE_MULTIPLE_OBJECTS,
                    op_func: async () => object_sdk.delete_multiple_objects({
                        bucket: bucket_json.name,
                        objects: candidates.delete_candidates,
                        filter_func
                    })
                });
                if (should_notify) {
                    await this.send_lifecycle_notifications(delete_res, candidates.delete_candidates, bucket_json, object_sdk);
                }
            }

            if (candidates.abort_mpu_candidates?.length > 0) {
                dbg.log0('process_rule: calling delete_multiple_objects, num of mpu to be aborted', candidates.delete_candidates.length);
                await this._call_op_and_update_status({
                    bucket_name,
                    rule_id,
                    op_name: TIMED_OPS.ABORT_MPUS,
                    op_func: async () => this.abort_mpus(candidates, object_sdk)
                });
            }
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
    async abort_mpus(candidates, object_sdk) {
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
     * @returns {Promise<Boolean>}
     */
    async _should_lifecycle_run() {
        const should_run = this.disable_runtime_validation ? true : await is_desired_time(
            this.fs_context,
            new Date(),
            config.NC_LIFECYCLE_RUN_TIME,
            config.NC_LIFECYCLE_RUN_DELAY_LIMIT_MINS,
            this.lifecycle_timestamp_file_path,
            config.NC_LIFECYCLE_TZ);
        dbg.log0('_should_lifecycle_run should_run', should_run);
        return should_run;
    }

    /**
     * throw_if_noobaa_not_active checks if system.json exists and the noobaa service is active
     * @param {Object} system_json
     */
    async throw_if_noobaa_not_active(system_json) {
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
     * @param {nb.ObjectSDK} object_sdk
     * @reutrns {Promise<Object>}
     */
    async get_candidates(bucket_json, lifecycle_rule, object_sdk) {
        const candidates = { abort_mpu_candidates: [], delete_candidates: [] };
        const params = {versions_list: undefined};
        if (lifecycle_rule.expiration) {
            candidates.delete_candidates = await this.get_candidates_by_expiration_rule(lifecycle_rule, bucket_json,
                object_sdk);
            if (lifecycle_rule.expiration.days || lifecycle_rule.expiration.expired_object_delete_marker) {
                const dm_candidates = await this.get_candidates_by_expiration_delete_marker_rule(
                    lifecycle_rule,
                    bucket_json,
                    object_sdk,
                    params
                );
                candidates.delete_candidates = candidates.delete_candidates.concat(dm_candidates);
            }
        }
        if (lifecycle_rule.noncurrent_version_expiration) {
            const non_current_candidates = await this.get_candidates_by_noncurrent_version_expiration_rule(
                lifecycle_rule,
                bucket_json,
                object_sdk,
                params
            );
            candidates.delete_candidates = candidates.delete_candidates.concat(non_current_candidates);
        }
        if (lifecycle_rule.abort_incomplete_multipart_upload) {
            candidates.abort_mpu_candidates = await this.get_candidates_by_abort_incomplete_multipart_upload_rule(
                lifecycle_rule, bucket_json, object_sdk);
        }
        return candidates;
    }


    /**
     * validate_rule_enabled checks if the rule is enabled and should be processed
     * @param {*} rule
     * @param {Object} bucket
     * @returns {boolean}
     */
    validate_rule_enabled(rule, bucket) {
        if (rule.status !== 'Enabled') {
            dbg.log0('validate_rule_enabled: SKIP bucket:', bucket.name, '(bucket id:', bucket._id, ') rule', util.inspect(rule), 'not Enabled');
            return false;
        }
        return true;
    }

    ////////////////////////////////////
    //////// EXPIRATION HELPERS ////////
    ////////////////////////////////////

    /**
     * get_candidates_by_expiration_rule processes the expiration rule
     * @param {*} lifecycle_rule
     * @param {Object} bucket_json
     * @returns {Promise<Object[]>}
     */
    async get_candidates_by_expiration_rule(lifecycle_rule, bucket_json, object_sdk) {
        if (this._should_use_gpfs_optimization()) {
            return this.get_candidates_by_expiration_rule_gpfs(lifecycle_rule, bucket_json);
        } else {
            return this.get_candidates_by_expiration_rule_posix(lifecycle_rule, bucket_json, object_sdk);
        }
    }

    /**
     * load objects list batch and update state for the next cycle
     * @param {Object} object_sdk
     * @param {Object} lifecycle_rule
     * @param {Object} bucket_json
     * @param {Object} expire_state
     * @returns
     */
    async load_objects_list(object_sdk, lifecycle_rule, bucket_json, expire_state) {
        const objects_list = await object_sdk.list_objects({
            bucket: bucket_json.name,
            prefix: lifecycle_rule.filter?.prefix,
            key_marker: expire_state.key_marker,
            limit: config.NC_LIFECYCLE_LIST_BATCH_SIZE
        });
        if (objects_list.is_truncated) {
            expire_state.key_marker = objects_list.next_marker;
            expire_state.is_finished = false;
        } else {
            expire_state.key_marker = undefined;
            expire_state.is_finished = true;
        }
        const bucket_state = this.lifecycle_run_status.buckets_statuses[bucket_json.name].state;
        bucket_state.num_processed_objects += objects_list.objects.length;
        return objects_list;
    }

    /**
     *
     * @param {*} lifecycle_rule
     * @param {Object} bucket_json
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<Object[]>}
     */
    async get_candidates_by_expiration_rule_posix(lifecycle_rule, bucket_json, object_sdk) {
        const rule_state = this._get_rule_state(bucket_json, lifecycle_rule).expire;
        if (rule_state.is_finished) return [];
        const expiration = this._get_expiration_time(lifecycle_rule.expiration);
        if (expiration < 0) return [];
        const filter_func = this._build_lifecycle_filter({filter: lifecycle_rule.filter, expiration});

        const filtered_objects = [];
        // TODO list_objects does not accept a filter and works in batch sizes of 1000. should handle batching
        // also should maybe create a helper function or add argument for a filter in list object
        const objects_list = await this.load_objects_list(object_sdk, lifecycle_rule, bucket_json, rule_state);
        objects_list.objects.forEach(obj => {
            const should_delete = lifecycle_utils.file_matches_filter({ obj_info: obj, filter_func });
            if (should_delete) {
                //need to delete latest. so remove version_id if exists
                const candidate = _.omit(obj, ['version_id']);
                filtered_objects.push(candidate);
            }
        });
        return filtered_objects;
    }

    /**
     * get_candidates_by_expiration_rule_gpfs does the following -
     * 1. gets the ilm candidates file path
     * 2. parses and returns the candidates from the files
     * @param {*} lifecycle_rule
     * @param {Object} bucket_json
     * @returns {Promise<Object[]>}
     */
    async get_candidates_by_expiration_rule_gpfs(lifecycle_rule, bucket_json) {
        const ilm_candidates_file_path = this.get_gpfs_ilm_candidates_file_path(bucket_json, lifecycle_rule);
        const parsed_candidates = await this.parse_candidates_from_gpfs_ilm_policy(bucket_json, lifecycle_rule, ilm_candidates_file_path);
        return parsed_candidates;
    }

    /**
     * check if delete candidate based on expired delete marker rule
     * @param {Object} object
     * @param {Object} next_object
     * @param {Function} filter_func
     * @returns
     */
    filter_expired_delete_marker(object, next_object, filter_func) {
        const lifecycle_info = lifecycle_utils.get_lifecycle_object_info_for_filter(object);
        if (!filter_func(lifecycle_info)) return false;
        return object.is_latest && object.delete_marker && object.key !== next_object.key;
    }

    /**
     * get_candidates_by_expiration_delete_marker_rule processes the expiration delete marker rule
     * @param {*} lifecycle_rule
     * @param {Object} bucket_json
     * @returns {Promise<Object[]>}
     */
    async get_candidates_by_expiration_delete_marker_rule(lifecycle_rule, bucket_json, object_sdk, params) {
        const rule_state = this._get_rule_state(bucket_json, lifecycle_rule).noncurrent;
        if (!params.versions_list) {
            if (rule_state.is_finished) return [];
            params.versions_list = await this.load_versions_list(object_sdk, lifecycle_rule, bucket_json, rule_state);
        }
        const versions_list = params.versions_list;
        const candidates = [];
        const expiration = lifecycle_rule.expiration?.days ? this._get_expiration_time(lifecycle_rule.expiration) : 0;
        const filter_func = this._build_lifecycle_filter({filter: lifecycle_rule.filter, expiration});
        for (let i = 0; i < versions_list.objects.length - 1; i++) {
            if (this.filter_expired_delete_marker(versions_list.objects[i], versions_list.objects[i + 1], filter_func)) {
                candidates.push(versions_list.objects[i]);
            }
        }
        const last_item = versions_list.objects.length > 0 && versions_list.objects[versions_list.objects.length - 1];
        const lifecycle_info = lifecycle_utils.get_lifecycle_object_info_for_filter(last_item);
        if (last_item.is_latest && last_item.delete_marker && filter_func(lifecycle_info)) {
            if (rule_state.is_finished) {
                candidates.push(last_item);
            } else {
                //need the next item to decide if we need to delete. start the next cycle from this key latest
                rule_state.key_marker_versioned = last_item.key;
                rule_state.version_id_marker = undefined;
            }
        }
        return candidates;
    }

    /////////////////////////////////////////////
    //////// NON CURRENT VERSION HELPERS ////////
    /////////////////////////////////////////////
    /**
     * load versions list batch and update state for the next cycle
     * @param {Object} object_sdk
     * @param {Object} lifecycle_rule
     * @param {Object} bucket_json
     * @param {Object} noncurrent_state
     * @returns
     */
    async load_versions_list(object_sdk, lifecycle_rule, bucket_json, noncurrent_state) {
        const list_versions = await object_sdk.list_object_versions({
            bucket: bucket_json.name,
            prefix: lifecycle_rule.filter?.prefix,
            limit: config.NC_LIFECYCLE_LIST_BATCH_SIZE,
            key_marker: noncurrent_state.key_marker_versioned,
            version_id_marker: noncurrent_state.version_id_marker
        });
        if (list_versions.is_truncated) {
            noncurrent_state.is_finished = false;
            noncurrent_state.key_marker_versioned = list_versions.next_marker;
            noncurrent_state.version_id_marker = list_versions.next_version_id_marker;
        } else {
            noncurrent_state.key_marker_versioned = undefined;
            noncurrent_state.version_id_marker = undefined;
            noncurrent_state.is_finished = true;
        }
        const bucket_state = this.lifecycle_run_status.buckets_statuses[bucket_json.name].state;
        bucket_state.num_processed_objects += list_versions.objects.length;
        return list_versions;
    }

    /**
     * check if object is delete candidate based on newer noncurrent versions rule
     * @param {nb.ObjectInfo} object_info
     * @param {Object} newer_noncurrent_state
     * @param {Number} num_newer_versions
     * @returns
     */
    filter_newer_versions(object_info, newer_noncurrent_state, num_newer_versions) {
        if (object_info.is_latest) {
            newer_noncurrent_state.version_count = 0; //latest
            newer_noncurrent_state.current_version = object_info.key;
            return false;
        }
        newer_noncurrent_state.version_count += 1;
        if (newer_noncurrent_state.version_count > num_newer_versions) {
            return true;
        }
        return false;
    }

    /**
     * check if object is delete candidate based on number of noncurrent days rule
     * @param {nb.ObjectInfo} object_info
     * @param {Number} num_non_current_days
     * @returns
     */
    filter_noncurrent_days(object_info, num_non_current_days) {
        if (object_info.is_latest) return false;
        const noncurrent_time = object_info.nc_noncurrent_time;
        return lifecycle_utils.get_file_age_days(noncurrent_time) >= num_non_current_days;
    }

    /**
     * get_candidates_by_noncurrent_version_expiration_rule processes the noncurrent version expiration rule
     * TODO:
     * POSIX - need to support both noncurrent_days and newer_noncurrent_versions
     * GPFS - implement noncurrent_days using GPFS ILM policy as an optimization
     * @param {Object} lifecycle_rule
     * @param {Object} bucket_json
     * @returns {Promise<Object[]>}
     */
    async get_candidates_by_noncurrent_version_expiration_rule(lifecycle_rule, bucket_json, object_sdk, params) {
        const rule_state = this._get_rule_state(bucket_json, lifecycle_rule).noncurrent;

        if (!params.versions_list) {
            if (rule_state.is_finished) return [];
            params.versions_list = await this.load_versions_list(object_sdk, lifecycle_rule, bucket_json, rule_state);
        }
        const versions_list = params.versions_list;

        const filter_func = this._build_lifecycle_filter({filter: lifecycle_rule.filter, expiration: 0});
        const num_newer_versions = lifecycle_rule.noncurrent_version_expiration.newer_noncurrent_versions;
        const num_non_current_days = lifecycle_rule.noncurrent_version_expiration.noncurrent_days;
        const delete_candidates = [];

        for (const entry of versions_list.objects) {
            const lifecycle_info = lifecycle_utils.get_lifecycle_object_info_for_filter(entry);
            if ((num_newer_versions === undefined || this.filter_newer_versions(entry, rule_state, num_newer_versions)) &&
                (num_non_current_days === undefined || this.filter_noncurrent_days(entry, num_non_current_days))) {
                    if (filter_func(lifecycle_info)) {
                        delete_candidates.push({key: entry.key, version_id: entry.version_id});
                    }
            }
        }
        return delete_candidates;
    }
    ////////////////////////////////////
    ///////// ABORT MPU HELPERS ////////
    ////////////////////////////////////

    /**
     * get_candidates_by_abort_incomplete_multipart_upload_rule processes the abort incomplete multipart upload rule
     * @param {*} lifecycle_rule
     * @param {Object} bucket_json
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<Object[]>}
     */
    async get_candidates_by_abort_incomplete_multipart_upload_rule(lifecycle_rule, bucket_json, object_sdk) {
        const nsfs = await object_sdk._get_bucket_namespace(bucket_json.name);
        const mpu_path = nsfs._mpu_root_path();
        const filter = lifecycle_rule.filter;
        const expiration = lifecycle_rule.abort_incomplete_multipart_upload.days_after_initiation;
        const res = [];

        const filter_func = this._build_lifecycle_filter({filter, expiration});
        let dir_handle;
        //TODO this is almost identical to list_uploads except for error handling and support for pagination. should modify list-upload and use it in here instead
        try {
            dir_handle = await nb_native().fs.opendir(this.fs_context, mpu_path);
        } catch (err) {
            if (err.code !== 'ENOENT') throw err;
            return;
        }
        for (;;) {
            try {
                const dir_entry = await dir_handle.read(this.fs_context);
                if (!dir_entry) break;
                const create_path = path.join(mpu_path, dir_entry.name, 'create_object_upload');
                const { data: create_params_buffer } = await nb_native().fs.readFile(this.fs_context, create_path);
                const create_params_parsed = JSON.parse(create_params_buffer.toString());
                const stat = await nb_native().fs.stat(this.fs_context, path.join(mpu_path, dir_entry.name));
                const object_lifecycle_info = this._get_lifecycle_object_info_for_mpu(create_params_parsed, stat);
                if (filter_func(object_lifecycle_info)) {
                    res.push({ obj_id: dir_entry.name, key: create_params_parsed.key, bucket: bucket_json.name});
                }
            } catch (err) {
                if (err.code !== 'ENOENT' || err.code !== 'ENOTDIR') throw err;
            }
        }
        await dir_handle.close(this.fs_context);
        dir_handle = null;
        return res;
    }

    /**
     * @param {Object} create_params_parsed
     * @param {nb.NativeFSStats} stat
     */
    _get_lifecycle_object_info_for_mpu(create_params_parsed, stat) {
        return {
            key: create_params_parsed.key,
            age: lifecycle_utils.get_file_age_days(stat.mtime.getTime()),
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
    _build_lifecycle_filter(params) {
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
     * get the expiration time in days of an object
     * if rule is set with date, then rule is applied for all objects after that date
     * return -1 to indicate that the date hasn't arrived, so rule should not be applied
     * return 0 in case date has arrived so expiration is true for all elements
     * return days in case days was defined and not date
     * @param {Object} expiration_rule
     * @returns {Number}
     */
    _get_expiration_time(expiration_rule) {
        if (expiration_rule.date) {
            const expiration_date = new Date(expiration_rule.date).getTime();
            if (Date.now() < expiration_date) return -1;
            return 0;
        } else if (expiration_rule.days) {
            return expiration_rule.days;
        } else {
            //expiration delete marker rule
            return -1;
        }
    }

    ////////////////////////////////
    //////// STATUS HELPERS ////////
    ////////////////////////////////

    /**
     * _call_op_and_update_status calls the op and report time and error to the lifecycle status.
     *
     * @template T
     * @param {{
    *      op_name: string;
    *      op_func: () => Promise<T>;
    *      mount_point?: string,
    *      bucket_name?: string,
    *      rule_id?: string
    * }} params
    * @returns {Promise<T>}
    */
    async _call_op_and_update_status({ mount_point = undefined, bucket_name = undefined, rule_id = undefined, op_name, op_func }) {
        const start_time = Date.now();
        const update_options = { mount_point, op_name, bucket_name, rule_id };
        let end_time;
        let took_ms;
        let error;
        let reply;
        try {
            if (!this.return_short_status) this.update_status({ ...update_options, op_times: { start_time } });
            reply = await op_func();
            return reply;
        } catch (e) {
            error = e;
            throw e;
        } finally {
            end_time = Date.now();
            took_ms = end_time - start_time;
            const op_times = this.return_short_status ? { took_ms } : { end_time, took_ms };
            this.update_status({ ...update_options, op_times, reply, error });
        }
    }

    /**
     * update_status updates rule/bucket/mount_point/global based on the given parameters
     * 1. initalize statuses/times/stats per level
     * 2. update times
     * 3. update errors
     * 4. update stats if the op is at rule level
     * Note - on mount_point we won't update stats/state
     * @param {{
     * op_name: string,
     * mount_point?: string, 
     * bucket_name?: string,
     * rule_id?: string,
     * op_times: { start_time?: number, end_time?: number, took_ms?: number },
     * reply?: Object[],
     * error?: Error}
     * } params
     * @returns {Void}
    */
    update_status({ mount_point, bucket_name, rule_id, op_name, op_times, reply = [], error = undefined }) {
        if (op_times.start_time) {
            if (op_name === TIMED_OPS.PROCESS_RULE) {
                this.init_rule_status(bucket_name, rule_id);
            } else if (op_name === TIMED_OPS.PROCESS_BUCKET) {
                this.init_bucket_status(bucket_name);
            } else if (op_name === TIMED_OPS.CREATE_GPFS_CANDIDATE_FILE_BY_ILM_POLICY) {
                this.init_mount_status(mount_point);
            }
        }
        if (op_times.end_time) {
            if (op_name === TIMED_OPS.PROCESS_RULE) {
                this.update_rule_status_is_finished(bucket_name, rule_id);
            }
        }
        this._update_times_on_status({ op_name, op_times, mount_point, bucket_name, rule_id });
        this._update_error_on_status({ error, mount_point, bucket_name, rule_id });
        if (bucket_name && rule_id) {
            this.update_stats_on_status({ bucket_name, rule_id, op_name, op_times, reply });
        }
    }

    /**
     * _calc_stats accumulates stats for global/bucket stats
     * @param {Object} stats_acc
     * @param {Object} [cur_op_stats]
     * @returns {Object}
     */
    _acc_stats(stats_acc, cur_op_stats = {}) {
        const stats_res = stats_acc;

        for (const [stat_key, stat_value] of Object.entries(cur_op_stats)) {
            if (typeof stat_value === 'number') {
                if (stats_res[stat_key]) stats_res[stat_key] += stat_value;
                else stats_res[stat_key] = stat_value;
            }
            if (Array.isArray(stat_value)) {
                if (stats_res[stat_key]) stats_res[stat_key].concat(stat_value);
                else stats_res[stat_key] = stat_value;
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
    update_stats_on_status({ bucket_name, rule_id, op_name, op_times, reply = [] }) {
        if (op_times.end_time === undefined || ![TIMED_OPS.DELETE_MULTIPLE_OBJECTS, TIMED_OPS.ABORT_MPUS].includes(op_name)) return;

        const rule_stats_acc = this.lifecycle_run_status.buckets_statuses[bucket_name].rules_statuses[rule_id].rule_stats ||
            this._get_default_stats();
        const bucket_stats_acc = this.lifecycle_run_status.buckets_statuses[bucket_name].bucket_stats || this._get_default_stats();
        const lifecycle_stats_acc = this.lifecycle_run_status.total_stats || this._get_default_stats();

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
        this.lifecycle_run_status.buckets_statuses[bucket_name].rules_statuses[rule_id].rule_stats = this._acc_stats(
            rule_stats_acc, cur_op_stats);
        this.lifecycle_run_status.buckets_statuses[bucket_name].bucket_stats = this._acc_stats(
            bucket_stats_acc, cur_op_stats);
        this.lifecycle_run_status.total_stats = this._acc_stats(lifecycle_stats_acc, cur_op_stats);
    }

    /**
     * _update_times_on_status updates start/end & took times in lifecycle status
     * @param {{op_name: String, op_times: {start_time?: number, end_time?: number, took_ms?: number },
     * mount_point?: String, bucket_name?: String, rule_id?: String}} params
     * @returns
     */
    _update_times_on_status({ op_name, op_times, mount_point = undefined, bucket_name = undefined, rule_id = undefined }) {
        for (const [key, value] of Object.entries(op_times)) {
            const status_key = op_name + '_' + key;
            if (bucket_name && rule_id) {
                this.lifecycle_run_status.buckets_statuses[bucket_name].rules_statuses[rule_id].rule_process_times[status_key] = value;
            } else if (bucket_name) {
                this.lifecycle_run_status.buckets_statuses[bucket_name].bucket_process_times[status_key] = value;
            } else if (mount_point) {
                this.lifecycle_run_status.mount_points_statuses[mount_point].mount_point_process_times[status_key] = value;
            } else {
                this.lifecycle_run_status.lifecycle_run_times[status_key] = value;
            }
        }
    }

    /**
     * _update_error_on_status updates an error occured in lifecycle status
     * @param {{error: Error, mount_point?: string, bucket_name?: string, rule_id?: string}} params
     * @returns
     */
    _update_error_on_status({ error, mount_point = undefined, bucket_name = undefined, rule_id = undefined }) {
        if (!error) return;
        if (bucket_name && rule_id) {
            (this.lifecycle_run_status.buckets_statuses[bucket_name].rules_statuses[rule_id].errors ??= []).push(error.message);
        } else if (bucket_name) {
            (this.lifecycle_run_status.buckets_statuses[bucket_name].errors ??= []).push(error.message);
        } else if (mount_point) {
            (this.lifecycle_run_status.mount_points_statuses[mount_point].errors ??= []).push(error.message);
        } else {
            (this.lifecycle_run_status.errors ??= []).push(error.message);
        }
    }

    _get_default_stats() {
        return {
            num_objects_deleted: 0, num_objects_delete_failed: 0, objects_delete_errors: [],
            num_mpu_aborted: 0, num_mpu_abort_failed: 0, mpu_abort_errors: []
        };
    }

    /**
     * write_lifecycle_log_file writes the lifecycle log file to the lifecycle logs directory
     * @returns {Promise<Void>}
     */
    async write_lifecycle_log_file() {
        const log_file_name = `lifecycle_run_${this.lifecycle_run_status.lifecycle_run_times.run_lifecycle_start_time}.json`;
        await nb_native().fs.writeFile(
            this.fs_context,
            path.join(this.lifecyle_logs_dir_path, log_file_name),
            Buffer.from(JSON.stringify(this.lifecycle_run_status)),
            { mode: native_fs_utils.get_umasked_mode(config.BASE_MODE_FILE) }
        );
    }

    /**
     * init the bucket status object statuses if they don't exist
     * @param {string} bucket_name
     * @returns {Object} created or existing bucket status
     */
    init_bucket_status(bucket_name) {
        this.lifecycle_run_status.buckets_statuses[bucket_name] ??= {};
        this.lifecycle_run_status.buckets_statuses[bucket_name].bucket_process_times ??= {};
        this.lifecycle_run_status.buckets_statuses[bucket_name].bucket_stats ??= {};
        this.lifecycle_run_status.buckets_statuses[bucket_name].state ??= {};
        this.lifecycle_run_status.buckets_statuses[bucket_name].rules_statuses ??= {};
        return this.lifecycle_run_status.buckets_statuses[bucket_name];
    }

    /**
     * init the mount_point status object statuses if they don't exist
     * @param {string} mount_point
     * @returns {Object} created or existing mount_point status
     */
    init_mount_status(mount_point) {
        this.lifecycle_run_status.mount_points_statuses[mount_point] ??= {};
        this.lifecycle_run_status.mount_points_statuses[mount_point].mount_point_process_times ??= {};
        return this.lifecycle_run_status.mount_points_statuses[mount_point];
    }


    /**
     * init the rule status object statuses if they don't exist
     * @param {string} bucket_name
     * @param {string} rule_id
     * @returns {Object} created or existing rule status
     */
    init_rule_status(bucket_name, rule_id) {
        this.lifecycle_run_status.buckets_statuses[bucket_name].rules_statuses[rule_id] ??= {};
        this.lifecycle_run_status.buckets_statuses[bucket_name].rules_statuses[rule_id].state ??= { expire: {}, noncurrent: {} };
        this.lifecycle_run_status.buckets_statuses[bucket_name].rules_statuses[rule_id].rule_process_times = {};
        this.lifecycle_run_status.buckets_statuses[bucket_name].rules_statuses[rule_id].rule_stats ??= {};
        return this.lifecycle_run_status.buckets_statuses[bucket_name].rules_statuses[rule_id];
    }

    /**
     * update_rule_status_is_finished updates the rule state if all actions finished
     * notice that expire and noncurrent properties are initiated in init_rule_status()
     * therefore they should not be undefined
     * @param {string} bucket_name
     * @param {string} rule_id
     * @returns {Void}
     */
    update_rule_status_is_finished(bucket_name, rule_id) {
        const rule_state = this._get_rule_state({ name: bucket_name }, { id: rule_id });
        rule_state.is_finished = (rule_state.expire.is_finished === undefined || rule_state.expire.is_finished === true) &&
            (rule_state.noncurrent.is_finished === undefined || rule_state.noncurrent.is_finished === true);
    }

    /**
     *
     * @param {Object[]} buckets
     * @returns
     */
    async load_previous_run_state(buckets) {
        const previous_run = await lifecycle_utils.get_latest_nc_lifecycle_run_status(this.config_fs, { silent_if_missing: true });
        if (previous_run) {
            this.lifecycle_run_status.state = previous_run.state;
            for (const [bucket_name, prev_bucket_status] of Object.entries(previous_run.buckets_statuses)) {
                if (!buckets.includes(bucket_name)) continue;
                const bucket_json = await this.config_fs.get_bucket_by_name(bucket_name, config_fs_options);
                if (!bucket_json.lifecycle_configuration_rules) continue;
                const bucket_status = this.init_bucket_status(bucket_name);
                bucket_status.state = prev_bucket_status.state;
                const bucket_rules = bucket_json.lifecycle_configuration_rules.map(rule => rule.id);
                for (const [rule_id, prev_rule_status] of Object.entries(prev_bucket_status.rules_statuses)) {
                    if (!bucket_rules.includes(rule_id)) return;
                    const rule_status = this.init_rule_status(bucket_name, rule_id);
                    rule_status.state = prev_rule_status.state;
                }
            }
        }
    }

    /**
     * _set_rule_state sets the current rule state on the lifecycle run status
     * @param {Object} bucket_json
     * @param {*} lifecycle_rule
     * @param {RuleState} rule_state
     * @returns {Void}
     */
    _set_rule_state(bucket_json, lifecycle_rule, rule_state) {
        const existing_state = this._get_rule_state(bucket_json, lifecycle_rule);
        const new_state = { ...existing_state, ...rule_state };
        this.lifecycle_run_status.buckets_statuses[bucket_json.name].rules_statuses[lifecycle_rule.id].state = new_state;
    }

    /**
     * _get_rule_state gets the current rule state on the lifecycle run status
     * @param {Object} bucket_json
     * @param {*} lifecycle_rule
     * @returns {RuleState}
     */
    _get_rule_state(bucket_json, lifecycle_rule) {
        return this.lifecycle_run_status.buckets_statuses[bucket_json.name].rules_statuses[lifecycle_rule.id].state;
    }

    /////////////////////////////////
    ////// NOTIFICATION HELPERS /////
    /////////////////////////////////

    /**
     *
     * @param {Object} delete_res
     * @param {Object} delete_obj_info
     * @returns
     */
    create_notification_delete_object(delete_res, delete_obj_info) {
        return {
            ...delete_obj_info,
            created_delete_marker: delete_res.created_delete_marker,
            version_id: delete_res.created_delete_marker ? delete_res.created_version_id : delete_obj_info.version_id,
        };
    }

    /**
     *
     * @param {Object[]} delete_res array of delete results
     * @param {Object[]} delete_candidates array of delete candidates object info
     * @param {Object} bucket_json
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<Void>}
     * NOTE implementation assumes delete_candidates and delete_res uses the same index. this assumption is also made in
     * s3_post_bucket_delete.js.
     */
    async send_lifecycle_notifications(delete_res, delete_candidates, bucket_json, object_sdk) {
        const writes = [];
        for (let i = 0; i < delete_res.length; ++i) {
            if (delete_res[i].err_code) continue;
            for (const notif of bucket_json.notifications) {
                if (notifications_util.check_notif_relevant(notif, {
                    op_name: 'lifecycle_delete',
                    s3_event_method: delete_res[i].created_delete_marker ? 'DeleteMarkerCreated' : 'Delete',
                })) {
                    const deleted_obj = this.create_notification_delete_object(delete_res[i], delete_candidates[i]);
                    //remember that this deletion needs a notif for this specific notification conf
                    writes.push({notif, deleted_obj});
                }
            }
        }

        //required format by compose_notification_lifecycle
        bucket_json.bucket_owner = new SensitiveString(object_sdk.requesting_account.name);

        //if any notifications are needed, write them in notification log file
        //(otherwise don't do any unnecessary filesystem actions)
        if (writes.length > 0) {
            let logger;
            try {
                logger = notifications_util.get_notification_logger('SHARED');
                await P.map_with_concurrency(100, writes, async write => {
                    const notif = notifications_util.compose_notification_lifecycle(write.deleted_obj, write.notif,
                        bucket_json, object_sdk);
                    await logger.append(JSON.stringify(notif));
                });
            } finally {
                if (logger) await logger.close();
            }
        }
    }

    ////////////////////////////////////////////
    // GPFS ILM POLICIES OPTIMIZATION HELPERS //
    ////////////////////////////////////////////

    /**
     * _should_use_gpfs_optimization returns true is gpfs optimization should be used
     * @returns {Boolean}
     */
    _should_use_gpfs_optimization() {
        const is_gpfs = nb_native().fs.gpfs;
        return is_gpfs && config.NC_LIFECYCLE_GPFS_ILM_ENABLED;
    }

    /**
     * get_mount_points returns a map of the following format -
     * { mount_point_path1: {}, mount_point_path2: {} }
     * @returns {Promise<Object>}
     */
    async get_mount_points_map() {
        try {
            const binary_file_path = get_bin_path(config.NC_GPFS_BIN_DIR, GPFS_EXTERNAL_BINS.MMLSFS);
            const command = `${binary_file_path} all -T -Y`;
            const fs_list = await os_utils.exec(command, { return_stdout: true });
            dbg.log2('get_mount_points fs_list res ', fs_list);
            const lines = fs_list.trim().split('\n');
            const res = {};

            for (let idx = 1; idx < lines.length; idx++) {
                const line = lines[idx];
                const parts = line.split(':');
                const mount_name = decodeURIComponent(parts[8]);
                res[mount_name] = '';
            }
            return res;
        } catch (err) {
            throw new Error(`get_mount_points failed with error ${err}`);
        }
    }

    /**
     * find_mount_point_by_bucket_path finds the mount point of a given bucket path
     * @param {Object} mount_point_to_policy_map
     * @param {String} bucket_path
     * @returns {String}
     */
    find_mount_point_by_bucket_path(mount_point_to_policy_map, bucket_path) {
        const sorted_mounts = Object.keys(mount_point_to_policy_map).sort((a, b) => b.length - a.length);
        dbg.log2(`find_mount_point_by_bucket_path bucket_path=${bucket_path} mount_point_path=${util.inspect(mount_point_to_policy_map)}`);
        for (const mount_point_path of sorted_mounts) {
            if (bucket_path === mount_point_path || bucket_path.startsWith(mount_point_path + '/')) {
              return mount_point_path;
            }
        }
        throw new Error(`can not find mount path of bucket in the mount lists ${bucket_path}, ${util.inspect(mount_point_to_policy_map)}`);
    }

    /**
     * create_gpfs_candidates_files creates a candidates file per mount point that is used by at least one bucket
     * 1. creates a map of mount point to buckets
     * 2. for each bucket -
     * 2.1. finds the mount point it belongs to
     * 2.2. convert the bucket's lifecycle policy to a GPFS ILM policy
     * 2.3. concat the bucket's GPFS ILM policy to the mount point policy file string
     * 3. for each mount point -
     * 3.1. writes the ILM policy to a tmp file
     * 3. creates the candidates file by applying the ILM policy
     * @param {String[]} bucket_names
     * @returns {Promise<Void>}
     */
    async create_gpfs_candidates_files(bucket_names) {
        const mount_point_to_policy_map = await this.get_mount_points_map();
        for (const bucket_name of bucket_names) {
            const bucket_json = await this.config_fs.get_bucket_by_name(bucket_name, config_fs_options);
            const bucket_mount_point = this.find_mount_point_by_bucket_path(mount_point_to_policy_map, bucket_json.path);
            this.bucket_to_mount_point_map[bucket_name] = bucket_mount_point;
            if (!bucket_json.lifecycle_configuration_rules?.length) continue;

            for (const lifecycle_rule of bucket_json.lifecycle_configuration_rules) {
                // currently we support expiration (current version) only
                if (lifecycle_rule.expiration) {
                    const should_expire = this._get_expiration_time(lifecycle_rule.expiration) >= 0;
                    if (!should_expire) continue;
                    const ilm_rule = this.convert_lifecycle_policy_to_gpfs_ilm_policy(lifecycle_rule, bucket_json);
                    mount_point_to_policy_map[bucket_mount_point] += ilm_rule + '\n';
                }
            }
        }

        await native_fs_utils._create_path(ILM_POLICIES_TMP_DIR, this.non_gpfs_fs_context, config.BASE_MODE_CONFIG_DIR);
        await native_fs_utils._create_path(ILM_CANDIDATES_TMP_DIR, this.non_gpfs_fs_context, config.BASE_MODE_CONFIG_DIR);
        await P.map_with_concurrency(config.NC_LIFECYCLE_GPFS_MMAPPLY_ILM_POLICY_CONCURRENCY,
            Object.entries(mount_point_to_policy_map), async ([mount_point, policy]) => {
            try {
                if (policy === '') return;
                await this._call_op_and_update_status({
                    mount_point,
                    op_name: TIMED_OPS.CREATE_GPFS_CANDIDATE_FILE_BY_ILM_POLICY,
                    op_func: async () => {
                        const ilm_policy_path = await this.write_tmp_ilm_policy(mount_point, policy);
                        await this.create_candidates_file_by_gpfs_ilm_policy(mount_point, ilm_policy_path);
                    }
                });
            } catch (err) {
                dbg.error('create_candidates_file_by_gpfs_ilm_policy failed with error', err, err.code, err.message);
            }
        });
    }

    /**
     * convert_lifecycle_policy_to_gpfs_ilm_policy converts the lifecycle rule to GPFS ILM policy
     * currently we support expiration (current version) only
     * TODO - implement gpfs optimization for non_current_days -
     * non current can't be on the same policy, when implementing non current we should split the policies
     * @param {*} lifecycle_rule
     * @param {Object} bucket_json
     * @returns {String}
     */
    convert_lifecycle_policy_to_gpfs_ilm_policy(lifecycle_rule, bucket_json) {
        const bucket_path = bucket_json.path;
        const bucket_rule_id = this.get_lifecycle_ilm_candidate_file_suffix(bucket_json.name, lifecycle_rule);
        const escaped_bucket_path = this._escape_like_clause_ilm_policy(bucket_path);
        const in_bucket_path = path.join(escaped_bucket_path, '/%');
        const in_bucket_internal_dir = path.join(escaped_bucket_path, `/${config.NSFS_TEMP_DIR_NAME}%/%`);
        const in_versions_dir = path.join(escaped_bucket_path, '/.versions/%');
        const in_nested_versions_dir = path.join(escaped_bucket_path, '/%/.versions/%');
        const ilm_policy_helpers = { bucket_rule_id, in_bucket_path, in_bucket_internal_dir, in_versions_dir, in_nested_versions_dir };

        const policy_base = this._get_gpfs_ilm_policy_base(ilm_policy_helpers);
        const expiry_string = this.convert_expiry_rule_to_gpfs_ilm_policy(lifecycle_rule, ilm_policy_helpers);
        const non_current_days_string = this.convert_noncurrent_version_by_days_to_gpfs_ilm_policy(lifecycle_rule, ilm_policy_helpers);
        const filter_policy = this.convert_filter_to_gpfs_ilm_policy(lifecycle_rule, escaped_bucket_path);
        return policy_base + non_current_days_string + expiry_string + filter_policy;
    }

    /**
     * _get_gpfs_ilm_policy_base returns policy base definitions and bucket path phrase
     * @param {{bucket_rule_id: String, in_bucket_path: String, in_bucket_internal_dir: String}} ilm_policy_helpers
     * @returns {String}
     */
    _get_gpfs_ilm_policy_base(ilm_policy_helpers) {
        const { bucket_rule_id, in_bucket_path, in_bucket_internal_dir } = ilm_policy_helpers;
        const mod_age_definition = `define( mod_age, (DAYS(CURRENT_TIMESTAMP) - DAYS(MODIFICATION_TIME)) )\n`;
        const change_age_definition = `define( change_age, (DAYS(CURRENT_TIMESTAMP) - DAYS(CHANGE_TIME)) )\n`;
        const rule_id_definition = `RULE '${bucket_rule_id}' LIST '${bucket_rule_id}'\n`;
        const policy_path_base = `WHERE PATH_NAME LIKE '${in_bucket_path}' ${escape_backslash_str}\n` +
            `AND PATH_NAME NOT LIKE '${in_bucket_internal_dir}' ${escape_backslash_str}\n`;

        return mod_age_definition + change_age_definition + rule_id_definition + policy_path_base;
    }

    /**
     * escape_like_clause_ilm_policy escapes the \ _ % and ' characters in the ILM policy string
     * this is needed because GPFS ILM policies use _ and % as wildcards
     * and we need to escape them to use them as normal characters
     * since we are escaping using backslash we also need to escape the backslash itself
     * IMPORTANT - escaping of the backslash must be done before escaping of the underscore and percentage
     * @param {String} ilm_policy_string 
     * @returns String 
     */
    _escape_like_clause_ilm_policy(ilm_policy_string) {
        return ilm_policy_string
            .replace(backslash_regex, '\\\\')
            .replace(underscore_wildcard_regex, '\\_')
            .replace(precentage_wildcard_regex, '\\%')
            .replace(single_quote_regex, `''`);
    }

    /**
     * convert_expiry_rule_to_gpfs_ilm_policy converts the expiry rule to GPFS ILM policy
     * expiration rule works on latest version path (not inside .versions or in nested .versions)
     * @param {*} lifecycle_rule
     * @param {{in_versions_dir: String, in_nested_versions_dir: String}} ilm_policy_paths
     * @returns {String}
     */
    convert_expiry_rule_to_gpfs_ilm_policy(lifecycle_rule, { in_versions_dir, in_nested_versions_dir }) {
        const { expiration = undefined } = lifecycle_rule;
        if (!expiration) return '';
        const current_path_policy = `AND PATH_NAME NOT LIKE '${in_versions_dir}' ${escape_backslash_str}\n` +
            `AND PATH_NAME NOT LIKE '${in_nested_versions_dir}' ${escape_backslash_str}\n`;

        const expiry_policy = expiration.days ? `AND mod_age > ${expiration.days}\n` : '';
        return current_path_policy + expiry_policy;
    }

    /**
     * convert_noncurrent_version_to_gpfs_ilm_policy converts the noncurrent version by days to GPFS ILM policy
     * @param {*} lifecycle_rule
     * @param {{in_versions_dir: String, in_nested_versions_dir: String}} ilm_policy_paths
     * @returns {String}
     */
    convert_noncurrent_version_by_days_to_gpfs_ilm_policy(lifecycle_rule, { in_versions_dir, in_nested_versions_dir }) {
        return '';
        // TODO - add implementation
    }

    /**
     * convert_filter_to_gpfs_ilm_policy converts the filter to GPFS ILM policy
     * @param {*} lifecycle_rule
     * @param {String} escaped_bucket_path
     * @returns {String}
     */
    convert_filter_to_gpfs_ilm_policy(lifecycle_rule, escaped_bucket_path) {
        const { prefix = undefined, filter = {} } = lifecycle_rule;
        let filter_policy = '';
        if (prefix || Object.keys(filter).length > 0) {
            const { object_size_greater_than = undefined, object_size_less_than = undefined, tags = undefined } = filter;
            const rule_prefix = prefix || filter.prefix;
            const escaped_prefix = this._escape_like_clause_ilm_policy(rule_prefix || '');
            filter_policy += rule_prefix ? `AND PATH_NAME LIKE '${path.join(escaped_bucket_path, escaped_prefix)}%' ${escape_backslash_str}\n` : '';
            filter_policy += object_size_greater_than === undefined ? '' : `AND FILE_SIZE > ${object_size_greater_than}\n`;
            filter_policy += object_size_less_than === undefined ? '' : `AND FILE_SIZE < ${object_size_less_than}\n`;
            filter_policy += tags ? tags.map(tag => {
                const escaped_tag_value = this._escape_like_clause_ilm_policy(tag.value);
                return `AND XATTR('user.noobaa.tag.${tag.key}') LIKE '${escaped_tag_value}' ${escape_backslash_str}\n`;
            }).join('') : '';
        }
        return filter_policy;
    }

    /**
     * get_lifecycle_ilm_candidates_file_name gets the ILM policy file name
     * @param {String} bucket_name
     * @param {*} lifecycle_rule
     * @returns {String}
     */
    get_lifecycle_ilm_candidates_file_name(bucket_name, lifecycle_rule) {
        const lifecycle_ilm_candidates_file_suffix = this.get_lifecycle_ilm_candidate_file_suffix(bucket_name, lifecycle_rule);
        return `list.${lifecycle_ilm_candidates_file_suffix}`;
    }

    /**
     * get_lifecycle_ilm_candidate_file_suffix returns the suffix of a candidates file based on bucket name, rule id and lifecycle run start
     * TODO - when noncurrent_version is supported, suffix should contain expiration/non_current_version_expiration rule type
     * @param {String} bucket_name
     * @param {*} lifecycle_rule
     * @returns {String}
     */
    get_lifecycle_ilm_candidate_file_suffix(bucket_name, lifecycle_rule) {
        const rule_id = lifecycle_rule.id;
        return `${bucket_name}_${rule_id}_${this.lifecycle_run_status.lifecycle_run_times.run_lifecycle_start_time}`;
    }

    /**
     * write_tmp_ilm_policy writes the ILM policy string to a tmp file
     * TODO - delete the policy on restart and on is_finished of the rule
     * TODO - should we unlink the policy file if the file already exists? - might be dangerous
     * @param {String} mount_point_path
     * @param {String} ilm_policy_string
     * @returns {Promise<String>}
     */
    async write_tmp_ilm_policy(mount_point_path, ilm_policy_string) {
        try {
            const ilm_policy_tmp_path = this.get_gpfs_ilm_policy_file_path(mount_point_path);
            const ilm_policy_stat = await native_fs_utils.stat_ignore_enoent(this.non_gpfs_fs_context, ilm_policy_tmp_path);
            if (ilm_policy_stat) {
                dbg.log2('write_tmp_ilm_policy: policy already exists, ', ilm_policy_tmp_path);
            } else {
                // TODO - maybe we should write to tmp file and then link so we won't override the file
                await nb_native().fs.writeFile(
                    this.non_gpfs_fs_context,
                    ilm_policy_tmp_path,
                    Buffer.from(ilm_policy_string), {
                    mode: native_fs_utils.get_umasked_mode(config.BASE_MODE_FILE),
                },
                );
            }
            return ilm_policy_tmp_path;
        } catch (err) {
            throw new Error(`write_tmp_ilm_policy failed with error ${err}`);
        }
    }

    /**
     * lifecycle_ilm_policy_path returns ilm policy file path based on bucket name and rule_id
     * @param {String} mount_point_path
     * @returns {String}
     */
    get_gpfs_ilm_policy_file_path(mount_point_path) {
        const encoded_mount_point_path = encodeURIComponent(mount_point_path);
        const lifecycle_ilm_policy_path = path.join(ILM_POLICIES_TMP_DIR, `noobaa_ilm_policy_${encoded_mount_point_path}_${this.lifecycle_run_status.lifecycle_run_times.run_lifecycle_start_time}`);
        return lifecycle_ilm_policy_path;
    }

     /**
     * get_gpfs_ilm_candidates_file_path returns ilm policy file path based on bucket name and rule_id
     * @param {*} bucket_json
     * @param {*} lifecycle_rule
     * @returns {String}
     */
     get_gpfs_ilm_candidates_file_path(bucket_json, lifecycle_rule) {
        const ilm_candidates_file_name = this.get_lifecycle_ilm_candidates_file_name(bucket_json.name, lifecycle_rule);
        const ilm_candidates_file_path = path.join(ILM_CANDIDATES_TMP_DIR, ilm_candidates_file_name);
        return ilm_candidates_file_path;
    }

    /**
     * create_candidates_file_by_gpfs_ilm_policy gets the candidates by applying the ILM policy using mmapplypolicy
     * the return value is a path to the output file that contains the candidates
     * @param {String} mount_point_path
     * @param {String} ilm_policy_tmp_path
     * @returns {Promise<Void>}
     */
    async create_candidates_file_by_gpfs_ilm_policy(mount_point_path, ilm_policy_tmp_path) {
        try {
            const binary_file_path = get_bin_path(config.NC_GPFS_BIN_DIR, GPFS_EXTERNAL_BINS.MMAPPLYPOLICY);
            const allow_scan_on_remote = config.NC_LIFECYCLE_GPFS_ALLOW_SCAN_ON_REMOTE ? '--allow-scan-on-remote' : '';
            const command = `${binary_file_path} ${mount_point_path} -P ${ilm_policy_tmp_path} ${allow_scan_on_remote} -f ${ILM_CANDIDATES_TMP_DIR} -I defer `;
            const mmapply_policy_res = await os_utils.exec(command, { return_stdout: true });
            dbg.log2('create_candidates_file_by_gpfs_ilm_policy mmapplypolicy res ', mmapply_policy_res);
        } catch (err) {
            throw new Error(`create_candidates_file_by_gpfs_ilm_policy failed with error ${err}`);
        }
    }

    /**
     * parse_candidates_from_gpfs_ilm_policy does the following -
     * 1. reads the candidates file line by line (Note - we set read_file_offset so we will read the file from the line we stopped last iteration)-
     * 1.1. if number of parsed candidates is above the batch size - break the loop and stop reading the candidates file
     * 1.2. else -
     * 1.2.1. update the new rule state
     * 1.2.2. parse the key from the candidate line
     * 1.2.3. push the key to the candidates array
     * 2. if candidates file does not exist, we return without error because it's valid that no candidates found
     * GAP - when supporting noncurrent rule, we should update the state type to noncurrent based on the candidates file path
     * @param {Object} bucket_json
     * @param {*} lifecycle_rule
     * @param {String} rule_candidates_path
     * @returns {Promise<Object[]>} parsed_candidates_array
     */
    async parse_candidates_from_gpfs_ilm_policy(bucket_json, lifecycle_rule, rule_candidates_path) {
        let reader;
        const state_type = 'expire';
        const rule_state = this._get_rule_state(bucket_json, lifecycle_rule)?.[state_type];
        dbg.log2(`parse_candidates_from_gpfs_ilm_policy rule_state=${rule_state} state_type=${state_type}, currently on gpfs ilm flow - we support only expiration rule`);
        if (rule_state?.is_finished) return [];
        const finished_state = { [state_type]: { is_finished: true, candidates_file_offset: undefined } };

        try {
            dbg.log2(`parse_candidates_from_gpfs_ilm_policy bucket_name=${bucket_json.name}, rule_id ${lifecycle_rule.id}, existing rule_state=${util.inspect(rule_state)}`);
            const parsed_candidates_array = [];
            reader = new NewlineReader(this.non_gpfs_fs_context, rule_candidates_path, { lock: 'SHARED', read_file_offset: rule_state?.candidates_file_offset || 0 });

            const [count, is_finished] = await reader.forEachFilePathEntry(async entry => {
                if (parsed_candidates_array.length >= config.NC_LIFECYCLE_LIST_BATCH_SIZE) return false;
                const cur_rule_state = { [state_type]: { is_finished: false, candidates_file_offset: reader.next_line_file_offset } };
                this._set_rule_state(bucket_json, lifecycle_rule, cur_rule_state);
                const key = this._parse_key_from_line(entry, bucket_json);
                // TODO - need to add etag, size, version_id
                parsed_candidates_array.push({ key });
                dbg.log2(`parse_candidates_from_gpfs_ilm_policy: file_key=${key}, entry_path=${entry.path}, reader.next_line_file_offset=${reader.next_line_file_offset}, rule_state=${rule_state}`);
                return true;
            });

            if (is_finished) {
                this._set_rule_state(bucket_json, lifecycle_rule, finished_state);
            }
            dbg.log2(`parse_candidates_from_gpfs_ilm_policy: parsed_candidates_array ${util.inspect(parsed_candidates_array)}, rule_state=${util.inspect(rule_state)}, count=${count} is_finished=${is_finished}`);
            return parsed_candidates_array;
        } catch (err) {
            if (err.code === 'ENOENT') {
                dbg.log2(`parse_candidates_from_gpfs_ilm_policy ilm_candidates_file_exists does not exist, no candidates to delete`);
                this._set_rule_state(bucket_json, lifecycle_rule, finished_state);
                return [];
            }
            dbg.error('parse_candidates_from_gpfs_ilm_policy: error', err);
            throw err;
        } finally {
            if (reader) await reader.close();
        }
    }

    /**
     * _parse_key_from_line parses the object key from a candidate line
     * candidate line (when using mmapplypolicy defer) is of the following format -
     * example -
     * 17460 1316236366 0   -- /mnt/gpfs0/account1_new_buckets_path/bucket1_storage/key1.txt
     * if file is .folder (directory object) we need to return its parent directory
     * Notice that trim() is not used here because if used will remove whitespaces from the end of the line and might delete 
     * spaces at the end of the file name that might be part of the file name, file reader should trim the line before passing it to this function
     * @param {Object} entry - entry from the candidates file
     * @param {Object} bucket_json
     */
    _parse_key_from_line(entry, bucket_json) {
        dbg.log1(`_parse_key_from_line entry=${util.inspect(entry)}, bucket_json=${util.inspect(bucket_json)}`);
        const path_start_index = entry.path.indexOf(bucket_json.path);
        const file_path = entry.path.slice(path_start_index);
        let file_key = file_path.replace(path.join(bucket_json.path, '/'), '');
        const basename = path.basename(file_key);
        if (basename.startsWith(config.NSFS_FOLDER_OBJECT_NAME)) {
            file_key = path.join(path.dirname(file_key), '/');
        }
        dbg.log1(`_parse_key_from_line file_path=${util.inspect(file_path)}, file_key=${util.inspect(file_key)}`);
        return file_key;
    }
}

//////////////////
// TAGS HELPERS //
//////////////////

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

// EXPORTS
exports.NCLifecycle = NCLifecycle;
exports.ILM_POLICIES_TMP_DIR = ILM_POLICIES_TMP_DIR;
exports.ILM_CANDIDATES_TMP_DIR = ILM_CANDIDATES_TMP_DIR;


