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
const dclassify = require('dclassify');
const size_utils = require('../../util/size_utils');
const BigInteger = size_utils.BigInteger;
const Dispatcher = require('../notifications/dispatcher');
const MapBuilder = require('../object_services/map_builder').MapBuilder;
const server_rpc = require('../server_rpc');
const auth_server = require('../common_services/auth_server');
const nodes_store = require('./nodes_store');
const buffer_utils = require('../../util/buffer_utils');
const system_store = require('../system_services/system_store').get_instance();
const promise_utils = require('../../util/promise_utils');
const mongoose_utils = require('../../util/mongoose_utils');
const cluster_server = require('../system_services/cluster_server');
const system_server_utils = require('../utils/system_server_utils');
const clustering_utils = require('../utils/clustering_utils');

const RUN_DELAY_MS = 60000;
const RUN_NODE_CONCUR = 5;
const MAX_NUM_LATENCIES = 20;
const UPDATE_STORE_MIN_ITEMS = 100;

const AGENT_INFO_FIELDS = [
    'name',
    'version',
    'ip',
    'host_id',
    'base_address',
    'rpc_address',
    'geolocation',
    'storage',
    'drives',
    'os_info',
    'debug_level',
    'is_internal_agent',
];
const MONITOR_INFO_FIELDS = [
    'has_issues',
    'online',
    'readable',
    'writable',
    'trusted',
    'n2n_connectivity',
    'connectivity',
    'storage_full',
    'suggested_pool',
];
const NODE_INFO_FIELDS = [
    'name',
    'geolocation',
    'ip',
    'host_id',
    'is_cloud_node',
    'rpc_address',
    'base_address',
    'version',
    'latency_to_server',
    'latency_of_disk_read',
    'latency_of_disk_write',
    'debug_level',
    'heartbeat',
    'migrating_to_pool',
    'decommissioning',
    'decommissioned',
    'deleting',
    'deleted',
];
const NODE_INFO_DEFAULTS = {
    ip: '0.0.0.0',
    version: '',
    peer_id: '',
    rpc_address: '',
    base_address: '',
};
const QUERY_FIELDS = [{
    query: 'readable',
    item: 'item.readable',
    type: 'Boolean',
}, {
    query: 'writable',
    item: 'item.writable',
    type: 'Boolean',
}, {
    query: 'trusted',
    item: 'item.trusted',
    type: 'Boolean',
}, {
    query: 'migrating_to_pool',
    item: 'item.node.migrating_to_pool',
    type: 'Boolean',
}, {
    query: 'decommissioning',
    item: 'item.node.decommissioning',
    type: 'Boolean',
}, {
    query: 'decommissioned',
    item: 'item.node.decommissioned',
    type: 'Boolean',
}, {
    query: 'migrating_to_pool',
    item: 'item.node.migrating_to_pool',
    type: 'Boolean',
}, {
    query: 'accessibility',
    item: 'item.accessibility',
    type: 'String',
}, {
    query: 'connectivity',
    item: 'item.connectivity',
    type: 'String',
}, {
    query: 'data_activity',
    item: 'item.data_activity.reason',
    type: 'String',
}];

