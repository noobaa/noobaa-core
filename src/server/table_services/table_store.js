/* Copyright (C) 2026 NooBaa */
'use strict';

/**
 * table_store - the holder for the S3 Tables catalog collections, defined the way
 * md_store defines its own (design §3.4, §5). It is a holder for collection handles and
 * plain CRUD over them, not a cross-deployment abstraction - the point where persistence
 * varies by deployment is BucketSpace (§3.1).
 *
 * Instantiating it runs define_collection() for the three collections, which runs
 * CREATE TABLE IF NOT EXISTS plus the index DDL on connect. So it is instantiated only in
 * the process that serves the `md` domain, and only when config.S3_TABLES_ENABLED is set
 * (table_server is registered under the flag), so the collections are never created on a
 * system that has never enabled the feature (§3.7).
 *
 * Story 6a implements plain CRUD and the (transaction-free) conditional pointer swap.
 * Story 6b wraps the parent/child operations in PgTransaction with row locks and adds the
 * unknown-outcome distinction on the swap.
 */

const mongodb = require('mongodb');

const dbg = require('../../util/debug_module')(__filename);
const db_client = require('../../util/db_client');
const { RpcError } = require('../../rpc');

const table_bucket_schema = require('./schemas/table_bucket_schema');
const table_bucket_indexes = require('./schemas/table_bucket_indexes');
const table_namespace_schema = require('./schemas/table_namespace_schema');
const table_namespace_indexes = require('./schemas/table_namespace_indexes');
const table_pointer_schema = require('./schemas/table_pointer_schema');
const table_pointer_indexes = require('./schemas/table_pointer_indexes');

// The outcomes of the pointer swap. Every BucketSpace implementation must distinguish
// them because §7.2 maps them to different status codes (§6.3).
const SWAP_OUTCOME = Object.freeze({
    SWAPPED: 'swapped',
    NOT_SWAPPED: 'not_swapped',
    NO_SUCH_TABLE: 'no_such_table',
});

class TableStore {

    constructor(test_suffix = '') {
        this._test_suffix = test_suffix;
        // served on the `md` domain, so it shares md_store's connection pool (§3.4)
        this._postgres_pool = 'md';

        this._table_buckets = db_client.instance().define_collection({
            name: 'table_buckets' + test_suffix,
            schema: table_bucket_schema,
            db_indexes: table_bucket_indexes,
            postgres_pool: this._postgres_pool,
        });
        this._table_namespaces = db_client.instance().define_collection({
            name: 'table_namespaces' + test_suffix,
            schema: table_namespace_schema,
            db_indexes: table_namespace_indexes,
            postgres_pool: this._postgres_pool,
        });
        this._table_pointers = db_client.instance().define_collection({
            name: 'table_pointers' + test_suffix,
            schema: table_pointer_schema,
            db_indexes: table_pointer_indexes,
            postgres_pool: this._postgres_pool,
        });
    }

    /**
     * @returns {TableStore}
     */
    static instance() {
        if (!TableStore._instance) TableStore._instance = new TableStore();
        return TableStore._instance;
    }

    make_table_id(id_str) {
        return new mongodb.ObjectId(id_str);
    }

    new_table_id() {
        return new mongodb.ObjectId();
    }

    /////////////////////
    //  TABLE BUCKETS  //
    /////////////////////

    async insert_table_bucket(info) {
        this._table_buckets.validate(info);
        try {
            await this._table_buckets.insertOne(info);
        } catch (err) {
            this._throw_on_duplicate(err, 'table bucket');
        }
        return info;
    }

    async get_table_bucket_by_id(id) {
        return this._table_buckets.findOne({ _id: id, deleted: null });
    }

    async get_table_bucket_by_name(system, name) {
        return this._table_buckets.findOne({ system, name, deleted: null });
    }

    async list_table_buckets({ system, owner, state, limit, marker }) {
        const query = { system, deleted: null };
        if (owner) query.owner = owner;
        if (state) query.state = state;
        return this._find_page(this._table_buckets, query, marker, limit);
    }

