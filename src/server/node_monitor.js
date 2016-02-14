/* jshint node:true */
'use strict';

module.exports = {
    heartbeat: heartbeat,
    n2n_signal: n2n_signal,
    redirect: redirect,
    self_test_to_node_via_web: self_test_to_node_via_web,
    collect_agent_diagnostics: collect_agent_diagnostics,
    set_debug_node: set_debug_node,
};

var _ = require('lodash');
var P = require('../util/promise');
var db = require('./db');
var Barrier = require('../util/barrier');
var size_utils = require('../util/size_utils');
var promise_utils = require('../util/promise_utils');
var server_rpc = require('./server_rpc');
var system_server = require('./system_server');
var nodes_store = require('./stores/nodes_store');
var mongodb = require('mongodb');
var dbg = require('../util/debug_module')(__filename);
var pkg = require('../../package.json');
var current_pkg_version = pkg.version;

server_rpc.rpc.on('reconnect', _on_reconnect);

/**
 * finding node by id for heatbeat requests uses a barrier for merging DB calls.
 * this is a DB query barrier to issue a single query for concurrent heartbeat requests.
 */
var heartbeat_find_node_by_id_barrier = new Barrier({
    max_length: 200,
    expiry_ms: 500, // milliseconds to wait for others to join
    process: function(node_ids) {
        dbg.log2('heartbeat_find_node_by_id_barrier', node_ids.length);
        return nodes_store.find_nodes({
                deleted: null,
                _id: {
                    $in: _.map(node_ids, mongodb.ObjectId)
                },
            }, {
                // we are selective to reduce overhead
                fields: {
                    _id: 1,
                    ip: 1,
                    port: 1,
                    peer_id: 1,
                    storage: 1,
                    geolocation: 1,
                    rpc_address: 1,
                    base_address: 1,
                    version: 1,
                    debug_level: 1,
                }
            })
            .then(function(res) {
                var nodes_by_id = _.keyBy(res, '_id');
                return _.map(node_ids, function(node_id) {
                    return nodes_by_id[node_id];
                });
            });
    }
});


/**
 * counting node used storage for heatbeat requests uses a barrier for merging DB calls.
 * this is a DB query barrier to issue a single query for concurrent heartbeat requests.
 */
var heartbeat_count_node_storage_barrier = new Barrier({
    max_length: 200,
    expiry_ms: 500, // milliseconds to wait for others to join
    process: function(node_ids) {
        dbg.log2('heartbeat_count_node_storage_barrier', node_ids.length);
        return P.when(db.DataBlock.mapReduce({
                query: {
                    deleted: null,
                    node: {
                        $in: node_ids
                    },
                },
                map: function() {
                    /* global emit */
                    emit(this.node, this.size);
                },
                reduce: size_utils.reduce_sum
            }))
            .then(function(res) {
                // convert the map-reduce array to map of node_id -> sum of block sizes
                var nodes_storage = _.mapValues(_.keyBy(res, '_id'), 'value');
                return _.map(node_ids, function(node_id) {
                    return nodes_storage[node_id] || 0;
                });
            });
    }
});


/**
 * updating node timestamp for heatbeat requests uses a barrier for merging DB calls.
 * this is a DB query barrier to issue a single query for concurrent heartbeat requests.
 */
var heartbeat_update_node_timestamp_barrier = new Barrier({
    max_length: 200,
    expiry_ms: 500, // milliseconds to wait for others to join
    process: function(node_ids) {
        dbg.log2('heartbeat_update_node_timestamp_barrier', node_ids.length);
        return nodes_store.update_nodes({
            deleted: null,
            _id: {
                $in: node_ids
            },
        }, {
            $set: {
                heartbeat: new Date()
            }
        }).return();
    }
});

/**
 *
 * HEARTBEAT
 *
 */
