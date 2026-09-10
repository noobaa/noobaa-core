/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('../../utils/coretest/coretest');
coretest.setup();

const mocha = require('mocha');
const assert = require('assert');
const config = require('../../../../config');
const { MDStore, is_restore_transition_indexes_enabled } = require('../../../server/object_services/md_store');
const object_md_indexes = require('../../../server/object_services/schemas/object_md_indexes');

const DEFAULT_N = 1000000;
const INSERT_BATCH = 1000;
const NEW_OBJECTMD_INDEX_NAMES = new Set(['restore_status_index', 'transition_info_index']);

mocha.describe('objectmds restore/transition index creation time', function() {
    this.timeout(300000); // eslint-disable-line no-invalid-this

    const n = Number(process.env.OBJECTMD_INDEX_CREATE_N) || DEFAULT_N;
    const md_store = new MDStore(`_test_idx_create_${Date.now().toString(36)}`);
    const system_id = md_store.make_md_id();
    const bucket_id = md_store.make_md_id();

    mocha.before(async function() {
        if (config.DB_TYPE !== 'postgres') this.skip(); // eslint-disable-line no-invalid-this
        if (!is_restore_transition_indexes_enabled()) this.skip(); // eslint-disable-line no-invalid-this
        await md_store._objects.init_promise;
    });

    mocha.after(async function() {
        if (config.DB_TYPE !== 'postgres') return;
        await md_store._objects.deleteMany({ bucket: bucket_id });
    });

    mocha.it('CREATE INDEX on a populated objectmds table', async function() {
        const table = md_store._objects.name;
        const restore_idx = `idx_btree_${table}_restore_status_index`;
        const transition_idx = `idx_btree_${table}_transition_info_index`;

        // Indexes are created on an empty table during MDStore init. Drop them so
        // _create_db_index rebuilds them after the table is populated — the upgrade path.
        await md_store._objects.single_query(`DROP INDEX IF EXISTS ${restore_idx}`);
        await md_store._objects.single_query(`DROP INDEX IF EXISTS ${transition_idx}`);

        const insert_started = Date.now();
        for (let start = 0; start < n; start += INSERT_BATCH) {
            const count = Math.min(INSERT_BATCH, n - start);
            await md_store._objects.insertManyUnordered(
                build_object_batch(md_store, system_id, bucket_id, start, count)
            );
        }
        const insert_ms = Date.now() - insert_started;

        const create_started = Date.now();
        await create_restore_transition_indexes(md_store);
        const create_ms = Date.now() - create_started;

        const idx_res = await md_store._objects.single_query(
            `SELECT indexname FROM pg_indexes WHERE tablename = $1 AND indexname IN ($2, $3)`,
            [table, restore_idx, transition_idx]
        );
        assert.strictEqual(idx_res.rows.length, 2,
            `expected ${restore_idx} and ${transition_idx} to exist, got ${idx_res.rows.map(r => r.indexname)}`);

        const rows_per_sec = create_ms > 0 ? Math.round(n / (create_ms / 1000)) : n;
        const extrapolate = million => {
            const ms = create_ms * (million * 1e6 / n);
            return `${(ms / 1000).toFixed(1)}s`;
        };
        console.log(
            `objectmds index creation: n=${n} insert_ms=${insert_ms} create_ms=${create_ms}` +
            ` (~${rows_per_sec} rows/s scanned).` +
            ` linear extrapolation: 1M≈${extrapolate(1)} 10M≈${extrapolate(10)} 50M≈${extrapolate(50)}.` +
            ` Partial indexes still seq-scan every row; treat this as a lower bound.`
        );

        // Sanity bound for the small CI dataset only — not a production SLO.
        assert(create_ms < 60_000, `index creation on ${n} rows took ${create_ms}ms`);
    });
});

/**
 * Completed-upload shaped objectmds rows for CREATE INDEX timing.
 * Chunks/parts live in other tables and do not change objectmds index cost.
 * @param {MDStore} md_store
 * @param {*} system_id
 * @param {*} bucket_id
 * @param {number} start first key index in this batch
 * @param {number} count number of docs to build
 * @returns {object[]}
 */
function build_object_batch(md_store, system_id, bucket_id, start, count) {
    const now = new Date();
    const docs = [];
    for (let i = 0; i < count; i++) {
        const idx = start + i;
        const doc = {
            _id: md_store.make_md_id(),
            system: system_id,
            bucket: bucket_id,
            key: `logs/2026/09/10/idx-create-${idx}.json`,
            content_type: 'application/octet-stream',
            create_time: now,
            size: 4 * 1024 * 1024,
            num_parts: 1,
            version_seq: idx + 1,
            etag: 'd41d8cd98f00b204e9800998ecf8427e',
            md5_b64: '1B2M2Y8AsgTpgAmY7PhCfg==',
            xattr: {
                'user.owner': 'app-service',
                'user.request-id': `req-${idx}`,
            },
            tagging: [
                { key: 'env', value: 'prod' },
                { key: 'team', value: 'storage' },
            ],
            stats: { reads: 0, last_read: now },
        };
        // Mix a few matching rows so the partial indexes are non-empty, matching
        // a cluster that already used restore/transition a little. Most rows do
        // not match — the CREATE INDEX seq-scan still visits every document.
        if (idx % 100 === 0) {
            doc.restore_status = { ongoing: false, expiry_time: now };
        } else if (idx % 100 === 1) {
            doc.transition_info = {
                status: 'DONE',
                source_info: { storage_class: 'STANDARD' },
            };
        }
        docs.push(doc);
    }
    return docs;
}

/**
 * Create restore_status_index and transition_info_index via _create_db_index (upgrade path).
 * @param {MDStore} md_store
 * @returns {Promise<void[]>}
 */
function create_restore_transition_indexes(md_store) {
    const objects = md_store._objects;
    const pool = objects.get_pool();
    const indexes = object_md_indexes.filter(index =>
        NEW_OBJECTMD_INDEX_NAMES.has(index.options && index.options.name));
    return Promise.all(indexes.map(index => objects._create_db_index(index, pool)));
}
