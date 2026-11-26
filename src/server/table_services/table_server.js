/* Copyright (C) 2026 NooBaa */
'use strict';

/**
 * table_server - the RPC service implementing table_api (design §3.4, §6.3). It is
 * registered beside the object services, from the single helper that both
 * md_server.register_rpc() (endpoint) and web_server (core) call, and only when
 * config.S3_TABLES_ENABLED is set. So the service - and the table_store collections it
 * instantiates - exist exactly in the process that serves the `md` domain, and only on a
 * system that has enabled the feature (§3.7).
 *
 * Story 6a: plain CRUD over the three collections, the table-bucket state transitions, and
 * the transaction-free conditional pointer swap. Story 6b wraps the parent/child
 * operations in PgTransaction with row locks (§6.1.2) and adds the unknown-outcome
 * distinction on the swap (§6.3).
 */

const crypto = require('crypto');

const dbg = require('../../util/debug_module')(__filename);
const { TableStore } = require('./table_store');

// Instantiate at require time, not lazily, so the collections are defined the moment the
// service is registered (design §3.4, §5). register_object_services requires this module
// only under the feature flag, so with the feature on every fork runs the collection DDL at
// startup - which is exactly what test 17's racing-forks convergence exercises - and with
// the feature off the module is never required, so the collections are never created (§3.7).
const table_store = TableStore.instance();

function store() {
    return table_store;
}

function new_version_token() {
    return crypto.randomUUID();
}

//////////////////////
//   TABLE BUCKETS  //
//////////////////////

async function create_table_bucket(req) {
    const p = req.rpc_params;
    const info = {
        _id: store().new_table_id(),
        system: req.system._id,
        name: p.name,
        owner: p.owner || req.account._id,
        backing_bucket_name: p.backing_bucket_name,
        state: p.state,
        created_at: Date.now(),
    };
    if (p.backing_bucket) info.backing_bucket = p.backing_bucket;
    if (p.encryption) info.encryption = p.encryption;
    dbg.log1('create_table_bucket', info.name, info.state);
    return store().insert_table_bucket(info);
}

async function get_table_bucket(req) {
    const p = req.rpc_params;
    const table_bucket = p.table_bucket_id ?
        await store().get_table_bucket_by_id(p.table_bucket_id) :
        await store().get_table_bucket_by_name(req.system._id, p.name);
    return table_bucket ? { table_bucket } : {};
}

async function list_table_buckets(req) {
    const p = req.rpc_params;
    const { docs, next_marker } = await store().list_table_buckets({
        system: req.system._id,
        owner: p.owner,
        state: p.state,
        limit: p.limit,
        marker: p.marker,
    });
    return { table_buckets: docs, next_marker };
}

async function update_table_bucket(req) {
    const p = req.rpc_params;
    const set_updates = {};
    if (p.state) set_updates.state = p.state;
    if (p.backing_bucket) set_updates.backing_bucket = p.backing_bucket;
    if (p.encryption) set_updates.encryption = p.encryption;
    const matched = await store().update_table_bucket(p.table_bucket_id, set_updates,
        { expected_state: p.expected_state });
    return { matched: matched === 1 };
}

async function delete_table_bucket(req) {
    const p = req.rpc_params;
    const matched = await store().delete_table_bucket(p.table_bucket_id,
        { expected_state: p.expected_state });
    return { matched: matched === 1 };
}

//////////////////////
//    NAMESPACES    //
//////////////////////

async function create_table_namespace(req) {
    const p = req.rpc_params;
    const info = {
        _id: store().new_table_id(),
        table_bucket: p.table_bucket_id,
        name: p.name,
        created_at: Date.now(),
    };
    if (p.properties) info.properties = p.properties;
    dbg.log1('create_table_namespace', String(p.table_bucket_id), info.name);
    return store().insert_table_namespace(info);
}

async function get_table_namespace(req) {
    const p = req.rpc_params;
    const namespace = await store().get_table_namespace(p.table_bucket_id, p.name);
    return namespace ? { namespace } : {};
}

