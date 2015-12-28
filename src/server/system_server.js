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
var size_utils = require('../util/size_utils');
var promise_utils = require('../util/promise_utils');
var diag = require('./utils/server_diagnostics');
var db = require('./db');
var server_rpc = require('./server_rpc').server_rpc;
var bg_worker = require('./server_rpc').bg_worker;
var AWS = require('aws-sdk');
var dbg = require('../util/debug_module')(__filename);
var promise_utils = require('../util/promise_utils');
var bucket_server = require('./bucket_server');
var moment = require('moment');
var pkg = require('../../package.json');

/**
 *
 * CREATE_SYSTEM
 *
 */
function create_system(req) {
    var system;
    var system_token;
    var info = _.pick(req.rpc_params, 'name');

    return P.fcall(function() {
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
            info.resources = {
                // set default package names
                agent_installer: 'noobaa-setup.exe',
                s3rest_installer: 'noobaa-s3rest.exe',
                linux_agent_installer: 'noobaa-setup'
            };
            info.n2n_config = {
                tcp_tls: true,
                tcp_active: true,
                tcp_permanent_passive: {
                    min: 60100,
                    max: 60600
                },
                udp_dtls: true,
                udp_port: true,
            };

            return P.when(db.System.create(info))
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
            return P.when(db.Role.create({
                    account: req.account.id,
                    system: system.id,
                    role: 'admin',
                }))
                .then(null, db.check_already_exists(req, 'role'));
        })
        .then(function() {
            return server_rpc.client.pool.create_pool({
                pool: {
                    name: 'default_pool',
                    nodes: [],
                }
            }, {
                auth_token: system_token
            });
        })
        .then(function() {
            return server_rpc.client.tier.create_tier({
                name: 'nodes',
                data_placement: 'SPREAD',
                edge_details: {
                    replicas: 3,
                    data_fragments: 1,
                    parity_fragments: 0
                },
                nodes: [],
                pools: ['default_pool'],
            }, {
                auth_token: system_token
            });
        })
        .then(function() {
            return server_rpc.client.tiering_policy.create_policy({
                policy: {
                    name: 'default_tiering',
                    tiers: [{
                        order: 0,
                        tier: 'nodes'
                    }]
                }
            }, {
                auth_token: system_token
            });
        })
        .then(function() {
            return server_rpc.client.bucket.create_bucket({
                name: 'files',
                tiering: 'default_tiering'
            }, {
                auth_token: system_token
            });
        })
        // .then(function() {
        //     var config = {
        //         "dbg_log_level": 2,
        //         "address": "wss://127.0.0.1:" + process.env.SSL_PORT,
        //         "port": "80",
        //         "ssl_port": "443",
        //         "access_key": info.access_keys[0].access_key,
        //         "secret_key": info.access_keys[0].secret_key
        //     };
        //     if (process.env.ON_PREMISE === 'true') {
        //         return P.nfcall(fs.writeFile, process.cwd() + '/agent_conf.json', JSON.stringify(config));
        //     }
        // })
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
        //Auto generate agent executable.
        // Removed for now, as we need signed exe
        //
        // .then(function() {
        //     if (process.env.ON_PREMISE) {
        //         return P.Promise(function(resolve, reject) {
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
    return P.fcall(function() {
        var by_system_id = {
            system: req.system.id
        };
        var by_system_id_undeleted = {
            system: req.system.id,
            deleted: null,
        };

        return P.all([
            // roles
            db.Role.find(by_system_id).populate('account').exec(),

            // tiers
            db.Tier.find(by_system_id_undeleted).exec(),

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

            // buckets
            db.Bucket.find(by_system_id_undeleted).exec(),

            // pools
            db.Pool.find(by_system_id_undeleted).exec(),
        ]);

    }).spread(function(roles, tiers, nodes_aggregate_tier, nodes_aggregate_pool,
        objects_aggregate, blocks, buckets, pools) {
        blocks = _.mapValues(_.indexBy(blocks, '_id'), 'value');
        var tiers_by_id = _.indexBy(tiers, '_id');
        var nodes_sys = nodes_aggregate_tier[''] || {};
        var objects_sys = objects_aggregate[''] || {};
        var ret_pools = [];
        _.each(pools, function(p) {
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
        return P.all(_.map(buckets, function(bucket) {
            var b = _.pick(bucket, 'name');
            var a = objects_aggregate[bucket.id] || {};
            b.storage = {
                used: a.size || 0,
            };
            b.num_objects = a.count || 0;
            b.tiering = _.map(bucket.tiering.tiers, function(tier_id) {
                var tier = tiers_by_id[tier_id];
                if (!tier) return '';
                var replicas = tier.replicas || 3;
                var t = nodes_aggregate_tier[tier.id];
                // TODO how to account bucket total storage with multiple tiers?
                b.storage.total = (t.total || 0) / replicas;
                b.storage.free = (t.free || 0) / replicas;
                return tier.name;
            });
            if (_.isUndefined(b.storage.total)) {
                b.storage.total = (nodes_sys.total || 0) / 3;
                b.storage.free = (nodes_sys.free || 0) / 3;
            }
            return P.fcall(function() {
                return bucket_server.get_cloud_sync_policy({
                    system: {
                        id: req.system.id
                    },
                    rpc_params: {
                        name: b.name
                    }
                });
            }).then(function(sync_policy) {
                dbg.log2('bucket sync_policy is:', sync_policy);
                if (!_.isEmpty(sync_policy)) {
                    var interval_text = 0;
                    if (sync_policy.policy.schedule < 60) {
                        interval_text = sync_policy.policy.schedule + ' minutes';
                    } else {
                        if (sync_policy.policy.schedule < 60 * 24) {
                            interval_text = sync_policy.policy.schedule / 60 + ' hours';
                        } else {
                            interval_text = sync_policy.policy.schedule / (60 * 24) + ' days';
                        }
                    }
                    b.policy_schedule_in_min = interval_text;
                    //If sync time is epoch (never synced) change to never synced
                    if (sync_policy.paused) {
                        b.cloud_sync_status = 'NOTSET';
                    }
                    if (!sync_policy.health) {
                        b.cloud_sync_status = 'UNABLE';
                    }
                    if (sync_policy.status === 'IDLE') {
                        b.cloud_sync_status = 'SYNCED';
                    } else {
                        b.cloud_sync_status = 'SYNCING';
                    }
                    if (sync_policy.policy.last_sync === 0) {
                        b.last_sync = 'Waiting for first sync';
                        b.cloud_sync_status = 'UNSYNCED';
                    } else {
                        b.last_sync = moment(sync_policy.policy.last_sync).format('LLL');
                    }
                } else {
                    b.cloud_sync_status = 'NOTSET';
                }
                dbg.log2('bucket is:', b);
                return b;
            }).then(null, function(err) {
                dbg.error('failed reading bucket information');
            });

        })).then(function(updated_buckets) {
            dbg.log2('updated_buckets:', updated_buckets);
            var ip_address = ip_module.address();
            return {
                name: req.system.name,
                roles: _.map(roles, function(role) {
                    role = _.pick(role, 'role', 'account');
                    role.account = _.pick(role.account, 'name', 'email');
                    return role;
                }),
                tiers: _.map(tiers, function(tier) {
                    var t = _.pick(tier, 'name');
                    var a = nodes_aggregate_tier[tier.id];
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
                access_keys: req.system.access_keys,
                ssl_port: process.env.SSL_PORT,
                web_port: process.env.PORT,
                web_links: get_system_web_links(req.system),
                n2n_config: req.system.n2n_config,
                ip_address: ip_address,
                base_address: req.system.base_address ||
                    'wss://' + ip_address + ':' + process.env.SSL_PORT
            };
        });
    });
}


function update_system(req) {
    var info = _.pick(req.rpc_params, 'name');
    db.SystemCache.invalidate(req.system.id);
    return P.when(req.system.update(info).exec())
        .thenResolve();
}


/**
 *
 * DELETE_SYSTEM
 *
 */
function delete_system(req) {
    db.SystemCache.invalidate(req.system.id);
    return P.when(
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
    console.log('List systems:', req.account);
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


function get_system_web_links(system) {
    var reply = _.mapValues(system.resources, function(val, key) {
        if (key === 'toObject' || !_.isString(val) || !val) {
            return;
        }
        if (process.env.ON_PREMISE) {
            var versioned_resource = val.replace('noobaa-setup', 'noobaa-setup-' + pkg.version);
            versioned_resource = versioned_resource.replace('noobaa-s3rest', 'noobaa-s3rest-' + pkg.version);
            dbg.log1('resource link:', val, versioned_resource);
            return '/public/' + versioned_resource;
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
    db.SystemCache.invalidate(req.system.id);
    return P.when(req.system.update({
            n2n_config: n2n_config
        }).exec())
        .then(function() {
            return db.Node.find({
                system: req.system.id
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
    db.SystemCache.invalidate(req.system.id);
    return P.when(req.system.update({
            base_address: req.rpc_params.base_address
        }).exec())
        .then(function() {
            return db.Node.find({
                system: req.system.id
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
