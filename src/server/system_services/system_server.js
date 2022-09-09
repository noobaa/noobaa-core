/* Copyright (C) 2016 NooBaa */
'use strict';

require('../../util/dotenv').load();

const _ = require('lodash');
const net = require('net');
const dns = require('dns');
const request = require('request');
const ip_module = require('ip');
const moment = require('moment');
const util = require('util');

const api = require('../../api');
const P = require('../../util/promise');
const pkg = require('../../../package.json');
const restrict = require('../../../platform_restrictions.json');
const dbg = require('../../util/debug_module')(__filename);
const cutil = require('../utils/clustering_utils');
const config = require('../../../config');
const { BucketStatsStore } = require('../analytic_services/bucket_stats_store');
const { EndpointStatsStore } = require('../analytic_services/endpoint_stats_store');
const os_utils = require('../../util/os_utils');
const { RpcError } = require('../../rpc');
const nb_native = require('../../util/nb_native');
const net_utils = require('../../util/net_utils');
const Dispatcher = require('../notifications/dispatcher');
const size_utils = require('../../util/size_utils');
const server_rpc = require('../server_rpc');
const pool_server = require('./pool_server');
const tier_server = require('./tier_server');
const auth_server = require('../common_services/auth_server');
const node_server = require('../node_services/node_server');
const nodes_client = require('../node_services/nodes_client');
const system_store = require('../system_services/system_store').get_instance();
const system_utils = require('../utils/system_utils');
const bucket_server = require('./bucket_server');
const account_server = require('./account_server');
const cluster_server = require('./cluster_server');
const node_allocator = require('../node_services/node_allocator');
const stats_collector = require('../bg_services/stats_collector');
const chunk_config_utils = require('../utils/chunk_config_utils');
const addr_utils = require('../../util/addr_utils');
const url_utils = require('../../util/url_utils');
const ssl_utils = require('../../util/ssl_utils');
const yaml_utils = require('../../util/yaml_utils');
const js_utils = require('../../util/js_utils');
const { KubeStore } = require('../kube-store.js');

const SYSLOG_INFO_LEVEL = 5;
const SYSLOG_LOG_LOCAL1 = 'LOG_LOCAL1';

const SYS_STORAGE_DEFAULTS = Object.freeze({
    total: 0,
    free: 0,
    unavailable_free: 0,
    alloc: 0,
    real: 0,
});
const SYS_NODES_INFO_DEFAULTS = Object.freeze({
    count: 0,
    storage_count: 0,
    online: 0,
    by_mode: {},
});


// called on rpc server init
let _is_initialized = false;
async function _init() {
    const DEFAULT_DELAY = 5000;
    let update_done = false;

    while (!update_done) {
        try {
            await P.delay_unblocking(DEFAULT_DELAY);
            if (system_store.is_finished_initial_load && system_store.data.systems.length) {
                const [system] = system_store.data.systems;

                // Register a routing resolver to provide routing tables for incoming
                // rpc connections.
                server_rpc.rpc.register_routing_authority(_resolve_routing);

                await _initialize_debug_level();
                await _configure_system_address(system._id, system.owner.id);

                update_done = true;
            }

        } catch (err) {
            dbg.error('system_server _init', 'UNCAUGHT ERROR', err, err.stack);
        }
    }

    _is_initialized = true;
}

function is_initialized() {
    return _is_initialized;
}

function _resolve_routing(hint) {
    const [system] = system_store.data.systems;

    dbg.log0('system_server _resolve_routing', hint, system.system_address);
    return api.new_router_from_address_list(system.system_address, hint);
}

function _initialize_debug_level(system) {
    return P.resolve()
        .then(() => {
            // The purpose of this code is to initialize the debug level
            // on server's startup, to synchronize the db with the actual value
            let current_clustering = system_store.get_local_cluster_info();
            if (current_clustering) {
                var update_object = {};
                update_object.clusters = [{
                    _id: current_clustering._id,
                    debug_level: 0
                }];
                return system_store.make_changes({
                    update: update_object
                });
            }
        });
}

function new_system_defaults(name, owner_account_id) {
    var system = {
        _id: system_store.new_system_store_id(),
        name: name,
        owner: owner_account_id,
        state: {
            mode: 'INITIALIZING',
            last_update: Date.now()
        },

        /*access_keys: (name === 'demo') ? [{
            access_key: '123',
            secret_key: 'abc',
        }] : [{
            access_key: crypto.randomBytes(16).toString('hex'),
            secret_key: crypto.randomBytes(32).toString('hex'),
        }],*/
        resources: {
            // set default package names
            agent_installer: 'noobaa-setup.exe',
            s3rest_installer: 'noobaa-s3rest.exe',
            linux_agent_installer: 'noobaa-setup'
        },
        n2n_config: {
            tcp_tls: true,
            tcp_active: true,
            tcp_permanent_passive: {
                min: 60101,
                max: 60600
            },
            udp_dtls: true,
            udp_port: true,
        },
        debug_level: 0,
        mongo_upgrade: {
            blocks_to_buckets: true
        },
        last_stats_report: 0,
        freemium_cap: {
            phone_home_upgraded: false,
            phone_home_notified: false,
            cap_terabytes: 20
        },
        current_version: pkg.version,
        upgrade_history: {
            successful_upgrades: [],
            last_failure: undefined
        },
        system_address: [],
    };
    return system;
}

function new_system_changes(name, owner_account_id) {
    // const default_resource_name = config.NEW_SYSTEM_POOL_NAME;
    const default_bucket_name = 'first.bucket';
    const bucket_with_suffix = default_bucket_name + '#' + Date.now().toString(36);


    let system = new_system_defaults(name, owner_account_id);

    const m_key = system_store.master_key_manager.new_master_key({
        description: `master key of ${system._id} system`,
        master_key_id: system_store.master_key_manager.get_root_key_id(),
        cipher_type: system_store.master_key_manager.get_root_key().cipher_type
    });
    system.master_key_id = m_key._id;

    // const pool = pool_server.new_pool_defaults(default_resource_name, system._id, 'HOSTS', 'BLOCK_STORE_FS');
    const internal_pool_name = `${config.INTERNAL_STORAGE_POOL_NAME}-${system._id}`;
    const mongo_pool = pool_server.new_pool_defaults(internal_pool_name, system._id, 'INTERNAL', 'BLOCK_STORE_MONGO');
    mongo_pool.mongo_pool_info = {};

    const default_chunk_config = {
        _id: system_store.new_system_store_id(),
        system: system._id,
        chunk_coder_config: chunk_config_utils.new_chunk_code_config_defaults(),
    };
    const ec_chunk_config = {
        _id: system_store.new_system_store_id(),
        system: system._id,
        chunk_coder_config: chunk_config_utils.new_chunk_code_config_defaults({
            data_frags: config.CHUNK_CODER_EC_DATA_FRAGS,
            parity_frags: config.CHUNK_CODER_EC_PARITY_FRAGS,
        }),
    };
    const tier_mirrors = [{
        _id: system_store.new_system_store_id(),
        spread_pools: [mongo_pool._id]
    }];
    const tier = tier_server.new_tier_defaults(
        bucket_with_suffix,
        system._id,
        default_chunk_config._id,
        tier_mirrors
    );
    const chunk_split_config = undefined; // using policy defaults
    const policy = tier_server.new_policy_defaults(
        bucket_with_suffix,
        system._id,
        chunk_split_config, [{
            tier: tier._id,
            order: 0,
            spillover: false,
            disabled: false
        }]
    );

    let bucket = bucket_server.new_bucket_defaults(
        default_bucket_name,
        system._id,
        policy._id,
        owner_account_id
    );

    const first_bucket_m_key = system_store.master_key_manager.new_master_key({
        description: `master key of ${bucket._id} bucket`,
        master_key_id: m_key._id,
        cipher_type: m_key.cipher_type
    });
    bucket.master_key_id = first_bucket_m_key._id;

    return {
        insert: {
            systems: [system],
            buckets: [bucket],
            tieringpolicies: [policy],
            tiers: [tier],
            chunk_configs: [default_chunk_config, ec_chunk_config],
            pools: [mongo_pool],
            master_keys: [m_key, first_bucket_m_key]
        }
    };
}

