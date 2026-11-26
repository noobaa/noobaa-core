/* Copyright (C) 2026 NooBaa */
/* eslint-disable max-lines-per-function */
'use strict';

// Integration test for stories 6a/6b (design §12 test 16 store half, test 17). It drives the
// table_api over rpc_client - the real RPC path - exercising table-bucket, namespace and
// table CRUD, the conditional state transitions, the pointer swap, and the unique partial
// indexes. The commit half of test 16 belongs to story 12.
//
// coretest routes every domain to fcall://fcall, i.e. the in-process `md` server an
// endpoint runs under LOCAL_MD_SERVER=true. The other mode of test 16 - `md` resolving to
// MD_ADDR (core) - is served by the SAME register_object_services() helper, which is what
// test_table_api.test.js pins (route = md, registered under the feature flag). Running this
// same suite with MD_ADDR set is the second half of test 16 and is left to the harness.

// coretest enables config.S3_TABLES_ENABLED before the first setup(), so
// register_object_services() registers table_server here.
const coretest = require('../../../utils/coretest/coretest');
coretest.setup();

const mocha = require('mocha');
const assert = require('assert');
const mongodb = require('mongodb');
const db_client = require('../../../../util/db_client');
const { SWAP_OUTCOME } = require('../../../../server/table_services/table_store');
const { rpc_client } = coretest;

const oid = () => String(new mongodb.ObjectId());

