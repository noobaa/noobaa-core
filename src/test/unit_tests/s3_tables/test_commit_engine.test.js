/* Copyright (C) 2026 NooBaa */
'use strict';

const commit_engine = require('../../../sdk/s3_tables/commit_engine');
const lossless_json = require('../../../sdk/s3_tables/lossless_json');
const fixtures = require('./s3_tables_fixtures');

const {
    BIG_SNAPSHOT_ID,
    BIG_SNAPSHOT_ID_NEXT,
    NOW_MS,
    TABLE_LOCATION,
    TABLE_UUID,
    make_ctx,
    expect_error_code,
} = fixtures;

const TWO_POW_53 = '9007199254740992';
const TWO_POW_53_PLUS_1 = '9007199254740993';

// ///////////////////////////////////////////////////////////////////////////////////
// helpers - commits carrying out-of-range ids are built as text, because a JavaScript
// numeric literal would already have rounded the value before the engine saw it
// ///////////////////////////////////////////////////////////////////////////////////

/**
 * @param {string} id
 * @param {{ parent?: string, sequence_number?: number, timestamp_ms?: number, extra?: string }} [opts]
 * @returns {string}
 */
function snapshot_text(id, opts = {}) {
    const parent = opts.parent === undefined ? 'null' : opts.parent;
    const sequence_number = opts.sequence_number === undefined ? 1 : opts.sequence_number;
    const timestamp_ms = opts.timestamp_ms === undefined ? NOW_MS + 1 : opts.timestamp_ms;
    return `{"snapshot-id":${id},"parent-snapshot-id":${parent},` +
        `"sequence-number":${sequence_number},"timestamp-ms":${timestamp_ms},` +
        `"manifest-list":"${TABLE_LOCATION}/metadata/snap-${id}-1-84e1.avro",` +
        `"summary":{"operation":"append"},"schema-id":0${opts.extra || ''}}`;
}

/**
 * The two updates a client's append actually sends: add-snapshot, then set-snapshot-ref.
 * @param {string} id
 * @param {{ ref_expectation?: string, parent?: string, sequence_number?: number,
 *      timestamp_ms?: number, extra?: string }} [opts]
 * @returns {string}
 */
function append_commit_text(id, opts = {}) {
    const expectation = opts.ref_expectation === undefined ? 'null' : opts.ref_expectation;
    return `{"requirements":[{"type":"assert-ref-snapshot-id","ref":"main","snapshot-id":${expectation}}],` +
        `"updates":[{"action":"add-snapshot","snapshot":${snapshot_text(id, opts)}},` +
        `{"action":"set-snapshot-ref","ref-name":"main","type":"branch","snapshot-id":${id}}]}`;
}

/** @returns {any} a freshly parsed empty table, as the worker would see it */
function fresh_metadata() {
    return lossless_json.parse(lossless_json.stringify(fixtures.initial_metadata()));
}

/**
 * @param {any} metadata
 * @param {string} commit_json
 * @param {object} [ctx_overrides]
 * @returns {any} the mutated metadata
 */
function apply_commit(metadata, commit_json, ctx_overrides) {
    const commit = lossless_json.parse(commit_json);
    commit_engine.check_requirements(metadata, commit.requirements);
    return commit_engine.apply_updates(metadata, commit.updates, make_ctx(ctx_overrides));
}

// ///////////////////////////////////////////////////////////////////////////////////

