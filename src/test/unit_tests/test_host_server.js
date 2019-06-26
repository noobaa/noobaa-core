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

    const { rpc_client } = coretest;

    mocha.it('works', function() {
        this.timeout(20000); // eslint-disable-line no-invalid-this

        let hosts;
        return P.resolve()
            .then(() => rpc_client.host.list_hosts({}))
            .then(res => {
                hosts = res.hosts;
                coretest.log('length = ', hosts.length, 'HOSTS:', hosts);
                assert(hosts.length >= 2);
            })
            .then(() => rpc_client.host.read_host({
                name: hosts[0].name
            }))
            .then(res => rpc_client.host.get_test_hosts({
                count: 10,
                source: hosts[0].rpc_address,
            }))
            .then(() => rpc_client.host.set_debug_host({
                name: hosts[0].name,
                level: 0,
            }))
            .then(() => rpc_client.host.update_host_services({
                name: hosts[0].name,
                services: {
                    storage: true
                }
            }));
    });

});
