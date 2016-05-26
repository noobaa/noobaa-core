/**
 *
 * SYSTEM_SERVER
 *
 */
'use strict';

const _ = require('lodash');
const url = require('url');
const net = require('net');
const moment = require('moment');
const ip_module = require('ip');
const P = require('../../util/promise');
const pkg = require('../../../package.json');
const dbg = require('../../util/debug_module')(__filename);
const diag = require('../utils/server_diagnostics');
const md_store = require('../object_services/md_store');
const fs_utils = require('../../util/fs_utils');
const os_utils = require('../../util/os_util');
const size_utils = require('../../util/size_utils');
const server_rpc = require('../server_rpc');
const pool_server = require('./pool_server');
const tier_server = require('./tier_server');
const ActivityLog = require('../analytic_services/activity_log');
const nodes_store = require('../node_services/nodes_store');
const system_store = require('../system_services/system_store').get_instance();
const promise_utils = require('../../util/promise_utils');
const bucket_server = require('./bucket_server');
const account_server = require('./account_server');
const config = require('../../../config');


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
    };
    return system;
}

function new_system_changes(name, owner_account) {
    return fs_utils.find_line_in_file('/etc/ntp.conf', '#NooBaa Configured NTP Server')
        .then(line => {
            const default_pool_name = 'default_pool';
            const default_bucket_name = 'files';
            const bucket_with_suffix = default_bucket_name + '#' + Date.now().toString(36);
            var system = new_system_defaults(name, owner_account._id);
            if (line) {
                let ntp_server = line.split(' ')[1];
                system.ntp = {
                    server: ntp_server
                };
                dbg.log0('found configured NTP server in ntp.conf:', ntp_server);
            }
            var pool = pool_server.new_pool_defaults(default_pool_name, system._id);
            var tier = tier_server.new_tier_defaults(bucket_with_suffix, system._id, [pool._id]);
            var policy = tier_server.new_policy_defaults(bucket_with_suffix, system._id, [{
                tier: tier._id,
                order: 0
            }]);
            var bucket = bucket_server.new_bucket_defaults(default_bucket_name, system._id, policy._id);
            var role = {
                _id: system_store.generate_id(),
                account: owner_account._id,
                system: system._id,
                role: 'admin'
            };
            ActivityLog.create({
                event: 'conf.create_system',
                level: 'info',
                system: system._id,
                actor: owner_account._id,
                desc: `${name} was created by ${owner_account && owner_account.email}`,
            });

            return {
                insert: {
                    systems: [system],
                    buckets: [bucket],
                    tieringpolicies: [policy],
                    tiers: [tier],
                    pools: [pool],
                    roles: [role],
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
    var name = req.rpc_params.name;
    return new_system_changes(name, req.account)
        .then(changes => system_store.make_changes(changes))
        .then(function() {
            if (process.env.ON_PREMISE === 'true') {
                return P.fcall(function() {
                        return promise_utils.promised_exec('supervisorctl restart s3rver');
                    })
                    .then(null, function(err) {
                        dbg.error('Failed to restart s3rver', err);
                    });
            }
        })
        .then(function() {
            var system = system_store.data.systems_by_name[name];
            return {
                // a token for the new system
                token: req.make_auth_token({
                    account_id: req.account._id,
                    system_id: system._id,
                    role: 'admin',
                }),
                info: get_system_info(system)
            };
        });
}


/**
 *
 * READ_SYSTEM
 *
 */
function read_system(req) {
    var system = req.system;
    var by_system_id_undeleted = {
        system: system._id,
        deleted: null,
    };
    return P.join(
        // nodes - count, online count, allocated/used storage aggregate by pool
        nodes_store.aggregate_nodes_by_pool(by_system_id_undeleted),

        // objects - size, count
        md_store.aggregate_objects(by_system_id_undeleted),

        promise_utils.all_obj(system.buckets_by_name, function(bucket) {
            // TODO this is a hacky "pseudo" rpc request. really should avoid.
            let new_req = _.defaults({
                rpc_params: {
                    name: bucket.name
                }
            }, req);
            return bucket_server.get_cloud_sync_policy(new_req);
        }),

        os_utils.get_time_config()

    ).spread(function(
        nodes_aggregate_pool,
        objects_aggregate,
        cloud_sync_by_bucket,
        time_status) {

        var nodes_sys = nodes_aggregate_pool[''] || {};
        var objects_sys = objects_aggregate[''] || {};
        var ip_address = ip_module.address();
        var n2n_config = system.n2n_config;
        var time_config = {
            srv_time: time_status.srv_time,
            synced: time_status.status,
        };
        if (system.ntp) {
            time_config.ntp_server = system.ntp.server;
            time_config.timezone = system.ntp.timezone ? system.ntp.timezone : time_status.timezone;
        } else {
            time_config.timezone = time_status.timezone;
        }

        let debug_level = system.debug_level;

        // TODO use n2n_config.stun_servers ?
        // var stun_address = 'stun://' + ip_address + ':' + stun.PORT;
        // var stun_address = 'stun://64.233.184.127:19302'; // === 'stun://stun.l.google.com:19302'
        // n2n_config.stun_servers = n2n_config.stun_servers || [];
        // if (!_.includes(n2n_config.stun_servers, stun_address)) {
        //     n2n_config.stun_servers.unshift(stun_address);
        //     dbg.log0('read_system: n2n_config.stun_servers', n2n_config.stun_servers);
        // }
        let response = {
            name: system.name,
            objects: objects_sys.count || 0,
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
                    objects_aggregate,
                    nodes_aggregate_pool,
                    cloud_sync_by_bucket[bucket.name])),
            pools: _.map(system.pools_by_name,
                pool => pool_server.get_pool_info(pool, nodes_aggregate_pool)),
            tiers: _.map(system.tiers_by_name,
                tier => tier_server.get_tier_info(tier, nodes_aggregate_pool)),
            storage: size_utils.to_bigint_storage({
                total: nodes_sys.total,
                free: nodes_sys.free,
                alloc: nodes_sys.alloc,
                used: objects_sys.size,
                real: nodes_sys.used,
            }),
            nodes: {
                count: nodes_sys.count || 0,
                online: nodes_sys.online || 0,
            },
            owner: account_server.get_account_info(system_store.data.get_by_id(system._id).owner),
            last_stats_report: system.last_stats_report && new Date(system.last_stats_report),
            ssl_port: process.env.SSL_PORT,
            web_port: process.env.PORT,
            web_links: get_system_web_links(system),
            n2n_config: n2n_config,
            ip_address: ip_address,
            time_config: time_config,
            base_address: system.base_address || 'wss://' + ip_address + ':' + process.env.SSL_PORT,
            version: pkg.version,
            debug_level: debug_level,
        };

        if (system.base_address) {
            let hostname = url.parse(system.base_address).hostname;

            if (net.isIPv4(hostname) || net.isIPv6(hostname)) {
                response.ip_address = hostname;
            } else {
                response.dns_name = hostname;
            }
        }

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
            throw req.rpc_error('FORBIDDEN', 'list_systems requires authentication with account or system');
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
    updates.last_stats_report = new Date(req.rpc_params.last_stats_report);
    return system_store.make_changes({
        update: {
            systems: [updates]
        }
    }).return();
}

/**
 *
 * READ_ACTIVITY_LOG
 *
 */
function read_activity_log(req) {
    var q = ActivityLog.find({
        system: req.system._id,
    });

    var reverse = true;
    if (req.rpc_params.till) {
        // query backwards from given time
        req.rpc_params.till = new Date(req.rpc_params.till);
        q.where('time').lt(req.rpc_params.till).sort('-time');

    } else if (req.rpc_params.since) {
        // query forward from given time
        req.rpc_params.since = new Date(req.rpc_params.since);
        q.where('time').gte(req.rpc_params.since).sort('time');
        reverse = false;
    } else {
        // query backward from last time
        q.sort('-time');
    }
    if (req.rpc_params.event) {
        q.where({
            event: new RegExp(req.rpc_params.event)
        });
    }
    if (req.rpc_params.events) {
        q.where('event').in(req.rpc_params.events);
    }
    if (req.rpc_params.skip) q.skip(req.rpc_params.skip);
    q.limit(req.rpc_params.limit || 10);
    q.populate('node', 'name');
    q.populate('obj', 'key');
    return P.when(q.exec())
        .then(function(logs) {
            logs = _.map(logs, function(log_item) {
                var l = _.pick(log_item, 'id', 'level', 'event');
                l.time = log_item.time.getTime();

                let tier = log_item.tier && system_store.data.get_by_id(log_item.tier);
                if (tier) {
                    l.tier = _.pick(tier, 'name');
                }

                if (log_item.node) {
                    l.node = _.pick(log_item.node, 'name');
                }

                if (log_item.desc) {
                    l.desc = log_item.desc.split('\n');
                }

                let bucket = log_item.bucket && system_store.data.get_by_id(log_item.bucket);
                if (bucket) {
                    l.bucket = _.pick(bucket, 'name');
                }

                let pool = log_item.pool && system_store.data.get_by_id(log_item.pool);
                if (pool) {
                    l.pool = _.pick(pool, 'name');
                }

                if (log_item.obj) {
                    l.obj = _.pick(log_item.obj, 'key');
                }

                let account = log_item.account && system_store.data.get_by_id(log_item.account);
                if (account) {
                    l.account = _.pick(account, 'email');
                }

                let actor = log_item.actor && system_store.data.get_by_id(log_item.actor);
                if (actor) {
                    l.actor = _.pick(actor, 'email');
                }

                return l;
            });
            if (reverse) {
                logs.reverse();
            }
            return {
                logs: logs
            };
        });
}

function diagnose(req) {
    dbg.log0('Recieved diag req');
    var out_path = '/public/diagnostics.tgz';
    var inner_path = process.cwd() + '/build' + out_path;
    return P.fcall(function() {
            return diag.collect_server_diagnostics(req);
        })
        .then(function() {
            return diag.pack_diagnostics(inner_path);
        })
        .then(function() {
            return out_path;
        })
        .then(res => {
            ActivityLog.create({
                event: 'dbg.diagnose_system',
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                desc: `${req.system.name} diagnostics package was exported by ${req.account && req.account.email}`,
            });
            return res;
        })
        .then(null, function(err) {
            dbg.log0('Error while collecting diagnostics', err, err.stack);
            return '';
        });
}

function diagnose_with_agent(data, req) {
    dbg.log0('Recieved diag with agent req');
    var out_path = '/public/diagnostics.tgz';
    var inner_path = process.cwd() + '/build' + out_path;
    return P.fcall(function() {
            return diag.collect_server_diagnostics(req);
        })
        .then(function() {
            return diag.write_agent_diag_file(data.data);
        })
        .then(function() {
            return diag.pack_diagnostics(inner_path);
        })
        .then(function() {
            return out_path;
        })
        .then(res => {
            ActivityLog.create({
                event: 'dbg.diagnose_node',
                level: 'info',
                system: req.system && req.system._id,
                actor: req.account && req.account._id,
                node: req.rpc_params && req.rpc_params.id,
                desc: `${req.rpc_params.name} diagnostics package was exported by ${req.account && req.account.email}`,
            });
            return res;
        })
        .then(null, function(err) {
            dbg.log0('Error while collecting diagnostics with agent', err, err.stack);
            return '';
        });
}

function _set_debug_level_internal(id, level, auth_token) {
    return server_rpc.client.redirector.publish_to_cluster({
            target: '', // required but irrelevant
            method_api: 'debug_api',
            method_name: 'set_debug_level',
            request_params: {
                level: level,
                module: 'core'
            }
        }, {
            auth_token: auth_token
        })
        .then(() => system_store.make_changes({
            update: {
                systems: [{
                    _id: id,
                    debug_level: level
                }]
            }
        }));
}

function set_debug_level(req) {
    let level = req.params.level;
    let id = req.system._id;
    dbg.log0('Recieved set_debug_level req. level =', level);
    if (req.system.debug_level === level) {
        dbg.log0('requested to set debug level to the same as current level. skipping.. level =', level);
        return;
    }

    return _set_debug_level_internal(id, level, req.auth_token)
        .then(() => {
            if (level > 0) { //If level was set, remove it after 10m
                promise_utils.delay_unblocking(config.DEBUG_MODE_PERIOD) //10m
                    .then(() => _set_debug_level_internal(id, 0, req.auth_token));
            }
        })
        .return();
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
        .then(function() {
            return nodes_store.find_nodes({
                system: req.system._id,
                deleted: null
            }, {
                // select just what we need
                fields: {
                    name: 1,
                    rpc_address: 1
                }
            });
        })
        .then(function(nodes) {
            var reply = {
                nodes_count: nodes.length,
                nodes_updated: 0
            };
            return P.map(nodes, function(node) {
                    return server_rpc.client.agent.update_n2n_config(n2n_config, {
                        address: node.rpc_address
                    }).then(function() {
                        reply.nodes_updated += 1;
                    }, function(err) {
                        dbg.error('update_n2n_config: FAILED TO UPDATE AGENT', node.name, node.rpc_address);
                    });
                }, {
                    concurrency: 5
                })
                .return(reply);
        });
}

function update_base_address(req) {
    dbg.log0('update_base_address', req.rpc_params);
    var prior_base_address = req.system && req.system.base_address;
    return system_store.make_changes({
            update: {
                systems: [{
                    _id: req.system._id,
                    base_address: req.rpc_params.base_address
                }]
            }
        })
        .then(function() {
            return nodes_store.find_nodes({
                system: req.system._id,
                deleted: null
            }, {
                // select just what we need
                fields: {
                    name: 1,
                    rpc_address: 1
                }
            });
        })
        .then(function(nodes) {
            var reply = {
                nodes_count: nodes.length,
                nodes_updated: 0
            };
            return P.map(nodes, function(node) {
                    return server_rpc.client.agent.update_base_address(req.rpc_params, {
                        address: node.rpc_address
                    }).then(function() {
                        reply.nodes_updated += 1;
                    }, function(err) {
                        dbg.error('update_base_address: FAILED TO UPDATE AGENT', node.name, node.rpc_address);
                    });
                }, {
                    concurrency: 5
                })
                .return(reply);
        })
        .then(res => {
            ActivityLog.create({
                event: 'conf.dns_address',
                level: 'info',
                system: req.system,
                actor: req.account && req.account._id,
                desc: `DNS Address was changed from ${prior_base_address} to ${req.rpc_params.base_address}`,
            });
            return res;
        });
}

function update_hostname(req) {
    // Helper function used to solve missing infromation on the client (SSL_PORT)
    // during create system process

    req.rpc_params.base_address = 'wss://' + req.rpc_params.hostname + ':' + process.env.SSL_PORT;
    delete req.rpc_params.hostname;

    return update_base_address(req);
}

function update_system_certificate(req) {
    throw req.rpc_error('TODO', 'update_system_certificate');
}

function update_time_config(req) {
    dbg.log0('update_time_config', req.rpc_params);
    var config = {
        timezone: req.rpc_params.timezone,
        server: (req.rpc_params.config_type === 'NTP') ?
            req.rpc_params.server : ''
    };

    return system_store.make_changes({
            update: {
                systems: [{
                    _id: req.system._id,
                    ntp: config
                }]
            }
        })
        .then(() => {
            if (req.rpc_params.config_type === 'NTP') { //set NTP
                return os_utils.set_ntp(config.server, config.timezone);
            } else { //manual set
                return os_utils.set_manual_time(req.rpc_params.epoch, config.timezone);
            }
        })
        .then(res => {
            let desc_string = [];
            desc_string.push(`Date and Time was updated to ${req.rpc_params.config_type} time by ${req.account && req.account.email}`);
            desc_string.push(`Timezone was set to ${req.rpc_params.timezone}`);
            if (req.rpc_params.server) {
                desc_string.push(`NTP server ${req.rpc_params.server}`);
            }
            let date = req.rpc_params.epoch &&
                moment.unix(req.rpc_params.epoch).tz(req.rpc_params.timezone);
            if (date) {
                desc_string.push(`Date and Time set to ${date}`);
            }
            ActivityLog.create({
                event: 'conf.server_date_time_updated',
                level: 'info',
                system: req.system,
                actor: req.account && req.account._id,
                desc: desc_string.join('\n'),
            });
            return res;
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

function find_account_by_email(req) {
    var account = system_store.data.accounts_by_email[req.rpc_params.email];
    if (!account) {
        throw req.rpc_error('NO_SUCH_ACCOUNT', 'No such account email: ' + req.rpc_params.email);
    }
    return account;
}


// EXPORTS
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

exports.read_activity_log = read_activity_log;

exports.diagnose = diagnose;
exports.diagnose_with_agent = diagnose_with_agent;
exports.log_frontend_stack_trace = log_frontend_stack_trace;
exports.set_last_stats_report_time = set_last_stats_report_time;
exports.set_debug_level = set_debug_level;

exports.update_n2n_config = update_n2n_config;
exports.update_base_address = update_base_address;
exports.update_hostname = update_hostname;
exports.update_system_certificate = update_system_certificate;
exports.update_time_config = update_time_config;
