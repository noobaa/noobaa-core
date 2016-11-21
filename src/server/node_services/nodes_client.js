'use strict';

const _ = require('lodash');
const P = require('../../util/promise');
const promise_utils = require('../../util/promise_utils');
const dbg = require('../../util/debug_module')(__filename);
const server_rpc = require('../server_rpc');
const auth_server = require('../common_services/auth_server');
const mongo_utils = require('../../util/mongo_utils');
const node_allocator = require('./node_allocator');

const NODE_FIELDS_FOR_MAP = [
    'name',
    'pool',
    'ip',
    'host_id',
    'heartbeat',
    'rpc_address',
    'is_cloud_node',
    'online',
    'readable',
    'writable',
    'storage_full',
    'latency_of_disk_read',
    // ... more?
];


const MASTER_CHANGE_RETRIES = 10;

class NodesClient {



    list_nodes_by_system(system_id) {
        return promise_utils.retry(MASTER_CHANGE_RETRIES, 1, () => {
            return server_rpc.client.node.list_nodes({}, {
                    auth_token: auth_server.make_auth_token({
                        system_id: system_id,
                        role: 'admin'
                    }),
                    address: this._master_address
                })
                .tap(res => mongo_utils.fix_id_type(res.nodes))
                .catch(err => this._handle_master_change(err));
        });
    }

    list_nodes_by_pool(pool_name, system_id) {
        return promise_utils.retry(MASTER_CHANGE_RETRIES, 1, () => {
            return server_rpc.client.node.list_nodes({
                    query: {
                        pools: [pool_name]
                    }
                }, {
                    auth_token: auth_server.make_auth_token({
                        system_id: system_id,
                        role: 'admin'
                    }),
                    address: this._master_address
                })
                .tap(res => mongo_utils.fix_id_type(res.nodes))
                .catch(err => this._handle_master_change(err));
        });
    }

    aggregate_nodes_by_pool(pool_names, system_id, skip_cloud_nodes) {
        return promise_utils.retry(MASTER_CHANGE_RETRIES, 1, () => {
            const nodes_aggregate_pool = server_rpc.client.node.aggregate_nodes({
                    query: {
                        pools: pool_names || undefined,
                        skip_cloud_nodes: skip_cloud_nodes
                    },
                    group_by: 'pool'
                }, {
                    auth_token: auth_server.make_auth_token({
                        system_id: system_id,
                        role: 'admin'
                    }),
                    address: this._master_address
                })
                .catch(err => this._handle_master_change(err));
            return nodes_aggregate_pool;
        });
    }

    migrate_nodes_to_pool(system_id, node_identities, pool_id) {
        return promise_utils.retry(MASTER_CHANGE_RETRIES, 1, () => {
            return server_rpc.client.node.migrate_nodes_to_pool({
                nodes: node_identities,
                pool_id: String(pool_id)
            }, {
                auth_token: auth_server.make_auth_token({
                    system_id: system_id,
                    role: 'admin'
                }),
                address: this._master_address
            });
        });
    }

    collect_agent_diagnostics(node_identity, system_id) {
        return promise_utils.retry(MASTER_CHANGE_RETRIES, 1, () => {
            return server_rpc.client.node.collect_agent_diagnostics(node_identity, {
                    auth_token: auth_server.make_auth_token({
                        system_id: system_id,
                        role: 'admin'
                    }),
                    address: this._master_address
                })
                .catch(err => this._handle_master_change(err));

        });
    }

    // REMOTE CALLS

    read_node_by_name(system_id, node_name) {
        if (!system_id) {
            dbg.error('read_node_by_name: expected system_id. node_name', node_name);
            throw new Error('read_node_by_name: expected system_id');
        }
        return promise_utils.retry(MASTER_CHANGE_RETRIES, 1, () => {
            return server_rpc.client.node.read_node({
                    name: node_name
                }, {
                    auth_token: auth_server.make_auth_token({
                        system_id: system_id,
                        role: 'admin'
                    }),
                    address: this._master_address
                })
                .tap(node => mongo_utils.fix_id_type(node))
                .catch(err => this._handle_master_change(err));
        });
    }

    delete_node_by_name(system_id, node_name) {
        if (!system_id) {
            dbg.error('read_node_by_name: expected system_id. node_name', node_name);
            throw new Error('read_node_by_name: expected system_id');
        }
        return promise_utils.retry(MASTER_CHANGE_RETRIES, 1, () => {
            return server_rpc.client.node.delete_node({
                    name: node_name
                }, {
                    auth_token: auth_server.make_auth_token({
                        system_id: system_id,
                        role: 'admin'
                    }),
                    address: this._master_address
                })
                .catch(err => this._handle_master_change(err));
        });
    }

