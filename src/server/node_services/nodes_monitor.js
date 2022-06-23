/* Copyright (C) 2016 NooBaa */
/* eslint max-lines: ['error', 4000], complexity: ['error', 70] */
'use strict';

const _ = require('lodash');
const url = require('url');
const chance = require('chance')();
// const dclassify = require('dclassify');
const EventEmitter = require('events').EventEmitter;

const kmeans = require('../../util/kmeans');
const P = require('../../util/promise');
const api = require('../../api');
const pkg = require('../../../package.json');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const js_utils = require('../../util/js_utils');
const MDStore = require('../object_services/md_store').MDStore;
const Semaphore = require('../../util/semaphore');
const NodesStore = require('./nodes_store').NodesStore;
const IoStatsStore = require('../analytic_services/io_stats_store').IoStatsStore;
const size_utils = require('../../util/size_utils');
const BigInteger = size_utils.BigInteger;
const Dispatcher = require('../notifications/dispatcher');
const server_rpc = require('../server_rpc');
const prom_reporting = require('../analytic_services/prometheus_reporting');
const auth_server = require('../common_services/auth_server');
const system_store = require('../system_services/system_store').get_instance();
const os_utils = require('../../util/os_utils');
const clustering_utils = require('../utils/clustering_utils');
const system_utils = require('../utils/system_utils');
const net_utils = require('../../util/net_utils');
const addr_utils = require('../../util/addr_utils');
const { RpcError, RPC_BUFFERS } = require('../../rpc');

const RUN_DELAY_MS = 60000;
const RUN_NODE_CONCUR = 5;
const MAX_NUM_LATENCIES = 20;
const UPDATE_STORE_MIN_ITEMS = 30;
const AGENT_HEARTBEAT_GRACE_TIME = 10 * 60 * 1000; // 10 minutes grace period before an agent is consideref offline
const CLOUD_ALERT_GRACE_TIME = 3 * 60 * 1000; // 3 minutes grace period before dispatching alert on cloud node status
const AGENT_RESPONSE_TIMEOUT = 1 * 60 * 1000;
const AGENT_TEST_CONNECTION_TIMEOUT = 10 * 1000;
const NO_NAME_PREFIX = 'a-node-has-no-name-';
const STORE_PERF_TEST_INTERVAL = 60 * 60 * 1000; // perform test_store_perf every 1 hour

