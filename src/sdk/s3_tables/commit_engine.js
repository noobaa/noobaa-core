/* Copyright (C) 2026 NooBaa */
'use strict';

const errors = require('./s3_tables_errors');
const lossless_json = require('./lossless_json');
const table_metadata = require('./table_metadata');

const { V2 } = table_metadata;
const { id_text, safe_int } = lossless_json;

/**
 * The commit engine (design §8.1): turn a client's declarative commit - a list of
 * requirements and a list of updates - into a new Iceberg metadata document.
 *
 * Effect-free by constraint. Nothing here does I/O, and nothing here may require
 * anything beyond node builtins and its own siblings - not even config.js, whose
 * values arrive in the context. That is what lets story 9 run it in a worker thread,
 * and what makes §7.2's "definitely not committed" classification sound - a worker
 * death provably means nothing was written, because the code that died could not
 * write.
 *
 * The document is mutated in place. `transform()` parses from bytes it was handed, so
 * the object graph is already private; an explicit clone on top of the parse would be
 * a second full-document traversal on the hot path, buying nothing. The parse is the
 * clone (§8.1).
 */

/**
 * @typedef {import('./table_metadata').CommitContext} CommitContext
 */

// ///////////////////////////////////////////////////////////////////////////////////
// helpers
// ///////////////////////////////////////////////////////////////////////////////////

/**
 * @param {any} metadata
 * @param {string} key
 * @returns {any[]}
 */
function ensure_array(metadata, key) {
    if (!Array.isArray(metadata[key])) metadata[key] = [];
    return metadata[key];
}

/**
 * @param {any} metadata
 * @param {string} key
 * @returns {object}
 */
function ensure_map(metadata, key) {
    const value = metadata[key];
    if (!value || typeof value !== 'object' || Array.isArray(value)) metadata[key] = {};
    return metadata[key];
}

/**
 * @param {any} value
 * @param {string} field
 * @returns {any}
 */
function require_object(value, field) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw errors.invalid_request(`${field} must be an object`);
    }
    return value;
}

/**
 * @param {any} value
 * @param {string} field
 * @returns {string}
 */
function require_string(value, field) {
    if (typeof value !== 'string' || value === '') {
        throw errors.invalid_request(`${field} must be a non-empty string`);
    }
    return value;
}

/**
 * @param {any} value
 * @param {string} field
 * @returns {any[]}
 */
function require_array(value, field) {
    if (!Array.isArray(value)) throw errors.invalid_request(`${field} must be an array`);
    return value;
}

/**
 * @param {any} metadata
 * @param {string} id
 * @returns {any}
 */
function find_snapshot(metadata, id) {
    const snapshots = Array.isArray(metadata.snapshots) ? metadata.snapshots : [];
    return snapshots.find(snapshot => id_text(snapshot && snapshot['snapshot-id']) === id);
}

/**
 * A key-order-independent text form of a JSON value, for structural equality. A raw
 * value contributes its exact source text.
 * @param {any} value
 * @returns {string}
 */
function canonical_text(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (JSON.isRawJSON(value)) return value.rawJSON;
    if (Array.isArray(value)) return `[${value.map(canonical_text).join(',')}]`;
    const keys = Object.keys(value).filter(key => value[key] !== undefined).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonical_text(value[key])}`).join(',')}}`;
}

/**
 * Schema.sameSchema: the same fields and the same identifier fields, ignoring the id.
 * @param {any} a
 * @param {any} b
 * @returns {boolean}
 */
function same_schema(a, b) {
    const identifiers = schema => [...(Array.isArray(schema['identifier-field-ids']) ?
        schema['identifier-field-ids'] : [])].sort((x, y) => x - y);
    return canonical_text(a.fields) === canonical_text(b.fields) &&
        canonical_text(identifiers(a)) === canonical_text(identifiers(b));
}

/**
 * PartitionSpec.compatibleWith: field by field, the same source, transform and name.
 * Field ids are not compared.
 * @param {any} a
 * @param {any} b
 * @returns {boolean}
 */
function compatible_spec(a, b) {
    const a_fields = Array.isArray(a.fields) ? a.fields : [];
    const b_fields = Array.isArray(b.fields) ? b.fields : [];
    if (a_fields.length !== b_fields.length) return false;
    return a_fields.every((field, i) => field && b_fields[i] &&
        field['source-id'] === b_fields[i]['source-id'] &&
        field.transform === b_fields[i].transform &&
        field.name === b_fields[i].name);
}

/**
 * The next id in Iceberg's reuse-or-create scheme: one above every id at or above
 * `start`. Iceberg never takes an id from the client for a schema, spec or sort
 * order - replacing an entry by the client's id would silently reinterpret every data
 * and manifest file written under the old one.
 * @param {any[]} list
 * @param {string} id_key
 * @param {number} start
 * @returns {number}
 */
