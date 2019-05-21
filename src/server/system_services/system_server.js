/* Copyright (C) 2016 NooBaa */
'use strict';

require('../../util/dotenv').load();

const _ = require('lodash');
const fs = require('fs');
const tls = require('tls');
const net = require('net');
const dns = require('dns');
const path = require('path');
const request = require('request');
const ip_module = require('ip');
const moment = require('moment');
const util = require('util');
const chance = require('chance')();

const api = require('../../api');
const P = require('../../util/promise');
const pkg = require('../../../package.json');
const restrict = require('../../../platform_restrictions.json');
const dbg = require('../../util/debug_module')(__filename);
const cutil = require('../utils/clustering_utils');
const config = require('../../../config');
const MDStore = require('../object_services/md_store').MDStore;
const BucketStatsStore = require('../analytic_services/bucket_stats_store').BucketStatsStore;
const fs_utils = require('../../util/fs_utils');
const os_utils = require('../../util/os_utils');
const ph_utils = require('../../util/phone_home');
const { RpcError } = require('../../rpc');
const ssl_utils = require('../../util/ssl_utils');
const nb_native = require('../../util/nb_native');
const net_utils = require('../../util/net_utils');
const zip_utils = require('../../util/zip_utils');
const MongoCtrl = require('../utils/mongo_ctrl');
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
const promise_utils = require('../../util/promise_utils');
const bucket_server = require('./bucket_server');
const account_server = require('./account_server');
const cluster_server = require('./cluster_server');
const node_allocator = require('../node_services/node_allocator');
const stats_collector = require('../bg_services/stats_collector');
const config_file_store = require('./config_file_store').instance();
const chunk_config_utils = require('../utils/chunk_config_utils');
const addr_utils = require('../../util/addr_utils');
const string_utils = require('../../util/string_utils');

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
async function _init() {
    const DEFUALT_DELAY = 5000;
    let update_done = false;

    while (!update_done) {
        try {
            await promise_utils.delay_unblocking(DEFUALT_DELAY);
            if (system_store.is_finished_initial_load && system_store.data.systems.length) {
                const [ system ] = system_store.data.systems;

                // Register a routing resolver to provide routing tables for incoming
                // rpc connections.
                server_rpc.rpc.register_routing_authority(_resolve_routing);

                await _initialize_debug_level();

                // Must ask Mongo directly and not use the indication on the system_store,
                // using clustering_utils.check_if_master(), because waiting for system
                // store inital load does not guarantee that the bg updated and published
                // the indication on the system store.
                const { ismaster } = await MongoCtrl.is_master();
                if (ismaster) {
                    // Only the muster should update the system address.
                    await _configure_system_address(system._id, system.owner.id);
                }

                update_done = true;
            }

        } catch (err) {
            dbg.log0('system_server _init', 'UNCAUGHT ERROR', err, err.stack);
        }
    }
}

function _resolve_routing(hint) {
    const [ system ] = system_store.data.systems;

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
        }
    };
    return system;
}

function new_system_changes(name, owner_account_id) {
    // const default_pool_name = config.NEW_SYSTEM_POOL_NAME;
    const default_bucket_name = 'first.bucket';
    const bucket_with_suffix = default_bucket_name + '#' + Date.now().toString(36);
    const system = new_system_defaults(name, owner_account_id);
    // const pool = pool_server.new_pool_defaults(default_pool_name, system._id, 'HOSTS', 'BLOCK_STORE_FS');
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
    system.default_chunk_config = default_chunk_config._id;
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
    const bucket = bucket_server.new_bucket_defaults(default_bucket_name, system._id, policy._id);
    return {
        insert: {
            systems: [system],
            buckets: [bucket],
            tieringpolicies: [policy],
            tiers: [tier],
            chunk_configs: [default_chunk_config, ec_chunk_config],
            pools: [mongo_pool],
        }
    };
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

    const {
        name,
        email,
        password,
        must_change_password,
        time_config,
        dns_servers,
    } = req.rpc_params;

    try {
        const owner_secret = system_store.get_server_secret();
        const account_id = system_store.new_system_store_id();
        const changes = new_system_changes(name, account_id);
        const system_id = changes.insert.systems[0]._id;
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

        dbg.log0('create_system: ensuring internal pool structure');
        await _ensure_internal_structure(system_id);
        await _configure_time_settings(cluster_info, time_config, owner_secret, auth);
        await _configure_dns_servers(dns_servers, owner_secret, auth);
        await _configure_system_address(system_id, account_id);
        await _configure_system_proxy(auth);
        await _init_system(system_id);

        dbg.log0(`create_system: sending first stats to phone home`);
        await server_rpc.client.stats.send_stats(null, auth);

        dbg.log0('create_system: system created Successfully!');
        return { token: auth.auth_token };

    } catch (err) {
        dbg.error('create_system: got error during create_system', err);
        throw err;
    }
}

