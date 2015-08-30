/* jshint node:true */
'use strict';

/**
 *
 * BUCKET_SERVER
 *
 */

module.exports = {
    //Bucket Management
    create_bucket: create_bucket,
    read_bucket: read_bucket,
    update_bucket: update_bucket,
    delete_bucket: delete_bucket,
    list_buckets: list_buckets,

    //Cloud Sync policies
    get_cloud_sync_policy: get_cloud_sync_policy,
    get_all_cloud_sync_policies: get_all_cloud_sync_policies,
    delete_cloud_sync: delete_cloud_sync,
    set_cloud_sync: set_cloud_sync,

    //Temporary - TODO: move to new server
    get_cloud_buckets: get_cloud_buckets
};

var _ = require('lodash');
var P = require('../util/promise');
var AWS = require('aws-sdk');
var db = require('./db');
var object_server = require('./object_server');
var bg_workers_rpc = require('./server_rpc').bg_workers_rpc;
var promise_utils = require('../util/promise_utils');
var dbg = require('../util/debug_module')(__filename);


/**
 *
 * CREATE_BUCKET
 *
 */
function create_bucket(req) {
    return resolve_tiering(req.system.id, req.rpc_params.tiering)
        .then(function(tiering) {
            var info = _.pick(req.rpc_params, 'name');
            info.system = req.system.id;
            if (tiering) {
                info.tiering = tiering;
            }
            return db.Bucket.create(info);
        })
        .then(function(bucket) {
            console.log('create bucket:', bucket, 'account', req.account.id);
            return db.ActivityLog.create({
                system: req.system,
                level: 'info',
                event: 'bucket.create',
                bucket: bucket,
                actor: req.account.id
            });
        })
        .then(null, db.check_already_exists(req, 'bucket'))
        .thenResolve();
}

/**
 *
 * READ_BUCKET
 *
 */
function read_bucket(req) {
    return P.when(db.Bucket
            .findOne(get_bucket_query(req))
            .populate('tiering.tier')
            .exec())
        .then(db.check_not_deleted(req, 'bucket'))
        .then(function(bucket) {
            var reply = get_bucket_info(bucket);
            // TODO read bucket's storage and objects info
            reply.storage = {
                alloc: 0,
                used: 0,
            };
            reply.num_objects = 0;
            return reply;
        });
}



/**
 *
 * UPDATE_BUCKET
 *
 */
function update_bucket(req) {
    return resolve_tiering(req.system.id, req.rpc_params.tiering)
        .then(function(tiering) {
            var updates = {};
            if (req.rpc_params.new_name) {
                updates.name = req.rpc_params.new_name;
            }
            if (tiering) {
                updates.tiering = tiering;
            }
            return db.Bucket
                .findOneAndUpdate(get_bucket_query(req), updates)
                .exec();
        })
        .then(db.check_not_deleted(req, 'bucket'))
        .thenResolve();
}



/**
 *
 * DELETE_BUCKET
 *
 */
function delete_bucket(req) {
    var updates = {
        deleted: new Date()
    };
    var bucketid;
    return P.when(db.Bucket
            .findOneAndUpdate(get_bucket_query(req), updates)
            .exec())
        .then(function(bucket_info) {
            bucketid = bucket_info._id;
            return db.ActivityLog.create({
                system: req.system,
                level: 'info',
                event: 'bucket.delete',
                bucket: bucket_info,
                actor: req.account.id
            });
        })
        .then(db.check_not_found(req, 'bucket'))
        .then(function() {
            return Q.when(bg_workers_rpc.client.cloud_sync.refresh_policy({
                sysid: req.system.id,
                bucketid: bucketid.toString(),
                force_stop: true,
            }));
        })
        .thenResolve();
}



/**
 *
 * LIST_BUCKETS
 *
 */
function list_buckets(req) {
    return P.when(db.Bucket
            .find({
                system: req.system.id,
                deleted: null,
            })
            .populate('tiering.tier')
            .exec())
        .then(function(buckets) {
            return {
                buckets: _.map(buckets, function(bucket) {
                    return _.pick(bucket, 'name');
                })
            };
        });
}

