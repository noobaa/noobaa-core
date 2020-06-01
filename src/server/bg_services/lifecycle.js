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

function background_worker() {
    const system = system_store.data.systems[0];
    if (!system) return P.resolve();
    return P.fcall(function() {
            dbg.log0('LIFECYCLE READ BUCKETS configuration:', 'BEGIN');
            return system_store.refresh()
                .then(function() {
                    _.each(system_store.data.buckets, function(bucket, i) {
                        if (!bucket.lifecycle_configuration_rules || bucket.deleting) {
                            return;
                        }
                        P.all(_.map(bucket.lifecycle_configuration_rules, function(lifecycle_rule, j) {
                            dbg.log0('LIFECYCLE HANDLING BUCKET:', bucket.name, 'BEGIN');
                            var now = Date.now();
                            //If refresh time
                            if (!lifecycle_rule.last_sync) {
                                dbg.log0('LIFECYCLE HANDLING bucket:', bucket.name, 'rule id', lifecycle_rule.id,
                                    'status:', lifecycle_rule.status, ' setting yesterday time');
                                lifecycle_rule.last_sync = now - (1000 * 60 * 60 * 24); //set yesterday as last sync
                            }
                            dbg.log0('LIFECYCLE HANDLING bucket:', bucket.name, 'rule id(', j, ')', lifecycle_rule.id,
                                'status:', lifecycle_rule.status, 'last_sync',
                                Math.floor((now - lifecycle_rule.last_sync) / 1000 / 60), 'min ago.');

                            if ((lifecycle_rule.status === 'Enabled') &&
                                ((now - lifecycle_rule.last_sync) / 1000 / 60 > LIFECYCLE.schedule_min)) {
                                dbg.log0('LIFECYCLE PROCESSING bucket:', bucket.name, 'rule id(', j, ')', lifecycle_rule.id);
                                if ((lifecycle_rule.expiration.days) ||
                                    (lifecycle_rule.expiration.date < (new Date()).getTime())) {
                                    dbg.log0('LIFECYCLE DELETING bucket:', bucket.name, 'rule id(', j, ')', lifecycle_rule.id);
                                    let deletion_params = {
                                        bucket: bucket.name,
                                        prefix: lifecycle_rule.prefix,
                                    };
                                    // Delete objects with create time older than exipration days
                                    if (lifecycle_rule.expiration.days) {
                                        deletion_params.create_time = moment().subtract(lifecycle_rule.expiration.days, 'minutes')
                                            .unix();
                                        dbg.log0('LIFECYCLE DELETING bucket:', bucket.name, 'rule id(', j, ')',
                                            lifecycle_rule.id, ' Days:', lifecycle_rule.expiration.days, '==', deletion_params.create_time,
                                            '(', moment().subtract(lifecycle_rule.expiration.days, 'min'), ')');
                                    }
                                    return server_rpc.client.object.delete_multiple_objects_by_prefix(deletion_params, {
                                        auth_token: auth_server.make_auth_token({
                                            system_id: system._id,
                                            account_id: system.owner._id,
                                            role: 'admin'
                                        })
                                    }).then(function() {
                                        bucket.lifecycle_configuration_rules[j].last_sync = Date.now();
                                        dbg.log0('LIFECYCLE Done bucket:', bucket.name, ' done deletion of objects per prefix ',
                                            lifecycle_rule.prefix, ' time:', bucket.lifecycle_configuration_rules[j].last_sync);
                                    });
                                }
                            } else {
                                dbg.log0('LIFECYCLE NOTHING bucket:', bucket.name, 'rule id', lifecycle_rule.id, ' nothing to do');
                            }
                        })).then(() => {
                            dbg.log('LIFECYCLE SYNC TIME bucket ', bucket.name, ' SAVE last sync',
                                bucket.lifecycle_configuration_rules[0].last_sync);
                            update_lifecycle_rules_last_sync(bucket, bucket.lifecycle_configuration_rules);
                        });
                    });
                });
        })
        .catch(err => {
            dbg.error('LIFECYCLE FAILED processing', err, err.stack);
        })
        .then(function() {
            dbg.log0('LIFECYCLE:', 'END');
        });
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
