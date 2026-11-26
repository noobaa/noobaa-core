/* Copyright (C) 2026 NooBaa */
'use strict';

// Pure schema/wiring unit test for story 6a - no database connection needed. It validates
// the three catalog record schemas (table_buckets, table_namespaces, table_pointers) and
// pins their unique partial indexes to design §5. Collection CRUD and the DDL convergence
// (§12 test 16, 17) are exercised by the DB-backed integration test.

const _ = require('lodash');
const Ajv = require('ajv');
const mongodb = require('mongodb');

const schema_keywords = require('../../../util/schema_keywords');
const schema_utils = require('../../../util/schema_utils');

const table_bucket_schema = require('../../../server/table_services/schemas/table_bucket_schema');
const table_namespace_schema = require('../../../server/table_services/schemas/table_namespace_schema');
const table_pointer_schema = require('../../../server/table_services/schemas/table_pointer_schema');
const table_bucket_indexes = require('../../../server/table_services/schemas/table_bucket_indexes');
const table_namespace_indexes = require('../../../server/table_services/schemas/table_namespace_indexes');
const table_pointer_indexes = require('../../../server/table_services/schemas/table_pointer_indexes');

const oid = () => new mongodb.ObjectId();

// Build the exact validator the database uses - the same custom keywords and the same
// strictify(additionalProperties:false) db_client applies in define_collection - but
// without requiring db_client/config, so this stays a pure, DB-free unit test.
function build_validator(schema) {
    const ajv = new Ajv({ verbose: true, allErrors: true });
    ajv.addKeyword(schema_keywords.KEYWORDS.date);
    ajv.addKeyword(schema_keywords.KEYWORDS.idate);
    ajv.addKeyword(schema_keywords.KEYWORDS.objectid);
    ajv.addKeyword(schema_keywords.KEYWORDS.binary);
    ajv.addKeyword(schema_keywords.KEYWORDS.wrapper);
    const cloned = _.cloneDeep(schema);
    schema_utils.strictify(cloned, { additionalProperties: false });
    return ajv.compile(cloned);
}

const validators = {
    _table_buckets: build_validator(table_bucket_schema),
    _table_namespaces: build_validator(table_namespace_schema),
    _table_pointers: build_validator(table_pointer_schema),
};
// `store` mirrors the table_store collection-handle names so the cases below read the same
const store = validators;

function expect_valid(validator, doc) {
    const ok = validator(doc);
    if (!ok) console.error('unexpected schema errors', validator.errors);
    expect(ok).toBe(true);
}

function expect_invalid(validator, doc) {
    expect(validator(doc)).toBe(false);
}

describe('s3_tables table schemas (§5)', () => {

    describe('table_buckets', () => {
        const base = () => ({
            _id: oid(),
            system: oid(),
            name: 'my-table-bucket',
            owner: oid(),
            backing_bucket_name: 'my-table-bucket--table-s3-nb',
            state: 'provisioning',
            created_at: Date.now(),
        });

        it('accepts a provisioning record with no backing bucket yet', () => {
            expect_valid(store._table_buckets, base());
        });

        it('accepts a ready record with backing_bucket id and AES256 encryption', () => {
            expect_valid(store._table_buckets, {
                ...base(),
                state: 'ready',
                backing_bucket: oid(),
                encryption: { sse_algorithm: 'AES256' },
            });
        });

        it('accepts a soft-deleted record (deleted is a Date)', () => {
            expect_valid(store._table_buckets, { ...base(), deleted: new Date() });
        });

        it('rejects a missing required field', () => {
            const doc = base();
            delete doc.name;
            expect_invalid(store._table_buckets, doc);
        });

        it('rejects an unknown lifecycle state', () => {
            expect_invalid(store._table_buckets, { ...base(), state: 'done' });
        });

        it('rejects an unknown extra field (additionalProperties:false)', () => {
            expect_invalid(store._table_buckets, { ...base(), surprise: 1 });
        });

        it('rejects an idate created_at that is not an integer', () => {
            expect_invalid(store._table_buckets, { ...base(), created_at: '2026-01-01' });
        });
    });

    describe('table_namespaces', () => {
        const base = () => ({
            _id: oid(),
            table_bucket: oid(),
            name: 'analytics',
            created_at: Date.now(),
        });

        it('accepts a record with no properties', () => {
            expect_valid(store._table_namespaces, base());
        });

        it('accepts a string-to-string properties map', () => {
            expect_valid(store._table_namespaces, { ...base(), properties: { owner: 'team-a', tier: 'raw' } });
        });

        it('rejects a non-string property value', () => {
            expect_invalid(store._table_namespaces, { ...base(), properties: { count: 3 } });
        });

        it('rejects a missing table_bucket', () => {
            const doc = base();
            delete doc.table_bucket;
            expect_invalid(store._table_namespaces, doc);
        });
    });

    describe('table_pointers', () => {
        const base = () => ({
            _id: oid(),
            table_bucket: oid(),
            namespace_name: 'analytics',
            name: 'orders',
            version_token: 'tok-1',
            kind: 'table',
            created_at: Date.now(),
        });

        it('accepts an uninitialized pointer (token only, no metadata_location, §6.1.3)', () => {
            expect_valid(store._table_pointers, base());
        });

        it('accepts an initialized pointer with location, etag and uuid', () => {
            expect_valid(store._table_pointers, {
                ...base(),
                metadata_location: 's3://my-table-bucket--table-s3-nb/abc/metadata/00000-x.metadata.json',
                metadata_etag: '"deadbeef"',
                table_uuid: 'c2a1-uuid',
            });
        });

        it('rejects a missing version_token', () => {
            const doc = base();
            delete doc.version_token;
            expect_invalid(store._table_pointers, doc);
        });

        it('rejects an unknown kind', () => {
            expect_invalid(store._table_pointers, { ...base(), kind: 'materialized_view' });
        });
    });

    describe('unique partial indexes pin §5', () => {
        const only = arr => {
            expect(arr).toHaveLength(1);
            return arr[0];
        };

        it('table_buckets: unique {system, name} partial on deleted:null', () => {
            const idx = only(table_bucket_indexes);
            expect(idx.fields).toEqual({ system: 1, name: 1 });
            expect(idx.options.unique).toBe(true);
            expect(idx.options.partialFilterExpression).toEqual({ deleted: null });
        });

        it('table_namespaces: unique {table_bucket, name} partial on deleted:null', () => {
            const idx = only(table_namespace_indexes);
            expect(idx.fields).toEqual({ table_bucket: 1, name: 1 });
            expect(idx.options.unique).toBe(true);
            expect(idx.options.partialFilterExpression).toEqual({ deleted: null });
        });

        it('table_pointers: unique {table_bucket, namespace_name, name} partial on deleted:null', () => {
            const idx = only(table_pointer_indexes);
            expect(idx.fields).toEqual({ table_bucket: 1, namespace_name: 1, name: 1 });
            expect(idx.options.unique).toBe(true);
            expect(idx.options.partialFilterExpression).toEqual({ deleted: null });
        });
    });
});
