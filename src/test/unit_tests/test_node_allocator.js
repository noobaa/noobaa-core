/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup({ pools_to_create: [coretest.POOL_LIST[0]] });

const _ = require('lodash');
const mocha = require('mocha');
const system_store = require('../../server/system_services/system_store').get_instance();
const assert = require('assert');
const config = require('../../../config');
const P = require('../../util/promise');

const POOL = coretest.POOL_LIST[0].name;
const NODE_FIELDS_FOR_MAP = [
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
];

mocha.describe('node_allocator', function() {

    const { rpc_client } = coretest;

    mocha.it('kmeans divided to groups', function() {
        this.timeout(50000); // eslint-disable-line no-invalid-this

        return P.delay(10000)
            .then(() => system_store.data.pools.find(pool => pool.name === POOL))
            .then(pool => Promise.all([
                rpc_client.node.allocate_nodes({ pool_id: String(pool._id), fields: NODE_FIELDS_FOR_MAP }),
                rpc_client.node.list_nodes({
                    query: {
                        pools: [pool.name],
                        writable: true
                    }
                })
            ]))
            .then(res => {
                let allocation = res[0];
                let pool_nodes = res[1];
                assert(allocation.latency_groups.length === config.NODE_ALLOCATOR_NUM_CLUSTERS, 'KMEANS did not divide to correct K number of groups');
                assert(_.every(allocation.latency_groups, group => group.nodes.length), 'KMEANS groups should have nodes');
                const total_nodes_list = _.reduce(allocation.latency_groups, (sum, group) => sum + group.nodes.length, 0);
                assert(total_nodes_list === pool_nodes.total_count, `KMEANS groups should have all nodes, ${total_nodes_list} !== ${pool_nodes.total_count}`);
            });

    });

});