/**
 *
 * GET_SYSTEM_STATUS
 *
 */
function get_system_status(req) {
    if (!req.system) {
        return {
            state: 'DOES_NOT_EXIST',
            last_state_change: config.NOOBAA_EPOCH
        };
    }

    // This is here to prevent the need for DB update for old systems.
    const { state } = req.system;
    if (!state) {
        return {
            state: 'READY',
            last_state_change: config.NOOBAA_EPOCH
        };
    }

    return {
        state: state.mode,
        last_state_change: state.last_update
    };
}


async function _update_system_state(system_id, mode) {
    const update = {
        _id: system_id,
        $set: {
            state: {
                mode,
                last_update: Date.now()
            }
        }
    };

    await system_store.make_changes({
        update: {
            systems: [update]
        }
    });
}
/**
 *
 * CREATE_SYSTEM
 *
 */
async function create_system(req) {
    dbg.log0('create_system: got create_system with params:', util.inspect(req.rpc_params, { depth: null }));
    if (system_store.data.systems.length > 20) {
        throw new Error('Too many created systems');
    }
    if (system_store.data.systems.length > 0 && config.test_mode !== true) {
        throw new Error('Cannot create multiple production systems');
    }

    let system_id;
    const {
        name,
        email,
        password,
        must_change_password,
    } = req.rpc_params;

    try {
        const account_id = system_store.new_system_store_id();
        const changes = new_system_changes(name, account_id);
        system_id = changes.insert.systems[0]._id;
        const cluster_info = await _get_cluster_info();
        if (cluster_info) {
            changes.insert.clusters = [cluster_info];
        }

        Dispatcher.instance().activity({
            event: 'conf.create_system',
            level: 'info',
            system: system_id,
            actor: account_id,
            desc: `${name} was created by ${email.unwrap()}`,
        });

        await system_store.make_changes(changes);
        const auth = await _create_owner_account(
            name,
            email,
            password,
            must_change_password,
            account_id,
            system_id,
            changes.insert.pools[0]._id
        );

        const { token: operator_token } = await server_rpc.client.account.create_account({
            name,
            email: config.OPERATOR_ACCOUNT_EMAIL,
            has_login: false,
            s3_access: true,
            allow_bucket_creation: true,
            roles: ['operator']
        }, auth);

        dbg.log0('create_system: ensuring internal pool structure');
        await _ensure_internal_structure(system_id);
        await _configure_system_address(system_id, account_id);
        await _init_system(system_id);

        // Mark the system as ready
        await _update_system_state(system_id, 'READY');

        dbg.log0(`create_system: sending first stats to phone home`);
        await server_rpc.client.stats.send_stats(null, auth);

        dbg.log0('create_system: system created Successfully!');
        return { token: auth.auth_token, operator_token };

    } catch (err) {
        dbg.error('create_system: got error during create_system', err);

        if (system_id) {
            // Mark the system as not initialized
            await _update_system_state(system_id, 'COULD_NOT_INITIALIZE');
        }

        throw err;
    }
}

async function _get_cluster_info() {
    const cluster_info = await cluster_server.new_cluster_info({ address: "localhost" });
    if (cluster_info) {
        const dns_config = await os_utils.get_dns_config();
        if (dns_config.dns_servers.length) {
            dbg.log0(`create_system: DNS servers were already configured in first install to`, dns_config.dns_servers);
            cluster_info.dns_servers = dns_config.dns_servers;
        }
    }
    return cluster_info;
}

async function _create_owner_account(
    name,
    email,
    password,
    must_change_password,
    account_id,
    system_id,
    default_resource
) {
    dbg.log0(`create_system: creating account for ${name}, ${email}`);
    const { token: auth_token } = await server_rpc.client.account.create_account({
        name,
        email,
        password,
        has_login: true,
        s3_access: true,
        must_change_password,
        new_system_parameters: {
            account_id: account_id.toString(),
            new_system_id: system_id.toString(),
            default_resource: default_resource.toString(),
        },
    });
    return { auth_token };
}

async function _configure_system_address(system_id, account_id) {
    const system_address = (process.env.CONTAINER_PLATFORM === 'KUBERNETES') ?
        await os_utils.discover_k8s_services() : [];

    // This works because the lists are always sorted, see discover_k8s_services().
    const { system_address: curr_address } = system_store.data.systems[0] || {};
    if (curr_address && _.isEqual(curr_address, system_address)) {
        return;
    }

    await system_store.make_changes({
        update: {
            systems: [{
                _id: system_id,
                $set: { system_address }
            }]
        }
    });

    // TODO: need to ask nimrod what activity to dispatch.
    // if (system_address.length > 0) {
    //     Dispatcher.instance().activity({
    //         event: 'conf.system_address',
    //         level: 'info',
    //         system: system_id,
    //         actor: account_id,
    //         desc: `System addresses was set to `,
    //     });
    // }
}

/**
 *
 * READ_SYSTEM
 *
 */
