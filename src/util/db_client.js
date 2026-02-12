/* Copyright (C) 2016 NooBaa */
/** @typedef {typeof import('../sdk/nb')} nb */
'use strict';

const mongodb = require('mongodb');
const { EventEmitter } = require('events');

const dbg = require('./debug_module')(__filename);
const config = require('../../config');
const postgres_client = require('./postgres_client');

/**
 * A simple noop db client for cases where we run without a DB.
 * @implements {nb.DBClient}
 */
class NoneDBClient extends EventEmitter {
    /** @returns {any} */ noop() { return undefined; }
    /** @returns {any} */ noop_obj() { return {}; }
    operators = new Set();
    async connect(skip_init_db) { return this.noop(); }
    async reconnect() { return this.noop(); }
    async disconnect() { return this.noop(); }
    async dropDatabase() { return this.noop(); }
    async createDatabase() { return this.noop(); }
    async get_db_stats() { return { fsUsedSize: 0, fsTotalSize: 0 }; }
    set_db_name(name) { return this.noop(); }
    get_db_name() { return 'none'; }
    is_connected() { return false; }
    define_collection(params) { return this.noop_obj(); }
    define_sequence(params) { return this.noop_obj(); }
    collection(name) { return this.noop_obj(); }
    validate(name, doc, warn) { return this.noop(); }
    obj_ids_difference(base, values) { return this.noop(); }
    uniq_ids(docs, doc_path) { return this.noop(); }
    async populate(docs, doc_path, collection, fields) { return this.noop(); }
    resolve_object_ids_recursive(idmap, item) { return this.noop(); }
    resolve_object_ids_paths(idmap, item, paths, allow_missing) { return this.noop(); }
    new_object_id() { return new mongodb.ObjectId(); }
    parse_object_id(id_str) { return new mongodb.ObjectId(String(id_str || undefined)); }
    fix_id_type(doc) { return doc; }
    is_object_id(id) { return false; }
    is_err_duplicate_key(err) { return false; }
    is_err_namespace_exists(err) { return false; }
    check_duplicate_key_conflict(err, entity) { return this.noop(); }
    check_entity_not_found(doc, entity) { return doc; }
    check_entity_not_deleted(doc, entity) { return doc; }
    check_update_one(res, entity) { return this.noop(); }
    make_object_diff(current, prev) { return this.noop(); }
    define_gridfs(params) {
        return {
            gridfs() { return this.noop(); }
        };
    }
}

const none_db_client = new NoneDBClient();

/**
 * @returns { nb.DBClient }
 */
function instance() {
    switch (config.DB_TYPE) {
        case 'postgres':
            return postgres_client.instance();
        case 'none':
            return none_db_client;
        default: {
            const str = `NON SUPPORTED DB_TYPE ${config.DB_TYPE}`;
            dbg.error(str);
            throw new Error(str);
        }
    }
}

// EXPORTS
exports.instance = instance;
