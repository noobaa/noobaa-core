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
const { CONFIG_TYPES } = require('../sdk/config_fs');
const NsfsObjectSDK = require('../sdk/nsfs_object_sdk');
const native_fs_utils = require('../util/native_fs_utils');
const lifecycle_utils = require('../util/lifecycle_utils');
const SensitiveString = require('../util/sensitive_string');
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


class NCLifecycle {
    constructor(config_fs, options = {}) {
        this.lifecycle_config_dir_path = path.join(config_fs.config_root, config.NC_LIFECYCLE_CONFIG_DIR_NAME);
        this.lifecyle_logs_dir_path = config.NC_LIFECYCLE_LOGS_DIR;
        this.config_fs = config_fs;
        this.fs_context = config_fs.fs_context;
        this.lock_path = path.join(this.lifecycle_config_dir_path, LIFECYCLE_CLUSTER_LOCK);
        this.lifecycle_timestamp_file_path = path.join(this.lifecycle_config_dir_path, LIFECYLE_TIMESTAMP_FILE);

        this.lifecycle_run_status = {
            running_host: os.hostname(),
            lifecycle_run_times: {},
            total_stats: this._get_default_stats(),
            buckets_statuses: {},
            state: { is_finished: false }
        };
        this.return_short_status = options.short_status || false;
        this.disable_service_validation = options.disable_service_validation || false;
        this.disable_runtime_validation = options.disable_runtime_validation || false;
        this.should_continue_last_run = options.should_continue_last_run || false;
    }