async function read_system(req) {
    const system = req.system;
    const {
        nodes_aggregate_pool_no_cloud_and_mongo,
        nodes_aggregate_pool_with_cloud_and_mongo,
        nodes_aggregate_pool_with_cloud_no_mongo,
        hosts_aggregate_pool,
        accounts,
        funcs,
        buckets_stats,
        endpoint_groups
    } = await P.map_props({
        // nodes - count, online count, allocated/used storage aggregate by pool
        nodes_aggregate_pool_no_cloud_and_mongo: nodes_client.instance()
            .aggregate_nodes_by_pool(null, system._id, /*skip_cloud_nodes=*/ true, /*skip_mongo_nodes=*/ true),

        // TODO: find a better solution than aggregating nodes twice
        nodes_aggregate_pool_with_cloud_and_mongo: nodes_client.instance()
            .aggregate_nodes_by_pool(null, system._id, /*skip_cloud_nodes=*/ false, /*skip_mongo_nodes=*/ false),

        // nodes - count, online count, allocated/used storage aggregate by pool
        nodes_aggregate_pool_with_cloud_no_mongo: nodes_client.instance()
            .aggregate_nodes_by_pool(null, system._id, /*skip_cloud_nodes=*/ false, /*skip_mongo_nodes=*/ true),

        hosts_aggregate_pool: nodes_client.instance().aggregate_hosts_by_pool(null, system._id),

        accounts: P.fcall(() => server_rpc.client.account.list_accounts({}, {
            auth_token: req.auth_token
        })).then(
            response => response.accounts
        ),

        refresh_system_alloc_unused: node_allocator.refresh_system_alloc(system),

        funcs: P.resolve()
            // using default domain - will serve the list_funcs from web_server so if
            // endpoint is down it will not fail the read_system
            .then(() => server_rpc.client.func.list_funcs({}, {
                auth_token: req.auth_token,
                domain: 'default'
            }))
            .then(res => res.functions),

        buckets_stats: BucketStatsStore.instance().get_all_buckets_stats({ system: system._id }),
        endpoint_groups: _get_endpoint_groups()

    });

    const cluster_info = cutil.get_cluster_info();
    const objects_sys = {
        count: size_utils.BigInteger.zero,
        size: size_utils.BigInteger.zero,
    };
    _.forEach(system_store.data.buckets, bucket => {
        if (String(bucket.system._id) !== String(system._id)) return;
        objects_sys.size = objects_sys.size.plus(
            (bucket.storage_stats && bucket.storage_stats.objects_size) || 0
        );
        objects_sys.count = objects_sys.count.plus(
            (bucket.storage_stats && bucket.storage_stats.objects_count) || 0
        );
    });
    const ip_address = ip_module.address();
    const n2n_config = system.n2n_config;
    const debug_time = system.debug_mode ?
        Math.max(0, config.DEBUG_MODE_PERIOD - (Date.now() - system.debug_mode)) :
        undefined;

    const debug = _.omitBy({
        level: system.debug_level,
        time_left: debug_time
    }, _.isUndefined);

    const maintenance_mode = {
        state: system_utils.system_in_maintenance(system._id)
    };
    if (maintenance_mode.state) {
        const now = Date.now();
        maintenance_mode.time_left = Math.max(0, system.maintenance_mode - now);
    }

    let phone_home_config = {};
    if (system.freemium_cap.phone_home_unable_comm) {
        phone_home_config.phone_home_unable_comm = true;
    }

    let system_cap = system.freemium_cap.cap_terabytes ? system.freemium_cap.cap_terabytes : Number.MAX_SAFE_INTEGER;

    // TODO use n2n_config.stun_servers ?
    // var stun_address = 'stun://' + ip_address + ':' + stun.PORT;
    // var stun_address = 'stun://64.233.184.127:19302'; // === 'stun://stun.l.google.com:19302'
    // n2n_config.stun_servers = n2n_config.stun_servers || [];
    // if (!_.includes(n2n_config.stun_servers, stun_address)) {
    //     n2n_config.stun_servers.unshift(stun_address);
    //     dbg.log0('read_system: n2n_config.stun_servers', n2n_config.stun_servers);
    // }

    let last_upgrade = system.upgrade_history.successful_upgrades[0] && {
        timestamp: system.upgrade_history.successful_upgrades[0].timestamp
    };

    const stats_by_bucket = _.keyBy(buckets_stats, stats => _.get(system_store.data.get_by_id(stats._id), 'name'));

    const base_address = addr_utils.get_base_address(system.system_address);
    const dns_name = net.isIP(base_address.hostname) === 0 ? base_address.hostname : undefined;
    const tiering_status_by_tier = {};

    return {
        name: system.name,
        objects: objects_sys.count.toJSNumber(),
        roles: _.map(system.roles_by_account, function(roles, account_id) {
            var account = system_store.data.get_by_id(account_id);
            if (!account) return;
            return {
                roles: roles,
                account: _.pick(account, 'name', 'email')
            };
        }).filter(account => !_.isUndefined),
        buckets: _.filter(system.buckets_by_name, bucket => _.isUndefined(bucket.deleting)).map(
            bucket => {
                const tiering_pools_status = node_allocator.get_tiering_status(bucket.tiering);
                Object.assign(tiering_status_by_tier, tiering_pools_status);
                const func_configs = funcs.map(func => func.config);
                let b = bucket_server.get_bucket_info({
                    bucket,
                    nodes_aggregate_pool: nodes_aggregate_pool_with_cloud_and_mongo,
                    hosts_aggregate_pool,
                    func_configs,
                    bucket_stats: stats_by_bucket[bucket.name],
                });

                return b;
            }),
        namespace_resources: _.map(system.namespace_resources_by_name,
            ns => pool_server.get_namespace_resource_info(ns)),
        pools: _.filter(system.pools_by_name,
                pool => (!_.get(pool, 'cloud_pool_info.pending_delete') && !_.get(pool, 'mongo_pool_info.pending_delete')))
            .map(pool => pool_server.get_pool_info(pool, nodes_aggregate_pool_with_cloud_and_mongo, hosts_aggregate_pool)),
        tiers: _.map(system.tiers_by_name,
            tier => tier_server.get_tier_info(tier,
                nodes_aggregate_pool_with_cloud_and_mongo,
                tiering_status_by_tier[String(tier._id)])),
        accounts: accounts,
        functions: funcs,
        storage: size_utils.to_bigint_storage(_.defaults({
            used: objects_sys.size,
        }, nodes_aggregate_pool_with_cloud_no_mongo.storage, SYS_STORAGE_DEFAULTS)),
        nodes_storage: size_utils.to_bigint_storage(_.defaults({
            used: objects_sys.size,
        }, nodes_aggregate_pool_no_cloud_and_mongo.storage, SYS_STORAGE_DEFAULTS)),
        nodes: _.defaults({}, nodes_aggregate_pool_no_cloud_and_mongo.nodes, SYS_NODES_INFO_DEFAULTS),
        hosts: _.omit(_.defaults({}, hosts_aggregate_pool.nodes, SYS_NODES_INFO_DEFAULTS), 'storage_count'),
        owner: account_server.get_account_info(system_store.data.get_by_id(system._id).owner),
        last_stats_report: system.last_stats_report || 0,
        maintenance_mode: maintenance_mode,
        ssl_port: process.env.SSL_PORT,
        n2n_config: n2n_config,
        ip_address: ip_address,
        dns_name: dns_name,
        base_address: base_address.toString(),
        phone_home_config: phone_home_config,
        version: pkg.version,
        node_version: process.version,
        debug: debug,
        system_cap: system_cap,
        has_ssl_cert: !ssl_utils.is_using_generated_certs(),
        cluster: cluster_info,
        upgrade: { last_upgrade },
        defaults: {
            tiers: {
                data_frags: config.CHUNK_CODER_EC_DATA_FRAGS,
                parity_frags: config.CHUNK_CODER_EC_PARITY_FRAGS,
                replicas: config.CHUNK_CODER_REPLICAS,
                failure_tolerance_threshold: config.CHUNK_CODER_EC_TOLERANCE_THRESHOLD
            }
        },
        platform_restrictions: restrict[process.env.PLATFORM || 'dev'], // dev will be default for now
        s3_service: {
            addresses: _list_s3_addresses(system)
        },
        endpoint_groups
    };
}