function heartbeat(req) {
    dbg.log0('heartbeat:', 'ROLE', req.role, 'AUTH', req.auth, 'PARAMS', req.rpc_params);
    var extra = req.auth.extra || {};

    // verify the authorization to use this node for non admin roles
    if (extra.node_id &&
        (req.role === 'admin' || req.role === 'agent')) {
        req.rpc_params.node_id = extra.node_id;
        req.rpc_params.peer_id = extra.peer_id;
        return update_heartbeat(req);
    }

    // check if the node doesn't yet has an id
    // and has auth that can create a node,
    // then first create the node and then update the heartbeat
    if (!extra.node_id &&
        (req.role === 'admin' || req.role === 'create_node')) {
        return server_rpc.client.node.create_node({
            name: req.rpc_params.name,
            geolocation: req.rpc_params.geolocation,
        }, {
            auth_token: req.auth_token
        }).catch(function(err) {
            if (err.rpc_code === 'CONFLICT') {
                // TODO how to handle this case that the agent created but lost the token?
                dbg.error('heartbeat: create node name CONFLICT',
                    '(TODO probably the agent lost the token)',
                    err.stack || err, req.rpc_params);
                throw err;
            } else {
                dbg.error('heartbeat: create node ERROR', err.stack || err, req.rpc_params);
                throw err;
            }
        }).then(function(res) {
            req.rpc_params.node_id = res.id;
            req.rpc_params.peer_id = res.peer_id;
            return update_heartbeat(req, res.token);
        });
    }

    dbg.warn('heartbeat: bad auth role', req.role, req.auth);
    throw req.forbidden();
}


/**
 *
 * UPDATE HEARTBEAT
 *
 */
