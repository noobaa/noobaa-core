'use strict';

module.exports = {
    background_worker: background_worker,
};

var _ = require('lodash');
var P = require('../util/promise');
var system_store = require('../server/stores/system_store');
var api = require('../api');
var dbg = require('../util/debug_module')(__filename);
var moment = require('moment');


var rpc = api.new_rpc();
var rpc_client = rpc.new_client();

//TODO: remove!!! handle BG RPC better asap
var S3Auth = require('aws-sdk/lib/signers/s3');
var s3 = new S3Auth();



var LIFECYCLE = {
    schedule_min: 5 //run every 5 minutes
};

/*
 *************** Cloud Sync Background Worker & Other Eports
 */
function background_worker() {
    return P.fcall(function() {
            dbg.log0('LIFECYCLE READ BUCKETS configuration:', 'BEGIN');
            return system_store.refresh()
                .then(function() {
                    //TODO:
                    //Replace asap with bg call
                    dbg.log0('sys store', system_store.data.accounts[1]);

                    var basic_auth_params = {
                        system: system_store.data.systems[0].name,
                        role: 'admin'
                    };
                    var secret_key = system_store.data.accounts[1].access_keys[0].secret_key;
                    var auth_params_str = JSON.stringify(basic_auth_params);
                    var signature = s3.sign(secret_key, auth_params_str);
                    var auth_params = {
                        access_key: system_store.data.accounts[1].access_keys[0].access_key,
                        string_to_sign: auth_params_str,
                        signature: signature,
                    };
                    dbg.log0('create_access_key_auth', auth_params);
                    return rpc_client.create_access_key_auth(auth_params);
                })
                .then(function() {
                    _.each(system_store.data.buckets, function(bucket, i) {
                        if (!bucket.lifecycle_configuration_rules) {
                            return;
                        }
                        P.all(_.map(bucket.lifecycle_configuration_rules, function(lifecycle_rule, i) {
                            dbg.log0('LIFECYCLE HANDLING BUCKET:', bucket.name, 'BEGIN');
                            var now = Date.now();
                            //If refresh time
                            if (!lifecycle_rule.last_sync) {
                                dbg.log0('LIFECYCLE HANDLING bucket:', bucket.name, 'rule id', lifecycle_rule.id, 'status:', lifecycle_rule.status, ' setting yesterday time');
                                lifecycle_rule.last_sync = now - 1000 * 60 * 60 * 24; //set yesterday as last sync
                            }
                            dbg.log0('LIFECYCLE HANDLING bucket:', bucket.name, 'rule id(', i, ')', lifecycle_rule.id, 'status:', lifecycle_rule.status, 'last_sync', Math.floor((now - lifecycle_rule.last_sync) / 1000 / 60), 'min ago.');

                            if ((lifecycle_rule.status === 'Enabled') &&
                                ((now - lifecycle_rule.last_sync) / 1000 / 60 > LIFECYCLE.schedule_min)) {
                                dbg.log0('LIFECYCLE PROCESSING bucket:', bucket.name, 'rule id(', i, ')', lifecycle_rule.id);
                                if ((lifecycle_rule.expiration.days) ||
                                    (lifecycle_rule.expiration.date < (new Date()).getTime())) {
                                    dbg.log0('LIFECYCLE DELETING bucket:', bucket.name, 'rule id(', i, ')', lifecycle_rule.id);
                                    let deletion_params = {
                                        bucket: bucket.name,
                                        prefix: lifecycle_rule.prefix,
                                    };
                                    // Delete objects with create time older than exipration days
                                    if (lifecycle_rule.expiration.days) {
                                        deletion_params.create_time = moment().subtract(lifecycle_rule.expiration.days, 'days').unix();
                                        dbg.log0('LIFECYCLE DELETING bucket:', bucket.name, 'rule id(', i, ')', lifecycle_rule.id, ' Days:',lifecycle_rule.expiration.days,'==',deletion_params.create_time,'(',moment().subtract(lifecycle_rule.expiration.days, 'min'),')');
                                    }
                                    return P.when(rpc_client.object.delete_multiple_objects_by_prefix(deletion_params).then(function() {
                                        bucket.lifecycle_configuration_rules[i].last_sync = Date.now();
                                        dbg.log0('LIFECYCLE Done bucket:', bucket.name, ' done deletion of objects per prefix ', lifecycle_rule.prefix, ' time:', bucket.lifecycle_configuration_rules[i].last_sync);
                                    }));
                                }
                            } else {
                                dbg.log0('LIFECYCLE NOTHING bucket:', bucket.name, 'rule id', lifecycle_rule.id, ' nothing to do');
                            }
                        })).then(() => {
                            dbg.log('LIFECYCLE SYNC TIME bucket ', bucket.name, ' SAVE last sync', bucket.lifecycle_configuration_rules[0].last_sync);
                            update_lifecycle_rules_last_sync(bucket, bucket.lifecycle_configuration_rules);
                        });
                    });
                });
        })
        .fail(function(error) {
            dbg.error('LIFECYCLE FAILED processing', error, error.stack);
        })
        .then(function() {
            dbg.log0('LIFECYCLE:', 'END');
            return;
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