function update_system(req) {
    var updates = _.pick(req.rpc_params, 'name');
    updates._id = req.system._id;
    return system_store.make_changes({
        update: {
            systems: [updates]
        }
    });
}

function set_maintenance_mode(req) {
    var updates = {};
    let audit_desc = '';
    const send_event = req.rpc_params.duration ?
        'dbg.maintenance_mode' : 'dbg.maintenance_mode_stopped';
    if (req.rpc_params.duration) {
        const d = moment.duration(req.rpc_params.duration, 'minutes');
        audit_desc = `Maintenance mode activated for ${[
            `${d.hours()} hour${d.hours() === 1 ? '' : 's'}`,
            `${d.minutes()} min${d.minutes() === 1 ? '' : 's'}`,
        ].join(' and ')}`;
    }
    updates._id = req.system._id;
    // duration is in minutes (?!$%)
    updates.maintenance_mode = Date.now() + (req.rpc_params.duration * 60000);
    return system_store.make_changes({
            update: {
                systems: [updates]
            }
        })
        .then(() => {
            Dispatcher.instance().activity({
                event: send_event,
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                desc: audit_desc,
            });
        });
}

function set_webserver_master_state(req) {
    if (req.rpc_params.is_master) {
        //Going Master //TODO:: add this one we get back to HA
        node_server.start_monitor();
    } else {
        //Stepping Down
        node_server.stop_monitor();
    }
}


/**
 *
 * DELETE_SYSTEM
 *
 */
function delete_system(req) {
    return system_store.make_changes({
        remove: {
            systems: [req.system._id]
        }
    });
}

/**
 *
 * LIST_SYSTEMS
 *
 */
function list_systems(req) {
    console.log('List systems:', _.pick(req.account, 'name', '_id'));
    if (!req.account) {
        if (!req.system) {
            throw new RpcError('FORBIDDEN',
                'list_systems requires authentication with account or system');
        }
        return {
            systems: [get_system_info(req.system, false)]
        };
    }
    if (req.account.is_support) {
        return list_systems_int(null, false);
    }
    return list_systems_int(req.account, false);
}

/**
 *
 * LIST_SYSTEMS_INT
 *
 */
function list_systems_int(account, get_ids) {
    // support gets to see all systems
    var roles;
    if (account) {
        roles = _.filter(system_store.data.roles, function(role) {
            return String(role.account._id) === String(account._id);
        });
    } else {
        roles = system_store.data.roles;
    }
    return {
        systems: _.map(roles, function(role) {
            return get_system_info(role.system, get_ids);
        })
    };
}


/**
 *
 * ADD_ROLE
 *
 */
function add_role(req) {
    var account = find_account_by_email(req);
    return system_store.make_changes({
        insert: {
            roles: [{
                _id: system_store.new_system_store_id(),
                account: account._id,
                system: req.system._id,
                role: req.rpc_params.role,
            }]
        }
    });
}



/**
 *
 * REMOVE_ROLE
 *
 */
function remove_role(req) {
    var account = find_account_by_email(req);
    var roles = _.filter(system_store.data.roles,
        role => String(role.system._id) === String(req.system._id) &&
        String(role.account._id) === String(account._id) &&
        role.role === req.rpc_params.role);
    if (!roles.length) return;
    var roles_ids = _.map(roles, '_id');
    return system_store.make_changes({
        remove: {
            roles: roles_ids
        }
    });
}

async function set_last_stats_report_time(req) {
    var updates = {};
    updates._id = req.system._id;
    updates.last_stats_report = req.rpc_params.last_stats_report;
    await system_store.make_changes({
        update: {
            systems: [updates]
        }
    });
}

async function update_n2n_config(req) {
    const { rpc_params, system, auth_token } = req;
    const update = rpc_params.config;
    dbg.log0('update_n2n_config', update);

    if (update.tcp_permanent_passive) {
        if (update.tcp_permanent_passive.min >= update.tcp_permanent_passive.max) {
            throw new Error('Min port range cannot be equal or higher then max');
        }
    }

    await system_store.make_changes({
        update: {
            systems: [{
                _id: system._id,
                n2n_config: {
                    ...system.n2n_config,
                    ...update
                }
            }]
        }
    });

    await server_rpc.client.node.sync_monitor_to_store(undefined, { auth_token });
}

async function attempt_server_resolve(req) {

    // If already in IP form, no need for resolving
    if (net.isIP(req.rpc_params.server_name)) {
        dbg.log2('attempt_server_resolve received an IP form', req.rpc_params.server_name);
        return { valid: true };
    }

    try {
        dbg.log0('attempt_server_resolve: testing dns resolve', req.rpc_params.server_name);
        await P.timeout(30000, dns.promises.resolve(req.rpc_params.server_name));
        dbg.log0('attempt_server_resolve: dns resolve OK');
    } catch (err) {
        if (err instanceof P.TimeoutError) {
            dbg.error('attempt_server_resolve: dns resolve timeout', req.rpc_params.server_name);
            return { valid: false, reason: 'TimeoutError' };
        } else {
            dbg.error('attempt_server_resolve: dns resolve failed', err);
            return { valid: false, reason: err.code };
        }
    }

    if (req.rpc_params.ping) {
        try {
            dbg.log0('attempt_server_resolve: testing ping', req.rpc_params.server_name);
            await net_utils.ping(req.rpc_params.server_name);
            dbg.error('attempt_server_resolve: ping OK');
        } catch (err) {
            dbg.error('attempt_server_resolve: ping failed', err);
            return { valid: false, reason: err.code };
        }
    }

    if (req.rpc_params.version_check) {
        try {
            const options = {
                url: `http://${req.rpc_params.server_name}:${process.env.PORT}/version`,
                method: 'GET',
                strictSSL: false, // means rejectUnauthorized: false
            };

            dbg.log0('attempt_server_resolve: testing version', options);
            /** @type {request.Response} */
            const res = await P.fromCallback(callback => request(options, callback));
            dbg.log0('attempt_server_resolve: version response', res.statusCode, res.body);

            if (res.statusCode !== 200) {
                dbg.error('attempt_server_resolve: version failed', res.statusCode);
                return {
                    valid: false,
                    reason: `Provided DNS Name doesn't seem to point to the current server (bad status)`
                };
            }

            if (res.body !== pkg.version) {
                dbg.error('attempt_server_resolve: version mismatch', res.statusCode);
                return {
                    valid: false,
                    reason: `Provided DNS Name doesn't seem to point to the current server (version mismatch)`
                };
            }

        } catch (err) {
            dbg.error('attempt_server_resolve: version failed', err);
            return { valid: false, reason: err.code };
        }
    }

    return { valid: true };
}