async function _get_cluster_info() {
    const cluster_info = await cluster_server.new_cluster_info({ address: "127.0.0.1" });
    if (cluster_info) {
        const [ntp_server, time_config, dns_config] = await Promise.all([
            os_utils.get_ntp(),
            os_utils.get_time_config(),
            os_utils.get_dns_and_search_domains()
        ]);

        if (ntp_server) {
            dbg.log0(`create_system: ntp server was already configured in first install to ${ntp_server}`);
            cluster_info.ntp = {
                timezone: time_config.timezone,
                server: ntp_server
            };
        }

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
    default_pool
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
            default_pool: default_pool.toString(),
            allowed_buckets: { full_permission: true },
        },
    });
    return { auth_token };
}

async function _configure_time_settings(cluster_info, time_config, owner_secret, auth) {
    const ntp_configured = Boolean(cluster_info && cluster_info.ntp);
    if (time_config && (!ntp_configured || time_config.ntp_server)) {
        time_config.target_secret = owner_secret;
        try {
            dbg.log0('create_system: updating time config with:', time_config);
            await server_rpc.client.cluster_server.update_time_config(time_config, auth);
        } catch (err) {
            dbg.error('create_system: Failed updating time config during create system', err);
        }
    } else {
        dbg.log0(`create_system: skipping time configuration. ntp_configured=${ntp_configured}, time_config=`, time_config);
    }
}

async function _configure_dns_servers(dns_servers, owner_secret, auth) {
    if (!_.isEmpty(dns_servers)) {
        dbg.log0(`create_system: updating dns servers:`, dns_servers);
        try {
            await server_rpc.client.cluster_server.update_dns_servers({
                target_secret: owner_secret,
                dns_servers
            }, auth);
        } catch (err) {
            dbg.error('create_system: Failed updating dns server during create system', err);
        }
    }
}

async function _configure_system_address(system_id, account_id) {
    const system_address = (process.env.CONTAINER_PLATFORM === 'KUBERNETES') ?
        await os_utils.discover_k8s_services() :
        await os_utils.discover_virtual_appliance_address();

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
    //         desc: `System addresss was set to `,
    //     });
    // }
}

async function _configure_system_proxy(auth) {
    if (process.env.PH_PROXY) {
        try {
            const proxy_address = process.env.PH_PROXY;
            dbg.log0(`create_system: updating proxy address to ${proxy_address}`);
            await server_rpc.client.system.update_phone_home_config({ proxy_address }, auth);
        } catch (err) {
            dbg.error('create_system: Failed updating phone home config during create system', err);
        }
    }
}

/**
 *
 * READ_SYSTEM
 *
 */
