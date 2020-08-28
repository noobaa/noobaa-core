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
const addr_utils = require('../../util/addr_utils');
const promise_utils = require('../../util/promise_utils');
const server_rpc = require('../server_rpc');
const Dispatcher = require('../notifications/dispatcher');
const nodes_client = require('../node_services/nodes_client');
const system_store = require('../system_services/system_store').get_instance();
const cloud_utils = require('../../util/cloud_utils');
const auth_server = require('../common_services/auth_server');
const HistoryDataStore = require('../analytic_services/history_data_store').HistoryDataStore;
const IoStatsStore = require('../analytic_services/io_stats_store').IoStatsStore;
const pool_ctrls = require('./pool_controllers');
const func_store = require('../func_services/func_store');
const { KubeStore } = require('../kube-store.js');

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

const NO_CAPAITY_LIMIT = 1024 ** 2; // 1MB
const LOW_CAPACITY_HARD_LIMIT = 30 * (1024 ** 3); // 30GB

// hold the factory function that create the pool controllers for the system pools.
let create_pool_controller = default_create_pool_controller;

// This code should fix and pending changes to hosts pools in the case
// that the server process was stopped unexpectedly.
async function _init() {
    await promise_utils.wait_until(() =>
        system_store.is_finished_initial_load
    );

    // Ensure that all account are not using mongo pool as default resource after
    // at least one pool is in optimal state.
    update_account_default_resource();
}

function default_create_pool_controller(system, pool) {
    return pool.hosts_pool_info.is_managed ?
        new pool_ctrls.ManagedStatefulSetPoolController(system.name, pool.name) :
        new pool_ctrls.UnmanagedStatefulSetPoolController(system.name, pool.name);
}

function set_pool_controller_factory(pool_controller_factory) {
    if (pool_controller_factory === null) {
        create_pool_controller = default_create_pool_controller;

    } else if (_.isFunction(pool_controller_factory)) {
        create_pool_controller = pool_controller_factory;

    } else {
        throw new TypeError('Invalid pool_controller_factory, must be a function or null');
    }

}

function new_pool_defaults(name, system_id, resource_type, pool_node_type) {
    let now = Date.now();
    return {
        _id: system_store.new_system_store_id(),
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
        _id: system_store.new_system_store_id(),
        system: system_id,
        account: account_id,
        name,
        connection
    };
}

async function create_hosts_pool(req) {
    try {
        // Trigger partial aggregation for the Prometheus metrics
        server_rpc.client.stats.get_partial_stats({
            requester: 'create_hosts_pool',
        }, {
            auth_token: req.auth_token
        });
    } catch (error) {
        dbg.error('create_hosts_pool: get_partial_stats failed with', error);
    }
    const { system, rpc_params, account } = req;
    const pool = new_pool_defaults(rpc_params.name, system._id, 'HOSTS', 'BLOCK_STORE_FS');
    const PV_SIZE_GB = 20;
    const GB = 1024 ** 3;
    pool.hosts_pool_info = _.cloneDeep(
        _.defaultsDeep(_.pick(rpc_params, [
            'is_managed',
            'host_count',
            'host_config',
            'backingstore'
        ]), {
            host_config: {
                volume_size: PV_SIZE_GB * GB
            }
        })
    );
    dbg.log0('create_hosts_pool: Creating new pool', pool);
    await system_store.make_changes({
        insert: {
            pools: [pool],
        },
    });

    const { hosts_pool_info } = pool;
    Dispatcher.instance().activity({
        event: 'resource.create',
        level: 'info',
        system: system._id,
        actor: account._id,
        pool: pool._id,
        desc: `A ${
            hosts_pool_info.is_managed ? 'managed' : 'unmanaged'
        } pool ${
            rpc_params.name
        } with ${
            hosts_pool_info.host_count
        } nodes was created by ${
            account.email.unwrap()
        }`,
    });

    try {
        const routing_hint = hosts_pool_info.is_managed ? 'INTERNAL' : 'EXTERNAL';
        const agent_install_string = await get_agent_install_conf(system, pool, account, routing_hint);
        const agent_profile = Object.assign(
            JSON.parse(process.env.AGENT_PROFILE || '{}'),
            hosts_pool_info.host_config
        );

        const account_roles = req.account.roles_by_system[req.system._id];
        let res = agent_install_string;
        if (!account_roles.includes('operator')) {
            // Ask the pool controller to create backing agents for the pool
            const pool_ctrl = create_pool_controller(system, pool);
            res = await pool_ctrl.create(
                hosts_pool_info.host_count,
                agent_install_string,
                agent_profile
            );
        }
        return res;

    } catch (err) {
        console.error(`create_hosts_pool: Could not deploy underlaying agents, got: ${err.message}`);
        throw err;
    }
}

