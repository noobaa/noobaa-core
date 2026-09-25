/* Copyright (C) 2026 NooBaa */
'use strict';

const fs = require('fs');
const path = require('path');
const table_metadata = require('../../../sdk/s3_tables/table_metadata');
const commit_engine = require('../../../sdk/s3_tables/commit_engine');
const { V2 } = table_metadata;
const fixtures = require('./s3_tables_fixtures');
const { make_ctx, expect_error_code } = fixtures;

describe('s3_tables table_metadata', () => {

    describe('table_location', () => {

        it('is s3://<backing-bucket>/<table-id> with no trailing slash', () => {
            expect(table_metadata.table_location('b--table-s3-nb', 'abc'))
                .toBe('s3://b--table-s3-nb/abc');
        });

    });

    describe('build_initial_metadata - the v2 constants (§8.1)', () => {

        it('gives an unsorted table sort-order id 0', () => {
            const metadata = fixtures.initial_metadata();
            expect(metadata['default-sort-order-id']).toBe(V2.UNSORTED_SORT_ORDER_ID);
            expect(metadata['sort-orders']).toEqual([{ 'order-id': 0, fields: [] }]);
        });

        it('gives a real write order id 1, not 0', () => {
            const metadata = fixtures.initial_metadata({ sort_order: fixtures.sort_order_one_field() });
            expect(metadata['default-sort-order-id']).toBe(V2.FIRST_SORT_ORDER_ID);
            expect(metadata['sort-orders']).toHaveLength(1);
            expect(metadata['sort-orders'][0]['order-id']).toBe(1);
        });

        it('gives an unpartitioned table last-partition-id 999, not 0', () => {
            const metadata = fixtures.initial_metadata();
            expect(metadata['last-partition-id']).toBe(999);
            expect(metadata['last-partition-id']).not.toBe(0);
        });

        it('gives one partition field last-partition-id 1000', () => {
            const metadata = fixtures.initial_metadata({
                partition_spec: fixtures.partition_spec_one_field(),
            });
            expect(metadata['last-partition-id']).toBe(V2.PARTITION_FIELD_ID_START);
        });

        it('assigns schema id 0 and spec id 0 whatever the client sent', () => {
            const metadata = fixtures.initial_metadata({
                schema: { ...fixtures.simple_schema(), 'schema-id': 7 },
                partition_spec: { ...fixtures.partition_spec_one_field(), 'spec-id': 3 },
            });
            expect(metadata['current-schema-id']).toBe(0);
            expect(metadata.schemas[0]['schema-id']).toBe(0);
            expect(metadata['default-spec-id']).toBe(0);
            expect(metadata['partition-specs'][0]['spec-id']).toBe(0);
        });

        it('assigns missing partition field ids from 1000, after any explicit one', () => {
            const metadata = fixtures.initial_metadata({
                partition_spec: { fields: [
                    { name: 'a', transform: 'identity', 'source-id': 1 },
                    { name: 'b', transform: 'bucket[4]', 'source-id': 2, 'field-id': 1005 },
                    { name: 'c', transform: 'identity', 'source-id': 2 },
                ] },
            });
            expect(metadata['partition-specs'][0].fields.map(f => f['field-id'])).toEqual([1000, 1005, 1006]);
            expect(metadata['last-partition-id']).toBe(1006);
        });

        it('starts with no current snapshot and sequence number 0', () => {
            const metadata = fixtures.initial_metadata();
            expect(metadata['current-snapshot-id']).toBe(-1);
            expect(metadata['last-sequence-number']).toBe(0);
            expect(metadata.snapshots).toEqual([]);
            expect(metadata.refs).toEqual({});
            expect(metadata['snapshot-log']).toEqual([]);
            expect(metadata['metadata-log']).toEqual([]);
        });

        it('defaults to format version 2 and the assigned location', () => {
            const metadata = fixtures.initial_metadata();
            expect(metadata['format-version']).toBe(2);
            expect(metadata.location).toBe(fixtures.TABLE_LOCATION);
            expect(metadata['table-uuid']).toBe(fixtures.TABLE_UUID);
            expect(metadata['last-updated-ms']).toBe(fixtures.NOW_MS);
        });

        it('rejects a location other than the one the catalog assigned', () => {
            expect_error_code(() => fixtures.initial_metadata({
                location: `s3://${fixtures.BACKING_BUCKET}/another-table`,
            }), 'InvalidRequest');
        });

        it('accepts the assigned location with and without a trailing slash', () => {
            expect(fixtures.initial_metadata({ location: fixtures.TABLE_LOCATION }).location)
                .toBe(fixtures.TABLE_LOCATION);
            expect(fixtures.initial_metadata({ location: `${fixtures.TABLE_LOCATION}/` }).location)
                .toBe(fixtures.TABLE_LOCATION);
        });

    });

    describe('walk_last_column_id', () => {

        it('walks struct fields, list element-id and map key-id / value-id', () => {
            expect(table_metadata.walk_last_column_id(fixtures.nested_schema())).toBe(9);
        });

        it('feeds last-column-id of the initial document', () => {
            const metadata = fixtures.initial_metadata({ schema: fixtures.nested_schema() });
            expect(metadata['last-column-id']).toBe(9);
        });

        it('is 0 for an empty schema', () => {
            expect(table_metadata.walk_last_column_id({ type: 'struct', fields: [] })).toBe(0);
        });

    });

    describe('effect-freedom (§8.1)', () => {

        const engine_dir = path.join(__dirname, '../../../sdk/s3_tables');

        it('the engine requires nothing but node builtins and its own siblings - not even config.js', () => {
            const builtins = new Set(require('module').builtinModules);
            for (const file of fs.readdirSync(engine_dir).filter(name => name.endsWith('.js'))) {
                const source = fs.readFileSync(path.join(engine_dir, file), 'utf8');
                for (const [, target] of source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
                    const sibling = target.startsWith('./') && !target.slice(2).includes('/');
                    expect({ file, target, allowed: sibling || builtins.has(target.replace(/^node:/, '')) })
                        .toEqual({ file, target, allowed: true });
                }
            }
        });

        it('refuses a context without the two config values - a caller bug, not a client error', () => {
            for (const key of ['max_format_version', 'max_document_bytes']) {
                const ctx = make_ctx({ [key]: undefined, previous_metadata_location: 's3://b/t/metadata/00000-x.metadata.json' });
                expect(() => table_metadata.build_initial_metadata(
                    { schema: fixtures.simple_schema(), table_uuid: fixtures.TABLE_UUID }, ctx)).toThrow(TypeError);
                expect(() => commit_engine.transform({
                    metadata_bytes: JSON.stringify(fixtures.initial_metadata()), commit_bytes: '{"updates":[]}', ctx,
                })).toThrow(TypeError);
            }
        });

    });

    describe('assert_format_version_allowed', () => {

        const ctx = make_ctx({ max_format_version: 2 });

        it('rejects creating above the cap', () => {
            expect_error_code(() => table_metadata.assert_format_version_allowed(null, 3, ctx), 'InvalidRequest');
        });

        it('allows creating at the cap', () => {
            expect(() => table_metadata.assert_format_version_allowed(null, 2, ctx)).not.toThrow();
        });

        it('rejects a rise above the cap', () => {
            expect_error_code(() => table_metadata.assert_format_version_allowed(2, 3, ctx), 'InvalidRequest');
        });

        it('rejects a downgrade', () => {
            expect_error_code(() => table_metadata.assert_format_version_allowed(3, 2, ctx), 'InvalidRequest');
        });

        it('allows an unchanged version even above the cap, so lowering it blocks no commit', () => {
            expect(() => table_metadata.assert_format_version_allowed(3, 3, ctx)).not.toThrow();
        });

        it('rejects a format version that is not a safe integer', () => {
            expect_error_code(() => table_metadata.assert_format_version_allowed(2, '3', ctx), 'InvalidRequest');
        });

    });

    describe('assert_document_size', () => {

        const ctx = make_ctx({ max_document_bytes: 1000 });

        it('accepts an input at the cap and rejects one byte more', () => {
            expect(() => table_metadata.assert_document_size(1000, ctx)).not.toThrow();
            expect_error_code(() => table_metadata.assert_document_size(1001, ctx), 'InvalidRequest');
        });

        it('accepts an output over the cap when it did not grow', () => {
            expect(() => table_metadata.assert_document_size(1200, ctx, { previous_bytes: 1200 })).not.toThrow();
            expect(() => table_metadata.assert_document_size(1100, ctx, { previous_bytes: 1200 })).not.toThrow();
        });

        it('rejects an output over the cap that grew', () => {
            expect_error_code(
                () => table_metadata.assert_document_size(1300, ctx, { previous_bytes: 1200 }),
                'InvalidRequest');
        });

    });

    describe('previous_versions_max', () => {

        it('defaults to 100', () => {
            expect(table_metadata.previous_versions_max({})).toBe(100);
            expect(table_metadata.previous_versions_max(undefined)).toBe(100);
        });

        it('reads a string property, as Iceberg writes it', () => {
            expect(table_metadata.previous_versions_max({ 'write.metadata.previous-versions-max': '5' })).toBe(5);
        });

        it('reads a numeric property too', () => {
            expect(table_metadata.previous_versions_max({ 'write.metadata.previous-versions-max': 5 })).toBe(5);
        });

        it('rejects a non-integer', () => {
            expect_error_code(
                () => table_metadata.previous_versions_max({ 'write.metadata.previous-versions-max': 'many' }),
                'InvalidRequest');
            expect_error_code(
                () => table_metadata.previous_versions_max({ 'write.metadata.previous-versions-max': '1.5' }),
                'InvalidRequest');
        });

    });

    describe('append_metadata_log', () => {

        it('records the previous document, not the current clock', () => {
            const metadata = { properties: {}, 'metadata-log': [] };
            table_metadata.append_metadata_log(metadata, 's3://b/t/metadata/00000-x.metadata.json', 111);
            expect(metadata['metadata-log']).toEqual([
                { 'timestamp-ms': 111, 'metadata-file': 's3://b/t/metadata/00000-x.metadata.json' },
            ]);
        });

        it('does nothing when there is no previous document', () => {
            const metadata = { properties: {}, 'metadata-log': [] };
            table_metadata.append_metadata_log(metadata, undefined, 111);
            expect(metadata['metadata-log']).toEqual([]);
        });

        it('trims to write.metadata.previous-versions-max, keeping the newest last', () => {
            const metadata = { properties: { 'write.metadata.previous-versions-max': '3' }, 'metadata-log': [] };
            for (let i = 0; i < 10; i += 1) {
                table_metadata.append_metadata_log(metadata, `file-${i}`, i);
            }
            expect(metadata['metadata-log'].map(entry => entry['metadata-file']))
                .toEqual(['file-7', 'file-8', 'file-9']);
        });

        it('clamps a client-set 0 to one entry, so the log is never empty', () => {
            // §6.1.4 reads an empty metadata-log as the signature of a first commit, so
            // emptying it would fail every later imperative commit's descent check
            const metadata = { properties: { 'write.metadata.previous-versions-max': '0' }, 'metadata-log': [] };
            table_metadata.append_metadata_log(metadata, 'file-a', 1);
            table_metadata.append_metadata_log(metadata, 'file-b', 2);
            expect(metadata['metadata-log']).toHaveLength(1);
            expect(metadata['metadata-log'][0]['metadata-file']).toBe('file-b');
        });

    });

    describe('validate_table_properties', () => {

        const ctx = make_ctx();

        it('accepts write paths inside the table location', () => {
            expect(() => table_metadata.validate_table_properties({
                'write.data.path': `${fixtures.TABLE_LOCATION}/data/`,
                'write.metadata.path': `${fixtures.TABLE_LOCATION}/metadata`,
            }, ctx)).not.toThrow();
        });

        it('rejects a write.data.path in another bucket', () => {
            expect_error_code(() => table_metadata.validate_table_properties({
                'write.data.path': 's3://someone-else/data/',
            }, ctx), 'InvalidRequest');
        });

        it('rejects a write.metadata.path under another table', () => {
            expect_error_code(() => table_metadata.validate_table_properties({
                'write.metadata.path': `s3://${fixtures.BACKING_BUCKET}/another-table/metadata/`,
            }, ctx), 'InvalidRequest');
        });

        // Iceberg's LocationProviders fall back to these when write.data.path is unset
        it.each(['write.folder-storage.path', 'write.object-storage.path'])(
            'validates %s like write.data.path', prop => {
                expect_error_code(() => table_metadata.validate_table_properties({
                    [prop]: 's3://someone-else/data/',
                }, ctx), 'InvalidRequest');
                expect(() => table_metadata.validate_table_properties({
                    [prop]: `${fixtures.TABLE_LOCATION}/data/`,
                }, ctx)).not.toThrow();
            });

        it('refuses a custom write.location-provider.impl outright', () => {
            expect_error_code(() => table_metadata.validate_table_properties({
                'write.location-provider.impl': 'com.example.AnywhereLocationProvider',
            }, ctx), 'InvalidRequest');
        });

        it('refuses a property value that is not a string - Java cannot parse the document', () => {
            expect_error_code(() => table_metadata.validate_table_properties({ owner: 5 }, ctx), 'InvalidRequest');
            expect_error_code(() => table_metadata.validate_table_properties({
                'write.metadata.previous-versions-max': 5,
            }, ctx), 'InvalidRequest');
        });

    });

    describe('next_metadata_version', () => {

        it.each([
            ['s3://b/t/metadata/00000-e3f0.metadata.json', 1],
            ['s3://b/t/metadata/00099-e3f0.metadata.json', 100],
            ['s3://b/t/metadata/123456-e3f0.metadata.json', 123457],
            ['s3://b/t/metadata/v3.metadata.json', 0],
            ['s3://b/t/metadata/abc-e3f0.metadata.json', 0],
        ])('%s -> %i', (location, version) => {
            expect(table_metadata.next_metadata_version(location)).toBe(version);
        });

    });

    describe('assert_log_order', () => {

        it('allows up to one minute of clock skew and refuses more', () => {
            const doc = (a, b) => ({ 'last-updated-ms': 200000, 'snapshot-log': [], 'metadata-log': [
                { 'timestamp-ms': a, 'metadata-file': 'x' }, { 'timestamp-ms': b, 'metadata-file': 'y' }] });
            expect(() => table_metadata.assert_log_order(doc(100000, 40000))).not.toThrow();
            expect_error_code(() => table_metadata.assert_log_order(doc(100000, 39999)), 'InvalidRequest');
        });

    });

});
