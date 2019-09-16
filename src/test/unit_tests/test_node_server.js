/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup({ pools_to_create: [coretest.POOL_LIST[0]] });

// const _ = require('lodash');
const mocha = require('mocha');
const assert = require('assert');

const P = require('../../util/promise');

mocha.describe('node_server', function() {

    const { rpc_client } = coretest;

    mocha.it('works', function() {
        this.timeout(40000); // eslint-disable-line no-invalid-this

        let nodes;
        return P.resolve()
            .then(() => rpc_client.node.list_nodes({}))
            .then(res => {
                nodes = res.nodes;
                coretest.log('NODES', nodes);
                assert(res.nodes.length >= 2);
            })
            .then(() => rpc_client.node.read_node({
                name: nodes[0].name
            }))
            .then(res => rpc_client.node.get_test_nodes({
                count: 10,
                source: nodes[0].rpc_address,
            }))
            .then(() => rpc_client.node.ping())
            .then(() => rpc_client.node.set_debug_node({
                node: {
                    name: nodes[0].name
                },
                level: coretest.get_dbg_level(),
            }))
            .then(() => rpc_client.node.decommission_node({
                name: nodes[0].name
            }))
            .then(() => rpc_client.node.recommission_node({
                name: nodes[0].name
            }))
            .then(() => rpc_client.node.collect_agent_diagnostics({
                name: nodes[0].name,
            }))
            .then(() => {
                const params = {
                    level: coretest.get_dbg_level(),
                };
                // rpc_client.rpc.schema.agent_api.methods.set_debug_node.;
                return rpc_client.node.n2n_proxy({
                    target: nodes[0].rpc_address,
                    request_params: params,
                    method_api: 'agent_api',
                    method_name: 'set_debug_node',
                });
            })
            // .then(() => rpc_client.node.n2n_signal({
            //     target: nodes[0].rpc_address,
            //     secret_signal_info: 'shhh'
            // }))
            .then(() => rpc_client.node.test_node_network({
                source: nodes[0].rpc_address,
                target: nodes[1].rpc_address,
                request_length: 1024,
                response_length: 2048,
                count: 10,
                concur: 3,
            }));
    });

});
