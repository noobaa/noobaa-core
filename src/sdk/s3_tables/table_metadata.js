/* Copyright (C) 2026 NooBaa */
'use strict';

const errors = require('./s3_tables_errors');
const lossless_json = require('./lossless_json');

/**
 * The Iceberg table-metadata document model (design §8.1).
 *
 * The model *is* the parsed JSON document - there is no typed class hierarchy, which
 * is what makes a field this engine does not recognise survive a commit unchanged, and
 * what keeps format versions and views additive.
 *
 * Effect-free by constraint, not by description: this module requires nothing beyond
 * its own siblings, which is what lets the transform run in a worker thread and what
 * makes §7.2's "definitely not committed" classification sound. Not even config.js -
 * loading it reads /etc/noobaa.conf.d, sets process.env and starts a file watcher - so
 * the caller reads the two config values and passes them in the context.
 */

/**
 * @typedef {{
 *      backing_bucket: string,
 *      table_id: string,
 *      table_location: string,
 *      previous_metadata_location?: string,
 *      max_format_version: number,
 *      max_document_bytes: number,
 *      now_ms?: number,
 * }} CommitContext
 *
 * The engine's only external knowledge. `table_location` is derivable from
 * `backing_bucket` and `table_id` but is carried explicitly: the SDK owns the location
 * *spelling* (§6.2 - one source of truth, reported twice), and the engine compares
 * literally against what the SDK assigned rather than inventing a second spelling.
 *
 * `max_format_version` and `max_document_bytes` are `config.S3_TABLES_MAX_FORMAT_VERSION`
 * and `config.S3_TABLES_MAX_METADATA_BYTES`, read by the SDK on the main thread when it
 * builds the context - one read per operation.
 */

/**
 * Check the context fields the engine cannot default. A missing one is a caller bug,
 * not a client error, so it is a TypeError rather than a semantic error. Called at the
 * two entry points, build_initial_metadata() and commit_engine.transform().
 * @param {CommitContext} ctx
 */
function assert_ctx(ctx) {
    if (!ctx || typeof ctx !== 'object') throw new TypeError('a CommitContext is required');
    for (const key of ['max_format_version', 'max_document_bytes']) {
        if (!Number.isSafeInteger(ctx[key])) throw new TypeError(`ctx.${key} is required`);
    }
}

/**
 * Format-v2 constants that diverge from the Apache reference implementation if
 * guessed. Every one of these was confirmed by diffing against the reference catalog
 * (§8.1).
 */
const V2 = Object.freeze({
    // Sort-order id 0 is reserved for "unsorted", so a real write order becomes id 1.
    UNSORTED_SORT_ORDER_ID: 0,
    FIRST_SORT_ORDER_ID: 1,
    INITIAL_SCHEMA_ID: 0,
    INITIAL_SPEC_ID: 0,
    // 999 for an unpartitioned table - initializing it to 0 diverges - and partition
    // field ids start at 1000.
    LAST_PARTITION_ID_UNPARTITIONED: 999,
    PARTITION_FIELD_ID_START: 1000,
    NO_CURRENT_SNAPSHOT_ID: -1,
    MAIN_BRANCH: 'main',
    BRANCH_REF: 'branch',
    TAG_REF: 'tag',
    DEFAULT_FORMAT_VERSION: 2,
    // An Iceberg table-property default, not an operator knob, so it is a constant
    // here rather than a config key.
    PREVIOUS_VERSIONS_MAX_PROP: 'write.metadata.previous-versions-max',
    PREVIOUS_VERSIONS_MAX_DEFAULT: 100,
    WRITE_DATA_PATH_PROP: 'write.data.path',
    WRITE_METADATA_PATH_PROP: 'write.metadata.path',
    // Iceberg's LocationProviders still honour these two when write.data.path is
    // unset - write.object-storage.path is deprecated, not removed
    WRITE_FOLDER_STORAGE_PATH_PROP: 'write.folder-storage.path',
    WRITE_OBJECT_STORAGE_PATH_PROP: 'write.object-storage.path',
    // a client-named LocationProvider class decides every file path by itself
    WRITE_LOCATION_PROVIDER_IMPL_PROP: 'write.location-provider.impl',
    // The clock-skew tolerance TableMetadata's constructor allows when it checks that
    // snapshot-log and metadata-log are sorted.
    LOG_ORDER_TOLERANCE_MS: 60 * 1000,
});