function update_heartbeat(req, reply_token) {
    var params = req.rpc_params;
    var conn = req.connection;
    var node_id = params.node_id;
    var peer_id = params.peer_id;
    var node;

    dbg.log0('HEARTBEAT node_id', node_id, 'process.env.AGENT_VERSION', process.env.AGENT_VERSION);

    var hb_delay_ms = process.env.AGENT_HEARTBEAT_DELAY_MS || 60000;
    hb_delay_ms *= 1 + Math.random(); // jitter of 2x max
    hb_delay_ms = hb_delay_ms | 0; // make integer
    hb_delay_ms = Math.max(hb_delay_ms, 1000); // force above 1 second
    hb_delay_ms = Math.min(hb_delay_ms, 300000); // force below 5 minutes

    // rpc address is taken from server env so that we can change in one place.
    // TODO keep rpc_proto in pool/system
    var rpc_proto = process.env.AGENTS_PROTOCOL || 'n2n';
    var rpc_address;
    if (rpc_proto !== 'n2n') {
        rpc_address = rpc_proto + '://' + params.ip + ':' + (process.env.AGENT_PORT || 9999);
    } else {
        rpc_address = 'n2n://' + peer_id;
        dbg.log0('PEER REVERSE ADDRESS', rpc_address, conn.url.href);
        // Add node to RPC map and notify redirector if needed
        var notify_redirector = server_rpc.rpc.map_address_to_connection(rpc_address, conn);
        if (notify_redirector) {
            conn.on('close', _unregister_agent.bind(null, conn, peer_id));
            P.fcall(function() {
                    return server_rpc.bg_client.redirector.register_agent({
                        peer_id: peer_id,
                    });
                })
                .fail(function(error) {
                    dbg.log0('Failed to register agent', error);
                    _resync_agents();
                });
        }
    }

    // if the agent still did not listen on any address
    // we already update the DB with the default address
    // that we also return in the reply, since we assume it will follow
    // and we don't want to incur another HB request just for that update
    if (!params.rpc_address) {
        params.rpc_address = rpc_address;
    }


    var reply = {
        version: current_pkg_version || '0',
        delay_ms: hb_delay_ms,
    };

    // since the heartbeat api is dynamic through new versions
    // if we detect that this is a new version we return immediately
    // with the new version so that the agent will update the code first
    // and only after the upgrade we will run the heartbeat functionality
    if (params.version && reply.version && params.version !== reply.version) {
        dbg.log0('SEND MINIMAL REPLY WITH NEW VERSION',
            params.version, '=>', reply.version, 'node', node_id);
        return reply;
    }

    //0.4 backward compatible - reply with version and without rpc address.
    if (!params.id) {
        reply.rpc_address = rpc_address;
    }
    if (reply_token) {
        reply.auth_token = reply_token;
    }

    if (params.extended_hb) {
        reply.n2n_config = _.cloneDeep(req.system.n2n_config);
    }

    // code for testing performance of server with no heartbeat work
    if (process.env.HEARTBEAT_MODE === 'ignore') {
        return reply;
    }

    // the DB calls are optimized by merging concurrent requests to use a single query
    // by using barriers that wait a bit for concurrent calls to join together.
    var promise = P.all([
            heartbeat_find_node_by_id_barrier.call(node_id),
            heartbeat_count_node_storage_barrier.call(node_id)
        ])
        .spread(function(node_arg, storage_used) {
            node = node_arg;

            if (!node) {
                // we don't fail here because failures would keep retrying
                // to find this node, and the node is not in the db.
                console.error('IGNORE MISSING NODE FOR HEARTBEAT', node_id, params.ip);
                return;
            }

            var set_updates = {};
            var push_updates = {};

            // TODO detect nodes that try to change ip, port too rapidly
            if (params.geolocation &&
                params.geolocation !== node.geolocation) {
                set_updates.geolocation = params.geolocation;
            }
            if (params.ip && params.ip !== node.ip) {
                set_updates.ip = params.ip;
            }
            if (params.rpc_address &&
                params.rpc_address !== node.rpc_address) {
                set_updates.rpc_address = params.rpc_address;
            }
            if (params.base_address &&
                params.base_address !== node.base_address) {
                set_updates.base_address = params.base_address;
            }
            if (params.version && params.version !== node.version) {
                set_updates.version = params.version;
            }

            // verify the agent's reported usage
            var agent_storage = params.storage;
            if (agent_storage.used !== storage_used) {
                console.log('NODE agent used storage not in sync ',
                    agent_storage.used, ' counted used ', storage_used);
                // TODO trigger a detailed usage check / reclaiming
            }

            // check if need to update the node used storage count
            if (node.storage.used !== storage_used) {
                set_updates['storage.used'] = storage_used;
            }

            // to avoid frequest updates of the node it will only send
            // extended info on longer period. this will allow more batching by
            // heartbeat_update_node_timestamp_barrier.
            if (params.drives) {
                set_updates.drives = params.drives;
                var drives_total = 0;
                var drives_free = 0;
                _.each(params.drives, function(drive) {
                    drives_total += drive.storage.total;
                    drives_free += drive.storage.free;
                });
                set_updates['storage.total'] = drives_total;
                set_updates['storage.free'] = drives_free;
            }
            if (params.os_info) {
                set_updates.os_info = params.os_info;
                set_updates.os_info.last_update = new Date();
            }

            // push latency measurements to arrays
            // limit the size of the array to keep the last ones using negative $slice
            var MAX_NUM_LATENCIES = 20;
            if (params.latency_to_server) {
                _.merge(push_updates, {
                    latency_to_server: {
                        $each: params.latency_to_server,
                        $slice: -MAX_NUM_LATENCIES
                    }
                });
            }
            if (params.latency_of_disk_read) {
                _.merge(push_updates, {
                    latency_of_disk_read: {
                        $each: params.latency_of_disk_read,
                        $slice: -MAX_NUM_LATENCIES
                    }
                });
            }
            if (params.latency_of_disk_write) {
                _.merge(push_updates, {
                    latency_of_disk_write: {
                        $each: params.latency_of_disk_write,
                        $slice: -MAX_NUM_LATENCIES
                    }
                });
            }

            if (!_.isUndefined(params.debug_level) &&
                params.debug_level !== node.debug_level) {
                set_updates.debug_level = params.debug_level || 0;
            }

            // make the update object hold only updates that are not empty
            var updates = _.omitBy({
                $set: set_updates,
                $push: push_updates
            }, _.isEmpty);

            dbg.log0('NODE HEARTBEAT UPDATES', node_id, updates);

            if (_.isEmpty(updates)) {
                // when only timestamp is updated we optimize by merging DB calls with a barrier
                return heartbeat_update_node_timestamp_barrier.call(node_id);
            } else {
                updates.$set.heartbeat = new Date();
                return nodes_store.update_node_by_id(node_id, updates);
            }
        }).then(function() {
            var storage = node && node.storage || {};
            reply.storage = {
                alloc: storage.alloc || 0,
                used: storage.used || 0,
            };
            return reply;
        });

    if (process.env.HEARTBEAT_MODE === 'background') {
        return reply;
    } else {
        return promise;
    }
}

