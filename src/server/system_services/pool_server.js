/* Copyright (C) 2016 NooBaa */
/**
 *
 * POOL_SERVER
 *
 */
'use strict';

const _ = require('lodash');
const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const { RpcError } = require('../../rpc');
const size_utils = require('../../util/size_utils');
const server_rpc = require('../server_rpc');
const Dispatcher = require('../notifications/dispatcher');
const nodes_client = require('../node_services/nodes_client');
const system_store = require('../system_services/system_store').get_instance();
const cloud_utils = require('../../util/cloud_utils');
const HistoryDataStore = require('../analytic_services/history_data_store').HistoryDataStore;
const IoStatsStore = require('../analytic_services/io_stats_store').IoStatsStore;

const POOL_STORAGE_DEFAULTS = Object.freeze({
    total: 0,
    free: 0,
    used_other: 0,
    unavailable_free: 0,
    unavailable_used: 0,
    used: 0,
    reserved: 0,
});
const POOL_NODES_INFO_DEFAULTS = Object.freeze({
    count: 0,
    //    storage_count: 0,
    online: 0,
    by_mode: {},
});

const POOL_HOSTS_INFO_DEFAULTS = Object.freeze({
    count: 0,
    by_mode: {},
    by_service: {},
});

const NO_CAPAITY_LIMIT = Math.pow(1024, 2); // 1MB
const LOW_CAPACITY_HARD_LIMIT = 30 * Math.pow(1024, 3); // 30GB

function new_pool_defaults(name, system_id, resource_type, pool_node_type) {
    let now = Date.now();
    return {
        _id: system_store.generate_id(),
        system: system_id,
        name: name,
        resource_type: resource_type,
        pool_node_type: pool_node_type,
        storage_stats: {
            blocks_size: 0,
            last_update: now - (2 * config.MD_GRACE_IN_MILLISECONDS)
        },
    };
}

function new_namespace_resource_defaults(name, system_id, account_id, connection) {
    return {
        _id: system_store.generate_id(),
        system: system_id,
        account: account_id,
        name,
        connection
    };
}

function create_nodes_pool(req) {
    var name = req.rpc_params.name;
    var nodes = req.rpc_params.nodes;
    if (name !== config.NEW_SYSTEM_POOL_NAME && nodes.length < config.NODES_MIN_COUNT) {
        throw new RpcError('NOT ENOUGH NODES', 'cant create a pool with less than ' +
            config.NODES_MIN_COUNT + ' nodes');
    }
    var pool = new_pool_defaults(name, req.system._id, 'HOSTS', 'BLOCK_STORE_FS');
    dbg.log0('Creating new pool', pool);

    return system_store.make_changes({
            insert: {
                pools: [pool]
            }
        })
        .then(() => nodes_client.instance().migrate_nodes_to_pool(req.system._id, nodes,
            pool._id, req.account && req.account._id))
        .then(res => {
            Dispatcher.instance().activity({
                event: 'resource.create',
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                pool: pool._id,
                desc: `${name} was created by ${req.account && req.account.email.unwrap()}`,
            });
            return res;
        });
}

function create_hosts_pool(req) {
    const { rpc_params, auth_token } = req;
    const { name, hosts } = rpc_params;

    if (name !== config.NEW_SYSTEM_POOL_NAME && hosts.length < 1) {
        throw new RpcError('NOT ENOUGH HOSTS', 'cant create a pool with less than ' +
            1 + ' node');
    }

    const pool = new_pool_defaults(name, req.system._id, 'HOSTS', 'BLOCK_STORE_FS');
    const pool_id = String(pool._id);
    dbg.log0('Creating new pool', pool);

    return P.resolve()
        .then(() => system_store.make_changes({
            insert: {
                pools: [pool]
            }
        }))
        .then(() => server_rpc.client.host.migrate_hosts_to_pool({ pool_id, hosts }, { auth_token }));
}