function read_system(req) {
    const system = req.system;
    return P.props({
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

        obj_count_per_bucket: MDStore.instance().count_objects_per_bucket(system._id),

        accounts: P.fcall(() => server_rpc.client.account.list_accounts({}, {
            auth_token: req.auth_token
        })).then(
            response => response.accounts
        ),

        has_ssl_cert: fs.statAsync(path.join('/etc', 'private_ssl_path', 'server.key'))
            .return(true)
            .catch(() => false),

        aggregate_data_free_by_tier: nodes_client.instance().aggregate_data_free_by_tier(
            _.map(system.tiers_by_name, tier => String(tier._id)),
            system._id),

        refresh_tiering_alloc: P.props(_.mapValues(system.buckets_by_name, bucket => node_allocator.refresh_tiering_alloc(bucket.tiering))),

        deletable_buckets: P.props(_.mapValues(system.buckets_by_name, bucket => bucket_server.can_delete_bucket(system, bucket))),

        rs_status: system_store.get_local_cluster_info().is_clusterized ?
            MongoCtrl.get_hb_rs_status()
            .catch(err => {
                dbg.error('failed getting updated rs_status on read_system', err);
            }) : undefined,

        funcs: P.resolve()
            // using default domain - will serve the list_funcs from web_server so if
            // endpoint is down it will not fail the read_system
            .then(() => server_rpc.client.func.list_funcs({}, {
                auth_token: req.auth_token,
                domain: 'default'
            }))
            .then(res => res.functions),

        buckets_stats: BucketStatsStore.instance().get_all_buckets_stats({ system: system._id }),

    }).then(({
        nodes_aggregate_pool_no_cloud_and_mongo,
        nodes_aggregate_pool_with_cloud_and_mongo,
        nodes_aggregate_pool_with_cloud_no_mongo,
        hosts_aggregate_pool,
        obj_count_per_bucket,
        accounts,
        has_ssl_cert,
        aggregate_data_free_by_tier,
        deletable_buckets,
        rs_status,
        funcs,
        buckets_stats
    }) => {
        const cluster_info = cutil.get_cluster_info(rs_status);
        for (const shard of cluster_info.shards) {
            for (const server of shard.servers) {
                const error = {
                    message: server.upgrade.error,
                    report_info: server.upgrade.report_info
                };
                server.upgrade.error = error;
                delete server.upgrade.report_info;
            }
        }
        const objects_sys = {
            count: size_utils.BigInteger.zero,
            size: size_utils.BigInteger.zero,
        };
        _.forEach(system_store.data.buckets, bucket => {
            if (String(bucket.system._id) !== String(system._id)) return;
            objects_sys.size = objects_sys.size.plus(
                (bucket.storage_stats && bucket.storage_stats.objects_size) || 0
            );
        });
        objects_sys.count = objects_sys.count.plus(obj_count_per_bucket[''] || 0);
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
        if (system.phone_home_proxy_address) {
            phone_home_config.proxy_address = system.phone_home_proxy_address;
        }
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

        let last_upgrade = system.last_upgrade && {
            timestamp: system.last_upgrade.timestamp,
            last_initiator_email: system.last_upgrade.initiator
        };

        const stats_by_bucket = _.keyBy(buckets_stats, stats => _.get(system_store.data.get_by_id(stats._id), 'name'));

        const base_address = addr_utils.get_base_address(system.system_address);
        const dns_name = net.isIP(base_address.hostname) === 0 ? base_address.hostname : undefined;

        return {
            name: system.name,
            objects: objects_sys.count.toJSNumber(),
            roles: _.map(system.roles_by_account, function(roles, account_id) {
                var account = system_store.data.get_by_id(account_id);
                return {
                    roles: roles,
                    account: _.pick(account, 'name', 'email')
                };
            }),
            buckets: _.map(system.buckets_by_name,
                bucket => {
                    const func_configs = funcs.map(func => func.config);
                    let b = bucket_server.get_bucket_info({
                        bucket,
                        nodes_aggregate_pool: nodes_aggregate_pool_with_cloud_and_mongo,
                        hosts_aggregate_pool,
                        aggregate_data_free_by_tier,
                        num_of_objects: obj_count_per_bucket[bucket._id] || 0,
                        func_configs,
                        bucket_stats: stats_by_bucket[bucket.name]
                    });
                    const bucket_name = bucket.name.unwrap();
                    if (deletable_buckets[bucket_name]) {
                        b.undeletable = deletable_buckets[bucket_name];
                    }
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
                    aggregate_data_free_by_tier[String(tier._id)])),
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
            web_links: get_system_web_links(system),
            n2n_config: n2n_config,
            ip_address: ip_address,
            dns_name: dns_name,
            base_address: base_address.toString(),
            remote_syslog_config: system.remote_syslog_config,
            phone_home_config: phone_home_config,
            version: pkg.version,
            node_version: process.version,
            debug: debug,
            system_cap: system_cap,
            has_ssl_cert: has_ssl_cert,
            cluster: cluster_info,
            upgrade: {
                last_upgrade: last_upgrade,
                can_upload_upgrade_package: _get_upgrade_availability_status(cluster_info)
            },
            defaults: {
                tiers: {
                    data_frags: config.CHUNK_CODER_EC_DATA_FRAGS,
                    parity_frags: config.CHUNK_CODER_EC_PARITY_FRAGS,
                    replicas: config.CHUNK_CODER_REPLICAS,
                    failure_tolerance_threshold: config.CHUNK_CODER_EC_TOLERANCE_THRESHOLD
                }
            },
            platform_restrictions: restrict[process.env.PLATFORM || 'dev'] // dev will be default for now
        };
    });
}