    /**
     * Plain field update, optionally conditional on the current state - the base for the
     * table-bucket state transitions (§6.1.3). Story 6b takes the conditional transitions
     * (provisioning -> ready / aborting, ready -> deleting) and runs the ready -> deleting
     * one inside the FOR UPDATE transaction that counts namespaces (§6.1.2).
     * @returns {Promise<number>} the matched-row count (0 or 1)
     */
    async update_table_bucket(id, set_updates, { expected_state } = {}) {
        const selector = { _id: id, deleted: null };
        if (expected_state) selector.state = expected_state;
        const res = await this._table_buckets.updateOne(selector, { $set: set_updates });
        return res.rowCount;
    }

    /**
     * Soft-delete, optionally conditional on the current state.
     * @returns {Promise<number>} the matched-row count (0 or 1)
     */
    async delete_table_bucket(id, { expected_state } = {}) {
        const selector = { _id: id, deleted: null };
        if (expected_state) selector.state = expected_state;
        const res = await this._table_buckets.updateOne(selector, { $set: { deleted: new Date() } });
        return res.rowCount;
    }

    /////////////////////
    //    NAMESPACES   //
    /////////////////////

    async insert_table_namespace(info) {
        this._table_namespaces.validate(info);
        try {
            await this._table_namespaces.insertOne(info);
        } catch (err) {
            this._throw_on_duplicate(err, 'namespace');
        }
        return info;
    }

    async get_table_namespace(table_bucket, name) {
        return this._table_namespaces.findOne({ table_bucket, name, deleted: null });
    }

    async list_table_namespaces({ table_bucket, limit, marker }) {
        const query = { table_bucket, deleted: null };
        return this._find_page(this._table_namespaces, query, marker, limit);
    }

    async update_table_namespace(table_bucket, name, set_updates) {
        const res = await this._table_namespaces.updateOne(
            { table_bucket, name, deleted: null },
            { $set: set_updates },
        );
        return res.rowCount;
    }

    async delete_table_namespace(table_bucket, name) {
        const res = await this._table_namespaces.updateOne(
            { table_bucket, name, deleted: null },
            { $set: { deleted: new Date() } },
        );
        return res.rowCount;
    }

    /**
     * Count live tables in a namespace - used by delete_namespace (§6.1.2). Story 6b runs
     * this inside the FOR UPDATE transaction so the count cannot go stale.
     */
    async count_namespace_tables(table_bucket, namespace_name) {
        return this._table_pointers.countDocuments({ table_bucket, namespace_name, deleted: null });
    }

    /**
     * Count live namespaces in a table bucket - used by delete_table_bucket (§6.1.2).
     */
    async count_table_bucket_namespaces(table_bucket) {
        return this._table_namespaces.countDocuments({ table_bucket, deleted: null });
    }

    /////////////////////
    //     TABLES      //
    /////////////////////

    async insert_table_pointer(info) {
        this._table_pointers.validate(info);
        try {
            await this._table_pointers.insertOne(info);
        } catch (err) {
            this._throw_on_duplicate(err, 'table');
        }
        return info;
    }

    async get_table_pointer(table_bucket, namespace_name, name) {
        return this._table_pointers.findOne({ table_bucket, namespace_name, name, deleted: null });
    }

    async get_table_pointer_by_id(id) {
        return this._table_pointers.findOne({ _id: id, deleted: null });
    }

    async list_table_pointers({ table_bucket, namespace_name, limit, marker }) {
        const query = { table_bucket, namespace_name, deleted: null };
        return this._find_page(this._table_pointers, query, marker, limit);
    }

    /**
     * Move a pointer to a new namespace and/or name, conditional on it still carrying the
     * resolved namespace_name and name (§6.1.2) - so a pointer moved by a concurrent
     * rename is reported missing rather than written to. Story 6b runs the cross-namespace
     * case inside the FOR SHARE transaction that locks the target namespace.
     * @returns {Promise<number>} the matched-row count (0 or 1)
     */
    async rename_table_pointer(id, { namespace_name, name }, { new_namespace_name, new_name }) {
        const set_updates = {};
        if (new_namespace_name !== undefined) set_updates.namespace_name = new_namespace_name;
        if (new_name !== undefined) set_updates.name = new_name;
        try {
            const res = await this._table_pointers.updateOne(
                { _id: id, namespace_name, name, deleted: null },
                { $set: set_updates },
            );
            return res.rowCount;
        } catch (err) {
            this._throw_on_duplicate(err, 'table');
        }
    }

