// this module is written for nodejs.
'use strict';

//Set exports prior to requires to prevent circular dependency issues
/**
 *
 * SYSTEM_SERVER
 *
 */
var system_server = {
    new_system_defaults: new_system_defaults,
    new_system_changes: new_system_changes,

    create_system: create_system,
    read_system: read_system,
    update_system: update_system,
    delete_system: delete_system,

    list_systems: list_systems,
    list_systems_int: list_systems_int,

    add_role: add_role,
    remove_role: remove_role,

    read_activity_log: read_activity_log,

    diagnose: diagnose,
    diagnose_with_agent: diagnose_with_agent,
    start_debug: start_debug,

    update_n2n_config: update_n2n_config,
    update_base_address: update_base_address,
    update_system_certificate: update_system_certificate,
};

module.exports = system_server;

var _ = require('lodash');
var P = require('../util/promise');
var crypto = require('crypto');
var ip_module = require('ip');
// var AWS = require('aws-sdk');
var diag = require('./utils/server_diagnostics');
var cs_utils = require('./utils/cloud_sync_utils');
var db = require('./db');
var server_rpc = require('./server_rpc').server_rpc;
var bg_worker = require('./server_rpc').bg_worker;
var bucket_server = require('./bucket_server');
var pool_server = require('./pool_server');
var tier_server = require('./tier_server');
var system_store = require('./stores/system_store');
var size_utils = require('../util/size_utils');
// var stun = require('../rpc/stun');
var promise_utils = require('../util/promise_utils');
var dbg = require('../util/debug_module')(__filename);
var pkg = require('../../package.json');


function new_system_defaults(name, owner_account_id) {
    var system = {
        _id: db.new_object_id(),
        name: name,
        owner: owner_account_id,
        access_keys: (name === 'demo') ? [{
            access_key: '123',
            secret_key: 'abc',
        }] : [{
            access_key: crypto.randomBytes(16).toString('hex'),
            secret_key: crypto.randomBytes(32).toString('hex'),
        }],
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
    };
    return system;
}

function new_system_changes(name, owner_account_id) {
    var system = new_system_defaults(name, owner_account_id);
    var pool = pool_server.new_pool_defaults('default_pool', system._id);
    var tier = tier_server.new_tier_defaults('nodes', system._id, [pool._id]);
    var policy = tier_server.new_policy_defaults('default_tiering', system._id, [{
        tier: tier._id,
        order: 0
    }]);
    var bucket = bucket_server.new_bucket_defaults('files', system._id, policy._id);
    var role = {
        account: owner_account_id,
        system: system._id,
        role: 'admin'
    };
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
}


/**
 *
 * CREATE_SYSTEM
 *
 */