describe('s3_tables commit_engine - check_requirements', () => {

    it('assert-create passes when the table does not exist', () => {
        expect(() => commit_engine.check_requirements(null, [{ type: 'assert-create' }])).not.toThrow();
    });

    it('assert-create fails when the table exists', () => {
        expect_error_code(
            () => commit_engine.check_requirements(fresh_metadata(), [{ type: 'assert-create' }]),
            'RequirementFailed');
    });

    it('assert-create must be the only requirement', () => {
        expect_error_code(() => commit_engine.check_requirements(null, [
            { type: 'assert-create' },
            { type: 'assert-current-schema-id', 'current-schema-id': 0 },
        ]), 'InvalidRequest');
    });

    it('every other requirement fails when the table does not exist', () => {
        expect_error_code(
            () => commit_engine.check_requirements(null, [{ type: 'assert-table-uuid', uuid: TABLE_UUID }]),
            'RequirementFailed');
    });

    it('assert-table-uuid passes on a match and fails otherwise', () => {
        const metadata = fresh_metadata();
        expect(() => commit_engine.check_requirements(metadata, [
            { type: 'assert-table-uuid', uuid: TABLE_UUID },
        ])).not.toThrow();
        expect_error_code(() => commit_engine.check_requirements(metadata, [
            { type: 'assert-table-uuid', uuid: 'a-different-uuid' },
        ]), 'RequirementFailed');
    });

    describe('assert-ref-snapshot-id (§8.1)', () => {

        it('a null snapshot-id means the ref must NOT exist - a first append passes', () => {
            expect(() => commit_engine.check_requirements(fresh_metadata(), [
                { type: 'assert-ref-snapshot-id', ref: 'main', 'snapshot-id': null },
            ])).not.toThrow();
        });

        it('the omitted-key form behaves identically', () => {
            expect(() => commit_engine.check_requirements(fresh_metadata(), [
                { type: 'assert-ref-snapshot-id', ref: 'main' },
            ])).not.toThrow();
        });

        it('a null snapshot-id fails once the ref exists', () => {
            const metadata = apply_commit(fresh_metadata(), append_commit_text(BIG_SNAPSHOT_ID));
            expect_error_code(() => commit_engine.check_requirements(metadata, [
                { type: 'assert-ref-snapshot-id', ref: 'main', 'snapshot-id': null },
            ]), 'RequirementFailed');
            expect_error_code(() => commit_engine.check_requirements(metadata, [
                { type: 'assert-ref-snapshot-id', ref: 'main' },
            ]), 'RequirementFailed');
        });

        it('fails when the ref does not exist but one was expected', () => {
            expect_error_code(() => commit_engine.check_requirements(fresh_metadata(), [
                { type: 'assert-ref-snapshot-id', ref: 'main', 'snapshot-id': 7 },
            ]), 'RequirementFailed');
        });

        it('matches an out-of-range ref target by its exact source text', () => {
            const metadata = apply_commit(fresh_metadata(), append_commit_text(BIG_SNAPSHOT_ID));
            const requirement = lossless_json.parse(
                `[{"type":"assert-ref-snapshot-id","ref":"main","snapshot-id":${BIG_SNAPSHOT_ID}}]`);
            expect(() => commit_engine.check_requirements(metadata, requirement)).not.toThrow();
        });

        it('fails on an id that only *rounds* to the stored one - a numeric compare would pass', () => {
            const metadata = apply_commit(fresh_metadata(), append_commit_text(BIG_SNAPSHOT_ID));
            const requirement = lossless_json.parse(
                `[{"type":"assert-ref-snapshot-id","ref":"main","snapshot-id":${BIG_SNAPSHOT_ID_NEXT}}]`);
            expect(Number(BIG_SNAPSHOT_ID)).toBe(Number(BIG_SNAPSHOT_ID_NEXT));
            expect_error_code(() => commit_engine.check_requirements(metadata, requirement), 'RequirementFailed');
        });

        it('requires a ref name', () => {
            expect_error_code(() => commit_engine.check_requirements(fresh_metadata(), [
                { type: 'assert-ref-snapshot-id', 'snapshot-id': null },
            ]), 'InvalidRequest');
        });

    });

    describe('the scalar assertions', () => {

        it.each([
            ['assert-last-assigned-field-id', 'last-assigned-field-id', 2],
            ['assert-current-schema-id', 'current-schema-id', 0],
            ['assert-last-assigned-partition-id', 'last-assigned-partition-id', 999],
            ['assert-default-spec-id', 'default-spec-id', 0],
            ['assert-default-sort-order-id', 'default-sort-order-id', 0],
        ])('%s passes on the current value and fails otherwise', (type, field, value) => {
            const metadata = fresh_metadata();
            expect(() => commit_engine.check_requirements(metadata, [{ type, [field]: value }])).not.toThrow();
            expect_error_code(
                () => commit_engine.check_requirements(metadata, [{ type, [field]: value + 1 }]),
                'RequirementFailed');
        });

    });

    describe('the allow-list', () => {

        it('rejects a well-formed unknown type as UnsupportedOperation, never silently', () => {
            expect_error_code(
                () => commit_engine.check_requirements(fresh_metadata(), [{ type: 'assert-next-row-id' }]),
                'UnsupportedOperation');
        });

        it('rejects a missing or non-string discriminator as InvalidRequest', () => {
            expect_error_code(() => commit_engine.check_requirements(fresh_metadata(), [{}]), 'InvalidRequest');
            expect_error_code(() => commit_engine.check_requirements(fresh_metadata(), [{ type: 7 }]),
                'InvalidRequest');
            expect_error_code(() => commit_engine.check_requirements(fresh_metadata(), ['assert-create']),
                'InvalidRequest');
        });

        it('accepts absent requirements and rejects a non-array', () => {
            expect(() => commit_engine.check_requirements(fresh_metadata(), undefined)).not.toThrow();
            expect_error_code(() => commit_engine.check_requirements(fresh_metadata(), {}), 'InvalidRequest');
        });

    });

});

