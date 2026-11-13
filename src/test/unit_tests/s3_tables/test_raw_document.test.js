/* Copyright (C) 2026 NooBaa */
'use strict';

const commit_engine = require('../../../sdk/s3_tables/s3_tables_commit_engine');
const lossless_json = require('../../../sdk/s3_tables/s3_tables_lossless_json');
const raw_document = require('../../../sdk/s3_tables/s3_tables_raw_document');
const table_metadata = require('../../../sdk/s3_tables/s3_tables_table_metadata');
const fixtures = require('./s3_tables_fixtures');

const { NOW_MS, TABLE_LOCATION, make_ctx, metadata_file_location } = fixtures;

/**
 * The commit engine never parses a stored document whole (design §8.1). Two things have
 * to hold for that to be safe, and this file is about both:
 *
 * - **it changes nothing a client can observe** - the output is byte for byte what a
 *   whole-document parse, the same handlers and a whole-document serialize produce;
 * - **what it does parse is bounded** - a field or an element no update reads is never
 *   parsed, and what is read is refused past a cap instead of being attempted.
 */

const KB = 1024;
const MB = 1024 * KB;

// ///////////////////////////////////////////////////////////////////////////////////
// helpers
// ///////////////////////////////////////////////////////////////////////////////////

/** Snapshot ids above 2^53, so a lossy path anywhere shows up as a byte difference. */
const BIG = 8103159149723679000n;
const snapshot_id = i => String(BIG + BigInt(i));

function ctx_of(overrides) {
    return { ...make_ctx(overrides), previous_metadata_location: metadata_file_location(4) };
}

function snapshot_text(i, extra = '') {
    return `{"snapshot-id":${snapshot_id(i)},"parent-snapshot-id":${i > 1 ? snapshot_id(i - 1) : 'null'},` +
        `"sequence-number":${i},"timestamp-ms":${NOW_MS - 1000 + i},` +
        `"manifest-list":"${TABLE_LOCATION}/metadata/snap-${snapshot_id(i)}-1-84e1.avro",` +
        `"summary":{"operation":"append","added-records":"${i}"},"schema-id":0${extra}}`;
}

/**
 * A table with some history in every array the engine keeps raw: `count` snapshots,
 * their log, statistics for the first two, three metadata-log entries and two schemas.
 * Built as text, so the ids are exact and the document is compact.
 * @param {{ count?: number, format_version?: number, extra?: string, properties?: object, schemas?: string }} [opts]
 *      `extra` is the text of more top-level fields; `schemas` is the text of the
 *      whole schemas array
 * @returns {string}
 */
function table_text(opts = {}) {
    const count = opts.count === undefined ? 6 : opts.count;
    const base = fixtures.initial_metadata({
        format_version: opts.format_version,
        properties: opts.properties,
    });
    for (const key of ['snapshots', 'snapshot-log', 'metadata-log', 'refs', 'statistics', 'partition-statistics']) delete base[key];
    base.schemas.push({ ...fixtures.nested_schema(), 'schema-id': 1 });
    base['last-column-id'] = 99;
    base['last-sequence-number'] = count;
    base['last-updated-ms'] = NOW_MS - 1000 + count;
    let head = JSON.stringify(base).slice(0, -1);
    if (opts.schemas) head = head.replace(`"schemas":${JSON.stringify(base.schemas)}`, `"schemas":${opts.schemas}`);
    const indices = Array.from({ length: count }, (_, k) => k + 1);
    const statistics = indices.slice(0, 2).map(i =>
        `{"snapshot-id":${snapshot_id(i)},"statistics-path":"${TABLE_LOCATION}/metadata/s${i}.puffin","blob-metadata":[{"type":"ndv","fields":[1]}]}`);
    const partition_statistics = indices.slice(0, 2).map(i =>
        `{"snapshot-id":${snapshot_id(i)},"statistics-path":"${TABLE_LOCATION}/metadata/p${i}.parquet","file-size-in-bytes":${100 + i}}`);
    const metadata_log = [1, 2, 3].map(i =>
        `{"timestamp-ms":${NOW_MS - 5000 + i},"metadata-file":"${metadata_file_location(i)}"}`);
    const current = count > 0 ?
        `"current-snapshot-id":${snapshot_id(count)},"refs":{"main":{"snapshot-id":${snapshot_id(count)},"type":"branch"},` +
        `"old":{"snapshot-id":${snapshot_id(1)},"type":"tag"}},` :
        '';
    return `${head},${current}` +
        `"snapshots":[${indices.map(i => snapshot_text(i)).join(',')}],` +
        `"snapshot-log":[${indices.map(i => `{"timestamp-ms":${NOW_MS - 1000 + i},"snapshot-id":${snapshot_id(i)}}`).join(',')}],` +
        `"statistics":[${statistics.join(',')}],"partition-statistics":[${partition_statistics.join(',')}],` +
        `"metadata-log":[${metadata_log.join(',')}]${opts.extra ? `,${opts.extra}` : ''}}`;
}

