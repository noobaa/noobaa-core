/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup();

// const _ = require('lodash');
const mocha = require('mocha');
const assert = require('assert');
const P = require('../../util/promise');

mocha.describe('host_server', function() {

    const client = coretest.new_test_client();

    const SYS = 'test-host-system';
    const EMAIL = SYS + '@coretest.coretest';
    const PASSWORD = 'tululu';

    mocha.it('works', function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(20000);

        let hosts;
        return P.resolve()
            .then(() => client.system.create_system({
                activation_code: '1111',
                name: SYS,
                email: EMAIL,
                password: PASSWORD,
            }))
            .then(res => {
                client.options.auth_token = res.token;
            })
            .then(() => coretest.init_test_nodes(client, SYS, 5))
            .then(() => client.host.list_hosts({}))
            .then(res => {
                hosts = res.hosts;
                console.log('length = ', hosts.length, 'HOSTS:', hosts);
                assert.strictEqual(hosts.length, 5);
            })
            .then(() => client.host.read_host({
                host_name: hosts[0].name
            }))
            .then(res => client.host.get_test_hosts({
                count: 10,
                source: hosts[0].rpc_address,
            }))
            .then(() => client.host.set_debug_host({
                host_name: hosts[0].name,
                level: 0,
            }))
            .then(() => client.host.update_host_services({
                host_name: hosts[0].name,
                s3_updates: null,
                storage_updates: [{
                        node: {
                            name: hosts[0].storage_nodes_info.nodes[0].name
                        },
                        enabled: false,
                    },
                    {
                        node: {
                            name: hosts[1].storage_nodes_info.nodes[0].name
                        },
                        enabled: true,
                    }
                ]
            }))
            .then(() => coretest.clear_test_nodes())
            .catch(err => {
                console.log('Failure while testing:' + err, err.stack);
                throw err;
            });
    });

});