const ACT_DELETING = 'DELETING';
const ACT_DECOMMISSIONING = 'DECOMMISSIONING';
const ACT_MIGRATING = 'MIGRATING';
const ACT_RESTORING = 'RESTORING';
const STAGE_OFFLINE_GRACE = 'OFFLINE_GRACE';
const STAGE_REBUILDING = 'REBUILDING';
const STAGE_WIPING = 'WIPING';
const WAIT_NODE_OFFLINE = 'NODE_OFFLINE';
const WAIT_SYSTEM_MAINTENANCE = 'SYSTEM_MAINTENANCE';

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

    /**
     * sync_to_store is used for testing to get the info from all nodes
     */
    sync_to_store() {
        return P.resolve(this._run()).return();
    }


    /**
     * heartbeat request from node agent
     */
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

        //If this server is not the master, redirect the agent to the master
        let current_clustering = system_store.get_local_cluster_info();
        if ((current_clustering && current_clustering.is_clusterized) && !system_store.is_cluster_master) {
            return P.resolve(cluster_server.redirect_to_cluster_master())
                .then(addr => {
                    dbg.log0('heartbeat: current is not master redirecting to', addr);
                    reply.redirect = addr;
                    return reply;
                });
        }


        this._throw_if_not_started_and_loaded();

        // existing node heartbeat
        if (node_id && (req.role === 'agent' || req.role === 'admin')) {
            this._connect_node(req.connection, node_id);
            return reply;
        }

        // new node heartbeat
        // create the node and then update the heartbeat
        if (!node_id && (req.role === 'create_node' || req.role === 'admin')) {
            this._add_new_node(req.connection, req.system._id, extra.pool_id, req.rpc_params.pool_name);
            return reply;
        }

        dbg.error('heartbeat: BAD REQUEST', 'role', req.role, 'auth', req.auth);
        throw new RpcError('FORBIDDEN', 'Bad heartbeat request');
    }


    test_node_id(req) {
        const extra = req.auth.extra || {};
        const node_id = String(extra.node_id || '');
        if (node_id) {
            // test the passed node id, to verify that it's a valid node
            const item = this._map_node_id.get(String(node_id));
            dbg.log0('agent sent node_id', node_id, item ? 'found valid node' : 'did not find a valid node!!!');
            return Boolean(item);
        }
        dbg.log0('agent did not send a node_id. sending valid=true');
        return true;
    }


    /**
     * read_node returns information about one node
     */
    read_node(node_identity) {
        this._throw_if_not_started_and_loaded();
        const item = this._get_node(node_identity, 'allow_offline');
        this._update_status(item);
        return this._get_node_info(item);
    }

    migrate_nodes_to_pool(nodes_identities, pool_id) {
        this._throw_if_not_started_and_loaded();
        const items = _.map(nodes_identities, node_identity => {
            let item = this._get_node(node_identity, 'allow_offline');
            // validate that the node doesn't belong to a cloud pool
            if (item.node.is_cloud_node) {
                throw new RpcError('migrating a cloud node is not allowed');
            }
            return item;
        });
        _.each(items, item => {
            dbg.log0('migrate_nodes_to_pool:', item.node.name,
                'pool_id', pool_id, 'from pool', item.node.pool);
            if (String(item.node.pool) !== String(pool_id)) {
                item.node.migrating_to_pool = Date.now();
                item.node.pool = pool_id;
                item.suggested_pool = ''; // reset previous suggestion
            }
            this._set_need_update.add(item);
            this._update_status(item);
        });
        this._schedule_next_run(1);
        // let desc_string = [];
        // desc_string.push(`${assign_nodes && assign_nodes.length} Nodes were assigned to ${pool.name} successfully by ${req.account && req.account.email}`);
        // _.forEach(nodes_before_change, node => {
        //     desc_string.push(`${node.name} was assigned from ${node.pool.name} to ${pool.name}`);
        // });
        // Dispatcher.instance().activity({
        //     event: 'pool.assign_nodes',
        //     level: 'info',
        //     system: req.system._id,
        //     actor: req.account && req.account._id,
        //     pool: pool._id,
        //     desc: desc_string.join('\n'),
        // });
    }

    decommission_node(node_identity) {
        this._throw_if_not_started_and_loaded();
        const item = this._get_node(node_identity, 'allow_offline');
        if (!item.node.decommissioning) {
            item.node.decommissioning = Date.now();
        }
        this._set_need_update.add(item);
        this._update_status(item);
    }

    recommission_node(node_identity) {
        this._throw_if_not_started_and_loaded();
        const item = this._get_node(node_identity, 'allow_offline');
        delete item.node.decommissioning;
        delete item.node.decommissioned;
        this._set_need_update.add(item);
        this._update_status(item);
    }

    delete_node(node_identity) {
        this._throw_if_not_started_and_loaded();
        const item = this._get_node(node_identity, 'allow_offline');
        if (!item.node.deleting) {
            item.node.deleting = Date.now();
        }
        this._set_need_update.add(item);
        this._update_status(item);

        // TODO GUYM implement delete_node
        throw new RpcError('TODO', 'delete_node');
    }



    ///////////////////
    // INTERNAL IMPL //
    ///////////////////


    _clear() {
        this._loaded = false;
        this._map_node_id = new Map();
        this._map_peer_id = new Map();
        this._map_node_name = new Map();
        this._set_need_update = new Set();
        this._set_need_rebuild = new Set();
        this._set_need_rebuild_iter = null;
    }

    _throw_if_not_started_and_loaded() {
        if (!this._started) throw new RpcError('MONITOR_NOT_STARTED');
        if (!this._loaded) throw new RpcError('MONITOR_NOT_LOADED');
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

    _add_new_node(conn, system_id, pool_id, pool_name) {
        const system = system_store.data.get_by_id(system_id);
        const pool =
            system_store.data.get_by_id(pool_id) ||
            system.pools_by_name[pool_name] ||
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
                heartbeat: Date.now(),
                name: 'a-node-has-no-name-' + Date.now().toString(36),
            },
        };
        if (pool.cloud_pool_info) {
            item.node.is_cloud_node = true;
        } else if (pool.demo_pool) {
            item.node.is_internal_node = true;
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
        if (!_.isNumber(item.node.heartbeat)) {
            item.node.heartbeat = new Date(item.node.heartbeat).getTime() || 0;
        }
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
        if (item.connection === conn) return;
        if (item.connection) {
            // make sure it is not a cloned agent. if the old connection is still connected
            // the assumption is that this is a duplicated agent. in that case throw an error
            if (item.connection._state === 'connected' && conn.url.hostname !== item.connection.url.hostname) {
                throw new RpcError('DUPLICATE', 'agent appears to be duplicated - abort', false);
            }
            dbg.warn('heartbeat: closing old connection', item.connection.connid);
            item.connection.close();
        }
        item.connection = conn;
        this._set_need_update.add(item);
        setTimeout(() => this._run_node(item), 1000).unref();
        if (conn) {
            item.node.heartbeat = Date.now();
            conn.on('close', () => {
                // if connection already replaced ignore the close event
                if (item.connection !== conn) return;
                item.connection = null;
                // TODO GUYM what to wakeup on disconnect?
                setTimeout(() => this._run_node(item), 1000).unref();
            });
        }
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
            const item = queue[next];
            next += 1;
            return this._run_node(item).then(worker);
        };
        return P.all(_.times(concur, worker))
            .then(() => this._suggest_pool_assign())
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
        let potential_masters = clustering_utils.get_potential_masters();

        return this.client.agent.get_agent_info_and_update_masters({
                addresses: potential_masters
            }, {
                connection: item.connection
            })
            .then(info => {
                item.agent_info = info;
                if (info.name !== item.node.name) {
                    dbg.log0('_get_agent_info: rename node from', item.node.name,
                        'to', info.name);
                    this._map_node_name.delete(String(item.node.name));
                    this._map_node_name.set(String(info.name), item);
                }
                const updates = _.pick(info, AGENT_INFO_FIELDS);
                updates.heartbeat = Date.now();
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
                Dispatcher.instance().activity({
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
        dbg.log0('_update_status:', item.node.name);

        item.online = Boolean(item.connection);

        // to decide the node trusted status we check the reported issues
        item.trusted = true;
        if (item.node.issues_report) {
            for (const issue of item.node.issues_report) {
                // tampering is a trust issue, but maybe we need to refine this
                // and only consider trust issue after 3 tampering strikes
                // which are not too old
                if (issue.reason === 'TAMPERING') {
                    item.trusted = false;
                }
            }
        }

        // TODO GUYM implement node n2n_connectivity & connectivity status
        item.n2n_connectivity = true;
        item.connectivity = 'TCP';

        item.avg_ping = _.mean(item.node.latency_to_server);
        item.avg_disk_read = _.mean(item.node.latency_of_disk_read);
        item.avg_disk_write = _.mean(item.node.latency_of_disk_write);

        item.storage_full =
            item.node.storage.limit ?
            (item.node.storage.used >= item.node.storage.limit) :
            (item.node.storage.free <= config.NODES_FREE_SPACE_RESERVE);

        item.has_issues = !(
            item.online &&
            item.trusted &&
            !item.node.decommissioning &&
            !item.node.decommissioned &&
            !item.node.deleting &&
            !item.node.deleted);

        item.readable = Boolean(
            item.online &&
            item.trusted &&
            !item.node.decommissioned && // but readable when decommissioning !
            !item.node.deleting &&
            !item.node.deleted);

        item.writable = Boolean(
            item.online &&
            item.trusted &&
            !item.storage_full &&
            !item.node.decommissioning &&
            !item.node.decommissioned &&
            !item.node.deleting &&
            !item.node.deleted);

        item.accessibility =
            (item.readable && item.writable && 'FULL_ACCESS') ||
            (item.readable && 'READ_ONLY') ||
            'NO_ACCESS';

        this._update_data_activity(item);
    }

    _update_data_activity(item) {
        const reason = this._get_data_activity_reason(item);
        if (!reason) {
            item.data_activity = null;
            this._set_need_rebuild.delete(item);
            return;
        }
        const now = Date.now();
        const act = item.data_activity = item.data_activity || {};
        act.reason = reason;
        this._update_data_activity_stage(item, now);
        this._update_data_activity_progress(item, now);
        this._update_data_activity_schedule(item);
    }

    _get_data_activity_reason(item) {
        if (item.node.deleted) return '';
        if (item.node.deleting) return ACT_DELETING;
        if (item.node.decommissioned) return '';
        if (item.node.decommissioning) return ACT_DECOMMISSIONING;
        if (item.node.migrating_to_pool) return ACT_MIGRATING;
        if (!item.online) return ACT_RESTORING;
        return '';
    }

    _update_data_activity_stage(item, now) {
        const act = item.data_activity;

        if (now < item.node.heartbeat + config.REBUILD_NODE_OFFLINE_GRACE) {
            if (act.reason === ACT_RESTORING) {
                dbg.log0('_update_data_activity_stage: WAIT OFFLINE THRESHOLD',
                    item.node.name, act);
                act.stage = {
                    name: STAGE_OFFLINE_GRACE,
                    time: {
                        start: item.node.heartbeat,
                        end: item.node.heartbeat + config.REBUILD_NODE_OFFLINE_GRACE,
                    },
                    size: {},
                };
                return;
            }
        } else if (act.stage && act.stage.name === STAGE_OFFLINE_GRACE) {
            dbg.log0('_update_data_activity_stage: PASSED OFFLINE THRESHOLD',
                item.node.name, act);
            // nullify to reuse the code that init right next
            act.stage = null;
        }

        if (!act.stage) {
            dbg.log0('_update_data_activity_stage: START REBUILDING',
                item.node.name, act);
            act.stage = {
                name: STAGE_REBUILDING,
                time: {
                    start: now
                },
                size: {
                    total: item.node.storage.used,
                    remaining: item.node.storage.used,
                    completed: 0
                }
            };
            return;
        }

        if (!act.stage.done) return;

        if (act.stage.name === STAGE_REBUILDING) {
            dbg.log0('_update_data_activity_stage: DONE REBUILDING',
                item.node.name, act);
            if (act.reason !== ACT_RESTORING) {
                act.stage = {
                    name: STAGE_WIPING,
                    time: {
                        start: now,
                    },
                    size: {
                        total: item.node.storage.used,
                        remaining: item.node.storage.used,
                        completed: 0,
                    },
                };
            }
            return;
        }

        if (act.stage.name === STAGE_WIPING) {
            dbg.log0('_update_data_activity_stage: DONE WIPING', item.node.name, act);
            if (item.node.migrating_to_pool) {
                delete item.node.migrating_to_pool;
            }
            if (item.node.decommissioning) {
                item.node.decommissioned = Date.now();
            }
            if (item.node.deleting) {
                item.node.deleted = Date.now();
            }
            act.done = true;
        }
    }

    _update_data_activity_progress(item, now) {
        const act = item.data_activity;

        if (act.stage && act.stage.size) {
            act.stage.size.remaining = Math.max(0,
                act.stage.size.total - act.stage.size.completed);
            const completed_time = now - act.stage.time.start;
            const remaining_time = act.stage.size.remaining *
                completed_time / act.stage.size.completed;
            act.stage.time.end = now + remaining_time;
        }

        act.time = act.time || {};
        act.time.start = act.time.start || now;
        // TODO estimate all stages
        act.time.end = act.stage.time.end;

        if (act.time.end) {
            act.progress = Math.min(1, Math.max(0,
                (now - act.time.start) / (act.time.end - act.time.start)
            ));
        } else {
            act.progress = 0;
        }
    }

    _update_data_activity_schedule(item) {
        const act = item.data_activity;

        if (!act || act.done) {
            item.data_activity = null;
            this._set_need_rebuild.delete(item);
            this._set_need_update.add(item);
            return;
        }

        if (system_server_utils.system_in_maintenance(item.node.system)) {
            dbg.warn('_update_status: delay node data_activity',
                'while system in maintenance', item.node.name);
            act.stage.wait_reason = WAIT_SYSTEM_MAINTENANCE;
            this._set_need_rebuild.delete(item);
            return;
        }

        if (act.stage.name === STAGE_REBUILDING) {
            if (!act.running) {
                setTimeout(() => {
                    this._set_need_rebuild.add(item);
                    this._wakeup_rebuild();
                }, config.REBUILD_BATCH_DELAY).unref();
            }
        }

        if (act.stage.name === STAGE_WIPING) {
            if (!item.online) {
                act.stage.wait_reason = WAIT_NODE_OFFLINE;
                this._set_need_rebuild.delete(item);
            } else if (!act.running) {
                setTimeout(() => {
                    this._set_need_rebuild.add(item);
                    this._wakeup_rebuild();
                }, config.REBUILD_BATCH_DELAY).unref();
            }
        }
    }

    _wakeup_rebuild() {
        const count = Math.min(
            config.REBUILD_NODE_CONCURRENCY,
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
        act.running = true;
        dbg.log0('_rebuild_node: start', item.node.name, act);
        return P.resolve()
            .then(() => md_store.iterate_node_chunks(
                item.node.system,
                item.node._id,
                act.stage.marker,
                config.REBUILD_BATCH_SIZE))
            .then(res => {
                act.stage.marker = res.marker;
                act.stage.size.completed += res.blocks_size;
                const builder = new MapBuilder(res.chunks);
                return builder.run();
            })
            .then(() => {
                act.running = false;
                if (!act.stage.marker) {
                    if (act.stage.rebuild_had_errors) {
                        dbg.log0('_rebuild_node: HAD ERRORS. RESTART', item.node.name, act);
                        act.stage.rebuild_had_errors = false;
                        act.stage.size.completed = 0;
                    } else {
                        act.stage.done = true;
                        dbg.log0('_rebuild_node: DONE', item.node.name, act);
                    }
                }
                this._update_data_activity(item);
            })
            .catch(err => {
                act.running = false;
                dbg.warn('_rebuild_node: ERROR', item.node.name, err.stack || err);
                act.stage.rebuild_had_errors = true;
                this._update_data_activity(item);
            });
    }


    _filter_nodes(query) {
        const list = [];
        const filter_counts = {
            count: 0,
            online: 0,
            has_issues: 0,
        };

        // we are generating a function that will implement most of the query
        // so that we can run it on every node item, and minimize the compare work.
        let code = '';
        if (query.system) {
            code += `if ('${query.system}' !== String(item.node.system)) return false; `;
        }
        if (query.pools) {
            code += `if (!(String(item.node.pool) in { `;
            for (const pool_id of query.pools) {
                code += `'${pool_id}': 1, `;
            }
            code += ` })) return false; `;
        }
        if (query.filter) {
            code += `if (!${query.filter}.test(item.node.name) &&
                !${query.filter}.test(item.node.ip)) return false; `;
        }
        if (query.geolocation) {
            code += `if (!${query.geolocation}.test(item.node.geolocation)) return false; `;
        }
        if (query.skip_address) {
            code += `if ('${query.skip_address}' === item.node.rpc_address) return false; `;
        }
        if (query.skip_cloud_nodes) {
            code += `if (item.node.is_cloud_node) return false; `;
        }
        if (query.skip_internal) {
            code += `if (item.node.is_internal_node) return false; `;
        }
        for (const field of QUERY_FIELDS) {
            const value = query[field.query];
            if (_.isUndefined(value)) continue;
            if (field.type === 'Boolean') {
                code += `if (${value} !== Boolean(${field.item})) return false; `;
            } else if (field.type === 'String') {
                code += `if ('${value}' !== String(${field.item})) return false; `;
            }
        }
        code += `return true; `;
        // eslint-disable-next-line no-new-func
        const filter_item_func = new Function('item', code);

        const items = query.nodes ?
            new Set(_.map(query.nodes, node_identity =>
                this._get_node(node_identity, 'allow_offline', 'allow_missing'))) :
            this._map_node_id.values();
        for (const item of items) {
            if (!item) continue;
            // update the status of every node we go over
            this._update_status(item);
            if (!filter_item_func(item)) continue;

            // the filter_counts count nodes that passed all filters besides
            // the filters of online and has_issues filters
            // this is used for the frontend to show the total count even
            // when actually showing the filtered list of nodes with issues
            if (item.has_issues) filter_counts.has_issues += 1;
            if (item.online) filter_counts.online += 1;
            filter_counts.count += 1;

            // after counting, we can finally filter by
            if (!_.isUndefined(query.has_issues) &&
                query.has_issues !== Boolean(item.has_issues)) continue;
            if (!_.isUndefined(query.online) &&
                query.online !== Boolean(item.online)) continue;

            console.log('list_nodes: adding node', item.node.name);
            list.push(item);
        }
        return {
            list: list,
            filter_counts: filter_counts,
        };
    }

    _sort_nodes_list(list, options) {
        if (!options || !options.sort) return;
        if (options.sort === 'name') {
            list.sort(js_utils.sort_compare_by(item => String(item.node.name), options.order));
        } else if (options.sort === 'ip') {
            list.sort(js_utils.sort_compare_by(item => String(item.node.ip), options.order));
        } else if (options.sort === 'has_issues') {
            list.sort(js_utils.sort_compare_by(item => Boolean(item.has_issues), options.order));
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

    _suggest_pool_assign() {
        // prepare nodes data per pool
        const pools_data_map = new Map();
        for (const item of this._map_node_id.values()) {
            item.suggested_pool = ''; // reset previous suggestion
            const node_id = String(item.node._id);
            const pool_id = String(item.node.pool);
            const pool = system_store.data.get_by_id(pool_id);
            dbg.log0('_suggest_pool_assign: node', item.node.name, 'pool', pool && pool.name);
            if (!pool) continue;
            let pool_data = pools_data_map.get(pool_id);
            if (!pool_data) {
                pool_data = {
                    pool_id: pool_id,
                    pool_name: pool.name,
                    docs: []
                };
                pools_data_map.set(pool_id, pool_data);
            }

            // cannot use numbers as dclassify tokens only discrete strings,
            // so we have to transform numbers to some relevant tokens
            const tokens = [];
            if (item.node.ip) {
                const x = item.node.ip.split('.');
                if (x.length === 4) {
                    tokens.push('ip:' + x[0] + '.x.x.x');
                    tokens.push('ip:' + x[0] + '.' + x[1] + '.x.x');
                    tokens.push('ip:' + x[0] + '.' + x[1] + '.' + x[2] + '.x');
                    tokens.push('ip:' + x[0] + '.' + x[1] + '.' + x[2] + '.' + x[3]);
                }
            }
            if (item.node.os_info) {
                tokens.push('platform:' + item.node.os_info.platform);
                tokens.push('arch:' + item.node.os_info.arch);
                tokens.push('totalmem:' + scale_size_token(item.node.os_info.totalmem));
            }
            if (_.isNumber(item.avg_ping)) {
                tokens.push('avg_ping:' + scale_number_token(item.avg_ping));
            }
            if (_.isNumber(item.avg_disk_read)) {
                tokens.push('avg_disk_read:' + scale_number_token(item.avg_disk_read));
            }
            if (_.isNumber(item.avg_disk_write)) {
                tokens.push('avg_disk_write:' + scale_number_token(item.avg_disk_write));
            }
            if (item.node.storage && _.isNumber(item.node.storage.total)) {
                const storage_other =
                    item.node.storage.total -
                    item.node.storage.used -
                    item.node.storage.free;
                tokens.push('storage_other:' + scale_size_token(storage_other));
                tokens.push('storage_total:' + scale_size_token(item.node.storage.total));
            }
            pool_data.docs.push(new dclassify.Document(node_id, tokens));
        }

        // take the data of all the pools without the default_pool
        // and use it to train a classifier of nodes to pools
        const data_set = new dclassify.DataSet();
        const classifier = new dclassify.Classifier({
            applyInverse: true
        });
        let num_trained_pools = 0;
        for (const pool_data of pools_data_map.values()) {
            if (pool_data.pool_name === 'default_pool') continue;
            dbg.log0('_suggest_pool_assign: add to data set',
                pool_data.pool_name, pool_data.docs);
            data_set.add(pool_data.pool_name, pool_data.docs);
            num_trained_pools += 1;
        }
        if (num_trained_pools <= 0) {
            dbg.log0('_suggest_pool_assign: no pools to suggest');
            return;
        } else if (num_trained_pools === 1) {
            // the classifier requires at least two options to work
            dbg.log0('_suggest_pool_assign: only one pool to suggest,',
                'too small for real suggestion');
            return;
        }
        classifier.train(data_set);
        dbg.log0('_suggest_pool_assign: Trained:', classifier,
            'probabilities', JSON.stringify(classifier.probabilities));

        // for nodes in the default_pool use the classifier to suggest a pool
        for (const pool_data of pools_data_map.values()) {
            if (pool_data.pool_name !== 'default_pool') continue;
            for (const doc of pool_data.docs) {
                const item = this._map_node_id.get(doc.id);
                dbg.log0('_suggest_pool_assign: classify start', item.node.name, doc);
                const res = classifier.classify(doc);
                dbg.log0('_suggest_pool_assign: classify result', item.node.name, res);
                if (res.category !== 'default_pool') {
                    item.suggested_pool = res.category;
                } else if (res.secondCategory !== 'default_pool') {
                    item.suggested_pool = res.secondCategory;
                }
            }
        }
    }

    list_nodes(query, options) {
        console.log('list_nodes: query', query);
        this._throw_if_not_started_and_loaded();
        const filter_res = this._filter_nodes(query);
        const list = filter_res.list;
        this._sort_nodes_list(list, options);
        const res_list = options && options.pagination ?
            this._paginate_nodes_list(list, options) : list;
        console.log('list_nodes', res_list.length, '/', list.length);

        return {
            total_count: list.length,
            filter_counts: filter_res.filter_counts,
            nodes: _.map(res_list, item =>
                this._get_node_info(item, options && options.fields)),
        };
    }

    _aggregate_nodes_list(list) {
        let count = 0;
        let online = 0;
        let has_issues = 0;
        const storage = {
            total: BigInteger.zero,
            free: BigInteger.zero,
            used: BigInteger.zero,
            reserved: BigInteger.zero,
            unavailable_free: BigInteger.zero,
            used_other: BigInteger.zero,
        };
        _.each(list, item => {
            count += 1;
            if (item.online) online += 1;
            if (item.has_issues) {
                has_issues += 1;
            }

            item.node.storage.free = Math.max(item.node.storage.free, 0);
            // for internal agents set reserve to 0
            let reserve = item.node.is_internal_node ? 0 : config.NODES_FREE_SPACE_RESERVE;

            const free_considering_reserve =
                new BigInteger(item.node.storage.free || 0)
                .minus(reserve);
            if (free_considering_reserve.greater(0)) {
                if (item.has_issues) {
                    storage.unavailable_free = storage.unavailable_free
                        .plus(free_considering_reserve);
                } else {
                    storage.free = storage.free
                        .plus(free_considering_reserve);
                }
                storage.reserved = storage.reserved
                    .plus(reserve || 0);
            } else {
                storage.reserved = storage.reserved
                    .plus(item.node.storage.free || 0);
            }
            storage.total = storage.total
                .plus(item.node.storage.total || 0);
            storage.used = storage.used
                .plus(item.node.storage.used || 0);
        });
        storage.used_other = BigInteger.max(0,
            storage.total
            .minus(storage.used)
            .minus(storage.reserved)
            .minus(storage.free)
            .minus(storage.unavailable_free));
        return {
            nodes: {
                count: count,
                online: online,
                has_issues: has_issues,
            },
            storage: size_utils.to_bigint_storage(storage)
        };
    }

    aggregate_nodes(query, group_by) {
        this._throw_if_not_started_and_loaded();
        const list = this._filter_nodes(query).list;
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

    _get_node_info(item, fields) {
        const node = item.node;
        const info = _.defaults(
            _.pick(item, MONITOR_INFO_FIELDS),
            _.pick(node, NODE_INFO_FIELDS),
            NODE_INFO_DEFAULTS);
        info._id = String(node._id);
        info.peer_id = String(node.peer_id);
        info.pool = system_store.data.get_by_id(node.pool).name;
        if (node.is_internal_node) info.demo_node = true;
        const act = item.data_activity;
        if (act && !act.done) {
            info.data_activity = _.pick(act,
                'reason',
                'progress',
                'time');
            info.data_activity.stage = _.pick(act.stage,
                'name',
                'time',
                'size',
                'wait_reason');
        }
        info.storage = get_storage_info(node.storage, /*ignore_reserve=*/ node.is_internal_node);
        info.drives = _.map(node.drives, drive => ({
            mount: drive.mount,
            drive_id: drive.drive_id,
            storage: get_storage_info(drive.storage, /*ignore_reserve=*/ node.is_internal_node)
        }));
        info.os_info = _.defaults({}, node.os_info);
        if (info.os_info.uptime) {
            info.os_info.uptime = new Date(info.os_info.uptime).getTime();
        }
        if (info.os_info.last_update) {
            info.os_info.last_update = new Date(info.os_info.last_update).getTime();
        }

        return fields ? _.pick(info, '_id', fields) : info;
    }

    _get_node(node_identity, allow_offline, allow_missing) {
        if (!this._loaded) throw new RpcError('MONITOR_NOT_LOADED');
        let item;
        if (node_identity.id) {
            item = this._map_node_id.get(String(node_identity.id));
        } else if (node_identity.name) {
            item = this._map_node_name.get(String(node_identity.name));
        } else if (node_identity.peer_id) {
            item = this._map_peer_id.get(String(node_identity.peer_id));
        } else if (node_identity.rpc_address) {
            item = this._map_peer_id.get(node_identity.rpc_address.slice('n2n://'.length));
        }
        if (!item && allow_missing !== 'allow_missing') {
            dbg.log0('Nodes ids:', Array.from(this._map_node_id.keys()));
            dbg.log0('Nodes names:', Array.from(this._map_node_name.keys()));
            throw new RpcError('NO_SUCH_NODE',
                'No node ' + JSON.stringify(node_identity));
        }
        if (item && !item.connection && allow_offline !== 'allow_offline') {
            throw new RpcError('NODE_OFFLINE',
                'Node is offline ' + JSON.stringify(node_identity));
        }
        return item;
    }

    /**
     * n2n_signal sends an n2n signal to the target node,
     * and returns the reply to the source node,
     * in order to assist with n2n ICE connection establishment between two nodes.
     */
    n2n_signal(signal_params) {
        dbg.log1('n2n_signal:', signal_params.target);
        this._throw_if_not_started_and_loaded();
        const item = this._get_node({
            rpc_address: signal_params.target
        });
        if (!item) {
            // TODO do the hockey pocky in the cluster like was in redirector
        }
        return this.client.agent.n2n_signal(signal_params, {
            connection: item.connection,
        });
    }

    /**
     * n2n_proxy sends an rpc call to the target node like a proxy.
     */
    n2n_proxy(proxy_params) {
        dbg.log3('n2n_proxy: target', proxy_params.target,
            'call', proxy_params.method_api + '.' + proxy_params.method_name,
            'params', proxy_params.request_params);
        this._throw_if_not_started_and_loaded();

        const item = this._get_node({
            rpc_address: proxy_params.target
        });
        const api = proxy_params.method_api.slice(0, -4); //Remove _api suffix
        const method_name = proxy_params.method_name;
        const method = server_rpc.rpc.schema[proxy_params.method_api].methods[method_name];
        if (method.params_import_buffers) {
            // dbg.log5('n2n_proxy: params_import_buffers', proxy_params);
            method.params_import_buffers(proxy_params.request_params, proxy_params.proxy_buffer);
        }

        return this.client[api][method_name](proxy_params.request_params, {
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

    test_node_network(self_test_params) {
        dbg.log0('test_node_network:', self_test_params);
        this._throw_if_not_started_and_loaded();
        const item = this._get_node({
            rpc_address: self_test_params.source
        });
        return this.client.agent.test_network_perf_to_peer(self_test_params, {
            connection: item.connection,
        });
    }

    collect_agent_diagnostics(node_identity) {
        this._throw_if_not_started_and_loaded();
        const item = this._get_node(node_identity);
        return server_rpc.client.agent.collect_diagnostics(undefined, {
            connection: item.connection,
        });
    }

    set_debug_node(req) {
        this._throw_if_not_started_and_loaded();
        const debug_level = req.rpc_params.level;
        const node_identity = req.rpc_params.node;
        const item = this._get_node(node_identity);
        return P.resolve()
            .then(() => {
                item.node.debug_level = debug_level;
                this._set_need_update.add(item);
                return server_rpc.client.agent.set_debug_node({
                    level: debug_level
                }, {
                    connection: item.connection,
                });
            })
            .then(() => {
                Dispatcher.instance().activity({
                    system: req.system._id,
                    level: 'info',
                    event: 'dbg.set_debug_node',
                    actor: req.account && req.account._id,
                    node: item.node._id,
                    desc: `${item.node.name} debug level was raised by ${req.account && req.account.email}`,
                });
                dbg.log1('set_debug_node was successful for agent', item.node.name,
                    'level', debug_level);
            });
    }

    allocate_nodes(params) {
        this._throw_if_not_started_and_loaded();
        const pool_id = String(params.pool_id);
        const list = [];
        for (const item of this._map_node_id.values()) {
            this._update_status(item);
            if (!item.writable) continue;
            if (String(item.node.pool) !== String(pool_id)) continue;
            list.push(item);
        }
        list.sort(js_utils.sort_compare_by(item => item.node.storage.used, 1));
        const max = 1000;
        const res_list = list.length < max ? list : list.slice(0, max);
        return {
            nodes: _.map(res_list, item => this._get_node_info(item, params.fields))
        };
    }

    report_error_on_node_blocks(params) {
        this._throw_if_not_started_and_loaded();
        for (const block_report of params.blocks_report) {
            const node_id = block_report.block_md.node;
            const item = this._get_node({
                id: node_id
            }, 'allow_offline', 'allow_missing');
            if (!item) {
                dbg.warn('report_error_on_node_blocks: node not found for block',
                    block_report);
                continue;
            }
            // mark the issue on the node
            item.node.issues_report = item.node.issues_report || [];
            item.node.issues_report.push({
                time: Date.now(),
                action: block_report.action,
                reason: block_report.rpc_code || ''
            });
            // TODO pack issues_report by action and reason, instead of naive
            while (item.node.issues_report.length > 20) {
                const oldest = item.node.issues_report.shift();
                const first = item.node.issues_report[0];
                first.count = (first.count || 0) + 1;
                if (!first.count_since ||
                    first.count_since > oldest.time) {
                    first.count_since = oldest.time;
                }
            }
            dbg.log0('report_error_on_node_blocks:',
                'node', item.node.name,
                'issues_report', item.node.issues_report,
                'block_report', block_report);
            // disconnect from the node to force reconnect
            this._set_connection(item, null);
        }
    }

}


function get_storage_info(storage, ignore_reserve) {
    let reply = {
        total: storage.total || 0,
        free: Math.max(storage.free || 0, 0),
        used: storage.used || 0,
        alloc: storage.alloc || 0,
        limit: storage.limit || 0,
        reserved: config.NODES_FREE_SPACE_RESERVE || 0,
        used_other: storage.used_other || 0
    };

    reply.reserved = ignore_reserve ? 0 : Math.min(config.NODES_FREE_SPACE_RESERVE, reply.free);
    reply.free -= reply.reserved;
    reply.used_other = Math.max(reply.total - reply.used - reply.reserved - reply.free, 0);
    return reply;
}

function scale_number_token(num) {
    return Math.pow(2, Math.round(Math.log2(num)));
}

function scale_size_token(size) {
    const scaled = Math.max(scale_number_token(size), size_utils.GIGABYTE);
    return size_utils.human_size(scaled);
}

// EXPORTS
exports.NodesMonitor = NodesMonitor;