function next_free_id(list, id_key, start) {
    let next = start;
    for (const element of list) {
        const id = element && element[id_key];
        if (typeof id === 'number' && Number.isSafeInteger(id) && id >= next) next = id + 1;
    }
    return next;
}

/**
 * @param {Set<number>} added ids added earlier in this commit
 * @param {number} id the id of the entry an add resolved to
 * @returns {number|undefined} what "-1, the last added" now means
 */
function last_added_after_reuse(added, id) {
    // TableMetadata.Builder: re-adding an existing entry counts as "the last added" only
    // if this same commit added it
    return added.has(id) ? id : undefined;
}

// ///////////////////////////////////////////////////////////////////////////////////
// requirements
// ///////////////////////////////////////////////////////////////////////////////////

/**
 * Assert the table exists. Every requirement except `assert-create` needs a document.
 * @param {any} metadata
 * @param {string} type
 * @returns {any}
 */
function require_metadata(metadata, type) {
    if (metadata === null || metadata === undefined) {
        throw errors.requirement_failed(`${type}: the table does not exist`);
    }
    return metadata;
}

/**
 * @param {any} metadata
 * @param {any} requirement
 * @param {string} field
 * @param {string} metadata_key
 */
function assert_scalar(metadata, requirement, field, metadata_key) {
    const expected = requirement[field];
    const actual = metadata[metadata_key];
    if (actual !== expected) {
        throw errors.requirement_failed(
            `${requirement.type}: expected ${field} ${expected} but the table has ${actual}`);
    }
}

/**
 * The eight Iceberg requirement types - §8.2 states this set is complete, there is no
 * `assert-next-row-id`. Every failure is RequirementFailed (409, "reload and rebase").
 */
const REQUIREMENT_CHECKS = Object.freeze({

    /**
     * The engine has no notion of table existence, so the SDK passes `metadata === null`
     * for a table that does not exist - including an uninitialized pointer (§6.1.3).
     */
    'assert-create': (metadata, requirement) => {
        if (metadata !== null && metadata !== undefined) {
            throw errors.requirement_failed('assert-create: the table already exists');
        }
    },

    'assert-table-uuid': (metadata, requirement) => {
        require_metadata(metadata, 'assert-table-uuid');
        assert_scalar(metadata, requirement, 'uuid', 'table-uuid');
    },

    /**
     * A null or absent `snapshot-id` means **the ref must not exist** - it is what a
     * client's very first append sends. Treating null as snapshot 0 breaks every first
     * commit.
     */
    'assert-ref-snapshot-id': (metadata, requirement) => {
        require_metadata(metadata, 'assert-ref-snapshot-id');
        const ref_name = require_string(requirement.ref, 'assert-ref-snapshot-id.ref');
        const refs = metadata.refs;
        const has_ref = Boolean(refs) && typeof refs === 'object' && Object.hasOwn(refs, ref_name);
        const expected = id_text(requirement['snapshot-id'], 'assert-ref-snapshot-id.snapshot-id');
        if (expected === undefined) {
            if (has_ref) {
                throw errors.requirement_failed(
                    `assert-ref-snapshot-id: ref ${ref_name} was expected not to exist but it does`);
            }
            return;
        }
        if (!has_ref) {
            throw errors.requirement_failed(`assert-ref-snapshot-id: ref ${ref_name} does not exist`);
        }
        // compared as exact source text - ...679872 and ...679873 round to the same
        // Number, so a numeric comparison would wrongly satisfy this requirement
        const actual = id_text(refs[ref_name] && refs[ref_name]['snapshot-id']);
        if (actual !== expected) {
            throw errors.requirement_failed(
                `assert-ref-snapshot-id: ref ${ref_name} is at ${actual}, not ${expected}`);
        }
    },

    'assert-last-assigned-field-id': (metadata, requirement) => {
        require_metadata(metadata, 'assert-last-assigned-field-id');
        assert_scalar(metadata, requirement, 'last-assigned-field-id', 'last-column-id');
    },

    'assert-current-schema-id': (metadata, requirement) => {
        require_metadata(metadata, 'assert-current-schema-id');
        assert_scalar(metadata, requirement, 'current-schema-id', 'current-schema-id');
    },

    'assert-last-assigned-partition-id': (metadata, requirement) => {
        require_metadata(metadata, 'assert-last-assigned-partition-id');
        assert_scalar(metadata, requirement, 'last-assigned-partition-id', 'last-partition-id');
    },

    'assert-default-spec-id': (metadata, requirement) => {
        require_metadata(metadata, 'assert-default-spec-id');
        assert_scalar(metadata, requirement, 'default-spec-id', 'default-spec-id');
    },

    'assert-default-sort-order-id': (metadata, requirement) => {
        require_metadata(metadata, 'assert-default-sort-order-id');
        assert_scalar(metadata, requirement, 'default-sort-order-id', 'default-sort-order-id');
    },

});