function create_namespace_resource(req) {
    const name = req.rpc_params.name;
    const connection = cloud_utils.find_cloud_connection(req.account, req.rpc_params.connection);
    const namespace_resource = new_namespace_resource_defaults(name, req.system._id, req.account._id, _.omitBy({
        endpoint: connection.endpoint,
        target_bucket: req.rpc_params.target_bucket,
        access_key: connection.access_key,
        auth_method: connection.auth_method,
        cp_code: connection.cp_code || undefined,
        secret_key: connection.secret_key,
        endpoint_type: connection.endpoint_type || 'AWS'
    }, _.isUndefined));

    const already_used_by = cloud_utils.get_used_cloud_targets([namespace_resource.connection.endpoint_type],
            system_store.data.buckets, system_store.data.pools, system_store.data.namespace_resources)
        .find(candidate_target => (candidate_target.endpoint === namespace_resource.connection.endpoint &&
            candidate_target.target_name === namespace_resource.connection.target_bucket));
    if (already_used_by) {
        dbg.error(`This endpoint is already being used by a ${already_used_by.usage_type}: ${already_used_by.source_name}`);
        throw new Error('Target already in use');
    }

    dbg.log0('creating namespace_resource:', namespace_resource);
    return system_store.make_changes({
            insert: {
                namespace_resources: [namespace_resource]
            }
        })
        // .then(() => {
        //     Dispatcher.instance().activity({
        //         event: 'resource.cloud_create',
        //         level: 'info',
        //         system: req.system._id,
        //         actor: req.account && req.account._id,
        //         pool: pool._id,
        //         desc: `${pool.name} was created by ${req.account && req.account.email.unwrap()}`,
        //     });
        // })
        .return();
}

function create_cloud_pool(req) {
    var name = req.rpc_params.name;
    var connection = cloud_utils.find_cloud_connection(req.account, req.rpc_params.connection);
    var cloud_info = _.omitBy({
        endpoint: connection.endpoint,
        target_bucket: req.rpc_params.target_bucket,
        auth_method: connection.auth_method,
        access_keys: {
            access_key: connection.access_key,
            secret_key: connection.secret_key,
            account_id: req.account._id
        },
        endpoint_type: connection.endpoint_type || 'AWS'
    }, _.isUndefined);


    const already_used_by = cloud_utils.get_used_cloud_targets([cloud_info.endpoint_type],
            system_store.data.buckets, system_store.data.pools, system_store.data.namespace_resources)
        .find(candidate_target => (candidate_target.endpoint === cloud_info.endpoint &&
            candidate_target.target_name === cloud_info.target_bucket));
    if (already_used_by) {
        dbg.error(`This endpoint is already being used by a ${already_used_by.usage_type}: ${already_used_by.source_name}`);
        throw new Error('Target already in use');
    }

    const map_pool_type = {
        AWS: 'BLOCK_STORE_S3',
        S3_COMPATIBLE: 'BLOCK_STORE_S3',
        FLASHBLADE: 'BLOCK_STORE_S3',
        AZURE: 'BLOCK_STORE_AZURE',
        GOOGLE: 'BLOCK_STORE_GOOGLE'
    };

    const pool_node_type = map_pool_type[connection.endpoint_type];
    var pool = new_pool_defaults(name, req.system._id, 'CLOUD', pool_node_type);
    dbg.log0('Creating new cloud_pool', pool);
    pool.cloud_pool_info = cloud_info;

    dbg.log0('got connection for cloud pool:', connection);
    return system_store.make_changes({
            insert: {
                pools: [pool]
            }
        })
        .then(res => server_rpc.client.hosted_agents.create_pool_agent({
            pool_name: req.rpc_params.name,
        }, {
            auth_token: req.auth_token
        }))
        .then(() => {
            Dispatcher.instance().activity({
                event: 'resource.cloud_create',
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                pool: pool._id,
                desc: `${pool.name} was created by ${req.account && req.account.email.unwrap()}`,
            });
        })
        .return();
}

