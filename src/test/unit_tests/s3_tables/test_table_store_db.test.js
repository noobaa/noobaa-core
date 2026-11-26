/* Copyright (C) 2026 NooBaa */
'use strict';

// DB-backed store tests for stories 6a and 6b - the store half of §12 test 16 (table-bucket /
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

            expect(await store.get_table_bucket_by_id(b._id)).toBeNull();
            const by_id = await store.get_table_bucket_by_id(b._id, { include_inactive: true });
            expect(by_id.name).toBe('crud-tb-1');
            expect(String(by_id._id)).toBe(String(b._id));
            expect(by_id.state).toBe('provisioning');

            const by_name = await store.get_table_bucket_by_name(system, 'crud-tb-1', { include_inactive: true });
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

        it('conditional state transitions have exactly one winner', async () => {
            const b = a_bucket('state-tb');
            await store.insert_table_bucket(b);
            const results = await Promise.all([
                store.update_table_bucket(b._id, { state: 'ready' }, { expected_state: 'provisioning' }),
                store.update_table_bucket(b._id, { state: 'aborting' }, { expected_state: 'provisioning' }),
            ]);
            expect(results.sort()).toEqual([0, 1]);
            await expect(store.update_table_bucket(b._id, { state: 'ready' })).rejects.toMatchObject({ rpc_code: 'INVALID_REQUEST' });
        });

        it('conditional delete: only the matching expected_state wins', async () => {
            const b = a_bucket('cond-del-tb', 'ready');
            await store.insert_table_bucket(b);
            expect(await store.delete_table_bucket(b._id, { expected_state: 'provisioning' })).toBe(0);
            expect(await store.delete_table_bucket(b._id, { expected_state: 'ready' })).toBe(1);
        });

        it.each(['provisioning', 'aborting', 'deleting'])('hides %s from ordinary reads while allowing recovery and deletion', async state => {
            const b = a_bucket(`hidden-${state}`, state);
            await store.insert_table_bucket(b);
            expect(await store.get_table_bucket_by_id(b._id)).toBeNull();
            expect(await store.get_table_bucket_by_name(system, b.name)).toBeNull();
            expect((await store.list_table_buckets({ system })).docs.some(d => d.name === b.name)).toBe(false);
            expect(await store.get_table_bucket_by_id(b._id, { include_inactive: true })).toBeTruthy();
            expect(await store.delete_table_bucket(b._id)).toBe(1);
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
        beforeAll(async () => {
            await store.insert_table_bucket({ ...a_bucket(`parent-${tb}`, 'ready'), _id: tb });
        });

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
            await store.insert_table_bucket({ ...a_bucket(`parent-${tb2}`, 'ready'), _id: tb2 });
            await store.insert_table_namespace({ _id: store.new_table_id(), table_bucket: tb, name: 'shared', created_at: Date.now() });
            await expect(store.insert_table_namespace(
                { _id: store.new_table_id(), table_bucket: tb2, name: 'shared', created_at: Date.now() }
            )).resolves.toBeTruthy();
        });

        it('count_table_bucket_namespaces reflects live rows', async () => {
            const tb3 = oid();
            await store.insert_table_bucket({ ...a_bucket(`parent-${tb3}`, 'ready'), _id: tb3 });
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
        beforeAll(async () => {
            await store.insert_table_bucket({ ...a_bucket(`parent-${tb}`, 'ready'), _id: tb });
        });

        beforeAll(async () => {
            for (const name of ['db', 'cnt', 'src', 'dst', 'del']) {
                // eslint-disable-next-line no-await-in-loop
                await store.insert_table_namespace({ _id: oid(), table_bucket: tb, name });
            }
        });

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
            // A request resolved before the move must not modify the moved pointer.
            expect(await store.delete_table_pointer(p._id, { namespace_name: 'src', name: 'movable' })).toBe(0);
            expect(await store.rename_table_pointer(p._id,
                { namespace_name: 'src', name: 'movable' }, { new_name: 'stale' })).toBe(0);
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
        beforeAll(async () => {
            await store.insert_table_bucket({ ...a_bucket(`parent-${tb}`, 'ready'), _id: tb });
        });
        beforeAll(async () => {
            await store.insert_table_namespace({ _id: oid(), table_bucket: tb, name: 'swap' });
        });

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
                { metadata_location: 's3://b/abc/metadata/1.json', metadata_etag: 'd41d8cd98f00b204e9800998ecf8427e' });
            expect(res.outcome).toBe(SWAP_OUTCOME.SWAPPED);
            expect(res.version_token).toEqual(expect.any(String));
            expect(res.version_token).not.toBe('v0');
            const after = await store.get_table_pointer_by_id(p._id);
            expect(after.metadata_location).toBe('s3://b/abc/metadata/1.json');
            expect(after.metadata_etag).toBe('d41d8cd98f00b204e9800998ecf8427e');
            expect(after.version_token).toBe(res.version_token);
        });

        it('stale token reports not_swapped (never no_such_table)', async () => {
            const p = a_pointer('s2');
            await store.insert_table_pointer(p);
            const res = await store.swap_table_pointer(p._id, 'WRONG',
                { metadata_location: 's3://b/x/1.json', metadata_etag: 'abc123' });
            expect(res.outcome).toBe(SWAP_OUTCOME.NOT_SWAPPED);
        });

        it('missing or deleted row reports no_such_table', async () => {
            const missing = await store.swap_table_pointer(oid(), 'v0', {});
            expect(missing.outcome).toBe(SWAP_OUTCOME.NO_SUCH_TABLE);

            const p = a_pointer('s3');
            await store.insert_table_pointer(p);
            await store.delete_table_pointer(p._id, { namespace_name: 'swap', name: p.name });
            const res = await store.swap_table_pointer(p._id, 'v0', {});
            expect(res.outcome).toBe(SWAP_OUTCOME.NO_SUCH_TABLE);
        });

        it('successive swaps issue fresh tokens and cannot revive a stale writer', async () => {
            const p = a_pointer('no-token-reuse');
            await store.insert_table_pointer(p);
            const first = await store.swap_table_pointer(p._id, 'v0', { metadata_location: 's3://b/first', metadata_etag: 'e1' });
            const second = await store.swap_table_pointer(p._id, first.version_token, { metadata_location: 's3://b/second', metadata_etag: 'e2' });
            expect(new Set(['v0', first.version_token, second.version_token]).size).toBe(3);
            expect(await store.swap_table_pointer(p._id, 'v0', { metadata_location: 's3://b/stale', metadata_etag: 'e0' }))
                .toEqual({ outcome: SWAP_OUTCOME.NOT_SWAPPED });
            const after = await store.get_table_pointer_by_id(p._id);
            expect(after.metadata_location).toBe('s3://b/second');
            expect(after.version_token).toBe(second.version_token);
        });

        it('a swap on an uninitialized pointer establishes the table uuid (§6.1.3)', async () => {
            const p = a_pointer('s4'); // uninitialized: no metadata_location, no table_uuid
            await store.insert_table_pointer(p);
            const res = await store.swap_table_pointer(p._id, 'v0',
                { metadata_location: 's3://b/s4/1.json', metadata_etag: 'e4beef', table_uuid: 'uuid-xyz' });
            expect(res.outcome).toBe(SWAP_OUTCOME.SWAPPED);
            const after = await store.get_table_pointer_by_id(p._id);
            expect(after.table_uuid).toBe('uuid-xyz');
        });
    });

    register_coordination_tests(() => store, suffix, a_bucket);

    register_query_plan_test(() => store, a_bucket);

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

