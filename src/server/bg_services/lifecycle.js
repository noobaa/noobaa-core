/* Copyright (C) 2022 NooBaa */
'use strict';

const _ = require('lodash');
const moment = require('moment');
const util = require('util');
const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const server_rpc = require('../server_rpc');
const system_store = require('../system_services/system_store').get_instance();
const auth_server = require('../common_services/auth_server');
const config = require('../../../config');
const { get_notification_logger, check_notif_relevant,
    OP_TO_EVENT, compose_notification_lifecycle, should_notify_on_event } = require('../../util/notifications_util');
const COMMON_CONSTANTS = require('../../common/constants');
const { STORAGE_CLASS_STANDARD } = require('../../endpoint/s3/s3_utils');

/*************************/
/******* CONSTANTS *******/
/*************************/
const ARCHIVE = COMMON_CONSTANTS.ARCHIVE;

function get_expiration_timestamp(expiration) {
    if (!expiration) {
        return undefined; // undefined
    } else if (expiration.date) {
        return Math.floor(new Date(expiration.date).getTime() / 1000);
    } else if (expiration.days) {
        return moment().subtract(expiration.days, 'days').unix();
    }
}

/**
 * Normalizes a given date or timestamp to midnight UTC and returns it as a Unix timestamp in seconds.  
 *
 * @param {string|number|Date} providedDate - The input date value to normalize to midnight UTC.
 * @returns {number} The Unix timestamp in seconds representing the UTC midnight of the given date.
 */
function get_midnight_ts(providedDate) {
  const date = new Date(providedDate);
  return date.setUTCHours(0, 0, 0, 0) / 1000;
}

/**
 * Gets the Unix timestamp associated with a transition.
 * Transition for objects can be set to 0 unlike expiration which should be a positive integer.
 *
 * @param {Object} transition - The transition configuration.
 * @param {string|Date} [transition.date] - An absolute date to convert to a
 * Unix timestamp.
 * @param {number} [transition.days] - The number of days to subtract from
 * the current time.
 * @returns {number|undefined} The Unix timestamp in seconds, or `undefined`
 * if no valid transition value is provided.
 */
function get_transition_timestamp(transition) {
    if (!transition) {
        return undefined; // undefined
    } else if (transition.date !== undefined) {
        return get_midnight_ts(transition.date);
    } else if (transition.days !== undefined) {
        return moment().subtract(transition.days, 'days').unix();
    }
}

/**
 * Transition eligible objects from standard storage to the archive backend.
 * Transition is done based on the set transition lifecycle rule.
 *
 * @param {Object} system - the NooBaa system object from system_store
 * @param {nb.Bucket} bucket_info - the bucket object
 * @param {Object} rule - the transition or noncurrent_version_transition item
 * @param {Object} [lifecycle_filter] - the lifecycle rule filter (prefix, tags, object_size_*)
 */