/**
 *
 * n2n_signal
 *
 */
function n2n_signal(req) {
    var target = req.rpc_params.target;
    dbg.log1('n2n_signal', target);
    return server_rpc.client.agent.n2n_signal(req.rpc_params, {
        address: target,
    });
}

/**
 *
 * redirect
 *
 */
function redirect(req) {
    var target = req.rpc_params.target;
    var api = req.rpc_params.method_api.slice(0, -4); //Remove _api suffix
    var method = req.rpc_params.method_name;
    dbg.log3('node_monitor redirect', api + '.' + method, 'to', target,
        'with params', req.rpc_params.request_params);
    return server_rpc.client[api][method](req.rpc_params.request_params, {
        address: target,
    }).then(function(res) {
        return res || {};
    });
}

/**
 *
 * self_test_to_node_via_web
 *
 */
function self_test_to_node_via_web(req) {
    var target = req.rpc_params.target;
    var source = req.rpc_params.source;

    console.log('SELF TEST', target, 'from', source);

    return server_rpc.client.agent.self_test_peer({
        source: source,
        target: target,
        request_length: req.rpc_params.request_length,
        response_length: req.rpc_params.response_length,
        count: req.rpc_params.count,
        concur: req.rpc_params.concur,
    }, {
        address: source,
    });
}

/**
 * COLLECT_AGENT_DIAGNOSTICS
 */
function collect_agent_diagnostics(req) {
    var target = req.rpc_params.target;

    return P.fcall(function() {
            return server_rpc.client.agent.collect_diagnostics({}, {
                address: target,
            });
        })
        .then(function(data) {
            return system_server.diagnose_with_agent(data);
        })
        .then(null, function(err) {
            dbg.log0('Error on collect_agent_diagnostics', err);
            return '';
        });
}

function set_debug_node(req) {
    var target = req.rpc_params.target;
    return P.fcall(function() {
            return server_rpc.client.agent.set_debug_node({}, {
                address: target,
            });
        })
        .then(function(){
            var updates = {};
            //TODO: use param and send it to the agent.
            //Currently avoid it, due to multiple actors.
            updates.debug_level = 5;
            return nodes_store.update_nodes({
                rpc_address: target
            }, updates);
        })
        .then(null, function(err) {
            dbg.log0('Error on set_debug_node', err);
            return '';
        })
        .then(function() {
            dbg.log1('set_debug_node for agent', target, 'was successful');
        });
}

function _unregister_agent(connection, peer_id) {
    return P.when(server_rpc.bg_client.redirector.unregister_agent({
            peer_id: peer_id,
        }))
        .fail(function(error) {
            dbg.log0('Failed to unregister agent', error);
            _resync_agents();
        });
}

function _on_reconnect(conn) {
    if (conn.url.href === server_rpc.rpc.router.bg) {
        dbg.log0('_on_reconnect:', conn.url.href);
        _resync_agents();
    }
}

function _resync_agents() {
    dbg.log2('_resync_agents called');

    //Retry to resync redirector
    return promise_utils.retry(Infinity, 1000, 0, function(attempt) {
        var agents = server_rpc.rpc.get_n2n_addresses();
        var ts = Date.now();
        return server_rpc.bg_client.redirector.resync_agents({
                agents: agents,
                timestamp: ts,
            })
            .fail(function(error) {
                dbg.log0('Failed resyncing agents to redirector', error);
                throw new Error('Failed resyncing agents to redirector');
            });
    });
}