/**
 * The transform as a whole-document parse would do it: parse everything, run the same
 * handlers on the plain object, serialize everything. This is the engine's behaviour
 * with no raw document in the way, so it is what the real transform must reproduce.
 * @returns {string}
 */
function reference_transform(doc_text, commit_text, ctx) {
    const commit = lossless_json.parse(commit_text);
    const metadata = lossless_json.parse(doc_text);
    const previous_last_updated_ms = metadata['last-updated-ms'];
    const previous_next_row_id = metadata['next-row-id'];
    commit_engine.check_requirements(metadata, commit.requirements);
    commit_engine.apply_updates(metadata, commit.updates, ctx);
    table_metadata.assert_row_lineage_advanced(metadata, previous_next_row_id);
    table_metadata.append_metadata_log(metadata, ctx.previous_metadata_location, previous_last_updated_ms);
    table_metadata.assert_log_order(metadata);
    return lossless_json.stringify(metadata);
}

function transform(doc_text, commit_text, ctx) {
    return commit_engine.transform({
        metadata_bytes: Buffer.from(doc_text, 'utf8'),
        commit_bytes: Buffer.from(commit_text, 'utf8'),
        ctx,
    }).next_bytes.toString('utf8');
}

function outcome(fn) {
    try {
        return { text: fn() };
    } catch (err) {
        return { error: `${err.code || err.name}: ${err.message}` };
    }
}

/**
 * Parse a document for comparison, with its out-of-range ids quoted so nothing rounds.
 * @param {string} text
 * @returns {any}
 */
function content(text) {
    return JSON.parse(text.replace(/(:\s*)(81031591497236\d+)/g, '$1"$2"'));
}

/**
 * Both paths must produce the same document, or the same error. For an input the raw
 * copy keeps in a spelling a re-serialization would normalize - an escaped key, a
 * repeated key, whitespace - where the bytes legitimately differ.
 */
function expect_same_content(doc_text, commit_text, ctx = ctx_of()) {
    const expected = outcome(() => reference_transform(doc_text, commit_text, ctx));
    const actual = outcome(() => transform(doc_text, commit_text, ctx));
    expect(actual.error).toBe(expected.error);
    if (expected.text !== undefined) expect(content(actual.text)).toEqual(content(expected.text));
    return actual;
}

/** Both paths must agree on the bytes, or on the error. */
function expect_same(doc_text, commit, ctx = ctx_of()) {
    const commit_text = typeof commit === 'string' ? commit : JSON.stringify(commit);
    const expected = outcome(() => reference_transform(doc_text, commit_text, ctx));
    const actual = outcome(() => transform(doc_text, commit_text, ctx));
    expect(actual).toEqual(expected);
    return actual;
}

function expect_code(fn, code) {
    let caught;
    try {
        fn();
    } catch (err) {
        caught = err;
    }
    expect(caught && caught.code).toBe(code);
    return caught;
}

const append = (i, parent) =>
    `{"requirements":[{"type":"assert-ref-snapshot-id","ref":"main","snapshot-id":${parent === undefined ? 'null' : snapshot_id(parent)}}],` +
    `"updates":[{"action":"add-snapshot","snapshot":${snapshot_text(i).replace(/"timestamp-ms":\d+/, `"timestamp-ms":${NOW_MS}`)}},` +
    `{"action":"set-snapshot-ref","ref-name":"main","type":"branch","snapshot-id":${snapshot_id(i)}}]}`;
const expire = (...indices) =>
    `{"updates":[{"action":"remove-snapshots","snapshot-ids":[${indices.map(snapshot_id).join(',')}]}]}`;

// ///////////////////////////////////////////////////////////////////////////////////
// the same bytes as a whole-document parse
// ///////////////////////////////////////////////////////////////////////////////////

