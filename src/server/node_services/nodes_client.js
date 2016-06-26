'use strict';

const _ = require('lodash');
const node_server = require('./node_server');

class NodesClient {

    list_nodes_by_system(system_id) {
        return node_server.get_local_monitor().list_nodes({
            system: system_id
        });
    }

    list_nodes_by_pool(pool_id) {
        return node_server.get_local_monitor().list_nodes({
            pools: new Set([pool_id])
        });
    }

    aggregate_nodes_by_pool(pool_ids, system_id) {
        const res = node_server.get_local_monitor().aggregate_nodes({
            system: system_id && String(system_id),
            pools: pool_ids && new Set(_.map(pool_ids, String))
        }, 'pool');
        // recreating a structure existing code callers expect,
        // might want to change the callers instead.
        const nodes_aggregate_pool = _.mapValues(res.groups,
            group => _.assign({}, group.storage, group.nodes));
        nodes_aggregate_pool[''] = _.assign({}, res.storage, res.nodes);
        return nodes_aggregate_pool;
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