function create_system(req) {
    var name = req.rpc_params.name;
    var changes = new_system_changes(name, req.account && req.account._id);
    return system_store.make_changes(changes)
        .then(function() {
            if (process.env.ON_PREMISE === 'true') {
                return P.fcall(function() {
                        return promise_utils.promised_spawn(
                            'supervisorctl', ['restart', 's3rver'], process.cwd()
                        );
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
    return P.fcall(function() {
        var by_system_id_undeleted = {
            system: system._id,
            deleted: null,
        };

        return P.all([
            // nodes - count, online count, allocated/used storage aggregate by tier
            db.Node.aggregate_nodes(by_system_id_undeleted, 'tier'),

            //TODO:: merge this and the previous call into one query, two memory ops
            // nodes - count, online count, allocated/used storage aggregate by pool
            db.Node.aggregate_nodes(by_system_id_undeleted, 'pool'),

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
        ]);

    }).spread(function(
        nodes_aggregate_tier,
        nodes_aggregate_pool,
        objects_aggregate,
        blocks) {

        blocks = _.mapValues(_.indexBy(blocks, '_id'), 'value');
        var nodes_sys = nodes_aggregate_tier[''] || {};
        var objects_sys = objects_aggregate[''] || {};
        var ret_pools = [];
        _.each(system.pools_by_name, function(p) {
            var aggregate_p = nodes_aggregate_pool[p._id] || {};
            ret_pools.push({
                name: p.name,
                total_nodes: p.nodes.length,
                online_nodes: aggregate_p.online || 0,
                //TODO:: in tier we divide by number of replicas, in pool we have no such concept
                storage: {
                    total: (aggregate_p.total || 0),
                    free: (aggregate_p.free || 0),
                    used: (aggregate_p.used || 0),
                    alloc: (aggregate_p.alloc || 0)
                }
            });
        });
        return P.all(_.map(system.buckets_by_name, function(bucket) {
            var b = _.pick(bucket, 'name');
            var a = objects_aggregate[bucket._id] || {};
            b.storage = {
                used: a.size || 0,
            };
            b.num_objects = a.count || 0;
            b.tiering = _.map(bucket.tiering.tiers, function(tier) {
                var replicas = tier.replicas || 3;
                var t = nodes_aggregate_tier[tier.tier._id];
                if (t) {
                    // TODO how to account bucket total storage with multiple tiers?
                    b.storage.total = (t.total || 0) / replicas;
                    b.storage.free = (t.free || 0) / replicas;
                }
                return tier.name;
            });
            if (_.isUndefined(b.storage.total)) {
                b.storage.total = (nodes_sys.total || 0) / 3;
                b.storage.free = (nodes_sys.free || 0) / 3;
            }
            return P.fcall(function() {
                return bucket_server.get_cloud_sync_policy({
                    system: system,
                    rpc_params: {
                        name: b.name
                    }
                });
            }).then(function(sync_policy) {
                cs_utils.resolve_cloud_sync_info(sync_policy, b);
                dbg.log2('bucket is:', b);
                return b;
            }).then(null, function(err) {
                dbg.error('failed reading bucket information', err.stack || err);
            });

        })).then(function(updated_buckets) {
            dbg.log2('updated_buckets:', updated_buckets);
            var ip_address = ip_module.address();
            var n2n_config = system.n2n_config;
            // TODO use n2n_config.stun_servers ?
            // var stun_address = 'stun://' + ip_address + ':' + stun.PORT;
            // var stun_address = 'stun://64.233.184.127:19302'; // === 'stun://stun.l.google.com:19302'
            // n2n_config.stun_servers = n2n_config.stun_servers || [];
            // if (!_.contains(n2n_config.stun_servers, stun_address)) {
            //     n2n_config.stun_servers.unshift(stun_address);
            //     dbg.log0('read_system: n2n_config.stun_servers', n2n_config.stun_servers);
            // }
            return {
                name: system.name,
                roles: _.map(system.roles_by_account, function(roles, account_id) {
                    var account = system_store.data.get_by_id(account_id);
                    return {
                        roles: roles,
                        account: _.pick(account, 'name', 'email')
                    };
                }),
                tiers: _.map(system.tiers_by_name, function(tier) {
                    var t = _.pick(tier, 'name');
                    var a = nodes_aggregate_tier[tier._id];
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
                pools: ret_pools,
                buckets: updated_buckets,
                objects: objects_sys.count || 0,
                access_keys: system.access_keys,
                ssl_port: process.env.SSL_PORT,
                web_port: process.env.PORT,
                web_links: get_system_web_links(system),
                n2n_config: n2n_config,
                ip_address: ip_address,
                base_address: system.base_address ||
                    'wss://' + ip_address + ':' + process.env.SSL_PORT,
                version: pkg.version,
            };
        });
    });
}


function update_system(req) {
    var info = _.pick(req.rpc_params, 'name');
    db.SystemCache.invalidate(req.system._id);
    return P.when(db.System.update({
            _id: req.system._id
        }, info).exec())
        .thenResolve();
}


/**
 *
 * DELETE_SYSTEM
 *
 */
function delete_system(req) {
    db.SystemCache.invalidate(req.system._id);
    return P.when(
            db.System.update({
                _id: req.system._id
            }, {
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
    console.log('List systems:', req.account);
    if (!req.account) {
        return list_systems_int(false, false);
    }
    if (!req.account.is_support) {
        return list_systems_int(false, false, req.account._id);
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
    console.log('list_systems_int', query);

    return P.when(
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
    return P.when(
            db.Account
            .findOne({
                email: req.rpc_params.email,
                deleted: null,
            })
            .exec())
        .then(db.check_not_deleted(req, 'account'))
        .then(function(account) {
            return db.Role.create({
                account: account._id,
                system: req.system._id,
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
    return P.when(
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
                    account: account._id,
                    system: req.system._id,
                })
                .exec();
        })
        .thenResolve();
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
    return _.omit(reply, _.isUndefined);
}




/**
 *
 * READ_ACTIVITY_LOG
 *
 */
function read_activity_log(req) {
    var q = db.ActivityLog.find({
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
    q.populate('tier', 'name');
    q.populate('node', 'name');
    q.populate('bucket', 'name');
    q.populate('obj', 'key');
    q.populate('account', 'email');
    q.populate('actor', 'email');
    return P.when(q.exec())
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
    return P.fcall(function() {
            return diag.collect_server_diagnostics();
        })
        .then(function() {
            return diag.pack_diagnostics(inner_path);
        })
        .then(function() {
            return out_path;
        })
        .then(null, function(err) {
            dbg.log0('Error while collecting diagnostics', err, err.stack);
            return;
        });
}

function diagnose_with_agent(data) {
    dbg.log0('Recieved diag with agent req');
    var out_path = '/public/diagnostics.tgz';
    var inner_path = process.cwd() + '/build' + out_path;
    return P.fcall(function() {
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
            dbg.log0('Error while collecting diagnostics with agent', err, err.stack);
            return;
        });
}

function start_debug(req) {
    dbg.log0('Recieved start_debug req', server_rpc.client.debug);
    return P.when(server_rpc.client.debug.set_debug_level({
            level: 5,
            module: 'core'
        }))
        .then(function() {
            return P.when(bg_worker.debug.set_debug_level({
                level: 5,
                module: 'core'
            }));
        })
        .then(function() {
            promise_utils.delay_unblocking(1000 * 60 * 10) //10m
                .then(function() {
                    return P.when(server_rpc.client.debug.set_debug_level({
                        level: 0,
                        module: 'core'
                    }));
                })
                .then(function() {
                    return P.when(bg_worker.debug.set_debug_level({
                        level: 0,
                        module: 'core'
                    }));
                });
            return;
        });
}


function update_n2n_config(req) {
    var n2n_config = req.rpc_params;
    dbg.log0('update_n2n_config', n2n_config);
    db.SystemCache.invalidate(req.system._id);
    return P.when(db.System.update({
            _id: req.system._id
        }, {
            n2n_config: n2n_config
        }).exec())
        .then(function() {
            return db.Node.find({
                system: req.system._id
            }, {
                // select just what we need
                name: 1,
                rpc_address: 1
            }).exec();
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
    db.SystemCache.invalidate(req.system._id);
    return P.when(db.System.update({
            _id: req.system._id
        }, {
            base_address: req.rpc_params.base_address
        }).exec())
        .then(function() {
            return db.Node.find({
                system: req.system._id
            }, {
                // select just what we need
                name: 1,
                rpc_address: 1
            }).exec();
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
        });
}

function update_system_certificate(req) {
    dbg.log0('update_system_certificate', req.rpc_params);
}


// UTILS //////////////////////////////////////////////////////////


function get_system_info(system, get_id) {
    if (get_id) {
        return _.pick(system, 'id');
    } else {
        return _.pick(system, 'name');
    }
}