/**
 * Check every requirement a commit carries. `metadata === null` means "the table does
 * not exist" - the engine cannot know that itself, so the SDK says so (§6.1.3).
 *
 * A missing or non-string discriminator is InvalidRequest; a well-formed but
 * unrecognised one is UnsupportedOperation. Both render 400 - §7.2 quotes the REST
 * spec: servers "are required to fail with a 400 status code if any unknown updates or
 * requirements are received". Never ignored, never 501.
 *
 * @param {any} metadata parsed metadata document, or null when the table does not exist
 * @param {any} requirements
 */
function check_requirements(metadata, requirements) {
    if (requirements === undefined || requirements === null) return;
    require_array(requirements, 'requirements');
    const has_create = requirements.some(req => req && req.type === 'assert-create');
    if (has_create && requirements.length > 1) {
        throw errors.invalid_request('assert-create must be the only requirement of a commit');
    }
    for (const requirement of requirements) {
        require_object(requirement, 'requirement');
        const type = requirement.type;
        if (typeof type !== 'string' || type === '') {
            throw errors.invalid_request('every requirement must carry a type');
        }
        if (!Object.hasOwn(REQUIREMENT_CHECKS, type)) {
            throw errors.unsupported_operation(`unknown requirement type: ${type}`);
        }
        REQUIREMENT_CHECKS[type](metadata, requirement);
    }
}

// ///////////////////////////////////////////////////////////////////////////////////
// updates
// ///////////////////////////////////////////////////////////////////////////////////

/**
 * Rejected by name rather than through the generic unknown-action path, so the client
 * gets an actionable message (§8.2).
 */
const REJECTED_ACTIONS = Object.freeze({
    'add-encryption-key': 'table encryption keys are not supported in this preview',
    'remove-encryption-key': 'table encryption keys are not supported in this preview',
});

/**
 * What one commit's updates have done so far - the parts of TableMetadata.Builder's
 * `changes` list the later updates and the final snapshot-log rewrite read.
 * @typedef {{
 *      now_ms: number,
 *      last_added_schema_id?: number,
 *      last_added_spec_id?: number,
 *      last_added_sort_order_id?: number,
 *      added_schema_ids: Set<number>,
 *      added_spec_ids: Set<number>,
 *      added_sort_order_ids: Set<number>,
 *      added_snapshot_ids: Set<string>,
 *      main_targets_added: string[],
 *      removed_snapshots: boolean,
 * }} UpdateState
 */

/**
 * @param {CommitContext} ctx
 * @returns {UpdateState}
 */
function new_update_state(ctx) {
    return {
        now_ms: ctx.now_ms === undefined ? Date.now() : ctx.now_ms,
        added_schema_ids: new Set(),
        added_spec_ids: new Set(),
        added_sort_order_ids: new Set(),
        added_snapshot_ids: new Set(),
        main_targets_added: [],
        removed_snapshots: false,
    };
}

/**
 * Resolve the Iceberg "-1 means the last added one" convention.
 * @param {any} id
 * @param {number|undefined} last_added
 * @param {string} field
 * @returns {number}
 */
function resolve_added_id(id, last_added, field) {
    const value = safe_int(id, field);
    if (value !== -1) return value;
    if (last_added === undefined) {
        throw errors.invalid_request(`${field} is -1 but this commit added none`);
    }
    return last_added;
}