async function get_agent_install_conf(system, pool, account, routing_hint) {
    let cfg = system_store.data.agent_configs
        .find(conf => conf.pool === pool._id);
    if (!cfg) {
        // create new configuration with the required settings
        dbg.log0(`creating new installation string for pool: ${pool.name} (${pool._id})`);
        const conf_id = system_store.new_system_store_id();
        cfg = {
            _id: conf_id,
            name: String(conf_id),
            system: system._id,
            pool: pool._id,
            exclude_drives: [],
            use_storage: true,
            routing_hint
        };

        await system_store.make_changes({
            insert: {
                agent_configs: [cfg]
            }
        });
    }

    // Creating a new create_auth_token for conf_id
    const create_node_token = auth_server.make_auth_token({
        system_id: system._id,
        account_id: account._id,
        role: 'create_node',
        extra: { agent_config_id: cfg._id }
    });

    const addr = addr_utils.get_base_address(system.system_address, { hint: routing_hint });
    const install_string = JSON.stringify({
        address: addr.toString(),
        routing_hint,
        system: system.name,
        create_node_token,
        root_path: './noobaa_storage/'
    });
    return Buffer.from(install_string).toString('base64');
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
        throw new RpcError('IN_USE', 'Target already in use');
    }

    dbg.log0('creating namespace_resource:', namespace_resource);
    return system_store.make_changes({
        insert: {
            namespace_resources: [namespace_resource]
        }
    });
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
}

async function create_cloud_pool(req) {
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
        endpoint_type: connection.endpoint_type || 'AWS',
        backingstore: req.rpc_params.backingstore,
        storage_limit: req.rpc_params.storage_limit,
    }, _.isUndefined);


    const already_used_by = cloud_utils.get_used_cloud_targets([cloud_info.endpoint_type],
            system_store.data.buckets, system_store.data.pools, system_store.data.namespace_resources)
        .find(candidate_target => (candidate_target.endpoint === cloud_info.endpoint &&
            candidate_target.target_name === cloud_info.target_bucket));
    if (already_used_by) {
        dbg.error(`This endpoint is already being used by a ${already_used_by.usage_type}: ${already_used_by.source_name}`);
        throw new RpcError('IN_USE', 'Target already in use');
    }

    if (req.rpc_params.storage_limit < config.ENOUGH_ROOM_IN_TIER_THRESHOLD) {
        throw new RpcError('INVALID_STORAGE_LIMIT', 'new storage limit is smaller than the minimum allowed');
    }

    try {
        // Trigger partial aggregation for the Prometheus metrics
        server_rpc.client.stats.get_partial_stats({
            requester: 'create_cloud_pool',
        }, {
            auth_token: req.auth_token
        });
    } catch (error) {
        dbg.error('create_cloud_pool: get_partial_stats failed with', error);
    }

    const map_pool_type = {
        AWS: 'BLOCK_STORE_S3',
        S3_COMPATIBLE: 'BLOCK_STORE_S3',
        FLASHBLADE: 'BLOCK_STORE_S3',
        IBM_COS: 'BLOCK_STORE_S3',
        AZURE: 'BLOCK_STORE_AZURE',
        GOOGLE: 'BLOCK_STORE_GOOGLE'
    };

    const pool_node_type = map_pool_type[connection.endpoint_type];
    var pool = new_pool_defaults(name, req.system._id, 'CLOUD', pool_node_type);
    dbg.log0('Creating new cloud_pool', pool);
    pool.cloud_pool_info = cloud_info;

    dbg.log0('got connection for cloud pool:', connection);

    await system_store.make_changes({
        insert: {
            pools: [pool]
        }
    });

    await server_rpc.client.hosted_agents.create_pool_agent({
        pool_name: req.rpc_params.name,
    }, {
        auth_token: req.auth_token
    });

    Dispatcher.instance().activity({
        event: 'resource.cloud_create',
        level: 'info',
        system: req.system._id,
        actor: req.account && req.account._id,
        pool: pool._id,
        desc: `${pool.name} was created by ${req.account && req.account.email.unwrap()}`,
    });
}