function log_client_console(req) {
    _.each(req.rpc_params.data, function(line) {
        nb_native().syslog(SYSLOG_INFO_LEVEL, req.rpc_params.data, SYSLOG_LOG_LOCAL1);
    });
}

function _init_system(sysid) {
    dbg.log0('init system - calling init_cluster and collecting first system stats');
    return cluster_server.init_cluster()
        .then(() => stats_collector.collect_system_stats())
        .then(() => Dispatcher.instance().alert(
            'INFO',
            sysid,
            "Welcome to NooBaa! It is time to get started. Connect your first resources, either 3 nodes or 1 cloud resource",
            Dispatcher.rules.only_once
        ));
}

async function _ensure_internal_structure(system_id) {
    const system = system_store.data.get_by_id(system_id);
    if (!system) throw new Error('SYSTEM DOES NOT EXIST');

    const support_account = _.find(system_store.data.accounts, account => account.is_support);
    if (!support_account) throw new Error('SUPPORT ACCOUNT DOES NOT EXIST');
    // Skip creation of agent on PostgreSQL
    if (config.DB_TYPE === 'postgres') return;
    try {
        server_rpc.client.hosted_agents.create_pool_agent({
            pool_name: `${config.INTERNAL_STORAGE_POOL_NAME}-${system_id}`
        }, {
            auth_token: auth_server.make_auth_token({
                system_id,
                role: 'admin',
                account_id: support_account._id
            })
        });
    } catch (err) {
        throw new Error('MONGO POOL CREATION FAILURE:' + err);
    }
}

async function get_join_cluster_yaml(req) {
    const { region = '', endpoints = {} } = req.rpc_params;
    const ep_min_count = endpoints.min_count || 1;
    const ep_max_count = endpoints.max_count || ep_min_count;
    if (ep_max_count < ep_min_count) {
        throw new RpcError('BAD_REQUEST', 'endpoints.max_count cannot be lower then endpoints.min_count');
    }

    const operator_account = system_store.data.accounts.find(account =>
        account.roles_by_system && // This will protect against support account
        account.roles_by_system[req.system._id] &&
        account.roles_by_system[req.system._id].includes('operator')
    );
    if (!operator_account) {
        throw new RpcError('NO_OPERATOR_ACCOUNT', 'Cannot find operator account');
    }

    const joinSecret = {
        apiVersion: 'v1',
        kind: 'Secret',
        metadata: {
            name: 'join-secret',
            namespace: config.REMOTE_NOOAA_NAMESPACE,
            labels: {
                app: 'noobaa'
            }
        },
        type: 'Opaque',
        stringData: {
            auth_token: await auth_server.make_auth_token({
                system_id: req.system._id,
                account_id: operator_account._id,
                role: 'operator'
            }),
            ...Object.fromEntries(
                ['mgmt', 'bg', 'md', 'hosted_agents'].map(api_name => [
                    `${api_name}_addr`,
                    addr_utils.get_base_address(req.system.system_address, {
                        api: api_name,
                        hint: 'EXTERNAL',
                        protocol: 'wss',
                        secure: true
                    }).toString()
                ])
            )
        }
    };

    const noobaa = {
        apiVersion: 'noobaa.io/v1alpha1',
        kind: 'NooBaa',
        metadata: {
            name: 'noobaa',
            namespace: config.REMOTE_NOOAA_NAMESPACE,
            labels: {
                app: 'noobaa'
            }
        },
        spec: {
            joinSecret: _.pick(joinSecret.metadata, ['name', 'namespace']),
            region,
            endpoints: {
                minCount: ep_min_count,
                maxCount: ep_max_count
            }
        }
    };

    return yaml_utils.stringify([
        joinSecret,
        noobaa
    ]);
}


async function update_endpoint_group(req) {
    const { group_name, is_remote, region, endpoint_range } = req.rpc_params;

    const cluster = system_store.get_local_cluster_info();
    const exists = (cluster.endpoint_groups || [])
        .some(group => group.name === group_name);

    if (exists) {
        const group = cluster.endpoint_groups.find(grp => grp.name === group_name);
        if (!_.isUndefined(is_remote)) {
            if (group.is_remote !== is_remote) {
                // We do not throw in order to not fail the noobaa operator.
                dbg.warn('update_endpoint_group: Conflicted is_remote value of ',
                    is_remote, ' for group: ', group, ' - aborting request');
                return;
            }

        }

        // call make_changes only if there are actual changes to make.
        // this check fixes a bug where make_changes sends a load_system_store notification
        // to the operator, which in its own reconcile sends back update_endpoint_group, and so forth
        if (group.region !== region || !_.isEqual(group.endpoint_range, endpoint_range)) {
            dbg.log0('updating endpoint group. old values: ', group, ' new values:', { name: group_name, is_remote, region, endpoint_range });

            // updating array in memory and then updating entire array with make_changes
            // changed the query from using $find and $ operator to update array element. 
            // this is not translated correctly to a postgres query
            group.region = region;
            group.endpoint_range = endpoint_range;
            await system_store.make_changes({
                update: {
                    clusters: [{
                        _id: cluster._id,
                        $set: {
                            'endpoint_groups': cluster.endpoint_groups
                        }
                    }]
                }
            });
        }

    } else {
        dbg.log0('adding new endpoint group:', { name: group_name, is_remote, region, endpoint_range });
        await system_store.make_changes({
            update: {
                clusters: [{
                    _id: cluster._id,
                    $push: {
                        endpoint_groups: {
                            name: group_name,
                            is_remote,
                            region,
                            endpoint_range
                        }
                    }
                }]
            }
        });
    }
    // Update the noobaa CRD if request was not originated from the operator
    const account_roles = req.account.roles_by_system[req.system._id];
    if (!account_roles.includes('operator') && !is_remote) {
        try {
            await KubeStore.instance.patch_noobaa({
                spec: {
                    region,
                    endpoints: {
                        minCount: endpoint_range.min,
                        maxCount: endpoint_range.max
                    }
                }
            });
        } catch (err) {
            dbg.error('update_endpoint_group: Could not update noobaa CRD, got', err);
        }
    }
}


const _get_group_accumulator = (group_map, group_name) =>
    js_utils.map_get_or_create(group_map, group_name, () => ({
        count: 0,
        endpoint_count: 0,
        cpu_count: 0,
        cpu_usage: 0,
        memory_usage: 0,
        read_bytes: 0,
        write_bytes: 0
    }));