async function process_transition(system, bucket_info, rule, lifecycle_filter) {
    if (!rule) {
        return;
    }

    try {
        const batch_size = config.LIFECYCLE_BATCH_SIZE;
        const object_server = server_rpc.client.object;
        const target_storage_class = rule.storage_class;

        // S3 lifecycle filters — all conditions are ANDed per the S3 spec
        const filter = lifecycle_filter || {};
        const prefix = filter.prefix || undefined;
        const size_less = filter.object_size_less_than || undefined;
        const size_greater = filter.object_size_greater_than || undefined;
        const tags = filter.tags && filter.tags.length ? filter.tags : undefined;

        const transition = {
            days: rule.days ?? rule.noncurrent_days,
            date: rule.date
        };
        const transition_ts = get_transition_timestamp(transition);
        const is_date = Boolean(transition.date);
        if (!transition_ts) {
            dbg.error("found transition rule with invalid transition day/date", bucket_info.name, rule);
            return;
        } else if (Object.keys(bucket_info.archive_policy?.deep_archive_resource || {}).length <= 0) {
            dbg.error("found bucket with invalid archive resource", bucket_info.name, bucket_info.archive_policy);
            return;
        } else if (!Object.keys(ARCHIVE.STORAGE_CLASS).includes(target_storage_class)) {
            dbg.error(`target storage class should be one of: ${Object.keys(ARCHIVE.STORAGE_CLASS)}`);
            return;
        }

        // Behavior for versioning suspended bucket is same as an enabled bucket
        const versioning_disabled = bucket_info.versioning === COMMON_CONSTANTS.S3.VERSIONING.DISABLED;
        const key_marker = '';
        let version_seq_marker;
        let result;
        if (versioning_disabled) {
            result = await object_server.find_objects_to_transition({
                bucket: bucket_info.name,
                batch_size,
                key_marker,
                transition_ts,
                prefix,
                size_less,
                size_greater,
                tags,
                is_date,
            }, {
                auth_token: auth_server.make_auth_token({
                    system_id: system._id,
                    account_id: system.owner._id,
                    role: 'admin'
                })
            });
        } else {
            /* 
            For versioned buckets, the objects depends on the following rules: 
                1. Transition - All the latest versions of the objects
                2. NoncurrentVersionTransition - AND operation between NoncurrentDays and NewerNoncurrentVersions
            */
            // NoncurrentDays=0 is valid; do not treat 0 as falsy (that would run the latest-version finder).
            const is_latest = rule.noncurrent_days === undefined && rule.newer_noncurrent_versions === undefined;
            result = await object_server.find_versioned_objects_to_transition({
                bucket: bucket_info.name,
                batch_size,
                key_marker,
                version_seq_marker,
                transition_ts,
                is_latest,
                noncurrent_days: rule.noncurrent_days,
                newer_noncurrent_versions: rule.newer_noncurrent_versions,
                prefix,
                size_less,
                size_greater,
                tags,
                is_date,
            }, {
                auth_token: auth_server.make_auth_token({
                    system_id: system._id,
                    account_id: system.owner._id,
                    role: 'admin'
                })
            });
        }

        try {
            const obj_ids = await transition_objects(system, bucket_info, result.objects, target_storage_class);
            dbg.log1("successfully transitioned batch with object id's", obj_ids);
        } catch (err) {
            dbg.error("error occurred while transitioning objects batch", err);
        }

        return result.is_truncated;
    } catch (e) {
        dbg.error("error occurred while executing batch transition", e);
    }
}

async function delete_expired_objects(system, bucket, rule, reply_objects) {
    /*
     * Versioned buckets: expire current versions by creating a delete marker
     * (delete_version: false). Object Lock does not block delete-marker creation;
     * locked object versions remain and are protected from permanent delete.
     * Permanent NoncurrentVersionExpiration skips locked versions in MDStore.
     */
    return await server_rpc.client.object.delete_multiple_objects_by_filter({
        bucket: bucket.name,
        create_time: get_expiration_timestamp(rule.expiration),
        prefix: rule.filter.prefix,
        size_less: rule.filter.object_size_less_than,
        size_greater: rule.filter.object_size_greater_than,
        tags: rule.filter.tags,
        limit: config.LIFECYCLE_BATCH_SIZE,
        filter_delete_markers: true,
        latest_versions: true,
        // deleting only the latest verion and creating delete marker for expired objects
        delete_version: false,
        reply_objects,
    }, {
        auth_token: auth_server.make_auth_token({
            system_id: system._id,
            account_id: system.owner._id,
            role: 'admin'
        })
    });
}

async function delete_incomplete_multipart_uploads(system, bucket, rule, reply_objects) {
    return await server_rpc.client.object.delete_incomplete_multiparts({
        bucket,
        days_after_initiation: rule.abort_incomplete_multipart_upload.days_after_initiation,
        prefix: rule.filter?.prefix,
        size_less: rule.filter?.object_size_less_than,
        size_greater: rule.filter?.object_size_greater_than,
        limit: config.LIFECYCLE_BATCH_SIZE,
        reply_objects
    }, {
        auth_token: auth_server.make_auth_token({
            system_id: system._id,
            account_id: system.owner._id,
            role: 'admin'
        })
    });
}

async function delete_noncurrent_versions(system, bucket, rule, reply_objects) {
    return await server_rpc.client.object.delete_noncurrent_versions({
        bucket,
        noncurrent_days: rule.noncurrent_version_expiration.noncurrent_days,
        newer_noncurrent_versions: rule.noncurrent_version_expiration.newer_noncurrent_versions,
        prefix: rule.filter?.prefix,
        size_less: rule.filter?.object_size_less_than,
        size_greater: rule.filter?.object_size_greater_than,
        tags: rule.filter?.tags,
        limit: config.LIFECYCLE_BATCH_SIZE,
        reply_objects
    }, {
        auth_token: auth_server.make_auth_token({
            system_id: system._id,
            account_id: system.owner._id,
            role: 'admin'
        })
    });
}