mocha.describe('table_api store (6a/6b)', function() {

    const uniq = Date.now().toString(36);

    mocha.describe('table buckets', function() {

        mocha.it('create / get-by-name / get-by-id / list', async function() {
            const name = `tb-crud-${uniq}`;
            const created = await rpc_client.table.create_table_bucket({
                name,
                backing_bucket_name: `${name}--table-s3-nb`,
                state: 'provisioning',
            });
            assert.strictEqual(created.name, name);
            assert.strictEqual(created.state, 'provisioning');

            assert.strictEqual((await rpc_client.table.get_table_bucket({ name })).table_bucket, undefined);
            const recovering = await rpc_client.table.get_table_bucket({ name, include_inactive: true });
            assert.strictEqual(recovering.table_bucket.state, 'provisioning');
            await rpc_client.table.update_table_bucket({ table_bucket_id: String(created._id),
                expected_state: 'provisioning', state: 'ready' });
            const by_name = await rpc_client.table.get_table_bucket({ name });
            assert.strictEqual(String(by_name.table_bucket._id), String(created._id));

            const by_id = await rpc_client.table.get_table_bucket({ table_bucket_id: String(created._id) });
            assert.strictEqual(by_id.table_bucket.name, name);

            const listed = await rpc_client.table.list_table_buckets({ limit: 1000 });
            assert(listed.table_buckets.some(b => b.name === name));
        });

        mocha.it('duplicate name is rejected (unique index)', async function() {
            const name = `tb-dup-${uniq}`;
            await rpc_client.table.create_table_bucket({ name, backing_bucket_name: `${name}--table-s3-nb`, state: 'ready' });
            await assert.rejects(
                rpc_client.table.create_table_bucket({ name, backing_bucket_name: `${name}--table-s3-nb`, state: 'ready' }),
                /CONFLICT|already exists/,
            );
        });

        mocha.it('conditional state transition: only the matching expected_state wins', async function() {
            const name = `tb-state-${uniq}`;
            const b = await rpc_client.table.create_table_bucket({ name, backing_bucket_name: `${name}--table-s3-nb`, state: 'provisioning' });
            const id = String(b._id);

            await assert.rejects(rpc_client.table.update_table_bucket({ table_bucket_id: id,
                expected_state: 'ready', state: 'ready' }), /INVALID_REQUEST/);

            const win = await rpc_client.table.update_table_bucket({ table_bucket_id: id, expected_state: 'provisioning', state: 'ready' });
            assert.strictEqual(win.matched, true);
            const stale = await rpc_client.table.update_table_bucket({ table_bucket_id: id, expected_state: 'provisioning', state: 'ready' });
            assert.strictEqual(stale.matched, false);
            const got = await rpc_client.table.get_table_bucket({ table_bucket_id: id });
            assert.strictEqual(got.table_bucket.state, 'ready');
        });

        mocha.it('soft-delete frees the name', async function() {
            const name = `tb-reuse-${uniq}`;
            const b = await rpc_client.table.create_table_bucket({ name, backing_bucket_name: `${name}--table-s3-nb`, state: 'ready' });
            const del = await rpc_client.table.delete_table_bucket({ table_bucket_id: String(b._id) });
            assert.strictEqual(del.matched, true);
            const gone = await rpc_client.table.get_table_bucket({ table_bucket_id: String(b._id) });
            assert.strictEqual(gone.table_bucket, undefined);
            // name is free again
            await rpc_client.table.create_table_bucket({ name, backing_bucket_name: `${name}--table-s3-nb`, state: 'ready' });
        });
    });

    mocha.describe('namespaces', function() {
        let tb;
        mocha.before(async function() {
            const name = `tb-parent-${oid()}`;
            const b = await rpc_client.table.create_table_bucket({ name, backing_bucket_name: `${name}--table-s3-nb`, state: 'ready' });
            tb = String(b._id);
        });

        mocha.it('create / get / update properties / list / delete', async function() {
            await rpc_client.table.create_table_namespace({ table_bucket_id: tb, name: 'analytics', properties: { tier: 'raw' } });
            const got = await rpc_client.table.get_table_namespace({ table_bucket_id: tb, name: 'analytics' });
            assert.deepStrictEqual(got.namespace.properties, { tier: 'raw' });

            const upd = await rpc_client.table.update_table_namespace({ table_bucket_id: tb, name: 'analytics', properties: { tier: 'curated' } });
            assert.strictEqual(upd.matched, true);

            const list = await rpc_client.table.list_table_namespaces({ table_bucket_id: tb, limit: 1000 });
            assert(list.namespaces.some(n => n.name === 'analytics'));

            const del = await rpc_client.table.delete_table_namespace({ table_bucket_id: tb, name: 'analytics' });
            assert.strictEqual(del.matched, true);
            const gone = await rpc_client.table.get_table_namespace({ table_bucket_id: tb, name: 'analytics' });
            assert.strictEqual(gone.namespace, undefined);
        });

        mocha.it('duplicate namespace in one table bucket is rejected', async function() {
            await rpc_client.table.create_table_namespace({ table_bucket_id: tb, name: 'dup' });
            await assert.rejects(rpc_client.table.create_table_namespace({ table_bucket_id: tb, name: 'dup' }), /CONFLICT|already exists/);
        });
    });

    mocha.describe('tables', function() {

        let tb;
        mocha.before(async function() {
            const name = `tb-parent-${oid()}`;
            const b = await rpc_client.table.create_table_bucket({ name, backing_bucket_name: `${name}--table-s3-nb`, state: 'ready' });
            tb = String(b._id);
            await rpc_client.table.create_table_namespace({ table_bucket_id: tb, name: 'db' });
            await rpc_client.table.create_table_namespace({ table_bucket_id: tb, name: 'db2' });
        });

        mocha.it('create uninitialized / get / list / rename / delete', async function() {
            const created = await rpc_client.table.create_table({ table_bucket_id: tb, namespace_name: 'db', name: 'orders' });
            assert.strictEqual(created.kind, 'table');
            assert.strictEqual(created.metadata_location, undefined);
            assert(created.version_token);

            const got = await rpc_client.table.get_table({ table_bucket_id: tb, namespace_name: 'db', name: 'orders' });
            assert.strictEqual(String(got.table._id), String(created._id));

            const by_id = await rpc_client.table.get_table({ table_bucket_id: tb, table_id: String(created._id) });
            assert.strictEqual(by_id.table.name, 'orders');

            const list = await rpc_client.table.list_tables({ table_bucket_id: tb, namespace_name: 'db', limit: 1000 });
            assert(list.tables.some(t => t.name === 'orders'));

            // rename conditional on the resolved {namespace_name, name}
            const bad = await rpc_client.table.rename_table({ table_id: String(created._id), namespace_name: 'db', name: 'WRONG', new_name: 'o2' });
            assert.strictEqual(bad.matched, false);
            const ok = await rpc_client.table.rename_table({ table_id: String(created._id), namespace_name: 'db', name: 'orders', new_namespace_name: 'db2', new_name: 'o2' });
            assert.strictEqual(ok.matched, true);
            assert.strictEqual((await rpc_client.table.get_table({ table_bucket_id: tb, namespace_name: 'db', name: 'orders' })).table, undefined);
            assert((await rpc_client.table.get_table({ table_bucket_id: tb, namespace_name: 'db2', name: 'o2' })).table);

            const del = await rpc_client.table.delete_table({ table_id: String(created._id), namespace_name: 'db2', name: 'o2' });
            assert.strictEqual(del.matched, true);
        });

        mocha.it('duplicate {table_bucket, namespace, name} is rejected', async function() {
            await rpc_client.table.create_table({ table_bucket_id: tb, namespace_name: 'db', name: 'dup' });
            await assert.rejects(rpc_client.table.create_table({ table_bucket_id: tb, namespace_name: 'db', name: 'dup' }), /CONFLICT|already exists/);
        });
    });

    mocha.describe('the pointer swap (§6.3)', function() {
        let tb;
        mocha.before(async function() {
            const name = `tb-parent-${oid()}`;
            const b = await rpc_client.table.create_table_bucket({ name, backing_bucket_name: `${name}--table-s3-nb`, state: 'ready' });
            tb = String(b._id);
            await rpc_client.table.create_table_namespace({ table_bucket_id: tb, name: 'swap' });
        });

        mocha.it('swapped / not_swapped / no_such_table, and uninitialized establishes the uuid', async function() {
            const p = await rpc_client.table.create_table({ table_bucket_id: tb, namespace_name: 'swap', name: 's1', version_token: 'v0' });
            const id = String(p._id);

            const ok = await rpc_client.table.update_table_metadata_location({
                table_id: id, expected_version_token: 'v0',
                metadata_location: 's3://b/abc/metadata/1.json', metadata_etag: 'd41d8cd98f00b204e9800998ecf8427e',
                table_uuid: 'uuid-1',
            });
            assert.strictEqual(ok.outcome, SWAP_OUTCOME.SWAPPED);
            assert(ok.version_token);
            assert.notStrictEqual(ok.version_token, 'v0');
            const after = await rpc_client.table.get_table({ table_bucket_id: tb, table_id: id });
            assert.strictEqual(after.table.metadata_location, 's3://b/abc/metadata/1.json');
            assert.strictEqual(after.table.table_uuid, 'uuid-1');
            assert.strictEqual(after.table.version_token, ok.version_token);

            const stale = await rpc_client.table.update_table_metadata_location({ table_id: id, expected_version_token: 'v0',
                metadata_location: 's3://b/abc/metadata/2.json', metadata_etag: 'e2' });
            assert.strictEqual(stale.outcome, SWAP_OUTCOME.NOT_SWAPPED);

            const missing = await rpc_client.table.update_table_metadata_location({ table_id: oid(), expected_version_token: 'v0',
                metadata_location: 's3://b/abc/metadata/2.json', metadata_etag: 'e2' });
            assert.strictEqual(missing.outcome, SWAP_OUTCOME.NO_SUCH_TABLE);
        });
    });

    mocha.describe('collection DDL (§5, test 17)', function() {

        mocha.it('the three collections and their unique partial indexes exist', async function() {
            for (const base of ['table_buckets', 'table_namespaces', 'table_pointers']) {
                const col = db_client.instance().collection(base);
                // eslint-disable-next-line no-await-in-loop
                const t = await col.single_query(`SELECT to_regclass($1) AS t`, [base]);
                assert.strictEqual(t.rows[0].t, base);
                // eslint-disable-next-line no-await-in-loop
                const idx = await col.single_query(
                    `SELECT indexdef FROM pg_indexes WHERE tablename = $1 AND indexdef ILIKE '%UNIQUE%'`, [base]);
                assert(idx.rows.some(r => (/where .*deleted.* is null/i).test(r.indexdef)),
                    `${base} must have a unique partial index on deleted:null`);
            }
        });
    });
});