function create_mongo_pool(req) {
    var name = req.rpc_params.name;
    var mongo_info = {};

    if (get_internal_mongo_pool(req.system)) {
        dbg.error('System already has mongo pool');
        throw new Error('System already has mongo pool');
    }

    var pool = new_pool_defaults(name, req.system._id, 'INTERNAL', 'BLOCK_STORE_MONGO');
    dbg.log0('Creating new mongo_pool', pool);
    pool.mongo_pool_info = mongo_info;

    return system_store.make_changes({
            insert: {
                pools: [pool]
            }
        })
        .then(res => server_rpc.client.hosted_agents.create_pool_agent({
            pool_name: req.rpc_params.name,
        }, {
            auth_token: req.auth_token
        }))
        // .then(() => {
        //     Dispatcher.instance().activity({
        //         event: 'resource.cloud_create',
        //         level: 'info',
        //         system: req.system._id,
        //         actor: req.account && req.account._id,
        //         pool: pool._id,
        //         desc: `${pool.name} was created by ${req.account && req.account.email.unwrap()}`,
        //     });
        // })
        .return();
}

function list_pool_nodes(req) {
    var pool = find_pool_by_name(req);
    return P.resolve()
        .then(() => nodes_client.instance().list_nodes_by_pool(pool.name, req.system._id))
        .then(res => ({
            name: pool.name,
            nodes: _.map(res.nodes, node => {
                const reply = _.pick(node, '_id', 'name', 'peer_id', 'rpc_address');
                reply.id = String(reply._id);
                return _.omit(reply, '_id');
            })
        }));
}

function read_pool(req) {
    var pool = find_pool_by_name(req);
    return P.resolve()
        .then(() => nodes_client.instance().aggregate_nodes_by_pool([pool.name], req.system._id))
        .then(nodes_aggregate_pool => get_pool_info(pool, nodes_aggregate_pool));
}

function read_namespace_resource(req) {
    const namespace_resource = find_namespace_resource_by_name(req);
    return P.resolve()
        .then(() => get_namespace_resource_info(namespace_resource));
}

function delete_pool(req) {
    var pool = find_pool_by_name(req);
    if (_is_regular_pool(pool)) {
        return _delete_nodes_pool(req.system, pool, req.account);
    } else {
        return _delete_resource_pool(req, pool, req.account);
    }
}

function delete_namespace_resource(req) {
    const ns = find_namespace_resource_by_name(req);
    dbg.log0('Deleting namespace resource', ns.name);
    return P.resolve()
        .then(() => {
            const reason = check_namespace_resource_deletion(ns);
            if (reason) {
                throw new RpcError(reason, 'Cannot delete namespace resource');
            }
            return system_store.make_changes({
                remove: {
                    namespace_resources: [ns._id]
                }
            });
        })
        .return();
}


function _delete_nodes_pool(system, pool, account) {
    dbg.log0('Deleting pool', pool.name);
    return P.resolve()
        .then(() => nodes_client.instance().aggregate_nodes_by_pool([pool.name], system._id))
        .then(nodes_aggregate_pool => {
            var reason = check_pool_deletion(pool, nodes_aggregate_pool);
            if (reason) {
                throw new RpcError(reason, 'Cannot delete pool');
            }
            return system_store.make_changes({
                remove: {
                    pools: [pool._id]
                }
            });
        })
        .then(res => {
            Dispatcher.instance().activity({
                event: 'resource.delete',
                level: 'info',
                system: system._id,
                actor: account && account._id,
                pool: pool._id,
                desc: `${pool.name} was deleted by ${account && account.email.unwrap()}`,
            });
            return res;
        })
        .return();
}

