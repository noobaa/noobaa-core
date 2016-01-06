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
var AWS = require('aws-sdk');
var db = require('./db');
var object_server = require('./object_server');
var bg_worker = require('./server_rpc').bg_worker;
var cs_utils = require('./utils/cloud_sync_utils');
var dbg = require('../util/debug_module')(__filename);
var P = require('../util/promise');


/**
 *
 * CREATE_BUCKET
 *
 */
function create_bucket(req) {
    return resolve_tiering_policy(req.system.id, req.rpc_params.tiering)
        .then(function(tiering) {
            var info = _.pick(req.rpc_params, 'name');
            info.system = req.system.id;
            if (tiering) {
                info.tiering = tiering[0]._id;
            }
            info.stats = {
                reads: 0,
                writes: 0,
            };
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
        .then(function() {
            return P.when(read_bucket(req));
        });
}

/**
 *
 * READ_BUCKET
 *
 */
function read_bucket(req) {
    var by_system_id_undeleted = {
        system: req.system.id,
        deleted: null,
    };
    var reply = {};
    var associated_pools;

    return P.when(db.Bucket
            .findOne(get_bucket_query(req))
            .populate('tiering.tiers')
            .exec())
        .then(db.check_not_deleted(req, 'bucket'))
        .then(function(bucket) {
            return P.when(get_bucket_info(bucket))
                .then(function(info) {
                    reply = info;
                    // TODO read bucket's storage and objects info
                    var query_tiers = _.map(info.tiering.tiers, function(t) { //TODO: Multi tiers
                        return t.tier;
                    });
                    return P.when(db.Tier
                            .find({
                                system: req.system.id,
                                _id: {
                                    $in: query_tiers
                                },
                                deleted: null,
                            }))
                        .then(function(tiers) {
                            associated_pools = tiers[0].pools;
                            return P.when(db.Node.aggregate_nodes(by_system_id_undeleted, 'pool'));
                        });
                })
                .then(function(nodes_aggregated) {
                    var alloc = 0;
                    var used = 0;
                    var free = 0;
                    var total = 0;
                    _.each(associated_pools, function(p) {
                        var aggr = nodes_aggregated[p];
                        var replicas = 3; //TODO:: read from actual tier
                        alloc += (aggr && aggr.alloc) || 0;
                        used += (aggr && aggr.used) || 0;
                        total += ((aggr && aggr.total) || 0) / replicas;
                        free += ((aggr && aggr.free) || 0) / replicas;
                        reply.storage = {
                            alloc: alloc,
                            used: used,
                            total: total,
                            free: free,
                        };
                    });
                    return P.when(db.ObjectMD
                        .count({
                            system: req.system.id,
                            bucket: bucket.id,
                            deleted: null,
                        }));
                })
                .then(function(obj_count) {
                    reply.num_objects = obj_count;
                    return P.when(get_cloud_sync_policy(req));
                })
                .then(function(sync_policy) {
                    cs_utils.resolve_cloud_sync_info(sync_policy, reply);
                    return reply;
                });
        });
}



/**
 *
 * UPDATE_BUCKET
 *
 */
function update_bucket(req) {
    return resolve_tiering_policy(req.system.id, req.rpc_params.tiering)
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
            return P.when(bg_worker.cloud_sync.refresh_policy({
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
            .populate('tiering')
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
                return P.when(bg_worker.cloud_sync.get_policy_status({
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
                    return P.when(bg_worker.cloud_sync.get_policy_status({
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
            return P.when(bg_worker.cloud_sync.refresh_policy({
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
            return P.when(bg_worker.cloud_sync.refresh_policy({
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
        return P.when(db.TieringPolicy
                .find({
                    system: bucket.system,
                    _id: bucket.tiering,
                    deleted: null,
                }))
            .then(function(tiering) {
                reply.tiering = tiering[0]; //Always only one tiering policy
                return reply;
            });
    } else {
        return reply;
    }
}

function resolve_tiering_policy(system_id, tiering) {
    if (!tiering) return P.resolve();
    return P.when(db.TieringPolicy
            .find({
                system: system_id,
                name: tiering,
                deleted: null,
            })
            .exec())
        .then(function(tiering_policy) {
            if (!tiering_policy) {
                console.log('TIER POLICY NOT FOUND', tiering);
                throw new Error('missing tiering policy');
            }
            return tiering_policy;
        });
}