const UPDATE_HANDLERS = Object.freeze({

    'assign-uuid': (metadata, update) => {
        const uuid = require_string(update.uuid, 'assign-uuid.uuid');
        const current = metadata['table-uuid'];
        if (current !== undefined && current !== null && current !== uuid) {
            throw errors.invalid_request(`cannot reassign the table uuid from ${current} to ${uuid}`);
        }
        metadata['table-uuid'] = uuid;
    },

    'upgrade-format-version': (metadata, update, ctx) => {
        const to = safe_int(update['format-version'], 'upgrade-format-version.format-version');
        const from = metadata['format-version'];
        if (to === from) return;
        table_metadata.assert_format_version_allowed(from, to, ctx);
        metadata['format-version'] = to;
        table_metadata.init_row_lineage(metadata);
    },

    /**
     * The client's `schema-id` is never trusted: an identical schema already in the
     * table is reused, anything else gets the next id (reuseOrCreateNewSchemaId).
     */
    'add-schema': (metadata, update, ctx, state) => {
        const schema = require_object(update.schema, 'add-schema.schema');
        const schemas = ensure_array(metadata, 'schemas');
        const last_column_id = table_metadata.walk_last_column_id(schema);
        const current = metadata['last-column-id'];
        metadata['last-column-id'] = current === undefined || current === null ?
            last_column_id :
            Math.max(safe_int(current, 'last-column-id'), last_column_id);
        const existing = schemas.find(candidate => candidate && same_schema(candidate, schema));
        if (existing) {
            state.last_added_schema_id = last_added_after_reuse(state.added_schema_ids, existing['schema-id']);
            return;
        }
        const current_schema_id = metadata['current-schema-id'];
        const start = typeof current_schema_id === 'number' && Number.isSafeInteger(current_schema_id) ?
            current_schema_id : V2.INITIAL_SCHEMA_ID;
        const schema_id = next_free_id(schemas, 'schema-id', start);
        schema['schema-id'] = schema_id;
        schemas.push(schema);
        state.added_schema_ids.add(schema_id);
        state.last_added_schema_id = schema_id;
    },

    'set-current-schema': (metadata, update, ctx, state) => {
        const schema_id = resolve_added_id(
            update['schema-id'], state.last_added_schema_id, 'set-current-schema.schema-id');
        const schemas = ensure_array(metadata, 'schemas');
        if (!schemas.some(schema => schema && schema['schema-id'] === schema_id)) {
            throw errors.invalid_request(`cannot set current schema to unknown schema ${schema_id}`);
        }
        metadata['current-schema-id'] = schema_id;
    },

    /**
     * As for schemas, the client's `spec-id` is never trusted: a compatible spec is
     * reused, anything else gets the next id (reuseOrCreateNewSpecId). Fields without a
     * `field-id` get fresh ones above `last-partition-id`.
     */
    'add-spec': (metadata, update, ctx, state) => {
        const spec = require_object(update.spec, 'add-spec.spec');
        if (spec.fields === undefined || spec.fields === null) spec.fields = [];
        require_array(spec.fields, 'add-spec.spec.fields');
        const specs = ensure_array(metadata, 'partition-specs');
        const existing = specs.find(candidate => candidate && compatible_spec(candidate, spec));
        if (existing) {
            state.last_added_spec_id = last_added_after_reuse(state.added_spec_ids, existing['spec-id']);
            return;
        }
        const current = metadata['last-partition-id'];
        const current_last = current === undefined || current === null ?
            V2.LAST_PARTITION_ID_UNPARTITIONED :
            safe_int(current, 'last-partition-id');
        table_metadata.assign_partition_field_ids(spec.fields, current_last);
        const spec_id = next_free_id(specs, 'spec-id', V2.INITIAL_SPEC_ID);
        spec['spec-id'] = spec_id;
        specs.push(spec);
        metadata['last-partition-id'] = Math.max(current_last, table_metadata.last_partition_id_of(spec));
        state.added_spec_ids.add(spec_id);
        state.last_added_spec_id = spec_id;
    },

    'set-default-spec': (metadata, update, ctx, state) => {
        const spec_id = resolve_added_id(
            update['spec-id'], state.last_added_spec_id, 'set-default-spec.spec-id');
        const specs = ensure_array(metadata, 'partition-specs');
        if (!specs.some(spec => spec && spec['spec-id'] === spec_id)) {
            throw errors.invalid_request(`cannot set default spec to unknown spec ${spec_id}`);
        }
        metadata['default-spec-id'] = spec_id;
    },

    /**
     * The unsorted order is always id 0; a real order equal to an existing one reuses
     * its id, anything else gets the next id from 1 (reuseOrCreateNewSortOrderId).
     */
    'add-sort-order': (metadata, update, ctx, state) => {
        const sort_order = require_object(update['sort-order'], 'add-sort-order.sort-order');
        if (sort_order.fields === undefined || sort_order.fields === null) sort_order.fields = [];
        require_array(sort_order.fields, 'add-sort-order.sort-order.fields');
        const sort_orders = ensure_array(metadata, 'sort-orders');
        const unsorted = sort_order.fields.length === 0;
        const existing = sort_orders.find(candidate => candidate && (unsorted ?
            candidate['order-id'] === V2.UNSORTED_SORT_ORDER_ID :
            canonical_text(candidate.fields) === canonical_text(sort_order.fields)));
        if (existing) {
            state.last_added_sort_order_id =
                last_added_after_reuse(state.added_sort_order_ids, existing['order-id']);
            return;
        }
        const order_id = unsorted ?
            V2.UNSORTED_SORT_ORDER_ID :
            next_free_id(sort_orders, 'order-id', V2.FIRST_SORT_ORDER_ID);
        sort_order['order-id'] = order_id;
        sort_orders.push(sort_order);
        state.added_sort_order_ids.add(order_id);
        state.last_added_sort_order_id = order_id;
    },

    'set-default-sort-order': (metadata, update, ctx, state) => {
        const order_id = resolve_added_id(
            update['sort-order-id'], state.last_added_sort_order_id, 'set-default-sort-order.sort-order-id');
        const sort_orders = ensure_array(metadata, 'sort-orders');
        if (!sort_orders.some(order => order && order['order-id'] === order_id)) {
            throw errors.invalid_request(`cannot set default sort order to unknown order ${order_id}`);
        }
        metadata['default-sort-order-id'] = order_id;
    },

    /**
     * Appends to `snapshots` and raises `last-sequence-number`. It touches neither
     * `current-snapshot-id`, `refs` nor `snapshot-log` - the accompanying
     * `set-snapshot-ref` on main is what moves the pointer (§8.1). Getting this wrong
     * produces a table whose current snapshot advances without a ref, which no client
     * agrees with.
     */
    'add-snapshot': (metadata, update, ctx, state) => {
        const snapshot = require_object(update.snapshot, 'add-snapshot.snapshot');
        const id = id_text(snapshot['snapshot-id'], 'snapshot.snapshot-id');
        if (id === undefined) throw errors.invalid_request('add-snapshot.snapshot requires a snapshot-id');
        safe_int(snapshot['timestamp-ms'], 'snapshot.timestamp-ms');
        const snapshots = ensure_array(metadata, 'snapshots');
        if (find_snapshot(metadata, id) !== undefined) {
            throw errors.invalid_request(`snapshot ${id} already exists in this table`);
        }
        const sequence_number = snapshot['sequence-number'] === undefined ?
            0 :
            safe_int(snapshot['sequence-number'], 'snapshot.sequence-number');
        const last_sequence_number = metadata['last-sequence-number'] === undefined ?
            0 :
            safe_int(metadata['last-sequence-number'], 'last-sequence-number');
        // A snapshot with a parent must advance the sequence number. v2 applies delete
        // files by sequence number, so a stale one silently changes query results. The
        // reference raises RetryableValidationException, which the REST server reports as
        // a commit failure: the client reloads and rebuilds the snapshot.
        const has_parent = id_text(snapshot['parent-snapshot-id'], 'snapshot.parent-snapshot-id') !== undefined;
        if (metadata['format-version'] !== 1 && has_parent && sequence_number <= last_sequence_number) {
            throw errors.commit_conflict(
                `snapshot sequence-number ${sequence_number} is not above last-sequence-number ${last_sequence_number}`);
        }
        metadata['last-sequence-number'] = Math.max(last_sequence_number, sequence_number);
        table_metadata.apply_row_lineage(metadata, snapshot, ctx);
        snapshots.push(snapshot);
        state.added_snapshot_ids.add(id);
    },

    /**
     * What actually moves the table, and only for `main`: it sets
     * `current-snapshot-id` - preserving the raw value byte for byte - and appends one
     * `snapshot-log` entry. A non-main ref touches neither.
     *
     * The log entry's time is the snapshot's own `timestamp-ms` only when this commit
     * added the snapshot. A rollback to an older one logs the commit time instead:
     * logging the old snapshot's time would put the log out of order, and a Java
     * client refuses to load such a document.
     */
    'set-snapshot-ref': (metadata, update, ctx, state) => {
        const ref_name = require_string(update['ref-name'], 'set-snapshot-ref.ref-name');
        const snapshot_id = update['snapshot-id'];
        const id = id_text(snapshot_id, 'set-snapshot-ref.snapshot-id');
        if (id === undefined) throw errors.invalid_request('set-snapshot-ref requires a snapshot-id');
        const type = update.type === undefined || update.type === null ? V2.BRANCH_REF : update.type;
        if (type !== V2.BRANCH_REF && type !== V2.TAG_REF) {
            throw errors.invalid_request(`set-snapshot-ref.type must be ${V2.BRANCH_REF} or ${V2.TAG_REF}`);
        }
        if (ref_name === V2.MAIN_BRANCH && type !== V2.BRANCH_REF) {
            throw errors.invalid_request(`cannot set ${V2.MAIN_BRANCH} to a tag, it must be a branch`);
        }
        const ref = { 'snapshot-id': snapshot_id, type };
        for (const field of ['min-snapshots-to-keep', 'max-snapshot-age-ms', 'max-ref-age-ms']) {
            if (update[field] !== undefined && update[field] !== null) ref[field] = update[field];
        }
        const refs = ensure_map(metadata, 'refs');
        const previous = Object.hasOwn(refs, ref_name) ? refs[ref_name] : undefined;
        // an identical ref is a no-op, as in TableMetadata.Builder.setRef
        if (previous && canonical_text(previous) === canonical_text(ref)) return;
        const snapshot = find_snapshot(metadata, id);
        if (snapshot === undefined) {
            throw errors.invalid_request(`cannot set ref ${ref_name} to unknown snapshot ${id}`);
        }
        refs[ref_name] = ref;
        if (ref_name !== V2.MAIN_BRANCH) return;
        metadata['current-snapshot-id'] = snapshot_id;
        const added = state.added_snapshot_ids.has(id);
        if (added) state.main_targets_added.push(id);
        ensure_array(metadata, 'snapshot-log').push({
            'timestamp-ms': added ? snapshot['timestamp-ms'] : state.now_ms,
            'snapshot-id': snapshot_id,
        });
    },

    /**
     * Ships now, not later: it is how engine-driven `expire_snapshots` works against
     * this catalog from day one (§8.1), and unbounded snapshot growth is what reaches
     * the 50 MB cap. Defined below - it is the one handler with cross-field
     * consequences.
     */
    'remove-snapshots': remove_snapshots,

    'remove-snapshot-ref': (metadata, update) => {
        const ref_name = require_string(update['ref-name'], 'remove-snapshot-ref.ref-name');
        const refs = ensure_map(metadata, 'refs');
        delete refs[ref_name];
        if (ref_name === V2.MAIN_BRANCH) metadata['current-snapshot-id'] = V2.NO_CURRENT_SNAPSHOT_ID;
    },

    /**
     * §6.4 rule 3 - the metadata document's own `location` is the storage root IRC
     * clients write under, so it never moves. Compared against the location the SDK
     * assigned, not against `metadata.location`, so a document whose location was
     * already tampered with cannot bless itself.
     */
    'set-location': (metadata, update, ctx) => {
        if (!table_metadata.location_matches_assigned(update.location, ctx)) {
            throw errors.invalid_request('set-location may only name the location assigned by the catalog');
        }
    },

    'set-properties': (metadata, update, ctx) => {
        const updates = require_object(update.updates, 'set-properties.updates');
        table_metadata.validate_table_properties(updates, ctx);
        Object.assign(ensure_map(metadata, 'properties'), updates);
    },

    'remove-properties': (metadata, update) => {
        const removals = require_array(update.removals, 'remove-properties.removals');
        const properties = ensure_map(metadata, 'properties');
        for (const key of removals) {
            delete properties[require_string(key, 'remove-properties.removals entry')];
        }
    },

    'set-statistics': (metadata, update) => {
        const statistics = require_object(update.statistics, 'set-statistics.statistics');
        const id = id_text(
            statistics['snapshot-id'] === undefined ? update['snapshot-id'] : statistics['snapshot-id'],
            'set-statistics.snapshot-id');
        if (id === undefined) throw errors.invalid_request('set-statistics requires a snapshot-id');
        const list = ensure_array(metadata, 'statistics');
        const index = list.findIndex(entry => id_text(entry && entry['snapshot-id']) === id);
        if (index >= 0) {
            list[index] = statistics;
        } else {
            list.push(statistics);
        }
    },

    'remove-statistics': (metadata, update) => {
        const id = id_text(update['snapshot-id'], 'remove-statistics.snapshot-id');
        if (id === undefined) throw errors.invalid_request('remove-statistics requires a snapshot-id');
        metadata.statistics = ensure_array(metadata, 'statistics')
            .filter(entry => id_text(entry && entry['snapshot-id']) !== id);
    },

    'set-partition-statistics': (metadata, update) => {
        const statistics = require_object(
            update['partition-statistics'], 'set-partition-statistics.partition-statistics');
        const id = id_text(statistics['snapshot-id'], 'set-partition-statistics.snapshot-id');
        if (id === undefined) throw errors.invalid_request('set-partition-statistics requires a snapshot-id');
        const list = ensure_array(metadata, 'partition-statistics');
        const index = list.findIndex(entry => id_text(entry && entry['snapshot-id']) === id);
        if (index >= 0) {
            list[index] = statistics;
        } else {
            list.push(statistics);
        }
    },

    'remove-partition-statistics': (metadata, update) => {
        const id = id_text(update['snapshot-id'], 'remove-partition-statistics.snapshot-id');
        if (id === undefined) {
            throw errors.invalid_request('remove-partition-statistics requires a snapshot-id');
        }
        metadata['partition-statistics'] = ensure_array(metadata, 'partition-statistics')
            .filter(entry => id_text(entry && entry['snapshot-id']) !== id);
    },

    'remove-schemas': (metadata, update) => {
        const ids = require_array(update['schema-ids'], 'remove-schemas.schema-ids');
        const remove = new Set(ids.map(id => safe_int(id, 'remove-schemas.schema-ids entry')));
        if (remove.has(metadata['current-schema-id'])) {
            throw errors.invalid_request('cannot remove the current schema');
        }
        metadata.schemas = ensure_array(metadata, 'schemas')
            .filter(schema => !remove.has(schema && schema['schema-id']));
    },

    'remove-partition-specs': (metadata, update) => {
        const ids = require_array(update['spec-ids'], 'remove-partition-specs.spec-ids');
        const remove = new Set(ids.map(id => safe_int(id, 'remove-partition-specs.spec-ids entry')));
        if (remove.has(metadata['default-spec-id'])) {
            throw errors.invalid_request('cannot remove the default partition spec');
        }
        metadata['partition-specs'] = ensure_array(metadata, 'partition-specs')
            .filter(spec => !remove.has(spec && spec['spec-id']));
    },

});