function register_coordination_tests(get_store, suffix, a_bucket) {
    let store;
    beforeAll(() => { store = get_store(); });
    describe('catalog coordination across processes', () => {
        const children = new Set();
        afterEach(async () => {
            for (const child of children) child.kill('SIGKILL');
            children.clear();
        });

        async function paused_child(operation, bucket, namespace, pointer, target) {
            const child = require('child_process').fork(require.resolve('./table_store_transaction_child'), [], {
                env: { ...process.env }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
            });
            children.add(child);
            const paused = new Promise((resolve, reject) => {
                child.once('message', msg => (msg.error ? reject(new Error(msg.error)) : resolve(msg)));
                child.once('exit', code => reject(new Error(`Child exited before pause: ${code}`)));
            });
            child.send({ db_name: db_client.instance().get_db_name(), suffix, operation,
                bucket: String(bucket), namespace, pointer: pointer && String(pointer), target });
            const msg = await paused;
            child.catalog_backend_pid = msg.backend_pid;
            return child;
        }

        // Observe the second connection waiting on PostgreSQL's lock manager before
        // allowing the first transaction to commit. Timing alone cannot prove locking.
        async function wait_for_lock(child) {
            const deadline = Date.now() + 5000;
            while (Date.now() < deadline) {
                // eslint-disable-next-line no-await-in-loop
                const res = await store._table_pointers.single_query(
                    `SELECT 1 FROM pg_stat_activity WHERE datname = $1 AND wait_event_type = 'Lock'` +
                    ` AND $2 = ANY(pg_blocking_pids(pid))`,
                    [db_client.instance().get_db_name(), child.catalog_backend_pid]);
                if (res.rowCount) return;
                // eslint-disable-next-line no-await-in-loop
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            throw new Error('Expected the competing catalog operation to wait for a row lock');
        }

        async function resume(child) {
            const done = new Promise((resolve, reject) => child.once('message', msg =>
                (msg.error ? reject(new Error(msg.error)) : resolve(msg))));
            child.send('commit');
            await done;
            children.delete(child);
        }

        async function fixture(name) {
            const b = a_bucket(name, 'ready');
            await store.insert_table_bucket(b);
            await store.insert_table_namespace({ _id: oid(), table_bucket: b._id, name: 'src' });
            await store.insert_table_namespace({ _id: oid(), table_bucket: b._id, name: 'dst' });
            return b._id;
        }

        it.each(['insert', 'rename'])('%s holds the target namespace until commit; delete then refuses', async operation => {
            const tb = await fixture(`race-${operation}`);
            const pointer = oid();
            if (operation === 'rename') {
                await store.insert_table_pointer({ _id: pointer, table_bucket: tb, namespace_name: 'src',
                    name: 'child', version_token: 'v0', kind: 'table' });
            }
            const child = await paused_child(operation, tb, operation === 'insert' ? 'dst' : 'src', pointer, 'dst');
            const deletion = store.delete_table_namespace(tb, 'dst');
            const assertion = expect(deletion).rejects.toMatchObject({ rpc_code: 'NOT_EMPTY' });
            await wait_for_lock(child);
            await resume(child);
            await assertion;
            expect(await store.get_table_pointer(tb, 'dst', 'child')).toBeTruthy();
            expect(await store.get_table_namespace(tb, 'dst')).toBeTruthy();
        }, 20000);

        it.each(['insert', 'rename'])('a namespace deletion winning first rejects an arriving %s', async operation => {
            const tb = await fixture(`delete-first-${operation}`);
            const pointer = oid();
            if (operation === 'rename') {
                await store.insert_table_pointer({ _id: pointer, table_bucket: tb, namespace_name: 'src',
                    name: 'child', version_token: 'v0', kind: 'table' });
            }
            const child = await paused_child('delete', tb, 'dst');
            const insertion = operation === 'insert' ?
                store.insert_table_pointer({ _id: pointer, table_bucket: tb,
                    namespace_name: 'dst', name: 'late', version_token: 'v0', kind: 'table' }) :
                store.rename_table_pointer(pointer, { namespace_name: 'src', name: 'child' }, { new_namespace_name: 'dst' });
            const assertion = expect(insertion).rejects.toMatchObject({ rpc_code: 'NO_SUCH_NAMESPACE' });
            await wait_for_lock(child);
            await resume(child);
            await assertion;
            expect(await store.count_namespace_tables(tb, 'dst')).toBe(0);
        }, 20000);

        it.each(['insert', 'rename', 'delete'])('killing a process during %s rolls back the complete change', async operation => {
            const tb = await fixture(`kill-${operation}`);
            const pointer = oid();
            if (operation === 'rename') {
                await store.insert_table_pointer({ _id: pointer, table_bucket: tb, namespace_name: 'src',
                    name: 'child', version_token: 'v0', kind: 'table' });
            }
            const child = await paused_child(operation, tb, operation === 'rename' ? 'src' : 'dst', pointer, 'dst');
            const exited = new Promise(resolve => child.once('exit', resolve));
            child.kill('SIGKILL');
            await exited;
            children.delete(child);
            // Taking the exclusive lock waits for PostgreSQL to finish crash rollback.
            expect(await store.delete_table_namespace(tb, 'dst')).toBe(1);
            expect(await store.get_table_pointer(tb, 'dst', 'child')).toBeNull();
            if (operation === 'rename') expect(await store.get_table_pointer(tb, 'src', 'child')).toBeTruthy();
        }, 20000);

        it.each(['namespace', 'bucket'])('bucket lifecycle serializes with namespace creation (%s first)', async operation => {
            const b = a_bucket(`bucket-race-${operation}`, 'ready');
            await store.insert_table_bucket(b);
            const child = await paused_child(operation, b._id, 'ns');
            const losing = operation === 'namespace' ?
                store.update_table_bucket(b._id, { state: 'deleting' }, { expected_state: 'ready' }) :
                store.insert_table_namespace({ _id: oid(), table_bucket: b._id, name: 'late' });
            const assertion = expect(losing).rejects.toMatchObject({
                rpc_code: operation === 'namespace' ? 'NOT_EMPTY' : 'NO_SUCH_TABLE_BUCKET',
            });
            await wait_for_lock(child);
            await resume(child);
            await assertion;
        }, 20000);

        it('concurrent creates and renames onto one name produce exactly one winner', async () => {
            const tb = await fixture('duplicate-races');
            const make = name => ({ _id: oid(), table_bucket: tb, namespace_name: 'src', name,
                version_token: 'v0', kind: 'table' });
            const creates = await Promise.allSettled([store.insert_table_pointer(make('same')), store.insert_table_pointer(make('same'))]);
            expect(creates.filter(r => r.status === 'fulfilled')).toHaveLength(1);
            expect(creates.find(r => r.status === 'rejected').reason.rpc_code).toBe('ALREADY_EXISTS');
            const p1 = make('first');
            const p2 = make('second');
            await store.insert_table_pointer(p1);
            await store.insert_table_pointer(p2);
            const renames = await Promise.allSettled([p1, p2].map(p => store.rename_table_pointer(p._id,
                { namespace_name: 'src', name: p.name }, { new_namespace_name: 'dst', new_name: 'same' })));
            expect(renames.filter(r => r.status === 'fulfilled')).toHaveLength(1);
            expect(renames.find(r => r.status === 'rejected').reason.rpc_code).toBe('ALREADY_EXISTS');
        });

        it('empty pages distinguish an empty namespace from a missing one', async () => {
            const tb = await fixture('empty-pages');
            expect((await store.list_table_pointers({ table_bucket: tb, namespace_name: 'dst' })).docs).toEqual([]);
            await expect(store.list_table_pointers({ table_bucket: tb, namespace_name: 'absent' }))
                .rejects.toMatchObject({ rpc_code: 'NO_SUCH_NAMESPACE' });
        });
    });

}

function register_query_plan_test(get_store, a_bucket) {
    let store;
    beforeAll(() => { store = get_store(); });
    it('pointer read, swap and namespace lock use indexes with 10,000 records', async () => {
        const b = a_bucket('query-plans', 'ready');
        await store.insert_table_bucket(b);
        await store.insert_table_namespace({ _id: oid(), table_bucket: b._id, name: 'db' });
        const docs = Array.from({ length: 10000 }, (_, i) => ({ _id: oid(), table_bucket: b._id,
            namespace_name: 'db', name: `table-${i}`, kind: 'table', version_token: 'v0' }));
        await store._table_pointers.insertManyUnordered(docs);
        await store._table_namespaces.insertManyUnordered(Array.from({ length: 10000 }, (_, i) => ({
            _id: oid(), table_bucket: b._id, name: `namespace-${i}`,
        })));
        await store._table_namespaces.single_query(`ANALYZE ${store._table_namespaces.name}`);
        await store._table_pointers.single_query(`ANALYZE ${store._table_pointers.name}`);
        // Capture the actual generated queries so the assertions cover production selectors.
        const plans = [];
        const originals = new Map();
        for (const collection of [store._table_pointers, store._table_namespaces]) {
            const single_query = collection.single_query.bind(collection);
            originals.set(collection, single_query);
            collection.single_query = async (sql, values) => {
                const res = await single_query(`EXPLAIN (FORMAT JSON) ${sql}`, values);
                plans.push(res.rows[0]['QUERY PLAN'][0].Plan);
                return single_query(sql, values);
            };
        }
        try {
            await store.get_table_pointer(b._id, 'db', docs[5000].name);
            await store.swap_table_pointer(docs[5000]._id, 'v0', { metadata_location: 's3://b/m', metadata_etag: 'e' });
            await store._lock_namespace(b._id, 'namespace-5000', 'SHARE');
        } finally {
            for (const [collection, single_query] of originals) collection.single_query = single_query;
        }
        expect(plans).toHaveLength(3);
        for (const plan of plans) {
            expect(JSON.stringify(plan)).toMatch(/Index Scan/);
            expect(JSON.stringify(plan)).not.toMatch(/Seq Scan/);
        }
    });

}
