/* Copyright (C) 2016 NooBaa */
'use strict';

require('../../util/dotenv').load();
const DEV_MODE = (process.env.DEV_MODE === 'true');

const _ = require('lodash');
const fs = require('fs');
const url = require('url');
const tls = require('tls');
const net = require('net');
const dns = require('dns');
const path = require('path');
const request = require('request');
const ip_module = require('ip');
const moment = require('moment');

const P = require('../../util/promise');
const pkg = require('../../../package.json');
const dbg = require('../../util/debug_module')(__filename);
const cutil = require('../utils/clustering_utils');
const config = require('../../../config');
const MDStore = require('../object_services/md_store').MDStore;
const fs_utils = require('../../util/fs_utils');
const os_utils = require('../../util/os_utils');
const RpcError = require('../../rpc/rpc_error');
const net_utils = require('../../util/net_utils');
const zip_utils = require('../../util/zip_utils');
const Dispatcher = require('../notifications/dispatcher');
const size_utils = require('../../util/size_utils');
const server_rpc = require('../server_rpc');
const pool_server = require('./pool_server');
const tier_server = require('./tier_server');
const auth_server = require('../common_services/auth_server');
const node_server = require('../node_services/node_server');
const nodes_client = require('../node_services/nodes_client');
const system_store = require('../system_services/system_store').get_instance();
const promise_utils = require('../../util/promise_utils');
const bucket_server = require('./bucket_server');
const account_server = require('./account_server');
const cluster_server = require('./cluster_server');
const node_allocator = require('../node_services/node_allocator');
const stats_collector = require('../bg_services/stats_collector');
const config_file_store = require('./config_file_store').instance();
const system_utils = require('../utils/system_utils');
const MongoCtrl = require('../utils/mongo_ctrl');
const api = require('../../api/api');
const ssl_utils = require('../../util/ssl_utils');

const SYS_STORAGE_DEFAULTS = Object.freeze({
    total: 0,
    free: 0,
    unavailable_free: 0,
    alloc: 0,
    real: 0,
});
const SYS_NODES_INFO_DEFAULTS = Object.freeze({
    count: 0,
    online: 0,
    by_mode: {},
});

var client_syslog;
// called on rpc server init
function _init() {
    const DEFUALT_DELAY = 5000;

    var native_core = require('../../util/native_core')(); // eslint-disable-line global-require
    client_syslog = new native_core.Syslog();

    function wait_for_system_store() {
        var update_done = false;
        P.fcall(function() {
                if (system_store.is_finished_initial_load && system_store.data.systems.length) {
                    return P.join(
                            _initialize_debug_level()
                        )
                        .then(() => {
                            update_done = true;
                        });
                }
            })
            .catch(err => {
                dbg.log('system_server _init', 'UNCAUGHT ERROR', err, err.stack);
                return promise_utils.delay_unblocking(DEFUALT_DELAY).then(wait_for_system_store);
            })
            .then(() => {
                if (!update_done) {
                    return promise_utils.delay_unblocking(DEFUALT_DELAY).then(wait_for_system_store);
                }
            });
    }
    promise_utils.delay_unblocking(DEFUALT_DELAY).then(wait_for_system_store);
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
        _id: system_store.generate_id(),
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
        upgrade: {
            path: '',
            status: 'UNAVAILABLE',
            error: '',
        },
        mongo_upgrade: {
            blocks_to_buckets: true
        },
        last_stats_report: 0,
        upgrade_date: Date.now(),
        freemium_cap: {
            phone_home_upgraded: false,
            phone_home_notified: false,
            cap_terabytes: 20
        }
    };
    return system;
}

