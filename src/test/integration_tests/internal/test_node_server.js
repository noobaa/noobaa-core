/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('../../utils/coretest/coretest');
coretest.setup({ pools_to_create: [coretest.POOL_LIST[0]] });

// const _ = require('lodash');
const mocha = require('mocha');
const assert = require('assert');

mocha.describe('node_server', function() {

    const { rpc_client } = coretest;

    mocha.it('works', async function() {
        this.timeout(40000); // eslint-disable-line no-invalid-this

        const res = await rpc_client.node.list_nodes({});
        const nodes = res.nodes;
        coretest.log('NODES', nodes);
        assert(res.nodes.length >= 2);
        await rpc_client.node.read_node({
            name: nodes[0].name
        });
        await rpc_client.node.get_test_nodes({
            count: 10,
            source: nodes[0].rpc_address,
        });
        await rpc_client.node.ping();
        await rpc_client.node.set_debug_node({
            node: {
                name: nodes[0].name
            },
            level: coretest.get_dbg_level(),
        });
        await rpc_client.node.decommission_node({
            name: nodes[0].name
        });
        await rpc_client.node.recommission_node({
            name: nodes[0].name
        });
        await rpc_client.node.collect_agent_diagnostics({
            name: nodes[0].name,
        });
        const params_1 = {
            level: coretest.get_dbg_level(),
        };
        await rpc_client.node.n2n_proxy({
            target: nodes[0].rpc_address,
            request_params: params_1,
            method_api: 'agent_api',
            method_name: 'set_debug_node',
        });
        await rpc_client.node.test_node_network({
            source: nodes[0].rpc_address,
            target: nodes[1].rpc_address,
            request_length: 1024,
            response_length: 2048,
            count: 10,
            concur: 3,
        });
    });

});
