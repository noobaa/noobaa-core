/* Copyright (C) 2016 NooBaa */
'use strict';

require('../../util/dotenv').load();
const DEV_MODE = (process.env.DEV_MODE === 'true');

const _ = require('lodash');
const fs = require('fs');
const url = require('url');
const net = require('net');
const dns = require('dns');
const path = require('path');
const request = require('request');
const ip_module = require('ip');
const moment = require('moment');

const P = require('../../util/promise');
const pkg = require('../../../package.json');
const dbg = require('../../util/debug_module')(__filename);
const diag = require('../utils/server_diagnostics');
const cutil = require('../utils/clustering_utils');
const config = require('../../../config');
const MDStore = require('../object_services/md_store').MDStore;
const fs_utils = require('../../util/fs_utils');
const os_utils = require('../../util/os_utils');
const RpcError = require('../../rpc/rpc_error');
const Dispatcher = require('../notifications/dispatcher');
const size_utils = require('../../util/size_utils');
const server_rpc = require('../server_rpc');
const pool_server = require('./pool_server');
const tier_server = require('./tier_server');
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
const system_server_utils = require('../utils/system_server_utils');

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

    var native_core = require('../../util/native_core')();
    client_syslog = new native_core.Syslog();

    function wait_for_system_store() {
        var update_done = false;
        P.fcall(function() {
                if (system_store.is_finished_initial_load) {
                    update_done = true;
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
                }
            })
            .catch((err) => {
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
                min: 60100,
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
        const default_pool_name = 'default_pool';
        const default_bucket_name = 'files';
        const bucket_with_suffix = default_bucket_name + '#' + Date.now().toString(36);
        var system = new_system_defaults(name, owner_account._id);
        var pool = pool_server.new_pool_defaults(default_pool_name, system._id);
        var tier = tier_server.new_tier_defaults(bucket_with_suffix, system._id, [{
            spread_pools: [pool._id]
        }]);
        var policy = tier_server.new_policy_defaults(bucket_with_suffix, system._id, [{
            tier: tier._id,
            order: 0
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


        if (process.env.LOCAL_AGENTS_ENABLED === 'true') {
            const demo_pool_name = config.DEMO_DEFAULTS.POOL_NAME;
            const demo_bucket_name = config.DEMO_DEFAULTS.BUCKET_NAME;
            const demo_bucket_with_suffix = demo_bucket_name + '#' + Date.now().toString(36);
            let demo_pool = pool_server.new_pool_defaults(demo_pool_name, system._id);
            var demo_tier = tier_server.new_tier_defaults(demo_bucket_with_suffix, system._id, [{
                spread_pools: [demo_pool._id]
            }]);
            var demo_policy = tier_server.new_policy_defaults(demo_bucket_with_suffix, system._id, [{
                tier: demo_tier._id,
                order: 0
            }]);
            var demo_bucket = bucket_server.new_bucket_defaults(demo_bucket_name, system._id, demo_policy._id);

            demo_bucket.demo_bucket = true;
            demo_pool.demo_pool = true;

            bucket_insert.push(demo_bucket);
            tieringpolicies_insert.push(demo_policy);
            tiers_insert.push(demo_tier);
            pools_insert.push(demo_pool);
        }

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
    if (system_store.data.systems.length > 20) {
        throw new Error('Too many created systems');
    }
    //Create the new system
    account._id = system_store.generate_id();
    let allowed_buckets;
    let reply_token;
    let owner_secret = system_store.get_server_secret();
    //Create system
    return P.fcall(function() {
            var params = {
                code: req.rpc_params.activation_code || '',
                email: req.rpc_params.email,
                system_info: _.omit(req.rpc_params, ['access_keys', 'password']),
                command: 'perform_activation'
            };
            return _communicate_license_server(params);
        })
        .then(() => {
            // Attempt to resolve DNS name, if supplied
            if (!req.rpc_params.dns_name) {
                return;
            }
            return attempt_dns_resolve(req)
                .then(result => {
                    if (!result.valid) {
                        throw new Error('Could not resolve ' + req.rpc_params.dns_name +
                            ' Reason ' + result.reason);
                    }
                });
        })
        .then(() => {
            return P.join(new_system_changes(account.name, account),
                    cluster_server.new_cluster_info())
                .spread(function(changes, cluster_info) {
                    allowed_buckets = [changes.insert.buckets[0]._id.toString()];
                    if (process.env.LOCAL_AGENTS_ENABLED === 'true') {
                        allowed_buckets.push(changes.insert.buckets[1]._id.toString());
                    }

                    if (cluster_info) {
                        changes.insert.clusters = [cluster_info];
                    }
                    return changes;
                })
                .then(changes => {
                    return system_store.make_changes(changes);
                })
                .then(() => {
                    //Create the owner account
                    return server_rpc.client.account.create_account({
                        name: req.rpc_params.name,
                        email: req.rpc_params.email,
                        password: req.rpc_params.password,
                        new_system_parameters: {
                            account_id: account._id.toString(),
                            allowed_buckets: allowed_buckets,
                            new_system_id: system_store.data.systems[0]._id.toString(),
                        },
                    });
                })
                .then(response => {
                    reply_token = response.token;
                    //If internal agents enabled, create them
                    if (process.env.LOCAL_AGENTS_ENABLED !== 'true') {
                        return;
                    }
                    return server_rpc.client.hosted_agents.create_agent({
                        name: req.rpc_params.name,
                        demo: true,
                        access_keys: req.rpc_params.access_keys,
                        scale: config.NUM_DEMO_NODES,
                        storage_limit: config.DEMO_NODES_STORAGE_LIMIT,
                    }, {
                        auth_token: reply_token
                    });
                })
                .then(() => {
                    //Time config, if supplied
                    if (!req.rpc_params.time_config) {
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
                .then(() => _init_system())
                .then(() => ({
                    token: reply_token
                }));
        })
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
    return P.join(
        // nodes - count, online count, allocated/used storage aggregate by pool
        nodes_client.instance().aggregate_nodes_by_pool(null, system._id, /*skip_cloud_nodes=*/ true),
        // TODO: find a better solution than aggregating nodes twice
        nodes_client.instance().aggregate_nodes_by_pool(null, system._id, /*skip_cloud_nodes=*/ false),

        MDStore.instance().count_objects_per_bucket(system._id),

        // passing the bucket itself as 2nd arg to bucket_server.get_cloud_sync
        // which is supported instead of sending the bucket name in an rpc req
        // just to reuse the rpc function code without calling through rpc.
        promise_utils.all_obj(
            system.buckets_by_name,
            bucket => bucket_server.get_cloud_sync(req, bucket)
        ),

        P.fcall(() => server_rpc.client.account.list_accounts({}, {
            auth_token: req.auth_token
        })).then(
            response => response.accounts
        ),

        fs.statAsync(path.join('/etc', 'private_ssl_path', 'server.key'))
        .return(true)
        .catch(() => false),

        promise_utils.all_obj(
            system.buckets_by_name,
            bucket => node_allocator.refresh_tiering_alloc(bucket.tiering)
        )
    ).spread(function(
        nodes_aggregate_pool_no_cloud,
        nodes_aggregate_pool_with_cloud,
        obj_count_per_bucket,
        cloud_sync_by_bucket,
        accounts,
        has_ssl_cert
    ) {
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
            state: system_server_utils.system_in_maintenance(system._id)
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
                bucket => bucket_server.get_bucket_info(
                    bucket,
                    nodes_aggregate_pool_with_cloud,
                    obj_count_per_bucket[bucket._id] || 0,
                    cloud_sync_by_bucket[bucket.name])),
            pools: _.map(system.pools_by_name,
                pool => pool_server.get_pool_info(pool, nodes_aggregate_pool_with_cloud)),
            tiers: _.map(system.tiers_by_name,
                tier => tier_server.get_tier_info(tier, nodes_aggregate_pool_with_cloud)),
            storage: size_utils.to_bigint_storage(_.defaults({
                used: objects_sys.size,
            }, nodes_aggregate_pool_no_cloud.storage, SYS_STORAGE_DEFAULTS)),
            nodes: _.defaults({}, nodes_aggregate_pool_no_cloud.nodes, SYS_NODES_INFO_DEFAULTS),
            owner: account_server.get_account_info(system_store.data.get_by_id(system._id).owner),
            last_stats_report: system.last_stats_report || 0,
            maintenance_mode: maintenance_mode,
            ssl_port: process.env.SSL_PORT,
            web_port: process.env.PORT,
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
        response.cluster = cutil.get_cluster_info();

        if (system.base_address) {
            let hostname = url.parse(system.base_address).hostname;

            if (net.isIPv4(hostname) || net.isIPv6(hostname)) {
                response.ip_address = hostname;
            } else {
                response.dns_name = hostname;
            }
        }

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
            return;
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



// var S3_SYSTEM_BUCKET = process.env.S3_SYSTEM_BUCKET || 'noobaa-core';
// var aws_s3 = process.env.AWS_ACCESS_KEY_ID && new AWS.S3({
//     accessKeyId: process.env.AWS_ACCESS_KEY_ID,
//     secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
//     region: process.env.AWS_REGION || 'eu-central-1'
// });


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

function diagnose_node(req) {
    dbg.log0('Recieved diag with agent req', req.rpc_params);
    var out_path = '/public/node_' + req.rpc_params.name + '_diagnostics.tgz';
    var inner_path = process.cwd() + '/build' + out_path;
    return P.resolve()
        .then(() => diag.collect_server_diagnostics(req))
        .then(() => nodes_client.instance().collect_agent_diagnostics({
            name: req.rpc_params.name
        }, req.system._id))
        .then(res => diag.write_agent_diag_file(res.data))
        .then(() => diag.pack_diagnostics(inner_path))
        .then(() => {
            Dispatcher.instance().activity({
                event: 'dbg.diagnose_node',
                level: 'info',
                system: req.system && req.system._id,
                actor: req.account && req.account._id,
                node: req.rpc_params && req.rpc_params.id,
                desc: `${req.rpc_params.name} diagnostics package was exported by ${req.account && req.account.email}`,
            });
            return out_path;
        });
}


function update_n2n_config(req) {
    var n2n_config = req.rpc_params;
    dbg.log0('update_n2n_config', n2n_config);
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
    const tmp_dir = '/tmp/ssl';
    const dest_dir = '/etc/private_ssl_path';
    dbg.log0('upload_certificate');
    return fs_utils.create_fresh_path(tmp_dir)
        .then(() => promise_utils.exec(`/usr/bin/unzip '${zip_file.path}' -d ${tmp_dir}`))
        .then(() => fs.readdirAsync(tmp_dir))
        .then(files => {
            const cert_file = _throw_if_not_single_item(files, '.cert');
            const key_file = _throw_if_not_single_item(files, '.key');
            return promise_utils.exec(`(/usr/bin/openssl x509 -noout -modulus -in ${cert_file} | /usr/bin/openssl md5 ; /usr/bin/openssl rsa -noout -modulus -in ${key_file} | /usr/bin/openssl md5) | uniq | wc -l`,
                    false, true).then(openssl_res => {
                    if (openssl_res.trim() !== '1') {
                        throw new Error('No match between key and certificate');
                    }
                })
                .then(() => fs_utils.create_fresh_path(dest_dir))
                .then(() => P.join(
                    _move_and_insert_config_file_to_store(`${tmp_dir}/${cert_file}`, `${dest_dir}/server.crt`),
                    _move_and_insert_config_file_to_store(`${tmp_dir}/${key_file}`, `${dest_dir}/server.key`)
                ));
        })
        .then(() => {
            Dispatcher.instance().activity({
                event: 'conf.set_certificate',
                level: 'info',
                desc: `New certificate was successfully set`
            });
        });
}

function _move_and_insert_config_file_to_store(src, dest) {
    return fs.readFileAsync(src, 'utf8')
        .then(file_data => config_file_store.insert({
            filename: dest,
            data: file_data
        }))
        .then(() => fs.renameAsync(src, dest));
}

function _throw_if_not_single_item(arr, extension) {
    const list = _.filter(arr, item => item.endsWith(extension));
    if (list.length !== 1) {
        throw new Error(`There should be exactly one ${extension} file in zip. Instead got ${list.length}`);
    }
    return list[0];
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
            const regExp = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
            if (!req.rpc_params.hostname || regExp.test(req.rpc_params.hostname)) {
                return;
            }
            // Use defaults to add dns_name property without altering the original request
            return attempt_dns_resolve(_.defaults({
                    rpc_params: {
                        dns_name: req.rpc_params.hostname
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
            delete req.rpc_params.hostname;
            return update_base_address(req);
        });
}



function attempt_dns_resolve(req) {
    return P.promisify(dns.resolve)(req.rpc_params.dns_name)
        .return({
            valid: true
        })
        .catch(err => ({
            valid: false,
            reason: err.code
        }));
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
            return _communicate_license_server(params);
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
    return;
}

function _init_system() {
    return cluster_server.init_cluster()
        .then(() => stats_collector.collect_system_stats());
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

function _communicate_license_server(params) {
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
    const options = {
        url: config.PHONE_HOME_BASE_URL + '/' + params.command,
        method: 'POST',
        body: body,
        strictSSL: false, // means rejectUnauthorized: false
        json: true,
        gzip: true,
    };
    dbg.log0('Sending Post Request To Activation Server:', options);
    return P.fromCallback(callback => request(options, callback), {
            multiArgs: true
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
exports.new_system_changes = new_system_changes;

exports.create_system = create_system;
exports.read_system = read_system;
exports.update_system = update_system;
exports.delete_system = delete_system;

exports.list_systems = list_systems;
exports.list_systems_int = list_systems_int;

exports.add_role = add_role;
exports.remove_role = remove_role;

exports.diagnose_node = diagnose_node;
exports.log_frontend_stack_trace = log_frontend_stack_trace;
exports.set_last_stats_report_time = set_last_stats_report_time;
exports.log_client_console = log_client_console;

exports.update_n2n_config = update_n2n_config;
exports.update_base_address = update_base_address;
exports.attempt_dns_resolve = attempt_dns_resolve;
exports.update_phone_home_config = update_phone_home_config;
exports.phone_home_capacity_notified = phone_home_capacity_notified;
exports.update_hostname = update_hostname;
exports.update_system_certificate = update_system_certificate;
exports.set_maintenance_mode = set_maintenance_mode;
exports.set_webserver_master_state = set_webserver_master_state;
exports.configure_remote_syslog = configure_remote_syslog;
exports.set_certificate = set_certificate;

exports.validate_activation = validate_activation;
