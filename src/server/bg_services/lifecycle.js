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

function get_expiration_timestamp(expiration) {
    if (!expiration) {
        return undefined; // undefined
    } else if (expiration.date) {
        return Math.floor(new Date(expiration.date).getTime() / 1000);
    } else if (expiration.days) {
        return moment().subtract(expiration.days, 'days').unix();
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
        expiration_threshold: moment().subtract(rule.abort_incomplete_multipart_upload.days_after_initiation, 'days').unix(),
        prefix: rule.filter?.prefix,
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
        rule.AbortIncompleteMultipartUpload === undefined &&
        rule.NoncurrentVersionExpiration === undefined
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

    // Check if rule.expiration.days is set - if it is, delete expired objects and delete markers
    if (rule.expiration?.days) {
        const res = await delete_expired_objects(system, bucket, rule, reply_objects);
        num_objects_deleted = res.num_objects_deleted;
        //dbg.log0("LIFECYCLE PROCESSING res =", res);
        if (res.deleted_objects) {
            const writes = [];
            for (const deleted_obj of res.deleted_objects) {
                for (const notif of bucket.notifications) {
                    if (check_notif_relevant(notif, {
                        op_name: 'lifecycle_delete',
                        s3_event_method: deleted_obj.created_delete_marker ? 'DeleteMarkerCreated' : 'Delete',
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

    // Check if rule.AbortIncompleteMultipartUpload exists - 
    // if it does, delete incomplete parts if DaysAfterInitiation has passed
    if (rule.AbortIncompleteMultipartUpload?.DaysAfterInitiation) {
        await delete_incomplete_multipart_uploads(
            system,
            bucket.name,
            rule,
            reply_objects
        );
    }

    bucket.lifecycle_configuration_rules[j].last_sync = Date.now();
    if (num_objects_deleted >= config.LIFECYCLE_BATCH_SIZE) should_rerun = true;
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
exports.background_worker = background_worker;