async function get_endpoints_history(req) {
    const monitor_interval = config.ENDPOINT_MONITOR_INTERVAL;
    const { groups, step = 1 } = req.rpc_params;
    const since = Math.ceil(req.rpc_params.since / monitor_interval) * monitor_interval;
    const till = Math.floor(Math.min(req.rpc_params.till || Infinity, Date.now()) / monitor_interval) * monitor_interval;
    const stepInMili = moment.duration(step || 1, 'hour').asMilliseconds(); // the rpc params unit is hours.
    const [group_reports, bandwidth_reports] = await Promise.all([
        EndpointStatsStore.instance.get_endpoint_group_reports({ since, till, groups }),
        EndpointStatsStore.instance.get_bandwidth_reports({ since, till, endpoint_groups: groups })
    ]);

    // Sort by time.
    group_reports.sort((a, b) => a.end_time - b.end_time);
    bandwidth_reports.sort((a, b) => a.end_time - b.end_time);

    let i = 0;
    let j = 0;
    const bins = [];
    for (let start_time = since; start_time < till; start_time += stepInMili) {
        const end_time = start_time + stepInMili;
        const by_groups = new Map();
        for (; i < group_reports.length; ++i) {
            const report = group_reports[i];
            if (report.end_time >= end_time) break;

            const { endpoints, group_name } = report;
            const acc = _get_group_accumulator(by_groups, group_name);
            const memory_usage = _.sumBy(endpoints, ep_info =>
                ep_info.memory.used / ep_info.memory.total
            ) / endpoints.length;
            acc.count += 1;
            acc.endpoint_count += endpoints.length;
            acc.cpu_count += _.sumBy(endpoints, ep_info => ep_info.cpu.count);
            acc.cpu_usage += _.sumBy(endpoints, ep_info => ep_info.cpu.usage);
            acc.memory_usage += memory_usage;
        }

        for (; j < bandwidth_reports.length; ++j) {
            const report = bandwidth_reports[j];
            if (report.end_time >= end_time) break;

            const acc = _get_group_accumulator(by_groups, report.group_name);
            acc.bandwidth_reports += 1;
            acc.read_bytes += report.read_bytes;
            acc.write_bytes += report.write_bytes;
        }

        const bin = {
            timestamp: end_time,
            endpoint_count: 0,
            cpu_count: 0,
            cpu_usage: 0,
            memory_usage: 0,
            read_bytes: 0,
            write_bytes: 0
        };

        const desired_report_count = end_time <= till ?
            (stepInMili / monitor_interval) :
            ((till - start_time) / monitor_interval);

        for (const acc of by_groups.values()) {
            bin.endpoint_count += acc.endpoint_count / desired_report_count;
            bin.cpu_count += acc.cpu_count / desired_report_count;
            bin.cpu_usage += acc.cpu_usage / desired_report_count;
            bin.memory_usage += (acc.memory_usage / desired_report_count) / by_groups.size;
            bin.read_bytes += acc.read_bytes;
            bin.write_bytes += acc.write_bytes;
        }

        bins.push(bin);
    }

    return bins;
}

// UTILS //////////////////////////////////////////////////////////

function get_system_info(system, get_id) {
    if (get_id) {
        return _.pick(system, 'id');
    } else {
        return _.pick(system, 'name');
    }
}

function find_account_by_email(req) {
    var account = system_store.get_account_by_email(req.rpc_params.email);
    if (!account) {
        throw new RpcError('NO_SUCH_ACCOUNT', 'No such account email: ' + req.rpc_params.email);
    }
    return account;
}

function _list_s3_addresses(system) {
    if (process.platform === 'darwin') {
        return [{
            kind: 'LOOPBACK',
            address: addr_utils.get_base_address([], {
                hint: 'LOOPBACK',
                service: 's3',
                api: 's3',
                protocol: 'https',
                secure: true
            }).toString()
        }];
    }
    return system.system_address
        .filter(addr =>
            addr.service === 's3' &&
            addr.api === 's3' &&
            addr.secure
        )
        .sort((addr1, addr2) => {
            // Prefer external addresses.
            if (addr1.kind !== addr2.kind) {
                return addr1.kind === 'EXTERNAL' ? -1 : 1;
            }

            // Prefer addresses with higher weight.
            return Math.sign(addr2.weight - addr1.weight);
        })
        .map(addr => {
            const { kind, hostname, port } = addr;
            const url = url_utils.construct_url({ protocol: 'https', hostname, port });
            return {
                kind: kind,
                address: url.toString()
            };
        });
}

async function _get_endpoint_groups() {
    const { endpoint_groups = [] } = system_store.get_local_cluster_info();
    const till = Math.floor(Date.now() / config.ENDPOINT_MONITOR_INTERVAL) * config.ENDPOINT_MONITOR_INTERVAL;
    const reports = await EndpointStatsStore.instance.get_endpoint_group_reports({
        // Get information for group that are still registered (ignoring legacy groups)
        groups: endpoint_groups.map(group => group.name),
        // We go one full cycle behind a frame with data from all groups/endpoints.
        since: till - config.ENDPOINT_MONITOR_INTERVAL,
        till: till
    });

    const reports_by_group = _.keyBy(reports, report => report.group_name);
    return endpoint_groups.map(group => {
        const { end_time = -1, endpoints = [] } = reports_by_group[group.name] || {};
        const ep_count = endpoints.length;
        const memory_usage = ep_count > 0 ?
            (_.sumBy(endpoints, ep_info => ep_info.memory.used / ep_info.memory.total) / ep_count) :
            0;

        return {
            group_name: group.name,
            is_remote: group.is_remote,
            region: group.region,
            endpoint_count: ep_count,
            min_endpoint_count: group.endpoint_range.min,
            max_endpoint_count: group.endpoint_range.max,
            cpu_count: _.sumBy(endpoints, ep_info => ep_info.cpu.count),
            cpu_usage: _.sumBy(endpoints, ep_info => ep_info.cpu.usage), // Can add 1.0 per cpu.
            memory_usage,
            last_report_time: end_time
        };
    });
}

/**
 *
 * ROTATE MASTER KEY
 *
 */
