/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const AWS = require('aws-sdk');
const net = require('net');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const MDStore = require('../object_services/md_store').MDStore;
const js_utils = require('../../util/js_utils');
const RpcError = require('../../rpc/rpc_error');
const Dispatcher = require('../notifications/dispatcher');
const size_utils = require('../../util/size_utils');
const BigInteger = size_utils.BigInteger;
const server_rpc = require('../server_rpc');
const tier_server = require('./tier_server');
const http_utils = require('../../util/http_utils');
const cloud_utils = require('../../util/cloud_utils');
const nodes_client = require('../node_services/nodes_client');
const pool_server = require('../system_services/pool_server');
const system_server = require('../system_services/system_server');
const system_store = require('../system_services/system_store').get_instance();
const node_allocator = require('../node_services/node_allocator');
const system_utils = require('../utils/system_utils');
const azure_storage = require('../../util/azure_storage_wrap');

const VALID_BUCKET_NAME_REGEXP =
    /^(([a-z0-9]|[a-z0-9][a-z0-9-]*[a-z0-9])\.)*([a-z0-9]|[a-z0-9][a-z0-9-]*[a-z0-9])$/;

const EXTERNAL_BUCKET_LIST_TO = 30 * 1000; //30s

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
            blocks_size: 0,
            pools: {},
            objects_size: 0,
            objects_count: 0,
            objects_hist: [],
            last_update: now - config.MD_GRACE_IN_MILLISECONDS
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

    const mongo_pool = pool_server.get_internal_mongo_pool(req.system._id);
    if (!mongo_pool) throw new RpcError('MONGO_POOL_NOT_FOUND');
    const internal_storage_tier = tier_server.get_internal_storage_tier(req.system._id);
    if (!internal_storage_tier) throw new RpcError('INTERNAL_TIER_NOT_FOUND');

    if (req.rpc_params.tiering) {
        tiering_policy = resolve_tiering_policy(req, req.rpc_params.tiering);
        // TODO: Disabled spillover untill the UI will support the feature
        // changes.update.tieringpolicies = [{
        //     _id: tiering_policy._id,
        //     $push: {
        //         tiers: {
        //             tier: internal_storage_tier._id,
        //             order: 1,
        //             spillover: true,
        //             disabled: true
        //         }
        //     }
        // }];
    } else {
        // we create dedicated tier and tiering policy for the new bucket
        // that uses the default_pool of that account
        let default_pool = req.account.default_pool;
        const bucket_with_suffix = req.rpc_params.name + '#' + Date.now().toString(36);
        let tier = tier_server.new_tier_defaults(
            bucket_with_suffix, req.system._id, [{
                spread_pools: [default_pool._id]
            }]
        );
        tiering_policy = tier_server.new_policy_defaults(
            bucket_with_suffix, req.system._id, [{
                    tier: tier._id,
                    order: 0,
                    spillover: false,
                    disabled: false
                }
                // TODO: Disabled spillover untill the UI will support the feature
                // , {
                //     tier: internal_storage_tier._id,
                //     order: 1,
                //     spillover: true,
                //     disabled: true
                // }
            ]
        );

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
    if (req.account.allowed_buckets && !req.account.allowed_buckets.full_permission) {
        changes.update.accounts = [{
            _id: req.account._id,
            $push: {
                'allowed_buckets.permission_list': bucket._id,
            }
        }];
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
            nodes_client.instance().aggregate_data_free_by_tier(
                bucket.tiering.tiers.map(tiers_object => String(tiers_object.tier._id)), req.system._id),
            MDStore.instance().count_objects_of_bucket(bucket._id),
            get_cloud_sync(req, bucket),
            node_allocator.refresh_tiering_alloc(bucket.tiering)
        )
        .spread((nodes_aggregate_pool, aggregate_data_free_by_tier, num_of_objects, cloud_sync_policy) =>
            get_bucket_info(bucket, nodes_aggregate_pool, aggregate_data_free_by_tier,
                num_of_objects, cloud_sync_policy));
}



/**
 *
 * UPDATE_BUCKET
 *
 */