    /**
     * Remove a pointer, conditional on it still carrying the resolved namespace_name and
     * name, and optionally on a version token (§6.1.2, §6.1.5).
     * @returns {Promise<number>} the matched-row count (0 or 1)
     */
    async delete_table_pointer(id, { namespace_name, name, expected_version_token } = {}) {
        const selector = { _id: id, deleted: null };
        if (namespace_name !== undefined) selector.namespace_name = namespace_name;
        if (name !== undefined) selector.name = name;
        if (expected_version_token !== undefined) selector.version_token = expected_version_token;
        const res = await this._table_pointers.updateOne(selector, { $set: { deleted: new Date() } });
        return res.rowCount;
    }

    /**
     * The atomic pointer swap (§3.4, §6.3): a conditional update on table id and expected
     * version token, writing the new metadata location and its ETag and issuing a fresh
     * token on success. On the first commit of an uninitialized pointer it also stores the
     * table uuid.
     *
     * Returns swapped / not_swapped / no_such_table. The conditional update alone cannot
     * tell the last two apart - a stale token and a deleted row both match zero rows - so
     * on rowCount === 0 we read the record by id: absent or deleted -> no_such_table,
     * otherwise -> not_swapped. No transaction is needed (§6.3).
     *
     * Story 6b adds the fourth, distinct outcome §7.2 requires: a statement timeout after
     * the update was issued is genuinely unobserved and must surface as 500, never be
     * collapsed into not_swapped.
     *
     * @returns {Promise<{outcome: string, version_token?: string}>}
     */
    async swap_table_pointer(id, expected_version_token, { metadata_location, metadata_etag, table_uuid }, new_version_token) {
        const set_updates = { version_token: new_version_token };
        if (metadata_location !== undefined) set_updates.metadata_location = metadata_location;
        if (metadata_etag !== undefined) set_updates.metadata_etag = metadata_etag;
        if (table_uuid !== undefined) set_updates.table_uuid = table_uuid;

        const res = await this._table_pointers.updateOne(
            { _id: id, version_token: expected_version_token, deleted: null },
            { $set: set_updates },
        );
        if (res.rowCount === 1) {
            return { outcome: SWAP_OUTCOME.SWAPPED, version_token: new_version_token };
        }
        // zero rows: a stale token or a deleted/missing row - resolve by a fresh read
        const doc = await this._table_pointers.findOne({ _id: id });
        if (!doc || doc.deleted) return { outcome: SWAP_OUTCOME.NO_SUCH_TABLE };
        return { outcome: SWAP_OUTCOME.NOT_SWAPPED };
    }

    /////////////////////
    //     HELPERS     //
    /////////////////////

    /**
     * Keyset pagination by _id - the primary key always has an index. `marker` is the last
     * _id returned by the previous page.
     */
    async _find_page(collection, query, marker, limit) {
        const q = { ...query };
        if (marker) q._id = { $gt: this.make_table_id(marker) };
        const page_limit = Math.max(1, Math.min(Number(limit) || 1000, 1000));
        const docs = await collection.find(q, { sort: { _id: 1 }, limit: page_limit });
        const next_marker = docs.length === page_limit ? String(docs[docs.length - 1]._id) : undefined;
        return { docs, next_marker };
    }

    _throw_on_duplicate(err, entity) {
        if (db_client.instance().is_err_duplicate_key(err)) {
            throw new RpcError('CONFLICT', entity + ' already exists');
        }
        dbg.error('table_store op failed', entity, err);
        throw err;
    }
}

TableStore.SWAP_OUTCOME = SWAP_OUTCOME;

// EXPORTS
exports.TableStore = TableStore;
exports.SWAP_OUTCOME = SWAP_OUTCOME;
