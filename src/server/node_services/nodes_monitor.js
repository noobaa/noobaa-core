/**
 *
 * NODE MONITOR
 *
 */
'use strict';

const _ = require('lodash');
const chance = require('chance')();
const EventEmitter = require('events').EventEmitter;

const P = require('../../util/promise');
const pkg = require('../../../package.json');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const js_utils = require('../../util/js_utils');
const RpcError = require('../../rpc/rpc_error');
const md_store = require('../object_services/md_store');
const MapBuilder = require('../object_services/map_builder').MapBuilder;
const server_rpc = require('../server_rpc');
const auth_server = require('../common_services/auth_server');
const nodes_store = require('./nodes_store');
const mongo_utils = require('../../util/mongo_utils');
const ActivityLog = require('../analytic_services/activity_log');
const buffer_utils = require('../../util/buffer_utils');
const system_store = require('../system_services/system_store').get_instance();
const system_server = require('../system_services/system_server');
const promise_utils = require('../../util/promise_utils');
const node_allocator = require('./node_allocator');
const mongoose_utils = require('../../util/mongoose_utils');
const mongo_functions = require('../../util/mongo_functions');
const system_server_utils = require('../utils/system_server_utils');

const RUN_DELAY_MS = 60000;
const RUN_NODE_CONCUR = 50;
const MAX_NUM_LATENCIES = 20;
const UPDATE_STORE_MIN_ITEMS = 100;
const NODE_REBUILD_WORKERS = 10;
const REBUILD_CLIFF = 3 * 60000;