function _delete_resource_pool(req, pool, account) {
    dbg.log0('Deleting resource pool', pool.name);
    var pool_name = pool.name;
    return P.resolve()
        .then(() => {
            const reason = check_resrouce_pool_deletion(pool);
            if (reason) {
                throw new RpcError(reason, 'Cannot delete pool');
            }
            return nodes_client.instance().list_nodes_by_pool(pool.name, req.system._id);
        })
        .then(function(pool_nodes) {
            if (!pool_nodes || pool_nodes.total_count === 0) {
                // handle edge case where the cloud pool is deleted before it's node is registered in nodes monitor.
                // in that case, send remove_cloud_agent to hosted_agents, which should also remove the pool.
                dbg.log0(`resource_pool ${pool_name} does not have any nodes in nodes_monitor. delete agent and pool from hosted_agents`);
                return server_rpc.client.hosted_agents.remove_pool_agent({
                    pool_name: pool.name
                }, {
                    auth_token: req.auth_token
                });
            }
            return P.each(pool_nodes && pool_nodes.nodes, node => {
                    nodes_client.instance().delete_node_by_name(req.system._id, node.name);
                })
                .then(function() {
                    // rename the deleted pool to avoid an edge case where there are collisions
                    // with a new resource pool name
                    let db_update = {
                        _id: pool._id,
                        name: pool.name + '#' + pool._id
                    };
                    const pending_del_property = pool.resource_type === 'INTERNAL' ?
                        'mongo_pool_info.pending_delete' : 'cloud_pool_info.pending_delete';
                    // mark the resource pool as pending delete
                    db_update[pending_del_property] = true;
                    return system_store.make_changes({
                        update: {
                            pools: [db_update]
                        }
                    });
                });

        })
        .then(() => {
            if (pool.resource_type === 'CLOUD') {
                Dispatcher.instance().activity({
                    event: 'resource.cloud_delete',
                    level: 'info',
                    system: req.system._id,
                    actor: account && account._id,
                    pool: pool._id,
                    desc: `${pool_name} was deleted by ${account && account.email.unwrap()}`,
                });
            }
        })
        .return();
}


function assign_nodes_to_pool(req) {
    dbg.log0('Adding nodes to pool', req.rpc_params.name, 'nodes', req.rpc_params.nodes);
    var pool = find_pool_by_name(req);
    return nodes_client.instance().migrate_nodes_to_pool(req.system._id, req.rpc_params.nodes,
        pool._id, req.account && req.account._id);
}


function assign_hosts_to_pool(req) {
    const { auth_token, rpc_params } = req;
    const { hosts, name } = rpc_params;
    dbg.log0('Adding hosts to pool', name, 'hosts:', hosts);

    const pool = find_pool_by_name(req);
    const pool_id = String(pool._id);
    return server_rpc.client.host.migrate_hosts_to_pool({ pool_id, hosts }, { auth_token });
}


function get_associated_buckets(req) {
    var pool = find_pool_by_name(req);
    return get_associated_buckets_int(pool);
}

async function get_namespace_stats_by_cloud_service(system, start_date, end_date) {
    const ns_stats = _.keyBy(await IoStatsStore.instance().get_all_namespace_resources_stats({ system, start_date, end_date }),
        stat => String(stat._id));
    const grouped_stats = _.omit(_.groupBy(ns_stats, stat => {
        const ns_resource = system_store.data.get_by_id(stat._id);
        const endpoint_type = _.get(ns_resource, 'connection.endpoint_type');
        return endpoint_type || 'OTHER';
    }), 'OTHER');

    return _.map(grouped_stats, (stats, service) => {
        const reduced_stats = stats.reduce((prev, current) => ({
            read_count: prev.read_count + (current.read_count || 0),
            write_count: prev.write_count + (current.write_count || 0),
            read_bytes: prev.read_bytes + (current.read_bytes || 0),
            write_bytes: prev.write_bytes + (current.write_bytes || 0),
        }), {
            read_count: 0,
            write_count: 0,
            read_bytes: 0,
            write_bytes: 0,
        });
        reduced_stats.service = service;
        return reduced_stats;
    });
}