/** Every table property Iceberg reads as a directory to write files under. */
const WRITE_PATH_PROPS = Object.freeze([
    V2.WRITE_DATA_PATH_PROP,
    V2.WRITE_METADATA_PATH_PROP,
    V2.WRITE_FOLDER_STORAGE_PATH_PROP,
    V2.WRITE_OBJECT_STORAGE_PATH_PROP,
]);

const S3_SCHEME = 's3://';
/** Constructs that let one location string resolve two ways (§6.1.1). */
const REFUSED_KEY_CHARS = ['%', '\\', '?', '#'];
const INTEGER_TEXT_RE = /^-?(?:0|[1-9][0-9]*)$/;

/**
 * The storage root the SDK assigns a table: `s3://<backing-bucket>/<table-id>`
 * (§3.3). No trailing slash - every comparison goes through
 * {@link location_matches_assigned}, which accepts the assigned string with or without
 * exactly one, so §15's open question about the trailing slash has one function to
 * change.
 * @param {string} backing_bucket
 * @param {string} table_id
 * @returns {string}
 */
function table_location(backing_bucket, table_id) {
    return `${S3_SCHEME}${backing_bucket}/${table_id}`;
}

/**
 * §6.1.1 - validate a client-supplied `s3://` location. Compare literally, then refuse
 * anything whose meaning is not already fixed. No decoding, no normalization, no case
 * folding: normalizing would mean reproducing the URI handling of every client
 * library, and any disagreement between ours and theirs is a bypass.
 *
 * Exported because story 17 (§6.1.4) must apply the identical rule - a check present
 * on one protocol only is exploitable by choosing the other.
 *
 * @param {any} value
 * @param {CommitContext} ctx
 * @param {{ allow_trailing_slash?: boolean, field?: string }} [options]
 * @returns {string} the value, unchanged
 */
function validate_location(value, ctx, options = {}) {
    const field = options.field || 'location';
    const refuse = reason => {
        throw errors.invalid_request(`${field} is not inside the table location: ${reason}`);
    };
    if (typeof value !== 'string' || value === '') refuse('not a non-empty string');

    // scheme: exactly s3://
    if (!value.startsWith(S3_SCHEME)) refuse(`must start with ${S3_SCHEME}`);
    const after_scheme = value.slice(S3_SCHEME.length);

    // authority: exactly the backing bucket, byte for byte
    const slash = after_scheme.indexOf('/');
    if (slash < 0) refuse('has no key');
    const authority = after_scheme.slice(0, slash);
    if (authority !== ctx.backing_bucket) refuse('names another bucket');

    let key = after_scheme.slice(slash + 1);
    if (key.endsWith('/')) {
        // a directory value such as write.data.path may end in a single `/`
        if (!options.allow_trailing_slash) refuse('must not end with /');
        key = key.slice(0, -1);
    }

    for (const ch of REFUSED_KEY_CHARS) {
        if (key.includes(ch)) refuse(`must not contain ${ch}`);
    }

    // the comparison alone is not sufficient - a value whose first segment is the
    // table id can still walk out of it, so the refusal is what makes it mean
    // something
    const segments = key.split('/');
    for (const segment of segments) {
        if (segment === '') refuse('has an empty path segment');
        if (segment === '.' || segment === '..') refuse(`has a ${segment} path segment`);
    }
    if (segments[0] !== ctx.table_id) refuse('names another table');

    return value;
}

/**
 * Whether a client-supplied `location` names the location the SDK assigned - the only
 * value `set-location` and an imperative commit may carry (§6.4 rule 3). Accepts the
 * assigned string with or without exactly one trailing `/`, pending §15 Spike B.
 * @param {any} value
 * @param {CommitContext} ctx
 * @returns {boolean}
 */
