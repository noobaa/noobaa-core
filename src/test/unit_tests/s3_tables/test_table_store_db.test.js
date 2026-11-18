/* Copyright (C) 2026 NooBaa */
'use strict';

// DB-backed store test for story 6a - the store half of §12 test 16 (table-bucket /
// namespace / table CRUD) and test 17 (collection DDL and the unique partial indexes).
// It talks to table_store directly, which is what both routing modes of test 16 ultimately
// reach; the fcall-vs-RPC routing itself is pinned by test_table_api.test.js (route = md)
// and the register_object_services gating.
//
// It is gated on TABLES_DB_TEST=1 and a reachable PostgreSQL (POSTGRES_HOST/PORT/...), so a
// plain `jest` run without a database skips it instead of hanging on connect-retry. To run:
//   TABLES_DB_TEST=1 POSTGRES_PORT=55432 node ./node_modules/.bin/jest test_table_store_db

const RUN = process.env.TABLES_DB_TEST === '1';

// config.js must not start its NSFS reload watcher (it fires after Jest teardown).
process.env.CONTAINER_PLATFORM = process.env.CONTAINER_PLATFORM || 'TEST';

if (RUN) {
    process.env.DB_TYPE = 'postgres';
    process.env.POSTGRES_HOST = process.env.POSTGRES_HOST || '127.0.0.1';
    process.env.POSTGRES_PORT = process.env.POSTGRES_PORT || '55432';
    process.env.POSTGRES_USER = process.env.POSTGRES_USER || 'postgres';
    process.env.POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD || 'noobaa';
}

const mongodb = require('mongodb');
const db_client = require('../../../util/db_client');
const { TableStore, SWAP_OUTCOME } = require('../../../server/table_services/table_store');

const describe_db = RUN ? describe : describe.skip;
const oid = () => new mongodb.ObjectId();