function new_system_changes(name, owner_account) {
    return P.fcall(function() {
        const default_pool_name = config.NEW_SYSTEM_POOL_NAME;
        const default_bucket_name = 'first.bucket';
        const bucket_with_suffix = default_bucket_name + '#' + Date.now().toString(36);
        var system = new_system_defaults(name, owner_account._id);
        var pool = pool_server.new_pool_defaults(default_pool_name, system._id, 'HOSTS', 'BLOCK_STORE_FS');
        var tier = tier_server.new_tier_defaults(bucket_with_suffix, system._id, [{
            spread_pools: [pool._id]
        }]);
        var policy = tier_server.new_policy_defaults(bucket_with_suffix, system._id, [{
            tier: tier._id,
            order: 0,
            spillover: false,
            disabled: false
        }]);
        var bucket = bucket_server.new_bucket_defaults(default_bucket_name, system._id, policy._id);

        let bucket_insert = [bucket];
        let tieringpolicies_insert = [policy];
        let tiers_insert = [tier];
        let pools_insert = [pool];

        Dispatcher.instance().activity({
            event: 'conf.create_system',
            level: 'info',
            system: system._id,
            actor: owner_account._id,
            desc: `${name} was created by ${owner_account && owner_account.email}`,
        });

        return {
            insert: {
                systems: [system],
                buckets: bucket_insert,
                tieringpolicies: tieringpolicies_insert,
                tiers: tiers_insert,
                pools: pools_insert,
            }
        };
    });
}


/**
 *
 * CREATE_SYSTEM
 *
 */