describe('s3_tables commit_engine - snapshots and refs (§8.1)', () => {

    it('add-snapshot does not move main', () => {
        const metadata = fresh_metadata();
        const before_refs = JSON.stringify(metadata.refs);
        apply_commit(metadata,
            `{"updates":[{"action":"add-snapshot","snapshot":${snapshot_text(BIG_SNAPSHOT_ID)}}]}`);
        expect(metadata.snapshots).toHaveLength(1);
        expect(metadata['last-sequence-number']).toBe(1);
        expect(metadata['current-snapshot-id']).toBe(-1);
        expect(JSON.stringify(metadata.refs)).toBe(before_refs);
        expect(metadata['snapshot-log']).toEqual([]);
    });

    it('set-snapshot-ref on main moves the pointer and appends exactly one log entry', () => {
        const metadata = apply_commit(fresh_metadata(), append_commit_text(BIG_SNAPSHOT_ID));
        expect(lossless_json.id_text(metadata['current-snapshot-id'])).toBe(BIG_SNAPSHOT_ID);
        expect(lossless_json.id_text(metadata.refs.main['snapshot-id'])).toBe(BIG_SNAPSHOT_ID);
        expect(metadata.refs.main.type).toBe('branch');
        expect(metadata['snapshot-log']).toHaveLength(1);
        expect(metadata['snapshot-log'][0]['timestamp-ms']).toBe(NOW_MS + 1);
        expect(lossless_json.id_text(metadata['snapshot-log'][0]['snapshot-id'])).toBe(BIG_SNAPSHOT_ID);
    });

    it('a non-main ref touches neither the current pointer nor the snapshot log', () => {
        const metadata = apply_commit(fresh_metadata(),
            `{"updates":[{"action":"add-snapshot","snapshot":${snapshot_text(BIG_SNAPSHOT_ID)}},` +
            `{"action":"set-snapshot-ref","ref-name":"v1","type":"tag","snapshot-id":${BIG_SNAPSHOT_ID}}]}`);
        expect(metadata['current-snapshot-id']).toBe(-1);
        expect(metadata['snapshot-log']).toEqual([]);
        expect(metadata.refs.v1.type).toBe('tag');
    });

    it('rejects a duplicate snapshot id, compared as exact text', () => {
        const metadata = apply_commit(fresh_metadata(), append_commit_text(BIG_SNAPSHOT_ID));
        expect_error_code(() => apply_commit(metadata,
            `{"updates":[{"action":"add-snapshot","snapshot":${snapshot_text(BIG_SNAPSHOT_ID, {
                sequence_number: 2,
            })}}]}`), 'InvalidRequest');
    });

    it('accepts an id that only rounds to an existing one', () => {
        const metadata = apply_commit(fresh_metadata(), append_commit_text(BIG_SNAPSHOT_ID));
        apply_commit(metadata,
            `{"updates":[{"action":"add-snapshot","snapshot":${snapshot_text(BIG_SNAPSHOT_ID_NEXT, {
                sequence_number: 2,
            })}}]}`);
        expect(metadata.snapshots).toHaveLength(2);
    });

    it('refuses a ref pointing at a snapshot the table does not have', () => {
        expect_error_code(() => apply_commit(fresh_metadata(),
            `{"updates":[{"action":"set-snapshot-ref","ref-name":"main","snapshot-id":${BIG_SNAPSHOT_ID}}]}`),
            'InvalidRequest');
    });

    it('remove-snapshot-ref on main resets the current pointer to -1', () => {
        const metadata = apply_commit(fresh_metadata(), append_commit_text(BIG_SNAPSHOT_ID));
        apply_commit(metadata, '{"updates":[{"action":"remove-snapshot-ref","ref-name":"main"}]}');
        expect(metadata.refs.main).toBeUndefined();
        expect(metadata['current-snapshot-id']).toBe(-1);
    });

    describe('remove-snapshots - engine-driven expiry from day one', () => {

        /** two appends, so there is history to expire */
        function two_snapshot_table() {
            const metadata = apply_commit(fresh_metadata(), append_commit_text(BIG_SNAPSHOT_ID));
            return apply_commit(metadata, append_commit_text('700000000000000001', {
                ref_expectation: BIG_SNAPSHOT_ID,
                parent: BIG_SNAPSHOT_ID,
                sequence_number: 2,
                timestamp_ms: NOW_MS + 2,
            }));
        }

        it('drops the snapshot and prunes its snapshot-log entry, leaving main alone', () => {
            const metadata = two_snapshot_table();
            apply_commit(metadata,
                `{"updates":[{"action":"remove-snapshots","snapshot-ids":[${BIG_SNAPSHOT_ID}]}]}`);
            expect(metadata.snapshots.map(s => lossless_json.id_text(s['snapshot-id'])))
                .toEqual(['700000000000000001']);
            expect(metadata['snapshot-log'].map(e => lossless_json.id_text(e['snapshot-id'])))
                .toEqual(['700000000000000001']);
            expect(lossless_json.id_text(metadata['current-snapshot-id'])).toBe('700000000000000001');
            expect(lossless_json.id_text(metadata.refs.main['snapshot-id'])).toBe('700000000000000001');
        });

        it('drops a ref whose target went, and resets current-snapshot-id to -1 when main goes', () => {
            const metadata = two_snapshot_table();
            apply_commit(metadata,
                `{"updates":[{"action":"remove-snapshots","snapshot-ids":[700000000000000001]}]}`);
            expect(metadata.refs.main).toBeUndefined();
            expect(metadata['current-snapshot-id']).toBe(-1);
            // the removed entry clears the history before it, as the reference does
            expect(metadata['snapshot-log']).toEqual([]);
        });

    });

});