/**
 * Drop snapshots, and everything that pointed at them: their statistics and partition
 * statistics, every ref whose target is gone, and `current-snapshot-id` reset to -1
 * when main goes. The snapshot log is rewritten once, after all updates, by
 * {@link rewrite_snapshot_log}. Hoisted into the dispatch table above.
 * @param {any} metadata
 * @param {any} update
 * @param {CommitContext} ctx
 * @param {UpdateState} state
 */
function remove_snapshots(metadata, update, ctx, state) {
    const ids = require_array(update['snapshot-ids'], 'remove-snapshots.snapshot-ids');
    const remove = new Set(ids.map(id => id_text(id, 'remove-snapshots.snapshot-ids entry')));
    const removed = entry => remove.has(id_text(entry && entry['snapshot-id']));

    metadata.snapshots = ensure_array(metadata, 'snapshots').filter(snapshot => !removed(snapshot));
    for (const key of ['statistics', 'partition-statistics']) {
        if (Array.isArray(metadata[key])) metadata[key] = metadata[key].filter(entry => !removed(entry));
    }

    const kept = new Set(metadata.snapshots.map(snapshot => id_text(snapshot && snapshot['snapshot-id'])));
    const refs = ensure_map(metadata, 'refs');
    for (const [name, ref] of Object.entries(refs)) {
        if (kept.has(id_text(ref && ref['snapshot-id']))) continue;
        delete refs[name];
        if (name === V2.MAIN_BRANCH) metadata['current-snapshot-id'] = V2.NO_CURRENT_SNAPSHOT_ID;
    }
    state.removed_snapshots = true;
}

