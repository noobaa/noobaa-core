'use strict';

// const _ = require('lodash');
const mocha = require('mocha');
const assert = require('assert');

const P = require('../../util/promise');
const coretest = require('./coretest');

mocha.describe('node_server', function() {

    const client = coretest.new_test_client();

    const SYS = 'test-node-system';
    const EMAIL = SYS + '@coretest.coretest';
    const PASSWORD = 'tululu';
    const ACCESS_KEYS = {
        access_key: 'ydaydayda',
        secret_key: 'blablabla'
    };

    mocha.it('works', function() {
        this.timeout(20000);
        let nodes;
        return P.resolve()
            .then(() => client.account.create_account({
                name: SYS,
                email: EMAIL,
                password: PASSWORD,
                access_keys: ACCESS_KEYS
            }))
            .then(res => {
                client.options.auth_token = res.token;
            })
            .then(() => coretest.init_test_nodes(client, SYS, 5))
            .then(() => client.node.list_nodes({}))
            .then(res => {
                nodes = res.nodes;
                console.log('NODES', nodes);
                assert.strictEqual(res.nodes.length, 5);
            })
            .then(() => client.node.read_node({
                name: nodes[0].name
            }))
            .then(res => client.node.get_test_nodes({
                count: 10,
                source: nodes[0].rpc_address,
            }))
            .then(() => client.node.ping())
            .delay(2000)
            .then(() => client.node.set_debug_node({
                node: {
                    name: nodes[0].name
                },
                level: 0,
            }))
            .then(() => client.node.collect_agent_diagnostics({
                name: nodes[0].name,
            }))
            .then(() => {
                const params = {
                    level: 0,
                };
                // client.rpc.schema.agent_api.methods.set_debug_node.;
                return client.node.n2n_proxy({
                    target: nodes[0].rpc_address,
                    request_params: params,
                    method_api: 'agent_api',
                    method_name: 'set_debug_node',
                });
            })
            // .then(() => client.node.n2n_signal({
            //     target: nodes[0].rpc_address,
            //     secret_signal_info: 'shhh'
            // }))
            .then(() => client.node.test_node_network({
                source: nodes[0].rpc_address,
                target: nodes[1].rpc_address,
                request_length: 1024,
                response_length: 2048,
                count: 10,
                concur: 3,
            }))
            // .then(() => client.node.delete_node({
            // name: NODE
            // }))
            .then(() => coretest.clear_test_nodes())
            .catch((err) => {
                console.log('Failure while testing:' + err, err.stack);
            });
    });

});