function _get_upgrade_availability_status(cluster_info) {
    // fill cluster information if we have a cluster.
    const servers = _.flatMap(cluster_info.shards, shard => shard.servers);
    const not_all_member_up = servers.some(server => server.status !== 'CONNECTED'); // Must be connected
    const not_enough_space = servers.some(server => server.storage.free < config.MIN_MEMORY_FOR_UPGRADE); // Must have at least 300MB free
    const version_mismatch = servers.some(server => server.version !== servers[0].version); // Must be of the same version.
    return (
        (not_all_member_up && 'NOT_ALL_MEMBERS_UP') ||
        (not_enough_space && 'NOT_ENOUGH_SPACE') ||
        (version_mismatch && 'VERSION_MISMATCH') ||
        undefined
    );
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
        audit_desc = `Maintanance mode activated for ${[
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
        // If current server became master
        promise_utils.delay_unblocking(config.DEBUG_MODE_PERIOD) //10m
            .then(() => server_rpc.client.cluster_server.set_debug_level({
                level: 0
            }, {
                auth_token: req.auth_token
            }));
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

function log_frontend_stack_trace(req) {
    return P.fcall(() => {
        dbg.log0('Logging frontend stack trace:', JSON.stringify(req.rpc_params.stack_trace));
    });
}

/**
 *
 * LIST_SYSTEMS
 *
 */
function list_systems(req) {
    console.log('List systems:', req.account);
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
                _id: system_store.generate_id(),
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


function get_system_web_links(system) {
    var reply = _.mapValues(system.resources, function(val, key) {
        if (key === 'toObject' || !_.isString(val) || !val) {
            return;
        }
        var versioned_resource = val.replace('noobaa-setup', 'noobaa-setup-' + pkg.version);
        versioned_resource = versioned_resource.replace('noobaa-s3rest', 'noobaa-s3rest-' + pkg.version);
        dbg.log1('resource link:', val, versioned_resource);
        return '/public/' + versioned_resource;
        // var params = {
        //     Bucket: S3_SYSTEM_BUCKET,
        //     Key: '/' + val,
        //     Expires: 24 * 3600 // 1 day
        // };
        // if (aws_s3) {
        //     return aws_s3.getSignedUrl('getObject', params);
        // } else {
        //     // workaround if we didn't setup aws credentials,
        //     // and just try a plain unsigned url
        //     return 'https://' + params.Bucket + '.s3.amazonaws.com/' + params.Key;
        // }
    });
    // remove keys with undefined values
    return _.omitBy(reply, _.isUndefined);
}

async function _get_agent_conf_id(req, routing_hint) {
    const { system, rpc_params } = req;
    const pool = rpc_params.pool ?
        system.pools_by_name[rpc_params.pool] :
        system_store.get_account_by_email(system.owner.email).default_pool;
    const exclude_drives = rpc_params.exclude_drives ? rpc_params.exclude_drives.sort() : [];
    const use_storage = rpc_params.roles ? rpc_params.roles.indexOf('STORAGE') > -1 : true;
    const use_s3 = rpc_params.roles ? rpc_params.roles.indexOf('S3') > -1 : false;
    const roles = rpc_params.roles || ['STORAGE'];

    // try to find an existing configuration with the same settings
    const cfg = system_store.data.agent_configs.find(conf =>
        pool._id === conf.pool._id &&
        use_storage === conf.use_storage &&
        use_s3 === conf.use_s3 &&
        _.isEqual(exclude_drives, conf.exclude_drives) &&
        routing_hint === conf.routing_hint
   );

    if (cfg) {
        dbg.log0(`found existing configuration with the required settings`);
        return cfg._id;

    } else {
        // create new configuration with the required settings
        dbg.log0(`creating new installation string for pool_id:${pool._id} exclude_drives:${exclude_drives} roles:${roles}`);
        const conf_id = system_store.new_system_store_id();
        const random_suffix = chance.string({
            length: 4,
            pool: string_utils.ALPHA_NUMERIC_CHARSET
        });
        await system_store.make_changes({
            insert: {
                agent_configs: [{
                    _id: conf_id,
                    // Fixes the issue of generating more then one name on the same second.
                    name: `config-${Date.now()}-${random_suffix}`,
                    system: system._id,
                    pool: pool._id,
                    exclude_drives,
                    use_storage,
                    use_s3,
                    routing_hint
                }]
            }
        });
        return conf_id;
    }
}

function _get_base64_install_conf(address, routing_hint, system, create_node_token) {
    const root_path = './noobaa_storage/';
    const install_conf = JSON.stringify({ address, routing_hint, system, create_node_token, root_path });
    return Buffer.from(install_conf).toString('base64');
}

async function _get_install_info(req, hint) {
    const conf_id = await _get_agent_conf_id(req, hint);
    const create_node_token = _get_create_node_token(req.system._id, req.account._id, conf_id);
    const addr = addr_utils.get_base_address(req.system.system_address, hint);
    const installer_path = `https://${addr.hostname}:${addr.port}/public`;
    const install_conf = _get_base64_install_conf(addr.toString(), hint, req.system.name, create_node_token);
    return { installer_path, install_conf };
}