    allocate_nodes(system_id, pool_id) {
        if (!system_id) {
            dbg.error('allocate_nodes: expected system_id. pool_id', pool_id);
            throw new Error('allocate_nodes: expected system_id');
        }
        return promise_utils.retry(MASTER_CHANGE_RETRIES, 1, () => {
            return P.resolve(server_rpc.client.node.allocate_nodes({
                    pool_id: String(pool_id),
                    fields: NODE_FIELDS_FOR_MAP
                }, {
                    auth_token: auth_server.make_auth_token({
                        system_id: system_id,
                        role: 'admin'
                    }),
                    address: this._master_address
                }))
                .tap(res => mongo_utils.fix_id_type(res.nodes))
                .catch(err => this._handle_master_change(err));
        });
    }

    populate_nodes(system_id, docs, doc_path, fields) {
        const docs_list = docs && !_.isArray(docs) ? [docs] : docs;
        const ids = mongo_utils.uniq_ids(docs_list, doc_path);
        if (!ids.length) return P.resolve(docs);
        const params = {
            query: {
                nodes: _.map(ids, id => ({
                    id: String(id)
                }))
            }
        };
        if (fields) params.fields = fields;
        if (!system_id) {
            dbg.error('populate_nodes: expected system_id. docs', docs);
            throw new Error('populate_nodes: expected system_id');
        }
        return P.resolve()
            .then(() => promise_utils.retry(MASTER_CHANGE_RETRIES, 1, () =>
                server_rpc.client.node.list_nodes(params, {
                    auth_token: auth_server.make_auth_token({
                        system_id: system_id,
                        role: 'admin'
                    }),
                    address: this._master_address
                })
                .catch(err => this._handle_master_change(err))))
            .then(res => {
                const idmap = _.keyBy(res.nodes, '_id');
                _.each(docs_list, doc => {
                    const id = _.get(doc, doc_path);
                    const node = idmap[String(id)];
                    if (node) {
                        mongo_utils.fix_id_type(node);
                        _.set(doc, doc_path, node);
                    } else {
                        dbg.warn('populate_nodes: missing node for id',
                            id, 'DOC', doc, 'IDMAP', _.keys(idmap));
                    }
                });
                return docs;
            })
            .catch(err => {
                dbg.error('populate_nodes: ERROR', err.stack);
                throw err;
            });
    }

    populate_nodes_for_map(system_id, docs, doc_path) {
        return this.populate_nodes(system_id, docs, doc_path, NODE_FIELDS_FOR_MAP);
    }

    report_error_on_node_blocks(system_id, blocks_report) {

        // node_allocator keeps nodes in memory,
        // and in the write path it allocated a block on a node that failed to write
        // so we notify about the error to remove the node from next allocations
        // until it will refresh the alloc.
        _.each(blocks_report, block_report => {
            const node_id = block_report.block_md.node;
            node_allocator.report_error_on_node_alloc(node_id);
        });

        return promise_utils.retry(MASTER_CHANGE_RETRIES, 1, () => {
            return server_rpc.client.node.report_error_on_node_blocks({
                    blocks_report: blocks_report
                }, {
                    auth_token: auth_server.make_auth_token({
                        system_id: system_id,
                        role: 'admin'
                    }),
                    address: this._master_address
                })
                .catch(err => this._handle_master_change(err));
        });
    }

    _handle_master_change(err) {
        // on every error, check if master was changed. if it wasn't rethrow with err.DO_NOT_RETRY
        dbg.log0(`_handle_master_change with err.rpc_code = ${err.rpc_code} - ${err}`);
        return server_rpc.client.cluster_internal.redirect_to_cluster_master()
            .then(addr => {
                let new_address = 'ws://' + addr + ':' + server_rpc.get_base_port();
                if (new_address.toLowerCase() !== this._master_address.toLowerCase()) {
                    dbg.log0(`nodes_client: changing _master_address from ${this._master_address}, to ${new_address}`);
                    this._master_address = new_address;
                    throw err;
                }
                // if master wasn't changed, throw the error without retrying
                err.DO_NOT_RETRY = true;
                throw err;
            });
    }



    static instance() {
        if (!NodesClient._instance) {
            NodesClient._instance = new NodesClient();
        }
        return NodesClient._instance;
    }

}

exports.NodesClient = NodesClient;
exports.instance = NodesClient.instance;
