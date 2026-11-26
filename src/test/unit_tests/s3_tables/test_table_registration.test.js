/* Copyright (C) 2026 NooBaa */
'use strict';

// Registration-gating unit test for story 6a (design §3.7, §12 test 17: "a fresh
// installation with the flag off creates none of the three collections"). table_server -
// and the table_store collections requiring it instantiates - is registered from
// register_object_services(), the single helper both md_server.register_rpc() (endpoint)
// and web_server (core) call, and only when config.S3_TABLES_ENABLED is set.
//
// Each case runs in an isolated module registry so register_object_services() is called
// exactly once per registry (it asserts a service is not registered twice).

// config.js must not start its NSFS reload watcher (it fires after Jest teardown).
process.env.CONTAINER_PLATFORM = process.env.CONTAINER_PLATFORM || 'TEST';
// mark as coretest so md_store/etc. do not start background intervals on require
process.env.CORETEST = process.env.CORETEST || 'coretest';

function table_api_registered_with_flag(flag) {
    let registered;
    let collection_defined;
    jest.isolateModules(() => {
        const config = require('../../../../config');
        config.S3_TABLES_ENABLED = flag;
        const server_rpc = require('../../../server/server_rpc');
        const db_client = require('../../../util/db_client');
        server_rpc.register_object_services();
        // services are keyed `<api>.<method>`, so look for any table_api method
        registered = Object.keys(server_rpc.rpc._services).some(k => k.startsWith('table_api.'));
        // define_collection pushes onto db_client.instance().tables only when table_store
        // is instantiated - which only happens when table_server is required under the flag.
        collection_defined = db_client.instance().tables.some(t => t.name === 'table_buckets');
    });
    return { registered, collection_defined };
}

describe('s3_tables table_server registration gating (§3.7, test 17)', () => {

    it('flag off: table_api is not registered and no collection is defined', () => {
        const { registered, collection_defined } = table_api_registered_with_flag(false);
        expect(registered).toBe(false);
        expect(collection_defined).toBe(false);
    });

    it('flag on: table_api is registered and the collections are defined', () => {
        const { registered, collection_defined } = table_api_registered_with_flag(true);
        expect(registered).toBe(true);
        expect(collection_defined).toBe(true);
    });
});