async function delete_expired_delete_markers(system, bucket, rule, reply_objects) {
    return await server_rpc.client.object.delete_expired_delete_markers({
        bucket,
        prefix: rule.filter?.prefix,
        size_less: rule.filter?.object_size_less_than,
        size_greater: rule.filter?.object_size_greater_than,
        limit: config.LIFECYCLE_BATCH_SIZE,
        reply_objects
    }, {
        auth_token: auth_server.make_auth_token({
            system_id: system._id,
            account_id: system.owner._id,
            role: 'admin'
        })
    });
}

async function handle_bucket_rule(system, rule, j, bucket) {
    const now = Date.now();
    let should_rerun = false;
    let num_objects_deleted = 0;

    if (rule.status !== 'Enabled') {
        dbg.log0('LIFECYCLE SKIP bucket:', bucket.name, '(bucket id:', bucket._id, ') rule', util.inspect(rule), 'not Enabled');
        return;
    }
    if (rule.last_sync && now - rule.last_sync < config.LIFECYCLE_SCHEDULE_MIN) {
        dbg.log0('LIFECYCLE SKIP bucket:', bucket.name, '(bucket id:', bucket._id, ') rule', util.inspect(rule), 'now', now, 'last_sync', rule.last_sync, 'schedule min', config.LIFECYCLE_SCHEDULE_MIN);
        return;
    }
    const transitions = rule.transitions || [];
    const noncurrent_transitions = rule.noncurrent_version_transitions || [];
    // When creating rules via the AWS web console, they always contain an Expiration key
    // However, rules applied via the CLI don't have to contain Expiration, and can instead contain
    // NoncurrentVersionExpiration or AbortIncompleteMultipartUpload
    if (
        rule.expiration === undefined &&
        rule.abort_incomplete_multipart_upload === undefined &&
        rule.noncurrent_version_expiration === undefined &&
        !transitions.length && !noncurrent_transitions.length
    ) {
        dbg.log0('LIFECYCLE SKIP bucket:', bucket.name, '(bucket id:', bucket._id, ') rule', util.inspect(rule), 'now', now, 'last_sync', rule.last_sync, 'rule contains no expiration parameters');
        return;
    }
    dbg.log0('LIFECYCLE PROCESSING bucket:', bucket.name.unwrap(), '(bucket id:', bucket._id, ') rule', util.inspect(rule));

    //we might need to send notifications for deleted objects, if
    //1. notifications are enabled AND
    //2. bucket has notifications at all AND
    //3. bucket has a relevant notification, either
    //3.1. notification is without event filtering OR
    //3.2. notification is for LifecycleExpiration event
    //if so, we need the metadata of the deleted objects from the object server
    const reply_objects = should_notify_on_event(bucket, OP_TO_EVENT.lifecycle_delete.name);

    // Check if rule.expiration.days/date is set - if it is, delete expired objects and delete markers
    if (!_.isUndefined(rule.expiration?.days) || !_.isUndefined(rule.expiration?.date)) {
        dbg.log0('LIFECYCLE PROCESSING rule.expiration.days:', rule.expiration.days);
        const res = await delete_expired_objects(system, bucket, rule, reply_objects);
        num_objects_deleted = res.num_objects_deleted;
        if (res.deleted_objects) {
            const writes = [];
            for (const deleted_obj of res.deleted_objects) {
                //if deletion has failed, don't send a notification
                if (deleted_obj.err_code) continue;
                for (const notif of bucket.notifications) {
                    if (check_notif_relevant(notif, {
                        op_name: 'lifecycle_delete',
                        s3_event_method: deleted_obj.delete_marker ? 'DeleteMarkerCreated' : 'Delete',
                    })) {
                        //remember that this deletion needs a notif for this specific notification conf
                        writes.push({notif, deleted_obj});
                    }
                }
            }

            //if any notifications are needed, write them in notification log file
            //(otherwise don't do any unnecessary filesystem actions)
            if (writes.length > 0) {
                let logger;
                try {
                    logger = get_notification_logger('SHARED');
                    await P.map_with_concurrency(100, writes, async write => {
                        const notif = compose_notification_lifecycle(write.deleted_obj, write.notif, bucket);
                        logger.append(JSON.stringify(notif));
                    });
                } finally {
                    if (logger) logger.close();
                }
            }
        }
    }

    if (rule.expiration?.expired_object_delete_marker) {
        await delete_expired_delete_markers(
            system,
            bucket.name,
            rule,
            reply_objects
        );
    }

    // Check if rule.AbortIncompleteMultipartUpload exists - 
    // if it does, delete incomplete parts if DaysAfterInitiation has passed
    if (rule.abort_incomplete_multipart_upload?.days_after_initiation) {
        await delete_incomplete_multipart_uploads(
            system,
            bucket.name,
            rule,
            reply_objects
        );
    }

    if (rule.noncurrent_version_expiration?.noncurrent_days) {
        // According to https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-configure-notification.html
        // it doesn't seem like deletion of noncurrent version should generate
        // any events.
        // Object Lock: MDStore.remove_noncurrent_versions skips versions with
        // active retention or legal hold (lifecycle never bypasses Governance).
        await delete_noncurrent_versions(
            system,
            bucket.name,
            rule,
            reply_objects
        );
    }

    if (transitions.length || noncurrent_transitions.length) {
        for (const t of transitions) {
            const transition_has_more = await process_transition(system, bucket, t, rule.filter);
            if (transition_has_more) should_rerun = true;
        }
        // NoncurrentVersionTransition has no effect on versioning disabled buckets
        if (noncurrent_transitions.length &&
            bucket.versioning === COMMON_CONSTANTS.S3.VERSIONING.DISABLED) {
            dbg.log1("skipping noncurrent_version_transition rule as bucket versioning is disabled", bucket.name);
        } else {
            for (const t of noncurrent_transitions) {
                const noncurrent_has_more = await process_transition(system, bucket, t, rule.filter);
                if (noncurrent_has_more) should_rerun = true;
            }
        }
        dbg.log1("bucket", bucket.name, "transition batch completed");
    }

    if (num_objects_deleted >= config.LIFECYCLE_BATCH_SIZE) should_rerun = true;

    bucket.lifecycle_configuration_rules[j].last_sync = Date.now();
    dbg.log0('LIFECYCLE Done bucket:', bucket.name, '(bucket id:', bucket._id, ') done deletion of objects per rule',
            rule, 'time:', bucket.lifecycle_configuration_rules[j].last_sync, 'objects deleted:', num_objects_deleted,
            should_rerun ? 'lifecycle should rerun' : '');
    update_lifecycle_rules_last_sync(bucket, bucket.lifecycle_configuration_rules);

    return should_rerun;
}

