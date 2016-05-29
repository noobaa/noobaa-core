/**
 *
 * NODE MONITOR
 *
 */
'use strict';

const _ = require('lodash');
const EventEmitter = require('events').EventEmitter;

const P = require('../../util/promise');
const pkg = require('../../../package.json');
const dbg = require('../../util/debug_module')(__filename);
const RpcError = require('../../rpc/rpc_error');
const md_store = require('../object_services/md_store');
const MapBuilder = require('../object_services/map_builder').MapBuilder;
const server_rpc = require('../server_rpc');
const nodes_store = require('./nodes_store');
const mongo_utils = require('../../util/mongo_utils');
const ActivityLog = require('../analytic_services/activity_log');
const system_store = require('../system_services/system_store').get_instance();
const system_server = require('../system_services/system_server');
const promise_utils = require('../../util/promise_utils');
const node_allocator = require('./node_allocator');
const mongoose_utils = require('../../util/mongoose_utils');


class NodesMonitor extends EventEmitter {

    constructor(system_id) {
        super();
        this.system_id = system_id;
        this.client = server_rpc.rpc.new_client();
    }

    start() {
        this._started = true;
        return this._load_from_store();
    }

    stop() {
        this._started = false;
    }

    _clear() {
        this._loaded = false;
        this._map_node_id = new Map();
        this._map_peer_id = new Map();
        this._map_node_name = new Map();
    }

    _load_from_store() {
        if (!this._started) return;
        return mongoose_utils.mongoose_wait_connected()
            .then(() => nodes_store.find_nodes({
                system: this.system_id,
                deleted: null
            }))
            .then(nodes => {
                this._clear();
                _.each(nodes, node => {
                    const item = {
                        connection: null,
                        node: node,
                    };
                    this._add_node(item);
                });
                this._loaded = true;
                this._schedule_next_run();
            })
            .catch(err => {
                return P.delay(1000).then(() => this._load_from_store());
            });
    }

    heartbeat(req) {
        const extra = req.auth.extra || {};
        const node_id = String(extra.node_id || '');
        const node_version = req.rpc_params.version;
        const reply = {
            version: pkg.version || '0',
            delay_ms: 0 // delay_ms was required in 0.3.X
        };

        // since the heartbeat api is dynamic through new versions
        // if we detect that this is a new version we return immediately
        // with the new version so that the agent will update the code first
        // and only after the upgrade we will run the heartbeat functionality
        if (node_version !== pkg.version) {
            dbg.log0('heartbeat: reply new version',
                'node_id', node_id,
                'node_version', node_version,
                'pkg.version', pkg.version);
            return reply;
        }

        if (!this._started) throw new RpcError('MONITOR_NOT_STARTED');
        if (!this._loaded) throw new RpcError('MONITOR_NOT_LOADED');

        // existing node heartbeat
        if (node_id && (req.role === 'agent' || req.role === 'admin')) {
            this._connect_node(req.connection, node_id);
            return reply;
        }

        // new node heartbeat
        // create the node and then update the heartbeat
        if (!node_id && (req.role === 'create_node' || req.role === 'admin')) {
            this._new_node(req.connection, extra.pool_id);
            return reply;
        }

        dbg.error('heartbeat: BAD REQUEST', 'role', req.role, 'auth', req.auth);
        throw new RpcError('FORBIDDEN', 'Bad heartbeat request');
    }

    _connect_node(conn, node_id) {
        dbg.log0('_connect_node:', 'node_id', node_id);
        const item = this._map_node_id.get(String(node_id));
        if (!item) throw new RpcError('NODE_NOT_FOUND', node_id);
        this._set_connection(item, conn);
    }

    _new_node(conn, pool_id) {
        dbg.log0('_new_node', 'new_node_id');
        const item = {
            connection: null,
            node: {
                _id: nodes_store.make_node_id(),
                peer_id: nodes_store.make_node_id(),
                pool: system_store.make_system_id(pool_id),
                name: 'TODO-node-name', // TODO
            },
        };
        this._add_node(item);
        this._set_connection(item, conn);
    }

    _add_node(item) {
        if (!this._started) return;
        if (!this._loaded) return;
        this._map_node_id.set(String(item.node._id), item);
        this._map_peer_id.set(String(item.node.peer_id), item);
        this._map_node_name.set(String(item.node.name), item);
    }

    _set_connection(item, conn) {
        if (item.connection) {
            dbg.warn('heartbeat: closing old connection', item.connection.connid);
            item.connection.close();
        }
        item.connection = conn;
        conn.on('close', () => {
            if (item.connection === conn) {
                item.connection = null;
            }
            // TODO GUYM what to wakeup on disconnect?
        });
    }

    _schedule_next_run() {
        // TODO GUYM _schedule_next_run should check if currently running?
        clearTimeout(this._next_run_timeout);
        if (!this._started) return;
        this._next_run_timeout = setTimeout(() => {
            P.resolve()
                .then(() => this._run())
                .finally(() => this._schedule_next_run());
        }, 60000);
    }

    _run() {
        if (!this._started) return;
        let next = 0;
        const queue = Array.from(this._map_node_id.values());
        const concur = Math.min(queue.length, 50);
        const worker = () => {
            if (next >= queue.length) return;
            const item = queue[next++];
            return this._run_node(item).then(worker);
        };
        return P.all(_.times(concur, worker));
    }

    _run_node(item) {
        if (!this._started) return;
        return P.resolve()
            .then(() => this._get_agent_info(item))
            .then(() => this._update_rpc_config(item))
            // .then(() => this._test_store_perf(item))
            // .then(() => this._test_network_perf(item))
            // .then(() => this._update_status(item))
            // .then(() => this._update_node_store(item));
    }