function location_matches_assigned(value, ctx) {
    if (typeof value !== 'string') return false;
    return value === ctx.table_location || value === `${ctx.table_location}/`;
}

/**
 * `write.metadata.previous-versions-max` from a properties map. Iceberg properties are
 * strings and {@link validate_table_properties} enforces that on the way in; a number
 * is still read here so a document written elsewhere does not block the trim.
 * @param {any} properties
 * @returns {number}
 */
function previous_versions_max(properties) {
    if (!properties || typeof properties !== 'object') return V2.PREVIOUS_VERSIONS_MAX_DEFAULT;
    const raw = properties[V2.PREVIOUS_VERSIONS_MAX_PROP];
    if (raw === undefined || raw === null) return V2.PREVIOUS_VERSIONS_MAX_DEFAULT;
    if (typeof raw === 'number') return lossless_json.safe_int(raw, V2.PREVIOUS_VERSIONS_MAX_PROP);
    if (typeof raw === 'string' && INTEGER_TEXT_RE.test(raw)) {
        return lossless_json.safe_int(Number(raw), V2.PREVIOUS_VERSIONS_MAX_PROP);
    }
    throw errors.invalid_request(`${V2.PREVIOUS_VERSIONS_MAX_PROP} must be an integer`);
}

/**
 * §6.4 rule 3 - Iceberg lets a client redirect file writes with table properties, and
 * the location provider honours them ahead of the table location: `write.data.path`,
 * `write.metadata.path`, and - when `write.data.path` is unset - the older
 * `write.folder-storage.path` and `write.object-storage.path`. Left unchecked, a
 * table's data lands outside the backing bucket - outside the encryption claim,
 * outside delete_table cleanup, and outside any future per-table authorization. A
 * custom `write.location-provider.impl` can place files anywhere, so it is refused
 * outright. Validated on creation and on every set-properties update.
 *
 * Every value must be a string: Iceberg's TableMetadataParser reads properties as a
 * string map and fails the whole document on anything else.
 * @param {any} properties
 * @param {CommitContext} ctx
 */
function validate_table_properties(properties, ctx) {
    if (properties === undefined || properties === null) return;
    if (typeof properties !== 'object' || Array.isArray(properties)) {
        throw errors.invalid_request('properties must be a map');
    }
    for (const [prop, value] of Object.entries(properties)) {
        if (typeof value !== 'string') throw errors.invalid_request(`property ${prop} must be a string`);
    }
    if (Object.hasOwn(properties, V2.WRITE_LOCATION_PROVIDER_IMPL_PROP)) {
        throw errors.invalid_request(
            `${V2.WRITE_LOCATION_PROVIDER_IMPL_PROP} is not supported - file locations stay inside the table location`);
    }
    for (const prop of WRITE_PATH_PROPS) {
        if (!Object.hasOwn(properties, prop)) continue;
        validate_location(properties[prop], ctx, { allow_trailing_slash: true, field: prop });
    }
    previous_versions_max(properties);
}

/**
 * @param {CommitContext} ctx
 * @returns {number}
 */
function max_format_version(ctx) {
    return ctx.max_format_version;
}

/**
 * The format-version cap (§8.2). Called from exactly two sites - initial-metadata
 * construction and the `upgrade-format-version` handler - and never globally in
 * transform(): lowering the cap must stop new v3 tables without blocking commits to a
 * table already above it.
 *
 * `from_version` is null for a creation, which is a rise from nothing.
 * @param {number|null|undefined} from_version
 * @param {any} to_version
 * @param {CommitContext} ctx
 */
function assert_format_version_allowed(from_version, to_version, ctx) {
    const to = lossless_json.safe_int(to_version, 'format-version');
    if (to < 1) throw errors.invalid_request(`format-version ${to} is not a valid Iceberg format version`);
    const max = max_format_version(ctx);
    if (from_version === null || from_version === undefined) {
        if (to > max) {
            throw errors.invalid_request(`format-version ${to} is above the supported maximum of ${max}`);
        }
        return;
    }
    const from = lossless_json.safe_int(from_version, 'format-version');
    if (to === from) return;
    if (to < from) throw errors.invalid_request(`cannot downgrade format-version from ${from} to ${to}`);
    if (to > max) {
        throw errors.invalid_request(`format-version ${to} is above the supported maximum of ${max}`);
    }
}

