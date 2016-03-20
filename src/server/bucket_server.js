/* jshint node:true */
'use strict';

/**
 *
 * BUCKET_SERVER
 *
 */

module.exports = {
    new_bucket_defaults: new_bucket_defaults,
    get_bucket_info: get_bucket_info,

    //Bucket Management
    create_bucket: create_bucket,
    read_bucket: read_bucket,
    update_bucket: update_bucket,
    delete_bucket: delete_bucket,
    list_buckets: list_buckets,
    generate_new_bucket_key: generate_new_bucket_key,

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
var crypto = require('crypto');
var object_server = require('./object_server');
var tier_server = require('./tier_server');
var server_rpc = require('./server_rpc');
var system_store = require('./stores/system_store');
var nodes_store = require('./stores/nodes_store');
var cloud_sync_utils = require('./utils/cloud_sync_utils');
var size_utils = require('../util/size_utils');
var mongo_utils = require('../util/mongo_utils');
var dbg = require('../util/debug_module')(__filename);
var P = require('../util/promise');
var js_utils = require('../util/js_utils');

const VALID_BUCKET_NAME_REGEXP = new RegExp(
    '^(([a-z]|[a-z][a-z0-9\-]*[a-z0-9])\\.)*' +
    '([a-z]|[a-z][a-z0-9\-]*[a-z0-9])$');

function new_bucket_defaults(name, system_id, tiering_policy_id, access_keys) {
    return {
        _id: system_store.generate_id(),
        name: name,
        system: system_id,
        tiering: tiering_policy_id,
        stats: {
            reads: 0,
            writes: 0,
        },
        access_keys: access_keys
    };
}



/**
 *
 * CREATE_BUCKET
 *
 */
function create_bucket(req) {
    if (!VALID_BUCKET_NAME_REGEXP.test(req.rpc_params.name)) {
        throw req.rpc_error('INVALID_BUCKET_NAME');
    }
    if (req.system.buckets_by_name[req.rpc_params.name]) {
        throw req.rpc_error('BUCKET_ALREADY_EXISTS');
    }
    let tiering_policy;
    let changes = {
        insert: {}
    };
    if (req.rpc_params.tiering) {
        tiering_policy = resolve_tiering_policy(req, req.rpc_params.tiering);
    } else {
        // we create dedicated tier and tiering policy for the new bucket
        // that uses the default_pool
        let default_pool = req.system.pools_by_name.default_pool;
        let bucket_with_suffix = req.rpc_params.name + '#' + Date.now().toString(36);
        let tier = tier_server.new_tier_defaults(
            bucket_with_suffix, req.system._id, [default_pool._id]);
        tiering_policy = tier_server.new_policy_defaults(
            bucket_with_suffix, req.system._id, [{
                tier: tier._id,
                order: 0
            }]);
        changes.insert.tieringpolicies = [tiering_policy];
        changes.insert.tiers = [tier];
    }
    let bucket = new_bucket_defaults(
        req.rpc_params.name,
        req.system._id,
        tiering_policy._id,
        req.system.access_keys[0]);
    changes.insert.buckets = [bucket];
    db.ActivityLog.create({
        event: 'bucket.create',
        level: 'info',
        system: req.system._id,
        actor: req.account && req.account._id,
        bucket: bucket._id,
    });
    return system_store.make_changes(changes)
        .then(function() {
            req.load_auth();
            let created_bucket = find_bucket(req);
            return get_bucket_info(created_bucket);
        });
}

/**
 *
 * READ_BUCKET
 *
 */
function read_bucket(req) {
    var bucket = find_bucket(req);
    var pools = _.flatten(_.map(bucket.tiering.tiers,
        tier_and_order => tier_and_order.tier.pools
    ));
    var pool_ids = mongo_utils.uniq_ids(pools, '_id');
    return P.join(
        // objects - size, count
        db.ObjectMD.aggregate_objects({
            system: req.system._id,
            bucket: bucket._id,
            deleted: null,
        }),
        nodes_store.aggregate_nodes_by_pool({
            system: req.system._id,
            pool: {
                $in: pool_ids
            },
            deleted: null,
        }),
        get_cloud_sync_policy(req, bucket)
    ).spread(function(objects_aggregate, nodes_aggregate_pool, cloud_sync_policy) {
        return get_bucket_info(bucket, objects_aggregate, nodes_aggregate_pool, cloud_sync_policy);
    });
}



/**
 *
 * UPDATE_BUCKET
 *
 */
function update_bucket(req) {
    var bucket = find_bucket(req);
    var tiering_policy = req.rpc_params.tiering &&
        resolve_tiering_policy(req, req.rpc_params.tiering);
    var updates = {
        _id: bucket._id
    };
    if (req.rpc_params.new_name) {
        updates.name = req.rpc_params.new_name;
    }
    if (tiering_policy) {
        updates.tiering = tiering_policy._id;
    }
    return system_store.make_changes({
        update: {
            buckets: [updates]
        }
    }).return();
}


function generate_new_bucket_key(req) {
    var bucket = find_bucket(req);

    if (!bucket) {
        throw req.rpc_error('INVALID_BUCKET_NAME');
    }

    var updates = {
        _id: bucket._id,
        access_keys: [{
            access_key: crypto.randomBytes(16).toString('hex'),
            secret_key: crypto.randomBytes(32).toString('hex'),
        }]
    };

    return system_store.make_changes({
        update: {
            buckets: [updates]
        }
    }).return();
}


/**
 *
 * DELETE_BUCKET
 *
 */
function delete_bucket(req) {
    var bucket = find_bucket(req);
    // TODO before deleting tier and tiering_policy need to check they are not in use
    let tiering_policy = bucket.tiering;
    let tier = tiering_policy.tiers[0].tier;
    if (_.map(req.system.buckets_by_name).length === 1) {
        throw req.rpc_error('BAD_REQUEST', 'Cannot delete last bucket');
    }
    db.ActivityLog.create({
        event: 'bucket.delete',
        level: 'info',
        system: req.system._id,
        actor: req.account && req.account._id,
        bucket: bucket._id,
    });
    return P.when(db.ObjectMD.aggregate_objects({
            system: req.system._id,
            bucket: bucket._id,
            deleted: null,
        }))
        .then(objects_aggregate => {
            objects_aggregate = objects_aggregate || {};
            var objects_aggregate_bucket = objects_aggregate[bucket._id] || {};
            if (objects_aggregate_bucket.count) {
                throw req.rpc_error('BUCKET_NOT_EMPTY', 'Bucket not empty: ' + bucket.name);
            }
            return system_store.make_changes({
                remove: {
                    buckets: [bucket._id],
                    tieringpolicies: [tiering_policy._id],
                    tiers: [tier._id]
                }
            });
        })
        .then(() => server_rpc.bg_client.cloud_sync.refresh_policy({
            sysid: req.system._id.toString(),
            bucketid: bucket._id.toString(),
            force_stop: true,
            bucket_deleted: true,
        }, {
            auth_token: req.auth_token
        }))
        .return();
}



/**
 *
 * LIST_BUCKETS
 *
 */
function list_buckets(req) {
    return {
        buckets: _.map(req.system.buckets_by_name, function(bucket) {
            return _.pick(bucket, 'name');
        })
    };
}

/**
 *
 * GET_CLOUD_SYNC_POLICY
 *
 */
function get_cloud_sync_policy(req, bucket) {
    dbg.log3('get_cloud_sync_policy');
    bucket = bucket || find_bucket(req);
    if (!bucket.cloud_sync || !bucket.cloud_sync.endpoint) {
        return {};
    }
    return P.when(server_rpc.bg_client.cloud_sync.get_policy_status({
            sysid: bucket.system._id.toString(),
            bucketid: bucket._id.toString()
        }, {
            auth_token: req.auth_token
        }))
        .then(res => {
            bucket.cloud_sync.status = res.status;
            let endpoint;
            if (bucket.cloud_sync.target_ip) {
                endpoint = bucket.cloud_sync.target_ip + ':/' + bucket.cloud_sync.endpoint;
            } else {
                endpoint = bucket.cloud_sync.endpoint;
            }
            return {
                name: bucket.name,
                health: res.health,
                status: cloud_sync_utils.resolve_cloud_sync_info(bucket.cloud_sync),
                policy: {
                    endpoint: endpoint,
                    access_keys: [bucket.cloud_sync.access_keys],
                    schedule: bucket.cloud_sync.schedule_min,
                    last_sync: (new Date(bucket.cloud_sync.last_sync)).getTime(),
                    paused: bucket.cloud_sync.paused,
                    c2n_enabled: bucket.cloud_sync.c2n_enabled,
                    n2c_enabled: bucket.cloud_sync.n2c_enabled,
                    additions_only: bucket.cloud_sync.additions_only
                }
            };
        });
}

/**
 *
 * GET_ALL_CLOUD_SYNC_POLICIES
 *
 */
function get_all_cloud_sync_policies(req) {
    return P.all(_.map(req.system.buckets_by_name,
        bucket => get_cloud_sync_policy(req, bucket)));
}

/**
 *
 * DELETE_CLOUD_SYNC
 *
 */
function delete_cloud_sync(req) {
    dbg.log2('delete_cloud_sync:', req.rpc_params.name, 'on', req.system._id);
    var bucket = find_bucket(req);
    dbg.log3('delete_cloud_sync: delete on bucket', bucket);
    return system_store.make_changes({
            update: {
                buckets: [{
                    _id: bucket._id,
                    $unset: {
                        cloud_sync: 1
                    }
                }]
            }
        })
        .then(function() {
            return server_rpc.bg_client.cloud_sync.refresh_policy({
                sysid: req.system._id.toString(),
                bucketid: bucket._id.toString(),
                force_stop: true,
            }, {
                auth_token: req.auth_token
            });
        })
        .then((res) => {
            db.ActivityLog.create({
                event: 'bucket.remove_cloud_sync',
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                bucket: bucket._id,
            });
            return res;
        })
        .return();
}

/**
 *
 * SET_CLOUD_SYNC
 *
 */
function set_cloud_sync(req) {
    let ip = '';
    var ip_bucket = req.rpc_params.policy.endpoint.split(':/');
    if (ip_bucket.length > 1) {
        // take first entry as ip, second entry as bucket (endpoint).
        // should we assume format (':/' separator) correctness?
        ip = ip_bucket[0];
        req.rpc_params.policy.endpoint = ip_bucket[1];
        dbg.log0('set_cloud_sync to ip:', ip, ' to bucket: ', req.rpc_params.policy.endpoint);
    }
    dbg.log0('set_cloud_sync:', req.rpc_params.name, 'on', req.system._id, 'with', req.rpc_params.policy);
    var bucket = find_bucket(req);
    var force_stop = false;
    //Verify parameters, bi-directional sync can't be set with additions_only
    if (req.rpc_params.policy.additions_only &&
        req.rpc_params.policy.n2c_enabled &&
        req.rpc_params.policy.c2n_enabled) {
        dbg.warn('set_cloud_sync bi-directional sync cant be set with additions_only');
        throw new Error('bi-directional sync cant be set with additions_only');
    }
    var cloud_sync = {
        endpoint: req.rpc_params.policy.endpoint,
        target_ip: ip,
        access_keys: {
            access_key: req.rpc_params.policy.access_keys[0].access_key,
            secret_key: req.rpc_params.policy.access_keys[0].secret_key
        },
        schedule_min: js_utils.default_value(req.rpc_params.policy.schedule, 60),
        last_sync: new Date(0),
        paused: js_utils.default_value(req.rpc_params.policy.paused, false),
        c2n_enabled: js_utils.default_value(req.rpc_params.policy.c2n_enabled, true),
        n2c_enabled: js_utils.default_value(req.rpc_params.policy.n2c_enabled, true),
        additions_only: js_utils.default_value(req.rpc_params.policy.additions_only, false)
    };

    if (bucket.cloud_sync) {
        //If either of the following is changed, signal the cloud sync worker to force stop and reload
        if (bucket.cloud_sync.endpoint !== cloud_sync.endpoint ||
            bucket.cloud_sync.target_ip !== cloud_sync.target_ip ||
            bucket.cloud_sync.access_keys.access_key !== cloud_sync.access_keys.access_key ||
            bucket.cloud_sync.access_keys.secret_key !== cloud_sync.access_keys.secret_key ||
            cloud_sync.paused) {
            force_stop = true;
        }
    }

    return system_store.make_changes({
            update: {
                buckets: [{
                    _id: bucket._id,
                    cloud_sync: cloud_sync
                }]
            }
        })
        .then(function() {
            //TODO:: scale, fine for 1000 objects, not for 1M
            return object_server.set_all_files_for_sync(req.system._id, bucket._id);
        })
        .then(function() {
            return server_rpc.bg_client.cloud_sync.refresh_policy({
                sysid: req.system._id.toString(),
                bucketid: bucket._id.toString(),
                force_stop: force_stop,
            }, {
                auth_token: req.auth_token
            });
        })
        .then((res) => {
            db.ActivityLog.create({
                event: 'bucket.set_cloud_sync',
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                bucket: bucket._id,
            });
            return res;
        })
        .catch(function(err) {
            dbg.error('Error setting cloud sync', err, err.stack);
            throw err;
        })
        .return();
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
    }).catch(function(err) {
        dbg.error("get_cloud_buckets ERROR", err.stack || err);
        throw err;
    });

}


