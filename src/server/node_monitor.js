/* jshint node:true */
'use strict';

module.exports = {
    heartbeat: heartbeat,
    n2n_signal: n2n_signal,
    self_test_to_node_via_web: self_test_to_node_via_web,
    collect_agent_diagnostics: collect_agent_diagnostics,
    set_debug_node: set_debug_node,
};

var _ = require('lodash');
var P = require('../util/promise');
var db = require('./db');
var Barrier = require('../util/barrier');
var size_utils = require('../util/size_utils');
var server_rpc = require('./server_rpc').server_rpc;
var system_server = require('./system_server');
var dbg = require('../util/debug_module')(__filename);


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
            server_rpc.map_address_to_connection(node_listen_addr, req.connection);

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
    console.log('n2n_signal', target);
    return server_rpc.client.agent.n2n_signal(req.rpc_params, {
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

/**
 *
 * NODE_MONITOR_WORKER
 *
 * background worker that scans chunks and builds them according to their blocks status
 *
 * /
var node_monitor_worker = promise_utils.run_background_worker({

    name: 'node_monitor_worker',
    batch_size: 100,
    time_since_last_build: 3000, // TODO increase...
    building_timeout: 60000, // TODO increase...

    /**
     * run the next batch of node scan
     * /
    run_batch: function() {
        var self = this;
        return P.fcall(function() {
                dbg.log0('NODE_MONITOR_WORKER:', 'RUN');
            })
            .then(function() {
                // return the delay before next batch
                if (self.last_node_id) {
                    return 1000;
                } else {
                    return 60000;
                }
            }, function(err) {
                // return the delay before next batch
                dbg.log0('NODE_MONITOR_WORKER:', 'ERROR', err, err.stack);
                return 10000;
            });
    }

});
*/