/**
 * AWS documents that running operations on a table with a `metadata.json` over 50 MB
 * is not supported (§8.1). Strict on input; an output document is rejected only when
 * it *grew*, so `remove-snapshots` on an at-cap table always runs - expiry is the one
 * thing that brings such a table back under the cap.
 * @param {number} byte_length
 * @param {CommitContext} ctx
 * @param {{ previous_bytes?: number }} [options]
 */
function assert_document_size(byte_length, ctx, options = {}) {
    const max = ctx.max_document_bytes;
    if (byte_length <= max) return;
    if (options.previous_bytes !== undefined && byte_length <= options.previous_bytes) return;
    throw errors.invalid_request(
        `table metadata document of ${byte_length} bytes exceeds the maximum of ${max} bytes`);
}

/**
 * The version of the next `*.metadata.json`: the previous file's version plus one,
 * parsed from its name the way BaseMetastoreTableOperations.parseVersion does - the
 * digits between the last `/` and the first `-` after it. An unparseable name counts
 * as version -1, so the next file is 0. Not the metadata-log length: the log is
 * trimmed, so its length stops growing at `write.metadata.previous-versions-max`.
 * @param {string} previous_location
 * @returns {number}
 */
function next_metadata_version(previous_location) {
    const start = previous_location.lastIndexOf('/') + 1;
    const end = previous_location.indexOf('-', start);
    const text = end < 0 ? '' : previous_location.slice(start, end);
    const version = (/^[0-9]+$/).test(text) ? Number(text) : -1;
    return Number.isSafeInteger(version) ? version + 1 : 0;
}

/**
 * The ordering TableMetadata's constructor enforces on every document it loads, with
 * its one-minute clock-skew tolerance: `snapshot-log` sorted, `last-updated-ms` not
 * before the newest snapshot-log entry, and `metadata-log` sorted. A document that
 * breaks any of them cannot be loaded by a Java client, so it is refused here rather
 * than written.
 * @param {any} metadata
 */
function assert_log_order(metadata) {
    const tolerance = V2.LOG_ORDER_TOLERANCE_MS;
    const assert_sorted = (log, field) => {
        let previous;
        for (const entry of Array.isArray(log) ? log : []) {
            const ts = lossless_json.safe_int(entry && entry['timestamp-ms'], `${field} timestamp-ms`);
            if (previous !== undefined && ts - previous < -tolerance) {
                throw errors.invalid_request(`${field} entries are not in time order: ${ts} after ${previous}`);
            }
            previous = ts;
        }
        return previous;
    };
    const last_snapshot_ts = assert_sorted(metadata['snapshot-log'], 'snapshot-log');
    if (last_snapshot_ts !== undefined) {
        const last_updated_ms = lossless_json.safe_int(metadata['last-updated-ms'], 'last-updated-ms');
        if (last_updated_ms - last_snapshot_ts < -tolerance) {
            throw errors.invalid_request(
                `last-updated-ms ${last_updated_ms} is before the last snapshot-log entry at ${last_snapshot_ts}`);
        }
    }
    assert_sorted(metadata['metadata-log'], 'metadata-log');
}

/**
 * Give every partition field without a `field-id` the next free one, in field order,
 * continuing from `last_partition_id` and from any explicit id seen before it - the
 * way Iceberg's partition-spec builder assigns them.
 * @param {any[]} fields
 * @param {number} last_partition_id
 */
function assign_partition_field_ids(fields, last_partition_id) {
    let last = last_partition_id;
    for (const field of fields) {
        if (!field || typeof field !== 'object' || Array.isArray(field)) {
            throw errors.invalid_request('partition fields must be objects');
        }
        if (field['field-id'] === undefined || field['field-id'] === null) {
            last += 1;
            field['field-id'] = last;
        } else {
            last = Math.max(last, field_id(field['field-id']));
        }
    }
}

