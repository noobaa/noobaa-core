'use strict';

const _ = require('lodash');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const pkg = require('../../../package.json');
const Barrier = require('../../util/barrier');
const md_store = require('../object_services/md_store');
const server_rpc = require('../server_rpc');
const nodes_store = require('./nodes_store');
const ActivityLog = require('../analytic_services/activity_log');
const system_server = require('../system_services/system_server');
const promise_utils = require('../../util/promise_utils');
const node_allocator = require('./node_allocator');
const mongo_functions = require('../../util/mongo_functions');
const current_pkg_version = pkg.version;

server_rpc.rpc.on('reconnect', _on_reconnect);

/**
 * finding node by id for heatbeat requests uses a barrier for merging DB calls.
 * this is a DB query barrier to issue a single query for concurrent heartbeat requests.
 */
const heartbeat_find_node_by_id_barrier = new Barrier({
    max_length: 200,
    expiry_ms: 500, // milliseconds to wait for others to join
    process: function(node_ids) {
        dbg.log2('heartbeat_find_node_by_id_barrier', node_ids.length);
        return nodes_store.find_nodes({
                deleted: null,
                _id: {
                    $in: node_ids
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
const heartbeat_count_node_storage_barrier = new Barrier({
    max_length: 200,
    expiry_ms: 500, // milliseconds to wait for others to join
    process: function(node_ids, system_id) {
        dbg.log2('heartbeat_count_node_storage_barrier', node_ids.length);
        return P.when(md_store.DataBlock.mapReduce({
                query: {
                    system: system_id,
                    deleted: null,
                    node: {
                        $in: node_ids
                    },
                },
                map: mongo_functions.map_node_size,
                reduce: mongo_functions.reduce_sum
            }))
            .then(function(res) {

                // convert the map-reduce array to map of node_id -> sum of block sizes
                var nodes_storage = _.mapValues(_.keyBy(res, '_id'), 'value');
                return _.map(node_ids, function(node_id) {
                    dbg.log2('heartbeat_count_node_storage_barrier', nodes_storage, 'for ', node_ids, ' nodes_storage[', node_id, '] ', nodes_storage[node_id]);
                    return nodes_storage[node_id] || 0;
                });
            });
    }
});


/**
 * updating node timestamp for heatbeat requests uses a barrier for merging DB calls.
 * this is a DB query barrier to issue a single query for concurrent heartbeat requests.
 */
const heartbeat_update_node_timestamp_barrier = new Barrier({
    max_length: 200,
    expiry_ms: 500, // milliseconds to wait for others to join
    process: function(node_ids) {
        dbg.log2('heartbeat_update_node_timestamp_barrier', node_ids);
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
    dbg.log0('heartbeat:', JSON.stringify(req.auth),
        'version', req.rpc_params.version);
    var extra = req.auth.extra || {};

    // since the heartbeat api is dynamic through new versions
    // if we detect that this is a new version we return immediately
    // with the new version so that the agent will update the code first
    // and only after the upgrade we will run the heartbeat functionality
    if (req.rpc_params.version && current_pkg_version &&
        req.rpc_params.version !== current_pkg_version) {
        dbg.log0('SEND MINIMAL REPLY WITH NEW VERSION',
            req.rpc_params.version, '=>', current_pkg_version,
            'node', extra.node_id);
        return {
            version: current_pkg_version || '0',
            delay_ms: 0
        };
    }

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
            cloud_pool_name: req.rpc_params.cloud_pool_name
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
    // the node_id param is string, and need to convert it to proper object id
    // for the sake of all the queries that we use it for
    var node_id = nodes_store.make_node_id(params.node_id);
    var peer_id = params.peer_id;
    var node;

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
            conn.on('close', () => P.fcall(_unregister_agent, conn, peer_id));
            P.fcall(function() {
                    return server_rpc.client.redirector.register_agent({
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
            heartbeat_count_node_storage_barrier.call(node_id, req.system._id)
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
            var unset_updates = {};

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
            dbg.log0('should update (?)', node.storage.used, 'with', storage_used);

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
                var drives_limit = 0;
                _.each(params.drives, function(drive) {
                    drives_total += drive.storage.total;
                    drives_free += drive.storage.free;
                    if (drive.storage.limit) {
                        drives_limit += drive.storage.limit;
                    }
                });
                set_updates['storage.total'] = drives_total;
                set_updates['storage.free'] = drives_free;
                if (drives_limit > 0) {
                    set_updates['storage.limit'] = drives_limit;
                }
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

            // unset the error time since last heartbeat if any
            if (node.error_since_hb) {
                unset_updates.error_since_hb = true;
            }

            // make the update object hold only updates that are not empty
            var updates = _.omitBy({
                $set: set_updates,
                $push: push_updates,
                $unset: unset_updates,
            }, _.isEmpty);

            dbg.log0('NODE HEARTBEAT UPDATES', node_id, node.heartbeat, updates);

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
    var method_name = req.rpc_params.method_name;
    var method = server_rpc.rpc.schema[req.rpc_params.method_api].methods[method_name];
    dbg.log3('node_monitor redirect', api + '.' + method_name, 'to', target,
        'with params', req.rpc_params.request_params, 'method:', method);


    if (method.params && method.params.import_buffers) {
        method.params.import_buffers(req.rpc_params.request_params, req.rpc_params.redirect_buffer);
    }
    return server_rpc.client[api][method_name](req.rpc_params.request_params, {
        address: target,
    }).then(function(reply) {
        let res = {
            redirect_reply: reply
        };
        if (method.reply && method.reply.export_buffers) {
            res.redirect_buffer = method.reply.export_buffers(reply);
        }
        return res;
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
    var target = req.rpc_params.rpc_address;
    return server_rpc.client.agent.collect_diagnostics({}, {
            address: target,
        })
        .then(function(data) {

            return system_server.diagnose_with_agent(data, req);
        })
        .then(null, function(err) {
            dbg.log0('Error on collect_agent_diagnostics', err);
            return '';
        });
}

function set_debug_node(req) {
    var target = req.rpc_params.target;
    return P.fcall(function() {
            return server_rpc.client.agent.set_debug_node({
                level: req.rpc_params.level
            }, {
                address: target,
            });
        })
        .then(function() {
            var updates = {};
            updates.debug_level = req.rpc_params.level;
            return nodes_store.update_nodes({
                rpc_address: target
            }, {
                $set: updates
            });
        })
        .then(null, function(err) {
            dbg.log0('Error on set_debug_node', err);
            return;
        })
        .then(function() {
            return nodes_store.find_node_by_address(req)
                .then((node) => {
                    ActivityLog.create({
                        system: req.system._id,
                        level: 'info',
                        event: 'dbg.set_debug_node',
                        actor: req.account && req.account._id,
                        node: node._id,
                        desc: `${node.name} debug level was raised by ${req.account && req.account.email}`,
                    });
                    dbg.log1('set_debug_node for agent', target, req.rpc_params.level, 'was successful');
                    return '';
                });
        });
}


/**
 *
 * report_node_block_error
 *
 * sent by object IO when failed to read/write to node agent.
 *
 */
function report_node_block_error(req) {
    let action = req.rpc_params.action;
    let block_md = req.rpc_params.block_md;
    let node_id = block_md.node;

    if (action === 'write') {

        // node_allocator keeps nodes in memory,
        // and in the write path it allocated a block on a node that failed to write
        // so we notify about the error to remove the node from next allocations
        // until it will refresh the alloc and see the error_since_hb on the node too
        node_allocator.report_node_error(node_id);

        // update the node to mark the error
        // this marking is transient and will be unset on next heartbeat
        return nodes_store.update_node_by_id(node_id, {
            $set: {
                error_since_hb: new Date(),
            }
        }).return();
    }
}


function _unregister_agent(connection, peer_id) {
    return P.when(server_rpc.client.redirector.unregister_agent({
            peer_id: peer_id,
        }))
        .fail(function(error) {
            dbg.log0('Failed to unregister agent', error);
            _resync_agents();
        });
}

function _on_reconnect(conn) {
    if (conn.url.href === server_rpc.rpc.router.default) {
        dbg.log0('_on_reconnect:', conn.url.href);
        _resync_agents();
    }
}

function _resync_agents() {
    dbg.log2('_resync_agents called');

    //Retry to resync redirector
    return promise_utils.retry(Infinity, 1000, function(attempt) {
        var agents = server_rpc.rpc.get_n2n_addresses();
        var ts = Date.now();
        return server_rpc.client.redirector.resync_agents({
                agents: agents,
                timestamp: ts,
            })
            .fail(function(error) {
                dbg.log0('Failed resyncing agents to redirector', error);
                throw new Error('Failed resyncing agents to redirector');
            });
    });
}


// EXPORTS
exports.heartbeat = heartbeat;
exports.n2n_signal = n2n_signal;
exports.redirect = redirect;
exports.self_test_to_node_via_web = self_test_to_node_via_web;
exports.collect_agent_diagnostics = collect_agent_diagnostics;
exports.set_debug_node = set_debug_node;
exports.report_node_block_error = report_node_block_error;