function create_system(req) {
    var account = _.pick(req.rpc_params, 'name', 'email', 'password');
    account.has_login = true;
    if (system_store.data.systems.length > 20) {
        throw new Error('Too many created systems');
    }
    //Create the new system
    account._id = system_store.generate_id();
    let allowed_buckets;
    let default_pool;
    let reply_token;
    let owner_secret = system_store.get_server_secret();
    let system_changes;
    let ntp_configured = false;
    //Create system
    return P.fcall(function() {
            var params = {
                code: req.rpc_params.activation_code || '',
                email: req.rpc_params.email,
                system_info: _.omit(req.rpc_params, ['access_keys', 'password']),
                command: 'perform_activation'
            };
            return _communicate_license_server(params, process.env.PH_PROXY);
        })
        .then(() => {
            // Attempt to resolve DNS name, if supplied
            if (!req.rpc_params.dns_name) {
                return;
            }
            return attempt_server_resolve(_.defaults({
                    rpc_params: {
                        server_name: req.rpc_params.dns_name,
                        version_check: true
                    }
                }, req))
                .then(result => {
                    if (!result.valid) {
                        throw new Error('Could not resolve ' + req.rpc_params.dns_name +
                            ' Reason ' + result.reason);
                    }
                });
        })
        .then(() => {
            return P.join(
                new_system_changes(account.name, account),
                cluster_server.new_cluster_info({ address: "127.0.0.1" }),
                os_utils.get_ntp(),
                os_utils.get_time_config(),
                os_utils.get_dns_servers()
            );
        })
        .spread(function(changes, cluster_info, ntp_server, time_config, dns_config) {
            allowed_buckets = {
                full_permission: true
            };
            default_pool = changes.insert.pools[0]._id.toString();

            if (cluster_info) {
                if (ntp_server) {
                    dbg.log0(`ntp server was already configured in first install to ${ntp_server}`);
                    ntp_configured = true;
                    cluster_info.ntp = {
                        timezone: time_config.timezone,
                        server: ntp_server
                    };
                }
                if (dns_config.dns_servers.length) {
                    dbg.log0(`DNS servers were already configured in first install to`, dns_config.dns_servers);
                    cluster_info.dns_servers = dns_config.dns_servers;
                }
                changes.insert.clusters = [cluster_info];
            }
            return changes;
        })
        .then(changes => {
            system_changes = changes;
            return system_store.make_changes(changes);
        })
        .then(() =>
            //Create the owner account
            server_rpc.client.account.create_account({
                name: req.rpc_params.name,
                email: req.rpc_params.email,
                password: req.rpc_params.password,
                has_login: true,
                s3_access: true,
                new_system_parameters: {
                    account_id: account._id.toString(),
                    allowed_buckets: allowed_buckets,
                    default_pool: default_pool,
                    new_system_id: system_changes.insert.systems[0]._id.toString()
                },
            }))
        .then(response => {
            reply_token = response.token;

            //Time config, if supplied
            if (!req.rpc_params.time_config ||
                (ntp_configured && !req.rpc_params.time_config.ntp_server)) {
                return;
            }
            let time_config = req.rpc_params.time_config;
            time_config.target_secret = owner_secret;
            return server_rpc.client.cluster_server.update_time_config(time_config, {
                auth_token: reply_token
            });
        })
        .then(() => {
            //DNS servers, if supplied
            if (_.isEmpty(req.rpc_params.dns_servers)) {
                return;
            }

            return server_rpc.client.cluster_server.update_dns_servers({
                target_secret: owner_secret,
                dns_servers: req.rpc_params.dns_servers
            }, {
                auth_token: reply_token
            });
        })
        .then(() => {
            //DNS name, if supplied
            if (!req.rpc_params.dns_name) {
                return;
            }
            return server_rpc.client.system.update_hostname({
                hostname: req.rpc_params.dns_name
            }, {
                auth_token: reply_token
            });
        })
        .then(() => {
            if (!process.env.PH_PROXY) {
                return;
            }

            return server_rpc.client.system.update_phone_home_config({
                proxy_address: process.env.PH_PROXY
            }, {
                auth_token: reply_token
            });
        })
        .then(() => _ensure_spillover_structure(system_changes))
        .then(() => _init_system(system_changes.insert.systems[0]._id))
        .then(() => system_utils.mongo_wrapper_system_created())
        .then(() => ({
            token: reply_token
        }))
        .catch(err => {
            throw err;
        });
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

        // passing the bucket itself as 2nd arg to bucket_server.get_cloud_sync
        // which is supported instead of sending the bucket name in an rpc req
        // just to reuse the rpc function code without calling through rpc.
        cloud_sync_by_bucket: P.props(_.mapValues(system.buckets_by_name,
            bucket => bucket_server.get_cloud_sync(req, bucket))),

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

        refresh_tiering_alloc: P.props(_.mapValues(system.buckets_by_name, bucket =>
            node_allocator.refresh_tiering_alloc(bucket.tiering))),

        deletable_buckets: P.props(_.mapValues(system.buckets_by_name, bucket =>
            bucket_server.can_delete_bucket(system, bucket))),

        rs_status: system_store.get_local_cluster_info().is_clusterized ?
            MongoCtrl.get_hb_rs_status()
            .catch(err => {
                dbg.error('failed getting updated rs_status on read_system', err);
            }) : undefined
    }).then(({
        nodes_aggregate_pool_no_cloud_and_mongo,
        nodes_aggregate_pool_with_cloud_and_mongo,
        nodes_aggregate_pool_with_cloud_no_mongo,
        hosts_aggregate_pool,
        obj_count_per_bucket,
        cloud_sync_by_bucket,
        accounts,
        has_ssl_cert,
        aggregate_data_free_by_tier,
        deletable_buckets,
        rs_status
    }) => {
        const objects_sys = {
            count: size_utils.BigInteger.zero,
            size: size_utils.BigInteger.zero,
        };
        _.forEach(system_store.data.buckets, bucket => {
            if (String(bucket.system._id) !== String(system._id)) return;
            objects_sys.size = objects_sys.size
                .plus(bucket.storage_stats && bucket.storage_stats.objects_size || 0);
        });
        objects_sys.count = objects_sys.count.plus(obj_count_per_bucket[''] || 0);
        const ip_address = ip_module.address();
        const n2n_config = system.n2n_config;
        const debug_level = system.debug_level;

        const upgrade = {
            last_upgrade: system.upgrade_date || undefined,
            status: system.upgrade ? system.upgrade.status : 'UNAVAILABLE',
            message: system.upgrade ? system.upgrade.error : undefined
        };
        const maintenance_mode = {
            state: system_utils.system_in_maintenance(system._id)
        };
        if (maintenance_mode.state) {
            maintenance_mode.till = system.maintenance_mode;
        }

        let phone_home_config = {};
        phone_home_config.upgraded_cap_notification = system.freemium_cap.phone_home_upgraded ?
            !system.freemium_cap.phone_home_notified : false;
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

        const response = {
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
                    let b = bucket_server.get_bucket_info(
                        bucket,
                        nodes_aggregate_pool_with_cloud_and_mongo,
                        aggregate_data_free_by_tier,
                        obj_count_per_bucket[bucket._id] || 0,
                        cloud_sync_by_bucket[bucket.name]);
                    if (deletable_buckets[bucket.name]) {
                        b.undeletable = deletable_buckets[bucket.name];
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
            storage: size_utils.to_bigint_storage(_.defaults({
                used: objects_sys.size,
            }, nodes_aggregate_pool_with_cloud_no_mongo.storage, SYS_STORAGE_DEFAULTS)),
            nodes_storage: size_utils.to_bigint_storage(_.defaults({
                used: objects_sys.size,
            }, nodes_aggregate_pool_no_cloud_and_mongo.storage, SYS_STORAGE_DEFAULTS)),
            nodes: _.defaults({}, nodes_aggregate_pool_no_cloud_and_mongo.nodes, SYS_NODES_INFO_DEFAULTS),
            hosts: _.defaults({}, hosts_aggregate_pool.nodes, SYS_NODES_INFO_DEFAULTS),
            owner: account_server.get_account_info(system_store.data.get_by_id(system._id).owner),
            last_stats_report: system.last_stats_report || 0,
            maintenance_mode: maintenance_mode,
            ssl_port: process.env.SSL_PORT,
            web_links: get_system_web_links(system),
            n2n_config: n2n_config,
            ip_address: ip_address,
            base_address: system.base_address || 'wss://' + ip_address + ':' + process.env.SSL_PORT,
            remote_syslog_config: system.remote_syslog_config,
            phone_home_config: phone_home_config,
            version: pkg.version,
            debug_level: debug_level,
            upgrade: upgrade,
            system_cap: system_cap,
            has_ssl_cert: has_ssl_cert,
        };

        // fill cluster information if we have a cluster.
        const cluster_info = cutil.get_cluster_info(rs_status);
        response.cluster = cluster_info;
        const all_connected = _.every(cluster_info.shards[0].servers, server => server.status === 'CONNECTED'); // must be connected
        const enough_disk = _.every(cluster_info.shards[0].servers, server => server.storage.free > 3 * 1024 * 1024 * 1024); // must have at least 3GB free
        response.upgrade.unavailable =
            (!all_connected && 'NOT_ALL_MEMBERS_UP') ||
            (!enough_disk && 'NOT_ENOUGH_SPACE') ||
            undefined;

        const res = _get_ip_and_dns(system);
        response.ip_address = res.ip_address;
        response.dns_name = res.dns_name;

        response.accounts = accounts;
        return response;
    });
}