// UTILS //////////////////////////////////////////////////////////


function find_bucket(req) {
    var bucket = req.system.buckets_by_name[req.rpc_params.name];
    if (!bucket) {
        dbg.error('BUCKET NOT FOUND', req.rpc_params.name);
        throw req.rpc_error('NO_SUCH_BUCKET', 'No such bucket: ' + req.rpc_params.name);
    }
    return bucket;
}

function get_bucket_info(bucket, objects_aggregate, nodes_aggregate_pool, cloud_sync_policy) {
    var info = _.pick(bucket, 'name');
    objects_aggregate = objects_aggregate || {};
    var objects_aggregate_bucket = objects_aggregate[bucket._id] || {};
    if (bucket.tiering) {
        info.tiering = tier_server.get_tiering_policy_info(bucket.tiering, nodes_aggregate_pool);
    }

    info.num_objects = objects_aggregate_bucket.count || 0;
    info.storage = size_utils.to_bigint_storage({
        used: objects_aggregate_bucket.size || 0,
        total: info.tiering && info.tiering.storage && info.tiering.storage.total || 0,
        free: info.tiering && info.tiering.storage && info.tiering.storage.free || 0,
    });
    info.cloud_sync_status = _.isEmpty(cloud_sync_policy) ? 'NOTSET' : cloud_sync_policy.status;
    info.access_keys = bucket.access_keys;
    return info;
}

function resolve_tiering_policy(req, policy_name) {
    var tiering_policy = req.system.tiering_policies_by_name[policy_name];
    if (!tiering_policy) {
        dbg.error('TIER POLICY NOT FOUND', policy_name);
        throw req.rpc_error('INVALID_BUCKET_STATE', 'Bucket tiering policy not found');
    }
    return tiering_policy;
}