/**
 * Append the metadata-log entry for the document being replaced and trim the log
 * (§8.1). The entry records the *previous* document - its own location and its own
 * `last-updated-ms`, not the current clock.
 *
 * The clamp to at least one entry is load-bearing, not cosmetic: a client-set 0 would
 * empty the log, and §6.1.4 reads an empty `metadata-log` as the signature of a first
 * commit - so every later imperative commit on that table would fail the descent
 * check. Iceberg's own writer clamps the same way.
 *
 * @param {any} metadata the resulting document - the trim reads its properties
 * @param {string|undefined} previous_location
 * @param {any} previous_last_updated_ms
 */
function append_metadata_log(metadata, previous_location, previous_last_updated_ms) {
    if (!previous_location) return;
    const log = Array.isArray(metadata['metadata-log']) ? metadata['metadata-log'] : [];
    log.push({
        'timestamp-ms': previous_last_updated_ms,
        'metadata-file': previous_location,
    });
    const max = Math.max(1, previous_versions_max(metadata.properties));
    if (log.length > max) log.splice(0, log.length - max);
    metadata['metadata-log'] = log;
}

/**
 * The highest field id in a schema: struct fields, a list's `element-id`, and a map's
 * `key-id` and `value-id`. v3's new types are pass-through - they nest through the
 * same three constructs.
 * @param {any} schema
 * @returns {number}
 */
function walk_last_column_id(schema) {
    let max = 0;

    /** @param {any} type */
    function visit_type(type) {
        if (!type || typeof type !== 'object') return;
        if (Array.isArray(type.fields)) {
            for (const field of type.fields) visit_field(field);
        }
        if (type.type === 'list') {
            max = Math.max(max, field_id(type['element-id']));
            visit_type(type.element);
        } else if (type.type === 'map') {
            max = Math.max(max, field_id(type['key-id']), field_id(type['value-id']));
            visit_type(type.key);
            visit_type(type.value);
        }
    }

    /** @param {any} field */
    function visit_field(field) {
        if (!field || typeof field !== 'object') return;
        max = Math.max(max, field_id(field.id));
        visit_type(field.type);
    }

    visit_type(schema);
    return max;
}

/**
 * @param {any} value
 * @returns {number}
 */
function field_id(value) {
    if (value === undefined || value === null) return 0;
    if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
    throw errors.invalid_request('schema field ids must be integers within the safe integer range');
}

/**
 * The highest partition field id in a spec, or 999 when the spec has no fields - the
 * v2 constant an unpartitioned table carries (§8.1).
 * @param {any} spec
 * @returns {number}
 */
function last_partition_id_of(spec) {
    /** @type {number} */
    let max = V2.LAST_PARTITION_ID_UNPARTITIONED;
    const fields = spec && Array.isArray(spec.fields) ? spec.fields : [];
    for (const field of fields) {
        max = Math.max(max, field_id(field && field['field-id']));
    }
    return max;
}

/**
 * Story 8 seam. Row lineage is a v3 concept and the cap is 2 here, so this is
 * unreachable until story 8 raises it.
 * @param {any} _metadata
 */
function init_row_lineage(_metadata) {
    // story 8: initialize next-row-id on a v3 table
}

/**
 * Story 8 seam, called from the add-snapshot handler.
 * @param {any} _metadata
 * @param {any} _snapshot
 * @param {CommitContext} _ctx
 */
function apply_row_lineage(_metadata, _snapshot, _ctx) {
    // story 8: validate first-row-id against next-row-id and advance it by added-rows
}

/**
 * Build the initial metadata document for a new table.
 *
 * Field order follows Iceberg's own TableMetadataParser so the differential
 * conformance test (§12 test 1) has as little to explain as possible. The two optional
 * empty arrays the reference emits - `statistics` and `partition-statistics` - are
 * omitted here; that is a recorded known difference.
 *
 * @param {{
 *      schema?: any,
 *      partition_spec?: any,
 *      sort_order?: any,
 *      properties?: any,
 *      location?: any,
 *      table_uuid: string,
 *      format_version?: number,
 * }} request
 * @param {CommitContext} ctx
 * @returns {any}
 */