describe('s3_tables raw_document - the same bytes as a whole-document parse', () => {

    const doc = table_text();

    it.each([
        ['an append', append(7, 6)],
        ['an empty update list', '{"updates":[]}'],
        ['an expiry of the oldest snapshots', expire(1, 2, 3)],
        ['an expiry from the middle', expire(3)],
        ['an expiry of everything but the current snapshot', expire(1, 2, 3, 4, 5)],
        ['an expiry of every snapshot, main included', expire(1, 2, 3, 4, 5, 6)],
        ['an expiry of a snapshot that is not there', expire(99)],
        ['a rollback of main to an old snapshot',
            `{"updates":[{"action":"set-snapshot-ref","ref-name":"main","type":"branch","snapshot-id":${snapshot_id(2)}}]}`],
        ['a new tag', `{"updates":[{"action":"set-snapshot-ref","ref-name":"t","type":"tag","snapshot-id":${snapshot_id(3)}}]}`],
        ['a removed ref', '{"updates":[{"action":"remove-snapshot-ref","ref-name":"old"}]}'],
        ['an append and an expiry in one commit',
            `{"updates":[${JSON.stringify(lossless_json.parse(append(7, 6)).updates[0]).replace(/"(snapshot-id|parent-snapshot-id)":"?(\d+)"?/g, '"$1":$2')}]}`],
        ['set-properties', { updates: [{ action: 'set-properties', updates: { owner: 'x', 'k é': 'v 😀' } }] }],
        ['remove-properties', { updates: [{ action: 'remove-properties', removals: ['nope'] }] }],
        ['a new schema, made current', {
            updates: [
                { action: 'add-schema', schema: { type: 'struct', fields: [{ id: 1, name: 'only', required: true, type: 'long' }] } },
                { action: 'set-current-schema', 'schema-id': -1 },
            ],
        }],
        ['a schema identical to a stored one, which is reused', {
            updates: [{ action: 'add-schema', schema: fixtures.nested_schema() }],
        }],
        ['a removed schema', { updates: [{ action: 'remove-schemas', 'schema-ids': [1] }] }],
        ['a schema set current by its stored id', { updates: [{ action: 'set-current-schema', 'schema-id': 1 }] }],
        ['a new partition spec, made default', {
            updates: [{ action: 'add-spec', spec: fixtures.partition_spec_one_field() }, { action: 'set-default-spec', 'spec-id': -1 }],
        }],
        ['a new sort order, made default', {
            updates: [
                { action: 'add-sort-order', 'sort-order': fixtures.sort_order_one_field() },
                { action: 'set-default-sort-order', 'sort-order-id': -1 },
            ],
        }],
        ['statistics that replace a stored entry',
            `{"updates":[{"action":"set-statistics","statistics":{"snapshot-id":${snapshot_id(2)},"statistics-path":"s3://x/new.puffin","blob-metadata":[]}}]}`],
        ['statistics for a snapshot that had none',
            `{"updates":[{"action":"set-statistics","statistics":{"snapshot-id":${snapshot_id(5)},"statistics-path":"s3://x/5.puffin","blob-metadata":[]}}]}`],
        ['removed statistics', `{"updates":[{"action":"remove-statistics","snapshot-id":${snapshot_id(1)}}]}`],
        ['partition statistics that replace a stored entry',
            `{"updates":[{"action":"set-partition-statistics","partition-statistics":{"snapshot-id":${snapshot_id(1)},"statistics-path":"s3://x/p.parquet","file-size-in-bytes":7}}]}`],
        ['removed partition statistics', `{"updates":[{"action":"remove-partition-statistics","snapshot-id":${snapshot_id(2)}}]}`],
        ['a replaced entry that a later update of the same commit removes',
            `{"updates":[{"action":"set-statistics","statistics":{"snapshot-id":${snapshot_id(1)},"statistics-path":"s3://x/n.puffin","blob-metadata":[]}},` +
            `{"action":"remove-snapshots","snapshot-ids":[${snapshot_id(1)}]}]}`],
        ['an upgrade to format version 3', { updates: [{ action: 'upgrade-format-version', 'format-version': 3 }] }],
        ['assign-uuid with the table\'s own uuid', { updates: [{ action: 'assign-uuid', uuid: fixtures.TABLE_UUID }] }],
    ])('%s', (_label, commit) => {
        const result = expect_same(doc, commit);
        expect(result.error).toBeUndefined();
    });

    it.each([
        ['a stale requirement', '{"requirements":[{"type":"assert-ref-snapshot-id","ref":"main","snapshot-id":1}],"updates":[]}'],
        ['a ref to an unknown snapshot', '{"updates":[{"action":"set-snapshot-ref","ref-name":"x","type":"tag","snapshot-id":42}]}'],
        ['a snapshot id that already exists', append(3, 6)],
        ['a stale sequence number', append(7, 6).replace('"sequence-number":7', '"sequence-number":2')],
        ['an unknown action', { updates: [{ action: 'no-such-action' }] }],
        ['a schema id that does not exist', { updates: [{ action: 'set-current-schema', 'schema-id': 9 }] }],
        ['removing the current schema', { updates: [{ action: 'remove-schemas', 'schema-ids': [0] }] }],
        ['a snapshot-log that would go out of order',
            `{"updates":[{"action":"add-snapshot","snapshot":${snapshot_text(7).replace(/"timestamp-ms":\d+/, '"timestamp-ms":5')}},` +
            `{"action":"set-snapshot-ref","ref-name":"main","type":"branch","snapshot-id":${snapshot_id(7)}}]}`],
    ])('fails the same way on %s', (_label, commit) => {
        const result = expect_same(doc, commit);
        expect(result.error).toBeDefined();
    });

    it('trims the metadata log to write.metadata.previous-versions-max without parsing it', () => {
        const trimmed = table_text({ properties: { 'write.metadata.previous-versions-max': '2' } });
        const result = expect_same(trimmed, '{"updates":[]}');
        const log = JSON.parse(result.text)['metadata-log'];
        expect(log).toHaveLength(2);
        expect(log[1]['metadata-file']).toBe(metadata_file_location(4));
    });

    it('starts the three logs of a table that has none', () => {
        expect_same(table_text({ count: 0 }), append(1));
    });

    it('maintains row lineage on a v3 table', () => {
        const v3 = table_text({ count: 0, format_version: 3 });
        const commit = append(1).replace('"schema-id":0', '"schema-id":0,"first-row-id":0,"added-rows":10');
        const result = expect_same(v3, commit);
        expect(JSON.parse(result.text)['next-row-id']).toBe(10);
        expect_same(v3, append(1).replace('"schema-id":0', '"schema-id":0,"first-row-id":5,"added-rows":10'));
    });

    it('runs a long history, where every list operation crosses many elements', () => {
        const long = table_text({ count: 3000 });
        expect_same(long, append(3001, 3000));
        expect_same(long, expire(...Array.from({ length: 1500 }, (_, k) => (k * 2) + 1)));
        expect_same(long, expire(...Array.from({ length: 2999 }, (_, k) => k + 1)));
    });

    it('reads a stored element whose key is escaped, or that is not an object, the way JSON.parse does', () => {
        // to JSON.parse "snapshot-id" is the key snapshot-id; a byte compare would miss it
        const odd = table_text().replace('"snapshots":[{"snapshot-id":', '"snapshots":[null,7,{"snapshot\\u002did":');
        // the element keeps its escaped spelling in the copy, so the content is compared
        expect(content(expect_same_content(odd, expire(1)).text).snapshots).toHaveLength(7);
        expect(content(expect_same_content(odd, expire(2)).text).snapshots).toHaveLength(7);
        expect_same_content(odd, append(7, 6));
        // and it is found by its id: the first snapshot is the escaped one
        const kept = content(transform(odd, expire(1), ctx_of())).snapshots;
        expect(kept.some(s => s && s['snapshot-id'] === snapshot_id(1))).toBe(false);
    });

    it('keeps the last of a repeated key, at the top level and inside an element', () => {
        const repeated = table_text()
            .replace('"last-sequence-number":6', '"last-sequence-number":1,"last-sequence-number":6')
            .replace(`{"snapshot-id":${snapshot_id(2)},"parent`, `{"snapshot-id":1,"snapshot-id":${snapshot_id(2)},"parent`);
        // the reference re-serializes the element, so it drops the first of the pair;
        // the raw copy keeps both - which parses to the same document
        const expired = content(expect_same_content(repeated, expire(2)).text);
        expect(expired.snapshots).toHaveLength(5);
        expect(content(expect_same_content(repeated, append(7, 6)).text)['last-sequence-number']).toBe(7);
    });

    it('produces the same document from a pretty-printed input, without reformatting what it did not touch', () => {
        // the ids are quoted for the reformat and unquoted after it, so nothing rounds
        const pretty = JSON.stringify(content(doc), null, 2).replace(/"(81031591497236\d+)"/g, '$1');
        expect(pretty).toContain(`"snapshot-id": ${snapshot_id(1)},\n`);
        const actual = expect_same_content(pretty, append(7, 6)).text;
        // and a stored snapshot kept its bytes, whitespace included
        expect(actual).toContain(`"snapshot-id": ${snapshot_id(1)},\n      "parent-snapshot-id": null`);
    });
});