const AGENT_INFO_FIELDS = [
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
const MONITOR_INFO_FIELDS = [
    'online',
    'readable',
    'writable',
    'trusted',
    'n2n_connectivity',
    'connectivity',
    'storage_full',
];
const NODE_INFO_FIELDS = [
    'name',
    'geolocation',
    'ip',
    'rpc_address',
    'base_address',
    'version',
    'migrating_to_pool',
    'decommissioning',
    'decommissioned',
    'disabled',
    'latency_to_server',
    'latency_of_disk_read',
    'latency_of_disk_write',
    'debug_level',
];
const NODE_INFO_DEFAULTS = {
    ip: '0.0.0.0',
    version: '',
    peer_id: '',
    rpc_address: '',
    base_address: '',
};


class NodesMonitor extends EventEmitter {

    constructor() {
        super();
        this.client = server_rpc.rpc.new_client();
        this._started = false;
        this._loaded = false;
        this._num_running_rebuilds = 0;
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
        this._set_need_rebuild = new Set();
        this._set_need_rebuild_iter = null;
    }

    _load_from_store() {
        if (!this._started) return;
        dbg.log0('_load_from_store ...');
        return mongoose_utils.mongoose_wait_connected()
            .then(() => nodes_store.instance().connect())
            .then(() => nodes_store.instance().find_nodes({
                deleted: null
            }))
            .then(nodes => {
                if (!this._started) return;
                this._clear();
                for (const node of nodes) {
                    this._add_existing_node(node);
                }
                this._loaded = true;
                // delay a bit before running to allow nodes to reconnect
                this._schedule_next_run(3000);
            })
            .catch(err => {
                dbg.log0('_load_from_store ERROR', err.stack);
                return P.delay(1000).then(() => this._load_from_store());
            });
    }

    _add_existing_node(node) {
        const item = {
            connection: null,
            node_from_store: node,
            node: _.cloneDeep(node),
        };
        dbg.log0('_add_existing_node', item.node.name);
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
                _id: nodes_store.instance().make_node_id(),
                peer_id: nodes_store.instance().make_node_id(),
                system: system._id,
                pool: pool._id,
                heartbeat: new Date(),
                name: 'New-Node-' + Date.now().toString(36),
            },
        };
        if (pool.cloud_pool_info) {
            item.node.is_cloud_node = true;
        }
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
        item.node.storage = _.defaults(item.node.storage, {
            total: 0,
            free: 0,
            used: 0,
            alloc: 0,
            limit: 0
        });
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
        conn.on('close', () => {
            // if connection already replaced ignore the close event
            if (item.connection !== conn) return;
            item.connection = null;
            // TODO GUYM what to wakeup on disconnect?
            setTimeout(() => this._run_node(item), 1000).unref();
        });
        item.connection = conn;
        item.node.heartbeat = new Date();
        this._set_need_update.add(item);
        setTimeout(() => this._run_node(item), 1000).unref();
    }

    _schedule_next_run(delay_ms) {
        // TODO GUYM _schedule_next_run should check if currently running?
        clearTimeout(this._next_run_timeout);
        if (!this._started) return;
        this._next_run_timeout = setTimeout(() => {
            P.resolve()
                .then(() => this._run())
                .finally(() => this._schedule_next_run());
        }, delay_ms || RUN_DELAY_MS).unref();
    }

    _run() {
        if (!this._started) return;
        dbg.log0('_run:', this._map_node_id.size, 'nodes in queue');
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
        dbg.log0('_run_node:', item.node.name);
        // TODO schedule run for node should re-run if requested during run
        item.run_promise = item.run_promise || P.resolve()
            .then(() => this._get_agent_info(item))
            .then(() => this._update_rpc_config(item))
            .then(() => this._test_store_perf(item))
            .then(() => this._test_network_perf(item))
            .then(() => this._update_status(item))
            .then(() => this._update_nodes_store())
            .catch(err => {
                dbg.warn('_run_node: ERROR', err.stack || err, 'node', item.node);
            })
            .finally(() => {
                item.run_promise = null;
            });
        return item.run_promise;
    }

    _get_agent_info(item) {
        if (!item.connection) return;
        dbg.log0('_get_agent_info:', item.node.name);
        return this.client.agent.get_agent_info(undefined, {
                connection: item.connection
            })
            .then(info => {
                item.agent_info = info;
                if (info.name !== item.node.name) {
                    this._map_node_name.delete(String(item.node.name));
                    this._map_node_name.set(String(info.name), item);
                }
                const updates = _.pick(info, AGENT_INFO_FIELDS);
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
        const rpc_config = {};
        if (rpc_address !== item.agent_info.rpc_address) {
            rpc_config.rpc_address = rpc_address;
        }
        // only update if the system defined a base address
        // otherwise the agent is using the ip directly, so no update is needed
        if (system.base_address && system.base_address !== item.agent_info.base_address) {
            rpc_config.base_address = system.base_address;
        }
        // make sure we don't modify the system's n2n_config
        const n2n_config = _.extend(null,
            item.agent_info.n2n_config,
            _.cloneDeep(system.n2n_config));
        if (!_.isEqual(n2n_config, item.agent_info.n2n_config)) {
            rpc_config.n2n_config = n2n_config;
        }
        // skip the update when no changes detected
        if (_.isEmpty(rpc_config)) return;
        dbg.log0('_update_rpc_config:', item.node.name, rpc_config);
        return this.client.agent.update_rpc_config(rpc_config, {
                connection: item.connection
            })
            .then(() => {
                _.extend(item.node, rpc_config);
                this._set_need_update.add(item);
            });
    }

    _test_store_perf(item) {
        if (!item.connection) return;
        // TODO check how much time passed since last test
        dbg.log0('_test_store_perf:', item.node.name);
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
        this._set_need_update.add(item);
        item.node.latency_to_server = js_utils.array_push_keep_latest(
            item.node.latency_to_server, [0], MAX_NUM_LATENCIES);
    }

    _update_nodes_store(force) {
        // skip the update if not forced and not enough coalescing
        if (!this._set_need_update.size) return;
        if (!force && this._set_need_update.size < UPDATE_STORE_MIN_ITEMS) return;

        const new_nodes = [];
        const bulk_items = this._set_need_update;
        this._set_need_update = new Set();
        for (const item of bulk_items) {
            if (!item.node_from_store) {
                new_nodes.push(item);
            }
        }

        return P.resolve()
            .then(() => nodes_store.instance().bulk_update(bulk_items))
            .then(() => P.map(new_nodes, item => {
                ActivityLog.create({
                    level: 'info',
                    event: 'node.create',
                    system: item.node.system,
                    node: item.node._id,
                    actor: item.account && item.account._id,
                    desc: `${item.node.name} was added by ${item.account && item.account.email}`,
                });
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
                for (const item of bulk_items) {
                    if (!this._set_need_update.has(item)) {
                        item.node_from_store = _.cloneDeep(item.node);
                    }
                }
            })
            .catch(err => {
                dbg.error('_update_nodes_store ERROR', err);
                // add all the failed nodes to set
                for (const item of bulk_items) {
                    this._set_need_update.add(item);
                }
            });
    }


    _update_status(item) {
        // TODO update the node status fields for real
        dbg.log0('_update_status:', item.node.name);
        item.trusted = true;
        item.n2n_connectivity = true;
        item.connectivity = 'TCP';

        item.online = Boolean(item.connection);

        item.storage_full =
            item.node.storage.limit ?
            (item.node.storage.used >= item.node.storage.limit) :
            (item.node.storage.free <= config.NODES_FREE_SPACE_RESERVE);

        item.readable = Boolean(
            item.online &&
            item.trusted);

        item.writable = Boolean(
            item.online &&
            item.trusted &&
            !item.node.decommissioning &&
            !item.node.disabled &&
            !item.storage_full);

        item.usable = Boolean(
            item.online &&
            item.trusted &&
            !item.node.decommissioning &&
            !item.node.disabled);

        item.accessibility =
            (item.readable && item.writable && 'FULL_ACCESS') ||
            (item.readable && 'READ_ONLY') ||
            'NO_ACCESS';

        item.data_activity_reason =
            (item.node.decommissioning && !item.node.decommissioned && 'DECOMMISSIONING') ||
            (item.node.migrating_to_pool && 'MIGRATING') ||
            (!item.readable && 'RESTORING') ||
            (!item.writable && 'FREEING_SPACE');

        if (item.data_activity && !item.data_activity_reason) {
            dbg.warn('_update_status: unset node data_activity for', item.node.name);
            item.data_activity = null;
            this._set_need_rebuild.delete(item);
        } else if (!item.data_activity && item.data_activity_reason) {
            if (system_server_utils.system_in_maintenance(item.node.system)) {
                dbg.warn('_update_status: delay node data_activity',
                    'while system in maintenance', item.node.name);
            } else {
                const time_left = REBUILD_CLIFF - (Date.now() - item.node.heartbeat.getTime());
                if (time_left > 0) {
                    dbg.warn('_update_status: schedule node data_activity for', item.node.name,
                        'in', time_left, 'ms');
                    clearTimeout(item.data_activity_timout);
                    item.data_activity_timout =
                        setTimeout(() => this._run_node(item), time_left).unref();
                } else {
                    dbg.warn('_update_status: set node data_activity for', item.node.name);
                    item.data_activity = {
                        reason: item.data_activity_reason,
                        // stage: 'REBUILDING', // TODO
                        start_time: Date.now(),
                        completed_size: 0,
                        remaining_size: -1,
                        remaining_time: -1
                    };
                    this._set_need_rebuild.add(item);
                    this._wakeup_rebuild();
                }
            }
        }
    }

    _wakeup_rebuild() {
        const count = Math.min(
            NODE_REBUILD_WORKERS,
            this._set_need_rebuild.size - this._num_running_rebuilds);
        for (let i = 0; i < count; ++i) {
            this._rebuild_worker(i);
        }
    }

    _rebuild_worker(i) {
        let iter = this._set_need_rebuild_iter;
        let next = iter && iter.next();
        if (!next || next.done) {
            iter = this._set_need_rebuild.values();
            next = iter.next();
            this._set_need_rebuild_iter = iter;
            if (next.done) return; // no work
        }
        const item = next.value;
        this._num_running_rebuilds += 1;
        this._set_need_rebuild.delete(item);
        // use small delay skew to avoid running together
        return promise_utils.delay_unblocking(5 * i)
            .then(() => this._rebuild_node(item))
            .finally(() => {
                this._num_running_rebuilds -= 1;
                this._wakeup_rebuild();
            });
    }

    _rebuild_node(item) {
        if (!this._started) return;
        if (!item.data_activity) return;
        const act = item.data_activity;
        if (act.running) return;
        dbg.log0('_rebuild_node: start', item.node.name, act);
        const blocks_query = {
            node: item.node._id,
            deleted: null
        };
        if (act.last_block_id) {
            blocks_query._id = {
                $lt: act.last_block_id
            };
        }
        let blocks;
        const batch_size = 500;
        act.running = true;
        return P.join(
                md_store.DataBlock.collection.mapReduce(
                    mongo_functions.map_size,
                    mongo_functions.reduce_sum, {
                        query: blocks_query,
                        out: {
                            inline: 1
                        }
                    }),
                md_store.DataBlock.collection.find(blocks_query, {
                    sort: '-_id', // start with latest blocks and go back
                    fields: {
                        _id: 1,
                        chunk: 1,
                        size: 1
                    },
                    limit: batch_size
                }).toArray())
            .spread((remaining_size_res, blocks_res) => {
                blocks = blocks_res;
                act.remaining_size =
                    remaining_size_res[0] &&
                    remaining_size_res[0].value || 0;
                act.total_size = act.completed_size + act.remaining_size;
                return md_store.DataChunk.collection.find({
                    _id: {
                        $in: mongo_utils.uniq_ids(blocks, 'chunk')
                    }
                }).toArray();
            })
            .then(chunks => {
                const builder = new MapBuilder(chunks);
                return builder.run();
            })
            .then(() => {
                act.running = false;
                if (blocks.length === batch_size) {
                    act.last_block_id = blocks[blocks.length - 1]._id;
                    act.completed_size += _.sumBy(blocks, 'size');
                    act.remaining_time = (Date.now() - act.start_time) *
                        act.total_size / act.completed_size;
                    dbg.log0('_rebuild_node: continue', item.node.name, act);
                    this._set_need_rebuild.add(item);
                    this._wakeup_rebuild();
                } else {
                    act.last_block_id = undefined;
                    act.remaining_size = 0;
                    act.remaining_time = 0;
                    act.done = true;
                    dbg.log0('_rebuild_node: DONE', item.node.name, act);
                }
            })
            .catch(err => {
                act.running = false;
                dbg.warn('_rebuild_node: ERROR', item.node.name, err.stack || err);
                setTimeout(() => {
                    this._set_need_rebuild.add(item);
                    this._wakeup_rebuild();
                }, 5000).unref();
            });
    }




    //////////////////////////////////////////////////////////////


    sync_to_store() {
        return P.resolve(this._run()).return();
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

    _filter_nodes(query) {
        const list = [];
        for (const item of this._map_node_id.values()) {
            // update the status of every node we go over
            this._update_status(item);

            if (query.system &&
                query.system !== String(item.node.system)) continue;
            if (query.pools &&
                !query.pools.has(String(item.node.pool))) continue;
            if (query.filter &&
                !query.filter.test(item.node.name) &&
                !query.filter.test(item.node.ip)) continue;
            if (query.geolocation &&
                !query.geolocation.test(item.node.geolocation)) continue;
            if (query.skip_address &&
                query.skip_address === item.node.rpc_address) continue;

            if ('usable' in query &&
                Boolean(query.usable) !== Boolean(item.usable)) continue;
            if ('online' in query &&
                Boolean(query.online) !== Boolean(item.online)) continue;
            if ('readable' in query &&
                Boolean(query.readable) !== Boolean(item.readable)) continue;
            if ('writable' in query &&
                Boolean(query.writable) !== Boolean(item.writable)) continue;
            if ('trusted' in query &&
                Boolean(query.trusted) !== Boolean(item.trusted)) continue;

            if ('migrating_to_pool' in query &&
                Boolean(query.migrating_to_pool) !== Boolean(item.node.migrating_to_pool)) continue;
            if ('decommissioning' in query &&
                Boolean(query.decommissioning) !== Boolean(item.node.decommissioning)) continue;
            if ('decommissioned' in query &&
                Boolean(query.decommissioned) !== Boolean(item.node.decommissioned)) continue;
            if ('disabled' in query &&
                Boolean(query.disabled) !== Boolean(item.node.disabled)) continue;

            if ('accessibility' in query &&
                query.accessibility !== item.accessibility) continue;
            if ('connectivity' in query &&
                query.connectivity !== item.connectivity) continue;
            if ('data_activity' in query &&
                query.data_activity !== item.data_activity.reason) continue;

            console.log('list_nodes: adding node', item.node.name);
            list.push(item);
        }
        return list;
    }

    _sort_nodes_list(list, options) {
        if (!options || !options.sort) return;
        if (options.sort === 'name') {
            list.sort(js_utils.sort_compare_by(item => String(item.node.name), options.order));
        } else if (options.sort === 'ip') {
            list.sort(js_utils.sort_compare_by(item => String(item.node.ip), options.order));
        } else if (options.sort === 'usable') {
            list.sort(js_utils.sort_compare_by(item => Boolean(item.usable), options.order));
        } else if (options.sort === 'online') {
            list.sort(js_utils.sort_compare_by(item => Boolean(item.online), options.order));
        } else if (options.sort === 'trusted') {
            list.sort(js_utils.sort_compare_by(item => Boolean(item.trusted), options.order));
        } else if (options.sort === 'used') {
            list.sort(js_utils.sort_compare_by(item => item.node.storage.used, options.order));
        } else if (options.sort === 'accessibility') {
            list.sort(js_utils.sort_compare_by(item => item.accessibility, options.order));
        } else if (options.sort === 'connectivity') {
            list.sort(js_utils.sort_compare_by(item => item.connectivity, options.order));
        } else if (options.sort === 'data_activity') {
            list.sort(js_utils.sort_compare_by(item => item.data_activity.reason, options.order));
        } else if (options.sort === 'shuffle') {
            chance.shuffle(list);
        }
    }

    _paginate_nodes_list(list, options) {
        const skip = options.skip || 0;
        const limit = options.limit || list.length;
        return list.slice(skip, skip + limit);
    }

    list_nodes(query, options) {
        console.log('list_nodes: query', query);
        const list = this._filter_nodes(query);
        this._sort_nodes_list(list, options);
        const res_list = options && options.pagination ?
            this._paginate_nodes_list(list, options) : list;
        console.log('list_nodes', res_list.length, '/', list.length);
        return {
            total_count: list.length,
            nodes: _.map(res_list, item => this.get_node_full_info(item))
        };
    }

    _aggregate_nodes_list(list) {
        let count = 0;
        let online = 0;
        let usable = 0;
        const storage = {
            total: 0,
            free: 0,
            used: 0,
            reserved: 0,
        };
        _.each(list, item => {
            count += 1;
            if (item.online) online += 1;
            if (item.usable) {
                usable += 1;
                // TODO use bigint for nodes storage sum
                storage.total += item.node.storage.total || 0;
                storage.free += item.node.storage.free || 0;
                storage.used += item.node.storage.used || 0;
                storage.reserved += config.NODES_FREE_SPACE_RESERVE || 0;
            }
        });
        return {
            nodes: {
                count: count,
                online: online,
                usable: usable,
            },
            storage: storage
        };
    }

    aggregate_nodes(query, group_by) {
        const list = this._filter_nodes(query);
        const res = this._aggregate_nodes_list(list);
        if (group_by) {
            if (group_by === 'pool') {
                const pool_groups = _.groupBy(list,
                    item => String(item.node.pool));
                res.groups = _.mapValues(pool_groups,
                    items => this._aggregate_nodes_list(items));
            } else {
                throw new Error('aggregate_nodes: Invalid group_by ' + group_by);
            }
        }
        return res;
    }

    get_node_full_info(item) {
        const node = item.node;
        const info = _.defaults(
            _.pick(item, MONITOR_INFO_FIELDS),
            _.pick(node, NODE_INFO_FIELDS),
            NODE_INFO_DEFAULTS);
        info.id = String(node._id);
        info.peer_id = String(node.peer_id);
        info.pool = system_store.data.get_by_id(node.pool).name;
        info.heartbeat = node.heartbeat.getTime();
        const act = item.data_activity;
        if (act && !act.done) {
            info.data_activity = _.pick(act,
                'reason',
                // 'stage',
                // 'pending',
                'start_time',
                'completed_size',
                'remaining_size',
                'remaining_time');
        }
        info.storage = get_storage_info(node.storage);
        info.drives = _.map(node.drives, drive => {
            return {
                mount: drive.mount,
                drive_id: drive.drive_id,
                storage: get_storage_info(drive.storage)
            };
        });
        info.os_info = _.defaults({}, node.os_info);
        if (info.os_info.uptime) {
            info.os_info.uptime = new Date(info.os_info.uptime).getTime();
        }
        if (info.os_info.last_update) {
            info.os_info.last_update = new Date(info.os_info.last_update).getTime();
        }
        return info;
    }

    _get_node_by_name(name, allow_offline) {
        if (!this._loaded) throw new RpcError('MONITOR_NOT_LOADED');
        const item = this._map_node_name.get(name);
        if (!item) throw new RpcError('NO_SUCH_NODE', 'No node with name ' + name);
        if (!item.connection && allow_offline !== 'allow_offline') {
            throw new RpcError('NODE_OFFLINE', 'Node is offline ' + name);
        }
        return item;
    }
    _get_node_by_address(address, allow_offline) {
        if (!this._loaded) throw new RpcError('MONITOR_NOT_LOADED');
        const item = this._map_peer_id.get(address.slice('n2n://'.length));
        if (!item) throw new RpcError('NO_SUCH_NODE', 'No node with address ' + address);
        if (!item.connection && allow_offline !== 'allow_offline') {
            throw new RpcError('NODE_OFFLINE', 'Node is offline ' + address);
        }
        return item;
    }

    read_node_by_name(name) {
        const item = this._get_node_by_name(name, 'allow_offline');
        this._update_status(item);
        return this.get_node_full_info(item);
    }

    n2n_signal(req) {
        dbg.log1('n2n_signal:', req.rpc_params.target);
        const item = this._get_node_by_address(req.rpc_params.target);
        if (!item) {
            // TODO do the hockey pocky in the cluster like was in redirector
        }
        return this.client.agent.n2n_signal(req.rpc_params, {
            connection: item.connection,
        });
    }

    n2n_proxy(req) {
        dbg.log3('n2n_proxy: target', req.rpc_params.target,
            'call', req.rpc_params.method_api + '.' + req.rpc_params.method_name,
            'params', req.rpc_params.request_params);

        const item = this._get_node_by_address(req.rpc_params.target);
        const api = req.rpc_params.method_api.slice(0, -4); //Remove _api suffix
        const method_name = req.rpc_params.method_name;
        const method = server_rpc.rpc.schema[req.rpc_params.method_api].methods[method_name];
        if (method.params_import_buffers) {
            // dbg.log5('n2n_proxy: params_import_buffers', req.rpc_params);
            method.params_import_buffers(req.rpc_params.request_params, req.rpc_params.proxy_buffer);
        }

        return this.client[api][method_name](req.rpc_params.request_params, {
                connection: item.connection,
            })
            .then(reply => {
                const res = {
                    proxy_reply: reply
                };
                if (method.reply_export_buffers) {
                    res.proxy_buffer = buffer_utils.get_single(method.reply_export_buffers(reply));
                    // dbg.log5('n2n_proxy: reply_export_buffers', reply);
                }
                return res;
            });
    }

    test_node_network(req) {
        dbg.log0('test_node_network:',
            'target', req.rpc_params.target,
            'source', req.rpc_params.source);
        const item = this._get_node_by_address(req.rpc_params.source);
        return this.client.agent.test_network_perf_to_peer(req.rpc_params, {
            connection: item.connection,
        });
    }

    delete_node(req) {
        // TODO notify to initiate rebuild of blocks
        return nodes_store.instance().find_node_by_name(req)
            .then(node => nodes_store.instance().delete_node_by_name(req))
            .return();
    }

    collect_agent_diagnostics(req) {
        const item = this._get_node_by_name(req.rpc_params.name);
        return server_rpc.client.agent.collect_diagnostics({}, {
                connection: item.connection,
            })
            .then(data => {
                return system_server.diagnose_with_agent(data, req);
            })
            .catch(err => {
                dbg.log0('Error on collect_agent_diagnostics', err);
                return '';
            });
    }

    set_debug_node(req) {
        const item = this._get_node_by_name(req.rpc_params.name);
        return P.fcall(() => {
                item.node.debug_level = req.rpc_params.level;
                this._set_need_update.add(item);
                return server_rpc.client.agent.set_debug_node({
                    level: req.rpc_params.level
                }, {
                    connection: item.connection,
                });
            })
            .then(() => {
                ActivityLog.create({
                    system: req.system._id,
                    level: 'info',
                    event: 'dbg.set_debug_node',
                    actor: req.account && req.account._id,
                    node: item.node._id,
                    desc: `${item.node.name} debug level was raised by ${req.account && req.account.email}`,
                });
                dbg.log1('set_debug_node was successful for agent', item.node.name,
                    'level', req.rpc_params.level);
                return '';
            })
            .catch(err => {
                dbg.log0('Error on set_debug_node', err);
                return '';
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
            return nodes_store.instance().update_node_by_id(node_id, {
                $set: {
                    error_since_hb: new Date(),
                }
            }).return();
        }
    }

}


function get_storage_info(storage) {
    return {
        total: storage.total || 0,
        free: storage.free || 0,
        used: storage.used || 0,
        alloc: storage.alloc || 0,
        limit: storage.limit || 0
    };
}


// EXPORTS
exports.NodesMonitor = NodesMonitor;