function build_initial_metadata(request, ctx) {
    assert_ctx(ctx);
    const format_version = request.format_version === undefined ?
        V2.DEFAULT_FORMAT_VERSION :
        request.format_version;
    assert_format_version_allowed(null, format_version, ctx);

    // §6.4 rule 3 - the metadata document's own location stays the server-assigned one
    if (request.location !== undefined && request.location !== null &&
        !location_matches_assigned(request.location, ctx)) {
        throw errors.invalid_request('location must be the location assigned by the catalog');
    }
    validate_table_properties(request.properties, ctx);

    const schema = request.schema || { type: 'struct', 'schema-id': V2.INITIAL_SCHEMA_ID, fields: [] };
    if (typeof schema !== 'object' || Array.isArray(schema)) {
        throw errors.invalid_request('schema must be an object');
    }
    // TableMetadata.newTableMetadata assigns the initial ids whatever the client sent
    const schema_id = V2.INITIAL_SCHEMA_ID;
    schema['schema-id'] = schema_id;

    const spec = request.partition_spec || { 'spec-id': V2.INITIAL_SPEC_ID, fields: [] };
    if (typeof spec !== 'object' || Array.isArray(spec)) {
        throw errors.invalid_request('partition spec must be an object');
    }
    const spec_id = V2.INITIAL_SPEC_ID;
    spec['spec-id'] = spec_id;
    if (spec.fields === undefined || spec.fields === null) spec.fields = [];
    if (!Array.isArray(spec.fields)) throw errors.invalid_request('partition spec fields must be an array');
    assign_partition_field_ids(spec.fields, V2.LAST_PARTITION_ID_UNPARTITIONED);

    const sort_order = request.sort_order;
    const sorted = Boolean(sort_order && Array.isArray(sort_order.fields) && sort_order.fields.length > 0);
    const sort_order_id = sorted ? V2.FIRST_SORT_ORDER_ID : V2.UNSORTED_SORT_ORDER_ID;
    const sort_orders = [sorted ?
        { ...sort_order, 'order-id': sort_order_id } :
        { 'order-id': V2.UNSORTED_SORT_ORDER_ID, fields: [] },
    ];

    const metadata = {
        'format-version': format_version,
        'table-uuid': request.table_uuid,
        'location': ctx.table_location,
        'last-sequence-number': 0,
        'last-updated-ms': ctx.now_ms === undefined ? Date.now() : ctx.now_ms,
        'last-column-id': walk_last_column_id(schema),
        'current-schema-id': schema_id,
        'schemas': [schema],
        'default-spec-id': spec_id,
        'partition-specs': [spec],
        'last-partition-id': last_partition_id_of(spec),
        'default-sort-order-id': sort_order_id,
        'sort-orders': sort_orders,
        'properties': request.properties || {},
        'current-snapshot-id': V2.NO_CURRENT_SNAPSHOT_ID,
        'refs': {},
        'snapshots': [],
        'snapshot-log': [],
        'metadata-log': [],
    };
    init_row_lineage(metadata);
    return metadata;
}

// EXPORTS
exports.V2 = V2;
exports.assert_ctx = assert_ctx;
exports.table_location = table_location;
exports.build_initial_metadata = build_initial_metadata;
exports.validate_location = validate_location;
exports.location_matches_assigned = location_matches_assigned;
exports.validate_table_properties = validate_table_properties;
exports.previous_versions_max = previous_versions_max;
exports.max_format_version = max_format_version;
exports.assert_format_version_allowed = assert_format_version_allowed;
exports.assert_document_size = assert_document_size;
exports.next_metadata_version = next_metadata_version;
exports.assert_log_order = assert_log_order;
exports.assign_partition_field_ids = assign_partition_field_ids;
exports.append_metadata_log = append_metadata_log;
exports.walk_last_column_id = walk_last_column_id;
exports.last_partition_id_of = last_partition_id_of;
exports.init_row_lineage = init_row_lineage;
exports.apply_row_lineage = apply_row_lineage;
