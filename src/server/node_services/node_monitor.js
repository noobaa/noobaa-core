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
const js_utils = require('../../util/js_utils');
const RpcError = require('../../rpc/rpc_error');
const md_store = require('../object_services/md_store');
const MapBuilder = require('../object_services/map_builder').MapBuilder;
const server_rpc = require('../server_rpc');
const auth_server = require('../common_services/auth_server');
const nodes_store = require('./nodes_store');
const mongo_utils = require('../../util/mongo_utils');
const ActivityLog = require('../analytic_services/activity_log');
const system_store = require('../system_services/system_store').get_instance();
const system_server = require('../system_services/system_server');
const promise_utils = require('../../util/promise_utils');
const node_allocator = require('./node_allocator');
const mongoose_utils = require('../../util/mongoose_utils');

const RUN_DELAY_MS = 10000;
const RUN_NODE_CONCUR = 50;
const MAX_NUM_LATENCIES = 20;
const UPDATE_STORE_MIN_ITEMS = 100;
const AGENT_INFO_FIELDS_PICK = [
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
    'is_internal_agent'
];


class NodesMonitor extends EventEmitter {

    constructor() {
        super();
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
        this._set_need_update = new Set();
    }

    _load_from_store() {
        if (!this._started) return;
        dbg.log0('_load_from_store ...');
        return mongoose_utils.mongoose_wait_connected()
            .then(() => nodes_store.find_nodes({
                deleted: null
            }, {
                dont_resolve_object_ids: true
            }))
            .then(nodes => {
                if (!this._started) return;
                this._clear();
                for (const node of nodes) {
                    this._add_existing_node(node);
                }
                this._loaded = true;
                this._schedule_next_run();
            })
            .catch(err => {
                dbg.log0('_load_from_store ERROR', err);
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
            this._add_new_node(req.connection, req.system._id, extra.pool_id);
            return reply;
        }

        dbg.error('heartbeat: BAD REQUEST', 'role', req.role, 'auth', req.auth);
        throw new RpcError('FORBIDDEN', 'Bad heartbeat request');
    }

    _add_existing_node(node) {
        const item = {
            connection: null,
            node_from_store: node,
            node: _.cloneDeep(node),
        };
        dbg.log0('_add_existing_node', item.node);
        this._add_node_to_maps(item);
        this._set_node_defaults(item);
    }

    _add_new_node(conn, system_id, pool_id) {
        const system = system_store.data.get_by_id(system_id);
        const pool =
            system_store.data.get_by_id(pool_id) ||
            system.pools_by_name.default_pool;
        if (pool.system !== system) {
            throw new Error('Node pool must belong to system');
        }
        const item = {
            connection: null,
            node_from_store: null,
            node: {
                _id: nodes_store.make_node_id(),
                peer_id: nodes_store.make_node_id(),
                system: system._id,
                pool: pool._id,
                heartbeat: new Date(),
                name: 'New-Node-' + Date.now().toString(36),
            },
        };
        dbg.log0('_add_new_node', item.node);
        this._add_node_to_maps(item);
        this._set_node_defaults(item);
        this._set_connection(item, conn);
        this._set_need_update.add(item);
    }

    _add_node_to_maps(item) {
        this._map_node_id.set(String(item.node._id), item);
        this._map_peer_id.set(String(item.node.peer_id), item);
        this._map_node_name.set(String(item.node.name), item);
    }

    _set_node_defaults(item) {
        item.node.drives = item.node.drives || [];
        item.node.latency_to_server = item.node.latency_to_server || [];
        item.node.latency_of_disk_read = item.node.latency_of_disk_read || [];
        item.node.latency_of_disk_write = item.node.latency_of_disk_write || [];
    }

    _connect_node(conn, node_id) {
        dbg.log0('_connect_node:', 'node_id', node_id);
        const item = this._map_node_id.get(String(node_id));
        if (!item) throw new RpcError('NODE_NOT_FOUND', node_id);
        this._set_connection(item, conn);
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
        }, RUN_DELAY_MS);
    }

    _run() {
        if (!this._started) return;
        let next = 0;
        const queue = Array.from(this._map_node_id.values());
        const concur = Math.min(queue.length, RUN_NODE_CONCUR);
        const worker = () => {
            if (next >= queue.length) return;
            const item = queue[next++];
            return this._run_node(item).then(worker);
        };
        return P.all(_.times(concur, worker))
            .then(() => this._update_nodes_store('force'));
    }

    _run_node(item) {
        if (!this._started) return;
        return P.resolve()
            .then(() => this._get_agent_info(item))
            .then(() => this._update_rpc_config(item))
            .then(() => this._test_store_perf(item))
            // .then(() => this._test_network_perf(item))
            // .then(() => this._update_status(item))
            .then(() => this._update_nodes_store());
    }

    _get_agent_info(item) {
        if (!item.connection) return;
        return this.client.agent.get_agent_info(undefined, {
                connection: item.connection
            })
            .then(info => {
                item.agent_info = info;
                const updates = _.pick(info, AGENT_INFO_FIELDS_PICK);
                updates.heartbeat = new Date();
                _.extend(item.node, updates);
                this._set_need_update.add(item);
            });
    }

    _update_rpc_config(item) {
        if (!item.connection) return;
        const system = system_store.data.get_by_id(item.node.system);
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
        // TODO GUYM this check always fails because of system.base_address is undefined for dev,
        // and n2n_config in agent has all fields while in system it is partial.
        dbg.log0('rpc_config', rpc_config, 'old_config', old_config);
        if (_.isEqual(rpc_config, old_config)) return;
        // clone to make sure we don't modify the system's n2n_config
        const rpc_config_clone = _.cloneDeep(rpc_config);
        return this.client.agent.update_rpc_config(rpc_config_clone, {
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
                this._set_need_update.add(item);
                item.node.latency_of_disk_read = js_utils.array_push_keep_latest(
                    item.node.latency_of_disk_read, res.read, MAX_NUM_LATENCIES);
                item.node.latency_of_disk_write = js_utils.array_push_keep_latest(
                    item.node.latency_of_disk_write, res.write, MAX_NUM_LATENCIES);
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

    _update_nodes_store(force) {
        // skip the update if not forced and not enough coalescing
        if (!this._set_need_update.size) return;
        if (!force && this._set_need_update.size < UPDATE_STORE_MIN_ITEMS) return;

        // prepare a bulk update to the store
        const new_nodes = [];
        const set_of_current_bulk = this._set_need_update;
        this._set_need_update = new Set();
        const bulk = nodes_store.bulk();
        for (const item of set_of_current_bulk) {
            if (item.node_from_store) {
                new_nodes.push(item);
                bulk.find({
                    _id: item.node._id
                }).updateOne({
                    $set: item.node
                });
            } else {
                bulk.insert(item.node);
            }
        }

        return P.resolve()
            .then(() => P.ninvoke(bulk, 'execute'))
            .then(() => P.map(new_nodes, item => {
                return this.client.agent.update_auth_token({
                        auth_token: auth_server.make_auth_token({
                            system_id: String(item.node.system),
                            role: 'agent',
                            extra: {
                                node_id: item.node._id
                            }
                        })
                    }, {
                        connection: item.connection
                    })
                    .catch(err => {
                        dbg.warn('update_auth_token ERROR node', item.node._id, err);
                        // TODO handle error of update_auth_token - disconnect? deleted from store?
                    });
            }, {
                concurrency: 10
            }))
            .then(() => {
                // for all updated nodes we can consider the store updated
                // if no new updates were requested while we were writing
                for (const item of set_of_current_bulk) {
                    if (!this._set_need_update.has(item)) {
                        item.node_from_store = _.cloneDeep(item.node);
                    }
                }
            })
            .catch(err => {
                dbg.error('_update_nodes_store ERROR', err);
                // add all the failed nodes to set
                for (const item of set_of_current_bulk) {
                    this._set_need_update.add(item);
                }
            });
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