async function update_cloud_pool_limit(req) {
    const pool = find_pool_by_name(req);
    if (!pool.cloud_pool_info) {
        throw new RpcError('INVALID_POOL_TYPE', `pool ${pool.name} is not a cloud pool`);
    }
    const new_storage_limit = req.rpc_params.storage_limit;
    if (new_storage_limit) {
        const pool_info = await read_pool(req);
        const storage_minimum = Math.max(pool_info.storage.used, config.ENOUGH_ROOM_IN_TIER_THRESHOLD);
        if (new_storage_limit < storage_minimum) {
            throw new RpcError('INVALID_STORAGE_LIMIT', 'new storage limit is smaller than size already used by pool or the minimum allowed');
        }
        dbg.log0(`update_cloud_pool_limit: updating ${pool.name} size limit to ${new_storage_limit}, current usage is ${storage_minimum}`);
        await system_store.make_changes({
            update: {
                pools: [{
                    _id: pool._id,
                    'cloud_pool_info.storage_limit': new_storage_limit
                }]
            }
        });
    } else if (pool.cloud_pool_info.storage_limit) {
        dbg.log0(`update_cloud_pool_limit: removing ${pool.name} size limit`);
        await system_store.make_changes({
            update: {
                pools: [{
                    _id: pool._id,
                    $unset: { 'cloud_pool_info.storage_limit': 1 },
                }]
            }
        });
    }
    await server_rpc.client.hosted_agents.update_storage_limit({
        pool_ids: [String(pool._id)],
        storage_limit: new_storage_limit
    }, {
        auth_token: req.auth_token
    });
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
        }));
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
}

async function read_pool(req) {
    var pool = find_pool_by_name(req);
    const nodes_aggregate_pool = await nodes_client.instance().aggregate_nodes_by_pool([pool.name], req.system._id);
    const hosts_aggregate_pool = await nodes_client.instance().aggregate_hosts_by_pool([pool.name], req.system._id);
    return get_pool_info(pool, nodes_aggregate_pool, hosts_aggregate_pool);
}

function read_namespace_resource(req) {
    const namespace_resource = find_namespace_resource_by_name(req);
    return P.resolve()
        .then(() => get_namespace_resource_info(namespace_resource));
}

async function scale_hosts_pool(req) {
    const pool = find_pool_by_name(req);
    if (!pool.hosts_pool_info) {
        throw new RpcError('INVALID_POOL_TYPE', `pool ${pool.name} is not a hosts pool`);
    }

    const pool_info = await read_pool(req);
    const { host_count } = req.rpc_params;
    const current_host_count = pool_info.hosts.count;
    const current_configured_count = pool.hosts_pool_info.host_count;

    if (pool.mode === 'DELETING') {
        throw new RpcError('INVALID_POOL_STATE', `pool ${pool.name} is being deleted`);
    }

    if (host_count < current_host_count) {
        throw new RpcError('INVALID_POOL_STATE', `can't scale down ${pool.name} hosts count to less than current connected hosts`);
    }

    const pool_ctrl = create_pool_controller(req.system, pool);
    await pool_ctrl.scale(host_count);

    if (host_count === current_configured_count) {
        // Nothing to do as the DB not changing
        return;
    }

    Dispatcher.instance().activity({
        event: 'resource.scale',
        level: 'info',
        system: req.system._id,
        actor: req.account._id,
        pool: pool._id,
        desc: `Pool ${
            pool.name
        } was scaled ${
            host_count > current_configured_count ? 'up' : 'down'
        } from ${
            current_configured_count
        } to ${
            host_count
        } by  ${
            req.account.email.unwrap()
        }`
    });

    // Update the host pool info.
    dbg.log0(`scale_hosts_pool: updating ${pool.name} host count from ${current_configured_count} to ${host_count}`);
    return system_store.make_changes({
        update: {
            pools: [{
                _id: pool._id,
                'hosts_pool_info.host_count': host_count
            }]
        }
    });
}