    _get_agent_info(item) {
        if (!item.connection) return;
        return this.client.agent.get_agent_info(undefined, {
                connection: item.connection
            })
            .then(info => {
                item.agent_info = info;
            });
    }

    _update_rpc_config(item) {
        if (!item.connection) return;
        const system = system_store.get_by_id(this.system_id);
        const rpc_proto = process.env.AGENTS_PROTOCOL || 'n2n';
        const rpc_address = rpc_proto === 'n2n' ?
            'n2n://' + item.node.peer_id :
            rpc_proto + '://' + item.node.ip + ':' + (process.env.AGENT_PORT || 9999);
        const rpc_config = {
            rpc_address: rpc_address,
            base_address: system.base_address,
            n2n_config: system.n2n_config
        };
        const old_config = _.pick(item.agent_info,
            'rpc_address',
            'base_address',
            'n2n_config');
        // skip the update when no changes detected
        if (_.isEqual(rpc_config, old_config)) return;
        // clone to make sure we don't modify the system's n2n_config
        const rpc_config_clone = _.deepClone(rpc_config);
        return this.client.agent.update_rpc_address(rpc_config_clone, {
            connection: item.connection
        });
    }

    _test_store_perf(item) {
        if (!item.connection) return;
        return this.client.agent.test_store_perf({
                count: 5
            }, {
                connection: item.connection
            })
            .then(res => {
                // TODO add to node info
            });
    }

    _test_network_perf(item) {
        if (!item.connection) return;
        // TODO GUYM _test_network_perf with few other nodes
        // and detect if we have a NAT preventing TCP to this node
    }

    _update_status(item) {
        if (item.connection) {
            // online
        } else {
            // offline
        }

        // if (during pool migration) {
        //
        // }
        //
        // if (evacuating ? ? ? ) {
        //
        // }
        //
        // if (out of space) {
        //
        // }
    }

    _update_node_store(item) {
        const updates = _.pick(item.agent_info,
            'name',
            'version',
            'ip',
            'base_address',
            'rpc_address',
            'geolocation',
            'storage',
            'drives',
            'os_info',
            'debug_level',
            'is_internal_agent');
        if (!item.node.peer_id) {
            updates.peer_id = nodes_store.make_node_id();
        }
        updates.heartbeat = new Date();
        updates.system = this.system_id;

        let pool = {};
        if (req.rpc_params.cloud_pool_name) {
            pool = req.system.pools_by_name[req.rpc_params.cloud_pool_name];
            dbg.log0('creating node in cloud pool', req.rpc_params.cloud_pool_name, pool);
        } else {
            pool = req.system.pools_by_name.default_pool;
        }
        if (!pool) {
            throw new RpcError('NO_DEFAULT_POOL', 'No default pool');
        }
        updates.pool = pool._id;

        const auth_token = req.make_auth_token({
            system_id: req.system._id,
            role: 'agent',
            extra: {
                node_id: this.node._id
            }
        });

        dbg.log0('UPDATE NODE', this.node, 'UPDATES', updates);
        _.extend(this.node, updates);
        return nodes_store.update_node_by_id(this.node._id, {
                $set: updates
            })
            .then(() => this.client.agent.update_auth_token({
                auth_token: this.auth_token
            }, {
                connection: item.connection
            }));
    }

    _run_activity() {
        this._throw_if_closed();
        const act =
            this.node.data_activity =
            this.node.data_activity || {};
        return P.resolve()
            .then(() => md_store.DataBlock.collection.find({
                node: this.node._id,
                deleted: null
            }, {
                fields: {
                    chunk: 1
                },
                limit: 1000
            }).toArray())
            .then(block_chunk_ids => md_store.DataChunk.find({
                _id: {
                    $in: mongo_utils.uniq_ids(block_chunk_ids, 'chunk')
                }
            }).toArray())
            .then(chunks => {
                const builder = new MapBuilder(chunks);
                return builder.run();
            });
    }




    old_heartbeat(req) {
        var params = req.rpc_params;

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

    read_node(req) {
        // TODO
    }

    delete_node(req) {
        // TODO notify to initiate rebuild of blocks
        return nodes_store.find_node_by_name(req)
            .then(node => nodes_store.delete_node_by_name(req))
            .return();
    }

    n2n_signal(req) {
        var target = req.rpc_params.target;
        dbg.log1('n2n_signal', target);
        return server_rpc.client.agent.n2n_signal(req.rpc_params, {
            connection: this.connection,
        });
    }


    redirect(req) {
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

    test_node_network(req) {
        var target = req.rpc_params.target;
        var source = req.rpc_params.source;

        dbg.log0('test_node_network: target', target, 'source', source);

        return server_rpc.client.agent.test_network_perf_to_peer({
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

    collect_agent_diagnostics(req) {
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

    set_debug_node(req) {
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
    report_node_block_error(req) {
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


    _unregister_agent(connection, peer_id) {
        return P.when(server_rpc.client.redirector.unregister_agent({
                peer_id: peer_id,
            }))
            .fail(function(error) {
                dbg.log0('Failed to unregister agent', error);
                _resync_agents();
            });
    }

    _on_reconnect(conn) {
        if (conn.url.href === server_rpc.rpc.router.default) {
            dbg.log0('_on_reconnect:', conn.url.href);
            _resync_agents();
        }
    }

    _resync_agents() {
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

}

// server_rpc.rpc.on('reconnect', _on_reconnect);


// EXPORTS
exports.NodesMonitor = NodesMonitor;
