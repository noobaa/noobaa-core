/* Copyright (C) 2026 NooBaa */
'use strict';

// Wiring unit test for story 6a - no database needed. It pins:
//  - table_api is registered in the shared RPC schema with the full method surface;
//  - table_api routes to the `md` domain (§3.4), so it rides with the object services;
//  - bucketspace_nb exposes every catalog BucketSpace method as a thin pass-through to
//    rpc_client.table.* (§6.3), the one plumbing story 4/10/11/12 build on.
//
// Prevent config.js from starting its NSFS config-reload watcher, which otherwise fires
// after Jest tears the environment down and fails the run (see reload_nsfs_nc_config).
process.env.CONTAINER_PLATFORM = process.env.CONTAINER_PLATFORM || 'TEST';

const api = require('../../../api');
const table_api = require('../../../api/table_api');
const BucketSpaceNB = require('../../../sdk/bucketspace_nb');

const EXPECTED_METHODS = [
    'create_table_bucket', 'get_table_bucket', 'list_table_buckets',
    'update_table_bucket', 'delete_table_bucket',
    'create_table_namespace', 'get_table_namespace', 'list_table_namespaces',
    'update_table_namespace', 'delete_table_namespace',
    'create_table', 'get_table', 'list_tables', 'rename_table', 'delete_table',
    'update_table_metadata_location',
];

describe('s3_tables table_api wiring', () => {

    it('compiles into the shared RPC schema', () => {
        expect(api.get_schema('table_api')).toBeTruthy();
    });

    it('routes to the md domain (§3.4)', () => {
        const rpc = api.new_rpc();
        expect(rpc.api_routes.table_api).toBe('md');
    });

    it('exposes the full catalog method surface', () => {
        const methods = Object.keys(table_api.methods);
        expect(methods.sort()).toEqual([...EXPECTED_METHODS].sort());
    });

    it('every method declares admin/user auth', () => {
        for (const [name, def] of Object.entries(table_api.methods)) {
            expect(def.auth).toEqual({ system: ['admin', 'user'] });
            expect(def.params).toBeTruthy();
            expect(def.reply).toBeTruthy();
            expect(name).toBeTruthy();
        }
    });

    it('only accepts an expected token, leaving the next token to the server', () => {
        expect(table_api.methods.update_table_metadata_location.params.properties.new_version_token).toBeUndefined();
    });

    it('the swap reply carries the three-outcome contract (§6.3)', () => {
        const outcome = table_api.definitions.swap_outcome;
        expect(outcome.enum).toEqual(['swapped', 'not_swapped', 'no_such_table']);
    });
});

describe('s3_tables bucketspace_nb delegation (§6.3)', () => {

    function make_bs() {
        const calls = [];
        const table_proxy = new Proxy({}, {
            get: (_t, op) => async params => {
                calls.push({ op, params });
                return { op, params };
            },
        });
        const rpc_client = { table: table_proxy };
        const bs = new BucketSpaceNB({ rpc_client, internal_rpc_client: rpc_client });
        return { bs, calls };
    }

    it('declares support for the conditional pointer swap', () => {
        expect(make_bs().bs.supports_table_pointer_swap).toBe(true);
    });

    it.each(['DISCONNECTED', 'RPC_REQUEST_TIMEOUT', 'INTERNAL', 'TABLE_SWAP_UNKNOWN'])(
        'preserves an unknown swap outcome across a failed RPC (%s)', async rpc_code => {
            const swap = jest.fn().mockRejectedValue(Object.assign(new Error('lost response'), {
                rpc_code, rpc_data: { retryable: true },
            }));
            const rpc_client = { table: { update_table_metadata_location: swap } };
            const bs = new BucketSpaceNB({ rpc_client, internal_rpc_client: rpc_client });
            await expect(bs.update_table_metadata_location({ table_id: 'id' })).rejects.toMatchObject({
                rpc_code: 'TABLE_SWAP_UNKNOWN',
            });
            expect(swap).toHaveBeenCalledTimes(1);
        });

    it('passes each catalog method straight through to rpc_client.table.<same>', async () => {
        const { bs, calls } = make_bs();
        for (const name of EXPECTED_METHODS) {
            const params = { probe: name };
            // eslint-disable-next-line no-await-in-loop
            const res = await bs[name](params);
            expect(res).toEqual({ op: name, params });
        }
        expect(calls.map(c => c.op).sort()).toEqual([...EXPECTED_METHODS].sort());
        for (const c of calls) {
            expect(c.params).toEqual({ probe: c.op });
        }
    });
});
