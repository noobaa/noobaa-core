/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const AWS = require('aws-sdk');
const net = require('net');
const https = require('https');
const azure = require('azure-storage');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const MDStore = require('../object_services/md_store').MDStore;
const js_utils = require('../../util/js_utils');
const RpcError = require('../../rpc/rpc_error');
const Dispatcher = require('../notifications/dispatcher');
const size_utils = require('../../util/size_utils');
const server_rpc = require('../server_rpc');
const tier_server = require('./tier_server');
const cloud_utils = require('../../util/cloud_utils');
const nodes_client = require('../node_services/nodes_client');
const system_store = require('../system_services/system_store').get_instance();
const node_allocator = require('../node_services/node_allocator');

const VALID_BUCKET_NAME_REGEXP =
    /^(([a-z0-9]|[a-z0-9][a-z0-9\-]*[a-z0-9])\.)*([a-z0-9]|[a-z0-9][a-z0-9\-]*[a-z0-9])$/;


function new_bucket_defaults(name, system_id, tiering_policy_id, tag) {
    let now = Date.now();
    return {
        _id: system_store.generate_id(),
        name: name,
        tag: js_utils.default_value(tag, ''),
        system: system_id,
        tiering: tiering_policy_id,
        storage_stats: {
            chunks_capacity: 0,
            objects_size: 0,
            objects_count: 0,
            last_update: now
        },
        stats: {
            reads: 0,
            writes: 0,
            last_read: now,
            last_write: now,
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
            bucket_with_suffix, req.system._id, [{
                spread_pools: [default_pool._id]
            }]
        );
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
        req.rpc_params.tag);
    changes.insert.buckets = [bucket];
    Dispatcher.instance().activity({
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

    if (req.account && req.account.email !== _.get(req, 'system.owner.email', '')) {
        // Grant the owner a full access for the newly created bucket.
        changes.update.accounts.push({
            _id: req.system.owner._id,
            allowed_buckets: req.system.owner.allowed_buckets
                .map(bkt => bkt._id)
                .concat(bucket._id),
        });
    }

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
    var pools = [];

    _.forEach(bucket.tiering.tiers, tier_and_order => {
        _.forEach(tier_and_order.tier.mirrors, mirror_object => {
            pools = _.concat(pools, mirror_object.spread_pools);
        });
    });
    pools = _.compact(pools);

    let pool_names = pools.map(pool => pool.name);
    return P.join(
        nodes_client.instance().aggregate_nodes_by_pool(pool_names, req.system._id),
        MDStore.instance().count_objects_of_bucket(bucket._id),
        get_cloud_sync(req, bucket),
        node_allocator.refresh_tiering_alloc(bucket.tiering)
    ).spread(function(nodes_aggregate_pool, num_of_objects, cloud_sync_policy) {
        return get_bucket_info(bucket, nodes_aggregate_pool, num_of_objects, cloud_sync_policy);
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
    if (req.rpc_params.new_tag) {
        updates.tag = req.rpc_params.new_tag;
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

/**
 *
 * UPDATE_BUCKET_S3_ACCESS
 *
 */
function update_bucket_s3_access(req) {
    const bucket = find_bucket(req);
    const allowed_accounts = req.rpc_params.allowed_accounts.map(
        email => system_store.get_account_by_email(email)
    );

    const added_accounts = [];
    const removed_accounts = [];
    const updates = [];
    system_store.data.accounts.forEach(
        account => {
            if (!account.allowed_buckets) {
                return;
            }

            if (!account.allowed_buckets.includes(bucket) &&
                allowed_accounts.includes(account)) {

                added_accounts.push(account);
                updates.push({
                    _id: account._id,
                    allowed_buckets: account.allowed_buckets
                        .concat(bucket)
                        .map(bucket2 => bucket2._id)
                });
            }

            if (account.allowed_buckets.includes(bucket) &&
                !allowed_accounts.includes(account)) {

                removed_accounts.push(account);
                updates.push({
                    _id: account._id,
                    allowed_buckets: account.allowed_buckets
                        .filter(bucket2 => bucket2._id !== bucket._id)
                        .map(bucket2 => bucket2._id)
                });
            }
        }
    );

    return system_store.make_changes({
            update: {
                accounts: updates
            }
        })
        .then(() => {
            const desc_string = [];
            if (added_accounts.length > 0) {
                desc_string.push('Added accounts: ' + _.map(added_accounts, function(acc) {
                    return acc.email;
                }));
            }
            if (removed_accounts.length > 0) {
                desc_string.push('Removed accounts: ' + _.map(removed_accounts, function(acc) {
                    return acc.email;
                }));
            }

            Dispatcher.instance().activity({
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

    return MDStore.instance().has_any_objects_in_bucket(bucket._id)
        .then(has_objects => {
            if (has_objects) {
                throw new RpcError('BUCKET_NOT_EMPTY', 'Bucket not empty: ' + bucket.name);
            }
            Dispatcher.instance().activity({
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
            bucket_id: bucket._id.toString(),
            system_id: req.system._id.toString()
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
 * DELETE_BUCKET_LIFECYCLE
 *
 */
function delete_bucket_lifecycle(req) {
    var bucket = find_bucket(req);
    return system_store.make_changes({
            update: {
                buckets: [{
                    _id: bucket._id,
                    $unset: {
                        lifecycle_configuration_rules: 1
                    }
                }]
            }
        })
        .then(() => {
            let desc_string = [];
            desc_string.push(`lifecycle configuration rules were removed for bucket ${bucket.name} by ${req.account && req.account.email}`);

            Dispatcher.instance().activity({
                event: 'bucket.delete_lifecycle_configuration_rules',
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                bucket: bucket._id,
                desc: desc_string.join('\n'),
            });
            return;
        })
        .catch(function(err) {
            dbg.error('Error deleting lifecycle configuration rules', err, err.stack);
            throw err;
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
                endpoint_type: bucket.cloud_sync.endpoint_type || 'AWS',
                access_key: bucket.cloud_sync.access_keys.access_key,
                health: res.health,
                status: bucket.cloud_sync.status,
                last_sync: bucket.cloud_sync.last_sync.getTime() || undefined,
                target_bucket: bucket.cloud_sync.target_bucket,
                policy: {
                    schedule_min: bucket.cloud_sync.schedule_min,
                    c2n_enabled: bucket.cloud_sync.c2n_enabled,
                    n2c_enabled: bucket.cloud_sync.n2c_enabled,
                    additions_only: bucket.cloud_sync.additions_only,
                    paused: bucket.cloud_sync.paused,
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
                bucket_id: bucket._id.toString(),
            }, {
                auth_token: req.auth_token
            });
        })
        .then(res => {
            Dispatcher.instance().activity({
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
    var connection = cloud_utils.find_cloud_connection(req.account, req.rpc_params.connection);
    var bucket = find_bucket(req);
    //Verify parameters, bi-directional sync can't be set with additions_only
    if (req.rpc_params.policy.additions_only &&
        req.rpc_params.policy.n2c_enabled &&
        req.rpc_params.policy.c2n_enabled) {
        dbg.warn('set_cloud_sync bi-directional sync cant be set with additions_only');
        throw new Error('bi-directional sync cant be set with additions_only');
    }
    var cloud_sync = {
        endpoint: connection.endpoint,
        endpoint_type: connection.endpoint_type || 'AWS',
        target_bucket: req.rpc_params.target_bucket,
        access_keys: {
            access_key: connection.access_key,
            secret_key: connection.secret_key,
            account_id: req.account._id
        },
        schedule_min: js_utils.default_value(req.rpc_params.policy.schedule_min, 60),
        last_sync: new Date(0),
        paused: false,
        c2n_enabled: js_utils.default_value(req.rpc_params.policy.c2n_enabled, true),
        n2c_enabled: js_utils.default_value(req.rpc_params.policy.n2c_enabled, true),
        additions_only: js_utils.default_value(req.rpc_params.policy.additions_only, false)
    };

    const already_used_by = cloud_utils.get_used_cloud_targets(cloud_sync.endpoint_type, system_store.data.buckets, system_store.data.pools)
        .find(candidate_target => (candidate_target.endpoint === cloud_sync.endpoint &&
            candidate_target.target_name === cloud_sync.target_bucket));
    if (already_used_by) {
        dbg.error(`This endpoint is already being used by a ${already_used_by.usage_type}: ${already_used_by.source_name}`);
        throw new Error('Target already in use');
    }

    return system_store.make_changes({

            update: {
                buckets: [{
                    _id: bucket._id,
                    cloud_sync: cloud_sync
                }]
            }
        })
        .then(() => _set_all_files_for_sync(req.system, bucket))
        .then(() => server_rpc.client.cloud_sync.refresh_policy({
            bucket_id: bucket._id.toString()
        }, {
            auth_token: req.auth_token
        }))
        .then(() => {
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

            Dispatcher.instance().activity({
                event: 'bucket.set_cloud_sync',
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                bucket: bucket._id,
                desc: desc_string.join('\n'),
            });
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
        cloud_sync: Object.assign({}, bucket.cloud_sync, req.rpc_params.policy)
    };

    var sync_directions_changed = Object.keys(req.rpc_params.policy)
        .filter(key => key !== 'schedule_min' && key !== 'additions_only')
        .some(key => updated_policy.cloud_sync[key] !== bucket.cloud_sync[key]);

    var should_resync = false;
    var should_resync_deleted_files = false;

    // Please see the explanation and decision table below (at the end of the file).
    if (updated_policy.cloud_sync.additions_only === bucket.cloud_sync.additions_only) {
        should_resync =
            should_resync_deleted_files =
            sync_directions_changed && (bucket.cloud_sync.c2n_enabled && !bucket.cloud_sync.n2c_enabled);
    } else if (updated_policy.cloud_sync.additions_only) {
        should_resync =
            sync_directions_changed && (bucket.cloud_sync.c2n_enabled && !bucket.cloud_sync.n2c_enabled);
    } else {
        should_resync =
            should_resync_deleted_files = !(updated_policy.cloud_sync.c2n_enabled && !updated_policy.cloud_sync.n2c_enabled);
    }

    const db_updates = {
        _id: bucket._id
    };

    Object.keys(req.rpc_params.policy).forEach(key => {
        db_updates['cloud_sync.' + key] = req.rpc_params.policy[key];
    });
    return system_store.make_changes({
            update: {
                buckets: [db_updates]
            }
        })
        .then(() => should_resync && _set_all_files_for_sync(req.system, bucket, should_resync_deleted_files))
        .then(() => server_rpc.client.cloud_sync.refresh_policy({
            bucket_id: bucket._id.toString(),
        }, {
            auth_token: req.auth_token
        }))
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

            Dispatcher.instance().activity({
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
                    'cloud_sync.paused': cloud_sync.paused
                }]
            }
        })
        .then(function() {
            return server_rpc.client.cloud_sync.refresh_policy({
                bucket_id: bucket._id.toString()
            }, {
                auth_token: req.auth_token
            });
        });
}

/**
 * _set_all_files_for_sync - mark all objects on specific bucket for sync
 */
function _set_all_files_for_sync(system, bucket, should_resync_deleted_files) {
    dbg.log0('_set_all_files_for_sync: START',
        'system', system.name,
        'bucket', bucket.name,
        'should_resync_deleted_files', should_resync_deleted_files);

    // TODO:: scale, fine for 1000 objects, not for 1M
    return P.join(
            // Mark all "live" objects to be cloud synced
            MDStore.instance().update_all_objects_of_bucket_set_cloud_sync(bucket._id),
            // Mark all "previous" deleted objects as not needed for cloud sync
            should_resync_deleted_files &&
            MDStore.instance().update_all_objects_of_bucket_unset_deleted_cloud_sync(bucket._id)
        )
        .then(() => dbg.log0('_set_all_files_for_sync: DONE',
            'system', system.name,
            'bucket', bucket.name,
            'should_resync_deleted_files', should_resync_deleted_files));
}


/**
 *
 * SET_BUCKET_LIFECYCLE_CONFIGURATION_RULES
 *
 */
function set_bucket_lifecycle_configuration_rules(req) {
    dbg.log0('set bucket lifecycle configuration rules', req.rpc_params);

    var bucket = find_bucket(req);

    var lifecycle_configuration_rules = req.rpc_params.rules;

    return system_store.make_changes({
            update: {
                buckets: [{
                    _id: bucket._id,
                    lifecycle_configuration_rules: lifecycle_configuration_rules
                }]
            }
        })
        .then(() => {
            let desc_string = [];
            desc_string.push(`${bucket.name} was updated with lifecycle configuration rules by ${req.account && req.account.email}`);

            Dispatcher.instance().activity({
                event: 'bucket.set_lifecycle_configuration_rules',
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                bucket: bucket._id,
                desc: desc_string.join('\n'),
            });
            return;
        })
        .catch(function(err) {
            dbg.error('Error setting lifecycle configuration rules', err, err.stack);
            throw err;
        })
        .return();
}

/**
 *
 * GET_BUCKET_LIFECYCLE_CONFIGURATION_RULES
 *
 */
function get_bucket_lifecycle_configuration_rules(req) {
    dbg.log0('get bucket lifecycle configuration rules', req.rpc_params);
    var bucket = find_bucket(req);
    return bucket.lifecycle_configuration_rules || [];
}
/**
 *
 * GET_CLOUD_BUCKETS
 *
 */
function get_cloud_buckets(req) {
    dbg.log0('get cloud buckets', req.rpc_params);
    return P.fcall(function() {
        var connection = cloud_utils.find_cloud_connection(
            req.account,
            req.rpc_params.connection
        );
        if (connection.endpoint_type === 'AZURE') {
            let blob_svc = azure.createBlobService(cloud_utils.get_azure_connection_string(connection));
            let used_cloud_buckets = cloud_utils.get_used_cloud_targets('AZURE', system_store.data.buckets, system_store.data.pools);
            return P.ninvoke(blob_svc, 'listContainersSegmented', null, {})
                .then(data => data.entries.map(entry =>
                    _inject_usage_to_cloud_bucket(entry.name, connection.endpoint, used_cloud_buckets)));
        } //else if AWS
        let used_cloud_buckets = cloud_utils.get_used_cloud_targets('AWS', system_store.data.buckets, system_store.data.pools);
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
        return P.ninvoke(s3, "listBuckets")
            .then(data => data.Buckets.map(bucket =>
                _inject_usage_to_cloud_bucket(bucket.Name, connection.endpoint, used_cloud_buckets)));
    }).catch(function(err) {
        dbg.error("get_cloud_buckets ERROR", err.stack || err);
        throw err;
    });

}

function _inject_usage_to_cloud_bucket(target_name, endpoint, usage_list) {
    let res = {
        name: target_name
    };
    let using_target = usage_list.find(candidate_target =>
        (target_name === candidate_target.target_name &&
            endpoint === candidate_target.endpoint));
    if (using_target) {
        res.used_by = {
            name: using_target.source_name,
            usage_type: using_target.usage_type
        };
    }
    return res;
}


// UTILS //////////////////////////////////////////////////////////


function find_bucket(req) {
    var bucket = req.system.buckets_by_name[req.rpc_params.name];
    if (!bucket) {
        dbg.error('BUCKET NOT FOUND', req.rpc_params.name);
        throw new RpcError('NO_SUCH_BUCKET', 'No such bucket: ' + req.rpc_params.name);
    }
    req.check_bucket_permission(bucket);
    return bucket;
}

function get_bucket_info(bucket, nodes_aggregate_pool, num_of_objects, cloud_sync_policy) {
    var info = _.pick(bucket, 'name');
    var tier_of_bucket;
    if (bucket.tiering) {
        // We always have tiering so this if is irrelevant
        tier_of_bucket = bucket.tiering.tiers[0].tier;
        info.tiering = tier_server.get_tiering_policy_info(bucket.tiering, nodes_aggregate_pool);
    }

    let tiering_pools_status = node_allocator.get_tiering_pools_status(bucket.tiering);
    info.writable = tier_of_bucket.mirrors.some(mirror_object =>
        (mirror_object.spread_pools || []).some(pool =>
            _.get(tiering_pools_status[pool.name], 'valid_for_allocation', false)
        )
    );

    let objects_aggregate = {
        size: (bucket.storage_stats && bucket.storage_stats.objects_size) || 0,
        count: (bucket.storage_stats && bucket.storage_stats.objects_count) || 0
    };

    info.tag = bucket.tag ? bucket.tag : '';

    info.num_objects = num_of_objects || 0;
    let placement_mul = (tier_of_bucket.data_placement === 'MIRROR') ?
        Math.max(_.get(tier_of_bucket, 'mirrors.length', 0), 1) : 1;
    let bucket_chunks_capacity = size_utils.json_to_bigint(_.get(bucket, 'storage_stats.chunks_capacity', 0));
    let bucket_used = bucket_chunks_capacity
        .multiply(tier_of_bucket.replicas) // JEN TODO when we save on cloud we only create 1 replica
        .multiply(placement_mul);
    let bucket_free = size_utils.json_to_bigint(_.get(info, 'tiering.storage.free', 0));
    let bucket_used_other = size_utils.BigInteger.max(
        size_utils.json_to_bigint(_.get(info, 'tiering.storage.used', 0)).minus(bucket_used),
        0);

    info.storage = size_utils.to_bigint_storage({
        used: bucket_used,
        used_other: bucket_used_other,
        total: bucket_free.plus(bucket_used).plus(bucket_used_other),
        free: bucket_free,
    });

    info.data = size_utils.to_bigint_storage({
        size: objects_aggregate.size,
        size_reduced: bucket_chunks_capacity,
        actual_free: _.get(info, 'tiering.storage.real', 0)
    });

    let stats = bucket.stats;
    let last_read = (stats && stats.last_read) ?
        new Date(bucket.stats.last_read).getTime() :
        undefined;
    let last_write = (stats && stats.last_write) ?
        new Date(bucket.stats.last_write).getTime() :
        undefined;
    let reads = (stats && stats.reads) ? stats.reads : undefined;
    let writes = (stats && stats.writes) ? stats.writes : undefined;

    info.stats = {
        reads: reads,
        writes: writes,
        last_read: last_read,
        last_write: last_write
    };

    info.cloud_sync = cloud_sync_policy ? (cloud_sync_policy.status ? cloud_sync_policy : undefined) : undefined;
    info.demo_bucket = Boolean(bucket.demo_bucket);
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
exports.delete_bucket_lifecycle = delete_bucket_lifecycle;
exports.set_bucket_lifecycle_configuration_rules = set_bucket_lifecycle_configuration_rules;
exports.get_bucket_lifecycle_configuration_rules = get_bucket_lifecycle_configuration_rules;
exports.list_buckets = list_buckets;
//exports.generate_bucket_access = generate_bucket_access;
exports.update_bucket_s3_access = update_bucket_s3_access;
//Cloud Sync policies
exports.get_cloud_sync = get_cloud_sync;
exports.get_all_cloud_sync = get_all_cloud_sync;
exports.delete_cloud_sync = delete_cloud_sync;
exports.set_cloud_sync = set_cloud_sync;
exports.update_cloud_sync = update_cloud_sync;
exports.toggle_cloud_sync = toggle_cloud_sync;
//Temporary - TODO: move to new server
exports.get_cloud_buckets = get_cloud_buckets;
