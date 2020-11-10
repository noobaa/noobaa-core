/* Copyright (C) 2016 NooBaa */
'use strict';

const mocha = require('mocha');
const assert = require('assert');

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup({ pools_to_create: [coretest.POOL_LIST[0]] });

mocha.describe('host_server', function() {

    const { rpc_client } = coretest;

    mocha.it('works', async function() {
        this.timeout(20000); // eslint-disable-line no-invalid-this

        const { hosts } = await rpc_client.host.list_hosts({});

        coretest.log('hosts length:', hosts.length);
        for (const host of hosts) {
            coretest.log('HOST', { ...host, storage_nodes_info: 'REDACTED' });
        }

        assert(hosts.length >= 2);
        const h0 = hosts[0];
        const name = h0.name;

        await rpc_client.host.read_host({ name });
        await rpc_client.host.get_test_hosts({ count: 10, source: h0.rpc_address });
        await rpc_client.host.set_debug_host({ name, level: coretest.get_dbg_level() });
        await rpc_client.host.update_host_services({ name, services: { storage: true } });
    });

});
