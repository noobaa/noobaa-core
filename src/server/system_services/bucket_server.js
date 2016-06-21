/**
 *
 * BUCKET_SERVER
 *
 */
'use strict';

const _ = require('lodash');
const AWS = require('aws-sdk');
const net = require('net');
const https = require('https');
// const crypto = require('crypto');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const md_store = require('../object_services/md_store');
const js_utils = require('../../util/js_utils');
const RpcError = require('../../rpc/rpc_error');
const size_utils = require('../../util/size_utils');
const server_rpc = require('../server_rpc');
const tier_server = require('./tier_server');
const mongo_utils = require('../../util/mongo_utils');
const ActivityLog = require('../analytic_services/activity_log');
const nodes_store = require('../node_services/nodes_store').get_instance();
const system_store = require('../system_services/system_store').get_instance();
const object_server = require('../object_services/object_server');
const cloud_sync_utils = require('../utils/cloud_sync_utils');

const VALID_BUCKET_NAME_REGEXP =
    /^(([a-z0-9]|[a-z0-9][a-z0-9\-]*[a-z0-9])\.)*([a-z0-9]|[a-z0-9][a-z0-9\-]*[a-z0-9])$/;


function new_bucket_defaults(name, system_id, tiering_policy_id) {
    return {
        _id: system_store.generate_id(),
        name: name,
        system: system_id,
        tiering: tiering_policy_id,
        stats: {
            reads: 0,
            writes: 0,
        }
    };
}

/**
 *
 * CREATE_BUCKET
 *
 */