// ///////////////////////////////////////////////////////////////////////////////////
// what is not read is not parsed
// ///////////////////////////////////////////////////////////////////////////////////

describe('s3_tables raw_document - what is not read is not parsed', () => {

    /** A value too large to parse under the cap used below, and dense in small values. */
    const DENSE = `[${'{},'.repeat(100 * KB)}{}]`;
    const SMALL_CAP = { max_parsed_bytes: 64 * KB };

    it('copies a field no update reads, byte for byte, even when it is far over the parse cap', () => {
        const doc = table_text({ extra: `"x-unknown" :  { "weird" : ${DENSE} }` });
        const out = transform(doc, append(7, 6), ctx_of(SMALL_CAP));
        expect(out).toContain(`"x-unknown":{ "weird" : ${DENSE} }`);
    });

    it('copies a statistics entry dense in small values without parsing it', () => {
        const hostile = table_text().replace('"blob-metadata":[{"type":"ndv","fields":[1]}]', `"blob-metadata":${DENSE}`);
        const out = transform(hostile, append(7, 6), ctx_of(SMALL_CAP));
        expect(out).toContain(`"blob-metadata":${DENSE}`);
        // and an update that addresses the entry by id still does not parse it
        expect(() => transform(hostile, `{"updates":[{"action":"remove-statistics","snapshot-id":${snapshot_id(2)}}]}`,
            ctx_of(SMALL_CAP))).not.toThrow();
    });

    it('does not parse snapshots to append to them or to expire from them', () => {
        const fat = table_text().replace('"summary":{"operation":"append","added-records":"1"}', `"summary":{"x":${DENSE}}`);
        const ctx = ctx_of(SMALL_CAP);
        expect(transform(fat, append(7, 6), ctx)).toContain(`"summary":{"x":${DENSE}}`);
        expect(transform(fat, expire(2), ctx)).toContain(`"summary":{"x":${DENSE}}`);
        expect(transform(fat, expire(1), ctx)).not.toContain(DENSE);
    });

    it('moves fields for the v3 upgrade without parsing them', () => {
        // the upgrade reinserts every key after current-snapshot-id; one of them is too
        // large to parse, so a move that read it would be refused
        const doc = table_text({ extra: `"x-unknown":${DENSE}` });
        const commit = JSON.stringify({ updates: [{ action: 'upgrade-format-version', 'format-version': 3 }] });
        const out = transform(doc, commit, ctx_of(SMALL_CAP));
        expect(out).toBe(reference_transform(doc, commit, ctx_of()));
        expect(Object.keys(JSON.parse(out.replace(/\b81031591497236\d+\b/g, '1')))).toContain('next-row-id');
    });

    it('parses a stored schema only to compare it, one at a time', () => {
        // four schemas of ~24 KB each: together over the cap, each one under it
        const field = i => `{"id":${i},"name":"column_${i}_${'x'.repeat(40)}","required":false,"type":"string"}`;
        const schema = n => `{"type":"struct","schema-id":${n},"fields":[${Array.from({ length: 300 }, (_, i) => field((n * 1000) + i)).join(',')}]}`;
        const doc = table_text({ schemas: `[${[0, 1, 2, 3].map(schema).join(',')}]` });
        expect(doc).toContain('"schema-id":3,"fields"');
        expect(doc.length).toBeGreaterThan(SMALL_CAP.max_parsed_bytes);
        const add = JSON.stringify({ updates: [{ action: 'add-schema', schema: fixtures.simple_schema() }] });
        const ctx = ctx_of(SMALL_CAP);
        expect(transform(doc, add, ctx)).toBe(reference_transform(doc, add, ctx));
    });

    it('lets an untouched table through however small the parse cap, as long as what is read fits', () => {
        // an append reads properties, refs and a handful of scalars - about a kilobyte here
        const out = transform(table_text({ count: 500 }), append(501, 500), ctx_of({ max_parsed_bytes: 2 * KB }));
        expect(JSON.parse(out.replace(/\b81031591497236\d+\b/g, '1')).snapshots).toHaveLength(501);
    });
});