describe('s3_tables commit_engine - safe integers (§8.1, [test 10])', () => {

    it('accepts a sequence-number of 2^53 - 1', () => {
        const metadata = fresh_metadata();
        apply_commit(metadata, `{"updates":[{"action":"add-snapshot","snapshot":${snapshot_text(
            BIG_SNAPSHOT_ID, { sequence_number: Number.MAX_SAFE_INTEGER })}}]}`);
        expect(metadata['last-sequence-number']).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('rejects a sequence-number of exactly 2^53 - the boundary case', () => {
        expect_error_code(() => apply_commit(fresh_metadata(),
            `{"updates":[{"action":"add-snapshot","snapshot":{"snapshot-id":${BIG_SNAPSHOT_ID},` +
            `"sequence-number":${TWO_POW_53},"timestamp-ms":1}}]}`), 'InvalidRequest');
    });

    it('rejects a sequence-number of 2^53 + 1', () => {
        expect_error_code(() => apply_commit(fresh_metadata(),
            `{"updates":[{"action":"add-snapshot","snapshot":{"snapshot-id":${BIG_SNAPSHOT_ID},` +
            `"sequence-number":${TWO_POW_53_PLUS_1},"timestamp-ms":1}}]}`), 'InvalidRequest');
    });

    it('refuses a commit when the *stored* last-sequence-number is out of range', () => {
        // the engine would otherwise compute on a value that has already rounded
        const metadata = lossless_json.parse(lossless_json.stringify(fixtures.initial_metadata())
            .replace('"last-sequence-number":0', `"last-sequence-number":${TWO_POW_53_PLUS_1}`));
        expect_error_code(() => apply_commit(metadata,
            `{"updates":[{"action":"add-snapshot","snapshot":${snapshot_text(BIG_SNAPSHOT_ID)}}]}`),
            'InvalidRequest');
    });

});

describe('s3_tables commit_engine - schemas, specs, sort orders and properties', () => {

    it('add-schema raises last-column-id and set-current-schema -1 picks the one just added', () => {
        const metadata = fresh_metadata();
        apply_commit(metadata, JSON.stringify({
            updates: [
                { action: 'add-schema', schema: { ...fixtures.nested_schema(), 'schema-id': 1 } },
                { action: 'set-current-schema', 'schema-id': -1 },
            ],
        }));
        expect(metadata['last-column-id']).toBe(9);
        expect(metadata['current-schema-id']).toBe(1);
        expect(metadata.schemas).toHaveLength(2);
    });

    it('add-schema never lowers last-column-id', () => {
        const metadata = fresh_metadata();
        metadata['last-column-id'] = 42;
        apply_commit(metadata, JSON.stringify({
            updates: [{ action: 'add-schema', schema: { ...fixtures.simple_schema(), 'schema-id': 1 } }],
        }));
        expect(metadata['last-column-id']).toBe(42);
    });

    it('set-current-schema refuses an unknown schema', () => {
        expect_error_code(() => apply_commit(fresh_metadata(), JSON.stringify({
            updates: [{ action: 'set-current-schema', 'schema-id': 7 }],
        })), 'InvalidRequest');
    });

    it('add-spec raises last-partition-id and set-default-spec -1 picks the one just added', () => {
        const metadata = fresh_metadata();
        apply_commit(metadata, JSON.stringify({
            updates: [
                { action: 'add-spec', spec: { ...fixtures.partition_spec_one_field(), 'spec-id': 1 } },
                { action: 'set-default-spec', 'spec-id': -1 },
            ],
        }));
        expect(metadata['last-partition-id']).toBe(1000);
        expect(metadata['default-spec-id']).toBe(1);
    });

    it('add-sort-order assigns id 1 on the first real order', () => {
        const metadata = fresh_metadata();
        const sort_order = fixtures.sort_order_one_field();
        delete sort_order['order-id'];
        apply_commit(metadata, JSON.stringify({
            updates: [
                { action: 'add-sort-order', 'sort-order': sort_order },
                { action: 'set-default-sort-order', 'sort-order-id': -1 },
            ],
        }));
        expect(metadata['default-sort-order-id']).toBe(1);
    });

    it('remove-schemas refuses the current schema and removes any other', () => {
        const metadata = fresh_metadata();
        apply_commit(metadata, JSON.stringify({
            updates: [{ action: 'add-schema', schema: fixtures.nested_schema() }],
        }));
        expect(metadata.schemas.map(s => s['schema-id'])).toEqual([0, 1]);
        expect_error_code(() => apply_commit(metadata, JSON.stringify({
            updates: [{ action: 'remove-schemas', 'schema-ids': [0] }],
        })), 'InvalidRequest');
        apply_commit(metadata, JSON.stringify({ updates: [{ action: 'remove-schemas', 'schema-ids': [1] }] }));
        expect(metadata.schemas.map(s => s['schema-id'])).toEqual([0]);
    });

    it('remove-partition-specs refuses the default spec', () => {
        expect_error_code(() => apply_commit(fresh_metadata(), JSON.stringify({
            updates: [{ action: 'remove-partition-specs', 'spec-ids': [0] }],
        })), 'InvalidRequest');
    });

    it('set-properties and remove-properties edit the property map', () => {
        const metadata = fresh_metadata();
        apply_commit(metadata, JSON.stringify({
            updates: [{ action: 'set-properties', updates: { owner: 'danny', format: 'parquet' } }],
        }));
        expect(metadata.properties).toEqual({ owner: 'danny', format: 'parquet' });
        apply_commit(metadata, JSON.stringify({
            updates: [{ action: 'remove-properties', removals: ['format'] }],
        }));
        expect(metadata.properties).toEqual({ owner: 'danny' });
    });

    it('set-properties refuses a write path outside the table location ([test 13])', () => {
        expect_error_code(() => apply_commit(fresh_metadata(), JSON.stringify({
            updates: [{ action: 'set-properties', updates: { 'write.data.path': 's3://elsewhere/data/' } }],
        })), 'InvalidRequest');
    });

    it('set-properties accepts a write path inside the table location', () => {
        const metadata = fresh_metadata();
        apply_commit(metadata, JSON.stringify({
            updates: [{
                action: 'set-properties',
                updates: { 'write.data.path': `${TABLE_LOCATION}/data/` },
            }],
        }));
        expect(metadata.properties['write.data.path']).toBe(`${TABLE_LOCATION}/data/`);
    });

    it('assign-uuid sets the uuid once and refuses to reassign it', () => {
        const metadata = fresh_metadata();
        apply_commit(metadata, JSON.stringify({ updates: [{ action: 'assign-uuid', uuid: TABLE_UUID }] }));
        expect(metadata['table-uuid']).toBe(TABLE_UUID);
        expect_error_code(() => apply_commit(metadata, JSON.stringify({
            updates: [{ action: 'assign-uuid', uuid: 'another-uuid' }],
        })), 'InvalidRequest');
    });

    it('stamps last-updated-ms exactly once, from the context clock', () => {
        const metadata = fresh_metadata();
        apply_commit(metadata, JSON.stringify({
            updates: [{ action: 'set-properties', updates: { a: '1' } }],
        }), { now_ms: 1800000000000 });
        expect(metadata['last-updated-ms']).toBe(1800000000000);
    });

});

describe('s3_tables commit_engine - ids follow the reference, never the client', () => {

    it('add-schema never replaces an existing schema that has the client id', () => {
        const metadata = fresh_metadata();
        apply_commit(metadata, JSON.stringify({
            updates: [{ action: 'add-schema', schema: { ...fixtures.nested_schema(), 'schema-id': 0 } }],
        }));
        expect(metadata.schemas.map(s => s['schema-id'])).toEqual([0, 1]);
        expect(metadata.schemas[0].fields).toEqual(fixtures.simple_schema().fields);
    });

    it('add-schema reuses an identical schema, whatever id or key order the client sent', () => {
        const metadata = fresh_metadata();
        /** @type {any} */
        const same = fixtures.simple_schema();
        same['schema-id'] = 5;
        same.fields = same.fields.map(field => Object.fromEntries(Object.entries(field).reverse()));
        apply_commit(metadata, JSON.stringify({ updates: [{ action: 'add-schema', schema: same }] }));
        expect(metadata.schemas).toHaveLength(1);
    });

    it('set-current-schema -1 after re-adding a schema this commit did not add is refused', () => {
        expect_error_code(() => apply_commit(fresh_metadata(), JSON.stringify({
            updates: [
                { action: 'add-schema', schema: fixtures.simple_schema() },
                { action: 'set-current-schema', 'schema-id': -1 },
            ],
        })), 'InvalidRequest');
    });

    it('add-spec never replaces an existing spec, and reuses a compatible one', () => {
        const metadata = fresh_metadata();
        apply_commit(metadata, JSON.stringify({
            updates: [{ action: 'add-spec', spec: fixtures.partition_spec_one_field() }],
        }));
        expect(metadata['partition-specs'].map(s => s['spec-id'])).toEqual([0, 1]);
        expect(metadata['partition-specs'][0].fields).toEqual([]);
        const compatible = fixtures.partition_spec_one_field();
        compatible.fields[0]['field-id'] = 1005;
        apply_commit(metadata, JSON.stringify({ updates: [{ action: 'add-spec', spec: compatible }] }));
        expect(metadata['partition-specs']).toHaveLength(2);
    });

    it('add-spec assigns missing partition field ids above last-partition-id', () => {
        const metadata = fresh_metadata();
        apply_commit(metadata, JSON.stringify({
            updates: [{ action: 'add-spec', spec: fixtures.partition_spec_one_field() }],
        }));
        apply_commit(metadata, JSON.stringify({
            updates: [{
                action: 'add-spec',
                spec: { fields: [
                    { name: 'id_bucket', transform: 'bucket[16]', 'source-id': 1 },
                    { name: 'data', transform: 'identity', 'source-id': 2 },
                ] },
            }],
        }));
        expect(metadata['partition-specs'][2].fields.map(f => f['field-id'])).toEqual([1001, 1002]);
        expect(metadata['last-partition-id']).toBe(1002);
    });

    it('add-sort-order gives the unsorted order id 0 and reuses an equal real order', () => {
        const metadata = fresh_metadata();
        apply_commit(metadata, JSON.stringify({
            updates: [
                { action: 'add-sort-order', 'sort-order': { 'order-id': 3, fields: [] } },
                { action: 'add-sort-order', 'sort-order': { ...fixtures.sort_order_one_field(), 'order-id': 0 } },
                { action: 'add-sort-order', 'sort-order': { ...fixtures.sort_order_one_field(), 'order-id': 9 } },
            ],
        }));
        expect(metadata['sort-orders'].map(o => o['order-id'])).toEqual([0, 1]);
        expect(metadata['sort-orders'][0].fields).toEqual([]);
    });

});

describe('s3_tables commit_engine - snapshot rules of the reference', () => {

    it('rejects a stale sequence-number on a snapshot with a parent as CommitConflict', () => {
        const metadata = apply_commit(fresh_metadata(), append_commit_text(BIG_SNAPSHOT_ID, { sequence_number: 5 }));
        expect_error_code(() => apply_commit(metadata, append_commit_text('700000000000000001', {
            ref_expectation: BIG_SNAPSHOT_ID,
            parent: BIG_SNAPSHOT_ID,
            sequence_number: 5,
        })), 'CommitConflict');
    });

    it('accepts a lower sequence-number on a snapshot with no parent, never lowering the last one', () => {
        const metadata = apply_commit(fresh_metadata(), append_commit_text(BIG_SNAPSHOT_ID, { sequence_number: 5 }));
        apply_commit(metadata,
            `{"updates":[{"action":"add-snapshot","snapshot":${snapshot_text('700000000000000001', {
                sequence_number: 3,
            })}}]}`);
        expect(metadata['last-sequence-number']).toBe(5);
    });

    it('rejects a snapshot without a timestamp-ms', () => {
        expect_error_code(() => apply_commit(fresh_metadata(),
            `{"updates":[{"action":"add-snapshot","snapshot":{"snapshot-id":${BIG_SNAPSHOT_ID},` +
            `"sequence-number":1}}]}`), 'InvalidRequest');
    });

    it('logs a rollback at the commit time, so the snapshot log stays in order', () => {
        const metadata = apply_commit(fresh_metadata(), append_commit_text(BIG_SNAPSHOT_ID));
        apply_commit(metadata, append_commit_text('700000000000000001', {
            ref_expectation: BIG_SNAPSHOT_ID,
            parent: BIG_SNAPSHOT_ID,
            sequence_number: 2,
            timestamp_ms: NOW_MS + 600000,
        }));
        apply_commit(metadata,
            `{"updates":[{"action":"set-snapshot-ref","ref-name":"main","type":"branch","snapshot-id":${BIG_SNAPSHOT_ID}}]}`,
            { now_ms: NOW_MS + 700000 });
        expect(metadata['snapshot-log'].map(e => e['timestamp-ms'])).toEqual([NOW_MS + 1, NOW_MS + 600000, NOW_MS + 700000]);
        expect(lossless_json.id_text(metadata['current-snapshot-id'])).toBe(BIG_SNAPSHOT_ID);
    });

    it('drops the log entry of an intermediate snapshot main moved past in the same commit', () => {
        const metadata = fresh_metadata();
        apply_commit(metadata,
            `{"updates":[{"action":"add-snapshot","snapshot":${snapshot_text(BIG_SNAPSHOT_ID)}},` +
            `{"action":"set-snapshot-ref","ref-name":"main","type":"branch","snapshot-id":${BIG_SNAPSHOT_ID}},` +
            `{"action":"add-snapshot","snapshot":${snapshot_text('700000000000000001', {
                parent: BIG_SNAPSHOT_ID, sequence_number: 2, timestamp_ms: NOW_MS + 2 })}},` +
            `{"action":"set-snapshot-ref","ref-name":"main","type":"branch","snapshot-id":700000000000000001}]}`);
        expect(metadata['snapshot-log'].map(e => lossless_json.id_text(e['snapshot-id'])))
            .toEqual(['700000000000000001']);
    });

    it('an identical set-snapshot-ref is a no-op', () => {
        const metadata = apply_commit(fresh_metadata(), append_commit_text(BIG_SNAPSHOT_ID));
        apply_commit(metadata,
            `{"updates":[{"action":"set-snapshot-ref","ref-name":"main","type":"branch","snapshot-id":${BIG_SNAPSHOT_ID}}]}`);
        expect(metadata['snapshot-log']).toHaveLength(1);
    });

    it('refuses main as a tag, and a ref type that is neither branch nor tag', () => {
        const add = `{"action":"add-snapshot","snapshot":${snapshot_text(BIG_SNAPSHOT_ID)}}`;
        expect_error_code(() => apply_commit(fresh_metadata(), `{"updates":[${add},` +
            `{"action":"set-snapshot-ref","ref-name":"main","type":"tag","snapshot-id":${BIG_SNAPSHOT_ID}}]}`),
            'InvalidRequest');
        expect_error_code(() => apply_commit(fresh_metadata(), `{"updates":[${add},` +
            `{"action":"set-snapshot-ref","ref-name":"v1","type":"label","snapshot-id":${BIG_SNAPSHOT_ID}}]}`),
            'InvalidRequest');
    });

    it('remove-snapshots drops the statistics of removed snapshots and the history before them', () => {
        const metadata = fresh_metadata();
        const ids = ['700000000000000001', '700000000000000002', '700000000000000003'];
        let parent;
        ids.forEach((id, i) => {
            apply_commit(metadata, append_commit_text(id, {
                ref_expectation: parent, parent, sequence_number: i + 1, timestamp_ms: NOW_MS + i + 1 }));
            parent = id;
        });
        const stats = id => ({ 'snapshot-id': id, 'statistics-path': `${TABLE_LOCATION}/metadata/${id}.stats`,
            'file-size-in-bytes': 1, 'file-footer-size-in-bytes': 1, 'blob-metadata': [] });
        apply_commit(metadata, `{"updates":[` +
            `{"action":"set-statistics","statistics":${JSON.stringify(stats(2))}},` +
            `{"action":"set-statistics","statistics":${JSON.stringify(stats(3))}},` +
            `{"action":"set-partition-statistics","partition-statistics":` +
            `{"snapshot-id":${ids[1]},"statistics-path":"p","file-size-in-bytes":1}}]}`);
        apply_commit(metadata, `{"updates":[{"action":"remove-snapshots","snapshot-ids":[${ids[1]}, 2]}]}`);
        expect(metadata.statistics.map(s => s['snapshot-id'])).toEqual([3]);
        expect(metadata['partition-statistics']).toEqual([]);
        // s1 stays a snapshot, but the log cannot claim it was current up to s3
        expect(metadata['snapshot-log'].map(e => lossless_json.id_text(e['snapshot-id']))).toEqual([ids[2]]);
    });

});

describe('s3_tables commit_engine - set-location (§6.4 rule 3)', () => {

    it('is a no-op when it names the assigned location, with or without a trailing slash', () => {
        for (const location of [TABLE_LOCATION, `${TABLE_LOCATION}/`]) {
            const metadata = fresh_metadata();
            apply_commit(metadata, JSON.stringify({ updates: [{ action: 'set-location', location }] }));
            expect(metadata.location).toBe(TABLE_LOCATION);
        }
    });

    it('rejects any other value, including another table under the same bucket', () => {
        for (const location of [
            `s3://${fixtures.BACKING_BUCKET}/6812a1b2c3d4e5f607182931`,
            `${TABLE_LOCATION}/data`,
            's3://elsewhere/t',
            undefined,
        ]) {
            expect_error_code(() => apply_commit(fresh_metadata(), JSON.stringify({
                updates: [{ action: 'set-location', location }],
            })), 'InvalidRequest');
        }
    });

    it('compares against the location the SDK assigned, not the document own location', () => {
        // a document whose location was already tampered with cannot bless itself
        const metadata = fresh_metadata();
        metadata.location = 's3://elsewhere/t';
        expect_error_code(() => apply_commit(metadata, JSON.stringify({
            updates: [{ action: 'set-location', location: 's3://elsewhere/t' }],
        })), 'InvalidRequest');
    });

});

describe('s3_tables commit_engine - the format-version cap (§8.2)', () => {

    it('rejects an upgrade above the cap of 2', () => {
        expect_error_code(() => apply_commit(fresh_metadata(), JSON.stringify({
            updates: [{ action: 'upgrade-format-version', 'format-version': 3 }],
        }), { max_format_version: 2 }), 'InvalidRequest');
    });

    it('treats an upgrade to the current version as a no-op', () => {
        const metadata = fresh_metadata();
        apply_commit(metadata, JSON.stringify({
            updates: [{ action: 'upgrade-format-version', 'format-version': 2 }],
        }), { max_format_version: 2 });
        expect(metadata['format-version']).toBe(2);
    });

    it('rejects a downgrade', () => {
        const metadata = fresh_metadata();
        metadata['format-version'] = 3;
        expect_error_code(() => apply_commit(metadata, JSON.stringify({
            updates: [{ action: 'upgrade-format-version', 'format-version': 2 }],
        }), { max_format_version: 3 }), 'InvalidRequest');
    });

    it('lets a table already above the cap keep committing', () => {
        // lowering the cap must stop new v3 tables without blocking existing ones
        const metadata = fresh_metadata();
        metadata['format-version'] = 3;
        apply_commit(metadata, JSON.stringify({
            updates: [{ action: 'set-properties', updates: { a: '1' } }],
        }), { max_format_version: 2 });
        expect(metadata['format-version']).toBe(3);
    });

    it('allows the rise once the cap is raised', () => {
        const metadata = fresh_metadata();
        apply_commit(metadata, JSON.stringify({
            updates: [{ action: 'upgrade-format-version', 'format-version': 3 }],
        }), { max_format_version: 3 });
        expect(metadata['format-version']).toBe(3);
    });

});

describe('s3_tables commit_engine - the update allow-list (§7.2)', () => {

    it('rejects a well-formed unknown action as UnsupportedOperation - 400, never ignored, never 501', () => {
        expect_error_code(() => apply_commit(fresh_metadata(), JSON.stringify({
            updates: [{ action: 'set-row-lineage' }],
        })), 'UnsupportedOperation');
    });

    it.each(['add-encryption-key', 'remove-encryption-key'])(
        'rejects %s by name, with an actionable message', action => {
            let caught;
            try {
                apply_commit(fresh_metadata(), JSON.stringify({ updates: [{ action }] }));
            } catch (err) {
                caught = err;
            }
            expect(caught.code).toBe('UnsupportedOperation');
            expect(caught.message).toContain('encryption keys are not supported');
        });

    it('rejects a missing or non-string action as InvalidRequest', () => {
        expect_error_code(() => apply_commit(fresh_metadata(), '{"updates":[{}]}'), 'InvalidRequest');
        expect_error_code(() => apply_commit(fresh_metadata(), '{"updates":[{"action":7}]}'), 'InvalidRequest');
        expect_error_code(() => apply_commit(fresh_metadata(), '{"updates":["assign-uuid"]}'), 'InvalidRequest');
    });

    it('rejects a non-array updates list, and updates against a table that does not exist', () => {
        expect_error_code(() => commit_engine.apply_updates(fresh_metadata(), {}, make_ctx()), 'InvalidRequest');
        expect_error_code(() => commit_engine.apply_updates(null, [], make_ctx()), 'InvalidRequest');
    });

});

describe('s3_tables commit_engine - transform (bytes to bytes)', () => {

    /**
     * @param {any} metadata
     * @param {string} commit_json
     * @param {object} [ctx_overrides]
     */
    function run(metadata, commit_json, ctx_overrides) {
        return commit_engine.transform({
            metadata_bytes: Buffer.from(lossless_json.stringify(metadata), 'utf8'),
            commit_bytes: Buffer.from(commit_json, 'utf8'),
            ctx: make_ctx({ previous_metadata_location: fixtures.metadata_file_location(0), ...ctx_overrides }),
        });
    }

    it('[test 10] keeps an out-of-range snapshot id byte-identical through the whole path', () => {
        const { next_bytes } = run(fixtures.initial_metadata(), append_commit_text(BIG_SNAPSHOT_ID, {
            parent: '700000000000000001',
        }));
        const text = next_bytes.toString('utf8');
        // asserted on the serialized text, not on a parsed Number
        expect(text).toContain(`"snapshot-id":${BIG_SNAPSHOT_ID}`);
        expect(text).toContain(`"parent-snapshot-id":700000000000000001`);
        expect(text).toContain(`"current-snapshot-id":${BIG_SNAPSHOT_ID}`);
        expect(text).toContain(`{"timestamp-ms":${NOW_MS + 1},"snapshot-id":${BIG_SNAPSHOT_ID}}`);
        expect(text).not.toContain('8103159149723680000');
    });

    it('preserves a field the engine does not know, at the top level and inside a snapshot', () => {
        const metadata = fixtures.initial_metadata();
        metadata['some-future-field'] = { kept: true };
        const { next_bytes } = run(metadata, append_commit_text(BIG_SNAPSHOT_ID, {
            extra: ',"some-future-field":"kept-too"',
        }));
        const next = lossless_json.parse(next_bytes.toString('utf8'));
        expect(next['some-future-field']).toEqual({ kept: true });
        expect(next.snapshots[0]['some-future-field']).toBe('kept-too');
    });

    it('returns the header the caller needs, without the caller re-parsing', () => {
        const { header } = run(fixtures.initial_metadata(), append_commit_text(BIG_SNAPSHOT_ID));
        expect(header).toEqual({ version: 1, location: TABLE_LOCATION, table_uuid: TABLE_UUID });
    });

    it('appends the previous document to the metadata log, with the previous timestamp', () => {
        const metadata = fixtures.initial_metadata();
        const { next_bytes } = run(metadata, append_commit_text(BIG_SNAPSHOT_ID));
        const next = lossless_json.parse(next_bytes.toString('utf8'));
        expect(next['metadata-log']).toEqual([{
            'timestamp-ms': NOW_MS,
            'metadata-file': fixtures.metadata_file_location(0),
        }]);
        expect(next['last-updated-ms']).toBe(NOW_MS);
    });

    it('rejects an input document over the cap before parsing it', () => {
        expect_error_code(() => run(fixtures.initial_metadata(), append_commit_text(BIG_SNAPSHOT_ID), {
            max_document_bytes: 10,
        }), 'InvalidRequest');
    });

    it('numbers the next file from the previous file name, not the trimmed log length', () => {
        const metadata = fixtures.initial_metadata({
            properties: { 'write.metadata.previous-versions-max': '1' },
        });
        const { header } = run(metadata, '{"updates":[]}', {
            previous_metadata_location: `${TABLE_LOCATION}/metadata/00041-e3f0a1b2.metadata.json`,
        });
        expect(header.version).toBe(42);
    });

    it('requires the previous metadata location - without it the log would silently stop', () => {
        expect(() => run(fixtures.initial_metadata(), '{"updates":[]}', { previous_metadata_location: undefined }))
            .toThrow(TypeError);
    });

    it('refuses a snapshot timestamped more than a minute after the commit - Java could not load it', () => {
        expect_error_code(() => run(fixtures.initial_metadata(), append_commit_text(BIG_SNAPSHOT_ID, {
            timestamp_ms: NOW_MS + 61000,
        })), 'InvalidRequest');
    });

    it('refuses a stored snapshot log that is out of order', () => {
        const metadata = fixtures.initial_metadata();
        metadata['snapshot-log'] = [
            { 'timestamp-ms': NOW_MS, 'snapshot-id': 1 },
            { 'timestamp-ms': NOW_MS - 61000, 'snapshot-id': 2 },
        ];
        expect_error_code(() => run(metadata, '{"updates":[]}'), 'InvalidRequest');
    });

    it('rejects a malformed commit body as InvalidRequest', () => {
        expect_error_code(() => run(fixtures.initial_metadata(), '{"updates":'), 'InvalidRequest');
    });

    it('reports malformed stored metadata as MetadataIntegrity, not as a client error', () => {
        expect_error_code(() => commit_engine.transform({
            metadata_bytes: Buffer.from('{not json', 'utf8'),
            commit_bytes: Buffer.from('{"updates":[]}', 'utf8'),
            ctx: make_ctx({ previous_metadata_location: fixtures.metadata_file_location(0) }),
        }), 'MetadataIntegrity');
    });

    it('trims the metadata log to 100 entries over 150 commits, newest last', () => {
        let metadata = fixtures.initial_metadata();
        /** @type {{location: string, timestamp_ms: number}[]} */
        const written = [{ location: fixtures.metadata_file_location(0), timestamp_ms: NOW_MS }];
        // ids built as text - a JavaScript numeric literal of this size would round
        const big_id = n => `81031591497236${String(10000 + n)}`;
        for (let i = 1; i <= 150; i += 1) {
            const id = big_id(i);
            const previous_id = i === 1 ? 'null' : big_id(i - 1);
            const commit_json = append_commit_text(id, {
                ref_expectation: previous_id,
                parent: previous_id,
                sequence_number: i,
                timestamp_ms: NOW_MS + i,
            });
            const { next_bytes } = commit_engine.transform({
                metadata_bytes: Buffer.from(lossless_json.stringify(metadata), 'utf8'),
                commit_bytes: Buffer.from(commit_json, 'utf8'),
                ctx: make_ctx({
                    now_ms: NOW_MS + i,
                    previous_metadata_location: written[written.length - 1].location,
                }),
            });
            metadata = lossless_json.parse(next_bytes.toString('utf8'));
            written.push({ location: fixtures.metadata_file_location(i), timestamp_ms: NOW_MS + i });
        }
        const log = metadata['metadata-log'];
        expect(log).toHaveLength(100);
        // the newest entry names the document the last commit replaced
        const expected = written.slice(-101, -1);
        expect(log.map(entry => entry['metadata-file'])).toEqual(expected.map(w => w.location));
        expect(log.map(entry => entry['timestamp-ms'])).toEqual(expected.map(w => w.timestamp_ms));
    });

    it('honours write.metadata.previous-versions-max', () => {
        let metadata = fixtures.initial_metadata({
            properties: { 'write.metadata.previous-versions-max': '5' },
        });
        for (let i = 1; i <= 12; i += 1) {
            const { next_bytes } = commit_engine.transform({
                metadata_bytes: Buffer.from(lossless_json.stringify(metadata), 'utf8'),
                commit_bytes: Buffer.from(JSON.stringify({
                    updates: [{ action: 'set-properties', updates: { round: String(i) } }],
                }), 'utf8'),
                ctx: make_ctx({
                    now_ms: NOW_MS + i,
                    previous_metadata_location: fixtures.metadata_file_location(i - 1),
                }),
            });
            metadata = lossless_json.parse(next_bytes.toString('utf8'));
        }
        expect(metadata['metadata-log']).toHaveLength(5);
    });

});
