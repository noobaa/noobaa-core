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
var server_rpc = require('./server_rpc').server_rpc;
var bg_worker = require('./server_rpc').bg_worker;
var system_server = require('./system_server');
var dbg = require('../util/debug_module')(__filename);

server_rpc.on('reconnect', _on_reconnect);

/**
 * finding node by id for heatbeat requests uses a barrier for merging DB calls.
 * this is a DB query barrier to issue a single query for concurrent heartbeat requests.
 */
var heartbeat_find_node_by_id_barrier = new Barrier({
    max_length: 200,
    expiry_ms: 500, // milliseconds to wait for others to join
    process: function(node_ids) {
        dbg.log2('heartbeat_find_node_by_id_barrier', node_ids.length);
        return P.when(db.Node
                .find({
                    deleted: null,
                    _id: {
                        $in: node_ids
                    },
                })
                // we are very selective to reduce overhead
                .select('ip port peer_id storage geolocation')
                .exec())
            .then(function(res) {
                var nodes_by_id = _.indexBy(res, '_id');
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
                var nodes_storage = _.mapValues(_.indexBy(res, '_id'), 'value');
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
        return P.when(db.Node
                .update({
                    deleted: null,
                    _id: {
                        $in: node_ids
                    },
                }, {
                    heartbeat: new Date()
                }, {
                    multi: true
                })
                .exec())
            .thenResolve();
    }
});

/**
 *
 * HEARTBEAT
 *
 */
function heartbeat(req) {
    var node_id = req.rpc_params.id;

    // verify the authorization to use this node for non admin roles
    if (req.role !== 'admin' && node_id !== req.auth.extra.node_id) {
        throw req.forbidden();
    }

    var params = _.pick(req.rpc_params,
        'id',
        'geolocation',
        'ip',
        'port',
        'version',
        'storage',
        'drives',
        'os_info');
    params.ip = params.ip ||
        (req.headers && req.headers['x-forwarded-for']) ||
        (req.connection && req.connection.remoteAddress);
    params.port = params.port || 0;
    params.system = req.system;

    var node;
    var notify_redirector;

    dbg.log0('HEARTBEAT node_id', node_id, 'process.env.AGENT_VERSION', process.env.AGENT_VERSION);

    var hb_delay_ms = process.env.AGENT_HEARTBEAT_DELAY_MS || 60000;
    hb_delay_ms *= 1 + Math.random(); // jitter of 2x max
    hb_delay_ms = hb_delay_ms | 0; // make integer
    hb_delay_ms = Math.max(hb_delay_ms, 1000); // force above 1 second
    hb_delay_ms = Math.min(hb_delay_ms, 300000); // force below 5 minutes

    var reply = {
        // TODO avoid returning storage property unless filled - do that once agents are updated
        storage: {
            alloc: 0,
            used: 0,
        },
        version: process.env.AGENT_VERSION || '0',
        delay_ms: hb_delay_ms
    };

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

            var updates = {};

            var node_listen_addr = 'n2n://' + node.peer_id;
            dbg.log3('PEER REVERSE ADDRESS', node_listen_addr, req.connection.url.href);

            notify_redirector = server_rpc.map_address_to_connection(node_listen_addr, req.connection);

            // TODO detect nodes that try to change ip, port too rapidly
            if (params.geolocation &&
                params.geolocation !== node.geolocation) {
                updates.geolocation = params.geolocation;
            }
            if (params.ip && params.ip !== node.ip) {
                updates.ip = params.ip;
            }
            if (params.port && params.port !== node.port) {
                updates.port = params.port;
            }
            if (params.version && params.version !== node.version) {
                updates.version = params.version;
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
                updates['storage.used'] = storage_used;
            }

            // to avoid frequest updates of the node it will only send
            // extended info on longer period. this will allow more batching by
            // heartbeat_update_node_timestamp_barrier.
            if (params.drives) {
                updates.drives = params.drives;
                var drives_total = 0;
                var drives_free = 0;
                _.each(params.drives, function(drive) {
                    drives_total += drive.storage.total;
                    drives_free += drive.storage.free;
                });
                updates['storage.total'] = drives_total;
                updates['storage.free'] = drives_free;
            }
            if (params.os_info) {
                updates.os_info = params.os_info;
                updates.os_info.last_update = new Date();
            }

            dbg.log2('NODE heartbeat', node_id, params.ip + ':' + params.port);

            if (_.isEmpty(updates)) {
                // when only timestamp is updated we optimize by merging DB calls with a barrier
                return heartbeat_update_node_timestamp_barrier.call(node_id);
            } else {
                updates.heartbeat = new Date();
                return node.update(updates).exec();
            }
        }).then(function() {
            if (notify_redirector) {
                req.connection.on('close', _unregister_agent.bind(this, req.connection, node.peer_id));
                P.when(bg_worker.redirector.register_agent({
                        peer_id: node.peer_id,
                    }))
                    .fail(function(error) {
                        dbg.log0('Failed to register agent', error);
                        _resync_agents();
                    });
            }

            reply.storage = {
                alloc: node.storage.alloc || 0,
                used: node.storage.used || 0,
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
        target: target,
        request_length: req.rpc_params.request_length || 1024,
        response_length: req.rpc_params.response_length || 1024,
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
        .then(null, function(err) {
            dbg.log0('Error on set_debug_node', err);
            return '';
        });
}

function _unregister_agent(connection, peer_id) {
    return P.when(bg_worker.redirector.unregister_agent({
            peer_id: peer_id,
        }))
        .fail(function(error) {
            dbg.log0('Failed to unregister agent', error);
            _resync_agents();
        });
}

function _on_reconnect(conn) {
    dbg.log2('_on_reconnect called', conn.url.href, server_rpc.get_default_base_address('backgroubd'));
    if (_.startsWith(server_rpc.get_default_base_address('background'), conn.url.href)) {
        _resync_agents();
    }
}

function _resync_agents() {
    var done = false;
    dbg.log2('_resync_agents called');

    //Retry to resync redirector
    return promise_utils.retry(Infinity, 1000, 0, function(attempt) {
        try {
            var agents = server_rpc.get_n2n_addresses();
            var ts = Date.now();
            return P.when(bg_worker.redirector.resync_agents({
                    agents: agents,
                    timestamp: ts,
                }))
                .fail(function(error) {
                    dbg.log0('Failed resyncing agents to redirector', error);
                    throw new Error('Failed resyncing agents to redirector');
                })
                .then(function() {
                    done = true;
                });
        } catch (ex) {
            dbg.log0('Caught exception on resyncing agents to redirector', ex.message);
        }
    });
}
