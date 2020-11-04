/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const server_rpc = require('../server_rpc');
const auth_server = require('../common_services/auth_server');
const db_client = require('../../util/db_client');
const node_allocator = require('./node_allocator');
const system_store = require('../system_services/system_store').get_instance();

const NODE_FIELDS_FOR_MAP = Object.freeze([
    'name',
    'pool',
    'ip',
    'host_id',
    'heartbeat',
    'rpc_address',
    'is_cloud_node',
    'node_type',
    'is_mongo_node',
    'online',
    'readable',
    'writable',
    'storage_full',
    'latency_of_disk_read',
    // ... more?
]);

class NodesClient {

    list_nodes_by_system(system_id) {
        return server_rpc.client.node.list_nodes({}, {
                auth_token: auth_server.make_auth_token({
                    system_id: system_id,
                    role: 'admin'
                })
            })
            .then(res => {
                db_client.instance().fix_id_type(res.nodes);
                return res;
            });
    }

    list_nodes_by_pool(pool_name, system_id) {

        return server_rpc.client.node.list_nodes({
                query: {
                    pools: [pool_name]
                }
            }, {
                auth_token: auth_server.make_auth_token({
                    system_id: system_id,
                    role: 'admin'
                })
            })
            .then(res => {
                db_client.instance().fix_id_type(res.nodes);
                return res;
            });
    }

    list_nodes_by_identity(system_id, nodes_identities, fields) {
        return server_rpc.client.node.list_nodes({
                query: { nodes: nodes_identities },
                fields,
            }, {
                auth_token: auth_server.make_auth_token({
                    system_id: system_id,
                    role: 'admin'
                })
            })
            .then(res => {
                db_client.instance().fix_id_type(res.nodes);
                return res;
            });
    }

    get_nodes_stats_by_cloud_service(system_id, start_date, end_date) {
        return server_rpc.client.node.get_nodes_stats_by_cloud_service({ start_date, end_date }, {
            auth_token: auth_server.make_auth_token({
                system_id: system_id,
                role: 'admin'
            })
        });
    }

    aggregate_nodes_by_pool(pool_names, system_id, skip_cloud_nodes, skip_mongo_nodes) {
        const nodes_aggregate_pool = server_rpc.client.node.aggregate_nodes({
            query: {
                pools: pool_names || undefined,
                skip_cloud_nodes: skip_cloud_nodes,
                skip_mongo_nodes: skip_mongo_nodes
            },
            group_by: 'pool'
        }, {
            auth_token: auth_server.make_auth_token({
                system_id: system_id,
                role: 'admin'
            })
        });
        return nodes_aggregate_pool;
    }

    aggregate_hosts_by_pool(pool_names, system_id) {
        const nodes_aggregate_pool = server_rpc.client.node.aggregate_nodes({
            query: {
                pools: pool_names || undefined,
                skip_cloud_nodes: true,
            },
            group_by: 'pool',
            aggregate_hosts: true,
        }, {
            auth_token: auth_server.make_auth_token({
                system_id: system_id,
                role: 'admin'
            })
        });
        return nodes_aggregate_pool;
    }


    aggregate_data_free_by_tier(tier_ids, system_id) {
        return server_rpc.client.node.aggregate_data_free_by_tier({
                tier_ids: tier_ids,
            }, {
                auth_token: auth_server.make_auth_token({
                    system_id: system_id,
                    role: 'admin'
                })
            })
            .then(res => _.mapValues(_.keyBy(res, 'tier_id'), 'mirrors_storage'));
    }

    collect_agent_diagnostics(node_identity, system_id) {
        return server_rpc.client.node.collect_agent_diagnostics(node_identity, {
            auth_token: auth_server.make_auth_token({
                system_id: system_id,
                role: 'admin'
            })
        });
    }

    // REMOTE CALLS

    read_node_by_name(system_id, node_name) {
        if (!system_id) {
            dbg.error('read_node_by_name: expected system_id. node_name', node_name);
            throw new Error('read_node_by_name: expected system_id');
        }
        return server_rpc.client.node.read_node({
                name: node_name
            }, {
                auth_token: auth_server.make_auth_token({
                    system_id: system_id,
                    role: 'admin'
                })
            })
            .then(node => {
                db_client.instance().fix_id_type(node);
                return node;
            });
    }

    read_node_by_id(system_id, node_id) {
        if (!system_id) {
            dbg.error('read_node_by_id: expected system_id. node_id', node_id);
            throw new Error('read_node_by_id: expected system_id');
        }
        return server_rpc.client.node.read_node({
                id: node_id
            }, {
                auth_token: auth_server.make_auth_token({
                    system_id: system_id,
                    role: 'admin'
                })
            })
            .then(node => {
                db_client.instance().fix_id_type(node);
                return node;
            });
    }