/**
 *
 * GET_CLOUD_SYNC_POLICY
 *
 */
function get_cloud_sync_policy(req) {
    dbg.log3('get_cloud_sync_policy');
    var reply = [];
    return P.when(db.Bucket
            .findOne({
                system: req.system.id,
                name: req.rpc_params.name,
                deleted: null,
            })
            .exec())
        .then(function(b) {
            var bucket = b;
            if (bucket.cloud_sync && bucket.cloud_sync.endpoint) {
                return Q.when(bg_workers_rpc.client.cloud_sync.get_policy_status({
                        sysid: req.system.id,
                        bucketid: bucket._id.toString()
                    }))
                    .then(function(stat) {
                        reply = {
                            name: bucket.name,
                            policy: {
                                endpoint: bucket.cloud_sync.endpoint,
                                access_keys: [bucket.cloud_sync.access_keys],
                                schedule: bucket.cloud_sync.schedule_min,
                                last_sync: bucket.cloud_sync.last_sync.getTime(),
                                paused: bucket.cloud_sync.paused,
                                c2n_enabled: bucket.cloud_sync.c2n_enabled,
                                n2c_enabled: bucket.cloud_sync.n2c_enabled,
                                additions_only: bucket.cloud_sync.additions_only
                            },
                            health: stat.health,
                            status: stat.status,
                        };

                        return reply;
                    });
            } else {
                return {};
            }
        });
}

/**
 *
 * GET_ALL_CLOUD_SYNC_POLICIES
 *
 */
function get_all_cloud_sync_policies(req) {
    dbg.log3('get_all_cloud_sync_policies');
    var reply = [];
    return P.when(db.Bucket
            .find({
                system: req.system.id,
                deleted: null,
            })
            .exec())
        .then(function(buckets) {
            _.each(buckets, function(bucket, i) {
                if (bucket.cloud_sync.endpoint) {
                    return Q.when(bg_workers_rpc.client.cloud_sync.get_policy_status({
                            sysid: req.system.id,
                            bucketid: bucket._id.toString()
                        }))
                        .then(function(stat) {
                            reply.push({
                                name: bucket.name,
                                policy: {
                                    endpoint: bucket.cloud_sync.endpoint,
                                    access_keys: [bucket.cloud_sync.access_keys],
                                    schedule: bucket.cloud_sync.schedule_min,
                                    last_sync: bucket.cloud_sync.last_sync.getTime(),
                                    paused: bucket.cloud_sync.paused,
                                    c2n_enabled: bucket.cloud_sync.c2n_enabled,
                                    n2c_enabled: bucket.cloud_sync.n2c_enabled,
                                    additions_only: bucket.cloud_sync.additions_only
                                },
                                health: stat.health,
                                status: stat.status,
                            });
                        });
                }
            });
            return reply;
        });
}

/**
 *
 * DELETE_CLOUD_SYNC
 *
 */
function delete_cloud_sync(req) {
    dbg.log2('delete_cloud_sync:', req.rpc_params.name, 'on', req.system.id);
    var updates = {
        cloud_sync: {}
    };
    var bucketid;
    return P.when(db.Bucket
            .findOne({
                system: req.system.id,
                name: req.rpc_params.name,
                deleted: null,
            })
            .exec())
        .then(function(bucket) {
            bucketid = bucket._id;
            dbg.log3('delete_cloud_sync: delete on bucket', bucket);
            return P.when(db.Bucket
                .findOneAndUpdate(get_bucket_query(req), updates)
                .exec());
        })
        .then(function() {
            return Q.when(bg_workers_rpc.client.cloud_sync.refresh_policy({
                sysid: req.system.id,
                bucketid: bucketid.toString(),
                force_stop: true,
            }));
        })
        .thenResolve();
}

/**
 *
 * SET_CLOUD_SYNC
 *
 */