// ///////////////////////////////////////////////////////////////////////////////////
// the caps
// ///////////////////////////////////////////////////////////////////////////////////

describe('s3_tables raw_document - the caps', () => {

    it('refuses a commit that would have to parse more of the document than the cap', () => {
        const properties = {};
        for (let i = 0; i < 4000; i++) properties[`k${i}`] = '';
        const doc = table_text({ properties });
        // every commit reads properties - the metadata-log trim does
        const err = expect_code(() => transform(doc, '{"updates":[]}', ctx_of({ max_parsed_bytes: 16 * KB })), 'InvalidRequest');
        expect(err.message).toMatch(/field properties/);
        expect(() => transform(doc, '{"updates":[]}', ctx_of({ max_parsed_bytes: 128 * KB }))).not.toThrow();
    });

    it('refuses a commit that would grow the fields it parsed past the cap', () => {
        // properties fit the cap and are read; the update would push them over it. Left
        // alone, every later commit - each reads properties - would be refused
        const properties = { filler: 'x'.repeat(20 * KB) };
        const doc = table_text({ properties });
        const ctx = ctx_of({ max_parsed_bytes: 32 * KB, max_commit_bytes: MB });
        const grow = JSON.stringify({ updates: [{ action: 'set-properties', updates: { more: 'y'.repeat(20 * KB) } }] });
        const err = expect_code(() => transform(doc, grow, ctx), 'InvalidRequest');
        expect(err.message).toMatch(/grow the parsed fields/);
        // the same table still takes a commit that does not grow them, and one that shrinks them
        expect(() => transform(doc, append(7, 6), ctx)).not.toThrow();
        expect(() => transform(doc, JSON.stringify({ updates: [{ action: 'remove-properties', removals: ['filler'] }] }), ctx))
            .not.toThrow();
    });

    it('refuses a document with more array elements than the element cap', () => {
        const doc = table_text({ count: 50 });
        // 50 snapshots, 50 log entries, 2 + 2 statistics, 3 metadata-log entries, 2 schemas
        expect(() => transform(doc, '{"updates":[]}', ctx_of({ max_raw_elements: 109 }))).not.toThrow();
        const err = expect_code(() => transform(doc, '{"updates":[]}', ctx_of({ max_raw_elements: 108 })), 'InvalidRequest');
        expect(err.message).toMatch(/more than 108 elements/);
    });

    it('refuses a commit request over the body limit before parsing it', () => {
        const doc = table_text();
        const commit = JSON.stringify({ updates: [{ action: 'set-properties', updates: { a: 'x'.repeat(2 * KB) } }] });
        expect_code(() => transform(doc, commit, ctx_of({ max_commit_bytes: KB })), 'InvalidRequest');
        expect(() => transform(doc, commit, ctx_of({ max_commit_bytes: 4 * KB }))).not.toThrow();
        // not valid JSON either - but the size is what is reported, because nothing parsed it
        const err = expect_code(() => transform(doc, '{'.repeat(2 * KB), ctx_of({ max_commit_bytes: KB })), 'InvalidRequest');
        expect(err.message).toMatch(/exceeds the maximum of 1024 bytes/);
    });

    it('does not parse an oversized value just because it sits where an id belongs', () => {
        // the indexer locates "snapshot-id" in every element; a client chooses its value
        const dense = `[${'{},'.repeat(100 * KB)}{}]`;
        const doc = table_text().replace(`{"snapshot-id":${snapshot_id(3)},"parent`, `{"snapshot-id":${dense},"parent`);
        expect_code(() => transform(doc, expire(4), ctx_of({ max_parsed_bytes: 64 * KB })), 'InvalidRequest');
    });

    it('requires the three caps in the context, as a caller bug and not a client error', () => {
        for (const key of ['max_parsed_bytes', 'max_commit_bytes', 'max_raw_elements']) {
            const ctx = ctx_of();
            delete ctx[key];
            expect(() => transform(table_text(), '{"updates":[]}', ctx)).toThrow(TypeError);
        }
    });
});

