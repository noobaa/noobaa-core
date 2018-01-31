/* Copyright (C) 2016 NooBaa */
'use strict';

const server_rpc = require('../server_rpc');
const P = require('../../util/promise');
const _ = require('lodash');
const promise_utils = require('../../util/promise_utils');
const system_store = require('../system_services/system_store').get_instance();

const TRIGGER_ATTEMPTS = 2;
const DELAY_BETWEEEN_TRIGGER_ATTEMPTS = 5000; // ?

function get_triggers_for_event(bucket, obj, event_name) {
    return _.filter(bucket.lambda_triggers, trigger =>
        trigger.enabled && (trigger.event_name === event_name || trigger.event_name === event_name.split(':')[0]) &&
        (!trigger.object_prefix || obj.key.startsWith(trigger.object_prefix)) &&
        (!trigger.object_suffix || obj.key.endsWith(trigger.object_suffix))
    );
}

function run_bucket_triggers(triggers_to_run, bucket, obj, actor, token) {
    if (!triggers_to_run || !triggers_to_run.length) return;
    const now = Date.now();
    const updates = [];
    for (const { _id: trigger_id } of triggers_to_run) {
        updates.push({
            $find: { _id: bucket._id, 'lambda_triggers._id': trigger_id },
            $set: { 'lambda_triggers.$.last_run': now },
        });
    }
    return P.resolve()
        .then(() => system_store.make_changes_in_background({
            update: {
                buckets: updates
            }
        }))
        .then(() => P.map(triggers_to_run, trigger => {
            const event = create_object_event({
                bucket: bucket.name,
                time: obj.create_time,
                object: obj,
                actor: actor,
                event_name: trigger.event_name,
                id: trigger._id
            });
            return promise_utils.retry(
                TRIGGER_ATTEMPTS,
                DELAY_BETWEEEN_TRIGGER_ATTEMPTS,
                () => run_trigger(trigger, event, bucket.system, token)
            );
        }));
}

function run_trigger(trigger, event, system, token) {
    return server_rpc.client.func.invoke_func({
        name: trigger.func_name,
        version: trigger.func_version,
        event: event,
    }, {
        auth_token: token
    });
}

function create_object_event({ bucket, object, time, actor, event_name, id }) {
    const event = {
        Records: [{
            eventVersion: 2.0,
            eventSource: 'aws:s3',
            eventTime: time,
            eventName: event_name,
            userIdentity: {
                principalId: String(actor.id)
            },
            requestParameters: {
                sourceIPAddress: '127.0.0.1'
            },
            s3: {
                s3SchemaVersion: 1.0,
                configurationId: id,
                bucket: {
                    name: bucket,
                },
                object: {
                    key: object.key,
                    size: object.size,
                    eTag: object.etag,
                    // sequencer: TBD
                }
            }
        }]
    };
    return event;
}

exports.run_bucket_triggers = run_bucket_triggers;
exports.get_triggers_for_event = get_triggers_for_event;