async function background_worker() {
    const system = system_store.data.systems[0];
    if (!system) return;
    try {
        dbg.log0('LIFECYCLE READ BUCKETS configuration: BEGIN');
        await system_store.refresh();
        dbg.log0('LIFECYCLE READ BUCKETS configuration buckets:', system_store.data.buckets.map(e => e.name));
        let should_rerun = false;
        for (const bucket of system_store.data.buckets) {
            dbg.log0('LIFECYCLE READ BUCKETS configuration bucket name:', bucket.name, "rules", bucket.lifecycle_configuration_rules);
            if (!bucket.lifecycle_configuration_rules || bucket.deleting) continue;

            const results = await P.all(_.map(bucket.lifecycle_configuration_rules,
                async (lifecycle_rule, j) => {
                    dbg.log0('LIFECYCLE READ BUCKETS configuration handle_bucket_rule bucket name:', bucket.name.unwrap(), "rule", lifecycle_rule, 'j', j);
                    return handle_bucket_rule(system, lifecycle_rule, j, bucket);
                }
            ));
            if (results.includes(true)) should_rerun = true;
        }
        if (should_rerun) {
            dbg.log0('LIFECYCLE: RUN Not finished deleting - will continue');
            return config.LIFECYCLE_SCHEDULE_MIN;
        }
    } catch (err) {
        dbg.error('LIFECYCLE FAILED processing', err, err.stack);
    }
    dbg.log0('LIFECYCLE: END');
}