    get_node_ids_by_name(system_id, identity, by_host) {
        if (!system_id) {
            dbg.error('read_node_by_name: expected system_id. node_name', identity);
            throw new Error('read_node_by_name: expected system_id');
        }
        return server_rpc.client.node.get_node_ids({
                identity,
                by_host
            }, {
                auth_token: auth_server.make_auth_token({
                    system_id: system_id,
                    role: 'admin'
                })
            })
            .then(node_ids => node_ids.map(node_id => db_client.instance().parse_object_id(node_id)));
    }

    delete_node_by_name(system_id, node_name) {
        if (!system_id) {
            dbg.error('read_node_by_name: expected system_id. node_name', node_name);
            throw new Error('read_node_by_name: expected system_id');
        }

        return server_rpc.client.node.delete_node({
            name: node_name
        }, {
            auth_token: auth_server.make_auth_token({
                system_id: system_id,
                role: 'admin'
            })
        });
    }

    allocate_nodes(system_id, pool_id) {
        if (!system_id) {
            dbg.error('allocate_nodes: expected system_id. pool_id', pool_id);
            throw new Error('allocate_nodes: expected system_id');
        }

        return P.resolve(server_rpc.client.node.allocate_nodes({
                pool_id: String(pool_id),
                fields: NODE_FIELDS_FOR_MAP
            }, {
                auth_token: auth_server.make_auth_token({
                    system_id: system_id,
                    role: 'admin'
                })
            }))
            .then(res => {
                res.latency_groups.forEach(group => db_client.instance().fix_id_type(group.nodes));
                return res;
            });
    }

    /**
     * TODO: Fields doesn't seem to filter and work
     * @template {{}} T
     * @param {nb.ID} system_id
     * @param {T[]} docs
     * @param {string} doc_id_path
     * @param {string} doc_path
     * @param {Object} fields
     */
    populate_nodes(system_id, docs, doc_id_path, doc_path, fields) {
        const docs_list = docs && !_.isArray(docs) ? [docs] : docs;
        const ids = db_client.instance().uniq_ids(docs_list, doc_id_path);
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
            .then(() => server_rpc.client.node.list_nodes(params, {
                auth_token: auth_server.make_auth_token({
                    system_id: system_id,
                    role: 'admin'
                })
            }))
            .then(res => {
                const idmap = _.keyBy(res.nodes, '_id');
                _.each(docs_list, doc => {
                    const id = _.get(doc, doc_id_path);
                    const node = idmap[String(id)];
                    if (node) {
                        db_client.instance().fix_id_type(node);
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

    async report_error_on_node_blocks(system_id, blocks_report, bucket_name) {

        await server_rpc.client.node.report_error_on_node_blocks({
            blocks_report: blocks_report
        }, {
            auth_token: auth_server.make_auth_token({
                system_id: system_id,
                role: 'admin'
            })
        });

        // node_allocator keeps nodes in memory,
        // and in the write path it allocated a block on a node that failed to write
        // so we notify about the error to remove the node from next allocations
        // until it will refresh the alloc.
        for (const block_report of blocks_report) {
            if (block_report.rpc_code === 'NO_BLOCK_STORE_SPACE') {
                const bucket = _.find(system_store.data.buckets, b => (b.name.unwrap() === bucket_name.unwrap()));
                await node_allocator.refresh_tiering_alloc(bucket.tiering, 'force');
            } else {
                const node_id = block_report.block_md.node;
                node_allocator.report_error_on_node_alloc(node_id);
            }
        }
    }

    async list_hosts_by_pool(pool_name, system_id, auth_token) {
        if (!auth_token) {
            auth_token = auth_server.make_auth_token({
                system_id: system_id,
                role: 'admin'
            });
        }

        const res = await server_rpc.client.host.list_hosts({
            query: {
                pools: [pool_name]
            }
        }, {
            auth_token
        });
        db_client.instance().fix_id_type(res.hosts);
        return res;
    }

    async delete_hosts_by_pool(pool_name, system_id, count = Infinity) {
        const auth_token = auth_server.make_auth_token({
            system_id: system_id,
            role: 'admin'
        });

        const { hosts } = await this.list_hosts_by_pool(pool_name, system_id, auth_token);
        const promise_list = hosts
            .slice(-count)
            .map(async host => {
                if (host.mode === 'DELETING') {
                    return;
                }

                try {
                    await server_rpc.client.host.delete_host({ name: host.name }, { auth_token });
                } catch (err) {
                    console.error(`delete_hosts_by_pool: could not initiate delete for host ${host.name}, got: ${err.message}`);
                }
            });

        await Promise.all(promise_list);
    }

    /** @returns {NodesClient} */
    static instance() {
        if (!NodesClient._instance) {
            NodesClient._instance = new NodesClient();
        }
        return NodesClient._instance;
    }

}

NodesClient._instance = undefined;

exports.NodesClient = NodesClient;
exports.instance = NodesClient.instance;
exports.NODE_FIELDS_FOR_MAP = NODE_FIELDS_FOR_MAP;