function update_system(req) {
    var updates = _.pick(req.rpc_params, 'name');
    updates._id = req.system._id;
    return system_store.make_changes({
        update: {
            systems: [updates]
        }
    }).return();
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
        })
        .return();
}

function set_webserver_master_state(req) {
    // TODO: This is for future use when we will need to realize if master state changed
    if (system_store.is_cluster_master !== req.rpc_params.is_master) {
        system_store.is_cluster_master = req.rpc_params.is_master;
        if (system_store.is_cluster_master) {
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
    }).return();
}

function log_frontend_stack_trace(req) {
    return P.fcall(function() {
            dbg.log0('Logging frontend stack trace:', JSON.stringify(req.rpc_params.stack_trace));
        })
        .return();
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
    }).return();
}



/**
 *
 * REMOVE_ROLE
 *
 */
function remove_role(req) {
    var account = find_account_by_email(req);
    var roles = _.filter(system_store.data.roles,
        role =>
        String(role.system._id) === String(req.system._id) &&
        String(role.account._id) === String(account._id) &&
        role.role === req.rpc_params.role);
    if (!roles.length) return;
    var roles_ids = _.map(roles, '_id');
    return system_store.make_changes({
        remove: {
            roles: roles_ids
        }
    }).return();
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


function get_node_installation_string(req) {
    return P.resolve()
        .then(() => {
            const system = req.system;
            const res = _get_ip_and_dns(system);
            const server_ip = res.dns_name ? res.dns_name : res.ip_address;
            const linux_agent_installer = `noobaa-setup-${pkg.version}`;
            const agent_installer = `noobaa-setup-${pkg.version}.exe`;
            const pool = req.rpc_params.pool ?
                req.system.pools_by_name[req.rpc_params.pool] :
                system_store.get_account_by_email(req.system.owner.email).default_pool;
            const exclude_drives = req.rpc_params.exclude_drives ? req.rpc_params.exclude_drives.sort() : [];
            const use_storage = req.rpc_params.roles ? req.rpc_params.roles.indexOf('STORAGE') > -1 : true;
            const use_s3 = req.rpc_params.roles ? req.rpc_params.roles.indexOf('S3') > -1 : false;

            const roles = req.rpc_params.roles || ['STORAGE'];
            // try to find an existing configuration with the same settings
            return P.resolve()
                .then(() => {
                    let cfg = system_store.data.agent_configs.find(conf =>
                        pool._id === conf.pool._id &&
                        use_storage === conf.use_storage && use_s3 === conf.use_s3 &&
                        _.isEqual(exclude_drives, conf.exclude_drives));
                    if (cfg) {
                        // return the configuratio id if found
                        dbg.log0(`found existing configuration with the required settings`);
                        return cfg._id;
                    }
                    dbg.log0(`creating new installation string for pool_id:${pool._id} exclude_drives:${exclude_drives} roles:${roles}`);
                    // create new configuration with the required settings
                    let _id = system_store.generate_id();
                    return system_store.make_changes({
                        insert: {
                            agent_configs: [{
                                _id,
                                name: 'config-' + Date.now(),
                                system: system._id,
                                pool: pool._id,
                                exclude_drives,
                                use_storage,
                                use_s3
                            }]
                        }
                    }).then(() => _id);
                })
                .then(conf_id => {
                    const create_node_token = _get_create_node_token(system._id, req.account._id, conf_id);
                    // TODO: remove system and root_path from agent_conf
                    const agent_conf = {
                        address: `wss://${server_ip}:${api.get_base_port()}`,
                        system: system.name,
                        root_path: './noobaa_storage/',
                        create_node_token
                    };
                    const base64_configuration = Buffer.from(JSON.stringify(agent_conf)).toString('base64');
                    return {
                        LINUX: `wget ${server_ip}:${process.env.PORT || 8080}/public/${linux_agent_installer} && chmod 755 ${linux_agent_installer} && ./${linux_agent_installer} /S /config ${base64_configuration}`,
                        WINDOWS: `Import-Module BitsTransfer ; Start-BitsTransfer -Source http://${server_ip}:${process.env.PORT || 8080}/public/${agent_installer} -Destination C:\\${agent_installer}; C:\\${agent_installer} /S /config ${base64_configuration}`
                    };
                });
        });
}


function set_last_stats_report_time(req) {
    var updates = {};
    updates._id = req.system._id;
    updates.last_stats_report = req.rpc_params.last_stats_report;
    return system_store.make_changes({
        update: {
            systems: [updates]
        }
    }).return();
}

function update_n2n_config(req) {
    var n2n_config = req.rpc_params;
    dbg.log0('update_n2n_config', n2n_config);
    if (n2n_config.tcp_permanent_passive) {
        if (n2n_config.tcp_permanent_passive.min >= n2n_config.tcp_permanent_passive.max) {
            throw new Error('Min port range cant be equal or higher to max');
        }
    }
    return system_store.make_changes({
            update: {
                systems: [{
                    _id: req.system._id,
                    n2n_config: n2n_config
                }]
            }
        })
        .then(() => server_rpc.client.node.sync_monitor_to_store(undefined, {
            auth_token: req.auth_token
        }))
        .return();
}

function update_base_address(req) {
    dbg.log0('update_base_address', req.rpc_params);
    var prior_base_address = req.system && req.system.base_address;
    return P.resolve()
        .then(() => {
            const db_update = {
                _id: req.system._id,
            };
            if (req.rpc_params.base_address) {
                db_update.base_address = req.rpc_params.base_address.toLowerCase();
            } else {
                db_update.$unset = {
                    base_address: 1
                };
            }
            return system_store.make_changes({
                update: {
                    systems: [db_update]
                }
            });
        })
        .then(() => server_rpc.client.node.sync_monitor_to_store(undefined, {
            auth_token: req.auth_token
        }))
        .then(() => {
            Dispatcher.instance().activity({
                event: 'conf.dns_address',
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                desc: `DNS Address was changed from ${prior_base_address} to ${req.rpc_params.base_address || 'server IP'}`,
            });
        });
}

// phone_home_proxy_address must be a full address like: http://(ip or hostname):(port)
function update_phone_home_config(req) {
    dbg.log0('update_phone_home_config', req.rpc_params);

    const previous_value = system_store.data.systems[0].phone_home_proxy_address;
    let desc_line = `Phone home proxy address was `;
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

    return system_store.make_changes({
            update: {
                systems: [update]
            }
        })
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

function phone_home_capacity_notified(req) {
    dbg.log0('phone_home_capacity_notified');

    let update = {
        _id: req.system._id,
        freemium_cap: Object.assign({},
            req.system.freemium_cap, {
                phone_home_notified: true
            }
        )
    };

    return system_store.make_changes({
            update: {
                systems: [update]
            }
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
        .then(
            () => os_utils.reload_syslog_configuration(params)
        )
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

function update_hostname(req) {
    // Helper function used to solve missing infromation on the client (SSL_PORT)
    // during create system process

    if (req.rpc_params.hostname !== null) {
        req.rpc_params.base_address = 'wss://' + req.rpc_params.hostname + ':' + process.env.SSL_PORT;
    }

    return P.resolve()
        .then(() => {
            // This will test if we've received IP or DNS name
            // This check is essential because there is no point of resolving an IP using DNS Servers
            if (!req.rpc_params.hostname || net.isIP(req.rpc_params.hostname)) {
                return;
            }
            // Use defaults to add dns_name property without altering the original request
            return attempt_server_resolve(_.defaults({
                    rpc_params: {
                        server_name: req.rpc_params.hostname,
                        version_check: true
                    }
                }, req))
                .then(result => {
                    if (!result.valid) {
                        throw new Error('Could not resolve ' + req.rpc_params.hostname +
                            ' Reason ' + result.reason);
                    }
                });
        })
        .then(() => {
            dbg.log0('attempt_server_resolve returned updating base address');
            delete req.rpc_params.hostname;
            return update_base_address(req);
        });
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
            dbg.log('resolution passed, testing ping');
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
            dbg.log('resolution passed, testing version');
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


function update_system_certificate(req) {
    throw new RpcError('TODO', 'update_system_certificate');
}



function validate_activation(req) {
    return P.fcall(function() {
            var params = _.defaults(req.rpc_params, {
                command: 'validate_creation'
            });
            // Method is used both for license code validation with and without business email
            return _communicate_license_server(params, process.env.PH_PROXY);
        })
        .return({
            valid: true
        })
        .catch(err => ({
            valid: false,
            reason: err.message
        }));
}

function log_client_console(req) {
    _.each(req.rpc_params.data, function(line) {
        client_syslog.log(5, req.rpc_params.data, 'LOG_LOCAL1');
    });
}

function _init_system(sysid) {
    return cluster_server.init_cluster()
        .then(() => stats_collector.collect_system_stats())
        .then(() => Dispatcher.instance().alert('INFO',
            sysid,
            'Welcome to NooBaa! It\'s time to get started. Connect your first resources, either 3 nodes or 1 cloud resource',
            Dispatcher.rules.only_once));
}

function create_internal_tier(system_id, mongo_pool_id) {
    if (tier_server.get_internal_storage_tier(system_id)) return;
    return tier_server.new_tier_defaults(`${config.SPILLOVER_TIER_NAME}-${system_id}`, system_id, [{
        spread_pools: [mongo_pool_id]
    }]);
}

function _ensure_spillover_structure(system_changes) {
    const support_account = _.find(system_store.data.accounts, account => account.is_support);
    const system_id = system_changes.insert.systems[0]._id;
    const tiering_policy_id = system_changes.insert.tieringpolicies[0]._id;

    if (!support_account) throw new Error('SUPPORT ACCOUNT DOES NOT EXIST');
    return P.fcall(function() {
            if (!pool_server.get_internal_mongo_pool(system_id)) {
                return server_rpc.client.pool.create_mongo_pool({
                    name: `${config.INTERNAL_STORAGE_POOL_NAME}-${system_id}`
                }, {
                    auth_token: auth_server.make_auth_token({
                        system_id: system_id,
                        role: 'admin',
                        account_id: support_account._id
                    })
                });
            }
        })
        .then(() => {
            if (!tier_server.get_internal_storage_tier(system_id)) {
                const mongo_pool = pool_server.get_internal_mongo_pool(system_id);
                if (!mongo_pool) throw new Error('MONGO POOL CREATION FAILURE');
                const internal_tier = create_internal_tier(system_id, mongo_pool._id);

                return {
                    insert: {
                        tiers: [internal_tier]
                    },
                    update: {
                        tieringpolicies: [{
                            _id: tiering_policy_id,
                            $push: {
                                tiers: {
                                    tier: internal_tier._id,
                                    order: 1,
                                    spillover: true,
                                    disabled: false
                                }
                            }
                        }]
                    }
                };
            }
        })
        .then(changes => {
            if (changes) {
                return system_store.make_changes(changes);
            }
        });
}


// UTILS //////////////////////////////////////////////////////////


function get_system_info(system, get_id) {
    if (get_id) {
        return _.pick(system, 'id');
    } else {
        return _.pick(system, 'name');
    }
}


function _get_ip_and_dns(system) {
    let response = {};
    response.ip_address = ip_module.address();
    if (system.base_address) {
        let hostname = url.parse(system.base_address).hostname;

        if (net.isIPv4(hostname) || net.isIPv6(hostname)) {
            response.ip_address = hostname;
        } else {
            response.dns_name = hostname;
        }
    }
    return response;
}


function find_account_by_email(req) {
    var account = system_store.get_account_by_email(req.rpc_params.email);
    if (!account) {
        throw new RpcError('NO_SUCH_ACCOUNT', 'No such account email: ' + req.rpc_params.email);
    }
    return account;
}

function _communicate_license_server(params, proxy_address) {
    if (DEV_MODE) return 'ok';
    const body = {
        code: params.code.trim(),
    };
    if (params.email) {
        body['Business Email'] = params.email.trim();
    }
    if (params.command === 'perform_activation') {
        body.system_info = params.system_info || {};
    }
    let options = {
        url: config.PHONE_HOME_BASE_URL + '/' + params.command,
        method: 'POST',
        body: body,
        strictSSL: false, // means rejectUnauthorized: false
        json: true,
        gzip: true,
    };
    if (proxy_address) {
        options.proxy = proxy_address;
    }
    dbg.log0('Sending Post Request To Activation Server:', options);
    return P.fromCallback(callback => request(options, callback), {
            multiArgs: true
        })
        .catch(() => {
            throw new Error('NETWORK_ERROR');
        })
        .spread(function(response, reply) {
            dbg.log0('Received Response From Activation Server', response.statusCode, reply);
            if (response.statusCode !== 200) {
                throw new Error(String(reply));
            }
            return String(reply);
        });
}

// EXPORTS
exports._init = _init;
exports.new_system_defaults = new_system_defaults;
exports.create_internal_tier = create_internal_tier;
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
exports.update_base_address = update_base_address;
exports.attempt_server_resolve = attempt_server_resolve;
exports.update_phone_home_config = update_phone_home_config;
exports.phone_home_capacity_notified = phone_home_capacity_notified;
exports.update_hostname = update_hostname;
exports.update_system_certificate = update_system_certificate;
exports.set_maintenance_mode = set_maintenance_mode;
exports.set_webserver_master_state = set_webserver_master_state;
exports.configure_remote_syslog = configure_remote_syslog;
exports.set_certificate = set_certificate;

exports.validate_activation = validate_activation;
exports.get_node_installation_string = get_node_installation_string;
