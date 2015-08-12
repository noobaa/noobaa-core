/* jshint node:true */
'use strict';

var _ = require('lodash');
var Q = require('q');
var db = require('./db');
var dbg = require('noobaa-util/debug_module')(__filename);

/**
 *
 * BUCKET_SERVER
 *
 */
var bucket_server = {
    create_bucket: create_bucket,
    read_bucket: read_bucket,
    update_bucket: update_bucket,
    delete_bucket: delete_bucket,
    list_buckets: list_buckets,

    //Cloud Sync policies
    cloud_sync_policies: cloud_sync_policies,
    delete_cloud_sync: delete_cloud_sync,
    set_cloud_sync: set_cloud_sync
};

module.exports = bucket_server;



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
            console.log('create bucket:', bucket);
            return db.ActivityLog.create({
                system: req.system,
                level: 'info',
                event: 'bucket.create',
                bucket: bucket,
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
    return Q.when(db.Bucket
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
    return Q.when(db.Bucket
            .findOneAndUpdate(get_bucket_query(req), updates)
            .exec())
        .then(function(bucket_info) {
            return db.ActivityLog.create({
                system: req.system,
                level: 'info',
                event: 'bucket.delete',
                bucket: bucket_info,
            });
        })
        .then(db.check_not_found(req, 'bucket'))
        .thenResolve();
}



/**
 *
 * LIST_BUCKETS
 *
 */
function list_buckets(req) {
    return Q.when(db.Bucket
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
 * CLOUD_SYNC_POLICIES
 *
 */
function cloud_sync_policies(req) {
    dbg.log3('cloud_sync_policies');
    var reply = [];
    return Q.when(db.Bucket
            .find({
                system: req.system.id,
                deleted: null,
            })
            .exec())
        .then(function(buckets) {
            _.each(buckets, function(bucket, i) {
                if (bucket.cloud_sync.endpoint) {
                    reply.push({
                        name: bucket.name,
                        policy: {
                            endpoint: bucket.cloud_sync.endpoint,
                            access_keys: bucket.cloud_sync.access_keys,
                            schedule: bucket.cloud_sync.schedule,
                            last_sync: bucket.cloud_sync.last_sync
                        }
                    });
                }
            });
            return {
                cloud_sync_policies: reply
            };
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
    return Q.when(db.Bucket
            .find({
                system: req.system.id,
                name: req.rpc_params.name,
                deleted: null,
            })
            .exec())
        .then(function(bucket) {
            dbg.log3('delete_cloud_sync: delete on bucket', bucket);
            return Q.when(db.Bucket
                .findOneAndUpdate(get_bucket_query(req), updates)
                .exec());
        });
}

/**
 *
 * SET_CLOUD_SYNC
 *
 */
function set_cloud_sync(req) {
    dbg.log2('set_cloud_sync:', req.rpc_params.name, 'on', req.system.id, 'with', req.rpc_params.policy);
    var updates = {
        cloud_sync: {
            endpoint: req.rpc_params.policy.endpoint,
            access_keys: {
                access_key: req.rpc_params.policy.access_keys.acces_key,
                secret_key: req.rpc_params.policy.access_keys.secret_key
            },
            schedule: req.rpc_params.policy.schedule,
        }
    };
    return Q.when(db.Bucket
            .find({
                system: req.system.id,
                name: req.rpc_params.name,
                deleted: null,
            })
            .exec())
        .then(function(bucket) {
            return Q.when(db.Bucket
                .findOneAndUpdate(get_bucket_query(req), updates)
                .exec());
        })
        .thenResolve();
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
    if (!tiering) return Q.resolve();
    return Q.when(db.Tier
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
