// this module is written for nodejs.
'use strict';

//Set exports prior to requires to prevent circular dependency issues
/**
 *
 * SYSTEM_SERVER
 *
 */
var system_server = {

    create_system: create_system,
    read_system: read_system,
    update_system: update_system,
    delete_system: delete_system,

    list_systems: list_systems,
    list_systems_int: list_systems_int,

    add_role: add_role,
    remove_role: remove_role,

    get_system_resource_info: get_system_resource_info,

    read_activity_log: read_activity_log,

    diagnose: diagnose,
    diagnose_with_agent: diagnose_with_agent,
    start_debug: start_debug,
};

module.exports = system_server;

var _ = require('lodash');
var Q = require('q');
var crypto = require('crypto');
var size_utils = require('../util/size_utils');
var promise_utils = require('../util/promise_utils');
var diag = require('./utils/server_diagnostics');
var db = require('./db');
var server_rpc = require('./server_rpc').server_rpc;
var AWS = require('aws-sdk');
var fs = require('fs');
var dbg = require('noobaa-util/debug_module')(__filename);
var promise_utils = require('../util/promise_utils');


/**
 *
 * CREATE_SYSTEM
 *
 */
function create_system(req) {
    var system;
    var system_token;
    var info = _.pick(req.rpc_params, 'name');

    return Q.fcall(function() {
            if (info.name === 'demo') {
                info.access_keys = [{
                    access_key: '123',
                    secret_key: 'abc',
                }];
            } else {
                info.access_keys = [{
                    access_key: crypto.randomBytes(16).toString('hex'),
                    secret_key: crypto.randomBytes(32).toString('hex'),
                }];
            }
            info.owner = req.account.id;

            // set default package names
            info.resources = {
                agent_installer: 'noobaa-setup.exe',
                s3rest_installer: 'noobaa-s3rest.exe',
                linux_agent_installer: 'noobaa-setup'
            };
            dbg.log0('Installer Resources:', info.resources);
            return Q.when(db.System.create(info))
                .then(null, db.check_already_exists(req, 'system'));
        })
        .then(function(system_arg) {
            system = system_arg;

            // a token for the new system
            system_token = req.make_auth_token({
                account_id: req.account.id,
                system_id: system.id,
                role: 'admin',
            });

            // TODO if role create fails, we should recover the role from the system owner
            return Q.when(db.Role.create({
                    account: req.account.id,
                    system: system.id,
                    role: 'admin',
                }))
                .then(null, db.check_already_exists(req, 'role'));
        })
        .then(function() {
            return server_rpc.client.tier.create_tier({
                name: 'nodes',
                kind: 'edge',
                edge_details: {
                    replicas: 3,
                    data_fragments: 1,
                    parity_fragments: 0
                }
            }, {
                auth_token: system_token
            });
        })
        .then(function() {
            return server_rpc.client.bucket.create_bucket({
                name: 'files',
                tiering: ['nodes']
            }, {
                auth_token: system_token
            });
        })
        .then(function() {
            var config = {
                "dbg_log_level": 2,
                "address": "wss://127.0.0.1:" + process.env.SSL_PORT,
                "port": "80",
                "ssl_port": "443",
                "access_key": info.access_keys[0].access_key,
                "secret_key": info.access_keys[0].secret_key
            };
            if (process.env.ON_PREMISE === 'true') {
                return Q.nfcall(fs.writeFile, process.cwd() + '/agent_conf.json', JSON.stringify(config));
            }
        })
        .then(function() {
            if (process.env.ON_PREMISE === 'true') {
                return Q.fcall(function() {
                        return promise_utils.promised_spawn(
                            'supervisorctl', ['restart', 's3rver'], process.cwd()
                        );
                    })
                    .then(null, function(err) {
                        dbg.error('Failed to restart s3rver', err);
                    });
            }
        })
        //Auto generate agent executable.
        // Removed for now, as we need signed exe
        //
        // .then(function() {
        //     if (process.env.ON_PREMISE) {
        //         return Q.Promise(function(resolve, reject) {
        //
        //             var build_params = [
        //                 '--access_key=' + info.access_keys[0].access_key,
        //                 '--secret_key=' + info.access_keys[0].secret_key,
        //                 '--system_id=' + system.id,
        //                 '--system=' + system.name,
        //                 '--on_premise_env=1',
        //                 '--address=wss://noobaa.local:443'
        //             ];
        //
        //             var build_script = child_process.spawn(
        //                 'src/deploy/build_atom_agent_win.sh', build_params, {
        //                     cwd: process.cwd()
        //                 });
        //
        //             build_script.on('close', function(code) {
        //                 if (code !== 0) {
        //                     resolve();
        //                 } else {
        //                     reject(new Error('build_script returned error code ' + code));
        //                 }
        //             });
        //
        //             var stdout = '',
        //                 stderr = '';
        //
        //             build_script.stdout.setEncoding('utf8');
        //
        //             build_script.stdout.on('data', function(data) {
        //                 stdout += data;
        //                 dbg.log0(data);
        //             });
        //
        //             build_script.stderr.setEncoding('utf8');
        //             build_script.stderr.on('data', function(data) {
        //                 stderr += data;
        //                 dbg.log0(data);
        //             });
        //         });
        //     }
        // })
        .then(function() {
            return {
                token: system_token,
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
    return Q.fcall(function() {
        var by_system_id = {
            system: req.system.id
        };
        var by_system_id_undeleted = {
            system: req.system.id,
            deleted: null,
        };

        return Q.all([
            // roles
            db.Role.find(by_system_id).populate('account').exec(),

            // tiers
            db.Tier.find(by_system_id_undeleted).exec(),

            // nodes - count, online count, allocated/used storage
            db.Node.aggregate_nodes(by_system_id_undeleted),

            // objects - size, count
            db.ObjectMD.aggregate_objects(by_system_id_undeleted),

            // blocks
            db.DataBlock.mapReduce({
                query: by_system_id_undeleted,
                map: function() {
                    /* global emit */
                    emit('size', this.size);
                },
                reduce: size_utils.reduce_sum
            }),

            // buckets
            db.Bucket.find(by_system_id_undeleted).exec(),
        ]);

    }).spread(function(roles, tiers, nodes_aggregate, objects_aggregate, blocks, buckets) {
        blocks = _.mapValues(_.indexBy(blocks, '_id'), 'value');
        var tiers_by_id = _.indexBy(tiers, '_id');
        var nodes_sys = nodes_aggregate[''] || {};
        var objects_sys = objects_aggregate[''] || {};
        return {
            name: req.system.name,
            roles: _.map(roles, function(role) {
                role = _.pick(role, 'role', 'account');
                role.account = _.pick(role.account, 'name', 'email');
                return role;
            }),
            tiers: _.map(tiers, function(tier) {
                var t = _.pick(tier, 'name', 'kind');
                var a = nodes_aggregate[tier.id];
                t.storage = _.defaults(_.pick(a, 'total', 'free', 'used', 'alloc'), {
                    alloc: 0,
                    used: 0
                });
                t.nodes = _.defaults(_.pick(a, 'count', 'online'), {
                    count: 0,
                    online: 0
                });
                return t;
            }),
            storage: {
                total: nodes_sys.total || 0,
                free: nodes_sys.free || 0,
                alloc: nodes_sys.alloc || 0,
                used: objects_sys.size || 0,
                real: blocks.size || 0,
            },
            nodes: {
                count: nodes_sys.count || 0,
                online: nodes_sys.online || 0,
            },
            buckets: _.map(buckets, function(bucket) {
                var b = _.pick(bucket, 'name');
                var a = objects_aggregate[bucket.id] || {};
                b.storage = {
                    used: a.size || 0,
                };
                b.num_objects = a.count || 0;
                b.tiering = _.map(bucket.tiering, function(tier_id) {
                    var tier = tiers_by_id[tier_id];
                    if (!tier) return '';
                    var replicas = tier.edge_details && tier.edge_details.replicas || 3;
                    var t = nodes_aggregate[tier.id];
                    // TODO how to account bucket total storage with multiple tiers?
                    b.storage.total = (t.total || 0) / replicas;
                    b.storage.free = (t.free || 0) / replicas;
                    return tier.name;
                });
                if (_.isUndefined(b.storage.total)) {
                    b.storage.total = (nodes_sys.total || 0) / 3;
                    b.storage.free = (nodes_sys.free || 0) / 3;
                }
                return b;

            }),
            objects: objects_sys.count || 0,
            access_keys: req.system.access_keys,
            ssl_port: process.env.SSL_PORT,
            web_port: process.env.PORT,
        };
    });
}


function update_system(req) {
    var info = _.pick(req.rpc_params, 'name');
    return Q.when(req.system.update(info).exec())
        .thenResolve();
}


/**
 *
 * DELETE_SYSTEM
 *
 */
function delete_system(req) {
    return Q.when(
            req.system.update({
                deleted: new Date()
            })
            .exec())
        .thenResolve();
}



/**
 *
 * LIST_SYSTEMS
 *
 */
function list_systems(req) {
    console.log('List systems:',req.account);
    if (!req.account.is_support) {
        return list_systems_int(false, false, req.account.id);
    }

    return list_systems_int(true, false);
}

/**
 *
 * LIST_SYSTEMS_INT
 *
 */
function list_systems_int(is_support, get_ids, account) {
    var query = {};

    // support gets to see all systems
    if (!is_support) {
        query.account = account;
    }

    return Q.when(
            db.Role.find(query)
            .populate('system')
            .exec())
        .then(function(roles) {
            return {
                systems: _.compact(_.map(roles, function(role) {
                    if (!role.system || role.system.deleted) {
                        return null;
                    }
                    return get_system_info(role.system, get_ids);
                }))
            };
        });
}


/**
 *
 * ADD_ROLE
 *
 */
function add_role(req) {
    return Q.when(
            db.Account
            .findOne({
                email: req.rpc_params.email,
                deleted: null,
            })
            .exec())
        .then(db.check_not_deleted(req, 'account'))
        .then(function(account) {
            return db.Role.create({
                account: account.id,
                system: req.system.id,
                role: req.rpc_params.role,
            });
        })
        .then(null, db.check_already_exists(req, 'role'))
        .thenResolve();
}



/**
 *
 * REMOVE_ROLE
 *
 */
function remove_role(req) {
    return Q.when(
            db.Account
            .findOne({
                email: req.rpc_params.email,
                deleted: null,
            })
            .exec())
        .then(db.check_not_deleted(req, 'account'))
        .then(function(account) {
            return db.Role
                .findOneAndRemove({
                    account: account.id,
                    system: req.system.id,
                })
                .exec();
        })
        .thenResolve();
}



var S3_SYSTEM_BUCKET = process.env.S3_SYSTEM_BUCKET || 'noobaa-core';
var aws_s3 = process.env.AWS_ACCESS_KEY_ID && new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || 'eu-central-1'
});


/**
 *
 * READ_ACTIVITY_LOG
 *
 */
function get_system_resource_info(req) {
    var reply = _.mapValues(req.system.resources, function(val, key) {
        if (key === 'toObject' || !_.isString(val) || !val) {
            return;
        }
        if (process.env.ON_PREMISE) {
            return '/public/' + val;
        } else {
            var params = {
                Bucket: S3_SYSTEM_BUCKET,
                Key: '/' + val,
                Expires: 24 * 3600 // 1 day
            };
            if (aws_s3) {
                return aws_s3.getSignedUrl('getObject', params);
            } else {
                // workaround if we didn't setup aws credentials,
                // and just try a plain unsigned url
                return 'https://' + params.Bucket + '.s3.amazonaws.com/' + params.Key;
            }
        }
    });
    // remove keys with undefined values
    return _.omit(reply, _.isUndefined);
}




/**
 *
 * READ_ACTIVITY_LOG
 *
 */
function read_activity_log(req) {
    var q = db.ActivityLog.find({
        system: req.system.id,
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
    q.populate('tier', 'name');
    q.populate('node', 'name');
    q.populate('bucket', 'name');
    q.populate('obj', 'key');
    q.populate('account', 'email');
    q.populate('actor', 'email');
    return Q.when(q.exec())
        .then(function(logs) {
            logs = _.map(logs, function(log_item) {
                var l = _.pick(log_item, 'id', 'level', 'event');
                l.time = log_item.time.getTime();
                if (log_item.tier) {
                    l.tier = _.pick(log_item.tier, 'name');
                }
                if (log_item.node) {
                    l.node = _.pick(log_item.node, 'name');
                }
                if (log_item.bucket) {
                    l.bucket = _.pick(log_item.bucket, 'name');
                }
                if (log_item.obj) {
                    l.obj = _.pick(log_item.obj, 'key');
                }
                if (log_item.account) {
                    l.account = _.pick(log_item.account, 'email');
                }
                if (log_item.actor) {
                    l.actor = _.pick(log_item.actor, 'email');
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
    return Q.fcall(function() {
            return diag.collect_server_diagnostics();
        })
        .then(function() {
            return diag.pack_diagnostics(inner_path);
        })
        .then(function() {
            return out_path;
        })
        .then(null, function(err) {
            dbg.log0('Error while collecting diagnostics', err, err.stack());
            return;
        });
}

function diagnose_with_agent(data) {
    dbg.log0('Recieved diag with agent req');
    var out_path = '/public/diagnostics.tgz';
    var inner_path = process.cwd() + '/build' + out_path;
    return Q.fcall(function() {
            return diag.collect_server_diagnostics();
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
        .then(null, function(err) {
            dbg.log0('Error while collecting diagnostics with agent', err, err.stack());
            return;
        });
}

function start_debug() {
    dbg.log0('Recieved start_debug req');
    dbg.set_level(5, 'core');
    promise_utils.delay_unblocking(1000 * 60 * 10) //10m
        .then(function() {
            dbg.set_level(0, 'core');
        });
    return;
}


// UTILS //////////////////////////////////////////////////////////


function get_system_info(system, get_id) {
    if (get_id) {
        return _.pick(system, 'id');
    } else {
        return _.pick(system, 'name');
    }
}