async function list_table_namespaces(req) {
    const p = req.rpc_params;
    const { docs, next_marker } = await store().list_table_namespaces({
        table_bucket: p.table_bucket_id,
        limit: p.limit,
        marker: p.marker,
    });
    return { namespaces: docs, next_marker };
}

async function update_table_namespace(req) {
    const p = req.rpc_params;
    const matched = await store().update_table_namespace(p.table_bucket_id, p.name,
        { properties: p.properties });
    return { matched: matched === 1 };
}

async function delete_table_namespace(req) {
    const p = req.rpc_params;
    const matched = await store().delete_table_namespace(p.table_bucket_id, p.name);
    return { matched: matched === 1 };
}

//////////////////////
//      TABLES      //
//////////////////////

async function create_table(req) {
    const p = req.rpc_params;
    const info = {
        _id: store().new_table_id(),
        table_bucket: p.table_bucket_id,
        namespace_name: p.namespace_name,
        name: p.name,
        version_token: p.version_token || new_version_token(),
        kind: p.kind || 'table',
        created_at: Date.now(),
    };
    // an uninitialized pointer omits metadata_location, metadata_etag and table_uuid (§6.1.3)
    if (p.metadata_location !== undefined) info.metadata_location = p.metadata_location;
    if (p.metadata_etag !== undefined) info.metadata_etag = p.metadata_etag;
    if (p.table_uuid !== undefined) info.table_uuid = p.table_uuid;
    dbg.log1('create_table', String(p.table_bucket_id), p.namespace_name, info.name);
    return store().insert_table_pointer(info);
}

async function get_table(req) {
    const p = req.rpc_params;
    const table = p.table_id ?
        await store().get_table_pointer_by_id(p.table_id) :
        await store().get_table_pointer(p.table_bucket_id, p.namespace_name, p.name);
    return table ? { table } : {};
}

async function list_tables(req) {
    const p = req.rpc_params;
    const { docs, next_marker } = await store().list_table_pointers({
        table_bucket: p.table_bucket_id,
        namespace_name: p.namespace_name,
        limit: p.limit,
        marker: p.marker,
    });
    return { tables: docs, next_marker };
}

async function rename_table(req) {
    const p = req.rpc_params;
    const matched = await store().rename_table_pointer(
        p.table_id,
        { namespace_name: p.namespace_name, name: p.name },
        { new_namespace_name: p.new_namespace_name, new_name: p.new_name },
    );
    return { matched: matched === 1 };
}

async function delete_table(req) {
    const p = req.rpc_params;
    const matched = await store().delete_table_pointer(p.table_id, {
        namespace_name: p.namespace_name,
        name: p.name,
        expected_version_token: p.expected_version_token,
    });
    return { matched: matched === 1 };
}

async function update_table_metadata_location(req) {
    const p = req.rpc_params;
    return store().swap_table_pointer(
        p.table_id,
        p.expected_version_token,
        {
            metadata_location: p.metadata_location,
            metadata_etag: p.metadata_etag,
            table_uuid: p.table_uuid,
        },
        p.new_version_token,
    );
}

// EXPORTS
exports.create_table_bucket = create_table_bucket;
exports.get_table_bucket = get_table_bucket;
exports.list_table_buckets = list_table_buckets;
exports.update_table_bucket = update_table_bucket;
exports.delete_table_bucket = delete_table_bucket;

exports.create_table_namespace = create_table_namespace;
exports.get_table_namespace = get_table_namespace;
exports.list_table_namespaces = list_table_namespaces;
exports.update_table_namespace = update_table_namespace;
exports.delete_table_namespace = delete_table_namespace;

exports.create_table = create_table;
exports.get_table = get_table;
exports.list_tables = list_tables;
exports.rename_table = rename_table;
exports.delete_table = delete_table;
exports.update_table_metadata_location = update_table_metadata_location;