async function get_cloud_services_stats(req) {
    const { start_date, end_date } = req.rpc_params;
    const [cloud_stats, namespace_stats] = await P.all([
        nodes_client.instance().get_nodes_stats_by_cloud_service(req.system._id, start_date, end_date),
        get_namespace_stats_by_cloud_service(req.system._id, start_date, end_date)
    ]);

    const all_services = {};
    for (const acc of system_store.data.accounts) {
        if (acc.sync_credentials_cache) {
            acc.sync_credentials_cache.forEach(conn => {
                all_services[conn.endpoint_type] = all_services[conn.endpoint_type] || {
                    service: conn.endpoint_type,
                    read_bytes: 0,
                    read_count: 0,
                    write_bytes: 0,
                    write_count: 0
                };
            });
        }
    }
    const cloud_stats_by_service = _.keyBy(cloud_stats, 'service');
    const ns_stats_by_service = _.keyBy(namespace_stats, 'service');


    _.mergeWith(all_services, cloud_stats_by_service, ns_stats_by_service, (a = {}, b = {}) => ({
        service: a.service || b.service,
        read_count: (a.read_count || 0) + (b.read_count || 0),
        write_count: (a.write_count || 0) + (b.write_count || 0),
        read_bytes: (a.read_bytes || 0) + (b.read_bytes || 0),
        write_bytes: (a.write_bytes || 0) + (b.write_bytes || 0),
    }));

    return _.values(all_services);
}

function get_pool_history(req) {
    let pool_list = req.rpc_params.pool_list;
    return HistoryDataStore.instance().get_pool_history()
        .then(history_records => history_records.map(history_record => ({
            timestamp: history_record.time_stamp.getTime(),
            pool_list: history_record.system_snapshot.pools
                .filter(pool => (!pool.mongo_info) && (!pool_list || pool_list.includes(pool.name)))
                .map(pool => {
                    const { name, storage, cloud_info, mongo_info } = pool;
                    let resource_type = 'HOSTS';
                    if (cloud_info) {
                        resource_type = 'CLOUD';
                    } else if (mongo_info) {
                        resource_type = 'INTERNAL';
                    }
                    return {
                        name,
                        storage,
                        resource_type
                    };
                })
        })));

}

// UTILS //////////////////////////////////////////////////////////

// TODO: Notice that does not include pools in disabled tiers
// What should we do in that case? Shall we delete the pool or not?
function get_associated_buckets_int(pool) {
    var associated_buckets = _.filter(pool.system.buckets_by_name, function(bucket) {
        return _.find(bucket.tiering.tiers, function(tier_and_order) {
            return _.find(tier_and_order.tier.mirrors, function(mirror) {
                return _.find(mirror.spread_pools, function(spread_pool) {
                    return String(pool._id) === String(spread_pool._id);
                });
            });
        });
    });

    return _.map(associated_buckets, function(bucket) {
        return bucket.name;
    });
}

function get_associated_accounts(pool) {
    return system_store.data.accounts
        .filter(account => (!account.is_support &&
            account.default_pool &&
            account.default_pool._id === pool._id
        ))
        .map(associated_account => associated_account.email);
}

function find_pool_by_name(req) {
    var name = req.rpc_params.name;
    var pool = req.system.pools_by_name[name];
    if (!pool) {
        throw new RpcError('NO_SUCH_POOL', 'No such pool: ' + name);
    }
    return pool;
}

async function assign_pool_to_region(req) {
    const name = req.rpc_params.name;
    const pool = req.system.pools_by_name[name];
    if (!pool) {
        throw new RpcError('NO_SUCH_POOL', 'No such pool: ' + name);
    }
    if (pool.resource_type === 'INTERNAL') {
        throw new RpcError('NO_REGION_ON_INTERNAL', 'Can\'t set region for internal resource');
    }
    if (pool.region === req.rpc_params.region) return;
    if (req.rpc_params.region === '' && _.isUndefined(pool.region)) return;
    let desc;
    if (req.rpc_params.region === '') {
        await system_store.make_changes({
            update: {
                pools: [{
                    _id: pool._id,
                    $unset: { region: 1 },
                }]
            }
        });
        desc = `${pool.name} was unassigned from region ${pool.region} by ${req.account && req.account.email.unwrap()}`;
    } else {
        await system_store.make_changes({
            update: {
                pools: [{
                    _id: pool._id,
                    $set: {
                        region: req.rpc_params.region,
                    },
                }]
            }
        });
        desc = `${pool.name} was assigned to region ${req.rpc_params.region} by ${req.account && req.account.email.unwrap()}`;
    }
    Dispatcher.instance().activity({
        event: pool.resource_type === 'CLOUD' ? 'resource.cloud_assign_region' : 'resource.pool_assign_region',
        level: 'info',
        system: req.system && req.system._id,
        actor: req.account && req.account._id,
        pool: pool._id,
        desc,
    });
}