// ///////////////////////////////////////////////////////////////////////////////////
// a stored document that is not what it should be
// ///////////////////////////////////////////////////////////////////////////////////

describe('s3_tables raw_document - a damaged stored document', () => {

    const doc = table_text();

    it.each([
        ['is not JSON', '{"format-version":2,'],
        ['is empty', ''],
        ['is an array', '[1,2,3]'],
        ['is a string', '"metadata"'],
        ['has a trailing comma inside a stored snapshot', doc.replace('"schema-id":0}', '"schema-id":0,}')],
        ['has a number with a leading zero inside a stored snapshot', doc.replace('"sequence-number":2,', '"sequence-number":02,')],
        ['has a raw control character inside a statistics path', doc.replace('s1.puffin', 's1\u0001.puffin')],
        ['has a trailing comma in an array the engine never reads', doc.replace('"fields":[1]', '"fields":[1,]')],
        ['is truncated in the middle of the snapshot log', doc.slice(0, doc.indexOf('"snapshot-log"') + 40)],
        ['carries bytes after the document', `${doc}{}`],
    ])('is MetadataIntegrity when the document %s', (_label, text) => {
        expect_code(() => transform(text, append(7, 6), ctx_of()), 'MetadataIntegrity');
    });

    it('is MetadataIntegrity when the document is not UTF-8, which a byte copy would otherwise preserve', () => {
        const bytes = Buffer.from(doc, 'utf8');
        const at = bytes.indexOf('snap-');
        bytes[at] = 0xff;
        expect_code(() => commit_engine.transform({
            metadata_bytes: bytes, commit_bytes: Buffer.from(append(7, 6)), ctx: ctx_of(),
        }), 'MetadataIntegrity');
    });

    it('refuses a document nested past the depth limit as a limit, not as corruption', () => {
        const deep = table_text({ extra: `"x":${'['.repeat(600)}${']'.repeat(600)}` });
        expect_code(() => transform(deep, append(7, 6), ctx_of()), 'InvalidRequest');
    });
});