/**
 * TableMetadata.Builder's final snapshot-log pass, run once after all updates:
 *
 * - an entry for a snapshot this commit added to main and then moved main past is
 *   dropped - it was never the current snapshot;
 * - when the commit removed snapshots, an entry whose snapshot is gone clears all the
 *   history before it. Keeping [s1, s3] after s2 is removed would claim s1 was current
 *   up to s3, and time travel would read the wrong snapshot.
 *
 * Then the newest entry must be the current snapshot.
 * @param {any} metadata
 * @param {UpdateState} state
 */
function rewrite_snapshot_log(metadata, state) {
    const current = id_text(metadata['current-snapshot-id']);
    const intermediate = new Set(state.main_targets_added.filter(id => id !== current));
    if (intermediate.size === 0 && !state.removed_snapshots) return;

    const snapshots = Array.isArray(metadata.snapshots) ? metadata.snapshots : [];
    const kept = new Set(snapshots.map(snapshot => id_text(snapshot && snapshot['snapshot-id'])));
    let log = [];
    for (const entry of ensure_array(metadata, 'snapshot-log')) {
        const id = id_text(entry && entry['snapshot-id']);
        if (kept.has(id)) {
            if (!intermediate.has(id)) log.push(entry);
        } else if (state.removed_snapshots) {
            log = [];
        }
    }
    metadata['snapshot-log'] = log;

    if (kept.has(current) && log.length > 0 && id_text(log[log.length - 1]['snapshot-id']) !== current) {
        throw errors.invalid_request('the newest snapshot-log entry is not the current snapshot');
    }
}