function find_namespace_resource_by_name(req) {
    const name = req.rpc_params.name;
    const namespace_resource = req.system.namespace_resources_by_name[name];
    if (!namespace_resource) {
        throw new RpcError('NO_SUCH_NAMESPACE_RESOURCE', 'No such namespace resource: ' + name);
    }
    return namespace_resource;
}

function get_pool_info(pool, nodes_aggregate_pool, hosts_aggregate_pool) {
    const p_nodes = _.get(nodes_aggregate_pool, ['groups', String(pool._id)], {});
    const p_hosts = _.get(hosts_aggregate_pool, ['groups', String(pool._id)], { nodes: {} });
    var info = {
        name: pool.name,
        resource_type: pool.resource_type,
        pool_node_type: pool.pool_node_type,
        // notice that the pool storage is raw,
        // and does not consider number of replicas like in tier
        storage: _.defaults(size_utils.to_bigint_storage(p_nodes.storage), POOL_STORAGE_DEFAULTS),
        region: pool.region,
        create_time: pool._id.getTimestamp().getTime(),
        io_stats: {
            read_count: 0,
            write_count: 0,
            read_bytes: 0,
            write_bytes: 0,
            ..._.pick(p_nodes.io_stats, 'read_count', 'write_count', 'read_bytes', 'write_bytes')
        }
    };
    info.data_activities = {
        activities: p_nodes.data_activities || [],
        host_count: p_hosts.nodes.data_activity_host_count || 0
    };
    if (_is_cloud_pool(pool)) {
        info.cloud_info = _.omitBy({
            endpoint: pool.cloud_pool_info.endpoint,
            endpoint_type: pool.cloud_pool_info.endpoint_type || 'AWS',
            target_bucket: pool.cloud_pool_info.target_bucket,
            auth_method: pool.cloud_pool_info.auth_method,
            created_by: pool.cloud_pool_info.access_keys.account_id.email
        }, _.isUndefined);
        info.undeletable = check_resrouce_pool_deletion(pool);
        info.mode = calc_cloud_pool_mode(p_nodes);
    } else if (_is_mongo_pool(pool)) {
        info.mongo_info = {};
        info.undeletable = check_resrouce_pool_deletion(pool);
        info.mode = calc_mongo_pool_mode(p_nodes);
    } else {
        info.nodes = _.defaults({}, p_nodes.nodes, POOL_NODES_INFO_DEFAULTS);
        info.storage_nodes = _.defaults({}, p_nodes.storage_nodes, POOL_NODES_INFO_DEFAULTS);
        info.s3_nodes = _.defaults({}, p_nodes.s3_nodes, POOL_NODES_INFO_DEFAULTS);
        info.hosts = _.mapValues(POOL_HOSTS_INFO_DEFAULTS, (val, key) => p_hosts.nodes[key] || val);
        info.undeletable = check_pool_deletion(pool, nodes_aggregate_pool);
        info.mode = calc_hosts_pool_mode(info, p_hosts.nodes.storage_by_mode || {}, p_hosts.nodes.s3_by_mode || {});
    }

    //Get associated accounts
    info.associated_accounts = get_associated_accounts(pool);

    return info;
}

function get_namespace_resource_info(namespace_resource) {
    const info = _.omitBy({
        name: namespace_resource.name,
        endpoint_type: namespace_resource.connection.endpoint_type,
        endpoint: namespace_resource.connection.endpoint,
        auth_method: namespace_resource.connection.auth_method,
        cp_code: namespace_resource.connection.cp_code || undefined,
        target_bucket: namespace_resource.connection.target_bucket,
        identity: namespace_resource.connection.access_key,
        mode: 'OPTIMAL',
        undeletable: check_namespace_resource_deletion(namespace_resource)
    }, _.isUndefined);

    return info;
}