async function get_node_installation_string(req) {
    const linux_agent_installer = `noobaa-setup-${pkg.version}`;
    const [
        kubernetes_yaml,
        ext_install_info,
        int_install_info
    ] = await Promise.all([
        fs.readFileAsync(path.resolve(__dirname, '../../deploy/NVA_build/noobaa_agent.yaml'), 'utf8'),
        _get_install_info(req, 'EXTERNAL'),
        _get_install_info(req, 'INTERNAL')
    ]);

    return {
        LINUX: `wget --no-check-certificate ${ext_install_info.installer_path}/${linux_agent_installer} && chmod 755 ${linux_agent_installer} && ./${linux_agent_installer} ${ext_install_info.install_conf}`,
        KUBERNETES: kubernetes_yaml.replace("AGENT_CONFIG_VALUE", int_install_info.install_conf).replace("AGENT_IMAGE_VERSION", pkg.version)
    };
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

async function verify_phonehome_connectivity(req) {
    const { proxy_address: proxy } = req.rpc_params;
    const options = proxy ? { proxy } : undefined;
    const res = await ph_utils.verify_connection_to_phonehome(options);
    return Boolean(res === 'CONNECTED');
}

// phone_home_proxy_address must be a full address like: http://(ip or hostname):(port)
function update_phone_home_config(req) {
    dbg.log0('update_phone_home_config', req.rpc_params);

    const previous_value = system_store.data.systems[0].phone_home_proxy_address;
    let desc_line = `Proxy address was `;
    desc_line += req.rpc_params.proxy_address ? `set to ${req.rpc_params.proxy_address}. ` : `cleared. `;
    desc_line += previous_value ? `Was previously set to ${previous_value}` : `Was not previously set`;

    let update = {
        _id: req.system._id
    };
    if (req.rpc_params.proxy_address === null) {
        update.$unset = {
            phone_home_proxy_address: 1
        };
    } else {
        update.phone_home_proxy_address = req.rpc_params.proxy_address;
    }

    dbg.log0(`testing internet connectivity using proxy ${req.rpc_params.proxy_address}`);
    return ph_utils.verify_connection_to_phonehome({ proxy: req.rpc_params.proxy_address })
        .then(res => {
            if (res === 'CONNECTED') {
                dbg.log0('connectivity test passed. configuring proxy address:', desc_line);
            } else {
                dbg.error(`Failed connectivity test using proxy ${req.rpc_params.proxy_address}. test result: ${res}`);
                if (req.rpc_params.proxy_address) {
                    throw new RpcError('CONNECTIVITY_TEST_FAILED', `Failed connectivity test using proxy ${req.rpc_params.proxy_address}`);
                }
                dbg.warn('No connectivity without proxy! removing proxy settings anyway');
            }
        })
        .then(() => system_store.make_changes({
            update: {
                systems: [update]
            }
        }))
        .then(() => os_utils.set_yum_proxy(req.rpc_params.proxy_address))
        .then(() => server_rpc.client.hosted_agents.stop())
        .then(() => server_rpc.client.hosted_agents.start())
        .then(() => {
            Dispatcher.instance().activity({
                event: 'conf.set_phone_home_proxy_address',
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                desc: desc_line,
            });
        })
        .return();
}

function configure_remote_syslog(req) {
    let params = req.rpc_params;
    dbg.log0('configure_remote_syslog', params);

    let update = {
        _id: req.system._id
    };
    let desc_line = '';
    if (params.enabled) {
        if (!params.protocol || !params.address || !params.port) {
            throw new RpcError('INVALID_REQUEST', 'Missing protocol, address or port');
        }
        desc_line = `remote syslog was directed to: ${params.address}:${params.port}`;
        update.remote_syslog_config = _.pick(params, 'protocol', 'address', 'port');

    } else {
        desc_line = 'Disabled remote syslog';
        update.$unset = {
            remote_syslog_config: 1
        };
    }

    return system_store.make_changes({
            update: {
                systems: [update]
            }
        })
        .then(() => os_utils.reload_syslog_configuration(params))
        .then(() => {
            Dispatcher.instance().activity({
                event: 'conf.remote_syslog',
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                desc: desc_line,
            });
        })
        .return();
}

function set_certificate(zip_file) {
    dbg.log0('upload_certificate');
    let key;
    let cert;
    return P.resolve()
        .then(() => zip_utils.unzip_from_file(zip_file.path))
        .then(zipfile => zip_utils.unzip_to_mem(zipfile))
        .then(files => {
            let key_count = 0;
            let cert_count = 0;
            _.forEach(files, file => {
                if (file.path.startsWith('__MACOSX')) return;
                if (file.path.endsWith('.key')) {
                    key = file.data.toString();
                    key_count += 1;
                } else if (file.path.endsWith('.cert')) {
                    cert = file.data.toString();
                    cert_count += 1;
                }
            });
            if (key_count !== 1) throw new Error('Expected single .key file in zip but found ' + key_count);
            if (cert_count !== 1) throw new Error('Expected single .cert file in zip but found ' + cert_count);

            // check that these key and certificate are valid, matching and can be loaded before storing them
            try {
                tls.createSecureContext({ key });
            } catch (err) {
                dbg.error('The provided private key is invalid', err);
                throw new Error('The provided private key is invalid');
            }
            try {
                tls.createSecureContext({ cert });
            } catch (err) {
                dbg.error('The provided certificate is invalid', err);
                throw new Error('The provided certificate is invalid');
            }
            try {
                tls.createSecureContext({ key, cert });
            } catch (err) {
                dbg.error('The provided certificate and private key do not match', err);
                throw new Error('The provided certificate and private key do not match');
            }
        })
        .then(() => fs_utils.create_fresh_path(ssl_utils.SERVER_SSL_DIR_PATH))
        .then(() => P.join(
            save_config_file(ssl_utils.SERVER_SSL_KEY_PATH, key),
            save_config_file(ssl_utils.SERVER_SSL_CERT_PATH, cert)
        ))
        .then(() => {
            Dispatcher.instance().activity({
                system: system_store.data.systems[0]._id,
                event: 'conf.set_certificate',
                level: 'info',
                desc: `New certificate was successfully set`
            });
        });
}

function save_config_file(filename, data) {
    return P.resolve()
        .then(() => config_file_store.insert({ filename, data }))
        .then(() => fs_utils.replace_file(filename, data));
}

function _get_create_node_token(system_id, account_id, agent_config_id) {
    dbg.log0('creating new create_auth_token for conf_id', agent_config_id);
    let auth_parmas = {
        system_id,
        account_id,
        role: 'create_node',
        extra: {
            agent_config_id
        }
    };
    let token = auth_server.make_auth_token(auth_parmas);
    dbg.log0(`created create_node_token: ${token}`);
    return token;
}

function attempt_server_resolve(req) {
    let result;
    //If already in IP form, no need for resolving
    if (net.isIP(req.rpc_params.server_name)) {
        dbg.log2('attempt_server_resolve recieved an IP form', req.rpc_params.server_name);
        return P.resolve({ valid: true });
    }

    dbg.log0('attempt_server_resolve', req.rpc_params.server_name);
    return P.promisify(dns.resolve)(req.rpc_params.server_name)
        .timeout(30000)
        .then(() => {
            dbg.log0('resolution passed, testing ping');
            if (req.rpc_params.ping) {
                return net_utils.ping(req.rpc_params.server_name)
                    .catch(err => {
                        dbg.error('ping failed', err);
                        result = {
                            valid: false,
                            reason: err.code
                        };
                    });
            }
        })
        .then(() => {
            dbg.log0('resolution passed, testing version');
            if (req.rpc_params.version_check && !result) {
                let options = {
                    url: `http://${req.rpc_params.server_name}:${process.env.PORT}/version`,
                    method: 'GET',
                    strictSSL: false, // means rejectUnauthorized: false
                };
                dbg.log0('Sending Get Version Request To DNS Name:', options);
                return P.fromCallback(callback => request(options, callback), {
                        multiArgs: true
                    })
                    .spread(function(response, reply) {
                        dbg.log0('Received Response From DNS Name', response.statusCode);
                        if (response.statusCode !== 200 || String(reply) !== pkg.version) {
                            dbg.error('version failed');
                            result = {
                                valid: false,
                                reason: `Provided DNS Name doesn't seem to point to the current server`
                            };
                        }
                    })
                    .catch(err => {
                        dbg.error('version failed', err);
                        result = {
                            valid: false,
                            reason: err.code
                        };
                    });
            }
        })
        .then(() => (result ? result : {
            valid: true
        }))
        .catch(P.TimeoutError, () => {
            dbg.error('resolve timedout');
            return {
                valid: false,
                reason: 'TimeoutError'
            };
        })
        .catch(err => {
            dbg.error('resolve failed', err);
            return {
                valid: false,
                reason: err.code
            };
        });
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
            'Welcome to NooBaa! It\'s time to get started. Connect your first resources, either 3 nodes or 1 cloud resource',
            Dispatcher.rules.only_once
        ));
}