/**
 * Apply every update a commit carries, in order, mutating `metadata` in place.
 * `last-updated-ms` is stamped exactly once at the end, matching
 * `TableMetadata.Builder.build()` and keeping §12 test 1's normalization small.
 *
 * @param {any} metadata
 * @param {any} updates
 * @param {CommitContext} ctx
 * @returns {any} metadata
 */
function apply_updates(metadata, updates, ctx) {
    if (metadata === null || metadata === undefined) {
        // the engine cannot create a table out of nothing - initial metadata is built
        // by build_initial_metadata, which the SDK calls on create_table (story 11)
        throw errors.invalid_request('cannot apply updates: the table does not exist');
    }
    require_array(updates, 'updates');
    const state = new_update_state(ctx);
    for (const update of updates) {
        require_object(update, 'update');
        const action = update.action;
        if (typeof action !== 'string' || action === '') {
            throw errors.invalid_request('every update must carry an action');
        }
        if (Object.hasOwn(REJECTED_ACTIONS, action)) {
            throw errors.unsupported_operation(`${action}: ${REJECTED_ACTIONS[action]}`);
        }
        if (!Object.hasOwn(UPDATE_HANDLERS, action)) {
            throw errors.unsupported_operation(`unknown update action: ${action}`);
        }
        UPDATE_HANDLERS[action](metadata, update, ctx, state);
    }
    rewrite_snapshot_log(metadata, state);
    metadata['last-updated-ms'] = state.now_ms;
    return metadata;
}