function set_cloud_sync(req) {
    dbg.log0('set_cloud_sync:', req.rpc_params.name, 'on', req.system.id, 'with', req.rpc_params.policy);
    var bucket;
    var force_stop = false;
    //Verify parameters, bi-directional sync can't be set with additions_only
    if (req.rpc_params.policy.additions_only &&
        req.rpc_params.policy.n2c_enabled &&
        req.rpc_params.policy.c2n_enabled) {
        dbg.warn('set_cloud_sync bi-directional sync cant be set with additions_only');
        throw new Error('bi-directional sync cant be set with additions_only');
    }
    var updates = {
        cloud_sync: {
            endpoint: req.rpc_params.policy.endpoint,
            access_keys: {
                access_key: req.rpc_params.policy.access_keys[0].access_key,
                secret_key: req.rpc_params.policy.access_keys[0].secret_key
            },
            schedule_min: req.rpc_params.policy.schedule,
            last_sync: 0,
            paused: req.rpc_params.policy.paused,
            c2n_enabled: req.rpc_params.policy.c2n_enabled,
            n2c_enabled: req.rpc_params.policy.n2c_enabled,
            additions_only: req.rpc_params.policy.additions_only
        }
    };

    return P.when(db.Bucket
            .findOne({
                system: req.system.id,
                name: req.rpc_params.name,
                deleted: null,
            })
            .exec())
        .then(function(b) {
            bucket = b;
            //If either of the following is changed, signal the cloud sync worker to force stop and reload
            if (bucket.cloud_sync.endpoint !== updates.cloud_sync.endpoint ||
                bucket.cloud_sync.access_keys.access_key !== updates.cloud_sync.access_keys.access_key ||
                bucket.cloud_sync.access_keys.secret_key !== updates.cloud_sync.access_keys.secret_key ||
                updates.cloud_sync.paused) {
                force_stop = true;
            }
            return P.when(db.Bucket
                .findOneAndUpdate(get_bucket_query(req), updates)
                .exec());
        })
        .then(function() {
            //TODO:: scale, fine for 1000 objects, not for 1M
            return object_server.set_all_files_for_sync(req.system.id, bucket._id);
        })
        .then(function() {
            return Q.when(bg_workers_rpc.client.cloud_sync.refresh_policy({
                sysid: req.system.id,
                bucketid: bucket._id.toString(),
                force_stop: force_stop,
            }));
        })
        .then(function() {
            return;
        }).then(null, function(err) {
            dbg.error('Error setting cloud sync', err, err.stack);
            throw new Error(err.message);
        })
        .thenResolve();
}


/**
 *
 * GET_CLOUD_BUCKETS
 *
 */
function get_cloud_buckets(req) {
    var buckets = [];
    return P.fcall(function() {
        var s3 = new AWS.S3({
            accessKeyId: req.rpc_params.access_key,
            secretAccessKey: req.rpc_params.secret_key,
            sslEnabled: false
        });
        return P.ninvoke(s3, "listBuckets");
    }).then(function(data) {
        _.each(data.Buckets, function(bucket) {
            buckets.push(bucket.Name);
        });
        return buckets;
    }).then(null, function(err) {
        console.log("Error:", err.message);
        throw new Error(err.message);
    });

}


// UTILS //////////////////////////////////////////////////////////


function get_bucket_query(req) {
    return {
        system: req.system.id,
        name: req.rpc_params.name,
        deleted: null,
    };
}

function get_bucket_info(bucket) {
    var reply = _.pick(bucket, 'name');
    if (bucket.tiering) {
        reply.tiering = _.map(bucket.tiering, function(t) {
            return t.tier.name;
        });
    }
    return reply;
}

function resolve_tiering(system_id, tiering) {
    if (!tiering) return P.resolve();
    return P.when(db.Tier
            .find({
                system: system_id,
                name: {
                    $in: tiering
                },
                deleted: null,
            })
            .exec())
        .then(function(tiers) {
            var tiers_by_name = _.indexBy(tiers, 'name');
            return _.map(tiering, function(name) {
                var tier = tiers_by_name[name];
                if (!tier) {
                    console.log('TIER NOT FOUND', name);
                    throw new Error('missing tier');
                }
                return {
                    tier: tier
                };
            });
        });
}