function get_namespace_resource_extended_info(namespace_resource) {
    const info = _.omitBy({
        id: namespace_resource._id,
        name: namespace_resource.name,
        endpoint_type: namespace_resource.connection.endpoint_type,
        endpoint: namespace_resource.connection.endpoint,
        auth_method: namespace_resource.connection.auth_method,
        cp_code: namespace_resource.connection.cp_code || undefined,
        target_bucket: namespace_resource.connection.target_bucket,
        access_key: namespace_resource.connection.access_key,
        secret_key: namespace_resource.connection.secret_key
    }, _.isUndefined);

    return info;
}

function calc_cloud_pool_mode(p) {
    const { by_mode } = _.defaults({}, p.nodes, POOL_NODES_INFO_DEFAULTS);
    return (!p.nodes && 'INITIALIZING') ||
        (by_mode.OPTIMAL && 'OPTIMAL') ||
        (by_mode.STORAGE_NOT_EXIST && 'STORAGE_NOT_EXIST') ||
        (by_mode.AUTH_FAILED && 'AUTH_FAILED') ||
        (by_mode.IO_ERRORS && 'IO_ERRORS') ||
        (by_mode.INITIALIZING && 'INITIALIZING') ||
        'ALL_NODES_OFFLINE';
}

function calc_mongo_pool_mode(p) {
    const { by_mode } = _.defaults({}, p.nodes, POOL_NODES_INFO_DEFAULTS);
    const { free } = _.defaults({}, p.storage, { free: NO_CAPAITY_LIMIT + 1 });
    return (!p.nodes && 'INITIALIZING') ||
        (by_mode.OPTIMAL && 'OPTIMAL') ||
        (by_mode.IO_ERRORS && 'IO_ERRORS') ||
        (by_mode.INITIALIZING && 'INITIALIZING') ||
        (by_mode.OFFLINE && 'ALL_NODES_OFFLINE') ||
        (by_mode.LOW_CAPACITY && 'LOW_CAPACITY') ||
        (free < NO_CAPAITY_LIMIT && 'NO_CAPACITY') ||
        'ALL_NODES_OFFLINE';
}

/*eslint complexity: ["error", 40]*/
function calc_hosts_pool_mode(pool_info, storage_by_mode, s3_by_mode) {
    const { hosts, storage } = pool_info;
    const data_activities = pool_info.data_activities ? pool_info.data_activities.activities : [];
    const { count } = hosts;
    const storage_count = hosts.by_service.STORAGE;
    const storage_offline = storage_by_mode.OFFLINE || 0;
    const storage_optimal = storage_by_mode.OPTIMAL || 0;
    const storage_offline_ratio = (storage_offline / count) * 100;
    const storage_issues_ratio = ((storage_count - storage_optimal) / storage_count) * 100;
    const hosts_migrating = (hosts.by_mode.INITIALIZING || 0) + (hosts.by_mode.DECOMMISSIONING || 0) + (hosts.by_mode.MIGRATING || 0);
    const s3_count = hosts.by_service.GATEWAY;
    const s3_optimal = s3_by_mode.OPTIMAL || 0;
    const s3_issues_ratio = ((s3_count - s3_optimal) / s3_count) * 100;

    const { free, total, reserved, used_other } = _.assignWith({}, storage, (__, size) => size_utils.json_to_bigint(size));
    const potential_for_noobaa = total.subtract(reserved).subtract(used_other);
    const free_ratio = potential_for_noobaa.greater(0) ? free.multiply(100).divide(potential_for_noobaa) : size_utils.BigInteger.zero;
    const activity_count = data_activities
        .reduce((sum, val) => sum + val.count, 0);
    const activity_ratio = (activity_count / count) * 100;

    return (count === 0 && 'HAS_NO_NODES') ||
        (storage_offline === storage_count && 'ALL_NODES_OFFLINE') ||
        (free < NO_CAPAITY_LIMIT && 'NO_CAPACITY') ||
        (hosts_migrating === count && 'ALL_HOSTS_IN_PROCESS') ||
        (activity_ratio > 50 && 'HIGH_DATA_ACTIVITY') ||
        ((storage_issues_ratio >= 90 && s3_issues_ratio >= 90) && 'MOST_NODES_ISSUES') ||
        ((storage_issues_ratio >= 50 && s3_issues_ratio >= 50) && 'MANY_NODES_ISSUES') ||
        (storage_issues_ratio >= 90 && 'MOST_STORAGE_ISSUES') ||
        (storage_issues_ratio >= 50 && 'MANY_STORAGE_ISSUES') ||
        (s3_issues_ratio >= 90 && 'MOST_S3_ISSUES') ||
        (s3_issues_ratio >= 50 && 'MANY_S3_ISSUES') ||
        (storage_offline_ratio >= 50 && 'MANY_NODES_OFFLINE') ||
        (free < LOW_CAPACITY_HARD_LIMIT && 'LOW_CAPACITY') ||
        (free_ratio.lesserOrEquals(20) && 'LOW_CAPACITY') ||
        'OPTIMAL';
}