// ///////////////////////////////////////////////////////////////////////////////////
// transform
// ///////////////////////////////////////////////////////////////////////////////////

/**
 * @param {Buffer|Uint8Array|string} bytes
 * @returns {number}
 */
function byte_length(bytes) {
    if (typeof bytes === 'string') return Buffer.byteLength(bytes);
    return bytes.byteLength;
}

/**
 * @param {Buffer|Uint8Array|string} bytes
 * @returns {string}
 */
function to_text(bytes) {
    if (typeof bytes === 'string') return bytes;
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf8');
}

/**
 * The complete bytes-to-bytes path. It lives here rather than in the worker, which
 * makes story 9's `commit_worker.js` a message pump and its acceptance criterion
 * "worker output is identical to running the engine directly" true by construction.
 *
 * @param {{
 *      metadata_bytes: Buffer|Uint8Array|string,
 *      commit_bytes: Buffer|Uint8Array|string,
 *      ctx: CommitContext,
 * }} params
 * @returns {{ next_bytes: Buffer, header: { version: number, location: any, table_uuid: any } }}
 */
function transform({ metadata_bytes, commit_bytes, ctx }) {
    table_metadata.assert_ctx(ctx);
    // Without it the metadata log silently stays as it was, and an empty log is what
    // §6.1.4 reads as a table's first commit. A caller bug, not a client error.
    if (typeof ctx.previous_metadata_location !== 'string' || ctx.previous_metadata_location === '') {
        throw new TypeError('transform requires ctx.previous_metadata_location');
    }
    const previous_bytes = byte_length(metadata_bytes);
    table_metadata.assert_document_size(previous_bytes, ctx);

    let commit;
    try {
        commit = lossless_json.parse(to_text(commit_bytes));
    } catch (err) {
        throw errors.invalid_request(`the commit request is not valid JSON: ${err.message}`);
    }
    require_object(commit, 'commit request');

    let metadata;
    try {
        metadata = lossless_json.parse(to_text(metadata_bytes));
    } catch (err) {
        throw errors.metadata_integrity(`the current table metadata is not valid JSON: ${err.message}`);
    }
    require_object(metadata, 'table metadata');

    // captured before apply_updates stamps a new one - the metadata-log entry records
    // the previous document's own timestamp, not the clock
    const previous_last_updated_ms = metadata['last-updated-ms'];

    check_requirements(metadata, commit.requirements);
    apply_updates(metadata, commit.updates, ctx);
    table_metadata.append_metadata_log(metadata, ctx.previous_metadata_location, previous_last_updated_ms);
    table_metadata.assert_log_order(metadata);

    const next_bytes = Buffer.from(lossless_json.stringify(metadata), 'utf8');
    table_metadata.assert_document_size(next_bytes.byteLength, ctx, { previous_bytes });

    return {
        next_bytes,
        header: {
            // §3.3 - the new file's five-digit version is the previous file's plus one
            version: table_metadata.next_metadata_version(ctx.previous_metadata_location),
            location: metadata.location,
            table_uuid: metadata['table-uuid'],
        },
    };
}

// EXPORTS
exports.check_requirements = check_requirements;
exports.apply_updates = apply_updates;
exports.transform = transform;
exports.REQUIREMENT_CHECKS = REQUIREMENT_CHECKS;
exports.UPDATE_HANDLERS = UPDATE_HANDLERS;
exports.REJECTED_ACTIONS = REJECTED_ACTIONS;