function create_bucket(req) {
    if (req.rpc_params.name.length < 3 ||
        req.rpc_params.name.length > 63 ||
        net.isIP(req.rpc_params.name) ||
        !VALID_BUCKET_NAME_REGEXP.test(req.rpc_params.name)) {
        throw new RpcError('INVALID_BUCKET_NAME');
    }
    if (req.system.buckets_by_name[req.rpc_params.name]) {
        throw new RpcError('BUCKET_ALREADY_EXISTS');
    }
    let tiering_policy;
    let changes = {
        insert: {},
        update: {}
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
        tiering_policy._id);
    changes.insert.buckets = [bucket];
    ActivityLog.create({
        event: 'bucket.create',
        level: 'info',
        system: req.system._id,
        actor: req.account && req.account._id,
        bucket: bucket._id,
        desc: `${bucket.name} was created by ${req.account && req.account.email}`,
    });

    // Grant the account a full access for the newly created bucket.
    changes.update.accounts = [{
        _id: req.account._id,
        allowed_buckets: req.account.allowed_buckets
            .map(bkt => bkt._id)
            .concat(bucket._id),
    }];

    return system_store.make_changes(changes)
        .then(() => {
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
        md_store.aggregate_objects({
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
        get_cloud_sync(req, bucket)
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

// TODO Removed by request of Ohad, because seems like we won't be using it
/*function generate_bucket_access(req) {
    var bucket = find_bucket(req);

    if (!bucket) {
        throw new RpcError('INVALID_BUCKET_NAME');
    }
    var account_email = req.system.name + system_store.data.accounts.length + '@noobaa.com';
    //console.warn('Email Generated: ', account_email);
    return server_rpc.client.account.create_account({
            name: req.system.name,
            email: account_email,
            password: crypto.randomBytes(16).toString('hex')
        }, {
            auth_token: req.auth_token
        })
        .then(() => {
            //console.warn('Account Created');set
            return server_rpc.client.account.update_buckets_permissions({
                email: account_email,
                allowed_buckets: [{
                    bucket_name: bucket.name,
                    is_allowed: true
                }]
            }, {
                auth_token: req.auth_token
            });
        })
        .then(() => {
            //console.warn('Permissions Created');
            return server_rpc.client.account.generate_account_keys({
                email: account_email
            }, {
                auth_token: req.auth_token
            });
        })
        .then(res => res[0]);
}*/

function list_bucket_s3_acl(req) {
    let bucket = find_bucket(req);
    return system_store.data.accounts
        .filter(
            account => !account.is_support && account.allowed_buckets
        )
        .map(
            account => {
                return {
                    account: account.email,
                    is_allowed: _.includes(account.allowed_buckets, bucket)
                };
            }
        );
}

function update_bucket_s3_acl(req) {
    let bucket = find_bucket(req);
    // This is a hack not proud of it
    let original_bucket_accounts = list_bucket_s3_acl(req)
        .filter(acl => acl.is_allowed)
        .map(acl => acl.account);
    let updates = req.rpc_params.access_control
        .map(
            record => {
                let account = system_store.data.accounts_by_email[record.account];
                let allowed_buckets = record.is_allowed ?
                    _.unionWith(account.allowed_buckets, [bucket], system_store.has_same_id) :
                    _.differenceWith(account.allowed_buckets, [bucket], system_store.has_same_id);

                return {
                    _id: account._id,
                    allowed_buckets: allowed_buckets.map(bkt => bkt._id)
                };
            }
        );

    system_store.make_changes({
            update: {
                accounts: updates
            }
        })
        .then(() => {
            let new_allowed_accounts = req.rpc_params.access_control.filter(acl => acl.is_allowed).map(acl => acl.account);
            let desc_string = [];
            let added_accounts = [];
            let removed_accounts = [];
            desc_string.push(`${bucket.name} S3 access was updated by ${req.account && req.account.email}`);
            added_accounts = _.difference(new_allowed_accounts, original_bucket_accounts);
            removed_accounts = _.difference(original_bucket_accounts, new_allowed_accounts);
            if (added_accounts.length) {
                desc_string.push(`Added accounts: ${added_accounts}`);
            }
            if (removed_accounts.length) {
                desc_string.push(`Removed accounts: ${removed_accounts}`);
            }
            ActivityLog.create({
                event: 'bucket.s3_access_updated',
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                bucket: bucket._id,
                desc: desc_string.join('\n'),
            });
        })
        .return();
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
        throw new RpcError('BAD_REQUEST', 'Cannot delete last bucket');
    }

    return P.resolve(md_store.aggregate_objects({
            system: req.system._id,
            bucket: bucket._id,
            deleted: null,
        }))
        .then(objects_aggregate => {
            objects_aggregate = objects_aggregate || {};
            var objects_aggregate_bucket = objects_aggregate[bucket._id] || {};
            if (objects_aggregate_bucket.count) {
                throw new RpcError('BUCKET_NOT_EMPTY', 'Bucket not empty: ' + bucket.name);
            }
            ActivityLog.create({
                event: 'bucket.delete',
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                bucket: bucket._id,
                desc: `${bucket.name} was deleted by ${req.account && req.account.email}`,
            });
            return system_store.make_changes({
                remove: {
                    buckets: [bucket._id],
                    tieringpolicies: [tiering_policy._id],
                    tiers: [tier._id]
                }
            });
        })
        .then(() => server_rpc.client.cloud_sync.refresh_policy({
            sysid: req.system._id.toString(),
            bucketid: bucket._id.toString(),
            force_stop: true,
            skip_load: true,
        }, {
            auth_token: req.auth_token
        }))
        .then(res => {
            //TODO NEED TO INSERT CODE THAT DELETES BUCKET ID FROM ALL ACCOUNT PERMISSIONS;
            return res;
        })
        .return();
}



/**
 *
 * LIST_BUCKETS
 *
 */
function list_buckets(req) {
    var buckets_by_name = _.filter(
        req.system.buckets_by_name,
        bucket => req.has_bucket_permission(bucket)
    );
    return {
        buckets: _.map(buckets_by_name, function(bucket) {
            return _.pick(bucket, 'name');
        })
    };
}

/**
 *
 * GET_CLOUD_SYNC_POLICY
 *
 */
function get_cloud_sync(req, bucket) {
    dbg.log3('get_cloud_sync');
    bucket = bucket || find_bucket(req);
    if (!bucket.cloud_sync || !bucket.cloud_sync.target_bucket) {
        return {};
    }
    return P.resolve(server_rpc.client.cloud_sync.get_policy_status({
            sysid: bucket.system._id.toString(),
            bucketid: bucket._id.toString()
        }, {
            auth_token: req.auth_token
        }))
        .then(res => {
            bucket.cloud_sync.status = res.status;
            bucket.cloud_sync.health = res.health;

            return {
                name: bucket.name,
                endpoint: bucket.cloud_sync.endpoint,
                access_key: bucket.cloud_sync.access_keys.access_key,
                health: res.health,
                status: cloud_sync_utils.resolve_cloud_sync_info(bucket.cloud_sync),
                last_sync: bucket.cloud_sync.last_sync.getTime(),
                target_bucket: bucket.cloud_sync.target_bucket,
                policy: {
                    schedule_min: bucket.cloud_sync.schedule_min,
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
function get_all_cloud_sync(req) {
    return P.all(_.map(req.system.buckets_by_name,
        bucket => get_cloud_sync(req, bucket)));
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
            return server_rpc.client.cloud_sync.refresh_policy({
                sysid: req.system._id.toString(),
                bucketid: bucket._id.toString(),
                force_stop: true,
                skip_load: true
            }, {
                auth_token: req.auth_token
            });
        })
        .then(res => {
            ActivityLog.create({
                event: 'bucket.remove_cloud_sync',
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                bucket: bucket._id,
                desc: `Cloud sync was removed from ${bucket.name} by ${req.account && req.account.name}`,
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
    dbg.log0('set_cloud_sync:', req.rpc_params);

    var connection = find_cloud_sync_connection(req);
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
        endpoint: connection.endpoint,
        target_bucket: req.rpc_params.target_bucket,
        access_keys: {
            access_key: connection.access_key,
            secret_key: connection.secret_key
        },
        schedule_min: js_utils.default_value(req.rpc_params.policy.schedule_min, 60),
        last_sync: new Date(0),
        paused: false,
        c2n_enabled: js_utils.default_value(req.rpc_params.policy.c2n_enabled, true),
        n2c_enabled: js_utils.default_value(req.rpc_params.policy.n2c_enabled, true),
        additions_only: js_utils.default_value(req.rpc_params.policy.additions_only, false)
    };

    if (bucket.cloud_sync) {
        //If either of the following is changed, signal the cloud sync worker to force stop and reload
        if (bucket.cloud_sync.endpoint !== cloud_sync.endpoint ||
            bucket.cloud_sync.target_bucket !== cloud_sync.target_bucket ||
            bucket.cloud_sync.access_keys.access_key !== cloud_sync.access_keys.access_key ||
            bucket.cloud_sync.access_keys.secret_key !== cloud_sync.access_keys.secret_key) {
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
            return server_rpc.client.cloud_sync.refresh_policy({
                sysid: req.system._id.toString(),
                bucketid: bucket._id.toString(),
                force_stop: force_stop,
            }, {
                auth_token: req.auth_token
            });
        })
        .then(res => {
            let desc_string = [];
            let sync_direction;
            if (cloud_sync.c2n_enabled && cloud_sync.n2c_enabled) {
                sync_direction = 'Bi-Directional';
            } else if (cloud_sync.c2n_enabled) {
                sync_direction = 'Target To Source';
            } else if (cloud_sync.n2c_enabled) {
                sync_direction = 'Source To Target';
            } else {
                sync_direction = 'None';
            }
            desc_string.push(`Cloud sync was set in ${bucket.name}:`);
            desc_string.push(`Connection details:`);
            desc_string.push(`Name: ${connection.name}`);
            desc_string.push(`Target bucket: ${cloud_sync.target_bucket}`);
            desc_string.push(`Endpoint: ${cloud_sync.endpoint}`);
            desc_string.push(`Access key: ${cloud_sync.access_keys.access_key}`);
            desc_string.push(`Sync configurations:`);
            desc_string.push(`Frequency: Every ${cloud_sync.schedule_min} mins`);
            desc_string.push(`Direction: ${sync_direction}`);
            desc_string.push(`Sync Deletions: ${!cloud_sync.additions_only}`);

            ActivityLog.create({
                event: 'bucket.set_cloud_sync',
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                bucket: bucket._id,
                desc: desc_string.join('\n'),
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
 * UPDATE_CLOUD_SYNC
 *
 */
function update_cloud_sync(req) {
    dbg.log0('update_cloud_sync:', req.rpc_params);
    var bucket = find_bucket(req);
    if (!bucket.cloud_sync || !bucket.cloud_sync.target_bucket) {
        throw new RpcError('INVALID_REQUEST', 'Bucket has no cloud sync policy configured');
    }
    var updated_policy = {
        _id: bucket._id,
        cloud_sync: Object.assign({}, bucket.cloud_sync, req.rpc_params.policy)
    };

    var sync_directions_changed = Object.keys(req.rpc_params.policy)
        .filter(
            key => key !== 'schedule_min' && key !== 'additions_only'
        ).some(
            key => updated_policy.cloud_sync[key] !== bucket.cloud_sync[key]
        );

    var should_resync = false;
    var should_resync_deleted_files = false;

    // Please see the explanation and decision table below (at the end of the file).
    if (updated_policy.cloud_sync.additions_only === bucket.cloud_sync.additions_only) {
        should_resync = should_resync_deleted_files = sync_directions_changed && (bucket.cloud_sync.c2n_enabled && !bucket.cloud_sync.n2c_enabled);
    } else
    if (updated_policy.cloud_sync.additions_only) {
        should_resync = sync_directions_changed && (bucket.cloud_sync.c2n_enabled && !bucket.cloud_sync.n2c_enabled);
    } else {
        should_resync = should_resync_deleted_files = !(updated_policy.cloud_sync.c2n_enabled && !updated_policy.cloud_sync.n2c_enabled);
    }

    return system_store.make_changes({
            update: {
                buckets: [updated_policy]
            }
        })
        .then(function() {
            //TODO:: scale, fine for 1000 objects, not for 1M
            if (should_resync) {
                return object_server.set_all_files_for_sync(req.system._id, bucket._id, should_resync_deleted_files);
            }
        })
        .then(function() {
            return server_rpc.client.cloud_sync.refresh_policy({
                sysid: req.system._id.toString(),
                bucketid: bucket._id.toString(),
                force_stop: false,
            }, {
                auth_token: req.auth_token
            });
        })
        .then(res => {
            let desc_string = [];
            let sync_direction;
            if (updated_policy.cloud_sync.c2n_enabled && updated_policy.cloud_sync.n2c_enabled) {
                sync_direction = 'Bi-Directional';
            } else if (updated_policy.cloud_sync.c2n_enabled) {
                sync_direction = 'Target To Source';
            } else if (updated_policy.cloud_sync.n2c_enabled) {
                sync_direction = 'Source To Target';
            } else {
                sync_direction = 'None';
            }
            desc_string.push(`Cloud sync was updated in ${bucket.name}:`);
            desc_string.push(`Sync configurations:`);
            desc_string.push(`Frequency: Every ${updated_policy.cloud_sync.schedule_min} mins`);
            desc_string.push(`Direction: ${sync_direction}`);
            desc_string.push(`Sync Deletions: ${!updated_policy.cloud_sync.additions_only}`);

            ActivityLog.create({
                event: 'bucket.update_cloud_sync',
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                bucket: bucket._id,
                desc: desc_string.join('\n'),
            });
            return res;
        })
        .catch(function(err) {
            dbg.error('Error updating cloud sync', err, err.stack);
            throw err;
        })
        .return();
}


function toggle_cloud_sync(req) {
    let bucket = find_bucket(req);
    let cloud_sync = bucket.cloud_sync;
    if (!cloud_sync) {
        dbg.error('cloud_sync policy is not set');
        throw new Error('cloud_sync policy is not set');
    }

    if (cloud_sync.paused === req.rpc_params.pause) {
        dbg.log0('cloud_sync is already', cloud_sync.paused ? 'paused' : 'running', 'skipping');
        return;
    }

    cloud_sync.paused = req.rpc_params.pause;
    return system_store.make_changes({
            update: {
                buckets: [{
                    _id: bucket._id,
                    cloud_sync: cloud_sync
                }]
            }
        })
        .then(function() {
            return server_rpc.client.cloud_sync.refresh_policy({
                sysid: req.system._id.toString(),
                bucketid: bucket._id.toString(),
                force_stop: cloud_sync.paused,
            }, {
                auth_token: req.auth_token
            });
        });
}


/**
 *
 * GET_CLOUD_BUCKETS
 *
 */
function get_cloud_buckets(req) {
    var buckets = [];
    dbg.log0('get cloud buckets', req.rpc_params);

    return P.fcall(function() {
        var connection = find_cloud_sync_connection(req);
        var s3 = new AWS.S3({
            endpoint: connection.endpoint,
            accessKeyId: connection.access_key,
            secretAccessKey: connection.secret_key,
            httpOptions: {
                agent: new https.Agent({
                    rejectUnauthorized: false,
                })
            }
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

function find_cloud_sync_connection(req) {
    let account = req.account;
    let conn_name = req.rpc_params.connection;
    let conn = (account.sync_credentials_cache || [])
        .filter(sync_conn => sync_conn.name === conn_name)[0];

    if (!conn) {
        dbg.error('CONNECTION NOT FOUND', account, conn_name);
        throw new RpcError('INVALID_CONNECTION', 'Connection dosn\'t exists: "' + conn_name + '"');
    }

    return conn;
}

function find_bucket(req) {
    var bucket = req.system.buckets_by_name[req.rpc_params.name];
    if (!bucket) {
        dbg.error('BUCKET NOT FOUND', req.rpc_params.name);
        throw new RpcError('NO_SUCH_BUCKET', 'No such bucket: ' + req.rpc_params.name);
    }
    req.check_bucket_permission(bucket);
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
    return info;
}

function resolve_tiering_policy(req, policy_name) {
    var tiering_policy = req.system.tiering_policies_by_name[policy_name];
    if (!tiering_policy) {
        dbg.error('TIER POLICY NOT FOUND', policy_name);
        throw new RpcError('INVALID_BUCKET_STATE', 'Bucket tiering policy not found');
    }
    return tiering_policy;
}


/*
                ***UPDATE CLOUD SYNC DECISION TABLES***
Below are the files syncing decision tables for all cases of policy change:

RS - Stands for marking the files for Re-Sync (NOT deleted files only!).
DF - Stands for marking the DELETED files for Re-Sync.
NS - Stands for NOT marking files for Re-Sync (Both deleted and not).

Sync Deletions property did not change:
+------------------------------+----------------+------------------+------------------+
| Previous Sync / Updated Sync | Bi-Directional | Source To Target | Target To Source |
+------------------------------+----------------+------------------+------------------+
| Bi-Directional               | NS             | NS               | NS               |
+------------------------------+----------------+------------------+------------------+
| Source To Target             | NS             | NS               | NS               |
+------------------------------+----------------+------------------+------------------+
| Target To Source             | RS + DF        | RS + DF          | NS               |
+------------------------------+----------------+------------------+------------------+

Sync Deletions property changed to TRUE:
+------------------------------+----------------+------------------+------------------+
| Previous Sync / Updated Sync | Bi-Directional | Source To Target | Target To Source |
+------------------------------+----------------+------------------+------------------+
| Bi-Directional               | NS             | NS               | NS               |
+------------------------------+----------------+------------------+------------------+
| Source To Target             | RS + DF        | RS + DF          | NS               |
+------------------------------+----------------+------------------+------------------+
| Target To Source             | RS + DF        | RS + DF          | NS               |
+------------------------------+----------------+------------------+------------------+

Sync Deletions property changed to FALSE:
+------------------------------+----------------+------------------+------------------+
| Previous Sync / Updated Sync | Bi-Directional | Source To Target | Target To Source |
+------------------------------+----------------+------------------+------------------+
| Bi-Directional               | NS             | NS               | NS               |
+------------------------------+----------------+------------------+------------------+
| Source To Target             | NS             | NS               | NS               |
+------------------------------+----------------+------------------+------------------+
| Target To Source             | RS             | RS               | NS               |
+------------------------------+----------------+------------------+------------------+
*/


// EXPORTS
exports.new_bucket_defaults = new_bucket_defaults;
exports.get_bucket_info = get_bucket_info;
//Bucket Management
exports.create_bucket = create_bucket;
exports.read_bucket = read_bucket;
exports.update_bucket = update_bucket;
exports.delete_bucket = delete_bucket;
exports.list_buckets = list_buckets;
//exports.generate_bucket_access = generate_bucket_access;
exports.list_bucket_s3_acl = list_bucket_s3_acl;
exports.update_bucket_s3_acl = update_bucket_s3_acl;
//Cloud Sync policies
exports.get_cloud_sync = get_cloud_sync;
exports.get_all_cloud_sync = get_all_cloud_sync;
exports.delete_cloud_sync = delete_cloud_sync;
exports.set_cloud_sync = set_cloud_sync;
exports.update_cloud_sync = update_cloud_sync;
exports.toggle_cloud_sync = toggle_cloud_sync;
//Temporary - TODO: move to new server
exports.get_cloud_buckets = get_cloud_buckets;