async function update_hosts_pool(req) {
    const pool = find_pool_by_name(req);
    if (!pool.hosts_pool_info) {
        throw new RpcError('INVALID_POOL_TYPE', `pool ${pool.name} is not a hosts pool`);
    }
    const backingstore = await KubeStore.instance.read_backingstore(pool.name);
    const host_count = backingstore.spec.pvPool.numVolumes;
    const configured_host_count = pool.hosts_pool_info.host_count;

    Dispatcher.instance().activity({
        event: 'resource.scale',
        level: 'info',
        system: req.system._id,
        actor: req.account._id,
        pool: pool._id,
        desc: `Pool ${
            pool.name
        } was scaled ${
            host_count > configured_host_count ? 'up' : 'down'
        } from ${
            configured_host_count
        } to ${
            host_count
        } by  ${
            req.account.email.unwrap()
        }`
    });

    // Update the host pool info.
    dbg.log0(`update_hosts_pool: updating ${pool.name} host count from ${configured_host_count} to ${host_count}`);
    return system_store.make_changes({
        update: {
            pools: [{
                _id: pool._id,
                'hosts_pool_info.host_count': host_count
            }]
        }
    });
}

function delete_pool(req) {
    const pool = find_pool_by_name(req);
    if (pool.hosts_pool_info) {
        return delete_hosts_pool(req, pool);
    } else {
        return delete_resource_pool(req, pool);
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

async function delete_hosts_pool(req, pool) {
    dbg.log0('delete_hosts_pool: deleting hosts pool', pool.name);
    const account_roles = req.account.roles_by_system[req.system._id];

    const reason = check_pool_deletion(pool);
    if (reason === 'IS_BACKINGSTORE') {
        if (!account_roles.includes('operator')) {
            throw new RpcError(reason, 'Cannot delete pool');
        }
    } else if (reason && reason !== 'BEING_DELETED') {
        throw new RpcError(reason, 'Cannot delete pool');
    }

    if (!account_roles.includes('operator')) {
        const pool_ctrl = create_pool_controller(req.system, pool);
        await pool_ctrl.delete();
    }

    const { host_count } = pool.hosts_pool_info;
    if (host_count > 0) {
        await system_store.make_changes({
            update: {
                pools: [{
                    _id: pool._id,
                    'hosts_pool_info.host_count': 0
                }]
            }
        });
        await nodes_client.instance()
            .delete_hosts_by_pool(pool.name, req.system._id);
    }

    const current_host_count = await get_current_hosts_count(pool.name, req.system._id);
    if (current_host_count > 0) {
        if (account_roles.includes('operator') || reason === 'BEING_DELETED') {
            throw new RpcError('BEING_DELETED', 'Cannot delete pool');
        }
    } else {
        dbg.log0(`delete_hosts_pool: removing pool ${pool.name} from the database`);
        await system_store.make_changes({
            remove: {
                pools: [pool._id]
            }
        });

        Dispatcher.instance().activity({
            event: 'resource.delete',
            level: 'info',
            system: req.system._id,
            pool: pool._id,
            desc: `${pool.name} was emptyed and deleted`,
        });
        const related_funcs = await func_store.instance().list_funcs_by_pool(req.system._id, pool._id);
        for (const func of related_funcs) {
            let new_pools_arr = func.pools.filter(function(obj) {
                return obj.toString() !== (pool._id).toString();
            });
            await func_store.instance().update_func(func._id, { 'pools': new_pools_arr });
        }
    }
}

async function get_current_hosts_count(pool_name, system_id) {
    const hosts_aggregate = await nodes_client.instance()
        .aggregate_hosts_by_pool([pool_name], system_id);

    const { count, by_mode } = hosts_aggregate.nodes;
    return count - (by_mode.INITIALIZING || 0);
}

function delete_resource_pool(req, pool) {
    dbg.log0('Deleting resource pool', pool.name);

    var pool_name = pool.name;
    return P.resolve()
        .then(() => {
            const reason = check_resrouce_pool_deletion(pool);
            if (reason === 'IS_BACKINGSTORE') {
                const account_roles = req.account.roles_by_system[req.system._id];
                if (!account_roles.includes('operator')) {
                    throw new RpcError(reason, 'Cannot delete pool');
                }
            } else if (reason) {
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
            return P.each(pool_nodes.nodes, node => {
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
            const { account } = req;
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
    for (const service of config.SERVICES_TYPES) {
        all_services[service] = {
            service,
            read_bytes: 0,
            read_count: 0,
            write_bytes: 0,
            write_count: 0
        };
    }
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
        if (bucket.deleting) return false;
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

function has_associated_buckets_int(pool, { exclude_deleting_buckets } = {}) {
    const associated_bucket = _.find(pool.system.buckets_by_name, function(bucket) {
        if (bucket.deleting && exclude_deleting_buckets) return false;
        return _.find(bucket.tiering.tiers, function(tier_and_order) {
            return _.find(tier_and_order.tier.mirrors, function(mirror) {
                return _.find(mirror.spread_pools, function(spread_pool) {
                    return String(pool._id) === String(spread_pool._id);
                });
            });
        });
    });
    return Boolean(associated_bucket);
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
        info.is_managed = true;
    } else if (_is_mongo_pool(pool)) {
        info.mongo_info = {};
        info.undeletable = check_resrouce_pool_deletion(pool);
        info.mode = calc_mongo_pool_mode(p_nodes);
        info.is_managed = true;
    } else {
        info.nodes = _.defaults({}, p_nodes.nodes, POOL_NODES_INFO_DEFAULTS);
        info.storage_nodes = _.defaults({}, p_nodes.storage_nodes, POOL_NODES_INFO_DEFAULTS);
        info.s3_nodes = _.defaults({}, p_nodes.s3_nodes, POOL_NODES_INFO_DEFAULTS);
        info.hosts = _.mapValues(POOL_HOSTS_INFO_DEFAULTS, (val, key) => p_hosts.nodes[key] || val);
        info.hosts.configured_count = pool.hosts_pool_info.host_count;
        info.host_info = pool.hosts_pool_info.host_config;
        info.is_managed = pool.hosts_pool_info.is_managed;
        info.undeletable = check_pool_deletion(pool);
        info.mode = calc_hosts_pool_mode(
            info,
            p_hosts.nodes.storage_by_mode || {},
            p_hosts.nodes.s3_by_mode || {}
        );
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

/*eslint complexity: ["error", 60]*/
function calc_hosts_pool_mode(pool_info, storage_by_mode, s3_by_mode) {
    const { hosts, storage, is_managed } = pool_info;
    const data_activities = pool_info.data_activities ? pool_info.data_activities.activities : [];
    const host_count = hosts.count;
    const storage_count = hosts.by_service.STORAGE;
    const storage_offline = storage_by_mode.OFFLINE || 0;
    const storage_optimal = storage_by_mode.OPTIMAL || 0;
    const storage_offline_ratio = (storage_offline / host_count) * 100;
    const storage_issues_ratio = ((storage_count - storage_optimal) / storage_count) * 100;
    const hosts_initializing = hosts.by_mode.INITIALIZING || 0;
    const hosts_migrating = (hosts.by_mode.INITIALIZING || 0) + (hosts.by_mode.DECOMMISSIONING || 0) + (hosts.by_mode.MIGRATING || 0);
    const s3_count = hosts.by_service.GATEWAY;
    const s3_optimal = s3_by_mode.OPTIMAL || 0;
    const s3_issues_ratio = ((s3_count - s3_optimal) / s3_count) * 100;
    const { free, total, reserved, used_other } = _.assignWith({}, storage, (__, size) => size_utils.json_to_bigint(size));
    const potential_for_noobaa = total.subtract(reserved).subtract(used_other);
    const free_ratio = potential_for_noobaa.greater(0) ? free.multiply(100).divide(potential_for_noobaa) : size_utils.BigInteger.zero;
    const activity_count = data_activities
        .reduce((sum, val) => sum + val.count, 0);
    const activity_ratio = (activity_count / host_count) * 100;

    return (is_managed && hosts.configured_count === 0 && 'DELETING') ||
        (is_managed && host_count === hosts_initializing && 'INITIALIZING') ||
        (is_managed && host_count !== hosts.configured_count && 'SCALING') ||
        (host_count === 0 && 'HAS_NO_NODES') ||
        (storage_offline === storage_count && 'ALL_NODES_OFFLINE') ||
        (free < NO_CAPAITY_LIMIT && 'NO_CAPACITY') ||
        (hosts_migrating === host_count && 'ALL_HOSTS_IN_PROCESS') ||
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

function check_pool_deletion(pool) {
    //Verify pool is not used by any bucket/tier
    if (has_associated_buckets_int(pool, { exclude_deleting_buckets: true })) {
        return 'IN_USE';
    }

    //Verify pool is not used by any bucket/tier
    if (has_associated_buckets_int(pool)) {
        return 'CONNECTED_BUCKET_DELETING';
    }

    //Verify pool is not defined as default for any account
    var accounts = get_associated_accounts(pool);
    if (accounts.length) {
        return 'DEFAULT_RESOURCE';
    }

    // The pool is a hosts pool the is scaling down tooward deletions.
    if (pool.hosts_pool_info) {
        const { is_managed, host_count } = pool.hosts_pool_info;
        if (is_managed && host_count === 0) {
            return 'BEING_DELETED';
        }
    }

    //Verify pool's origin is not backingstore 
    if (pool.hosts_pool_info && pool.hosts_pool_info.backingstore) {
        return 'IS_BACKINGSTORE';
    }
}


function check_resrouce_pool_deletion(pool) {
    //Verify pool is not used by any bucket/tier
    if (has_associated_buckets_int(pool, { exclude_deleting_buckets: true })) {
        return 'IN_USE';
    }

    //Verify pool is not used by any bucket/tier
    if (has_associated_buckets_int(pool)) {
        return 'CONNECTED_BUCKET_DELETING';
    }

    //Verify pool is not defined as default for any account
    var accounts = get_associated_accounts(pool);
    if (accounts.length) {
        return 'DEFAULT_RESOURCE';
    }

    //Verify pool's origin is not backingstore 
    if (pool.cloud_pool_info && pool.cloud_pool_info.backingstore) {
        return 'IS_BACKINGSTORE';
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

function get_internal_mongo_pool(system) {
    return system.pools_by_name[`${config.INTERNAL_STORAGE_POOL_NAME}-${system._id}`];
}

async function get_optimal_non_mongo_pool_id() {
    for (const pool of system_store.data.pools) {
        // skip mongo pools.
        if (_is_mongo_pool(pool)) {
            continue;
        }

        const aggr = await nodes_client.instance().aggregate_nodes_by_pool([pool.name], pool.system._id);
        const { mode = '' } = get_pool_info(pool, aggr);
        if (mode === 'OPTIMAL') {
            return pool._id;
        }
    }
}

async function update_account_default_resource() {
    for (;;) {
        try {
            const system = system_store.data.systems[0];
            if (system) {
                const optimal_pool_id = await get_optimal_non_mongo_pool_id();

                if (optimal_pool_id) {
                    const updates = system_store.data.accounts
                        .filter(account =>
                            account.email.unwrap() !== config.OPERATOR_ACCOUNT_EMAIL &&
                            account.default_pool &&
                            _is_mongo_pool(account.default_pool)
                        )
                        .map(account => ({
                            _id: account._id,
                            $set: {
                                'default_pool': optimal_pool_id
                            }
                        }));

                    if (updates.length > 0) {
                        await system_store.make_changes({
                            update: { accounts: updates }
                        });
                    }

                    return;
                }
            }
        } catch (error) {
            // Ignore errors so we could continue with another iteration of the loop.
            _.noop();
        }
        await promise_utils.delay_unblocking(5000);
    }
}

// EXPORTS
exports._init = _init;
exports.set_pool_controller_factory = set_pool_controller_factory;
exports.get_internal_mongo_pool = get_internal_mongo_pool;
exports.new_pool_defaults = new_pool_defaults;
exports.get_pool_info = get_pool_info;
exports.read_namespace_resource = read_namespace_resource;
exports.get_namespace_resource_info = get_namespace_resource_info;
exports.create_hosts_pool = create_hosts_pool;
exports.create_cloud_pool = create_cloud_pool;
exports.create_namespace_resource = create_namespace_resource;
exports.create_mongo_pool = create_mongo_pool;
exports.read_pool = read_pool;
exports.delete_pool = delete_pool;
exports.delete_namespace_resource = delete_namespace_resource;
exports.get_associated_buckets = get_associated_buckets;
exports.get_pool_history = get_pool_history;
exports.get_cloud_services_stats = get_cloud_services_stats;
exports.get_namespace_resource_extended_info = get_namespace_resource_extended_info;
exports.assign_pool_to_region = assign_pool_to_region;
exports.scale_hosts_pool = scale_hosts_pool;
exports.update_hosts_pool = update_hosts_pool;
exports.update_cloud_pool_limit = update_cloud_pool_limit;
exports.get_optimal_non_mongo_pool_id = get_optimal_non_mongo_pool_id;