// when rotating system, we need to reencrypt the lower sub trees master keys.
// when rotating account - need to reencrypt all the access keys.
// when rotating bucket, the map builder bg worker will reencrypt the cipher chunks and set the new master key id of the bucket
// to the chunk.
async function rotate_master_key(req) {
    const { entity, entity_type } = req.rpc_params; // System Name, Bucket Name, Account Email
    const entity_info = get_entity_info(entity, entity_type);
    if (!entity_info) throw new Error(`rotate_master_key: entity doesn't exist ${entity}`);

    const old_master_key = entity_info.master_key_id;

    if (!old_master_key || old_master_key.disabled === true) {
        throw new Error(`rotate_master_key: can not rotate master key, current master key is ${old_master_key}`);
    }
    // create the new master key and update in db
    const ROOT_KEY = system_store.master_key_manager.get_root_key_id();
    const master_key_base_props = {
        'master_key_id': system_store.master_key_manager.is_root_key(old_master_key.master_key_id) ? ROOT_KEY : old_master_key.master_key_id._id,
        'description': old_master_key.description,
        'cipher_type': old_master_key.cipher_type
    };
    const new_master_key = system_store.master_key_manager.new_master_key(master_key_base_props);
    await upsert_master_key({ insert: new_master_key });

    // update the entity with the new master key
    const change = [{
        _id: entity_info._id,
        $set: { master_key_id: new_master_key._id },
    }];

    const update_type = (entity_type === 'ACCOUNT' && { accounts: change }) ||
        (entity_type === 'BUCKET' && { buckets: change }) ||
        (entity_type === 'SYSTEM' && { systems: change }) ||
        undefined;

    await system_store.make_changes({
        update: update_type
    });

    await system_store.load();
    const mkm = system_store.master_key_manager;

    if (entity_type === 'SYSTEM') {
        await P.all(_.map(system_store.data.buckets, async function(bucket) {
            const reencrypted = mkm._reencrypt_master_key(bucket.master_key_id._id, new_master_key._id);
            await upsert_master_key({
                _id: bucket.master_key_id._id,
                update: { cipher_key: reencrypted, master_key_id: new_master_key._id }
            });
        }));
        await P.all(_.map(system_store.data.accounts, async function(account) {
            if (account.email.unwrap() === "support@noobaa.com") return;
            const reencrypted = mkm._reencrypt_master_key(account.master_key_id._id, new_master_key._id);
            await upsert_master_key({
                _id: account.master_key_id._id,
                update: { cipher_key: reencrypted, master_key_id: new_master_key._id }
            });
        }));
    }

    if (entity_type === 'ACCOUNT') {
        const new_s3_secret_keys_list = _.map(entity_info.access_keys, function(creds) {
            creds.secret_key = mkm.encrypt_sensitive_string_with_master_key_id(creds.secret_key, new_master_key._id);
            return creds;
        });
        const new_sync_creds_list = _.map(entity_info.sync_credentials_cache, function(creds) {
            creds.secret_key = mkm.encrypt_sensitive_string_with_master_key_id(creds.secret_key, new_master_key._id);
            return creds;
        });
        const pools_ns_resource_updates = get_pools_and_ns_resources_changes(new_sync_creds_list, entity_info._id);
        await update_account_secrets(entity_info._id, new_s3_secret_keys_list, new_sync_creds_list, pools_ns_resource_updates);
        // TODO: delete the old { encrypted secret key : decrypted secret key } pair from access keys LRU cache in master key manager
    }
}

/**
 *
 * DISABLE MASTER KEY
 *
 */
async function disable_master_key(req) {
    const { entity, entity_type } = req.rpc_params; // System Name, Bucket Name, Account Email
    await _disable_master_key(entity, entity_type);
}

// when disabling system, we need to disable the lower sub trees.
// when disabling account - need to decrypt all the access keys.
// when disabling bucket, the map builder bg worker will decrypt 
// the cipher chunks and remove the master key id of the chunk.
async function _disable_master_key(entity, entity_type) {
    const entity_info = get_entity_info(entity, entity_type);
    if (!entity_info) throw new Error(`_disable_master_key: entity doesn't exist ${entity}`);

    if (!entity_info.master_key_id || entity_info.master_key_id.disabled === true) {
        throw new Error(`_disable_master_key: can not disable master key, current master key is: ${util.inspect(entity_info)}`);
    }

    await upsert_master_key({ _id: entity_info.master_key_id._id, update: { disabled: true } });
    system_store.master_key_manager.set_m_key_disabled_val(entity_info.master_key_id._id, true);

    await system_store.load();
    if (entity_type === 'ACCOUNT') {
        const decrypted_s3_creds = entity_info.access_keys;
        const decrypted_sync_creds = entity_info.sync_credentials_cache;
        const pools_ns_resource_updates = get_pools_and_ns_resources_changes(decrypted_sync_creds, entity_info._id);
        await update_account_secrets(entity_info._id, decrypted_s3_creds, decrypted_sync_creds, pools_ns_resource_updates);
        // TODO: delete the old { encrypted secret key : decrypted secret key } pair from access keys LRU cache in master key manager
    }
    if (entity_type === 'SYSTEM') {
        await P.all(_.map(system_store.data.buckets, async function(bucket) {
            await _disable_master_key(bucket.name, 'BUCKET');
        }));
        await P.all(_.map(system_store.data.accounts, async function(account) {
            if (account.email.unwrap() === "support@noobaa.com") return;
            await _disable_master_key(account.email, 'ACCOUNT');
        }));
    }
}

/**
 *
 * ENABLE MASTER KEY
 *
 */
// enabling system - we don't enable the lower sub trees
// enabling account - need to encrypt all the access keys.
// enabling bucket - the map builder bg worker will encrypt the cipher chunks and set the bucket master key to the chunk. 
async function enable_master_key(req) {
    const { entity, entity_type } = req.rpc_params; // System Name, Bucket Name, Account Email
    const entity_info = get_entity_info(entity, entity_type);
    if (!entity_info) throw new Error(`_enable_master_key: entity doesn't exist ${entity}`);

    if (!entity_info.master_key_id || entity_info.master_key_id.disabled === false) {
        throw new Error(`_enable_master_key: can not enable master key, current master key is: ${entity_info.master_key_id}`);
    }

    await upsert_master_key({ _id: entity_info.master_key_id._id, update: { disabled: false } });
    system_store.master_key_manager.set_m_key_disabled_val(entity_info.master_key_id._id, false);

    if (entity_type === 'ACCOUNT') {
        await system_store.load();

        const enabled_master_key = entity_info.master_key_id._id;
        const new_s3_secret_keys_list = _.map(entity_info.access_keys, function(creds) {
            creds.secret_key = system_store.master_key_manager.encrypt_sensitive_string_with_master_key_id(
                creds.secret_key, enabled_master_key);
            return creds;
        });
        const new_sync_creds_list = _.map(entity_info.sync_credentials_cache, function(creds) {
            creds.secret_key = system_store.master_key_manager.encrypt_sensitive_string_with_master_key_id(
                creds.secret_key, enabled_master_key);
            return creds;
        });
        const pools_ns_resource_updates = get_pools_and_ns_resources_changes(new_sync_creds_list, entity_info._id);
        await update_account_secrets(entity_info._id, new_s3_secret_keys_list, new_sync_creds_list, pools_ns_resource_updates);
    }
}

async function update_account_secrets(account_id, access_keys, sync_credentials_cache, pools_ns_resource_updates) {
    await system_store.make_changes({
        update: {
            accounts: [{
                _id: account_id,
                $set: _.omitBy({
                    access_keys: access_keys,
                    sync_credentials_cache: sync_credentials_cache
                }, _.isUndefined),
            }],
            pools: pools_ns_resource_updates.pools,
            namespace_resources: pools_ns_resource_updates.namespace_resources
        }
    });
}

