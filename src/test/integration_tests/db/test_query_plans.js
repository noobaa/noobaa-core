/* Copyright (C) 2016 NooBaa */
/* eslint max-lines-per-function: ["error", 3000] */
/* eslint max-statements: ["error", 200] */
'use strict';

const coretest = require('../../utils/coretest/coretest');
coretest.setup();

const assert = require('assert');
const mocha = require('mocha');
const config = require('../../../../config');
const db_client = require('../../../util/db_client');
const MDStore = require('../../../server/object_services/md_store').MDStore;
const { ExplainPlanChecker } = require('../../utils/explain_plan_checker');

mocha.describe('md_store query plan verification', function() {
    this.timeout(300000); // eslint-disable-line no-invalid-this

    const md_store = new MDStore(`_test_plans_${Date.now().toString(36)}`);
    const checker = new ExplainPlanChecker();
    const system_id = md_store.make_md_id();
    const bucket_id = md_store.make_md_id();
    const bucket_id2 = md_store.make_md_id();

    const OBJ = md_store._objects.name;
    const PART = md_store._parts.name;
    const CHUNK = md_store._chunks.name;
    const BLOCK = md_store._blocks.name;
    const MPART = md_store._multiparts.name;

    const results = [];
    const test_ids = {};

    function record(name, table, plans_arr, checker_inst) {
        if (!plans_arr || plans_arr.length === 0) {
            results.push({ name, table, status: 'SKIP', detail: 'no plans captured' });
            return;
        }
        for (const entry of plans_arr) {
            if (entry.error) {
                results.push({ name, table, status: 'ERROR', detail: entry.error.slice(0, 80) });
                continue;
            }
            const root = entry.plan[0].Plan;
            const indexes = checker_inst._extract_indexes(root);
            const has_seq = checker_inst._has_seq_scan_on(root, table);
            if (has_seq) {
                results.push({ name, table, status: 'MISS', detail: `Seq Scan (indexes: ${indexes.join(', ') || 'none'})` });
            } else {
                results.push({ name, table, status: 'HIT', detail: indexes.join(', ') || 'n/a' });
            }
        }
    }

    /**
     * @param {string} name - test label for the report
     * @param {Function} fn - async function that invokes the md_store method
     * @param {string[]} tables - table names to check plans for
     * @param {{ allow_miss?: boolean }} [opts] - pass { allow_miss: true } for known seq-scan cases
     */
    async function check(name, fn, tables, opts) {
        const allow_miss = opts && opts.allow_miss;
        checker.enable(md_store);
        try {
            await fn();
        } catch (_err) {
            // function may fail due to data conditions; we only care about the plan
        }
        const before_len = results.length;
        for (const t of tables) {
            const plans = checker.plans.filter(p => p.query && p.query.includes(t));
            record(name, t, plans, checker);
        }
        if (tables.length === 0) {
            record(name, '(any)', checker.plans, checker);
        }
        checker.disable();
        checker.plans = [];

        if (!allow_miss) {
            const new_results = results.slice(before_len);
            const misses = new_results.filter(r => r.status === 'MISS');
            assert.strictEqual(misses.length, 0,
                `${name}: unexpected Seq Scan on: ${misses.map(m => `${m.table} (${m.detail})`).join(', ')}`);
        }
    }

    // ─────────────────────── setup ───────────────────────

    mocha.before(async function() {
        if (config.DB_TYPE !== 'postgres') this.skip(); // eslint-disable-line no-invalid-this

        const obj_batch = [];
        for (let i = 0; i < 200; i++) {
            obj_batch.push({
                _id: md_store.make_md_id(),
                system: system_id,
                bucket: bucket_id,
                key: `plan-key-${i}-${Date.now().toString(36)}`,
                create_time: new Date(),
                content_type: 'application/octet-stream',
                size: (i + 1) * 10,
                version_seq: i + 1,
            });
        }
        for (const obj of obj_batch) {
            await md_store.insert_object(obj);
        }

        // objects with special states
        const upload_obj = {
            _id: md_store.make_md_id(),
            system: system_id,
            bucket: bucket_id,
            key: 'plan-upload-' + Date.now().toString(36),
            content_type: 'text/plain',
            upload_started: md_store.make_md_id(),
            create_time: new Date(),
        };
        await md_store.insert_object(upload_obj);

        const deleted_obj = {
            _id: md_store.make_md_id(),
            system: system_id,
            bucket: bucket_id,
            key: 'plan-deleted-' + Date.now().toString(36),
            content_type: 'text/plain',
            size: 1,
            deleted: new Date(),
            reclaimed: new Date(),
            create_time: new Date(),
        };
        await md_store.insert_object(deleted_obj);

        const dm_obj = {
            _id: md_store.make_md_id(),
            system: system_id,
            bucket: bucket_id,
            key: 'plan-dm-' + Date.now().toString(36),
            content_type: 'text/plain',
            delete_marker: true,
            create_time: new Date(),
        };
        await md_store.insert_object(dm_obj);

        // dedicated objects for destructive tests
        const ids = {};
        const make_obj = (suffix, extra) => {
            const obj = {
                _id: md_store.make_md_id(),
                system: system_id,
                bucket: bucket_id,
                key: `plan-${suffix}-${Date.now().toString(36)}`,
                create_time: new Date(),
                content_type: 'text/plain',
                size: 10,
                ...extra,
            };
            ids[suffix] = obj;
            return obj;
        };

        const destructive_objs = [
            make_obj('upd1'), make_obj('upd2'), make_obj('upd3'),
            make_obj('rm1'), make_obj('rm2'), make_obj('rm3'), make_obj('rm4'),
            make_obj('deferred_target'),
            make_obj('mrk_old'),
            make_obj('mrk_put', { upload_started: md_store.make_md_id() }),
            make_obj('mv1'), make_obj('mv2'),
            make_obj('dm_src'),
            make_obj('dm_mv1'), make_obj('dm_mv2'),
            make_obj('cul_unmark'), make_obj('cul_put', { upload_started: md_store.make_md_id() }),
            make_obj('cul_del1'), make_obj('cul_del2'),
            make_obj('cul_put2', { upload_started: md_store.make_md_id() }),
            make_obj('dm_del1'), make_obj('dm_del2'), make_obj('dm_del3'),
            make_obj('del_id'),
        ];
        for (const obj of destructive_objs) {
            await md_store.insert_object(obj);
        }

        // chunks, parts, blocks for mapping queries
        const frag_id = md_store.make_md_id();
        const chunk = {
            _id: md_store.make_md_id(),
            system: system_id,
            bucket: bucket_id,
            size: 100,
            frag_size: 100,
            frags: [{ _id: frag_id }],
        };
        await md_store.insert_chunks([chunk]);

        const part = {
            _id: md_store.make_md_id(),
            system: system_id,
            bucket: bucket_id,
            obj: obj_batch[0]._id,
            chunk: chunk._id,
            start: 0,
            end: 100,
            seq: 0,
        };
        await md_store.insert_parts([part]);

        const node_id = md_store.make_md_id();
        const block = {
            _id: md_store.make_md_id(),
            system: system_id,
            bucket: bucket_id,
            node: node_id,
            chunk: chunk._id,
            frag: frag_id,
            size: 100,
        };
        await md_store.insert_blocks([block]);

        // multipart
        const mpart = {
            _id: md_store.make_md_id(),
            system: system_id,
            bucket: bucket_id,
            obj: obj_batch[0]._id,
            num: 1,
            size: 50,
            md5_b64: 'abc',
            create_time: new Date(),
        };
        await md_store.insert_multipart(mpart);

        test_ids.obj_batch = obj_batch;
        test_ids.upload_obj = upload_obj;
        test_ids.deleted_obj = deleted_obj;
        test_ids.dm_obj = dm_obj;
        test_ids.chunk = chunk;
        test_ids.part = part;
        test_ids.block = block;
        test_ids.node_id = node_id;
        test_ids.frag_id = frag_id;
        test_ids.mpart = mpart;
        test_ids.ids = ids;

        // ANALYZE all tables
        for (const tbl of [OBJ, PART, CHUNK, BLOCK, MPART]) {
            await db_client.instance().executeSQL(`ANALYZE ${tbl}`, [], { preferred_pool: 'md' });
        }
    });

    // ─────────────────────── report ───────────────────────

    mocha.after(function() {
        if (results.length === 0) return;

        const name_w = Math.max(50, ...results.map(r => r.name.length + 2));
        const tbl_w = Math.max(20, ...results.map(r => r.table.length + 2));
        const det_w = Math.max(30, ...results.map(r => r.detail.length + 2));

        const pad = (s, w) => s + ' '.repeat(Math.max(0, w - s.length));
        const line = (a, b, c, d) =>
            `  │ ${pad(a, name_w)} │ ${pad(b, 6)} │ ${pad(c, tbl_w)} │ ${pad(d, det_w)} │`;
        const sep = ch =>
            `  ${ch}${'─'.repeat(name_w + 2)}${ch}${'─'.repeat(8)}${ch}${'─'.repeat(tbl_w + 2)}${ch}${'─'.repeat(det_w + 2)}${ch}`;

        console.log('\n');
        console.log('  ╔══════════════════════════════════════════════════════════════╗');
        console.log('  ║           MD Store Query Plan Report                        ║');
        console.log('  ╚══════════════════════════════════════════════════════════════╝');
        console.log('');
        console.log(sep('┌'));
        console.log(line('Function', 'Result', 'Table', 'Index / Detail'));
        console.log(sep('├'));
        const STATUS_TAGS = { HIT: ' HIT ', MISS: ' MISS', SKIP: ' SKIP', ERROR: ' ERR ' };
        for (const r of results) {
            console.log(line(r.name, STATUS_TAGS[r.status] || ' ??? ', r.table, r.detail));
        }
        console.log(sep('└'));

        const hits = results.filter(r => r.status === 'HIT').length;
        const misses = results.filter(r => r.status === 'MISS').length;
        const skips = results.filter(r => r.status === 'SKIP').length;
        const errors = results.filter(r => r.status === 'ERROR').length;
        console.log(`\n  Summary: ${hits} HIT, ${misses} MISS, ${skips} SKIP, ${errors} ERROR\n`);
    });

    // ─────────────────── OBJECTS ────────────────────

    mocha.it('objects - find_object_latest', async function() {
        const obj = test_ids.obj_batch[0];
        await check('find_object_latest', () => md_store.find_object_latest(bucket_id, obj.key), [OBJ]);
    });

    mocha.it('objects - find_object_null_version', async function() {
        const obj = test_ids.obj_batch[1];
        await check('find_object_null_version', () => md_store.find_object_null_version(bucket_id, obj.key), [OBJ]);
    });

    mocha.it('objects - find_object_or_upload_null_version', async function() {
        const obj = test_ids.obj_batch[2];
        await check('find_object_or_upload_null_version', () => md_store.find_object_or_upload_null_version(bucket_id, obj.key), [OBJ]);
    });

    mocha.it('objects - find_object_by_version', async function() {
        const obj = test_ids.obj_batch[3];
        await check('find_object_by_version', () => md_store.find_object_by_version(bucket_id, obj.key, obj.version_seq), [OBJ]);
    });

    mocha.it('objects - find_object_prev_version', async function() {
        const obj = test_ids.obj_batch[4];
        await check('find_object_prev_version', () => md_store.find_object_prev_version(bucket_id, obj.key), [OBJ]);
    });

    mocha.it('objects - find_object_by_id', async function() {
        await check('find_object_by_id', () => md_store.find_object_by_id(test_ids.obj_batch[5]._id), [OBJ]);
    });

    mocha.it('objects - find_objects_by_id', async function() {
        const ids = test_ids.obj_batch.slice(0, 3).map(o => o._id);
        await check('find_objects_by_id', () => md_store.find_objects_by_id(ids), [OBJ]);
    });

    mocha.it('objects - update_object_by_id', async function() {
        const obj = test_ids.ids.upd1;
        await check('update_object_by_id', () => md_store.update_object_by_id(obj._id, { size: 999 }), [OBJ]);
    });

    mocha.it('objects - update_objects_by_ids', async function() {
        const ids_arr = [test_ids.ids.upd2._id, test_ids.ids.upd3._id];
        await check('update_objects_by_ids', () => md_store.update_objects_by_ids(ids_arr, { size: 888 }), [OBJ]);
    });

    mocha.it('objects - remove_object_and_unset_latest', async function() {
        await check('remove_object_and_unset_latest', () => md_store.remove_object_and_unset_latest(test_ids.ids.rm1), [OBJ]);
    });

    mocha.it('objects - remove_objects_and_unset_latest', async function() {
        await check('remove_objects_and_unset_latest', () => md_store.remove_objects_and_unset_latest([test_ids.ids.rm2]), [OBJ]);
    });

    mocha.it('objects - delete_and_insert_deferred (by key)', async function() {
        const target = test_ids.ids.deferred_target;
        const new_obj = {
            _id: md_store.make_md_id(),
            system: system_id,
            bucket: bucket_id,
            key: target.key,
            create_time: new Date(),
            content_type: 'text/plain',
            size: 99,
        };
        await check('delete_and_insert_deferred (by key)',
            () => md_store.delete_and_insert_deferred({
                delete_obj_id: undefined,
                bucket_id,
                key: target.key,
                object_md: new_obj,
                chunks: [],
                parts: [],
                blocks: [],
            }),
            [OBJ]);
    });

    mocha.it('objects - delete_and_insert_deferred (by id)', async function() {
        const target = test_ids.ids.rm3;
        const new_obj = {
            _id: md_store.make_md_id(),
            system: system_id,
            bucket: bucket_id,
            key: target.key,
            create_time: new Date(),
            content_type: 'text/plain',
            size: 99,
        };
        await check('delete_and_insert_deferred (by id)',
            () => md_store.delete_and_insert_deferred({
                delete_obj_id: target._id,
                bucket_id: undefined,
                key: undefined,
                object_md: new_obj,
                chunks: [],
                parts: [],
                blocks: [],
            }),
            [OBJ]);
    });

    mocha.it('objects - complete_object_upload_mark_remove_by_key', async function() {
        const put = test_ids.ids.mrk_put;
        await check('complete_object_upload_mark_remove_by_key',
            () => md_store.complete_object_upload_mark_remove_by_key({
                bucket_id,
                key: put.key,
                put_obj: put,
                set_updates: { size: 20, etag: 'e', create_time: new Date() },
                unset_updates: { upload_started: true },
            }),
            [OBJ]);
    });

    mocha.it('objects - complete_object_upload_latest_mark_remove_current', async function() {
        const unmark = test_ids.ids.cul_unmark;
        const put = test_ids.ids.cul_put;
        await check('complete_object_upload_latest_mark_remove_current',
            () => md_store.complete_object_upload_latest_mark_remove_current({
                unmark_obj: unmark,
                put_obj: put,
                set_updates: { size: 20, etag: 'e2', create_time: new Date() },
                unset_updates: { upload_started: true },
            }),
            [OBJ]);
    });

    mocha.it('objects - complete_object_upload_latest_mark_remove_current_and_delete', async function() {
        const del_obj = test_ids.ids.cul_del1;
        const unmark = test_ids.ids.cul_del2;
        const put = test_ids.ids.cul_put2;
        await check('complete_object_upload_latest_mark_remove_current_and_delete',
            () => md_store.complete_object_upload_latest_mark_remove_current_and_delete({
                delete_obj: del_obj,
                unmark_obj: unmark,
                put_obj: put,
                set_updates: { size: 30, etag: 'e3', create_time: new Date() },
                unset_updates: { upload_started: true },
            }),
            [OBJ]);
    });

    mocha.it('objects - remove_object_move_latest', async function() {
        await check('remove_object_move_latest',
            () => md_store.remove_object_move_latest(test_ids.ids.mv1, test_ids.ids.mv2),
            [OBJ]);
    });

    mocha.it('objects - insert_object_delete_marker_move_latest', async function() {
        const src = test_ids.ids.dm_src;
        await check('insert_object_delete_marker_move_latest',
            () => md_store.insert_object_delete_marker_move_latest(src, true),
            [OBJ]);
    });

    mocha.it('objects - insert_object_delete_marker_move_latest_with_delete', async function() {
        const latest = test_ids.ids.dm_del1;
        const obj = test_ids.ids.dm_del2;
        await check('insert_object_delete_marker_move_latest_with_delete',
            () => md_store.insert_object_delete_marker_move_latest_with_delete(obj, latest),
            [OBJ]);
    });

    mocha.it('objects - delete_object_by_id', async function() {
        await check('delete_object_by_id',
            () => md_store.delete_object_by_id(test_ids.ids.del_id._id),
            [OBJ]);
    });

    mocha.it('objects - find_objects (filtered listing)', async function() {
        await check('find_objects (filtered listing)', () => md_store.find_objects({
            bucket_id,
            key: /^plan-key-/,
            upload_mode: undefined,
            latest_versions: true,
            filter_delete_markers: false,
            max_create_time: Math.floor(Date.now() / 1000) + 86400,
            max_size: 5000,
            min_size: 10,
            tagging: undefined,
            skip: undefined,
            limit: 10,
            sort: undefined,
            order: undefined,
            pagination: undefined,
        }), [OBJ]);
    });

    mocha.it('objects - find_objects (simple listing)', async function() {
        await check('find_objects (simple listing)', () => md_store.find_objects({
            bucket_id,
            key: undefined,
            upload_mode: undefined,
            latest_versions: undefined,
            filter_delete_markers: undefined,
            max_create_time: undefined,
            max_size: undefined,
            min_size: undefined,
            tagging: undefined,
            skip: undefined,
            limit: 10,
            sort: undefined,
            order: undefined,
            pagination: undefined,
        }), [OBJ]);
    });

    mocha.it('objects - find_objects (admin listing)', async function() {
        await check('find_objects (admin listing)', () => md_store.find_objects({
            bucket_id,
            key: /^plan-key-/,
            upload_mode: false,
            latest_versions: true,
            filter_delete_markers: false,
            max_create_time: Math.floor(Date.now() / 1000) + 86400,
            max_size: undefined,
            min_size: undefined,
            tagging: undefined,
            skip: 0,
            limit: 10,
            sort: 'key',
            order: 1,
            pagination: true,
        }), [OBJ]);
    });

    mocha.it('objects - delete_objects_by_query', async function() {
        await check('delete_objects_by_query', () => md_store.delete_objects_by_query({
            bucket_id: bucket_id2,
            key: /^plan-key-/,
            max_create_time: undefined,
            max_size: undefined,
            min_size: undefined,
            tagging: undefined,
            limit: 1,
            return_results: true,
        }), [OBJ]);
    });

    mocha.it('objects - remove_pending_multiparts', async function() {
        await check('remove_pending_multiparts', () => md_store.remove_pending_multiparts({
            bucket_id,
            days_after_initiation: 9999,
            limit: 1,
        }), [OBJ]);
    });

    mocha.it('objects - remove_noncurrent_versions', async function() {
        await check('remove_noncurrent_versions', () => md_store.remove_noncurrent_versions({
            bucket_id,
            noncurrent_days: 9999,
            limit: 1,
        }), [OBJ]);
    });

    mocha.it('objects - delete_orphaned_delete_marker', async function() {
        await check('delete_orphaned_delete_marker', () => md_store.delete_orphaned_delete_marker({
            bucket_id,
            limit: 1,
        }), [OBJ], { allow_miss: true });
    });

    mocha.it('objects - find_unreclaimed_objects', async function() {
        await check('find_unreclaimed_objects', () => md_store.find_unreclaimed_objects(10), [OBJ]);
    });

    mocha.it('objects - list_objects', async function() {
        await check('list_objects', () => md_store.list_objects({
            bucket_id,
            delimiter: '',
            prefix: '',
            key_marker: '',
            limit: 10,
        }), [OBJ]);
    });

    mocha.it('objects - list_object_versions', async function() {
        await check('list_object_versions', () => md_store.list_object_versions({
            bucket_id,
            delimiter: '',
            prefix: '',
            key_marker: '',
            version_seq_marker: undefined,
            limit: 10,
        }), [OBJ]);
    });

    mocha.it('objects - list_uploads', async function() {
        await check('list_uploads', () => md_store.list_uploads({
            bucket_id,
            delimiter: '',
            prefix: '',
            key_marker: '',
            upload_started_marker: undefined,
            limit: 10,
        }), [OBJ]);
    });

    mocha.it('objects - has_any_completed_objects_in_bucket', async function() {
        await check('has_any_completed_objects_in_bucket',
            () => md_store.has_any_completed_objects_in_bucket(bucket_id), [OBJ]);
    });

    mocha.it('objects - count_objects_of_bucket', async function() {
        await check('count_objects_of_bucket',
            () => md_store.count_objects_of_bucket(bucket_id), [OBJ]);
    });

    mocha.it('objects - has_any_latest_objects_for_bucket', async function() {
        await check('has_any_latest_objects_for_bucket',
            () => md_store.has_any_latest_objects_for_bucket(bucket_id, false), [OBJ]);
    });

    mocha.it('objects - has_any_objects_for_bucket', async function() {
        await check('has_any_objects_for_bucket',
            () => md_store.has_any_objects_for_bucket(bucket_id, false), [OBJ]);
    });

    mocha.it('objects - has_any_objects_for_bucket_including_deleted', async function() {
        await check('has_any_objects_for_bucket_including_deleted',
            () => md_store.has_any_objects_for_bucket_including_deleted(bucket_id), [OBJ], { allow_miss: true }); // all bucket indexes are partial (exclude deleted rows)
    });

    mocha.it('objects - has_any_uploads_for_bucket', async function() {
        await check('has_any_uploads_for_bucket',
            () => md_store.has_any_uploads_for_bucket(bucket_id), [OBJ]);
    });

    mocha.it('objects - had_any_objects_in_system', async function() {
        await check('had_any_objects_in_system',
            () => md_store.had_any_objects_in_system(system_id), [OBJ], { allow_miss: true });
    });

    mocha.it('objects - find_deleted_objects', async function() {
        const max_time = Date.now() + 86400000;
        await check('find_deleted_objects',
            () => md_store.find_deleted_objects(max_time, 10), [OBJ]);
    });

    mocha.it('objects - db_delete_objects', async function() {
        await check('db_delete_objects',
            () => md_store.db_delete_objects([test_ids.ids.rm4._id]), [OBJ]);
    });

    mocha.it('objects - find_object_with_mapping_by_key', async function() {
        const obj = test_ids.obj_batch[0];
        await check('find_object_with_mapping_by_key',
            () => md_store.find_object_with_mapping_by_key(String(bucket_id), obj.key, 10),
            [OBJ, PART, CHUNK, BLOCK]);
    });

    // ─────────────────── MULTIPARTS ────────────────────

    mocha.it('multiparts - find_multipart_by_id', async function() {
        await check('find_multipart_by_id',
            () => md_store.find_multipart_by_id(test_ids.mpart._id), [MPART]);
    });

    mocha.it('multiparts - find_all_multiparts_of_object', async function() {
        await check('find_all_multiparts_of_object',
            () => md_store.find_all_multiparts_of_object(test_ids.obj_batch[0]._id), [MPART]);
    });

    mocha.it('multiparts - find_completed_multiparts_of_object', async function() {
        await check('find_completed_multiparts_of_object',
            () => md_store.find_completed_multiparts_of_object(test_ids.obj_batch[0]._id, 0, 10), [MPART]);
    });

    mocha.it('multiparts - update_multipart_by_id', async function() {
        await check('update_multipart_by_id',
            () => md_store.update_multipart_by_id(test_ids.mpart._id, { size: 60 }), [MPART]);
    });

    mocha.it('multiparts - delete_multiparts_of_object', async function() {
        await check('delete_multiparts_of_object',
            () => md_store.delete_multiparts_of_object({ _id: test_ids.obj_batch[0]._id }), [MPART]);
    });

    mocha.it('multiparts - db_delete_multiparts_of_object', async function() {
        await check('db_delete_multiparts_of_object',
            () => md_store.db_delete_multiparts_of_object(test_ids.obj_batch[0]._id), [MPART]);
    });

    // ─────────────────── PARTS ────────────────────

    mocha.it('parts - find_parts_by_start_range', async function() {
        await check('find_parts_by_start_range',
            () => md_store.find_parts_by_start_range({
                obj_id: test_ids.obj_batch[0]._id,
                start_gte: 0,
                start_lt: 1000,
                end_gt: 0,
            }), [PART]);
    });

    mocha.it('parts - find_parts_sorted_by_start', async function() {
        await check('find_parts_sorted_by_start',
            () => md_store.find_parts_sorted_by_start({ obj_id: test_ids.obj_batch[0]._id }), [PART]);
    });

    mocha.it('parts - find_parts_chunk_ids', async function() {
        await check('find_parts_chunk_ids',
            () => md_store.find_parts_chunk_ids(test_ids.obj_batch[0]), [PART]);
    });

    mocha.it('parts - find_parts_by_chunk_ids', async function() {
        await check('find_parts_by_chunk_ids',
            () => md_store.find_parts_by_chunk_ids([test_ids.chunk._id]), [PART]);
    });

    mocha.it('parts - find_all_parts_of_object', async function() {
        await check('find_all_parts_of_object',
            () => md_store.find_all_parts_of_object(test_ids.obj_batch[0]), [PART]);
    });

    mocha.it('parts - find_parts_unreferenced_chunk_ids', async function() {
        await check('find_parts_unreferenced_chunk_ids',
            () => md_store.find_parts_unreferenced_chunk_ids([test_ids.chunk._id]), [PART]);
    });

    mocha.it('parts - find_parts_chunks_references', async function() {
        await check('find_parts_chunks_references',
            () => md_store.find_parts_chunks_references([test_ids.chunk._id]), [PART]);
    });

    mocha.it('parts - delete_parts_of_object', async function() {
        await check('delete_parts_of_object',
            () => md_store.delete_parts_of_object(test_ids.obj_batch[0]), [PART]);
    });

    mocha.it('parts - has_any_parts_for_chunk', async function() {
        await check('has_any_parts_for_chunk',
            () => md_store.has_any_parts_for_chunk(test_ids.chunk._id), [PART]);
    });

    mocha.it('parts - has_any_parts_for_object', async function() {
        await check('has_any_parts_for_object',
            () => md_store.has_any_parts_for_object(test_ids.obj_batch[0]), [PART]);
    });

    mocha.it('parts - db_delete_parts_of_object', async function() {
        await check('db_delete_parts_of_object',
            () => md_store.db_delete_parts_of_object(test_ids.obj_batch[0]._id), [PART]);
    });

    // ─────────────────── CHUNKS ────────────────────

    mocha.it('chunks - find_chunks_by_ids', async function() {
        await check('find_chunks_by_ids',
            () => md_store.find_chunks_by_ids([test_ids.chunk._id]), [CHUNK]);
    });

    mocha.it('chunks - find_chunks_by_dedup_key', async function() {
        const bucket_stub = { _id: bucket_id, system: { _id: system_id } };
        await check('find_chunks_by_dedup_key',
            () => md_store.find_chunks_by_dedup_key(bucket_stub, ['nonexistent']),
            [CHUNK, BLOCK]);
    });

    mocha.it('chunks - iterate_all_chunks_in_buckets', async function() {
        await check('iterate_all_chunks_in_buckets',
            () => md_store.iterate_all_chunks_in_buckets(null, null, [bucket_id], 10), [CHUNK]);
    });

    mocha.it('chunks - iterate_all_chunks', async function() {
        await check('iterate_all_chunks',
            () => md_store.iterate_all_chunks(null, 10), [CHUNK]);
    });

    mocha.it('chunks - find_oldest_tier_chunk_ids (asc)', async function() {
        const tier_id = md_store.make_md_id();
        await check('find_oldest_tier_chunk_ids (asc)',
            () => md_store.find_oldest_tier_chunk_ids({ tier: tier_id, limit: 10, sort_direction: 1 }), [CHUNK]);
    });

    mocha.it('chunks - find_oldest_tier_chunk_ids (with max_tier_lru)', async function() {
        const tier_id = md_store.make_md_id();
        await check('find_oldest_tier_chunk_ids (with max_tier_lru)',
            () => md_store.find_oldest_tier_chunk_ids({
                tier: tier_id,
                limit: 10,
                sort_direction: 1,
                max_tier_lru: new Date(Date.now() - 86400000),
            }), [CHUNK]);
    });

    mocha.it('chunks - find_oldest_tier_chunk_ids (desc/spillback)', async function() {
        const tier_id = md_store.make_md_id();
        await check('find_oldest_tier_chunk_ids (desc/spillback)',
            () => md_store.find_oldest_tier_chunk_ids({ tier: tier_id, limit: 10, sort_direction: -1 }), [CHUNK]);
    });

    mocha.it('chunks - delete_chunks_by_ids', async function() {
        await check('delete_chunks_by_ids',
            () => md_store.delete_chunks_by_ids([test_ids.chunk._id]), [CHUNK]);
    });

    mocha.it('chunks - find_deleted_chunks', async function() {
        await check('find_deleted_chunks',
            () => md_store.find_deleted_chunks(Date.now() + 86400000, 10), [CHUNK]);
    });

    mocha.it('chunks - iterate_indexed_chunks', async function() {
        await check('iterate_indexed_chunks',
            () => md_store.iterate_indexed_chunks(10), [CHUNK], { allow_miss: true });
    });

    mocha.it('chunks - db_delete_chunks', async function() {
        await check('db_delete_chunks',
            () => md_store.db_delete_chunks([test_ids.chunk._id]), [CHUNK]);
    });

    // ─────────────────── BLOCKS ────────────────────

    mocha.it('blocks - find_blocks_of_chunks', async function() {
        await check('find_blocks_of_chunks',
            () => md_store.find_blocks_of_chunks([test_ids.chunk._id]), [BLOCK]);
    });

    mocha.it('blocks - find_parts_chunks_blocks_by_range', async function() {
        await check('find_parts_chunks_blocks_by_range',
            () => md_store.find_parts_chunks_blocks_by_range({
                obj_id: test_ids.obj_batch[0]._id,
                start_gte: 0,
                start_lt: 1000,
                end_gt: 0,
            }), [PART, CHUNK, BLOCK]);
    });

    mocha.it('blocks - load_blocks_for_chunks', async function() {
        const chunks_copy = [{
            _id: test_ids.chunk._id,
            frags: [{ _id: test_ids.frag_id, blocks: [] }],
        }];
        await check('load_blocks_for_chunks',
            () => md_store.load_blocks_for_chunks(chunks_copy), [BLOCK]);
    });

    mocha.it('blocks - iterate_node_chunks', async function() {
        await check('iterate_node_chunks',
            () => md_store.iterate_node_chunks({ node_id: test_ids.node_id, marker: undefined, limit: 10 }), [BLOCK]);
    });

    mocha.it('blocks - find_blocks_chunks_by_node_ids', async function() {
        await check('find_blocks_chunks_by_node_ids',
            () => md_store.find_blocks_chunks_by_node_ids([test_ids.node_id], 0, 10), [BLOCK]);
    });

    mocha.it('blocks - count_blocks_of_nodes', async function() {
        await check('count_blocks_of_nodes',
            () => md_store.count_blocks_of_nodes([test_ids.node_id]), [BLOCK]);
    });

    mocha.it('blocks - has_any_blocks_for_chunk', async function() {
        await check('has_any_blocks_for_chunk',
            () => md_store.has_any_blocks_for_chunk(test_ids.chunk._id), [BLOCK]);
    });

    mocha.it('blocks - delete_blocks_by_ids', async function() {
        await check('delete_blocks_by_ids',
            () => md_store.delete_blocks_by_ids([test_ids.block._id]), [BLOCK]);
    });

    mocha.it('blocks - find_deleted_blocks', async function() {
        await check('find_deleted_blocks',
            () => md_store.find_deleted_blocks(Date.now() + 86400000, 10), [BLOCK]);
    });

    mocha.it('blocks - iterate_all_blocks', async function() {
        await check('iterate_all_blocks',
            () => md_store.iterate_all_blocks(null, 10), [BLOCK]);
    });

    mocha.it('blocks - db_delete_blocks', async function() {
        await check('db_delete_blocks',
            () => md_store.db_delete_blocks([test_ids.block._id]), [BLOCK]);
    });
});