// ///////////////////////////////////////////////////////////////////////////////////
// RawList - the array methods the engine calls, with an array's meaning
// ///////////////////////////////////////////////////////////////////////////////////

describe('s3_tables raw_document - RawList', () => {

    const LIMITS = { max_parsed_bytes: MB, max_elements: 1000 };

    function open(text) {
        return raw_document.open_document(Buffer.from(text, 'utf8'), LIMITS);
    }

    const ELEMENTS = [
        '{"snapshot-id":10,"timestamp-ms":100,"note":"a"}',
        '{"snapshot-id":8103159149723679872,"timestamp-ms":200}',
        '{"timestamp-ms":300}',
        '{"snapshot-id":40,"timestamp-ms":400,"nested":{"snapshot-id":"decoy"}}',
    ];
    const text = `{"snapshots":[${ELEMENTS.join(',')}],"other":1}`;
    const plain = () => lossless_json.parse(text).snapshots;
    const ids = list => list.map(e => lossless_json.id_text(e['snapshot-id']));

    it('is a list to the engine and not an Array', () => {
        const { snapshots } = open(text);
        expect(snapshots).toBeInstanceOf(raw_document.RawList);
        expect(Array.isArray(snapshots)).toBe(false);
        expect(raw_document.is_list(snapshots)).toBe(true);
        expect(raw_document.is_list([])).toBe(true);
        expect(raw_document.is_list({ length: 0 })).toBe(false);
        expect(raw_document.is_list(undefined)).toBe(false);
    });

    it('answers length, map, find, findIndex, some and iteration as the parsed array does', () => {
        const { snapshots } = open(text);
        const array = plain();
        expect(snapshots.length).toBe(array.length);
        expect(ids(snapshots)).toEqual(ids(array));
        expect(ids([...snapshots])).toEqual(ids(array));
        const is_big = e => lossless_json.id_text(e['snapshot-id']) === '8103159149723679872';
        expect(snapshots.findIndex(is_big)).toBe(array.findIndex(is_big));
        expect(snapshots.findIndex(() => false)).toBe(-1);
        expect(snapshots.find(() => false)).toBeUndefined();
        expect(snapshots.some(is_big)).toBe(true);
        expect(snapshots.some(e => e['timestamp-ms'] === 999)).toBe(false);
        expect(lossless_json.id_text(snapshots.find(is_big)['snapshot-id'])).toBe('8103159149723679872');
        // the index a callback is given is the element's position
        expect(snapshots.map((_e, i) => i)).toEqual([0, 1, 2, 3]);
    });

    it('reads a located key from the bytes and any other key by parsing that one element', () => {
        const { snapshots } = open(text);
        const [first, , third, fourth] = [...snapshots];
        expect(first['snapshot-id']).toBe(10);
        expect(first['timestamp-ms']).toBe(100);
        expect(first.note).toBe('a');
        expect(first.missing).toBeUndefined();
        expect(third['snapshot-id']).toBeUndefined();
        // the located key is the element's own, not one nested inside it
        expect(fourth['snapshot-id']).toBe(40);
        expect(fourth.nested).toEqual({ 'snapshot-id': 'decoy' });
        expect(Object.keys(first)).toEqual(['snapshot-id', 'timestamp-ms', 'note']);
        expect('note' in first).toBe(true);
        expect(JSON.stringify(first)).toBe(ELEMENTS[0]);
    });

    it('keeps an out-of-range id exact, as the lossless parse does', () => {
        const { snapshots } = open(text);
        const id = [...snapshots][1]['snapshot-id'];
        expect(JSON.isRawJSON(id)).toBe(true);
        expect(id.rawJSON).toBe('8103159149723679872');
    });

    it('refuses a write to a stored element', () => {
        const { snapshots } = open(text);
        const [first] = [...snapshots];
        expect(() => { first.note = 'changed'; }).toThrow(TypeError);
        expect(() => { delete first.note; }).toThrow(TypeError);
        expect(() => Object.defineProperty(first, 'x', { value: 1 })).toThrow(TypeError);
    });

    it('filters, pushes, replaces and trims with an array\'s result', () => {
        const check = (mutate_list, mutate_array) => {
            const metadata = open(text);
            const array = plain();
            const list = mutate_list(metadata.snapshots) || metadata.snapshots;
            const expected = mutate_array(array) || array;
            metadata.snapshots = list;
            const written = lossless_json.parse(raw_document.write_document(metadata).toString('utf8')).snapshots;
            expect(lossless_json.stringify(written)).toBe(lossless_json.stringify(expected));
            expect(list.length).toBe(expected.length);
        };
        const keep = e => e['timestamp-ms'] !== 200;
        check(l => l.filter(keep), a => a.filter(keep));
        check(l => { l.push({ new: 1 }, { new: 2 }); }, a => { a.push({ new: 1 }, { new: 2 }); });
        check(l => raw_document.replace_at(l, 1, { replaced: true }), a => { a[1] = { replaced: true }; });
        check(l => raw_document.trim_front(l, 2), a => { a.splice(0, 2); });
        // across the boundary between stored and pushed values
        check(l => { l.push({ new: 1 }, { new: 2 }); raw_document.trim_front(l, 5); },
            a => { a.push({ new: 1 }, { new: 2 }); a.splice(0, 5); });
        check(l => { l.push({ new: 1 }); raw_document.replace_at(l, 4, { again: 1 }); },
            a => { a.push({ new: 1 }); a[4] = { again: 1 }; });
        // a replaced value survives a filter, and is what the filter sees
        check(l => { raw_document.replace_at(l, 0, { 'timestamp-ms': 200 }); return l.filter(keep); },
            a => { a[0] = { 'timestamp-ms': 200 }; return a.filter(keep); });
        check(l => l.filter(() => false), () => []);
    });

    it('the same helpers work on a plain array', () => {
        const array = [1, 2, 3, 4];
        raw_document.replace_at(array, 1, 'x');
        raw_document.trim_front(array, 2);
        expect(array).toEqual([3, 4]);
    });

    it('writes a plain object by serializing it whole', () => {
        const metadata = fixtures.initial_metadata();
        expect(raw_document.write_document(metadata).toString('utf8')).toBe(lossless_json.stringify(metadata));
    });

    it('writes an untouched document back byte for byte', () => {
        const odd = ' {\n "a" : [ 1 , 2 ] ,"snapshots" : [ {"snapshot-id" : 1} , null ],\t"z":"é" } ';
        const out = raw_document.write_document(open(odd)).toString('utf8');
        expect(out).toBe('{"a":[ 1 , 2 ],"snapshots":[{"snapshot-id" : 1} , null],"z":"é"}');
    });

    it('moves a key to the end of the order without reading it', () => {
        const metadata = raw_document.open_document(
            Buffer.from('{"a":{"big":[1,2,3]},"b":2}'), { max_parsed_bytes: 4, max_elements: 10 });
        raw_document.move_key_last(metadata, 'a');
        expect(Object.keys(metadata)).toEqual(['b', 'a']);
        // "a" is 15 bytes and the cap is 4: reading it would throw, moving and writing it does not
        expect(raw_document.write_document(metadata).toString('utf8')).toBe('{"b":2,"a":{"big":[1,2,3]}}');
        expect(() => metadata.a).toThrow(/would parse more than 4 bytes/);
    });
});