function update_lifecycle_rules_last_sync(bucket, rules) {
    return system_store.make_changes({
        update: {
            buckets: [{
                _id: bucket._id,
                lifecycle_configuration_rules: rules
            }]
        }
    });
}

/**
 * Reset an object's transition_info by unsetting it on its object_md.
 *
 * @param {Object} rpc_client - the RPC client (server_rpc.client)
 * @param {Object} system - the NooBaa system object from system_store
 * @param {string} object_id - the object's _id to reset
 * @returns {Promise<boolean>} true if the update succeeded
 */
function unset_transition_status(rpc_client, system, object_id) {
    return rpc_client.object.update_transition_info({
        unset_transition_status: true,
        obj_id: object_id,
        transition_status: ARCHIVE.TRANSITION_STATUS.IN_PROGRESS,
    }, {
        auth_token: auth_server.make_auth_token({
            system_id: system._id,
            account_id: system.owner._id,
            role: 'admin'
        })
    });
}

/**
 * Transitions a batch of objects to archive storage class.
 * For each object in the batch, calls archive_object on the archive_server which handles IO
 *
 * @param {Object} system - The NooBaa system object.
 * @param {nb.Bucket} bucket_info - The bucket descriptor.
 * @param {Array<Object>} objects - Array of object descriptors (each with an obj_id property)
 *                                  to transition.
 * @param {string} target_storage_class - The target storage class to transition objects to (e.g. 'GLACIER').
 * @returns {Promise<string[]>} Array of successfully transitioned object IDs.
 */
async function transition_objects(system, bucket_info, objects, target_storage_class) {
    const concurrency = config.LIFECYCLE_TRANSITION_CONCURRENCY;
    const failed_objects = [];
    const rpc_client = server_rpc.rpc.new_client({
        auth_token: auth_server
            .make_auth_token({
                system_id: system._id,
                account_id: system.owner._id,
                role: 'admin'
            })
    });
    const results = await P.map_with_concurrency(concurrency, objects, (async obj => {
        const obj_id = obj.obj_id;
        const source_info = {
            storage_class: obj.storage_class || STORAGE_CLASS_STANDARD,
            transition_timestamp: Date.now(),
        };
        try {
            const res = await server_rpc.client.object.update_transition_info({
                update_transition_status: ARCHIVE.TRANSITION_STATUS.IN_PROGRESS,
                obj_id,
            }, {
                auth_token: auth_server.make_auth_token({
                    system_id: system._id,
                    account_id: system.owner._id,
                    role: 'admin'
                })
            });

            if (!res) {
                dbg.warn("LIFECYCLE_TRANSITION: object no longer valid for transition", obj_id);
                return;
            }

            dbg.log1("LIFECYCLE_TRANSITION: transition status updated to 'in_progress' for object:", obj_id);

            const archive_status = await rpc_client.archive.archive_object({
                obj_id: obj_id,
                bucket_id: bucket_info._id,
                target_storage_class,
            });

            if (!archive_status.success) {
                dbg.log1("got success false status from archive_server for object", obj_id);
                throw new Error(`archive_server failed to transition object ${obj.key}`);
            }

            dbg.log1('object successfully transitioned, marking DONE', obj_id);
            await P.retry({
                attempts: 3,
                delay_ms: 500,
                func: async () => server_rpc.client.object.update_transition_info({
                    update_transition_status: ARCHIVE.TRANSITION_STATUS.DONE,
                    transition_status: ARCHIVE.TRANSITION_STATUS.IN_PROGRESS,
                    storage_class: target_storage_class,
                    include_deleted: true,
                    source_info,
                    obj_id,
                }, {
                    auth_token: auth_server.make_auth_token({
                        system_id: system._id,
                        account_id: system.owner._id,
                        role: 'admin'
                    })
                }),
            });
            return obj_id;
        } catch (e) {
            failed_objects.push(obj_id);
            dbg.error("failed to archive object", obj_id, "retry in next cycle", e);
            await unset_transition_status(server_rpc.client, system, obj_id);
        }
    }));

    if (failed_objects.length) {
        dbg.warn("failed to archive objects", failed_objects, "retry in next cycle");
    }
    return results.filter(Boolean);
}

exports.background_worker = background_worker;