async function _ensure_internal_structure(system_id) {
    const system = system_store.data.get_by_id(system_id);
    if (!system) throw new Error('SYSTEM DOES NOT EXIST');

    const support_account = _.find(system_store.data.accounts, account => account.is_support);
    if (!support_account) throw new Error('SUPPORT ACCOUNT DOES NOT EXIST');
    try {
        server_rpc.client.hosted_agents.create_pool_agent({
            pool_name: `${config.INTERNAL_STORAGE_POOL_NAME}-${system}`
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

// EXPORTS
exports._init = _init;
exports.new_system_defaults = new_system_defaults;
exports.new_system_changes = new_system_changes;

exports.create_system = create_system;
exports.read_system = read_system;
exports.update_system = update_system;
exports.delete_system = delete_system;

exports.list_systems = list_systems;
exports.list_systems_int = list_systems_int;

exports.add_role = add_role;
exports.remove_role = remove_role;

exports.log_frontend_stack_trace = log_frontend_stack_trace;
exports.set_last_stats_report_time = set_last_stats_report_time;
exports.log_client_console = log_client_console;

exports.update_n2n_config = update_n2n_config;
exports.attempt_server_resolve = attempt_server_resolve;
exports.verify_phonehome_connectivity = verify_phonehome_connectivity;
exports.update_phone_home_config = update_phone_home_config;
exports.set_maintenance_mode = set_maintenance_mode;
exports.set_webserver_master_state = set_webserver_master_state;
exports.configure_remote_syslog = configure_remote_syslog;
exports.set_certificate = set_certificate;

exports.get_node_installation_string = get_node_installation_string;