async function upsert_master_key(params) {
    if (params.update) {
        await system_store.make_changes({
            update: {
                master_keys: [{
                    _id: params._id,
                    $set: params.update
                }]
            }
        });
    }
    if (params.insert) {
        await system_store.make_changes({
            insert: {
                master_keys: [params.insert]
            }
        });
    }
}

// find and set the account's pools and namespace resources and 
// set the new secrets by the new sync creds 
function get_pools_and_ns_resources_changes(sync_creds, account_id) {
    let pools_updates = [];
    let ns_resources_updates = [];

    _.map(sync_creds, creds => {
        const pool_update = system_store.data.pools
            .filter(pool => pool.cloud_pool_info &&
                pool.cloud_pool_info.endpoint_type === creds.endpoint_type &&
                pool.cloud_pool_info.endpoint === creds.endpoint &&
                pool.cloud_pool_info.access_keys.account_id._id.toString() === account_id.toString() &&
                pool.cloud_pool_info.access_keys.access_key.unwrap() === creds.access_key.unwrap()
            )
            .map(pool => ({
                _id: pool._id,
                'cloud_pool_info.access_keys.secret_key': creds.secret_key,
            }));
        pools_updates.push(...pool_update);

        const ns_resource_update = system_store.data.namespace_resources
            .filter(ns_resource =>
                ns_resource.connection &&
                ns_resource.connection.endpoint_type === creds.endpoint_type &&
                ns_resource.connection.endpoint === creds.endpoint &&
                ns_resource.account._id.toString() === account_id.toString() &&
                ns_resource.connection.access_key.unwrap() === creds.access_key.unwrap()
            )
            .map(ns_resource => ({
                _id: ns_resource._id,
                'connection.secret_key': creds.secret_key
            }));
        ns_resources_updates.push(...ns_resource_update);
    });
    return {
        pools: pools_updates,
        namespace_resources: ns_resources_updates
    };
}

function get_entity_info(entity, entity_type) {
    return (entity_type === 'ACCOUNT' && system_store.data.accounts.find(acc =>
            acc.email.unwrap() === entity.unwrap())) ||
        (entity_type === 'BUCKET' && system_store.data.buckets.find(bkt =>
            bkt.name.unwrap() === entity.unwrap())) ||
        (entity_type === 'SYSTEM' && system_store.data.systems.find(sys =>
            sys.name === entity.unwrap())) || undefined;
}

async function upgrade_master_keys() {
    let master_keys = [];
    let buckets_updates = [];
    let accounts_updates = [];
    let pools_updates = [];
    let namespace_resources_updates = [];
    let system_master_key = system_store.data.systems[0].master_key_id;
    // upgrade system master key if it doesn't exist
    if (!system_master_key) {
        system_master_key = system_store.master_key_manager.new_master_key({
            description: `master key of ${system_store.data.systems[0]._id.toString()} system`,
            master_key_id: system_store.master_key_manager.get_root_key_id(),
            cipher_type: system_store.master_key_manager.get_root_key().cipher_type
        });
        master_keys.push(system_master_key);
    }
    // upgrade buckets master keys
    _.map(system_store.data.buckets, bucket => {
        if (bucket.master_key_id) return;
        const bucket_m_key = system_store.master_key_manager.new_master_key({
            description: `master key of ${bucket._id} bucket`,
            master_key_id: system_master_key._id,
            cipher_type: system_master_key.cipher_type
        });
        buckets_updates.push({
            _id: bucket._id,
            $set: {
                "master_key_id": bucket_m_key._id
            }
        });
        master_keys.push(bucket_m_key);

    });
    // upgrade accounts master keys
    _.map(system_store.data.accounts, account => {
        if (account.master_key_id || account.email.unwrap() === 'support@noobaa.com') return;
        const account_m_key = system_store.master_key_manager.new_master_key({
            description: `master key of ${account._id} account`,
            master_key_id: system_master_key._id,
            cipher_type: system_master_key.cipher_type
        });

        // encrypt access
        const encrypted_access_keys = _.map(account.access_keys, acc => {
            const encrypted_secret_key = system_store.master_key_manager.encrypt_sensitive_string_with_master_key_id(
                acc.secret_key, account_m_key._id);
            acc.secret_key = encrypted_secret_key;
            return acc;
        });
        // encrypt sync creds
        const encrypted_sync_creds = _.map(account.sync_credentials_cache, acc => {
            const encrypted_secret_key = system_store.master_key_manager.encrypt_sensitive_string_with_master_key_id(
                acc.secret_key, account_m_key._id);
            acc.secret_key = encrypted_secret_key;
            return acc;
        });

        // get updated for pools and ns_resources
        const pool_and_ns_resources_updates = get_pools_and_ns_resources_changes(encrypted_sync_creds, account._id);
        accounts_updates.push({
            _id: account._id,
            $set: {
                "access_keys": encrypted_access_keys,
                "sync_credentials_cache": encrypted_sync_creds,
                "master_key_id": account_m_key._id
            }
        });
        pools_updates.push(...pool_and_ns_resources_updates.pools);
        namespace_resources_updates.push(...pool_and_ns_resources_updates.namespace_resources);
        master_keys.push(account_m_key);
    });

    await system_store.make_changes({
        update: {
            systems: [{
                _id: system_store.data.systems[0]._id,
                $set: {
                    "master_key_id": system_master_key._id
                }
            }],
            buckets: buckets_updates,
            accounts: accounts_updates,
            pools: pools_updates,
            namespace_resources: namespace_resources_updates
        },
        insert: {
            master_keys: master_keys
        }
    });
}

// EXPORTS
exports._init = _init;
exports.is_initialized = is_initialized;
exports.new_system_defaults = new_system_defaults;
exports.new_system_changes = new_system_changes;

exports.get_system_status = get_system_status;
exports.create_system = create_system;
exports.read_system = read_system;
exports.update_system = update_system;
exports.delete_system = delete_system;

exports.list_systems = list_systems;
exports.list_systems_int = list_systems_int;

exports.add_role = add_role;
exports.remove_role = remove_role;

exports.set_last_stats_report_time = set_last_stats_report_time;
exports.log_client_console = log_client_console;

exports.update_n2n_config = update_n2n_config;
exports.attempt_server_resolve = attempt_server_resolve;
exports.set_maintenance_mode = set_maintenance_mode;
exports.set_webserver_master_state = set_webserver_master_state;
exports.get_join_cluster_yaml = get_join_cluster_yaml;
exports.update_endpoint_group = update_endpoint_group;
exports.get_endpoints_history = get_endpoints_history;

exports.rotate_master_key = rotate_master_key;
exports.disable_master_key = disable_master_key;
exports.enable_master_key = enable_master_key;
exports.upgrade_master_keys = upgrade_master_keys;
