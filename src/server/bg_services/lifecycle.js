/* Copyright (C) 2016 NooBaa */
'use strict';


const _ = require('lodash');
const moment = require('moment');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const server_rpc = require('../server_rpc');
const system_store = require('../system_services/system_store').get_instance();
const auth_server = require('../common_services/auth_server');


var LIFECYCLE = {
    schedule_min: 1 //run every 5 minutes
};

async function background_worker() {
    const system = system_store.data.systems[0];
    if (!system) return;
    try {
        dbg.log0('LIFECYCLE READ BUCKETS configuration: BEGIN');
        await system_store.refresh();
        for (const bucket of system_store.data.buckets) {
            if (!bucket.lifecycle_configuration_rules || bucket.deleting) return;

            await P.all(_.map(bucket.lifecycle_configuration_rules, async (lifecycle_rule, j) => {
                dbg.log0('LIFECYCLE HANDLING BUCKET:', bucket.name.unwrap(), 'BEGIN');
                const now = Date.now();
                const yesterday = now - (1000 * 60 * 60 * 24);
                //If refresh time
                if (!lifecycle_rule.last_sync) {
                    dbg.log0('LIFECYCLE HANDLING bucket:', bucket.name.unwrap(), 'rule id', lifecycle_rule.id,
                        'status:', lifecycle_rule.status, ', setting last_sync as yesterday (', yesterday, ')');
                    lifecycle_rule.last_sync = yesterday; //set yesterday as last sync
                }

                const bucket_rule = bucket.name.unwrap() + ' rule id(' + j + ') ' + lifecycle_rule.id;
                const last_synced_min = (now - lifecycle_rule.last_sync) / 1000 / 60;

                dbg.log0('LIFECYCLE HANDLING bucket:', bucket_rule, 'status:', lifecycle_rule.status,
                    'last_sync', Math.floor(last_synced_min), 'min ago.');

                if ((lifecycle_rule.status === 'Enabled') && (last_synced_min > LIFECYCLE.schedule_min)) {
                    dbg.log0('LIFECYCLE PROCESSING bucket:', bucket_rule);
                    if (lifecycle_rule.expiration.days || lifecycle_rule.expiration.date < Date.now()) {
                        dbg.log0('LIFECYCLE DELETING bucket:', bucket_rule);
                        const deletion_params = { bucket: bucket.name, prefix: lifecycle_rule.prefix };
                        // Delete objects with create time older than expiration days
                        if (lifecycle_rule.expiration.days) {
                            const create_time = moment().subtract(lifecycle_rule.expiration.days, 'days');
                            deletion_params.create_time = create_time.unix();
                            dbg.log0('LIFECYCLE DELETING bucket:', bucket_rule, 'Days:', lifecycle_rule.expiration.days, '(', create_time, ')');
                        }
                        await server_rpc.client.object.delete_multiple_objects_by_prefix(deletion_params, {
                            auth_token: auth_server.make_auth_token({
                                system_id: system._id,
                                account_id: system.owner._id,
                                role: 'admin'
                            })
                        });
                        bucket.lifecycle_configuration_rules[j].last_sync = Date.now();
                        dbg.log0('LIFECYCLE Done bucket:', bucket.name.unwrap(), 'done deletion of objects per prefix',
                            lifecycle_rule.prefix, 'time:', bucket.lifecycle_configuration_rules[j].last_sync);
                    }
                } else {
                    dbg.log0('LIFECYCLE NOTHING bucket:', bucket.name.unwrap(), 'rule id', lifecycle_rule.id, 'nothing to do');
                }
            }));
            dbg.log0('LIFECYCLE SYNC TIME bucket', bucket.name.unwrap(), 'SAVE last sync', bucket.lifecycle_configuration_rules[0].last_sync);
            update_lifecycle_rules_last_sync(bucket, bucket.lifecycle_configuration_rules);
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
