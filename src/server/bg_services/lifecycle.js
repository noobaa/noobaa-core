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
    OP_TO_EVENT, compose_notification_lifecycle } = require('../../util/notifications_util');
const COMMON_CONSTANTS = require('../../common/constants');

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
 * Transition eligible objects from standard storage to the archive backend.
 * Transition is done based on the set transition lifecycle rule.
 *
 * @param {Object} system - the NooBaa system object from system_store
 * @param {Object} bucket - the bucket object (includes name, _id, versioning, archive_policy)
 * @param {Object} rule - the lifecycle rule containing transition or noncurrent_version_transition
 * @param {number} transition_ts - unix timestamp cutoff; objects created before this are eligible
 */
async function transition_objects(system, bucket, rule, transition_ts) {
    try {
        const batch_size = config.LIFECYCLE_TRANSITION_BATCH_SIZE;
        const object_server = server_rpc.client.object;
        const current_rule = rule.transition || rule.noncurrent_version_transition;
        const target_storage_class = current_rule.storage_class;

        // Behavior for versioning suspended bucket is same as an enabled bucket
        const versioning_disabled = bucket.versioning === COMMON_CONSTANTS.S3.VERSIONING.DISABLED; 
        let is_truncated = true;
        let key_marker = '';
        // List objects that are not deleted, reclaimed and not having transition_status as in_progress
        while (is_truncated) {
            let result;
            if (versioning_disabled) {
                result = await object_server.find_objects_to_transition({
                    bucket: bucket.name,
                    batch_size,
                    key_marker,
                    transition_ts,
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
                const is_latest = Boolean(rule?.transition);
                result = await object_server.find_versioned_objects_to_transition({
                    bucket: bucket.name,
                    batch_size,
                    key_marker,
                    transition_ts,
                    is_latest,
                    noncurrent_days: current_rule.noncurrent_days,
                    newer_noncurrent_versions: current_rule.newer_noncurrent_versions,
                }, {
                    auth_token: auth_server.make_auth_token({
                        system_id: system._id,
                        account_id: system.owner._id,
                        role: 'admin'
                    })
                });
            }
            
            const obj_ids = await P.map_with_concurrency(batch_size, result.objects, (async (obj) => {
                const obj_id = obj.obj_id;
                try {
                    const res = await server_rpc.client.object.transition_object({
                        update_transition_status: COMMON_CONSTANTS.ARCHIVE.TRANSITION_STATUS.IN_PROGRESS,
                        _id: obj_id,
                    }, {
                        auth_token: auth_server.make_auth_token({
                            system_id: system._id,
                            account_id: system.owner._id,
                            role: 'admin'
                        })
                    });

                    dbg.log1("object:", obj_id, "transition status updated:", res);

                    const rpc_client = server_rpc.rpc.new_client({
                        auth_token: auth_server
                            .make_auth_token({
                                system_id: system._id,
                                account_id: system.owner._id,
                                role: 'admin'
                            })
                    });

                    const archive_status = await rpc_client.archive.archive_object({
                        obj_id: obj_id,
                        bucket_id: bucket._id,
                        storage_class: target_storage_class,
                    });

                    if (archive_status.success) {
                        await server_rpc.client.object.transition_object({
                            update_transition_status: COMMON_CONSTANTS.ARCHIVE.TRANSITION_STATUS.DONE,
                            transition_status: COMMON_CONSTANTS.ARCHIVE.TRANSITION_STATUS.IN_PROGRESS,
                            storage_class: target_storage_class,
                            _id: obj_id,
                        }, {
                            auth_token: auth_server.make_auth_token({
                                system_id: system._id,
                                account_id: system.owner._id,
                                role: 'admin'
                            })
                        });
                    } else {
                        dbg.warn("failed to archive object", obj_id, "retry in next batch");
                        await unset_transition_status(server_rpc.client, system, obj_id);
                    }

                    dbg.log1('object successfully transitioned', obj_id);
                    return obj_id;
                } catch (e) {
                    await unset_transition_status(server_rpc.client, system, obj_id);
                    dbg.error("error occurred while transitioning object", obj_id, "to archive", e);
                }
            }));
            dbg.log1("successfully transitioned batch with object id's", obj_ids);

            key_marker = result.next_marker;
            is_truncated = result.is_truncated;
        }
    } catch (e) {
        dbg.error("error occurred while executing batch transition", e);
    }
}

async function delete_expired_objects(system, bucket, rule, reply_objects) {
    /* 
    Note that expired delete-markers are also deleted by this query
    since the lack of filter_delete_markers means the function's internal
    delete_marker variable remains as undefined, which is then dropped by compact()
    effectively matching all object_md entries regardless of their delete_marker status
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
    // When creating rules via the AWS web console, they always contain an Expiration key
    // However, rules applied via the CLI don't have to contain Expiration, and can instead contain
    // NoncurrentVersionExpiration or AbortIncompleteMultipartUpload
    if (
        rule.expiration === undefined &&
        rule.abort_incomplete_multipart_upload === undefined &&
        rule.noncurrent_version_expiration === undefined &&
        !rule.transition && !rule.noncurrent_version_transition
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
    const reply_objects = config.NOTIFICATION_LOG_DIR && bucket.notifications &&
         _.some(bucket.notifications, notif =>
            (!notif.Events || _.some(notif.Events, event => event.includes(OP_TO_EVENT.lifecycle_delete.name))));

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
        await delete_noncurrent_versions(
            system,
            bucket.name,
            rule,
            reply_objects
        );
    }

    if (rule.transition || rule.noncurrent_version_transition) {
        // NoncurrentVersionTransition has no effect on versioning disabled buckets
        if (rule.noncurrent_version_transition &&
            bucket.versioning === COMMON_CONSTANTS.S3.VERSIONING.DISABLED) {
            dbg.log1("skipping noncurrent_version_transition rule as bucket versioning is disabled", bucket.name);
            return;
        }
        const current_rule = rule.transition || rule.noncurrent_version_transition;
        const transition = {
            days: current_rule.days || current_rule.noncurrent_days,
            date: current_rule.date
        };
        const transition_ts = get_expiration_timestamp(transition);
        if (!transition_ts) {
            dbg.error("found transition rule with invalid transition day/date", bucket.name, rule);
            return;
        } else if (Object.keys(bucket.archive_policy?.deep_archive_resource || {}).length <= 0) {
            dbg.error("found bucket with invalid archive resource", bucket.name, bucket.archive_policy);
            return;
        }

        await transition_objects(system, bucket, rule, transition_ts);

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
 * Reset an object's transition_status by unsetting it on its object_md.
 *
 * @param {Object} server_rpc - the RPC client (server_rpc.client)
 * @param {Object} system - the NooBaa system object from system_store
 * @param {string} object_id - the object's _id to reset
 * @returns {Promise<boolean>} true if the update succeeded
 */
function unset_transition_status(server_rpc, system, object_id) {
    return server_rpc.object.transition_object({
        unset_transition_status: true,
        _id: object_id,
    }, {
        auth_token: auth_server.make_auth_token({
            system_id: system._id,
            account_id: system.owner._id,
            role: 'admin'
        })
    });
}

exports.background_worker = background_worker;