function check_pool_deletion(pool, nodes_aggregate_pool) {
    // Check if there are nodes till associated to this pool
    const nodes_count = _.get(nodes_aggregate_pool, [
        'groups', String(pool._id), 'nodes', 'count'
    ], 0);
    if (nodes_count) {
        return 'NOT_EMPTY';
    }

    //Verify pool is not used by any bucket/tier
    var buckets = get_associated_buckets_int(pool);
    if (buckets.length) {
        return 'IN_USE';
    }

    //Verify pool is not defined as default for any account
    var accounts = get_associated_accounts(pool);
    if (accounts.length) {
        return 'DEFAULT_RESOURCE';
    }
}


function check_resrouce_pool_deletion(pool) {

    //Verify pool is not used by any bucket/tier
    var buckets = get_associated_buckets_int(pool);
    if (buckets.length) {
        return 'IN_USE';
    }
}

function check_namespace_resource_deletion(ns) {
    //Verify namespace resource is not used by any namespace bucket
    const buckets = get_associated_buckets_ns(ns);
    if (buckets.length) {
        return 'IN_USE';
    }
}

function get_associated_buckets_ns(ns) {
    const associated_buckets = _.filter(ns.system.buckets_by_name, bucket => {
        if (!bucket.namespace) return;
        return (_.find(bucket.namespace.read_resources, read_resource => String(ns._id) === String(read_resource._id)) ||
            (String(ns._id) === String(bucket.namespace.write_resource._id)));
    });

    return _.map(associated_buckets, 'name');
}

function _is_cloud_pool(pool) {
    return Boolean(pool.cloud_pool_info);
}

function _is_mongo_pool(pool) {
    return Boolean(pool.mongo_pool_info);
}

function _is_regular_pool(pool) {
    return !(Boolean(pool.mongo_pool_info) || Boolean(pool.cloud_pool_info));
}

function get_internal_mongo_pool(system) {
    return system.pools_by_name[`${config.INTERNAL_STORAGE_POOL_NAME}-${system._id}`];
}

// EXPORTS
exports.get_internal_mongo_pool = get_internal_mongo_pool;
exports.new_pool_defaults = new_pool_defaults;
exports.get_pool_info = get_pool_info;
exports.read_namespace_resource = read_namespace_resource;
exports.get_namespace_resource_info = get_namespace_resource_info;
exports.create_nodes_pool = create_nodes_pool;
exports.create_hosts_pool = create_hosts_pool;
exports.create_cloud_pool = create_cloud_pool;
exports.create_namespace_resource = create_namespace_resource;
exports.create_mongo_pool = create_mongo_pool;
exports.list_pool_nodes = list_pool_nodes;
exports.read_pool = read_pool;
exports.delete_pool = delete_pool;
exports.delete_namespace_resource = delete_namespace_resource;
exports.assign_hosts_to_pool = assign_hosts_to_pool;
exports.assign_nodes_to_pool = assign_nodes_to_pool;
exports.get_associated_buckets = get_associated_buckets;
exports.get_pool_history = get_pool_history;
exports.get_cloud_services_stats = get_cloud_services_stats;
exports.get_namespace_resource_extended_info = get_namespace_resource_extended_info;
exports.assign_pool_to_region = assign_pool_to_region;