describe_db('s3_tables table_store (DB-backed)', () => {

    const suffix = `_t6a_${Date.now().toString(36)}`;
    const system = oid();
    const owner = oid();
    let store;

    beforeAll(async () => {
        db_client.instance().set_db_name(`nbtest_tables_${Date.now().toString(36)}`);
        await db_client.instance().createDatabase();
        // instantiate before connect so _init_collections creates exactly these three
        store = new TableStore(suffix);
        await db_client.instance().connect();
        // make sure the DDL finished
        await Promise.all([
            store._table_buckets.init_promise,
            store._table_namespaces.init_promise,
            store._table_pointers.init_promise,
        ]);
    }, 60000);

    afterAll(async () => {
        // disconnect first - DROP DATABASE blocks while the pools still hold connections
        await db_client.instance().disconnect();
        try {
            await db_client.instance().dropDatabase();
        } catch (err) {
            // throwaway DB - a failed drop must not fail the suite
        }
    }, 60000);

    const a_bucket = (name, state = 'provisioning', extra = {}) => ({
        _id: store.new_table_id(),
        system,
        name,
        owner,
        backing_bucket_name: `${name}--table-s3-nb`,
        state,
        created_at: Date.now(),
        ...extra,
    });

    //////////////////////
    //   TABLE BUCKETS  //
    //////////////////////

    describe('table-bucket CRUD', () => {

        it('insert / get-by-id / get-by-name', async () => {
            const b = a_bucket('crud-tb-1');
            await store.insert_table_bucket(b);

            const by_id = await store.get_table_bucket_by_id(b._id);
            expect(by_id.name).toBe('crud-tb-1');
            expect(String(by_id._id)).toBe(String(b._id));
            expect(by_id.state).toBe('provisioning');

            const by_name = await store.get_table_bucket_by_name(system, 'crud-tb-1');
            expect(String(by_name._id)).toBe(String(b._id));
        });

        it('duplicate {system, name} is rejected (unique index)', async () => {
            const b = a_bucket('dup-tb');
            await store.insert_table_bucket(b);
            await expect(store.insert_table_bucket(a_bucket('dup-tb'))).rejects.toThrow(/already exists/);
        });

        it('a soft-deleted name is free to reuse', async () => {
            const b = a_bucket('reuse-tb', 'ready');
            await store.insert_table_bucket(b);
            const matched = await store.delete_table_bucket(b._id);
            expect(matched).toBe(1);
            expect(await store.get_table_bucket_by_id(b._id)).toBeNull();
            // same name inserts again, now that the old row is deleted
            await expect(store.insert_table_bucket(a_bucket('reuse-tb'))).resolves.toBeTruthy();
        });

        it('conditional state transition: only the matching expected_state wins', async () => {
            const b = a_bucket('state-tb', 'provisioning');
            await store.insert_table_bucket(b);

            // wrong expected_state -> no row matched
            expect(await store.update_table_bucket(b._id, { state: 'ready' }, { expected_state: 'ready' })).toBe(0);
            expect((await store.get_table_bucket_by_id(b._id)).state).toBe('provisioning');

            // right expected_state -> provisioning -> ready
            expect(await store.update_table_bucket(b._id, { state: 'ready' }, { expected_state: 'provisioning' })).toBe(1);
            expect((await store.get_table_bucket_by_id(b._id)).state).toBe('ready');

            // the same transition cannot be won twice
            expect(await store.update_table_bucket(b._id, { state: 'ready' }, { expected_state: 'provisioning' })).toBe(0);
        });

        it('conditional delete: only the matching expected_state wins', async () => {
            const b = a_bucket('cond-del-tb', 'ready');
            await store.insert_table_bucket(b);
            expect(await store.delete_table_bucket(b._id, { expected_state: 'provisioning' })).toBe(0);
            expect(await store.delete_table_bucket(b._id, { expected_state: 'ready' })).toBe(1);
        });

        it('list is paginated and scoped by system/owner/state', async () => {
            const sys2 = oid();
            for (let i = 0; i < 5; ++i) {
                // eslint-disable-next-line no-await-in-loop
                await store.insert_table_bucket(a_bucket(`page-tb-${i}`, 'ready'));
            }
            // a different system's bucket must not leak in
            await store.insert_table_bucket({ ...a_bucket('other-sys', 'ready'), system: sys2 });

            const page1 = await store.list_table_buckets({ system, state: 'ready', limit: 2 });
            expect(page1.docs).toHaveLength(2);
            expect(page1.next_marker).toBeTruthy();
            const page2 = await store.list_table_buckets({ system, state: 'ready', limit: 2, marker: page1.next_marker });
            expect(page2.docs.length).toBeGreaterThanOrEqual(1);
            // no cross-system leak
            const all = await store.list_table_buckets({ system, state: 'ready', limit: 1000 });
            expect(all.docs.every(d => String(d.system) === String(system))).toBe(true);
        });
    });

    //////////////////////
    //    NAMESPACES    //
    //////////////////////

    describe('namespace CRUD', () => {
        const tb = oid();

        it('insert / get / update properties / delete', async () => {
            const ns = { _id: store.new_table_id(), table_bucket: tb, name: 'analytics', created_at: Date.now() };
            await store.insert_table_namespace(ns);

            const got = await store.get_table_namespace(tb, 'analytics');
            expect(String(got._id)).toBe(String(ns._id));

            expect(await store.update_table_namespace(tb, 'analytics', { properties: { tier: 'raw' } })).toBe(1);
            expect((await store.get_table_namespace(tb, 'analytics')).properties).toEqual({ tier: 'raw' });

            expect(await store.delete_table_namespace(tb, 'analytics')).toBe(1);
            expect(await store.get_table_namespace(tb, 'analytics')).toBeNull();
        });

        it('duplicate {table_bucket, name} is rejected', async () => {
            const mk = () => ({ _id: store.new_table_id(), table_bucket: tb, name: 'dup-ns', created_at: Date.now() });
            await store.insert_table_namespace(mk());
            await expect(store.insert_table_namespace(mk())).rejects.toThrow(/already exists/);
        });

        it('the same namespace name in two table buckets is two rows', async () => {
            const tb2 = oid();
            await store.insert_table_namespace({ _id: store.new_table_id(), table_bucket: tb, name: 'shared', created_at: Date.now() });
            await expect(store.insert_table_namespace(
                { _id: store.new_table_id(), table_bucket: tb2, name: 'shared', created_at: Date.now() }
            )).resolves.toBeTruthy();
        });

        it('count_table_bucket_namespaces reflects live rows', async () => {
            const tb3 = oid();
            expect(await store.count_table_bucket_namespaces(tb3)).toBe(0);
            await store.insert_table_namespace({ _id: store.new_table_id(), table_bucket: tb3, name: 'ns-a', created_at: Date.now() });
            await store.insert_table_namespace({ _id: store.new_table_id(), table_bucket: tb3, name: 'ns-b', created_at: Date.now() });
            expect(await store.count_table_bucket_namespaces(tb3)).toBe(2);
            await store.delete_table_namespace(tb3, 'ns-a');
            expect(await store.count_table_bucket_namespaces(tb3)).toBe(1);
        });
    });

    //////////////////////
    //      TABLES      //
    //////////////////////

    describe('table-pointer CRUD', () => {
        const tb = oid();

        const a_pointer = (ns, name, extra = {}) => ({
            _id: store.new_table_id(),
            table_bucket: tb,
            namespace_name: ns,
            name,
            version_token: 'tok-init',
            kind: 'table',
            created_at: Date.now(),
            ...extra,
        });

        it('insert uninitialized / get by key / get by id', async () => {
            const p = a_pointer('db', 'orders');
            await store.insert_table_pointer(p);
            expect(p.metadata_location).toBeUndefined();

            const by_key = await store.get_table_pointer(tb, 'db', 'orders');
            expect(String(by_key._id)).toBe(String(p._id));
            expect(by_key.metadata_location).toBeUndefined();

            const by_id = await store.get_table_pointer_by_id(p._id);
            expect(by_id.name).toBe('orders');
        });

        it('duplicate {table_bucket, namespace_name, name} is rejected', async () => {
            await store.insert_table_pointer(a_pointer('db', 'dup-tbl'));
            await expect(store.insert_table_pointer(a_pointer('db', 'dup-tbl'))).rejects.toThrow(/already exists/);
        });

        it('count_namespace_tables reflects live rows', async () => {
            expect(await store.count_namespace_tables(tb, 'cnt')).toBe(0);
            await store.insert_table_pointer(a_pointer('cnt', 't1'));
            await store.insert_table_pointer(a_pointer('cnt', 't2'));
            expect(await store.count_namespace_tables(tb, 'cnt')).toBe(2);
            const t1 = await store.get_table_pointer(tb, 'cnt', 't1');
            await store.delete_table_pointer(t1._id, { namespace_name: 'cnt', name: 't1' });
            expect(await store.count_namespace_tables(tb, 'cnt')).toBe(1);
        });

        it('rename is conditional on the resolved {namespace_name, name}', async () => {
            const p = a_pointer('src', 'movable');
            await store.insert_table_pointer(p);

            // stale resolved name -> no row matched (a concurrent move already happened)
            expect(await store.rename_table_pointer(p._id,
                { namespace_name: 'src', name: 'WRONG' }, { new_name: 'renamed' })).toBe(0);

            // correct resolved name -> moves
            expect(await store.rename_table_pointer(p._id,
                { namespace_name: 'src', name: 'movable' },
                { new_namespace_name: 'dst', new_name: 'renamed' })).toBe(1);
            expect(await store.get_table_pointer(tb, 'src', 'movable')).toBeNull();
            expect(await store.get_table_pointer(tb, 'dst', 'renamed')).toBeTruthy();
        });

        it('delete is conditional on {namespace_name, name} and on a version token', async () => {
            const p = a_pointer('del', 'target', { version_token: 'v1' });
            await store.insert_table_pointer(p);
            // wrong token -> no match
            expect(await store.delete_table_pointer(p._id,
                { namespace_name: 'del', name: 'target', expected_version_token: 'nope' })).toBe(0);
            // right token -> deleted
            expect(await store.delete_table_pointer(p._id,
                { namespace_name: 'del', name: 'target', expected_version_token: 'v1' })).toBe(1);
            expect(await store.get_table_pointer(tb, 'del', 'target')).toBeNull();
        });
    });

    //////////////////////
    //     THE SWAP     //
    //////////////////////

    describe('pointer swap (§6.3)', () => {
        const tb = oid();
        const a_pointer = (name, extra = {}) => ({
            _id: store.new_table_id(),
            table_bucket: tb,
            namespace_name: 'swap',
            name,
            version_token: 'v0',
            kind: 'table',
            created_at: Date.now(),
            ...extra,
        });

        // ETags are stored in NooBaa's internal form (hex md5, no surrounding quotes) -
        // exactly as object_server stores them via $set (object_server.js), and what the
        // catalog captures from object_sdk in story 11/12.
        it('matching token swaps, stores location+etag, returns the new token', async () => {
            const p = a_pointer('s1');
            await store.insert_table_pointer(p);
            const res = await store.swap_table_pointer(p._id, 'v0',
                { metadata_location: 's3://b/abc/metadata/1.json', metadata_etag: 'd41d8cd98f00b204e9800998ecf8427e' }, 'v1');
            expect(res.outcome).toBe(SWAP_OUTCOME.SWAPPED);
            expect(res.version_token).toBe('v1');
            const after = await store.get_table_pointer_by_id(p._id);
            expect(after.metadata_location).toBe('s3://b/abc/metadata/1.json');
            expect(after.metadata_etag).toBe('d41d8cd98f00b204e9800998ecf8427e');
            expect(after.version_token).toBe('v1');
        });

        it('stale token reports not_swapped (never no_such_table)', async () => {
            const p = a_pointer('s2');
            await store.insert_table_pointer(p);
            const res = await store.swap_table_pointer(p._id, 'WRONG',
                { metadata_location: 's3://b/x/1.json', metadata_etag: 'abc123' }, 'v1');
            expect(res.outcome).toBe(SWAP_OUTCOME.NOT_SWAPPED);
        });

        it('missing or deleted row reports no_such_table', async () => {
            const missing = await store.swap_table_pointer(oid(), 'v0', {}, 'v1');
            expect(missing.outcome).toBe(SWAP_OUTCOME.NO_SUCH_TABLE);

            const p = a_pointer('s3');
            await store.insert_table_pointer(p);
            await store.delete_table_pointer(p._id);
            const res = await store.swap_table_pointer(p._id, 'v0', {}, 'v1');
            expect(res.outcome).toBe(SWAP_OUTCOME.NO_SUCH_TABLE);
        });

        it('a swap on an uninitialized pointer establishes the table uuid (§6.1.3)', async () => {
            const p = a_pointer('s4'); // uninitialized: no metadata_location, no table_uuid
            await store.insert_table_pointer(p);
            const res = await store.swap_table_pointer(p._id, 'v0',
                { metadata_location: 's3://b/s4/1.json', metadata_etag: 'e4beef', table_uuid: 'uuid-xyz' }, 'v1');
            expect(res.outcome).toBe(SWAP_OUTCOME.SWAPPED);
            const after = await store.get_table_pointer_by_id(p._id);
            expect(after.table_uuid).toBe('uuid-xyz');
        });
    });

    //////////////////////
    //   DDL (test 17)  //
    //////////////////////

    describe('collection DDL and unique partial indexes (§5, test 17)', () => {

        async function index_defs(collection) {
            const res = await collection.single_query(
                `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = $1`, [collection.name]);
            return res.rows;
        }

        // Match on the index definition, not the generated name: a suffixed test collection
        // can push the name past PostgreSQL's 63-char identifier limit, where it is truncated.
        function find_unique_partial(rows, fields) {
            return rows.find(r =>
                (/UNIQUE/).test(r.indexdef) &&
                fields.every(f => r.indexdef.includes(`'${f}'`)) &&
                (/where .*deleted.* is null/i).test(r.indexdef));
        }

        it('all three tables exist exactly once', async () => {
            for (const c of [store._table_buckets, store._table_namespaces, store._table_pointers]) {
                // eslint-disable-next-line no-await-in-loop
                const res = await c.single_query(`SELECT to_regclass($1) AS t`, [c.name]);
                expect(res.rows[0].t).toBe(c.name);
            }
        });

        it('table_buckets has a unique partial index on (system, name)', async () => {
            const idx = find_unique_partial(await index_defs(store._table_buckets), ['system', 'name']);
            expect(idx).toBeTruthy();
        });

        it('table_namespaces has a unique partial index on (table_bucket, name)', async () => {
            const idx = find_unique_partial(await index_defs(store._table_namespaces), ['table_bucket', 'name']);
            expect(idx).toBeTruthy();
        });

        it('table_pointers has a unique partial index on (table_bucket, namespace_name, name)', async () => {
            const idx = find_unique_partial(await index_defs(store._table_pointers),
                ['table_bucket', 'namespace_name', 'name']);
            expect(idx).toBeTruthy();
        });
    });
});