const AGENT_INFO_FIELDS = [
    'version',
    'ip',
    'base_address',
    'rpc_address',
    'public_ip',
    'enabled',
    'geolocation',
    'storage',
    'drives',
    'os_info',
    'debug_level',
    'is_internal_agent',
    'node_type',
    'host_name',
    'permission_tempering',
    'mem_usage',
    'cpu_usage',
];
const MONITOR_INFO_FIELDS = [
    'has_issues',
    'online',
    'readable',
    'writable',
    'trusted',
    'mode',
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
    'node_type',
    'is_mongo_node',
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

const MODE_COMPARE_ORDER = [
    'OPTIMAL',
    'LOW_CAPACITY',
    'NO_CAPACITY',
    'DECOMMISSIONING',
    'MIGRATING',
    'DELETING',
    'DECOMMISSIONED',
    'STORAGE_NOT_EXIST',
    'IO_ERRORS',
    'N2N_ERRORS',
    'GATEWAY_ERRORS',
    'IN_PROCESS',
    'SOME_STORAGE_MIGRATING',
    'SOME_STORAGE_INITIALIZING',
    'SOME_STORAGE_DECOMMISSIONING',
    'SOME_STORAGE_OFFLINE',
    'SOME_STORAGE_NOT_EXISTS',
    'SOME_STORAGE_IO_ERRORS',
    'AUTH_FAILED', // authentication to cloud storage failed
    'DELETED',
    'N2N_ERRORS',
    'GATEWAY_ERRORS',
    'IO_ERRORS',
    'UNTRUSTED',
    'INITIALIZING',
    'OFFLINE'
];

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
        this.client = server_rpc.rpc.new_client({ auth_token: server_rpc.client.options.auth_token });
        this._started = false;
        this._loaded = false;
        this._num_running_rebuilds = 0;
        this._run_serial = new Semaphore(1);
        this._update_nodes_store_serial = new Semaphore(1);

        // This is used in order to test n2n connection from node_monitor to agents
        this.n2n_rpc = api.new_rpc();
        this.n2n_client = this.n2n_rpc.new_client({ auth_token: server_rpc.client.options.auth_token });
        this.n2n_agent = this.n2n_rpc.register_n2n_agent((...args) => this.n2n_client.node.n2n_signal(...args));
        this._host_sequence_number = 0;
        // Notice that this is a mock up address just to ensure n2n connection authorization
        this.n2n_agent.set_rpc_address('n2n://nodes_monitor');
    }

    async start() {
        if (this._started) {
            dbg.log2('NodesMonitor already started returning.');
            return;
        }
        dbg.log0('starting nodes_monitor');
        this._started = true;
        this.n2n_rpc.set_disconnected_state(false);
        await this._load_from_store();

        // initialize nodes stats in prometheus
        if (config.PROMETHEUS_ENABLED && system_store.data.systems[0]) {
            let nodes_stats = await this._get_nodes_stats_by_service(
                system_store.data.systems[0]._id,
                0,
                Date.now(),
                /* include_kubernetes */
                true
            );
            nodes_stats.forEach(stats => {
                dbg.log0(`resetting stats in prometheus:`, stats);
                const core_report = prom_reporting.get_core_report();
                core_report.set_providers_ops(stats.service, stats.write_count, stats.read_count);
                core_report.set_providers_bandwidth(stats.service, stats.write_bytes, stats.read_bytes);
            });
        }

    }

    stop(force_close_n2n) {
        dbg.log0('stoping nodes_monitor');
        this._started = false;
        this.n2n_rpc.set_disconnected_state(true);
        if (force_close_n2n === 'force_close_n2n') {
            this.n2n_agent.disconnect();
        }
        this._close_all_nodes_connections();
        this._clear();
    }

    /**
     * sync_to_store is used for testing to get the info from all nodes
     */
    sync_to_store() {
        return P.resolve()
            .then(() => this._run())
            .then(() => {
                // do nothing. 
            });
    }

    async sync_storage_to_store() {
        const items = Array.from(this._map_node_id.values());
        for (const item of items) {
            if (item.node.deleted) continue;
            if (!item.connection) continue;
            if (!item.node_from_store) continue;

            const pool = system_store.data.get_by_id(item.node.pool);
            const available_capacity =
                pool &&
                pool.cloud_pool_info &&
                pool.cloud_pool_info.available_capacity;
            const info = await P.timeout(AGENT_RESPONSE_TIMEOUT,
                this.client.agent.get_agent_storage_info({
                    available_capacity
                }, {
                    connection: item.connection
                })
            );
            if (info.storage) {
                item.node.storage = info.storage;
                this._set_need_update.add(item);
                this._update_status(item);
            }
        }
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

        dbg.log0(`got heartbeat ${node_id ? 'for node_id ' + node_id : 'for a new node'} `);

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


        if (req.connection.item_name) {
            dbg.error(`connection is already used to connect an agent. name=${req.connection.item_name}`);
            throw new Error('connection is already used to connect an agent');
        }


        this._throw_if_not_started_and_loaded();

        // existing node heartbeat
        if (node_id && (req.role === 'agent' || req.role === 'admin')) {
            dbg.log0('connecting exiting node with node_id =', node_id);
            this._connect_node(req.connection, node_id);
            return reply;
        }

        // new node heartbeat
        // create the node and then update the heartbeat
        if (!node_id && (req.role === 'create_node' || req.role === 'admin')) {
            let agent_config = (extra.agent_config_id && system_store.data.get_by_id(extra.agent_config_id)) || {};
            this._add_new_node(req.connection, req.system._id, agent_config, req.rpc_params.pool_name);
            dbg.log0('connecting new node with agent_config =', {
                ...agent_config,
                system: agent_config.system && agent_config.system.name,
                pool: agent_config.pool && agent_config.pool.name
            });
            return reply;
        }

        dbg.error('heartbeat: BAD REQUEST', 'role', req.role, 'auth', req.auth);
        throw new RpcError('FORBIDDEN', 'Bad heartbeat request');
    }


    // test the passed node id, to verify that it's a valid node
    test_node_id(req) {
        // Deprecated
        // this case is handled in heartbeat flow. agent will clean itself when getting NODE_NOT_FOUND
        // although it is not used by agents in the current version, we need to leave this code for
        // cases where older versions of the agent call this function on startup.
        // we can remove it only after we no longer support versions that call test_node_id
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

    /**
     * read_host returns information about all nodes in one host
     */
    read_host(name) {
        this._throw_if_not_started_and_loaded();
        const host_nodes = this._get_host_nodes_by_name(name);
        return this._get_host_info(this._consolidate_host(host_nodes));
    }

    retrust_host(req) {
        this._throw_if_not_started_and_loaded();
        const host_nodes = this._get_host_nodes_by_name(req.rpc_params.name);
        const host_item = this._consolidate_host(host_nodes);
        return P.map(host_nodes, node => this._retrust_node(node))
            .then(() => this._dispatch_node_event(host_item, 'retrust',
                `Node ${this._item_hostname(host_item)} in pool ${this._item_pool_name(host_item)} was set as trusted by ${req.account && req.account.email}`,
                req.account && req.account._id));
    }

    delete_host(req) {
        this._throw_if_not_started_and_loaded();
        const host_nodes = this._get_host_nodes_by_name(req.rpc_params.name);
        const host_item = this._consolidate_host(host_nodes);
        return P.map(host_nodes, node => this._delete_node(node))
            .then(() => this._dispatch_node_event(host_item, 'delete_started',
                `Node ${this._item_hostname(host_item)} deletion process was initiated by ${req.account && req.account.email}.
                The node will be deleted from ${this._item_pool_name(host_item)} once all stored data is secured`,
                req.account && req.account._id));
    }

    _hide_host(host_nodes) {
        const host_item = this._consolidate_host(host_nodes);
        if (_.some(host_nodes, node => node.force_hide)) return;
        return P.resolve()
            .then(() => _.each(host_nodes, node => this._hide_node(node)))
            .then(() => this._update_nodes_store('force'))
            .then(() => {
                this._dispatch_node_event(host_item, 'deleted',
                    `Node ${this._item_hostname(host_item)} in pool ${this._item_pool_name(host_item)} is successfully deleted`);
                if (!host_item.online) {
                    Dispatcher.instance().alert('INFO',
                        system_store.data.systems[0]._id,
                        `Node  ${this._item_hostname(host_item)} was marked for deletion, data on it could not be wiped since the node was offline`);
                }
            });
    }

    delete_node(node_identity) {
        this._throw_if_not_started_and_loaded();
        const item = this._get_node(node_identity, 'allow_offline');
        return this._delete_node(item);
    }

    decommission_node(req) {
        this._throw_if_not_started_and_loaded();
        const item = this._get_node(req.rpc_params, 'allow_offline');

        if (item.node.decommissioned || item.node.decommissioning) {
            return;
        }

        return P.resolve()
            .then(() => {
                this._set_decommission(item);
                return this._update_nodes_store('force');
            })
            .then(() => {
                this._dispatch_node_event(item, 'decommission',
                    `Drive ${this._item_drive_description(item)} was deactivated by ${req.account && req.account.email}`,
                    req.account && req.account._id
                );
            });

    }

    recommission_node(req) {
        this._throw_if_not_started_and_loaded();
        const item = this._get_node(req.rpc_params, 'allow_offline');

        if (!item.node.decommissioned && !item.node.decommissioning) {
            return;
        }

        return P.resolve()
            .then(() => {
                this._clear_decommission(item);
                return this._update_nodes_store('force');
            })
            .then(() => {
                this._dispatch_node_event(item, 'recommission',
                    `Drive ${this._item_drive_description(item)} was reactivated by ${req.account && req.account.email}`,
                    req.account && req.account._id
                );
            });

    }

    update_nodes_services(req) {
        this._throw_if_not_started_and_loaded();
        const { name, services, nodes } = req.rpc_params;
        if (services && nodes) throw new Error('Request cannot specify both services and nodes');
        if (!services && !nodes) throw new Error('Request must specify services or nodes');

        const host_nodes = this._get_host_nodes_by_name(name);

        let updates;
        if (services) {
            const { storage: storage_enabled } = services;
            updates = host_nodes.map(item => ({
                    item: item,
                    enabled: storage_enabled
                }))
                .filter(item => !_.isUndefined(item.enabled));

            if (!_.isUndefined(storage_enabled)) {
                this._dispatch_node_event(
                    host_nodes[0],
                    storage_enabled ? 'storage_enabled' : 'storage_disabled',
                    `Storage service was ${storage_enabled ? 'enabled' : 'disabled'} on node ${this._item_hostname(host_nodes[0])} by ${req.account && req.account.email}`,
                    req.account && req.account._id
                );
            }
        } else {
            updates = nodes.map(update => ({
                item: this._map_node_name.get(update.name),
                enabled: update.enabled
            }));
        }

        const activated = [];
        const deactivated = [];
        updates.forEach(update => {
            const { decommissioned, decommissioning } = update.item.node;
            if (update.enabled) {
                if (!decommissioned && !decommissioning) return;
                this._clear_decommission(update.item);
                activated.push(update.item);
            } else {
                if (decommissioned || decommissioning) return;
                this._set_decommission(update.item);
                deactivated.push(update.item);
            }
        });

        if (!services && (activated.length || deactivated.length)) {
            // if updating specific drives generate an event
            const num_updates = activated.length + deactivated.length;
            const activated_desc = activated.length ?
                'Activated Drives:\n' + activated.map(item => this._item_drive_description(item)).join('\n') + '\n' : '';
            const deactivated_desc = deactivated.length ?
                'Deactivated Drives:\n' + deactivated.map(item => this._item_drive_description(item)).join('\n') : '';
            const description = `${num_updates} ${num_updates > 1 ? 'drives were' : 'drive was'} edited by ${req.account && req.account.email}\n` +
                activated_desc + deactivated_desc;

            this._dispatch_node_event(
                host_nodes[0],
                'edit_drives',
                description,
                req.account && req.account._id
            );
        }

        return this._update_nodes_store('force');
    }

    get_node_ids(req) {
        const { identity, by_host } = req.rpc_params;
        if (by_host) {
            return this._get_host_nodes_by_name(identity).map(item => String(item.node._id));
        } else {
            const item = this._get_node({ name: identity }, 'allow_offline');
            return [String(item.node._id)];
        }
    }

    ///////////////////
    // INTERNAL IMPL //
    ///////////////////


    _clear() {
        this._loaded = false;
        this._map_node_id = new Map();
        this._map_peer_id = new Map();
        this._map_node_name = new Map();
        this._map_host_id = new Map();
        this._map_host_seq_num = new Map();
        this._set_need_update = new Set();
        this._set_need_rebuild = new Set();
        this._set_need_rebuild_iter = null;
        this._host_sequence_number = 0;
    }

    _throw_if_not_started_and_loaded() {
        if (!this._started) throw new RpcError('MONITOR_NOT_STARTED');
        if (!this._loaded) throw new RpcError('MONITOR_NOT_LOADED');
    }

    _load_from_store() {
        if (!this._started) return;
        if (!NodesStore.instance().is_connected()) {
            dbg.log0('_load_from_store not yet connected');
            return P.delay(1000).then(() => this._load_from_store());
        }
        dbg.log0('_load_from_store ...');
        return P.resolve()
            .then(() => NodesStore.instance().find_nodes({ deleted: null }))
            .then(nodes => {
                if (!this._started) return;
                this._clear();
                // restore host sequence number by iterating nodes and finding the largest host_sequence
                for (const node of nodes) {
                    this._host_sequence_number = Math.max(this._host_sequence_number, node.host_sequence || 0);
                }
                dbg.log0(`restored _host_sequence_number = ${this._host_sequence_number}`);
                for (const node of nodes) {
                    this._add_existing_node(node);
                }
                this._loaded = true;
                // delay a bit before running to allow nodes to reconnect
                this._schedule_next_run(3000);
            })
            .catch(err => {
                dbg.log0('_load_from_store ERROR', err.stack || err);
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
        if (node.host_id) {
            this._add_node_to_hosts_map(node.host_id, item);
            if (!item.node.host_sequence) {
                item.node.host_sequence = this._get_host_sequence_number(node.host_id);
            }
            // set _host_sequence_number to the largest one
            this._map_host_seq_num.set(String(item.node.host_sequence), node.host_id);
        }
        this._set_node_defaults(item);
    }

    _add_new_node(conn, system_id, agent_config, pool_name) {
        const system = system_store.data.get_by_id(system_id);
        const pool =
            agent_config.pool ||
            system.pools_by_name[pool_name] ||
            _.filter(system.pools_by_name, p => (!_.get(p, 'mongo_pool_info') && (!_.get(p, 'cloud_pool_info'))))[0]; // default - the 1st host pool in the system
        // system_store.get_account_by_email(system.owner.email).default_resource; //This should not happen, but if it does, use owner's default

        if (!pool) {
            throw new Error('Cannot find eligible pool');
        }

        if (pool.system !== system) {
            throw new Error('Node pool must belong to system');
        }
        const now = Date.now();
        const hrtime = process.hrtime();
        const name = NO_NAME_PREFIX + now.toString(36) + ((hrtime[0] * 1e9) + hrtime[1]).toString(36);
        const item = {
            connection: null,
            node_from_store: null,
            node: _.omitBy({
                _id: NodesStore.instance().make_node_id(),
                peer_id: NodesStore.instance().make_node_id(),
                system: system._id,
                pool: pool._id,
                agent_config: agent_config._id,
                heartbeat: now,
                name,
            }, _.isUndefined),
        };

        if (pool.cloud_pool_info) {
            item.node.is_cloud_node = true;
        }
        if (pool.mongo_pool_info) {
            item.node.is_mongo_node = true;
        }

        dbg.log0('_add_new_node', item.node);
        this._set_need_update.add(item);
        this._add_node_to_maps(item);
        this._set_node_defaults(item);
        this._set_connection(item, conn);
    }

    _add_node_to_maps(item) {
        const node_id = String(item.node._id || '');
        const peer_id = String(item.node.peer_id || '');
        const name = String(item.node.name || '');

        const id_collision = this._map_node_id.get(node_id);
        if (id_collision && id_collision !== item) {
            dbg.error('NODE ID COLLISION', node_id, item, id_collision);
            throw new Error('NODE ID COLLISION ' + node_id);
        }
        const peer_id_collision = this._map_peer_id.get(peer_id);
        if (peer_id_collision && peer_id_collision !== item) {
            dbg.error('NODE PEER ID COLLISION', peer_id, item, peer_id_collision);
            throw new Error('NODE PEER ID COLLISION ' + peer_id);
        }
        const name_collision = this._map_node_name.get(name);
        if (name_collision && name_collision !== item) {
            dbg.error('NODE NAME COLLISION', name, item, name_collision);
            throw new Error('NODE NAME COLLISION ' + name);
        }

        this._map_node_id.set(node_id, item);
        this._map_peer_id.set(peer_id, item);
        this._map_node_name.set(name, item);
    }

    _add_node_to_hosts_map(host_id, item) {
        let host_nodes = this._map_host_id.get(host_id);
        if (!host_nodes) {
            this._map_host_id.set(host_id, host_nodes = []);
        }
        dbg.log1(`adding ${item.node.name} to hosts map with id ${host_id}. before adding, host_nodes are: ${host_nodes.map(i => i.node.name)}`);
        host_nodes.push(item);
    }

    _remove_node_to_hosts_map(host_id, item) {
        let host_nodes = this._map_host_id.get(host_id);
        if (host_nodes) {
            _.pull(host_nodes, item);
            if (!host_nodes.length) {
                this._map_host_id.delete(host_id);
                this._map_host_seq_num.delete(String(item.node.host_sequence));
            }
        }
    }

    _remove_node_from_maps(item) {
        this._map_node_id.delete(String(item.node._id));
        this._map_peer_id.delete(String(item.node.peer_id));
        this._map_node_name.delete(String(item.node.name));
        this._set_need_update.delete(item);
        this._remove_node_to_hosts_map(String(item.node.host_id), item);
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

    _get_nodes_by_host_id(host_id) {
        let host_nodes = this._map_host_id.get(host_id);
        if (!host_nodes) {
            throw new RpcError('BAD_REQUEST', 'No such host ' + host_id);
        }
        return host_nodes;
    }

    _get_host_nodes_by_name(name) {
        const [ /*hostname*/ , seq_str] = name.split('#');
        const host_id = this._map_host_seq_num.get(String(seq_str));
        if (!host_id) {
            dbg.warn(this._map_host_seq_num);
            throw new RpcError('BAD_REQUEST', `No such host ${name} - ${seq_str}`);
        }
        return this._get_nodes_by_host_id(host_id);
    }

    _connect_node(conn, node_id) {
        dbg.log0('_connect_node:', 'node_id', node_id);
        const item = this._map_node_id.get(String(node_id));
        if (!item) throw new RpcError('NODE_NOT_FOUND', node_id);
        this._set_connection(item, conn);
    }

    _close_all_nodes_connections() {
        if (!this._map_node_id) return;
        for (const item of this._map_node_id.values()) {
            this._close_node_connection(item);
        }
    }


    _close_node_connection(item) {
        if (!item.connection) return;
        dbg.warn('_close_node_connection', item.node.name, item.connection.connid);
        item.connection.close();
        item.connection = null;
        item.agent_info = null;
        item.node.rpc_address = '';
    }

    _disconnect_node(item) {
        item.disconnect_time = Date.now();
        this._close_node_connection(item);
        this._set_need_update.add(item);
        this._update_status(item);
    }

    _set_connection(item, conn) {
        if (item.connection === conn) return;
        this._check_duplicate_agent(item, conn);
        this._close_node_connection(item);
        conn.on('close', () => this._on_connection_close(item, conn));
        item.connection = conn;
        conn.item_name = item.node.name;
        item.node.heartbeat = Date.now();
        this._set_need_update.add(item);
        this._update_status(item);
        this._run_node_delayed(item);
    }

    _on_connection_close(item, conn) {
        dbg.warn('got close on node connection for', item.node.name,
            'conn', conn.connid,
            'active conn', item.connection && item.connection.connid);
        // if then connection was replaced ignore the close event
        conn.item_name = null;
        if (item.connection !== conn) return;
        this._disconnect_node(item);
    }

    _check_duplicate_agent(item, conn) {
        // make sure it is not a cloned agent. if the old connection is still connected
        // the assumption is that this is a duplicated agent. in that case throw an error
        if (item.connection && conn &&
            item.connection._state === 'connected' &&
            conn.url.hostname !== item.connection.url.hostname) {
            dbg.warn('DUPLICATE AGENT', item.node.name, item.connection.connid, conn.connid);
            throw new RpcError('DUPLICATE', 'agent appears to be duplicated - abort', false);
        }
    }

    _schedule_next_run(optional_delay_ms) {
        const delay_ms = Math.max(0, Math.min(RUN_DELAY_MS,
            optional_delay_ms || RUN_DELAY_MS));
        const now = Date.now();
        if (this._next_run_time &&
            this._next_run_time < now + delay_ms) {
            // nex run is already scheduled earlier than requested
            return;
        }
        clearTimeout(this._next_run_timeout);
        this._next_run_time = now + delay_ms;
        this._next_run_timeout = setTimeout(() => {
            clearTimeout(this._next_run_timeout);
            this._next_run_timeout = null;
            this._next_run_time = 0;
            P.resolve()
                .then(() => this._run())
                .finally(() => this._schedule_next_run());
        }, delay_ms).unref();
    }

    _run() {
        if (!this._started) return;
        return this._run_serial.surround(() => {
            dbg.log1('_run:', this._map_node_id.size, 'nodes in queue');
            let next = 0;
            const queue = Array.from(this._map_node_id.values());
            const concur = Math.min(queue.length, RUN_NODE_CONCUR);
            const worker = () => {
                if (next >= queue.length) return;
                const item = queue[next];
                next += 1;
                return this._run_node(item)
                    .catch(err => dbg.error('_run_node worker: ERROR', err.stack || err, 'node', item.node && item.node.name))
                    .then(worker);
            };
            return P.all(_.times(concur, worker))
                // .then(() => this._suggest_pool_assign()) // need to be rethinked - out for
                .then(() => this._update_nodes_store('force'))
                .catch(err => {
                    dbg.warn('_run: ERROR', err.stack || err);
                });
        });
    }

    _run_node(item) {
        if (!this._started) return P.reject(new Error('monitor has not started'));
        item._run_node_serial = item._run_node_serial || new Semaphore(1);
        if (item.node.deleted) return P.reject(new Error(`node ${item.node.name} is deleted`));
        return item._run_node_serial.surround(() =>
            P.resolve()
            .then(() => dbg.log1('_run_node:', item.node.name))
            .then(() => this._get_agent_info(item))
            .then(() => { //If internal or cloud resource, cut down initializing time (in update_rpc_config)
                if (!item.node_from_store && (item.node.is_mongo_node || item.node.is_cloud_node)) {
                    return this._update_nodes_store('force');
                }
            })
            .then(() => this._uninstall_deleting_node(item))
            .then(() => this._remove_hideable_nodes(item))
            .then(() => this._update_node_service(item))
            .then(() => this._update_create_node_token(item))
            .then(() => this._update_rpc_config(item))
            .then(() => this._test_nodes_validity(item))
            .then(() => this._update_status(item))
            .then(() => this._handle_issues(item))
            .then(() => this._update_nodes_store())
            .catch(err => {
                dbg.warn('_run_node: ERROR', err.stack || err, 'node', item.node);
            }));
    }

    _handle_issues(item) {
        if (item.node.permission_tempering &&
            !item.node_from_store.permission_tempering &&
            !item.permission_event) {
            item.permission_event = Date.now();
            this._dispatch_node_event(item, 'untrusted', `Node ${this._item_hostname(item)} in pool ${this._item_pool_name(item)} was set to untrusted due to permission tampering`);
        }
        if (_.some(item.node.issues_report, issue => issue.reason === 'TAMPERING') &&
            !_.some(item.node_from_store.issues_report, issue => issue.reason === 'TAMPERING') &&
            !item.data_event) {
            item.data_event = Date.now();
            this._dispatch_node_event(item, 'untrusted', `Node ${this._item_hostname(item)} in pool ${this._item_pool_name(item)} was set to untrusted due to data tampering`);
        }

        // for first run of the node don't send the event.
        // prevents blast of events if node_monitor is restarted and all nodes reconnects again.
        if (item.online !== item._dispatched_online &&
            !_.isUndefined(item.online) &&
            item.node_from_store &&
            item.node.node_type === 'BLOCK_STORE_FS' &&
            item.node.drives && item.node.drives.length) {

            if (!item.online && item._dispatched_online) {
                dbg.warn(`node ${item.node.name} became offline`);
                this._dispatch_node_event(item, 'disconnected', `Drive ${this._item_drive_description(item)} is offline`);
            } else if (item.online && !item._dispatched_online) {
                dbg.warn(`node ${item.node.name} is back online`);
                this._dispatch_node_event(item, 'connected', `Drive ${this._item_drive_description(item)} is online`);
            }
            item._dispatched_online = item.online;
        }

        if (this._is_cloud_node(item)) {
            let alert;
            const pool = system_store.data.get_by_id(item.node.pool);
            if (pool) {
                switch (item.mode) {
                    case 'IO_ERRORS':
                        alert = `Cloud resource ${pool.name} has read/write problems`;
                        break;
                    case 'AUTH_FAILED':
                        alert = `Authentication failed for cloud resource ${pool.name}`;
                        break;
                    case 'STORAGE_NOT_EXIST': {
                        const storage_container = item.node.node_type === 'BLOCK_STORE_S3' ? 'S3 bucket' : 'Azure container';
                        alert = `The target ${storage_container} does not exist for cloud resource ${pool.name}`;
                    }
                    break;
                    case 'OFFLINE':
                        alert = `Cloud resource ${pool.name} is offline`;
                        break;
                    default:
                        break;
                }

                if (alert) {
                    // if there is an alert wait some time before dispatching it
                    const now = Date.now();
                    if (item.dispatched_cloud_alert &&
                        now > item.dispatched_cloud_alert + CLOUD_ALERT_GRACE_TIME) {
                        // if grace time has passed cloud alert, dispatch it and reset indication
                        item.dispatched_cloud_alert = null;
                        this._cloud_node_alert(alert);
                    } else {
                        item.dispatched_cloud_alert = item.dispatched_cloud_alert || now;
                    }
                } else {
                    // no message. reset cloud alert indication
                    item.dispatched_cloud_alert = null;
                }
            }
        }
    }

    /**
     * In flows triggered from the agent heartbeat in which we wish to call _run_node
     * to update the state of the item, we should delay the run because it has to be sent
     * after the response of the heartbeat, to allow the agent to identify
     * the server connection properly.
     * The delay time itself does not matter much, just the order needs to be enforced.
     */
    _run_node_delayed(item) {
        return P.delay(100)
            .then(() => this._run_node(item));
    }


    _set_decommission(item) {
        if (!item.node.decommissioning) {
            item.node.decommissioning = Date.now();
        }
        this._set_need_update.add(item);
        this._update_status(item);
    }

    _clear_decommission(item) {
        delete item.node.decommissioning;
        delete item.node.decommissioned;
        this._set_need_update.add(item);
        this._update_status(item);
    }

    _clear_untrusted(item) {
        delete item.node.permission_tempering;
        item.permission_event = false;
        item.data_event = false;
        if (item.node.issues_report) {
            _.remove(item.node.issues_report, issue => issue.reason === 'TAMPERING');
        }
        if (_.isEmpty(item.node.issues_report)) delete item.node.issues_report;
        this._set_need_update.add(item);
        this._update_status(item);
    }

    _retrust_node(item) {
        if (!item.node.permission_tempering && !item.node.issues_report) {
            return;
        }
        return P.resolve()
            .then(() => {
                this._clear_untrusted(item);
                return this._update_nodes_store('force');
            });
    }

    _delete_node(item) {
        return P.resolve()
            .then(() => {
                if (!item.node.deleting) {
                    item.node.deleting = Date.now();
                }
                this._set_need_update.add(item);
                this._update_status(item);
            })
            .then(() => this._update_nodes_store('force'))
            .then(() => {
                // do nothing. 
            });
    }

    _hide_node(item) {
        item.node.force_hide = Date.now();
        this._set_need_update.add(item);
        this._update_status(item);
    }


    _get_agent_info(item) {
        if (item.node.deleted) return;
        if (!item.connection) return;
        dbg.log1('_get_agent_info:', item.node.name);
        let potential_masters = clustering_utils.get_potential_masters().map(addr => ({
            address: url.format({
                protocol: 'wss',
                slashes: true,
                hostname: addr.address,
                port: process.env.SSL_PORT || 8443
            })
        }));


        const pool = system_store.data.get_by_id(item.node.pool);
        const available_capacity =
            pool &&
            pool.cloud_pool_info &&
            pool.cloud_pool_info.available_capacity;

        return P.timeout(AGENT_RESPONSE_TIMEOUT,
                this.client.agent.get_agent_info_and_update_masters({
                    addresses: potential_masters,
                    available_capacity
                }, {
                    connection: item.connection
                })
            )
            .then(info => {
                if (!info) return;
                this._handle_agent_response(item, info);
            })
            .catch(err => {
                if (err.rpc_code === 'STORAGE_NOT_EXIST' && !item.storage_not_exist) {
                    dbg.error('got STORAGE_NOT_EXIST error from node', item.node.name, err.message);
                    item.storage_not_exist = Date.now();
                }
                if (item.node.deleting) {
                    dbg.warn('got error in _get_agent_info on a deleting node, ignoring error. node name', item.node.name, err.message);
                    return;
                }
                dbg.error(`got error in _get_agent_info ${item.node.name}:`, err);
                throw err;
            });
    }

    _handle_agent_metrics(item, info) {
        item.agent_info = info;
        // store io stats if any of the values is non zero
        if (info.io_stats && _.values(info.io_stats).reduce(_.add)) {
            // update io stats in background
            IoStatsStore.instance().update_node_io_stats({
                system: item.node.system,
                stats: info.io_stats,
                node_id: item.node._id
            });

            //update prometheus metrics
            if (config.PROMETHEUS_ENABLED) {
                const report = prom_reporting.get_core_report();
                if (this._is_cloud_node(item)) {
                    const endpoint_type = _.get(system_store.data.get_by_id(item.node.pool), 'cloud_pool_info.endpoint_type') || 'OTHER';
                    report.update_providers_bandwidth(endpoint_type, info.io_stats.write_bytes, info.io_stats.read_bytes);
                    report.update_providers_ops(endpoint_type, info.io_stats.write_count, info.io_stats.read_count);
                } else if (this._is_kubernetes_node(item)) {
                    const endpoint_type = 'KUBERNETES';
                    report.update_providers_bandwidth(endpoint_type, info.io_stats.write_bytes, info.io_stats.read_bytes);
                    report.update_providers_ops(endpoint_type, info.io_stats.write_count, info.io_stats.read_count);
                }
            }

        }
        const updates = _.pick(info, AGENT_INFO_FIELDS);
        updates.heartbeat = Date.now();
        return updates;
    }

    _handle_agent_response(item, info) {
        const updates = this._handle_agent_metrics(item, info);
        // node name is set once before the node is created in nodes_store
        // we take the name the agent sent as base, and add suffix if needed
        // to prevent collisions.
        if (item.node_from_store) {
            // calculate nodes cpu usage
            const new_cpus = _.get(info, 'os_info.cpus');
            const prev_cpus = _.get(item, 'node.os_info.cpus');
            item.cpu_usage = os_utils.calc_cpu_usage(new_cpus, prev_cpus);
            if (info.host_id !== item.node.host_id) {
                const old_host_id = item.node.host_id;
                const new_host_id = info.host_id;
                dbg.warn(`agent sent different host_id than the one stored in DB. updating from ${old_host_id} to ${new_host_id}`);
                // if host id changed then we should change it for all agents of this host for consistnecy
                const host_nodes = this._map_host_id.get(old_host_id);
                if (host_nodes) {
                    for (const update_item of host_nodes) {
                        update_item.node.host_id = new_host_id;
                        this._add_node_to_hosts_map(new_host_id, update_item);
                        this._set_need_update.add(update_item);
                    }
                    this._map_host_id.delete(old_host_id);
                    if (item.node.host_sequence) {
                        this._map_host_seq_num.set(String(item.node.host_sequence), new_host_id);
                    }
                }
            }
        } else {
            updates.name = info.name;
            updates.host_id = info.host_id;
            this._map_node_name.delete(String(item.node.name));
            let base_name = updates.name || 'node';
            let counter = 1;
            while (this._map_node_name.has(updates.name)) {
                updates.name = base_name + '-' + counter;
                counter += 1;
            }
            this._map_node_name.set(String(updates.name), item);
            dbg.log1('_get_agent_info: set node name', item.node.name, 'to', updates.name);
            item.new_host = !this._map_host_id.get(updates.host_id);
            if (!item.added_host) {
                if (!item.new_host) {
                    const host_nodes = this._map_host_id.get(info.host_id);
                    const host_item = this._consolidate_host(host_nodes);
                    if (String(item.node.pool) !== String(host_item.node.pool)) {
                        dbg.log0('Node pool changed', 'Node:', item.node, 'Host_Node:', host_item);
                        updates.pool = host_item.node.pool;
                    }
                }
                this._add_node_to_hosts_map(updates.host_id, item);
                item.added_host = true;
            }
            let agent_config = system_store.data.get_by_id(item.node.agent_config) || {};
            // on first call to get_agent_info enable\disable the node according to the configuration
            let should_start_service = this._should_enable_agent(info, agent_config);
            dbg.log1(`first call to get_agent_info. storage agent ${item.node.name}. should_start_service=${should_start_service}. `);
            if (!should_start_service) {
                item.node.decommissioned = Date.now();
                item.node.decommissioning = item.node.decommissioned;
            }
        }
        if (_.isUndefined(item.node.host_sequence)) {
            updates.host_sequence = this._get_host_sequence_number(info.host_id);
            this._map_host_seq_num.set(String(updates.host_sequence), info.host_id);
            dbg.log0(`node: ${updates.name} setting host_sequence to ${updates.host_sequence}`);
        }
        _.extend(item.node, updates);
        this._set_need_update.add(item);
        item.create_node_token = info.create_node_token;
    }

    _get_host_sequence_number(host_id) {
        const items = this._map_host_id.get(host_id);
        const item = items && items.find(i => i.node.host_sequence);
        if (item) {
            return item.node.host_sequence;
        }
        // new host - increment sequence
        this._host_sequence_number += 1;
        return this._host_sequence_number;
    }

    _remove_hideable_nodes(item) {
        if (item.node.force_hide) return;
        const host_nodes = this._get_nodes_by_host_id(item.node.host_id);
        if (this._is_host_hideable(host_nodes)) {
            dbg.log0('_remove_hideable_nodes: hiding host', item.node.host_id);
            this._hide_host(host_nodes);
        }
    }

    _uninstall_deleting_node(item) {
        if (item.ready_to_uninstall && this._should_skip_uninstall(item)) item.ready_to_be_deleted = true; // No need to uninstall - skipping...

        if (!item.ready_to_uninstall) return;
        if (item.node.deleted) return;
        if (item.ready_to_be_deleted) return;
        if (!item.connection) return;
        if (!item.node_from_store) return;

        dbg.log0('_uninstall_deleting_node: start running', item.node.host_id);
        const host_nodes = this._get_nodes_by_host_id(item.node.host_id);
        const host = this._consolidate_host(host_nodes);

        const first_item = host_nodes[0]; // TODO ask Danny if we can trust the first to be stable
        if (!first_item.connection) return;
        if (first_item.uninstalling) return;

        // if all nodes in host are ready_to_uninstall - uninstall the agent - at least try to
        if (!_.every(host_nodes, node => node.ready_to_uninstall)) return;

        first_item.uninstalling = true;
        dbg.log0('_uninstall_deleting_node: uninstalling host', item.node.host_id, 'all nodes are deleted');
        return P.resolve()
            .then(() => server_rpc.client.agent.uninstall(undefined, {
                connection: first_item.connection,
            }))
            .then(() => {
                dbg.log0('_uninstall_deleting_node: host',
                    this._item_hostname(host) + '#' + host.node.host_sequence,
                    'is uninstalled - all nodes will be removed');
                host_nodes.forEach(host_item => {
                    host_item.ready_to_be_deleted = true;
                });
                if (!item.node.force_hide) return this._hide_host(host_nodes);
            })
            .finally(() => {
                first_item.uninstalling = false;
            });
    }

    _update_node_service(item) {
        if (item.node.deleted) return;
        if (!item.connection) return;
        if (!item.agent_info) return;
        const should_enable = !item.node.decommissioned;
        const item_pool = system_store.data.get_by_id(item.node.pool);
        const location_info = {
            node_id: String(item.node._id),
            host_id: String(item.node.host_id),
            pool_id: String(item.node.pool),
        };
        if (item_pool) location_info.region = item_pool.region;
        const service_enabled_not_changed = (item.node.enabled && should_enable) || (!item.node.enabled && !should_enable);
        const location_info_not_changed = _.isEqual(item.agent_info.location_info, location_info);
        if (service_enabled_not_changed && location_info_not_changed) {
            return;
        }
        dbg.log0(`node service is not as expected. setting node service to ${should_enable ? 'enabled' : 'disabled'}`);

        return this.client.agent.update_node_service({
            enabled: should_enable,
            location_info,
        }, {
            connection: item.connection
        });
    }

    async _update_create_node_token(item) {
        try {
            if (item.node.deleted) return;
            if (!item.connection) return;
            if (!item.node_from_store) return;
            if (item.create_node_token) {
                dbg.log2(`_update_create_node_token: node already has a valid create_node_token. item.create_node_token = ${item.create_node_token}`);
                return;
            }
            dbg.log0('node does not have a valid create_node_token. creating new one and sending to agent');
            let auth_parmas = {
                system_id: String(item.node.system),
                account_id: system_store.data.get_by_id(item.node.system).owner._id,
                role: 'create_node',
            };
            let token = auth_server.make_auth_token(auth_parmas);
            dbg.log0(`new create_node_token: ${token}`);

            await P.timeout(AGENT_RESPONSE_TIMEOUT,
                this.client.agent.update_create_node_token({
                    create_node_token: token
                }, {
                    connection: item.connection
                })
            );

        } catch (err) {
            dbg.warn('encountered an error in _update_create_node_token', err);
            throw err;
        }

    }

    async _update_rpc_config(item) {
        if (item.node.deleted) return;
        if (!item.connection) return;
        if (!item.agent_info) return;
        if (!item.node_from_store) return;

        try {
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
            // don't update local agents which are using local host

            const { routing_hint } = system_store.data.get_by_id(item.node.agent_config) || {};
            const base_address = addr_utils.get_base_address(system.system_address, { hint: routing_hint }).toString();
            const address_configured = system.system_address.some(addr => addr.service === 'noobaa-mgmt');
            if (address_configured &&
                !item.node.is_internal_node &&
                !is_localhost(item.agent_info.base_address) &&
                base_address.toLowerCase() !== item.agent_info.base_address.toLowerCase()) {
                rpc_config.base_address = base_address;
            }

            // make sure we don't modify the system's n2n_config
            const public_ips = item.node.public_ip ? [item.node.public_ip] : [];
            const n2n_config = _.extend(null,
                item.agent_info.n2n_config,
                _.cloneDeep(system.n2n_config), { public_ips });
            if (item.node.is_cloud_node) {
                n2n_config.tcp_permanent_passive = {
                    port: config.CLOUD_AGENTS_N2N_PORT
                };
            }
            if (item.node.is_mongo_node) {
                n2n_config.tcp_permanent_passive = {
                    port: config.MONGO_AGENTS_N2N_PORT
                };
            }
            if (!_.isEqual(n2n_config, item.agent_info.n2n_config)) {
                rpc_config.n2n_config = n2n_config;
            }
            // skip the update when no changes detected
            if (_.isEmpty(rpc_config)) return;
            dbg.log0('_update_rpc_config:', item.node.name, rpc_config);
            await P.timeout(AGENT_RESPONSE_TIMEOUT,
                this.client.agent.update_rpc_config(rpc_config, {
                    connection: item.connection
                })
            );

            _.extend(item.node, rpc_config);
            this._set_need_update.add(item);
        } catch (err) {
            dbg.warn('encountered an error in _update_rpc_config', err);
            throw err;
        }

    }

    async _test_store_validity(item) {
        try {
            await P.timeout(AGENT_RESPONSE_TIMEOUT,
                this.client.agent.test_store_validity(null, {
                    connection: item.connection
                })
            );
        } catch (err) {
            // ignore "unkonown" errors for cloud resources - we don't want to put the node in detention in cases where we don't know what is the problem
            // if there is a real issue, we will take it into account in report_error_on_node_blocks
            if (this._is_cloud_node(item) && err.rpc_code !== 'AUTH_FAILED' && err.rpc_code !== 'STORAGE_NOT_EXIST') {
                dbg.warn(`encountered an unknown error in _test_store_validity`, err);
            } else {
                dbg.log0(`encountered an error in _test_store_validity. `, err);
                throw err;
            }

        }
    }

    async _test_store_perf(item) {
        const now = Date.now();
        if (item.last_store_perf_test && now < item.last_store_perf_test + STORE_PERF_TEST_INTERVAL) return;
        try {


            dbg.log1('running _test_store_perf::', item.node.name);
            const res = await P.timeout(AGENT_RESPONSE_TIMEOUT,
                this.client.agent.test_store_perf({
                    count: 5
                }, {
                    connection: item.connection
                })
            );
            item.last_store_perf_test = Date.now();
            dbg.log0(`_test_store_perf for node ${item.node.name} returned:`, res);
            this._set_need_update.add(item);
            item.node.latency_of_disk_read = js_utils.array_push_keep_latest(
                item.node.latency_of_disk_read, res.read, MAX_NUM_LATENCIES);
            item.node.latency_of_disk_write = js_utils.array_push_keep_latest(
                item.node.latency_of_disk_write, res.write, MAX_NUM_LATENCIES);
        } catch (err) {
            // ignore "unkonown" errors for cloud resources - we don't want to put the node in detention in cases where we don't know what is the problem
            // if there is a real issue, we will take it into account in report_error_on_node_blocks
            if (this._is_cloud_node(item) && err.rpc_code !== 'AUTH_FAILED' && err.rpc_code !== 'STORAGE_NOT_EXIST') {
                dbg.warn(`encountered an unknown error in _test_store_perf. `, err);
            } else {
                dbg.log0(`encountered an error in _test_store_perf. `, err);
                throw err;
            }
        }
    }

    async _test_store(item) {
        if (!item.connection) return;

        try {
            await this._test_store_perf(item);
            await this._test_store_validity(item);

            dbg.log2('_test_store:: success in test', item.node.name);
            if (item.io_test_errors &&
                Date.now() - item.io_test_errors > config.NODE_IO_DETENTION_THRESHOLD) {
                item.io_test_errors = 0;
            }

            if (item.storage_not_exist) {
                // storage test succeeds after the storage target (AWS bucket / azure container) was not available
                dbg.warn('agent storage is available again after agent reported it does not exist. ', item.node.name);
                delete item.storage_not_exist;
            }
            if (item.auth_failed) {
                // authentication in aws\azure succeeded after it failed before
                dbg.warn('authentication in aws\\azure succeeded after it failed before ', item.node.name);
                delete item.auth_failed;
            }

        } catch (err) {
            dbg.warn('encountered an error in _test_store', err);
            if (err.rpc_code === 'STORAGE_NOT_EXIST' && !item.storage_not_exist) {
                dbg.error('got STORAGE_NOT_EXIST error from node', item.node.name, err.message);
                item.storage_not_exist = Date.now();
            } else if (err.rpc_code === 'AUTH_FAILED' && !item.auth_failed) {
                dbg.error('got AUTH_FAILED error from node', item.node.name, err.message);
                item.auth_failed = Date.now();
            } else if ((this._is_cloud_node(item)) &&
                // for cloud nodes allow some errors before putting to detention
                item.num_io_test_errors < config.CLOUD_MAX_ALLOWED_IO_TEST_ERRORS) {
                item.num_io_test_errors += 1;
                return;
            }
            if (!item.io_test_errors) {
                dbg.error('_test_store:: node has io_test_errors', item.node.name, err);
                item.io_test_errors = Date.now();
            }

            item.num_io_test_errors = 0;
        }
    }


    _test_network_to_server(item) {
        if (!item.connection) return;
        if (!item.node.rpc_address) return;

        const start = Date.now();

        dbg.log1('_test_network_to_server::', item.node.name);
        return P.timeout(AGENT_TEST_CONNECTION_TIMEOUT,
                this.n2n_client.agent.test_network_perf({
                    source: this.n2n_agent.rpc_address,
                    target: item.node.rpc_address,
                    response_length: 1,
                }, {
                    address: item.node.rpc_address,
                    return_rpc_req: true // we want to check req.connection
                })
            )
            .then(req => {
                var took = Date.now() - start;
                this._set_need_update.add(item);
                item.node.latency_to_server = js_utils.array_push_keep_latest(
                    item.node.latency_to_server, [took], MAX_NUM_LATENCIES);
                dbg.log1('_test_network_to_server:: Succeeded in sending n2n rpc to ',
                    item.node.name, 'took', took);
                req.connection.close();

                if (item.gateway_errors &&
                    Date.now() - item.gateway_errors > config.NODE_IO_DETENTION_THRESHOLD) {
                    item.gateway_errors = 0;
                }
            })
            .catch(err => {
                if (!item.gateway_errors) {
                    dbg.error('_test_network_to_server:: node has gateway_errors', item.node.name, err);
                    item.gateway_errors = Date.now();
                }
            });
    }


    // Test with few other nodes and detect if we have a NAT preventing TCP to this node
    _test_network_perf(item) {
        if (!item.connection) return;
        if (!item.node.rpc_address) return;

        const items_without_issues = this._get_detention_test_nodes(item, config.NODE_IO_DETENTION_TEST_NODES);
        return P.map_one_by_one(items_without_issues, item_without_issues => {
                dbg.log1('_test_network_perf::', item.node.name, item.io_detention,
                    item.node.rpc_address, item_without_issues.node.rpc_address);
                return P.timeout(AGENT_TEST_CONNECTION_TIMEOUT,
                    this.client.agent.test_network_perf_to_peer({
                        source: item_without_issues.node.rpc_address,
                        target: item.node.rpc_address,
                        request_length: 1,
                        response_length: 1,
                        count: 1,
                        concur: 1
                    }, {
                        connection: item_without_issues.connection
                    })
                );
            })
            .then(() => {
                dbg.log1('_test_network_perf:: success in test', item.node.name);
                if (item.n2n_errors &&
                    Date.now() - item.n2n_errors > config.NODE_IO_DETENTION_THRESHOLD) {
                    item.n2n_errors = 0;
                }
            })
            .catch(err => {
                if (!item.n2n_errors) {
                    dbg.error('_test_network_perf:: node has n2n_errors', item.node.name, err);
                    item.n2n_errors = Date.now();
                }
            });
    }

    async _test_nodes_validity(item) {
        if (item.node.deleted) return;
        if (!item.node_from_store) return;
        dbg.log1('_test_nodes_validity::', item.node.name);

        try {
            await Promise.all([
                this._test_network_perf(item),
                this._test_store(item),
                this._test_network_to_server(item)
            ]);

            if (item.io_reported_errors &&
                Date.now() - item.io_reported_errors > config.NODE_IO_DETENTION_THRESHOLD) {
                dbg.log1('_test_nodes_validity:: io_reported_errors removed', item.node.name);
                item.io_reported_errors = 0;
            }

        } catch (err) {
            dbg.warn('encountered an error in _test_nodes_validity', err);
        }
    }


    _get_detention_test_nodes(item, limit) {
        this._throw_if_not_started_and_loaded();
        const filter_res = this._filter_nodes({
            skip_address: item.node.rpc_address,
            skip_no_address: true,
            pools: [item.node.pool],
            has_issues: false
        });
        const list = filter_res.list;
        this._sort_nodes_list(list, {
            sort: 'shuffle'
        });
        const selected = _.take(list, limit);
        dbg.log1('_get_detention_test_nodes::', item.node.name,
            _.map(selected, 'node.name'), limit);
        return _.isUndefined(limit) ? list : selected;
    }


    /*
     *
     * UPDATE NODES STORE FOR PERSISTENCY
     *
     */

    _update_nodes_store(force) {
        return this._update_nodes_store_serial.surround(() => {
            // skip the update if not forced and not enough coalescing
            if (!this._set_need_update.size) return;
            if (!force && this._set_need_update.size < UPDATE_STORE_MIN_ITEMS) return;

            const new_nodes = [];
            const existing_nodes = [];
            const deleted_nodes = [];
            for (const item of this._set_need_update) {
                if (item.ready_to_be_deleted) {
                    deleted_nodes.push(item);
                } else if (item.node_from_store) {
                    existing_nodes.push(item);
                } else {
                    new_nodes.push(item);
                }
            }

            // the set is cleared to collect new changes during the update
            this._set_need_update = new Set();

            return Promise.all([
                    this._update_existing_nodes(existing_nodes),
                    this._update_new_nodes(new_nodes),
                    this._update_deleted_nodes(deleted_nodes)
                ])
                .catch(err => {
                    dbg.warn('_update_nodes_store: had errors', err);
                });
        });
    }

    _update_existing_nodes(existing_nodes) {
        if (!existing_nodes.length) return;
        return P.resolve()
            .then(() => NodesStore.instance().bulk_update(existing_nodes))
            .then(res => {
                // mark failed updates to retry
                if (res.failed) {
                    for (const item of res.failed) {
                        this._set_need_update.add(item);
                    }
                }
            })
            .catch(err => {
                dbg.warn('_update_existing_nodes: ERROR', err.stack || err);
            });
    }

    _update_new_nodes(new_nodes) {
        if (!new_nodes.length) return;
        const items_to_create = [];
        return P.map_with_concurrency(10, new_nodes, item => {
                if (!item.connection) {
                    // we discard nodes that disconnected before being created
                    dbg.warn('discard node that was not created', item.node.name);
                    this._remove_node_from_maps(item);
                    return;
                }
                if (item.node.name.startsWith(NO_NAME_PREFIX)) {
                    // in this case we could not get the agent info
                    // so we avoid creating the node until we get it
                    this._set_need_update.add(item);
                    return;
                }
                dbg.log0('_update_new_nodes: update_auth_token', item.node.name);
                return P.timeout(AGENT_RESPONSE_TIMEOUT,
                        this.client.agent.update_auth_token({
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
                    )
                    .then(() => items_to_create.push(item))
                    .catch(err => {
                        // we couldn't update the agent with the token
                        // so avoid inserting this node to store
                        dbg.warn('_update_new_nodes: update_auth_token ERROR node',
                            item.node.name, item, err);
                        this._set_need_update.add(item);
                    });
            })
            .then(() => dbg.log0('_update_new_nodes: nodes to create',
                _.map(items_to_create, 'node.name')))
            .then(() => NodesStore.instance().bulk_update(items_to_create))
            .then(res => {
                // mark failed updates to retry
                if (res.failed) {
                    for (const item of res.failed) {
                        this._set_need_update.add(item);
                    }
                }
                if (res.updated) {
                    for (const item of res.updated) {
                        // update the status of readable/writable after node_from_store is updated
                        this._update_status(item);
                        if (item.node.is_cloud_node) continue;
                        if (item.node.is_mongo_node) continue;
                        if (item.node.is_internal_node) continue;
                        if (item.new_host) {
                            this._dispatch_node_event(item, 'create', `${this._item_hostname(item)} was added as a node to pool ${this._item_pool_name(item)}`);
                        }
                    }
                }
            })
            .catch(err => {
                dbg.warn('_update_new_nodes: ERROR', err.stack || err);
            });
    }

    // Handle nodes that ready and need to be deleted
    // TODO: At this time, the code is relevant to nodes of cloud/mongo resources
    // Ready means that they evacuated their data from the cloud/mongo resource
    // And currently waiting for their process to be deleted and removed from DB
    // Notice that we do not update the DB and then try to remeve the process
    // This is done in order to attempt and remove the process until we succeed
    // The node won't be deleted from the DB until the process is down and dead
    // This is why we are required to use a new variable by the name ready_to_be_deleted
    // In order to mark the nodes that wait for their processes to be removed (cloud/mongo resource)
    // If the node is not relevant to a cloud/mongo resouce it will be just marked as deleted
    _update_deleted_nodes(deleted_nodes) {
        if (!deleted_nodes.length) return;
        const items_to_update = [];
        return P.map_with_concurrency(10, deleted_nodes, item => {
                dbg.log0('_update_nodes_store deleted_node:', item);

                if (item.node.deleted) {
                    if (!item.node_from_store.deleted) {
                        items_to_update.push(item);
                    }
                    return;
                }

                // TODO handle deletion of normal nodes (uninstall?)
                // Just mark the node as deleted and we will not scan it anymore
                // This is done once the node's proccess is deleted (relevant to cloud/mongo resource)
                // Or in a normal node it is done immediately
                if (!item.node.is_cloud_node &&
                    !item.node.is_mongo_node &&
                    !item.node.is_internal_node) {
                    item.node.deleted = Date.now();
                    items_to_update.push(item);
                    return;
                }

                return P.resolve()
                    .then(() => {
                        if (item.node.is_internal_node) {
                            return P.reject('Do not support internal_node deletion yet');
                        }
                        // Removing the internal node from the processes
                        return server_rpc.client.hosted_agents.remove_pool_agent({
                            node_name: item.node.name
                        });
                    })
                    .then(() => {
                        // Marking the node as deleted since we've removed it completely
                        // If we did not succeed at removing the process we don't mark the deletion
                        // This is done in order to cycle the node once again and attempt until
                        // We succeed
                        item.node.deleted = Date.now();
                        items_to_update.push(item);
                    })
                    .catch(err => {
                        // We will just wait another cycle and attempt to delete it fully again
                        dbg.warn('delete_cloud_or_mongo_pool_node ERROR node', item.node, err);
                    });
            })
            .then(() => NodesStore.instance().bulk_update(items_to_update))
            .then(res => {
                // mark failed updates to retry
                if (res.failed) {
                    for (const item of res.failed) {
                        this._set_need_update.add(item);
                    }
                }
                if (res.updated) {
                    for (const item of res.updated) {
                        this._remove_node_from_maps(item);
                    }
                }
            })
            .catch(err => {
                dbg.warn('_update_deleted_nodes: ERROR', err.stack || err);
            });
    }

    _should_enable_agent(info, agent_config) {
        let { use_storage = true, exclude_drives = [] } = agent_config;
        if (info.node_type === 'BLOCK_STORE_FS') {
            if (!use_storage) return false; // if storage disable if configured to exclud storage
            if (info.storage.total < config.MINIMUM_AGENT_TOTAL_STORAGE) return false; // disable if not enough storage
            return this._should_include_drives(info.drives[0].mount, info.os_info, exclude_drives);
        }
        return true;
    }

    _should_include_drives(mount, os_info, exclude_drives) {
        if (os_info.ostype.startsWith('Windows_NT')) {
            let win_drives = exclude_drives.map(drv => {
                let ret = drv;
                if (drv.length === 1) {
                    ret = drv + ':';
                } else if (drv[drv.length - 1] === '\\') {
                    ret = drv.slice(0, drv.length - 1);
                }
                // win drives are case insensitive;
                return ret.toLowerCase();
            });
            return win_drives.indexOf(mount.toLowerCase()) === -1;
        }
        return exclude_drives.indexOf(mount) === -1;
    }

    /*
     *
     * UPDATE STATUS AND REBUILDING
     *
     */

    _update_status(item) {
        if (!item.node_from_store) return;
        dbg.log3('_update_status:', item.node.name);

        const now = Date.now();
        item.online = Boolean(item.connection) && (now < item.node.heartbeat + AGENT_HEARTBEAT_GRACE_TIME);

        // if we still have a connection, but considered offline, close the connection
        if (!item.online && item.connection) {
            dbg.warn('node HB not received in the last',
                AGENT_HEARTBEAT_GRACE_TIME / 60000,
                'minutes. closing connection');
            this._disconnect_node(item);
        }

        // to decide the node trusted status we check the reported issues
        item.trusted = true;
        let io_detention_recent_issues = 0;
        if (item.node.permission_tempering) {
            item.trusted = false;
        }

        if (item.node.issues_report) {
            // only print to log if the node had issues in the last hour
            let last_issue = item.node.issues_report[item.node.issues_report.length - 1];
            if (now - last_issue.time < 60 * 60 * 1000) {
                dbg.log0('_update_status:', item.node.name, 'issues:', item.node.issues_report);
            }
            for (const issue of item.node.issues_report) {
                // tampering is a trust issue, but maybe we need to refine this
                // and only consider trust issue after 3 tampering strikes
                // which are not too old
                if (issue.reason === 'TAMPERING') {
                    item.trusted = false;
                }

                if (issue.action === 'write' ||
                    issue.action === 'replicate' ||
                    issue.action === 'read') {
                    if (now - issue.time < config.NODE_IO_DETENTION_THRESHOLD) {
                        io_detention_recent_issues += 1;
                    }
                }
            }
        }

        if (!item.io_reported_errors &&
            io_detention_recent_issues >= config.NODE_IO_DETENTION_RECENT_ISSUES) {
            dbg.log0('_update_status:: Node has io_reported_errors', item.node.name);
            item.io_reported_errors = now;
        }

        item.io_detention = this._get_item_io_detention(item);
        item.connectivity = 'TCP';
        item.avg_ping = _.mean(item.node.latency_to_server);
        item.avg_disk_read = _.mean(item.node.latency_of_disk_read);
        item.avg_disk_write = _.mean(item.node.latency_of_disk_write);
        item.storage_full = this._get_item_storage_full(item);
        item.has_issues = this._get_item_has_issues(item);
        item.readable = this._get_item_readable(item);
        item.writable = this._get_item_writable(item);
        item.accessibility = this._get_item_accessibility(item);
        item.mode = this._get_item_mode(item);

        this._update_data_activity(item);
    }

    _cloud_node_alert(msg) {
        Dispatcher.instance().alert('MAJOR',
            system_store.data.systems[0]._id,
            msg,
            Dispatcher.rules.once_daily);
    }

    _dispatch_node_event(item, event, description, actor) {
        Dispatcher.instance().activity({
            level: 'info',
            event: 'node.' + event,
            system: item.node.system,
            actor: actor,
            node: item.node._id,
            desc: description,
        });
    }

    _get_item_storage_full(item) {
        const storage_info = this._node_storage_info(item);
        return storage_info.free <= 1024 * 1024;
    }

    _get_item_io_detention(item) {
        const io_detention_time = Math.min(
            item.n2n_errors || Number.POSITIVE_INFINITY,
            item.gateway_errors || Number.POSITIVE_INFINITY,
            item.io_test_errors || Number.POSITIVE_INFINITY,
            item.io_reported_errors || Number.POSITIVE_INFINITY
        );
        return io_detention_time === Number.POSITIVE_INFINITY ?
            0 : io_detention_time;
    }


    _get_item_issues_reasons(item) {
        try {
            const reasons = [];
            if (!item.online) reasons.push('node offline');
            if (!item.trusted) reasons.push('node untrusted');
            if (!item.node_from_store) reasons.push('node not stored yet');
            if (!item.node.rpc_address) reasons.push('no rpc_address');
            if (item.storage_not_exist) reasons.push(`target storage do not exist (${new Date(item.storage_not_exist)})`);
            if (item.auth_failed) reasons.push(`failed to authenticate on target storage (${new Date(item.storage_not_exist)})`);
            if (item.io_detention && item.n2n_errors) reasons.push(`in detention (n2n_errors at ${new Date(item.n2n_errors)})`);
            if (item.io_detention && item.gateway_errors) reasons.push(`in detention (gateway_errors at ${new Date(item.gateway_errors)})`);
            if (item.io_detention && item.io_test_errors) reasons.push(`in detention (io_test_errors at ${new Date(item.io_test_errors)})`);
            if (item.io_detention && item.io_reported_errors) reasons.push(`in detention (io_reported_errors at ${new Date(item.io_reported_errors)})`);
            if (item.storage_full) reasons.push(`storage is full (${new Date(item.storage_full)})`);
            if (item.node.migrating_to_pool) reasons.push(`node migrating`);
            if (item.node.decommissioning) reasons.push(`node decommissioning (${new Date(item.node.decommissioning)})`);
            if (item.node.decommissioned) reasons.push(`node decommissioned (${new Date(item.node.decommissioned)})`);
            if (item.node.deleting) reasons.push(`node in deleting state (${new Date(item.node.deleting)})`);
            if (item.node.deleted) reasons.push(`node in deleted state (${new Date(item.node.deleted)})`);

            return reasons.join(', ');
        } catch (err) {
            dbg.log0('got error in _get_item_issues_reasons', err);
        }
    }

    _get_item_has_issues(item) {
        const stat = !(
            item.online &&
            item.trusted &&
            item.node_from_store &&
            item.node.rpc_address &&
            !item.io_detention &&
            !item.node.migrating_to_pool &&
            !item.node.decommissioning &&
            !item.node.decommissioned &&
            !item.node.deleting &&
            !item.node.deleted);
        if (stat) {
            dbg.log0_throttled(`${item.node.name} item has issues. reasons: ${this._get_item_issues_reasons(item)}`);
        }
        return stat;
    }


    _get_item_readable(item) {
        const readable = Boolean(
            item.online &&
            item.trusted &&
            item.node_from_store &&
            item.node.rpc_address &&
            !item.storage_not_exist &&
            !item.auth_failed &&
            !item.io_detention &&
            !item.node.decommissioned && // but readable when decommissioning !
            !item.node.deleting &&
            !item.node.deleted
        );
        if (!readable) {
            dbg.log0_throttled(`${item.node.name} not readable. reasons: ${this._get_item_issues_reasons(item)}`);
        }
        return readable;
    }

    _get_item_writable(item) {
        const writable = Boolean(
            item.online &&
            item.trusted &&
            item.node_from_store &&
            item.node.rpc_address &&
            !item.storage_not_exist &&
            !item.auth_failed &&
            !item.io_detention &&
            !item.storage_full &&
            !item.node.migrating_to_pool &&
            !item.node.decommissioning &&
            !item.node.decommissioned &&
            !item.node.deleting &&
            !item.node.deleted
        );

        if (!writable) {
            dbg.log0_throttled(`${item.node.name} not writable. reasons: ${this._get_item_issues_reasons(item)}`);
        }
        return writable;
    }

    _get_item_accessibility(item) {
        return (item.readable && item.writable && 'FULL_ACCESS') ||
            (item.readable && 'READ_ONLY') ||
            'NO_ACCESS';
    }


    _get_item_mode(item) {
        const MB = 1024 ** 2;
        const storage = this._node_storage_info(item);
        const free = size_utils.json_to_bigint(storage.free);
        const used = size_utils.json_to_bigint(storage.used);
        const free_ratio = free.add(used).isZero() ?
            BigInteger.zero :
            free.multiply(100).divide(free.add(used));

        return (item.node.decommissioned && 'DECOMMISSIONED') ||
            (item.node.decommissioning && 'DECOMMISSIONING') ||
            (item.node.deleting && 'DELETING') ||
            (!item.online && 'OFFLINE') ||
            (!item.node.rpc_address && 'INITIALIZING') ||
            (!item.trusted && 'UNTRUSTED') ||
            (item.node.deleted && 'DELETED') ||
            (item.storage_not_exist && 'STORAGE_NOT_EXIST') ||
            (item.auth_failed && 'AUTH_FAILED') ||
            (item.node.migrating_to_pool && 'MIGRATING') ||
            (item.n2n_errors && 'N2N_ERRORS') ||
            (item.gateway_errors && 'GATEWAY_ERRORS') ||
            (item.io_test_errors && 'IO_ERRORS') ||
            (item.io_reported_errors && 'IO_ERRORS') ||
            (free.lesserOrEquals(MB) && 'NO_CAPACITY') ||
            (free_ratio.lesserOrEquals(20) && 'LOW_CAPACITY') ||
            'OPTIMAL';
    }



    _update_data_activity(item) {
        const reason = this._get_data_activity_reason(item);
        if (!reason) {
            item.data_activity = null;
            this._set_need_rebuild.delete(item);
            return;
        }
        dbg.log1('_update_data_activity: reason', reason, item.node.name);
        const now = Date.now();
        // if no data activity, or activity reason has changed then reset data_activity
        if (!item.data_activity || item.data_activity.reason !== reason) {
            dbg.log0(`data activity reason of ${item.node.name} was changed from ${_.get(item, 'data_activity.reason')} to ${reason}`);
            item.data_activity = { reason };
        }
        this._update_data_activity_stage(item, now);
        this._update_data_activity_progress(item, now);
        this._update_data_activity_schedule(item);
    }

    _get_data_activity_reason(item) {
        if (!item.node_from_store) return '';
        if (item.node.deleted) return '';
        if (item.node.deleting) return ACT_DELETING;
        if (item.node.decommissioned) return '';
        if (item.node.decommissioning) return ACT_DECOMMISSIONING;
        if (item.node.migrating_to_pool) return ACT_MIGRATING;
        if (!item.online || !item.trusted || item.io_detention) return ACT_RESTORING;
        return '';
    }

    _update_data_activity_stage(item, now) {
        const act = item.data_activity;
        const start_of_grace = item.io_detention || item.node.heartbeat || 0;
        const end_of_grace = start_of_grace + config.REBUILD_NODE_OFFLINE_GRACE;

        // Notice that there are only two types of GRACE, one for io_detention and heartbeat
        // Which means that in case of untrusted node we will not restore/rebuild it
        if (now < end_of_grace) {
            if (act.reason === ACT_RESTORING) {
                dbg.log1('_update_data_activity_stage: WAIT OFFLINE GRACE',
                    item.node.name, act);
                act.stage = {
                    name: STAGE_OFFLINE_GRACE,
                    time: {
                        start: start_of_grace,
                        end: end_of_grace,
                    },
                    size: {},
                };
                return;
            }
        } else if (act.stage && act.stage.name === STAGE_OFFLINE_GRACE) {
            dbg.log1('_update_data_activity_stage: PASSED OFFLINE GRACE',
                item.node.name, act);
            // nullify to reuse the code that init right next
            act.stage = null;
        }

        if (!act.stage) {
            dbg.log1('_update_data_activity_stage: START REBUILDING',
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
            dbg.log1('_update_data_activity_stage: DONE REBUILDING',
                item.node.name, act);
            if (act.reason === ACT_RESTORING) {
                // restore is done after rebuild, not doing wiping
                act.done = true;
            } else {
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
                // We mark it in order to remove the agent fully (process and tokens etc)
                // Only after successfully completing the removal we assign the deleted date
                // item.ready_to_be_deleted = true;
                item.ready_to_uninstall = true;
            }
            act.done = true;
        }
    }

    _update_data_activity_progress(item, now) {
        const act = item.data_activity;

        if (act.stage && !_.isEmpty(act.stage.size)) {
            act.stage.size.remaining = Math.max(0,
                act.stage.size.total - act.stage.size.completed) || 0;
            const completed_time = now - act.stage.time.start;
            let end_calc;
            if (act.stage.size.completed) {
                end_calc = now + Math.ceil(
                    act.stage.size.remaining *
                    completed_time / act.stage.size.completed
                );
            }
            act.stage.time.end = end_calc;
        }

        act.time = act.time || {};
        act.time.start = act.time.start || now;
        // TODO estimate all stages
        act.time.end = act.stage && act.stage.time.end;
        act.progress = progress_by_time(act.time, now);
    }

    _update_data_activity_schedule(item) {
        const act = item.data_activity;

        if (!act) {
            item.data_activity = null;
            this._set_need_rebuild.delete(item);
            this._set_need_update.add(item);
            return;
        }

        // keep the activity in 'done' state
        // to know that we don't need to run it again.
        // this is needed only for restoring,
        // which should probably have a persistent state instead
        if (act.done) {
            this._set_need_rebuild.delete(item);
            this._set_need_update.add(item);
            return;
        }

        if (system_utils.system_in_maintenance(item.node.system)) {
            dbg.warn('_update_status: delay node data_activity',
                'while system in maintenance', item.node.name);
            act.stage.wait_reason = WAIT_SYSTEM_MAINTENANCE;
            this._set_need_rebuild.delete(item);
            return;
        }

        if (act.stage.name === STAGE_REBUILDING) {
            this._schedule_rebuild(item);
        }

        if (act.stage.name === STAGE_WIPING) {
            if (item.online) {
                this._schedule_rebuild(item);
            } else {
                act.stage.wait_reason = WAIT_NODE_OFFLINE;
                this._set_need_rebuild.delete(item);
            }
        }
    }

    _schedule_rebuild(item) {
        const act = item.data_activity;

        if (!act || act.running || item.rebuild_timeout) return;

        const now = Date.now();
        let delay = config.REBUILD_NODE_BATCH_DELAY;
        if (act.stage.rebuild_error) {
            delay = Math.max(act.stage.rebuild_error - now + 10000, config.REBUILD_NODE_BATCH_DELAY);
            dbg.warn('_schedule_rebuild: delay', delay, 'for node', item.node.name);
        }

        item.rebuild_timeout = setTimeout(() => {
            item.rebuild_timeout = undefined;
            this._set_need_rebuild.add(item);
            this._wakeup_rebuild();
        }, delay).unref();
    }

    _wakeup_rebuild() {
        if (!this._started) return;
        if (!config.REBUILD_NODE_ENABLED) return;
        const count = Math.min(
            config.REBUILD_NODE_CONCURRENCY,
            this._set_need_rebuild.size - this._num_running_rebuilds);
        for (let i = 0; i < count; ++i) {
            // TODO: This can cause multiple workers to wait for each other and work on the same
            // batches since they all look at const act = item.data_activity
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
        return P.delay_unblocking(5 * i)
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
        const start_marker = act.stage.marker;
        let blocks_size;
        return P.resolve()
            .then(() => MDStore.instance().iterate_node_chunks({
                node_id: item.node._id,
                marker: start_marker,
                limit: config.REBUILD_NODE_BATCH_SIZE,
            }))
            .then(res => {
                // we update the stage marker even if failed to advance the scan
                act.stage.marker = res.marker;
                blocks_size = res.blocks_size;
                return this.client.scrubber.build_chunks({
                    chunk_ids: res.chunk_ids
                }, {
                    auth_token: auth_server.make_auth_token({
                        system_id: String(item.node.system),
                        role: 'admin'
                    })
                });
            })
            .then(() => {
                act.running = false;
                // increase the completed size only if succeeded
                // TODO: This is the bug that we have a overflow or underflow of the data
                // If we do the partial deletes then we do not update in catch or update like we succeeded all
                act.stage.size.completed += blocks_size;
                if (act.stage.marker) {
                    this._update_data_activity(item);
                    return;
                }
                if (act.stage.rebuild_error) {
                    act.stage.marker = act.stage.error_marker;
                    act.stage.size.completed = act.stage.error_marker_completed || 0;
                    dbg.log0('_rebuild_node: HAD ERRORS. RESTART', item.node.name, act);
                    this._update_data_activity(item);
                    act.stage.rebuild_error = 0;
                    act.stage.error_marker = null;
                    act.stage.error_marker_completed = 0;
                    return;
                }
                act.stage.done = true;
                dbg.log0('_rebuild_node: DONE', item.node.name, act);
                this._update_data_activity(item);
            })
            .catch(err => {
                act.running = false;
                dbg.warn('_rebuild_node: ERROR', item.node.name, err.stack || err);
                if (!act.stage.rebuild_error) {
                    act.stage.error_marker = start_marker;
                    act.stage.error_marker_completed = act.stage.size.completed || 0;
                }
                act.stage.rebuild_error = Date.now();
                this._update_data_activity(item);
            });
    }


    /*
     *
     * QUERYING AND AGGREGATION
     *
     */

    _filter_nodes(query) {
        const list = [];
        const mode_counters = {};
        const filter_counts = {
            count: 0,
            online: 0,
            by_mode: mode_counters
        };

        const filter_item_func = this._get_filter_item_func(query);

        const items = query.nodes ?
            new Set(_.map(query.nodes, node_identity =>
                this._get_node(node_identity, 'allow_offline', 'allow_missing'))) :
            this._map_node_id.values();
        for (const item of items) {
            if (!item) continue;
            // skip new nodes
            if (!item.node_from_store) continue;
            if (item.node.force_hide) continue;
            // update the status of every node we go over
            this._update_status(item);
            if (!filter_item_func(item)) continue;

            // the filter_count count nodes that passed all filters besides
            // the online and mode filter this is used for the frontend to show
            // the counts by mode event when actually showing the filtered list
            // of nodes.
            filter_counts.count += 1;
            mode_counters[item.mode] = (mode_counters[item.mode] || 0) + 1;
            if (item.online) filter_counts.online += 1;

            // after counting, we can finally filter by
            if (!_.isUndefined(query.has_issues) &&
                query.has_issues !== Boolean(item.has_issues)) continue;
            if (!_.isUndefined(query.online) &&
                query.online !== Boolean(item.online)) continue;
            if (!_.isUndefined(query.mode) &&
                !query.mode.includes(item.mode)) continue;

            dbg.log1('list_nodes: adding node', item.node.name);
            list.push(item);
        }
        return {
            list,
            filter_counts
        };
    }



    _filter_hosts(query) {
        const list = [];
        const mode_counters = {};

        const hosts = this._map_host_id.values();
        for (const host of hosts) {
            if (!host) continue;
            // skip new hosts
            if (host.every(item => !item.node_from_store)) continue;
            if (host.every(item => item.node.force_hide)) continue;
            // update the status of every node we go over
            const item = this._consolidate_host(host);
            // filter hosts according to query
            if (item.node.node_type !== 'BLOCK_STORE_FS' && !query.include_all) continue;
            if (query.hosts && !query.hosts.includes(String(item.node.host_sequence))) continue;
            if (query.pools && !query.pools.has(String(item.node.pool))) continue;
            if (query.filter && !query.filter.test(this._item_hostname(item)) && !query.filter.test(item.node.ip)) continue;
            if (query.skip_cloud_nodes && item.node.is_cloud_node) continue;

            // The mode_counters count nodes that passed all filters besides
            // the mode filter and create a count for each noticed mode.
            mode_counters[item.mode] = (mode_counters[item.mode] || 0) + 1;

            // after counting, we can finally filter by mode
            if (!_.isUndefined(query.mode) &&
                !query.mode.includes(item.mode)) continue;

            dbg.log1('list_nodes: adding node', item.node.name);
            list.push(item);
        }
        return {
            list,
            mode_counters
        };
    }

    _item_hostname(item) {
        return item.node.os_info.hostname;
    }

    _item_drive_description(item) {
        return `${item.node.drives[0].mount} of ${this._item_hostname(item)} in pool ${this._item_pool_name(item)}`;
    }

    _item_pool_name(item) {
        const pool = system_store.data.get_by_id(item.node.pool);
        return pool ? pool.name : '';
    }

    _consolidate_host(host_nodes) {
        host_nodes.forEach(item => this._update_status(item));
        // for now we take the first storage node, and use it as the host_item, with some modifications
        // TODO: once we have better understanding of what the host status should be
        // as a result of the status of the nodes we need to change it.
        let root_item = host_nodes.find(item =>
            item.node.drives && item.node.drives[0] &&
            (item.node.drives[0].mount === '/' || item.node.drives[0].mount.toLowerCase() === 'c:')
        );
        if (!root_item) {
            // if for some reason root node not found, take the first one.
            dbg.log1(`could not find node for root path, taking the first in the list. drives = ${host_nodes.map(item => item.node.drives[0])}`);
            root_item = host_nodes[0];
        }
        const host_item = _.clone(root_item);
        host_item.node = _.cloneDeep(host_item.node);
        host_item.storage_nodes = host_nodes;

        // fix some of the fields:
        // host is online if at least one node is online
        host_item.online = host_nodes.some(item => item.online);
        // host is considered decommisioned if all nodes are decomissioned
        host_item.node.decommissioned = host_nodes.every(item => item.node.decommissioned);
        // if host is not decommissioned and all nodes are either decommissioned or decommissioning
        // than the host is decommissioning
        host_item.node.decommissioning = !host_item.node.decommissioned &&
            host_nodes.every(item => item.node.decommissioned || item.node.decommissioning);

        //trusted, and untrusted reasons if exist
        host_item.trusted = host_nodes.every(item => item.trusted !== false);
        if (!host_item.trusted) {
            host_item.untrusted_reasons = _.map(
                _.filter(host_nodes, item => !item.trusted),
                untrusted_item => {
                    let reason = {
                        events: [],
                        drive: untrusted_item.node.drives[0]
                    };
                    if (untrusted_item.node.permission_tempering) {
                        reason.events.push({
                            event: 'PERMISSION_EVENT',
                            time: untrusted_item.node.permission_tempering
                        });
                    }
                    if (untrusted_item.node.issues_report) {
                        for (const issue of untrusted_item.node.issues_report) {
                            if (issue.reason === 'TAMPERING') {
                                reason.events.push({
                                    event: 'DATA_EVENT',
                                    time: issue.time
                                });
                            }
                        }
                    }
                    return reason;
                });
        }

        host_item.migrating_to_pool = host_nodes.some(item => item.node.migrating_to_pool);
        host_item.n2n_errors = host_nodes.some(item => item.n2n_errors);
        host_item.gateway_errors = host_nodes.some(item => item.gateway_errors);
        host_item.io_test_errors = host_nodes.some(item => item.io_test_errors);
        host_item.io_reported_errors = host_nodes.some(item => item.io_reported_errors);
        host_item.has_issues = false; // if true it causes storage count to be 0. not used by the UI.

        // aggregate data used by suggested pools classification
        host_item.avg_ping = _.mean(host_nodes.map(item => item.avg_ping));
        host_item.avg_disk_read = _.mean(host_nodes.map(item => item.avg_disk_read));
        host_item.avg_disk_write = _.mean(host_nodes.map(item => item.avg_disk_write));


        let host_aggragate = this._aggregate_nodes_list(host_nodes);
        host_item.node.storage = host_aggragate.storage;
        host_item.storage_nodes.data_activities = host_aggragate.data_activities;
        host_item.node.drives = _.flatMap(host_nodes, item => item.node.drives);

        this._calculate_host_mode(host_item);

        return host_item;
    }

    _calculate_host_mode(host_item) {
        const storage_nodes = host_item.storage_nodes;

        // aggregate storage nodes and s3 nodes info
        const MB = 1024 ** 2;
        const storage = host_item.node.storage;
        const free = size_utils.json_to_bigint(storage.free);
        const used = size_utils.json_to_bigint(storage.used);
        const free_ratio = free.add(used).isZero() ?
            BigInteger.zero :
            free.multiply(100).divide(free.add(used));
        // storage mode is implemented by https://docs.google.com/spreadsheets/d/1-q1U57jmKNLt0XML-1MLaPgBFli_c_T5OEkKvzB5Txk/edit#gid=618998419
        if (storage_nodes.length) {
            const {
                DECOMMISSIONED = 0,
                    OFFLINE = 0,
                    DELETING = 0,
                    UNTRUSTED = 0,
                    STORAGE_NOT_EXIST = 0,
                    IO_ERRORS = 0,
                    N2N_ERRORS = 0,
                    GATEWAY_ERRORS = 0,
                    INITIALIZING = 0,
                    DECOMMISSIONING = 0,
                    MIGRATING = 0,
                    N2N_PORTS_BLOCKED = 0
            } = _.mapValues(_.groupBy(storage_nodes, i => i.mode), arr => arr.length);
            const enabled_nodes_count = storage_nodes.length - DECOMMISSIONED;

            host_item.storage_nodes_mode =
                (!enabled_nodes_count && 'DECOMMISSIONED') || // all decommissioned
                (DELETING && 'DELETING') ||
                (OFFLINE === enabled_nodes_count && 'OFFLINE') || // all offline
                (UNTRUSTED && 'UNTRUSTED') ||
                (STORAGE_NOT_EXIST === enabled_nodes_count && 'STORAGE_NOT_EXIST') || // all unmounted
                (IO_ERRORS === enabled_nodes_count && 'IO_ERRORS') || // all have io-errors
                (N2N_ERRORS && 'N2N_ERRORS') || // some N2N errors - reflects all host has N2N errors
                (GATEWAY_ERRORS && 'GATEWAY_ERRORS') || // some gateway errors - reflects all host has gateway errors
                (INITIALIZING === enabled_nodes_count && 'INITIALIZING') || // all initializing
                (DECOMMISSIONING === enabled_nodes_count && 'DECOMMISSIONING') || // all decommissioning
                (MIGRATING === enabled_nodes_count && 'MIGRATING') || // all migrating
                (MIGRATING && !INITIALIZING && !DECOMMISSIONING && 'SOME_STORAGE_MIGRATING') || // some migrating
                (INITIALIZING && !MIGRATING && !DECOMMISSIONING && 'SOME_STORAGE_INITIALIZING') || // some initializing
                (DECOMMISSIONING && !INITIALIZING && !MIGRATING && 'SOME_STORAGE_DECOMMISSIONING') || // some decommissioning
                ((DECOMMISSIONING || INITIALIZING || MIGRATING) && 'IN_PROCESS') || // mixed in process
                (OFFLINE && 'SOME_STORAGE_OFFLINE') || //some offline
                (STORAGE_NOT_EXIST && 'SOME_STORAGE_NOT_EXIST') || // some unmounted
                (IO_ERRORS && 'SOME_STORAGE_IO_ERRORS') || // some have io-errors
                (free.lesserOrEquals(MB) && 'NO_CAPACITY') ||
                (free_ratio.lesserOrEquals(20) && 'LOW_CAPACITY') ||
                (N2N_PORTS_BLOCKED && 'N2N_PORTS_BLOCKED') ||
                'OPTIMAL';
        } else {
            host_item.storage_nodes_mode = 'OPTIMAL'; // if no storage nodes, consider storage mode as optimal
        }

        const storage_mode = host_item.storage_nodes_mode;
        host_item.mode = storage_mode;
    }


    _get_filter_item_func(query) {
        // we are generating a function that will implement most of the query
        // so that we can run it on every node item, and minimize the compare work.
        let code = '';
        if ((query.strictly_cloud_nodes && query.skip_cloud_nodes) ||
            (query.strictly_mongo_nodes && query.skip_mongo_nodes) ||
            (query.strictly_internal && query.skip_internal)) { // I mean... srsly
            code += 'return false; ';
        }
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
        if (query.skip_no_address) {
            code += `if (!item.node.rpc_address) return false; `;
        }
        if (query.strictly_cloud_nodes) {
            code += `if (!item.node.is_cloud_node) return false; `;
        }
        if (query.skip_cloud_nodes) {
            code += `if (item.node.is_cloud_node) return false; `;
        }
        if (query.strictly_mongo_nodes) {
            code += `if (!item.node.is_mongo_node) return false; `;
        }
        if (query.skip_mongo_nodes) {
            code += `if (item.node.is_mongo_node) return false; `;
        }
        if (query.strictly_internal) {
            code += `if (!item.node.is_internal_node) return false; `;
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
        return new Function('item', code);
    }


    _sort_nodes_list(list, options) {
        if (!options || !options.sort) return;
        if (options.sort === 'name') {
            list.sort(js_utils.sort_compare_by(item => String(item.node.name), options.order));
        } else if (options.sort === 'ip') {
            list.sort(js_utils.sort_compare_by(item => net_utils.ip_to_long(item.node.ip), options.order));
        } else if (options.sort === 'has_issues') {
            list.sort(js_utils.sort_compare_by(item => Boolean(item.has_issues), options.order));
        } else if (options.sort === 'online') {
            list.sort(js_utils.sort_compare_by(item => Boolean(item.online), options.order));
        } else if (options.sort === 'trusted') {
            list.sort(js_utils.sort_compare_by(item => Boolean(item.trusted), options.order));
        } else if (options.sort === 'used') {
            list.sort(js_utils.sort_compare_by(item => (item.node.storage.total - item.node.storage.free), options.order));
        } else if (options.sort === 'accessibility') {
            list.sort(js_utils.sort_compare_by(item => item.accessibility, options.order));
        } else if (options.sort === 'connectivity') {
            list.sort(js_utils.sort_compare_by(item => item.connectivity, options.order));
        } else if (options.sort === 'data_activity') {
            list.sort(js_utils.sort_compare_by(item => _.get(item, 'data_activity.reason', ''), options.order));
        } else if (options.sort === 'mode') {
            list.sort(js_utils.sort_compare_by(item => MODE_COMPARE_ORDER.indexOf(item.mode), options.order));
        } else if (options.sort === 'pool') {
            list.sort(js_utils.sort_compare_by(item => system_store.data.get_by_id(item.node.pool).name, options.order));
        } else if (options.sort === 'recommended') {
            list.sort(js_utils.sort_compare_by(item => item.suggested_pool === options.recommended_hint, options.order));
        } else if (options.sort === 'healthy_drives') {
            list.sort(js_utils.sort_compare_by(item => _.countBy(item.storage_nodes, 'mode').OPTIMAL || 0, options.order));
        } else if (options.sort === 'services') {
            list.sort(js_utils.sort_compare_by(item =>
                (['DECOMMISSIONED', 'DECOMMISSIONING'].includes(item.storage_nodes_mode) ? 0 : 1),
                options.order
            ));
        } else if (options.sort === 'shuffle') {
            chance.shuffle(list);
        }
    }

    _paginate_nodes_list(list, options) {
        const { skip = 0, limit = list.length } = options;
        return list.slice(skip, skip + limit);
    }

    // _suggest_pool_assign() {
    //     // prepare nodes data per pool
    //     const pools_data_map = new Map();
    //     for (const host_nodes of this._map_host_id.values()) {
    //         // get the host aggregated item
    //         const item = this._consolidate_host(host_nodes);
    //         item.suggested_pool = ''; // reset previous suggestion
    //         const host_id = String(item.node.host_id);
    //         const pool_id = String(item.node.pool);
    //         const pool = system_store.data.get_by_id(pool_id);
    //         dbg.log3('_suggest_pool_assign: node', item.node.name, 'pool', pool && pool.name);
    //         // skip new nodes and cloud\internal nodes
    //         if (pool && item.node_from_store && item.node.node_type === 'BLOCK_STORE_FS') {
    //             let pool_data = pools_data_map.get(pool_id);
    //             if (!pool_data) {
    //                 pool_data = {
    //                     pool_id: pool_id,
    //                     pool_name: pool.name,
    //                     docs: []
    //                 };
    //                 pools_data_map.set(pool_id, pool_data);
    //             }
    //             const tokens = this._classify_node_tokens(item);
    //             pool_data.docs.push(new dclassify.Document(host_id, tokens));
    //         }
    //     }

    //     // take the data of all the pools and use it to train a classifier of nodes to pools
    //     const data_set = new dclassify.DataSet();
    //     const classifier = new dclassify.Classifier({
    //         applyInverse: true
    //     });
    //     const pools_to_classify = ['default_resource', config.NEW_SYSTEM_POOL_NAME];
    //     let num_trained_pools = 0;
    //     for (const pool_data of pools_data_map.values()) {
    //         // don't train by the nodes that we need to classify
    //         if (!pools_to_classify.includes(pool_data.pool_name)) {
    //             dbg.log3('_suggest_pool_assign: add to data set',
    //                 pool_data.pool_name, pool_data.docs);
    //             data_set.add(pool_data.pool_name, pool_data.docs);
    //             num_trained_pools += 1;
    //         }
    //     }
    //     if (num_trained_pools <= 0) {
    //         dbg.log3('_suggest_pool_assign: no pools to suggest');
    //         return;
    //     } else if (num_trained_pools === 1) {
    //         // the classifier requires at least two options to work
    //         dbg.log3('_suggest_pool_assign: only one pool to suggest,',
    //             'too small for real suggestion');
    //         return;
    //     }
    //     classifier.train(data_set);
    //     dbg.log3('_suggest_pool_assign: Trained:', classifier,
    //         'probabilities', JSON.stringify(classifier.probabilities));

    //     // for nodes in the default_resource use the classifier to suggest a pool
    //     const system = system_store.data.systems[0];
    //     const target_pool = system.pools_by_name[config.NEW_SYSTEM_POOL_NAME];
    //     const target_pool_data = pools_data_map.get(String(target_pool._id));
    //     if (target_pool_data) {
    //         for (const doc of target_pool_data.docs) {
    //             const host_nodes = this._map_host_id.get(doc.id);
    //             const hostname = this._item_hostname(host_nodes[0]);
    //             dbg.log0('_suggest_pool_assign: classify start', hostname, doc);
    //             const res = classifier.classify(doc);
    //             dbg.log0('_suggest_pool_assign: classify result', hostname, res);
    //             let suggested_pool;
    //             if (res.category !== config.NEW_SYSTEM_POOL_NAME) {
    //                 suggested_pool = res.category;
    //             } else if (res.secondCategory !== config.NEW_SYSTEM_POOL_NAME) {
    //                 suggested_pool = res.secondCategory;
    //             }
    //             host_nodes.forEach(item => {
    //                 item.suggested_pool = suggested_pool;
    //             });

    //         }

    //     }
    // }

    _classify_node_tokens(item) {
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
        return tokens;
    }

    list_nodes(query, options) {
        dbg.log2('list_nodes: query', query);
        this._throw_if_not_started_and_loaded();
        const filter_res = this._filter_nodes(query);
        const list = filter_res.list;
        this._sort_nodes_list(list, options);
        const res_list = options && options.pagination ?
            this._paginate_nodes_list(list, options) : list;
        dbg.log2('list_nodes', res_list.length, '/', list.length);

        return {
            total_count: list.length,
            filter_counts: filter_res.filter_counts,
            nodes: _.map(res_list, item =>
                this._get_node_info(item, options && options.fields)),
        };
    }


    list_hosts(query, options) {
        dbg.log2('list_hosts: query', query);
        this._throw_if_not_started_and_loaded();
        const { list, mode_counters } = this._filter_hosts(query);
        this._sort_nodes_list(list, options);
        const { skip, limit } = options || {};
        const res_list = _.isUndefined(skip && limit) ? list : this._paginate_nodes_list(list, options);
        dbg.log2('list_hosts', res_list.length, '/', list.length);

        return {
            counters: {
                non_paginated: list.length,
                by_mode: mode_counters
            },
            hosts: _.map(res_list, item =>
                this._get_host_info(item, options.adminfo)),
        };
    }

    async get_nodes_stats(system, start_date, end_date) {
        const nodes_stats = await IoStatsStore.instance().get_all_nodes_stats({ system, start_date, end_date });
        return _.keyBy(nodes_stats, stat => String(stat._id));
    }

    async _get_nodes_stats_by_service(system_id, start_date, end_date, include_kubernetes) {
        const all_nodes_stats = await this.get_nodes_stats(system_id, start_date, end_date);
        const grouped_stats = _.omit(_.groupBy(all_nodes_stats, stat => {
            const item = this._map_node_id.get(String(stat._id));
            if (!item) {
                // handle deleted nodes later
                return 'DELETED';
            }
            const pool = system_store.data.get_by_id(item.node.pool);
            if (!pool) {
                // handle deleted pools later
                return 'DELETED';
            }
            let endpoint_type = _.get(pool, 'cloud_pool_info.endpoint_type') || 'OTHER';
            if (include_kubernetes && this._is_kubernetes_node(item)) endpoint_type = 'KUBERNETES';
            return endpoint_type;
        }), 'OTHER');

        const deleted_stats = grouped_stats.DELETED || [];
        // handle deleted nodes and pools
        for (const stat of deleted_stats) {
            const node = (await NodesStore.instance().find_nodes({ _id: stat._id }))[0];
            if (!node) continue;
            let pool = system_store.data.get_by_id(node.pool);
            if (!pool) {
                const deleted_pool = await system_store.data.get_by_id_include_deleted(node.pool, 'pools');
                pool = deleted_pool && deleted_pool.record;
            }
            if (!pool) continue;
            let endpoint_type = _.get(pool, 'cloud_pool_info.endpoint_type') || 'OTHER';
            if (include_kubernetes && this._is_kubernetes_node({ node })) endpoint_type = 'KUBERNETES';
            grouped_stats[endpoint_type] = grouped_stats[endpoint_type] || [];
            grouped_stats[endpoint_type].push(stat);
        }

        const ret = _.map(_.omit(grouped_stats, 'DELETED'), (stats, service) => {
            const reduced_stats = stats.reduce((prev, current) => ({
                read_count: prev.read_count + (current.read_count || 0),
                write_count: prev.write_count + (current.write_count || 0),
                read_bytes: prev.read_bytes + (current.read_bytes || 0),
                write_bytes: prev.write_bytes + (current.write_bytes || 0),
            }), {
                read_count: 0,
                write_count: 0,
                read_bytes: 0,
                write_bytes: 0,
            });
            reduced_stats.service = service;
            return reduced_stats;
        });
        return ret;
    }


    async get_nodes_stats_by_cloud_service(req) {
        return this._get_nodes_stats_by_service(
            req.system._id,
            req.rpc_params.start_date,
            req.rpc_params.end_date,
            /* include_kubernetes */
            false
        );
    }

    _aggregate_nodes_list(list, nodes_stats) {
        let count = 0;
        let storage_count = 0;
        let online = 0;
        let storage_online = 0;
        const by_mode = {};
        const storage_by_mode = {};

        const io_stats = {
            read_count: 0,
            write_count: 0,
            read_bytes: 0,
            write_bytes: 0,
            error_read_count: 0,
            error_write_count: 0,
            error_read_bytes: 0,
            error_write_bytes: 0,
        };
        let storage = {
            total: 0,
            free: 0,
            used: 0,
            reserved: 0,
            unavailable_free: 0,
            unavailable_used: 0,
            used_other: 0,
        };
        const data_activities = {};
        _.each(list, item => {
            count += 1;
            storage_count += 1;
            storage_by_mode[item.mode] = (storage_by_mode[item.mode] || 0) + 1;
            if (item.online) storage_online += 1;

            by_mode[item.mode] = (by_mode[item.mode] || 0) + 1;
            if (item.online) online += 1;

            if (item.data_activity && !item.data_activity.done) {
                const act = item.data_activity;
                const a = data_activities[act.reason] || {
                    reason: act.reason,
                    count: 0,
                    progress: 0,
                    time: {
                        start: act.time.start,
                        end: act.time.end,
                    }
                };
                a.count += 1;
                a.time.start = Math.min(a.time.start, act.time.start);
                a.time.end = Math.max(a.time.end, act.time.end || Infinity);
                data_activities[act.reason] = a;
            }

            const node_storage = this._node_storage_info(item);
            _.forIn(storage, (value, key) => {
                storage[key] = size_utils.reduce_sum(key, [node_storage[key], value]);
            });

            if (nodes_stats) {
                const node_io_stats = nodes_stats[String(item.node._id)];
                if (node_io_stats) _.mergeWith(io_stats, node_io_stats, _.add);
            }

        });

        const now = Date.now();
        return {
            nodes: {
                count,
                // storage_count,
                online,
                by_mode,
            },
            storage_nodes: {
                // count,
                count: storage_count,
                online: storage_online,
                by_mode: storage_by_mode,
            },
            storage,
            data_activities: _.map(data_activities, a => {
                if (!Number.isFinite(a.time.end)) delete a.time.end;
                a.progress = progress_by_time(a.time, now);
                return a;
            }),
            io_stats: nodes_stats ? io_stats : undefined
        };
    }


    _aggregate_hosts_list(list) {
        let count = 0;
        let online = 0;
        const by_mode = {};
        const storage_by_mode = {};
        const by_service = { STORAGE: 0 };
        let storage = {
            total: 0,
            free: 0,
            used: 0,
            reserved: 0,
            unavailable_free: 0,
            unavailable_used: 0,
            used_other: 0,
        };
        const data_activities = {};
        let data_activity_host_count = 0;
        _.each(list, item => {
            count += 1;
            by_mode[item.mode] = (by_mode[item.mode] || 0) + 1;
            storage_by_mode[item.storage_nodes_mode] = (storage_by_mode[item.storage_nodes_mode] || 0) + 1;
            by_service.STORAGE += item.storage_nodes && item.storage_nodes.every(i => i.node.decommissioned) ? 0 : 1;
            if (item.online) online += 1;
            let has_activity = false;
            for (const storage_item of item.storage_nodes || []) {
                if (storage_item.data_activity && !storage_item.data_activity.done) {
                    has_activity = true;
                    const act = storage_item.data_activity;
                    const a = data_activities[act.reason] || {
                        reason: act.reason,
                        count: 0,
                        progress: 0,
                        time: {
                            start: act.time.start,
                            end: act.time.end,
                        }
                    };
                    a.count += 1;
                    a.time.start = Math.min(a.time.start, act.time.start);
                    a.time.end = Math.max(a.time.end, act.time.end || Infinity);
                    data_activities[act.reason] = a;
                }
            }
            if (has_activity) {
                data_activity_host_count += 1;
            }

            const node_storage = item.node.storage;
            _.forIn(storage, (value, key) => {
                storage[key] = size_utils.reduce_sum(key, [node_storage[key], value]);
            });
        });

        const now = Date.now();
        return {
            nodes: {
                count,
                online,
                by_mode,
                by_service,
                storage_by_mode,
                data_activity_host_count
            },
            storage: storage,
            data_activities: _.map(data_activities, a => {
                if (!Number.isFinite(a.time.end)) delete a.time.end;
                a.progress = progress_by_time(a.time, now);
                return a;
            })
        };
    }

    aggregate_hosts(query, group_by) {
        this._throw_if_not_started_and_loaded();
        const list = this._filter_hosts(query).list;
        const res = this._aggregate_hosts_list(list);
        if (group_by) {
            if (group_by === 'pool') {
                const pool_groups = _.groupBy(list,
                    item => String(item.node.pool));
                res.groups = _.mapValues(pool_groups,
                    items => this._aggregate_hosts_list(items));
            } else {
                throw new Error('aggregate_hosts: Invalid group_by ' + group_by);
            }
        }
        return res;
    }

    aggregate_nodes(query, group_by, nodes_stats) {
        this._throw_if_not_started_and_loaded();
        const list = this._filter_nodes(query).list;
        const res = this._aggregate_nodes_list(list);
        if (group_by) {
            if (group_by === 'pool') {
                const pool_groups = _.groupBy(list,
                    item => String(item.node.pool));
                res.groups = _.mapValues(pool_groups,
                    items => this._aggregate_nodes_list(items, nodes_stats));
            } else {
                throw new Error('aggregate_nodes: Invalid group_by ' + group_by);
            }
        }
        return res;
    }


    _get_host_info(host_item, adminfo) {
        let info = {
            storage_nodes_info: {
                nodes: host_item.storage_nodes
                    .filter(item => Boolean(item.node_from_store))
                    .map(item => {
                        this._update_status(item);
                        return this._get_node_info(item);
                    })
            }
        };
        info.storage_nodes_info.mode = host_item.storage_nodes_mode;
        info.storage_nodes_info.enabled = host_item.storage_nodes.some(item => !item.node.decommissioned && !item.node.decommissioning);
        info.storage_nodes_info.data_activities = host_item.storage_nodes.data_activities;

        // collect host info
        info.name = this._item_hostname(host_item) + '#' + host_item.node.host_sequence;
        const pool = system_store.data.get_by_id(host_item.node.pool);
        info.pool = pool ? pool.name : '';
        info.geolocation = host_item.node.geolocation;
        info.ip = host_item.node.ip;
        if (host_item.node.public_ip) {
            info.public_ip = host_item.node.public_ip;
        }
        info.version = host_item.node.version;
        info.version_install_time = host_item.node.version_install_time;
        info.last_communication = host_item.node.heartbeat;
        info.trusted = host_item.trusted;
        info.untrusted_reasons = host_item.untrusted_reasons;
        info.hideable = host_item.hideable;
        info.connectivity = host_item.connectivity;
        info.storage = host_item.node.storage;
        info.os_info = _.defaults({}, host_item.node.os_info);
        if (info.os_info.uptime) {
            info.os_info.uptime = new Date(info.os_info.uptime).getTime();
        }
        if (info.os_info.last_update) {
            info.os_info.last_update = new Date(info.os_info.last_update).getTime();
        }
        info.os_info.cpu_usage = Math.max(host_item.cpu_usage, host_item.node.cpu_usage) || 0;
        info.process_cpu_usage = host_item.node.cpu_usage;
        info.process_mem_usage = host_item.node.mem_usage;
        info.rpc_address = host_item.node.rpc_address;
        info.latency_to_server = host_item.node.latency_to_server;
        const debug_time = host_item.node.debug_mode ?
            Math.max(0, config.DEBUG_MODE_PERIOD - (Date.now() - host_item.node.debug_mode)) :
            undefined;
        info.debug = {
            level: host_item.node.debug_level,
            time_left: debug_time
        };
        info.suggested_pool = host_item.suggested_pool;
        info.mode = host_item.mode;

        const port_range = (host_item.node.n2n_config || {}).tcp_permanent_passive;
        if (port_range) {
            info.ports = {
                range: port_range
            };
        }
        info.base_address = host_item.node.base_address;
        return info;
    }

    _is_host_hideable(host_nodes) {
        if (!_.every(host_nodes, item => item.node.deleting)) return false;
        if (_.some(host_nodes, item => item.online)) return false; // node is online
        const nodes_activity_stage = _.flatMap(host_nodes, node => node.data_activity && node.data_activity.stage.name);
        if (_.some(nodes_activity_stage, node_stage => (
                node_stage === STAGE_OFFLINE_GRACE ||
                node_stage === STAGE_REBUILDING
            ))) {
            return false;
        }
        return true;
    }

    _get_node_info(item, fields) {
        const node = item.node;
        const info = _.defaults(
            _.pick(item, MONITOR_INFO_FIELDS),
            _.pick(node, NODE_INFO_FIELDS),
            NODE_INFO_DEFAULTS);
        info._id = String(node._id);
        info.peer_id = String(node.peer_id);

        /*
        This is a quick fix to prevent throwing exception when
        getting pool infromation for an internal cloud node that refers to
        a deleted cloud pool.
        This happens when quering the activity log.
        */
        const pool = system_store.data.get_by_id(node.pool);
        info.pool = pool ? pool.name : '';

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
            if (info.data_activity.time && !Number.isFinite(info.data_activity.time.end)) {
                delete info.data_activity.time.end;
            }
            if (info.data_activity.stage.time && !Number.isFinite(info.data_activity.stage.time.end)) {
                delete info.data_activity.stage.time.end;
            }
        }
        info.storage = this._node_storage_info(item);
        info.drive = {
            mount: _.get(node, 'drives[0].mount', '[Unknown Mount]'),
            drive_id: _.get(node, 'drives[0].drive_id', '[Unknown Drive]'),
        };
        info.os_info = _.defaults({}, node.os_info);
        if (info.os_info.uptime) {
            info.os_info.uptime = new Date(info.os_info.uptime).getTime();
        }
        if (info.os_info.last_update) {
            info.os_info.last_update = new Date(info.os_info.last_update).getTime();
        }
        info.host_seq = String(item.node.host_sequence);

        if (!node.trusted) {
            info.untrusted_reasons = [];
            if (node.permission_tempering) {
                info.untrusted_reasons.push({
                    event: 'PERMISSION_EVENT',
                    time: node.permission_tempering
                });
            }
            if (node.issues_report) {
                for (const issue of node.issues_report) {
                    if (issue.reason === 'TAMPERING') {
                        info.untrusted_reasons.push({
                            event: 'DATA_EVENT',
                            time: issue.time
                        });
                    }
                }
            }
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
            dbg.error('NO_SUCH_NODE', JSON.stringify(node_identity));
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
        //if (!item) {
        // TODO do the hockey pocky in the cluster like was in redirector
        //}
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
        const server_api = proxy_params.method_api.slice(0, -4); //Remove _api suffix
        const method_name = proxy_params.method_name;

        if (proxy_params.request_params) {
            proxy_params.request_params[RPC_BUFFERS] = proxy_params[RPC_BUFFERS];
        }

        return this.client[server_api][method_name](
                proxy_params.request_params, {
                    connection: item.connection
                }
            )
            .then(reply => ({
                proxy_reply: js_utils.omit_symbol(reply, RPC_BUFFERS),
                [RPC_BUFFERS]: reply && reply[RPC_BUFFERS],
            }));
    }

    /*
     * GET_RANDOM_TEST_NODES
     * return X random nodes for self test purposes
     */
    get_test_nodes(req) {
        const list_res = this.list_nodes({
            system: String(req.system._id),
            online: true,
            decommissioning: false,
            decommissioned: false,
            deleting: false,
            deleted: false,
            skip_address: req.rpc_params.source,
            skip_cloud_nodes: true,
            skip_mongo_nodes: true,
            skip_internal: true
        }, {
            pagination: true,
            limit: req.rpc_params.count,
            sort: 'shuffle'
        });
        const { rpc_params } = req;
        const item = this._get_node({
            rpc_address: rpc_params.source
        });
        this._dispatch_node_event(item, 'test_node',
            `Node ${this._item_hostname(item)} was tested by ${req.account && req.account.email.unwrap()}`, req.account && req.account._id);
        return _.map(list_res.nodes,
            node => _.pick(node, 'name', 'rpc_address'));
    }

    test_node_network(req) {
        const { rpc_params } = req;
        dbg.log1('test_node_network:', rpc_params);
        this._throw_if_not_started_and_loaded();
        const item = this._get_node({
            rpc_address: rpc_params.source
        });
        return P.timeout(AGENT_RESPONSE_TIMEOUT,
                this.client.agent.test_network_perf_to_peer(rpc_params, {
                    connection: item.connection
                })
            )
            .then(res => {
                dbg.log2('test_node_network', rpc_params, 'returned', res);
                return res;
            });
    }

    collect_agent_diagnostics(node_identity) {
        this._throw_if_not_started_and_loaded();
        const item = this._get_node(node_identity);
        return server_rpc.client.agent.collect_diagnostics(undefined, {
            connection: item.connection,
        });
    }

    collect_host_diagnostics(name) {
        this._throw_if_not_started_and_loaded();

        // TODO: Currently returning diag only for the first agent,
        // need to support multi agent diagnostics with shared part and
        // specific parts.
        const firstItem = this._get_host_nodes_by_name(name).find(item => {
            this._update_status(item);
            return item.online;
        });

        if (!firstItem) {
            throw new RpcError('Host Offline');
        }

        const { connection } = firstItem;
        return server_rpc.client.agent.collect_diagnostics(undefined, { connection })
            .then(res => res[RPC_BUFFERS].data);
    }

    set_debug_host(req) {
        this._throw_if_not_started_and_loaded();
        const { name, level } = req.rpc_params;
        const host_nodes = this._get_host_nodes_by_name(name);
        if (!host_nodes || !host_nodes.length) throw new RpcError('BAD_REQUEST', `No such host ${name}`);
        return P.map(host_nodes, item => this._set_agent_debug_level(item, level))
            .then(() => {
                dbg.log1('set_debug_node was successful for host', name, 'level', level);
                Dispatcher.instance().activity({
                    system: req.system._id,
                    level: 'info',
                    event: 'dbg.set_debug_node',
                    actor: req.account && req.account._id,
                    node: host_nodes[0].node._id,
                    desc: `${name} debug level was raised by ${req.account && req.account.email.unwrap()}`,
                });
                dbg.log1('set_debug_node was successful for host', name, 'level', level);
            });

    }

    set_debug_node(req) {
        this._throw_if_not_started_and_loaded();
        const { level, node } = req.rpc_params;
        const item = this._get_node(node);
        return this._set_agent_debug_level(item, level)
            .then(() => {
                Dispatcher.instance().activity({
                    system: req.system._id,
                    level: 'info',
                    event: 'dbg.set_debug_node',
                    actor: req.account && req.account._id,
                    node: item.node._id,
                    desc: `${item.node.name} debug level was raised by ${req.account && req.account.email.unwrap()}`,
                });
                dbg.log1('set_debug_node was successful for agent', item.node.name,
                    'level', level);
            });
    }

    allocate_nodes(params) {
        this._throw_if_not_started_and_loaded();
        const pool_id = String(params.pool_id);
        const list = [];
        for (const item of this._map_node_id.values()) {
            this._update_status(item);
            if (!item.node_from_store) continue;
            if (!item.writable) continue;
            if (String(item.node.pool) !== String(pool_id)) continue;
            list.push(item);
        }

        const latency_groups = [];
        // Not all nodes always have the avg_disk_write.
        // KMeans needs valid vectors so we exclude the nodes and assume that they are the slowest
        // Since we assume them to be the slowest we will place them in the last KMeans group
        const partition_avg_disk_write = _.partition(list, item => !Number.isNaN(item.avg_disk_write) && _.isNumber(item.avg_disk_write));
        const nodes_with_avg_disk_write = partition_avg_disk_write[0];
        const nodes_without_avg_disk_write = partition_avg_disk_write[1];
        if (nodes_with_avg_disk_write.length >= config.NODE_ALLOCATOR_NUM_CLUSTERS) {
            // TODO:
            // Not handling noise at all.
            // This means that we can have a group of 1 noisy drive.
            // I rely on avg_disk_write as an average reading to handle any noise.
            const kmeans_clusters = kmeans.run(
                nodes_with_avg_disk_write.map(item => [item.avg_disk_write]), {
                    k: config.NODE_ALLOCATOR_NUM_CLUSTERS
                }
            );

            // Sort the groups by latency (centroid is the computed centralized latency for each group)
            kmeans_clusters.sort(js_utils.sort_compare_by(item => item.centroid[0], 1));

            kmeans_clusters.forEach(kmeans_cluster =>
                latency_groups.push(kmeans_cluster.clusterInd.map(index => list[index]))
            );

            if (nodes_without_avg_disk_write.length) {
                latency_groups[latency_groups.length - 1] =
                    _.concat(latency_groups[latency_groups.length - 1], nodes_without_avg_disk_write);
            }

        } else {
            latency_groups.push(list);
        }

        const lg_res = latency_groups.map(cluster => {
            const max = 1000;
            // This is done in order to get the most unused or free drives
            // Since we sclice the response up to 1000 drives
            cluster.sort(js_utils.sort_compare_by(item => item.node.storage.used, 1));
            const nodes_set = (cluster.length < max) ? cluster : cluster.slice(0, max);
            return {
                nodes: nodes_set.map(item => this._get_node_info(item, params.fields))
            };
        });

        return {
            latency_groups: _.isEmpty(lg_res) ? [{ nodes: [] }] : lg_res
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
            // when the error is NO SPACE we don't want to push the issue
            // because we don't need to put the node in detention
            if (block_report.rpc_code === 'NO_BLOCK_STORE_SPACE') continue; // TODO SYNC STORAGE SPACE WITH THE NODE...
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
            // only disconnect if enough time passed since last disconnect to avoid amplification of errors in R\W flows
            const DISCONNECT_GRACE_PERIOD = 2 * 60 * 1000; // 2 minutes grace before another disconnect
            if (!item.disconnect_time || item.disconnect_time + DISCONNECT_GRACE_PERIOD < Date.now()) {
                dbg.log0('disconnecting node to force reconnect. node:', item.node.name);
                this._disconnect_node(item);
            }
        }
    }

    _set_agent_debug_level(item, debug_level) {
        item.node.debug_level = debug_level;
        this._set_need_update.add(item);
        return server_rpc.client.agent.set_debug_node({
                level: debug_level
            }, {
                connection: item.connection,
            })
            .then(() => {
                item.node.debug_mode = debug_level > 0 ? Date.now() : undefined;
            });
    }

    _node_storage_info(item) {
        const disk_total = size_utils.json_to_bigint(item.node.storage.total || 0);
        const disk_free = BigInteger.max(size_utils.json_to_bigint(item.node.storage.free || 0), BigInteger.zero);
        const disk_used = disk_total.minus(disk_free);

        const nb_used = size_utils.json_to_bigint(item.node.storage.used || 0);
        const used_other = BigInteger.max(BigInteger.zero, disk_used.minus(nb_used));

        // calculate nb_reserved: it's complex.
        const ignore_reserve = item.node.is_internal_node || item.node.is_cloud_node || item.node.is_mongo_node;
        const reserved_config = ignore_reserve ?
            BigInteger.zero :
            size_utils.json_to_bigint(config.NODES_FREE_SPACE_RESERVE || 0);
        const nb_limit = BigInteger.min(
            item.node.storage.limit ? size_utils.json_to_bigint(item.node.storage.limit) : disk_total,
            disk_total.minus(reserved_config)
        );
        const reserved_free = disk_total.minus(nb_limit).minus(used_other);
        const nb_reserved = BigInteger.min(
            disk_free,
            BigInteger.max(reserved_free, reserved_config)
        );

        let nb_free = disk_free.minus(nb_reserved);

        let unavailable_free = BigInteger.zero;
        let unavailable_used = BigInteger.zero;
        if (item.has_issues) {
            if (item.node.enabled) unavailable_free = nb_free;
            nb_free = BigInteger.zero;
            // unavailable_used is sent as indication to the frontend that used data is unavailable
            unavailable_used = nb_used;
        }

        //console.log('GGG _node_storage_info', { disk_total, disk_free, disk_used, nb_limit, nb_used, nb_free, nb_reserved });

        return size_utils.to_bigint_storage({
            total: disk_total,
            free: nb_free,
            used: nb_used,
            used_other,
            alloc: size_utils.json_to_bigint(item.node.storage.alloc || 0),
            limit: nb_limit,
            reserved: nb_reserved,
            unavailable_free,
            unavailable_used,
        });
    }

    _is_cloud_node(item) {
        const cloud_node_types = [
            'BLOCK_STORE_S3',
            'BLOCK_STORE_AZURE',
            'BLOCK_STORE_GOOGLE'
        ];
        return cloud_node_types.includes(item.node.node_type);
    }

    _is_kubernetes_node(item) {
        const kubernetes_node_types = [
            // 'BLOCK_STORE_MONGO',
            'BLOCK_STORE_FS',
        ];
        return kubernetes_node_types.includes(item.node.node_type);
    }

    _should_skip_uninstall(item) {
        return (
            item.node.is_cloud_node ||
            this._is_cloud_node(item) ||
            item.node.node_type === 'BLOCK_STORE_FS'
        );
    }
}

function scale_number_token(num) {
    return 2 ** Math.round(Math.log2(num));
}

function scale_size_token(size) {
    const scaled = Math.max(scale_number_token(size), size_utils.GIGABYTE);
    return size_utils.human_size(scaled);
}

function progress_by_time(time, now) {
    if (!time.end) return 0;
    return Math.min(1, Math.max(0,
        (now - time.start) / (time.end - time.start)
    ));
}

function is_localhost(address) {
    let addr_url = url.parse(address);
    return net_utils.is_localhost(addr_url.hostname);
}

// EXPORTS
exports.NodesMonitor = NodesMonitor;