    /**
     * run_lifecycle_under_lock runs the lifecycle workflow under a file system lock
     * lifecycle workflow is being locked to prevent multiple instances from running the lifecycle workflow
     * @returns {Promise<{should_run: Boolean, lifecycle_run_status: Object}>}
     */
    async run_lifecycle_under_lock() {
        await this.config_fs.create_dir_if_missing(this.lifecyle_logs_dir_path);
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
     * process_buckets iterates over buckets and handles their rules
     * @param {String[]} bucket_names
     * @param {Object} system_json
     * @returns {Promise<Void>}
     */
    async process_buckets(bucket_names, system_json) {
        const buckets_concurrency = 10; // TODO - think about it
        while (!this.lifecycle_run_status.state.is_finished) {
            await P.map_with_concurrency(buckets_concurrency, bucket_names, async bucket_name =>
                await this._call_op_and_update_status({
                    bucket_name,
                    op_name: TIMED_OPS.PROCESS_BUCKET,
                    op_func: async () => this.process_bucket(bucket_name, system_json)
                })
            );
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
        const object_sdk = new NsfsObjectSDK('', this.config_fs, account, bucket_json.versioning, this.config_fs.config_root, system_json);
        await object_sdk._simple_load_requesting_account();
        const should_notify = notifications_util.should_notify_on_event(bucket_json, notifications_util.OP_TO_EVENT.lifecycle_delete.name);
        if (!bucket_json.lifecycle_configuration_rules) {
            this.lifecycle_run_status.buckets_statuses[bucket_json.name].state = { is_finished: true };
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
        try {
            const bucket_state = this.lifecycle_run_status.buckets_statuses[bucket_json.name].state;
            bucket_state.num_processed_objects = 0;
            while (!bucket_state.is_finished && bucket_state.num_processed_objects < config.NC_LIFECYCLE_BUCKET_BATCH_SIZE) {
                await P.all(_.map(bucket_json.lifecycle_configuration_rules,
                    async (lifecycle_rule, index) =>
                        await this._call_op_and_update_status({
                            bucket_name: bucket_json.name,
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
                bucket_state.is_finished = Object.values(this.lifecycle_run_status.buckets_statuses[bucket_json.name].rules_statuses)
                    .reduce(
                    (acc, rule) => acc && (_.isEmpty(rule.state) || rule.state.is_finished),
                    true
                );
            }
        } catch (err) {
            dbg.error('process_rules failed with error', err, err.code, err.message);
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
                const delete_res = await this._call_op_and_update_status({
                    bucket_name,
                    rule_id,
                    op_name: TIMED_OPS.DELETE_MULTIPLE_OBJECTS,
                    op_func: async () => object_sdk.delete_multiple_objects({
                        bucket: bucket_json.name,
                        objects: candidates.delete_candidates
                    })
                });
                if (should_notify) {
                    await this.send_lifecycle_notifications(delete_res, candidates.delete_candidates, bucket_json, object_sdk);
                }
            }

            if (candidates.abort_mpu_candidates?.length > 0) {
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
     * @param {Object} object_sdk
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
                    const notif = notifications_util.compose_notification_lifecycle(write.deleted_obj,
                        write.notif, bucket_json, object_sdk);
                    await logger.append(JSON.stringify(notif));
                });
            } finally {
                if (logger) await logger.close();
            }
        }
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
        const rule_state = this.lifecycle_run_status.buckets_statuses[bucket_json.name].rules_statuses[lifecycle_rule.id]?.state || {};
        if (lifecycle_rule.expiration) {
            candidates.delete_candidates = await this.get_candidates_by_expiration_rule(lifecycle_rule, bucket_json,
                object_sdk, rule_state);
            if (lifecycle_rule.expiration.days || lifecycle_rule.expiration.expired_object_delete_marker) {
                const dm_candidates = await this.get_candidates_by_expiration_delete_marker_rule(lifecycle_rule, bucket_json);
                candidates.delete_candidates = candidates.delete_candidates.concat(dm_candidates);
            }
        }
        if (lifecycle_rule.noncurrent_version_expiration) {
            const non_current_candidates = await this.get_candidates_by_noncurrent_version_expiration_rule(lifecycle_rule, bucket_json);
            candidates.delete_candidates = candidates.delete_candidates.concat(non_current_candidates);
        }
        if (lifecycle_rule.abort_incomplete_multipart_upload) {
            candidates.abort_mpu_candidates = await this.get_candidates_by_abort_incomplete_multipart_upload_rule(
                lifecycle_rule, bucket_json, object_sdk);
        }
        this.lifecycle_run_status.buckets_statuses[bucket_json.name].rules_statuses[lifecycle_rule.id].state = rule_state;
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
     * @param {Object} entry list object entry
     */
    _get_lifecycle_object_info_from_list_object_entry(entry) {
        return {
            key: entry.key,
            age: this._get_file_age_days(entry.create_time),
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
    async get_candidates_by_expiration_rule(lifecycle_rule, bucket_json, object_sdk, rule_state) {
        const is_gpfs = nb_native().fs.gpfs;
        if (is_gpfs && config.NC_LIFECYCLE_GPFS_ILM_ENABLED) {
            return this.get_candidates_by_expiration_rule_gpfs(lifecycle_rule, bucket_json);
        } else {
            return this.get_candidates_by_expiration_rule_posix(lifecycle_rule, bucket_json, object_sdk, rule_state);
        }
    }

    /**
     * @param {*} lifecycle_rule
     * @param {Object} bucket_json
     * @returns {Promise<Object[]>}
     */
    async get_candidates_by_expiration_rule_gpfs(lifecycle_rule, bucket_json) {
        return [];
    }

    /**
     *
     * @param {*} lifecycle_rule
     * @param {Object} bucket_json
     * @returns {Promise<Object[]>}
     */
    async get_candidates_by_expiration_rule_posix(lifecycle_rule, bucket_json, object_sdk, rule_state) {
        const expiration = this._get_expiration_time(lifecycle_rule.expiration);
        if (expiration < 0) return [];
        const filter_func = this._build_lifecycle_filter({filter: lifecycle_rule.filter, expiration});

        const filtered_objects = [];
        // TODO list_objects does not accept a filter and works in batch sizes of 1000. should handle batching
        // also should maybe create a helper function or add argument for a filter in list object
        const objects_list = await object_sdk.list_objects({
            bucket: bucket_json.name,
            prefix: lifecycle_rule.filter?.prefix,
            key_marker: rule_state.key_marker,
            limit: config.NC_LIFECYCLE_LIST_BATCH_SIZE
        });
        objects_list.objects.forEach(obj => {
            const lifecycle_object = this._get_lifecycle_object_info_from_list_object_entry(obj);
            if (filter_func(lifecycle_object)) {
                //need to delete latest. so remove version_id if exists
                const candidate = _.omit(obj, ['version_id']);
                filtered_objects.push(candidate);
            }
        });

        const bucket_state = this.lifecycle_run_status.buckets_statuses[bucket_json.name].state;
        bucket_state.num_processed_objects += objects_list.objects.length;
        if (objects_list.is_truncated) {
            rule_state.key_marker = objects_list.next_marker;
        } else {
            rule_state.is_finished = true;
        }
        return filtered_objects;
    }

    /**
     * get_candidates_by_expiration_delete_marker_rule processes the expiration delete marker rule
     * @param {*} lifecycle_rule
     * @param {Object} bucket_json
     * @returns {Promise<Object[]>}
     */
    async get_candidates_by_expiration_delete_marker_rule(lifecycle_rule, bucket_json) {
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
    async get_candidates_by_noncurrent_version_expiration_rule(lifecycle_rule, bucket_json) {
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
            age: this._get_file_age_days(stat.mtime.getTime()),
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
     * get file time since last modified in days
     * @param {Number} mtime
     * @returns {Number} days since object was last modified
     */
    _get_file_age_days(mtime) {
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
    _get_expiration_time(expiration_rule) {
        if (expiration_rule.date) {
            const expiration_date = new Date(expiration_rule.date).getTime();
            if (Date.now() < expiration_date) return -1;
            return 0;
        }
        return expiration_rule.days;
    }

/////////////////////////////////
//////// STATUS HELPERS ////////
/////////////////////////////////

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
    async _call_op_and_update_status({ bucket_name = undefined, rule_id = undefined, op_name, op_func }) {
        const start_time = Date.now();
        const update_options = { op_name, bucket_name, rule_id };
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
    update_status({ bucket_name, rule_id, op_name, op_times, reply = [], error = undefined }) {
        if (op_times.start_time) {
            if (op_name === TIMED_OPS.PROCESS_RULE) {
                this.init_rule_status(bucket_name, rule_id);
            } else if (op_name === TIMED_OPS.PROCESS_BUCKET) {
                this.init_bucket_status(bucket_name);
            }
        }
        this._update_times_on_status({ op_name, op_times, bucket_name, rule_id });
        this._update_error_on_status({ error, bucket_name, rule_id });
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
        this.lifecycle_run_status.buckets_statuses[bucket_name].rules_statuses[rule_id].rule_stats = { ...rule_stats_acc, ...cur_op_stats };
        this.lifecycle_run_status.buckets_statuses[bucket_name].bucket_stats = this._acc_stats(
            { stats_acc: bucket_stats_acc, cur_op_stats });
        this.lifecycle_run_status.total_stats = this._acc_stats({ stats_acc: lifecycle_stats_acc, cur_op_stats });
    }

    /**
     * _update_times_on_status updates start/end & took times in lifecycle status
     * @param {{op_name: String, op_times: {start_time?: number, end_time?: number, took_ms?: number },
     * bucket_name?: String, rule_id?: String}} params
     * @returns
     */
    _update_times_on_status({ op_name, op_times, bucket_name = undefined, rule_id = undefined }) {
        for (const [key, value] of Object.entries(op_times)) {
            const status_key = op_name + '_' + key;
            if (bucket_name && rule_id) {
                this.lifecycle_run_status.buckets_statuses[bucket_name].rules_statuses[rule_id].rule_process_times[status_key] = value;
            } else if (bucket_name) {
                this.lifecycle_run_status.buckets_statuses[bucket_name].bucket_process_times[status_key] = value;
            } else {
                this.lifecycle_run_status.lifecycle_run_times[status_key] = value;
            }
        }
    }

    /**
     * _update_error_on_status updates an error occured in lifecycle status
     * @param {{error: Error, bucket_name?: string, rule_id?: string}} params
     * @returns
     */
    _update_error_on_status({ error, bucket_name = undefined, rule_id = undefined }) {
        if (!error) return;
        if (bucket_name && rule_id) {
            (this.lifecycle_run_status.buckets_statuses[bucket_name].rules_statuses[rule_id].errors ??= []).push(error.message);
        } else if (bucket_name) {
            (this.lifecycle_run_status.buckets_statuses[bucket_name].errors ??= []).push(error.message);
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
     * write_lifecycle_log_file
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
        this.lifecycle_run_status.buckets_statuses[bucket_name].rules_statuses ??= {};
        this.lifecycle_run_status.buckets_statuses[bucket_name].state ??= {};
        this.lifecycle_run_status.buckets_statuses[bucket_name].bucket_process_times = {};
        this.lifecycle_run_status.buckets_statuses[bucket_name].bucket_stats = {};
        return this.lifecycle_run_status.buckets_statuses[bucket_name];
    }

    /**
     * init the rule status object statuses if they don't exist
     * @param {string} bucket_name
     * @param {string} rule_id
     * @returns {Object} created or existing rule status
     */
    init_rule_status(bucket_name, rule_id) {
        this.lifecycle_run_status.buckets_statuses[bucket_name].rules_statuses[rule_id] ??= {};
        this.lifecycle_run_status.buckets_statuses[bucket_name].rules_statuses[rule_id].state ??= {};
        this.lifecycle_run_status.buckets_statuses[bucket_name].rules_statuses[rule_id].rule_process_times = {};
        this.lifecycle_run_status.buckets_statuses[bucket_name].rules_statuses[rule_id].rule_stats = {};
        return this.lifecycle_run_status.buckets_statuses[bucket_name].rules_statuses[rule_id];
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


