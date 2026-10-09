/* Copyright (C) 2026 NooBaa */
'use strict';

const table_metadata = require('../../../sdk/s3_tables/table_metadata');

/**
 * Shared fixtures for the metadata-engine unit tests.
 *
 * Every test passes a fixed `now_ms` and `table_uuid`, so the only nondeterminism
 * design §8.1 allows - the uuid and the `last-updated-ms` stamp - is eliminated and
 * documents can be compared byte for byte.
 */

const BACKING_BUCKET = 'analytics--table-s3-nb';
const TABLE_ID = '6812a1b2c3d4e5f607182930';
const TABLE_UUID = '9c9f4a2e-0a1b-4c3d-8e5f-607182930405';
const NOW_MS = 1767225600000;
const TABLE_LOCATION = table_metadata.table_location(BACKING_BUCKET, TABLE_ID);

/** A snapshot id above 2^53 - the shape ~99.9% of real Iceberg snapshot ids have. */
const BIG_SNAPSHOT_ID = '8103159149723679872';
/** Rounds to the same Number as BIG_SNAPSHOT_ID, so only an exact comparison tells them apart. */
const BIG_SNAPSHOT_ID_NEXT = '8103159149723679873';

/**
 * @param {object} [overrides]
 * @returns {import('../../../sdk/s3_tables/table_metadata').CommitContext}
 */
function make_ctx(overrides) {
    return {
        backing_bucket: BACKING_BUCKET,
        table_id: TABLE_ID,
        table_location: TABLE_LOCATION,
        // the config defaults - the SDK reads them from config.js when it builds a context
        max_format_version: 2,
        max_document_bytes: 50 * 1024 * 1024,
        now_ms: NOW_MS,
        ...overrides,
    };
}

function simple_schema() {
    return {
        'type': 'struct',
        'schema-id': 0,
        'identifier-field-ids': [1],
        'fields': [
            { id: 1, name: 'id', required: true, type: 'long' },
            { id: 2, name: 'data', required: false, type: 'string' },
        ],
    };
}

/** A schema nesting a list, a map and a struct, whose highest id is 9. */
function nested_schema() {
    return {
        'type': 'struct',
        'schema-id': 0,
        'fields': [
            { id: 1, name: 'id', required: true, type: 'long' },
            {
                id: 2,
                name: 'tags',
                required: false,
                type: { type: 'list', 'element-id': 5, element: 'string', 'element-required': false },
            },
            {
                id: 3,
                name: 'attrs',
                required: false,
                type: {
                    type: 'map',
                    'key-id': 6,
                    key: 'string',
                    'value-id': 7,
                    value: { type: 'struct', fields: [{ id: 9, name: 'inner', required: false, type: 'int' }] },
                    'value-required': false,
                },
            },
            { id: 4, name: 'ts', required: false, type: 'timestamp' },
        ],
    };
}

function partition_spec_one_field() {
    return {
        'spec-id': 0,
        'fields': [{ name: 'id_bucket', transform: 'bucket[16]', 'source-id': 1, 'field-id': 1000 }],
    };
}

function sort_order_one_field() {
    return {
        'order-id': 1,
        'fields': [{ transform: 'identity', 'source-id': 1, direction: 'asc', 'null-order': 'nulls-first' }],
    };
}

/**
 * @param {object} [overrides]
 * @returns {any}
 */
function initial_metadata(overrides) {
    return table_metadata.build_initial_metadata({
        schema: simple_schema(),
        table_uuid: TABLE_UUID,
        ...overrides,
    }, make_ctx());
}

/**
 * @param {number} index
 * @returns {string} the location of the index-th metadata file the catalog writes
 */
function metadata_file_location(index) {
    const version = String(index).padStart(5, '0');
    return `${TABLE_LOCATION}/metadata/${version}-e3f0a1b2-0000-4000-8000-00000000000${index % 10}.metadata.json`;
}

/**
 * Assert that `fn` throws an S3TablesError carrying `code`.
 * @param {function} fn
 * @param {string} code
 */
function expect_error_code(fn, code) {
    let caught;
    try {
        fn();
    } catch (err) {
        caught = err;
    }
    if (caught === undefined) throw new Error(`expected an S3TablesError with code ${code}, nothing was thrown`);
    expect(caught.code).toBe(code);
}

// EXPORTS
exports.BACKING_BUCKET = BACKING_BUCKET;
exports.TABLE_ID = TABLE_ID;
exports.TABLE_UUID = TABLE_UUID;
exports.NOW_MS = NOW_MS;
exports.TABLE_LOCATION = TABLE_LOCATION;
exports.BIG_SNAPSHOT_ID = BIG_SNAPSHOT_ID;
exports.BIG_SNAPSHOT_ID_NEXT = BIG_SNAPSHOT_ID_NEXT;
exports.make_ctx = make_ctx;
exports.simple_schema = simple_schema;
exports.nested_schema = nested_schema;
exports.partition_spec_one_field = partition_spec_one_field;
exports.sort_order_one_field = sort_order_one_field;
exports.initial_metadata = initial_metadata;
exports.metadata_file_location = metadata_file_location;
exports.expect_error_code = expect_error_code;