function update_bucket(req) {
    const bucket = find_bucket(req);
    const tiering_policy = req.rpc_params.tiering &&
        resolve_tiering_policy(req, req.rpc_params.tiering);
    let quota = req.rpc_params.quota;
    const spillover_sent = !_.isUndefined(req.rpc_params.use_internal_spillover);
    const bucket_updates = {
        _id: bucket._id
    };
    const insert_changes = {};
    const update_changes = {
        buckets: [bucket_updates]
    };
    if (req.rpc_params.new_name) {
        bucket_updates.name = req.rpc_params.new_name;
    }
    if (req.rpc_params.new_tag) {
        bucket_updates.tag = req.rpc_params.new_tag;
    }
    if (tiering_policy) {
        bucket_updates.tiering = tiering_policy._id;
    }
    if (!_.isUndefined(quota)) {

        let desc;

        if (quota === null) {
            bucket_updates.$unset = {
                quota: 1
            };
            desc = `Bucket quota was removed from ${bucket.name} by ${req.account && req.account.email}`;
        } else {
            if (quota.size <= 0) {
                throw new RpcError('BAD_REQUEST', 'quota size must be positive');
            }
            bucket_updates.quota = quota;
            quota.value = size_utils.size_unit_to_bigint(quota.size, quota.unit).toJSON();
            let used_percent = system_utils.get_bucket_quota_usage_percent(bucket, quota);
            if (used_percent >= 100) {
                Dispatcher.instance().alert('MAJOR',
                    system_store.data.systems[0]._id,
                    `Bucket ${bucket.name} exceeded its configured quota of ${
                    size_utils.human_size(quota.value)
                }, uploads to this bucket will be denied`,
                    Dispatcher.rules.once_daily);
                dbg.warn(`the bucket ${bucket.name} used capacity is more than the updated quota. uploads will be denied`);
            } else if (used_percent >= 90) {
                Dispatcher.instance().alert('INFO',
                    system_store.data.systems[0]._id,
                    `Bucket ${bucket.name} exceeded 90% of its configured quota of ${size_utils.human_size(quota.value)}`,
                    Dispatcher.rules.once_daily);
                dbg.warn(`the bucket ${bucket.name} used capacity is more than 90% of the updated quota`);
            }
            desc = `Quota of ${size_utils.human_size(quota.value)} was set on ${bucket.name} by ${req.account && req.account.email}`;
        }

        Dispatcher.instance().activity({
            event: 'bucket.quota',
            level: 'info',
            system: req.system._id,
            actor: req.account && req.account._id,
            bucket: bucket._id,
            desc
        });

    }
    if (spillover_sent) {
        const tiering = tiering_policy || bucket.tiering;
        let spillover_tier = tiering.tiers.find(tier_and_order => tier_and_order.spillover);
        if (!spillover_tier) {
            const internal_mongo_pool = pool_server.get_internal_mongo_pool(req.system._id);
            if (!internal_mongo_pool) throw new RpcError('INTERNAL POOL NOT FOUND');
            spillover_tier = tier_server.get_internal_storage_tier(req.system._id);
            if (!spillover_tier) {
                spillover_tier = system_server.create_internal_tier(req.system._id, internal_mongo_pool._id);
                insert_changes.tiers = [spillover_tier];
            }
            tiering.tiers.push({
                tier: spillover_tier,
                order: 1,
                spillover: true,
                disabled: !req.rpc_params.use_internal_spillover
            });
        }
        spillover_tier.disabled = !req.rpc_params.use_internal_spillover;
        update_changes.tieringpolicies = [{
            _id: tiering._id,
            tiers: tiering.tiers.map(tier_and_order => ({
                tier: tier_and_order.tier._id,
                order: tier_and_order.order,
                spillover: tier_and_order.spillover,
                disabled: tier_and_order.disabled
            }))
        }];

        let desc;
        if (req.rpc_params.use_internal_spillover) {
            desc = `Bucket ${bucket.name} spillover was turned off by ${req.account && req.account.email}`;
        } else {
            desc = `Bucket ${bucket.name} spillover was turned on by ${req.account && req.account.email}`;
        }
        Dispatcher.instance().activity({
            event: 'bucket.spillover',
            level: 'info',
            system: req.system._id,
            actor: req.account && req.account._id,
            bucket: bucket._id,
            desc
        });
    }
    return system_store.make_changes({
            update: update_changes,
            insert: insert_changes
        })
        .return();
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
    system_store.data.accounts.forEach(account => {
        if (!account.allowed_buckets ||
            (account.allowed_buckets && account.allowed_buckets.full_permission)) return;

        const is_allowed = account.allowed_buckets.permission_list.includes(bucket);
        const should_be_allowed = allowed_accounts.includes(account);

        if (!is_allowed && should_be_allowed) {
            added_accounts.push(account);
            updates.push({
                _id: account._id,
                $push: {
                    'allowed_buckets.permission_list': bucket._id
                }
            });
        } else if (is_allowed && !should_be_allowed) {
            removed_accounts.push(account);
            updates.push({
                _id: account._id,
                $pullAll: {
                    'allowed_buckets.permission_list': [bucket._id]
                }
            });
        }
    });

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
    if (_.map(req.system.buckets_by_name).length === 1) {
        throw new RpcError('BAD_REQUEST', 'Cannot delete last bucket');
    }

    return MDStore.instance().has_any_completed_objects_in_bucket(bucket._id)
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
                    tiers: _.compact(_.map(tiering_policy.tiers, tier_and_order => {
                        const associated_tiering_policies = tier_server.get_associated_tiering_policies(tier_and_order.tier)
                            .filter(policy_id => String(policy_id) !== String(tiering_policy._id));
                        if (_.isEmpty(associated_tiering_policies)) {
                            return tier_and_order.tier._id;
                        }
                    }))
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
            const accounts_update = _.compact(_.map(system_store.data.accounts,
                account => {
                    if (!account.allowed_buckets ||
                        (account.allowed_buckets && account.allowed_buckets.full_permission)) return;
                    return {
                        _id: account._id,
                        $pullAll: {
                            'allowed_buckets.permission_list': [bucket._id]
                        }
                    };
                }));

            return system_store.make_changes({
                    update: {
                        accounts: accounts_update
                    }
                })
                .return(res);
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

// TODO: JEN maybe should do something more clever since this will run multiple make_changes
function update_buckets(req) {
    return P.map(req.rpc_params, update_params => server_rpc.client.bucket.update_bucket(update_params, {
            auth_token: req.auth_token
        }))
        .return();
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
            MDStore.instance().update_all_objects_of_bucket_unset_cloud_sync(bucket._id),
            // Mark all "previous" deleted objects as not needed for cloud sync
            should_resync_deleted_files &&
            MDStore.instance().update_all_objects_of_bucket_set_deleted_cloud_sync(bucket._id)
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
                let blob_svc = azure_storage.createBlobService(cloud_utils.get_azure_connection_string(connection));
                let used_cloud_buckets = cloud_utils.get_used_cloud_targets('AZURE', system_store.data.buckets, system_store.data.pools);
                return P.fromCallback(callback => blob_svc.listContainersSegmented(null, { maxResults: 100 }, callback))
                    .timeout(EXTERNAL_BUCKET_LIST_TO)
                    .then(data => data.entries.map(entry =>
                        _inject_usage_to_cloud_bucket(entry.name, connection.endpoint, used_cloud_buckets)));
            } //else if AWS
            let used_cloud_buckets = cloud_utils.get_used_cloud_targets('AWS', system_store.data.buckets, system_store.data.pools);
            var s3 = new AWS.S3({
                endpoint: connection.endpoint,
                accessKeyId: connection.access_key,
                secretAccessKey: connection.secret_key,
                httpOptions: {
                    agent: http_utils.get_unsecured_http_agent(connection.endpoint)
                }
            });
            return P.ninvoke(s3, "listBuckets")
                .timeout(EXTERNAL_BUCKET_LIST_TO)
                .then(data => data.Buckets.map(bucket =>
                    _inject_usage_to_cloud_bucket(bucket.Name, connection.endpoint, used_cloud_buckets)));
        })
        .catch(P.TimeoutError, err => {
            dbg.log0('failed reading (t/o) external buckets list', req.rpc_params);
            throw err;
        })
        .catch(function(err) {
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

function get_bucket_info(bucket, nodes_aggregate_pool, aggregate_data_free_by_tier, num_of_objects, cloud_sync_policy) {
    const info = {
        name: bucket.name,
        namespace: bucket.namespace ? {
            list: _.map(bucket.namespace.list,
                it => _.pick(it,
                    'endpoint_type',
                    'endpoint',
                    'target_bucket',
                    'access_key',
                    'secret_key'
                )
            ),
        } : undefined,
        tiering: tier_server.get_tiering_policy_info(bucket.tiering, nodes_aggregate_pool, aggregate_data_free_by_tier),
        tag: bucket.tag ? bucket.tag : '',
        num_objects: num_of_objects || 0,
        writable: false,
        spillover_enabled: false,
        storage: undefined,
        data: undefined,
        usage_by_pool: undefined,
        quota: undefined,
        stats: undefined,
        cloud_sync: undefined,
        mode: undefined
    };


    const tiering_pools_status = node_allocator.get_tiering_status(bucket.tiering);
    const tiering_pools_used_agg = [0];
    let spillover_allowed_in_policy = false;
    let spillover_tier_in_policy;
    let has_any_pool_configured = false;
    let has_any_valid_pool_configured = false;

    _.each(bucket.tiering.tiers, tier_and_order => {
        if (tier_and_order.spillover) {
            if (tier_and_order.disabled) {
                return;
            } else {
                spillover_allowed_in_policy = true;
                spillover_tier_in_policy = tier_and_order.tier;
            }
        }
        let mirror_with_valid_pool = 0;
        tier_and_order.tier.mirrors.forEach(mirror_object => {
            let num_valid_nodes = 0;
            let has_valid_pool = false;
            _.compact((mirror_object.spread_pools || []).map(pool => {
                    has_any_pool_configured = true;
                    const spread_pool = system_store.data.pools.find(pool_rec => String(pool_rec._id) === String(pool._id));
                    tiering_pools_used_agg.push(_.get(spread_pool, 'storage_stats.blocks_size') || 0);
                    return tiering_pools_status[tier_and_order.tier._id].pools[pool._id];
                }))
                .forEach(pool_status => {
                    num_valid_nodes += pool_status.num_nodes || 0;
                    has_valid_pool = has_valid_pool || pool_status.valid_for_allocation;
                    // has_any_valid_pool_configured = has_any_valid_pool_configured || has_valid_pool;
                });
            // let valid = ;
            if (has_valid_pool || num_valid_nodes >= config.NODES_MIN_COUNT) mirror_with_valid_pool += 1;
            // return valid;
        });
        info.writable = mirror_with_valid_pool > 0;
        if ((tier_and_order.tier.mirrors.length > 1 && mirror_with_valid_pool > 1) || (tier_and_order.tier.mirrors.length === 1 && mirror_with_valid_pool === 1)) {
            has_any_valid_pool_configured = true;
        }
    });

    const objects_aggregate = {
        size: (bucket.storage_stats && bucket.storage_stats.objects_size) || 0,
        count: (bucket.storage_stats && bucket.storage_stats.objects_count) || 0
    };

    info.spillover_enabled = spillover_allowed_in_policy;

    const used_of_pools_in_policy = size_utils.json_to_bigint(size_utils.reduce_sum('blocks_size', tiering_pools_used_agg));
    const bucket_chunks_capacity = size_utils.json_to_bigint(_.get(bucket, 'storage_stats.chunks_capacity') || 0);
    const bucket_used = size_utils.json_to_bigint(_.get(bucket, 'storage_stats.blocks_size') || 0);
    const bucket_used_other = BigInteger.max(used_of_pools_in_policy.minus(bucket_used), BigInteger.zero);
    const bucket_free = size_utils.json_to_bigint(_.get(info, 'tiering.storage.free') || 0);
    const spillover_tier_storage = spillover_tier_in_policy && _.mapValues(_.get(tier_server.get_tier_info(
            spillover_tier_in_policy,
            nodes_aggregate_pool,
            aggregate_data_free_by_tier),
        'storage'), x => size_utils.json_to_bigint(x));

    const spillover_storage = _.mapValues(spillover_allowed_in_policy ?
        spillover_tier_storage : {
            free: 0,
            unavailable_free: 0
        }, x => size_utils.json_to_bigint(x));

    let is_storage_low = false;
    let is_no_storage = false;
    const bucket_total = bucket_free.plus(bucket_used)
        .plus(bucket_used_other)
        .plus(spillover_storage.free)
        .plus(spillover_storage.unavailable_free);

    info.storage = {
        values: size_utils.to_bigint_storage({
            used: bucket_used,
            used_other: bucket_used_other,
            total: bucket_total,
            free: bucket_free,
            spillover_free: spillover_storage.free.plus(spillover_storage.unavailable_free),
        }),
        last_update: _.get(bucket, 'storage_stats.last_update')
    };

    if (bucket_total.isZero() || bucket_free.isZero()) {
        is_no_storage = true;
    } else {
        let free_percent = bucket_free.multiply(100).divide(bucket_total);
        if (free_percent < 30) {
            is_storage_low = true;
        }
    }

    let is_quota_exceeded = false;
    let is_quota_low = false;
    const actual_free = size_utils.json_to_bigint(_.get(info, 'tiering.data.free') || 0);
    let available_for_upload = actual_free.plus(spillover_storage.free);
    if (bucket.quota) {
        let quota_precent = system_utils.get_bucket_quota_usage_percent(bucket, bucket.quota);
        info.quota = _.omit(bucket.quota, 'value');
        let quota_free = size_utils.json_to_bigint(bucket.quota.value).minus(size_utils.json_to_bigint(objects_aggregate.size));
        if (quota_precent >= 100) {
            is_quota_exceeded = true;
        } else if (quota_precent >= 90) {
            is_quota_low = true;
        }
        if (quota_free.isNegative()) {
            quota_free = BigInteger.zero;
        }
        available_for_upload = size_utils.size_min([
            size_utils.bigint_to_json(quota_free),
            size_utils.bigint_to_json(available_for_upload)
        ]);
    }
    info.data = size_utils.to_bigint_storage({
        size: objects_aggregate.size,
        size_reduced: bucket_chunks_capacity,
        free: actual_free,
        available_for_upload,
        spillover_free: spillover_storage.free,
        last_update: _.get(bucket, 'storage_stats.last_update')
    });

    info.usage_by_pool = {
        pools: {},
        last_update: _.get(bucket, 'storage_stats.last_update')
    };

    info.usage_by_pool.pools = [];
    _.mapKeys(_.get(bucket, 'storage_stats.pools') || {}, function(storage, pool_id) {
        const pool = system_store.data.get_by_id(pool_id);
        if (pool) {
            info.usage_by_pool.pools.push({
                pool_name: system_store.data.get_by_id(pool_id).name,
                storage: storage
            });
        }
    });

    const stats = bucket.stats;
    const last_read = (stats && stats.last_read) ?
        new Date(bucket.stats.last_read).getTime() :
        undefined;
    const last_write = (stats && stats.last_write) ?
        new Date(bucket.stats.last_write).getTime() :
        undefined;
    const reads = (stats && stats.reads) ? stats.reads : undefined;
    const writes = (stats && stats.writes) ? stats.writes : undefined;

    info.stats = {
        reads: reads,
        writes: writes,
        last_read: last_read,
        last_write: last_write
    };

    if (cloud_sync_policy) {
        info.cloud_sync = cloud_sync_policy.status ? cloud_sync_policy : undefined;
    } else {
        info.cloud_sync = undefined;
    }

    info.mode = calc_bucket_mode(has_any_pool_configured, has_any_valid_pool_configured, is_no_storage,
        is_storage_low, is_quota_low, is_quota_exceeded);

    info.demo_bucket = Boolean(bucket.demo_bucket);
    return info;
}

function calc_bucket_mode(has_any_pool_configured, has_any_valid_pool_configured, is_no_storage,
    is_storage_low, is_quota_low, is_quota_exceeded) {
    if (!has_any_pool_configured) {
        return 'NO_RESOURCES';
    }
    if (!has_any_valid_pool_configured) {
        return 'NOT_ENOUGH_HEALTHY_RESOURCES';
    }
    if (is_no_storage) {
        return 'NO_CAPACITY';
    }
    if (is_storage_low) {
        return 'LOW_CAPACITY';
    }
    if (is_quota_low) {
        return 'APPROUCHING_QOUTA';
    }
    if (is_quota_exceeded) {
        return 'EXCEEDING_QOUTA';
    }
    return 'OPTIMAL';
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
exports.update_buckets = update_buckets;
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
