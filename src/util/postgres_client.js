/* Copyright (C) 2016 NooBaa */
/*eslint no-use-before-define: ["error", { "classes": false }]*/
'use strict';

const _ = require('lodash');
require('../util/fips');

const assert = require('assert');
const { default: Ajv } = require('ajv');
const crypto = require('crypto');
const util = require('util');
const EventEmitter = require('events').EventEmitter;
const { Pool, Client } = require('pg');
const { MongoSequence } = require('./mongo_client');

const P = require('./promise');
const dbg = require('./debug_module')(__filename);
const common_api = require('../api/common_api');
const schema_utils = require('./schema_utils');
const schema_keywords = require('./schema_keywords');
const mongodb = require('mongodb');
const mongo_to_pg = require('mongo-query-to-postgres-jsonb');
const fs = require('fs');
// TODO: Shouldn't be like that, we shouldn't use MongoDB functions to compare
const mongo_functions = require('./mongo_functions');
const { RpcError } = require('../rpc');
const SensitiveString = require('./sensitive_string');
const time_utils = require('./time_utils');
const config = require('../../config');

mongodb.Binary.prototype[util.inspect.custom] = function custom_inspect_binary() {
    return `<mongodb.Binary ${this.buffer.toString('base64')} >`;
};


const COMPARISON_OPS = [
    '$eq',
    '$ne',
    '$gt',
    '$gte',
    '$lt',
    '$lte',
];


// temporary solution for encode\decode
// perfrom encode\decode json for every query to\from the DB
// TODO: eventually we want to perform this using the ajv process
// in schema_utils - handle 
function decode_json(schema, val) {
    if (!schema) {
        return val;
    }
    if (schema.objectid === true) {
        return new mongodb.ObjectId(val);
    }
    if (schema.date === true) {
        return new Date(val);
    }

    if (schema.binary) {
        return Buffer.from(val, 'base64');
    }

    if (schema.type === 'object') {
        const obj = {};
        for (const key of Object.keys(val)) {
            obj[key] = decode_json(schema.properties && schema.properties[key], val[key]);
        }
        return obj;
    }

    if (schema.type === 'array') {
        const item_schema = schema.items;
        const arr = [];
        for (const item of val) {
            arr.push(decode_json(item_schema, item));
        }
        return arr;
    }

    if (schema.wrapper && schema.wrapper === SensitiveString) {
        return new SensitiveString(val).unwrap();
    }

    return val;
}

// convert certain types to a known representation 
function encode_json(schema, val) {
    if (!val || !schema) {
        return val;
    }
    // eslint-disable-next-line no-use-before-define
    const ops = handle_ops_encoding(schema, val);
    if (ops) return ops;

    if (schema.objectid === true && val instanceof mongodb.ObjectID) {
        return val.toString();
    }

    if (schema.binary === true) {
        // assuming val is of type Buffer. convert to base64 string
        return val.toString('base64');
    }

    if (schema.type === 'object') {
        const obj = {};
        for (const key of Object.keys(val)) {
            obj[key] = encode_json(schema.properties && schema.properties[key], val[key]);
        }
        return obj;
    }

    if (schema.type === 'array') {
        const item_schema = schema.items;
        // specific case for handling find in array with no $find op
        if (!Array.isArray(val)) {
            return encode_json(item_schema, val);
        }

        const arr = [];
        for (const item of val) {
            arr.push(encode_json(item_schema, item));
        }
        return arr;
    }

    return val;
}

function handle_ops_encoding(schema, val) {

    if (!val) return;

    let obj = {};

    // handle $all
    if (val.$all) {
        obj.$all = [];
        for (const item of val.$all) {
            obj.$all.push(encode_json(schema, item));
        }
    }

    // handle $in
    if (val.$in) {
        obj.$in = [];
        for (const item of val.$in) {
            obj.$in.push(encode_json(schema, item));
        }
    }

    // handle $push
    if (val.$push) {
        obj.$push = {};
        for (const key of Object.keys(val.$push)) {
            obj.$push[key] = encode_json(schema.items, val.$push[key]);
        }
    }
    // handle $set
    if (val.$set) {
        obj.$set = {};
        for (const key of Object.keys(val.$set)) {
            obj.$set[key] = encode_json(schema.properties && schema.properties[key], val.$set[key]);
        }
    }

    // for simple comparison ops encode the operand
    for (const op of COMPARISON_OPS) {
        if (val[op]) {
            obj[op] = encode_json(schema, val[op]);
        }
    }

    // fill in with the rest of the keys
    if (Object.keys(obj).length > 0) {
        return { ...val, ...obj };
    }
}

let query_counter = 0;

async function log_query(pg_client, query, tag, millitook, should_explain) {
    const log_obj = {
        tag,
        took: millitook.toFixed(1) + 'ms',
        query,
        clients_pool: { total: pg_client.totalCount, waiting: pg_client.waitingCount, idle: pg_client.idleCount },
        stack: (new Error()).stack.split('\n').slice(1),
    };

    if (should_explain && process.env.PG_EXPLAIN_QUERIES === 'true') {
        let explain_res;
        const explain_q = { text: 'explain ' + query.text, values: query.values };
        try {
            explain_res = await pg_client.query(explain_q);
            log_obj.explain = explain_res.rows;
        } catch (err) {
            console.error('got error on explain', explain_q, err);
        }
    }

    if (millitook > config.LONG_DB_QUERY_THRESHOLD) {
        dbg.warn(`QUERY_LOG: LONG QUERY (OVER ${config.LONG_DB_QUERY_THRESHOLD} ms `, JSON.stringify(log_obj));
    } else {
        dbg.log0('QUERY_LOG:', JSON.stringify(log_obj));
    }
}

function convert_sort(sort) {
    return mongo_to_pg.convertSort('data', sort)
        // fix all json columns refs to text references (->> instead of ->) refer
        .replace("data->'_id'", "data->>'_id'")
        .replace("data->'bucket'", "data->>'bucket'")
        .replace("data->'key'", "data->>'key'")
        .replace("data->'version_past'", "data->>'version_past'")
        // remove NULLS LAST or NULLS FIRST
        .replace(/ NULLS LAST| NULLS FIRST/g, "");
}

// temporary solution in oredr to make md-aggregator map-reduce queries to hit the index
// will use a sql function to convert between the two and we will changes values range to ::timestamp instead of ::jsonb
function convert_timestamps(where_clause) {
    if (where_clause.includes('data->\'deleted\'')) {
        where_clause = where_clause.replace(/data->'deleted'/g, 'to_ts(data->>\'deleted\')');
        where_clause += ' AND data ? \'deleted\'::text';
    }
    if (where_clause.includes('data->\'create_time\'')) {
        where_clause = where_clause.replace(/data->'create_time'/g, 'to_ts(data->>\'create_time\')');
        where_clause += ' AND data ? \'create_time\'::text';
    }
    const ts_regex = /\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z)/g;
    const timestamps = where_clause.match(ts_regex) || [];
    for (const ts of timestamps) {
        where_clause = where_clause.replace(ts + '"\'::jsonb', ts + '"\'::timestamp');
    }
    return where_clause;
}


async function _do_query(pg_client, q, transaction_counter) {
    query_counter += 1;
    const tag = `T${_.padStart(transaction_counter, 8, '0')}|Q${_.padStart(query_counter.toString(), 8, '0')}`;
    try {
        // dbg.log0(`postgres_client: ${tag}: ${q.text}`, util.inspect(q.values, { depth: 6 }));
        const millistart = time_utils.millistamp();
        const res = await pg_client.query(q);
        const milliend = time_utils.millistamp();
        const millitook = milliend - millistart;
        if (process.env.PG_ENABLE_QUERY_LOG === 'true' || millitook > config.LONG_DB_QUERY_THRESHOLD) {
            // noticed that some failures in explain are invalidating the transaction. 
            // myabe did something wrong but for now don't try to EXPLAIN the query when in transaction. 
            await log_query(pg_client, q, tag, millitook, /*should_explain*/ transaction_counter === 0);
        }
        return res;
    } catch (err) {
        if (err.routine === 'index_create' && err.code === '42P07') return;
        dbg.error(`postgres_client: ${tag}: failed with error:`, err);
        throw err;
    }
}

function get_id(data) {
    if (!data || !data._id) {
        throw new Error('data does not contain _id field');
    }
    return data._id;
}

function not_implemented() {
    throw new Error('NOT IMPLEMENTED');
}


let trans_counter = 1;

// builds postgres query for special case of $set with .$.
// other cases are not yet supported
function buildPostgresArrayQuery(table_name, update, find) {
    let arr_to_update;
    let latest_set;
    _.map(Object.keys(update), to_set => {

        let arr_and_property = to_set.split('.$.');
        if (arr_and_property.length > 1) {
            arr_to_update = arr_and_property[0];
            latest_set = `jsonb_set(${latest_set || 'data'}, array['${arr_to_update}', elem_index::text,` +
                ` '${arr_and_property[1]}'], '${JSON.stringify(update[to_set])}'::jsonb, true)`;
        } else {
            latest_set = `jsonb_set(${latest_set || 'data'}, '{${to_set}}', '${JSON.stringify(update[to_set])}'::jsonb)`;
        }
    });

    let [array_where, column_where] = ['', ''];
    _.map(Object.keys(find), key => {
        const find_in_array = arr_to_update && key.includes(arr_to_update);
        const prefix = find_in_array ? 'elem->>\'' + key.split('.')[1] + '\'' : key;
        const suffix = prefix + '=\'' + find[key].toString() + '\' and ';
        array_where += suffix;
        column_where += find_in_array ? '' : suffix;

    });
    array_where = array_where.substr(0, array_where.length - 4);
    column_where = column_where.substr(0, column_where.length - 4);

    // find index of item to set in array
    const from = (arr_to_update && `FROM (SELECT pos- 1 as elem_index FROM ${table_name}, jsonb_array_elements(data->'${arr_to_update}')` +
        ` with ordinality arr(elem, pos) WHERE ${array_where} ) SUB`) || '';

    const query = `UPDATE ${table_name} SET data = ${latest_set} ${from} WHERE ${column_where}`;
    return query;
}

function convert_array_query(table_name, encoded_update, encoded_find) {
    let query;
    // translation of '.$.' is currently supported for findAndUpdateOne and more specifcally to $set operations. 
    const update_keys = encoded_update.$set && Object.keys(encoded_update.$set).filter(key => key.includes('.$.'));
    if (update_keys && update_keys.length) {
        query = buildPostgresArrayQuery(table_name, encoded_update.$set, encoded_find);
    }
    return query;
}
class PgTransaction {

    constructor(client) {
        this.transaction_id = trans_counter;
        trans_counter += 1;
        this.client = client;
    }

    async begin() {
        this.pg_client = await this.client.pool.connect();
        this.pg_client.once('error', err => {
            dbg.error('got error on pg_transaction', err, this.transaction_id);
        });
        await _do_query(this.pg_client, { text: 'BEGIN TRANSACTION' }, this.transaction_id);
    }

    async query(text, values) {
        if (!this.pg_client) {
            throw new Error('this.begin() must be called before sending queries on this transaction');
        }
        return _do_query(this.pg_client, { text, values }, this.transaction_id);
    }

    async commit() {
        await this.query('COMMIT TRANSACTION');
    }

    async rollback() {
        await this.query('ROLLBACK TRANSACTION');
    }

    release() {
        if (this.pg_client) {
            this.pg_client.removeAllListeners('error');
            this.pg_client.release();
            this.pg_client = null;
        }
    }

}


class BulkOp {
    constructor({ client, name, schema }) {
        this.name = name;
        this.schema = schema;
        this.transaction = new PgTransaction(client);
        this.queries = [];
        this.length = 0;
        // this.nInserted = 0;
        // this.nMatched = 0;
        // this.nModified = 0;
    }




    insert(data) {
        const _id = get_id(data);
        this.add_query(`INSERT INTO ${this.name}(_id, data) VALUES('${String(_id)}', '${JSON.stringify(encode_json(this.schema, data))}')`);
        return this;
    }

    add_query(text) {
        this.length += 1;
        this.queries.push(text);
    }

    async execute() {
        let ok = false;
        let errmsg;
        let nInserted = 0;
        let nMatched = 0;
        let nModified = 0;
        let nRemoved = 0;
        try {
            await this.transaction.begin();
            const batch_query = this.queries.join('; ');
            let results = await this.transaction.query(batch_query);
            if (!Array.isArray(results)) {
                results = [results];
            }
            for (const res of results) {
                if (res.command === 'UPDATE') {
                    nModified += res.rowCount;
                    nMatched += res.rowCount;
                } else if (res.command === 'INSERT') {
                    nInserted += res.rowCount;
                } else if (res.command === 'DELETE') {
                    nRemoved += res.rowCount;
                }
            }
            await this.transaction.commit();
            ok = true;
        } catch (err) {
            errmsg = err;
            dbg.error('PgTransaction execute error', err);
            await this.transaction.rollback();
        } finally {
            this.transaction.release();
        }

        return {
            err: errmsg,
            ok,
            nInserted,
            nMatched,
            nModified,
            nRemoved,
            // nUpserted is not used in our code. returning 0 
            nUpserted: 0,
            getInsertedIds: not_implemented,
            getLastOp: not_implemented,
            getRawResponse: not_implemented,
            getUpsertedIdAt: not_implemented,
            getUpsertedIds: not_implemented,
            getWriteConcernError: _.noop,
            getWriteErrorAt: i => (ok ? undefined : {
                code: errmsg.code,
                index: i,
                errmsg: errmsg.message
            }),
            getWriteErrorCount: () => (ok ? 0 : this.queries.length),
            getWriteErrors: () => (ok ? [] : _.times(this.queries.length, i => ({
                code: errmsg.code,
                index: i,
                errmsg: errmsg.message
            }))),
            hasWriteErrors: () => !ok

        };

    }

    findAndUpdateOne(find, update) {
        let encoded_update = encode_json(this.schema, update);
        const pg_update = mongo_to_pg.convertUpdate('data', encoded_update);

        let encoded_find = encode_json(this.schema, find);
        const pg_selector = mongo_to_pg('data', encoded_find, { disableContainmentQuery: true });

        let dollar_array_query = convert_array_query(this.name, encoded_update, encoded_find);
        const query = dollar_array_query || `UPDATE ${this.name} SET data = ${pg_update} WHERE ${pg_selector}`;

        this.add_query(query);
        return this;
    }
}

class UnorderedBulkOp extends BulkOp {

    find(selector) {
        return {
            // TODO length?
            length: this.queries.length,
            remove: not_implemented,
            removeOne: () => this.findAndRemoveOne(selector),
            replaceOne: not_implemented,
            update: not_implemented,
            updateOne: doc => this.findAndUpdateOne(selector, doc),
            upsert: not_implemented
        };
    }

    findAndRemoveOne(find) {
        const pg_selector = mongo_to_pg('data', encode_json(this.schema, find), { disableContainmentQuery: true });
        const query = `DELETE FROM ${this.name} WHERE ${pg_selector}`;
        this.add_query(query);
        return this;
    }
}

class OrderedBulkOp extends BulkOp {

    find(selector) {
        return {
            delete: not_implemented,
            deleteOne: not_implemented,
            replaceOne: not_implemented,
            update: not_implemented,
            updateOne: doc => this.findAndUpdateOne(selector, doc),
            upsert: not_implemented
        };
    }

}

class PostgresSequence {
    constructor(params) {
        const { name, client } = params;
        this.name = name;
        this.client = client;
    }

    // Lazy migration of the old mongo style collection/table based
    // sequences. If a table with the name matching the sequence one
    // is found, then:
    // - fetch the current sequence value from the collection
    // - return the init value to be used for native sequence
    // If no table is found, return 1 - clean install
    async migrateFromMongoSequence(name, pool) {
        const res = await _do_query(pool, { text: `SELECT count(*) FROM pg_tables WHERE tablename  = '${name}';` }, 0);
        const count = Number(res.rows[0].count);
        if (count === 0) {
            dbg.log0(`Table ${name} not found, skipping sequence migration`);
            return 1;
        }
        dbg.log0(`✅ Table ${name} is found, starting migration to native sequence`);
        const mongoSeq = new MongoSequence({ name, client: this.client });
        const start = await mongoSeq.nextsequence();

        return start;
    }

    seqname() {
        return this.name + "native";
    }

    async _create(pool) {
        try {
            const start = await this.migrateFromMongoSequence(this.name, pool);
            await _do_query(pool, { text: `CREATE SEQUENCE IF NOT EXISTS ${this.seqname()} AS BIGINT START ${start};` }, 0);
            if (start !== 1) {
                await _do_query(pool, { text: `DROP table IF EXISTS ${this.name};` }, 0);
                dbg.log0(`✅ Table ${this.name} is dropped, migration to native sequence is completed`);
            }
        } catch (err) {
            dbg.error('PostgresSequence._create failed', err);
            throw err;
        }
    }

    async nextsequence() {
        if (this.init_promise) await this.init_promise;
        const q = { text: `SELECT nextval('${this.seqname()}')` };
        const res = await _do_query(this.client.pool, q, 0);
        return Number.parseInt(res.rows[0].nextval, 10);
    }
}

// TODO: Hint for the index is ignored
class PostgresTable {
    constructor(table_params) {
        const { schema, name, db_indexes, client, init_function } = table_params;
        this.name = name;
        this.init_function = init_function;
        const id_index = {
            fields: {
                _id: 1,
            },
            options: {
                name: '_id_index',
                unique: true,
            }
        };
        this.db_indexes = [id_index, ...(db_indexes || [])];
        this.schema = schema;
        this.client = client;
        // calculate an advisory_lock_key from this collection by taking the first 32 bit 
        // of the sha256 of the table name
        const advisory_lock_key_string = crypto.createHash('sha256')
            .update(name)
            .digest('hex')
            .slice(0, 8);
        this.advisory_lock_key = parseInt(advisory_lock_key_string, 16);

        if (schema) {
            schema_utils.strictify(schema, {
                additionalProperties: false
            });
            this.client._ajv.addSchema(schema, name);
        }

        if (!process.env.CORETEST) {
            // Run once a day
            // TODO: Configure from PostgreSQL
            setInterval(this.vacuumAndAnalyze, 86400000, this).unref();
        }
    }

    initializeUnorderedBulkOp() {
        return new UnorderedBulkOp({
            name: this.name,
            client: this.client,
            schema: this.schema
        });
    }

    initializeOrderedBulkOp() {
        return new OrderedBulkOp({ name: this.name, client: this.client, schema: this.schema });
    }

    async _create_table(pool) {
        const { init_function } = this;
        try {
            dbg.log0(`creating table ${this.name}`);
            await this.single_query(`CREATE TABLE IF NOT EXISTS ${this.name} (_id char(24) PRIMARY KEY, data jsonb)`, undefined, pool, true);
            if (init_function) await init_function(this);
        } catch (err) {
            dbg.error('got error on _init_table:', err);
            throw err;
        }

        if (this.db_indexes) {
            try {
                await Promise.all(this.db_indexes.map(async index => {
                    const { fields, options = {} } = index;
                    try {
                        const index_name = options.name || Object.keys(fields).join('_');
                        dbg.log0(`creating index ${index_name} in table ${this.name}`);
                        const col_arr = [];
                        _.forIn(fields, (value, key) => {
                            if (index_name.startsWith('aggregate') && (key === 'deleted' || key === 'create_time')) {
                                col_arr.push(`to_ts(data->>'${key}') ${value > 0 ? 'ASC' : 'DESC'}`);
                            } else {
                                col_arr.push(`(data->>'${key}') ${value > 0 ? 'ASC' : 'DESC'}`);
                            }
                        });
                        const col_idx = `(${col_arr.join(',')})`;
                        const uniq = options.unique ? 'UNIQUE' : '';
                        const partial = options.partialFilterExpression ? `WHERE ${mongo_to_pg('data', options.partialFilterExpression, {disableContainmentQuery: true})}` : '';
                        const idx_str = `CREATE ${uniq} INDEX idx_btree_${this.name}_${index_name} ON ${this.name} USING BTREE ${col_idx} ${partial}`;
                        await this.single_query(idx_str, undefined, pool, true);
                        dbg.log0('db_indexes: created index', idx_str);
                    } catch (err) {
                        // TODO: Handle conflicts and re-declaration
                        // if (err.codeName !== 'IndexOptionsConflict') throw err;
                        if (err.code === '42P07') return;
                        // await db.collection(col.name).dropIndex(index.fields);
                        // const res = await db.collection(col.name).createIndex(index.fields, _.extend({ background: true }, index.options));
                        // dbg.log0('_init_collection: re-created index with new options', col.name, res);
                        dbg.error('got error on db_indexes: FAILED', this.name, err);
                        throw err;
                    }
                }));
            } catch (err) {
                dbg.error('got error on creating db_indexes: FAILED', this.name, err);
                throw err;
            }
        }
    }

    // for simple queries pass client to use client.query
    async single_query(text, values, client, skip_init) {
        if (!skip_init) await this.init_promise;
        const q = { text, values };
        return _do_query(client || this.client.pool, q, 0);
    }

    get_id(data) {
        return get_id(data);
    }

    async countDocuments(query) {
        let query_string = `SELECT COUNT(*) FROM ${this.name}`;
        if (!_.isEmpty(query)) query_string += ` WHERE ${mongo_to_pg('data', encode_json(this.schema, query), {disableContainmentQuery: true})}`;
        try {
            const res = await this.single_query(query_string);
            return Number(res.rows[0].count);
        } catch (err) {
            dbg.error('countDocuments failed', query, query_string, err);
            throw err;
        }
    }

    async vacuumAndAnalyze(context) {
        try {
            await context.single_query(`VACUUM (VERBOSE, ANALYZE) ${context.name}`);
            dbg.log0('vacuumAndAnalyze finished', context.name);
        } catch (err) {
            dbg.error('vacuumAndAnalyze failed', err);
            throw err;
        }
    }

    async estimatedDocumentCount() {
        try {
            const count = await this.single_query(`SELECT reltuples FROM pg_class WHERE relname = '${this.name}'`);
            return count.rows[0].reltuples;
        } catch (err) {
            dbg.error('estimatedDocumentCount failed', err);
            throw err;
        }
    }

    async estimatedQueryCount(query) {
        // TODO: Do an estimate
        return this.countDocuments(query);
    }

    async insertOne(data) {

        const _id = this.get_id(data);
        await this.single_query(`INSERT INTO ${this.name} (_id, data) VALUES ($1, $2)`, [String(_id), encode_json(this.schema, data)]);
        // TODO: Implement type
        return {};
    }

    async _insertOneWithClient(client, data) {

        const _id = this.get_id(data);
        await this.single_query(`INSERT INTO ${this.name} (_id, data) VALUES ($1, $2)`, [String(_id), encode_json(this.schema, data)], client);
        // TODO: Implement type
        return {};
    }

    // This is done mainly to be quick
    // Notice that the behaviour between MongoDB and PostgreSQL differs
    // In PostgreSQL we either push everything at once or do not push anything at all
    // In MongoDB we might push partially (succeed pushing several documents and fail on others), and it is done in parallel
    async insertManyUnordered(data) {

        const args = _.flatten(data.map(doc => [String(this.get_id(doc)), encode_json(this.schema, doc)]));
        const values_str = _.times(data.length, i => `($${(i * 2) + 1}, $${(i * 2) + 2})`).join(', ');
        await this.single_query(`INSERT INTO ${this.name} (_id, data) VALUES ${values_str}`, args);
        // TODO: Implement type
        return {};
    }

    async updateOne(selector, update, options = {}) {
        // console.warn('JENIA updateOne', selector, update, options);
        const encoded_update = encode_json(this.schema, update);
        const pg_update = mongo_to_pg.convertUpdate('data', encoded_update);
        const encoded_find = encode_json(this.schema, selector);
        const pg_selector = mongo_to_pg('data', encoded_find, { disableContainmentQuery: true });

        let dollar_array_query = convert_array_query(this.name, encoded_update, encoded_find);
        const query = (dollar_array_query || `UPDATE ${this.name} SET data = ${pg_update} WHERE ${pg_selector}`) + ' RETURNING _id, data';

        try {
            const res = await this.single_query(query);
            // console.warn('JENIA updateOne res', res);
            assert(res.rowCount <= 1, `_id must be unique. found ${res.rowCount} rows with _id=${selector._id} in table ${this.name}`);
            return res;
        } catch (err) {
            dbg.error(`updateOne failed`, selector, update, query, err);
            throw err;
        }
    }

    async _updateOneWithClient(client, selector, update, options = {}) {
        // console.warn('JENIA updateOne', selector, update, options);
        const pg_update = mongo_to_pg.convertUpdate('data', encode_json(this.schema, update));
        const pg_selector = mongo_to_pg('data', encode_json(this.schema, selector), { disableContainmentQuery: true });
        let query = `UPDATE ${this.name} SET data = ${pg_update} WHERE ${pg_selector} RETURNING _id, data`;
        try {
            const res = await this.single_query(query, null, client);
            assert(res.rowCount <= 1, `_id must be unique. found ${res.rowCount} rows with _id=${selector._id} in table ${this.name}`);
            return res;
        } catch (err) {
            dbg.error(`updateOneWithClient failed`, selector, update, query, err);
            throw err;
        }
    }

    async updateMany(selector, update) {

        const pg_update = mongo_to_pg.convertUpdate('data', encode_json(this.schema, update));
        const pg_selector = mongo_to_pg('data', encode_json(this.schema, selector), { disableContainmentQuery: true });
        const query = `UPDATE ${this.name} SET data = ${pg_update} WHERE ${pg_selector}`;
        try {
            await this.single_query(query);
            // TODO: Implement type
            return {};
        } catch (err) {
            dbg.error(`updateMany failed`, selector, update, query, err);
            throw err;
        }
    }

    async deleteMany(selector) {

        const pg_selector = mongo_to_pg('data', encode_json(this.schema, selector), { disableContainmentQuery: true });
        const query = `DELETE FROM ${this.name} WHERE ${pg_selector}`;
        try {
            await this.single_query(query);
            // TODO: Implement the type
            return {
                result: {
                    ok: 1
                }
            };
        } catch (err) {
            dbg.error(`deleteMany failed`, selector, query, err);
            throw err;
        }
    }

    async find(query, options = {}) {

        function isObject(v) {
            return (typeof v === 'object' && !Array.isArray(v) && v !== null);
        }
        /*
         * for $all operator to work correctly arrayFields argument should be used:
         *      https://github.com/thomas4019/mongo-query-to-postgres-jsonb#arrayfields
         * incorporating array fields in the options object:
         *      https://github.com/thomas4019/mongo-query-to-postgres-jsonb/blob/e0bb65eafc39458da30e4fc3c5f47ffb5d509fcc/index.js#L280
         * test example:
         *      https://github.com/thomas4019/mongo-query-to-postgres-jsonb/blob/e0bb65eafc39458da30e4fc3c5f47ffb5d509fcc/test/filter.js#L229
         */
        function calculateOptionsAndArrayFields(q) {
            const ops = ['$all'];
            const l = [];
            for (const p of Object.keys(q)) {
                for (const o of ops) {
                    if (isObject(q[p]) && q[p][o]) {
                        l.push(p);
                    }
                }
            }
            return { disableContainmentQuery: true, arrays: l };
        }

        const sql_query = {};
        sql_query.select = options.projection ? mongo_to_pg.convertSelect('data', options.projection) : '*';
        const encoded_query = encode_json(this.schema, query);
        sql_query.where = !_.isEmpty(query) && mongo_to_pg('data', encoded_query, calculateOptionsAndArrayFields(query));

        sql_query.order_by = options.sort && convert_sort(options.sort);
        sql_query.limit = options.limit;
        sql_query.offset = options.skip;
        let query_string = `SELECT ${sql_query.select} FROM ${this.name}`;
        if (sql_query.where) {
            query_string += ` WHERE ${sql_query.where}`;
        }
        if (sql_query.order_by) {
            query_string += ` ORDER BY ${sql_query.order_by}`;
        }
        if (sql_query.limit) {
            query_string += ` LIMIT ${sql_query.limit}`;
        }
        if (sql_query.offset) {
            query_string += ` OFFSET ${sql_query.offset}`;
        }
        try {
            const res = await this.single_query(query_string);
            return res.rows.map(row => decode_json(this.schema, row.data));
        } catch (err) {
            dbg.error('find failed', query, options, query_string, err);
            throw err;
        }

    }

    async findOne(query, options = {}) {

        let query_string = `SELECT * FROM ${this.name} WHERE ${mongo_to_pg('data', encode_json(this.schema, query), {disableContainmentQuery: true})}`;
        if (options.sort) {
            query_string += ` ORDER BY ${convert_sort(options.sort)}`;
        }
        query_string += ' LIMIT 1';
        try {
            const res = await this.single_query(query_string);
            if (res.rowCount === 0) return null;
            return res.rows.map(row => decode_json(this.schema, row.data))[0];
        } catch (err) {
            dbg.error('findOne failed', query, query_string, err);
            throw err;
        }
    }

    async mapReduceListObjects(options) {

        const sql_query = {};
        let mr_q;
        sql_query.where = mongo_to_pg('data', encode_json(this.schema, options.query), { disableContainmentQuery: true });
        sql_query.order_by = options.sort && convert_sort(options.sort);
        sql_query.limit = options.limit || 1000;
        try {
            mr_q = `SELECT _id, value FROM map_common_prefixes('${options.scope.prefix || ''}', '${options.scope.delimiter || ''}', $$${sql_query.where}$$, $$${sql_query.order_by}$$, ${sql_query.limit})`;
            const res = await this.single_query(mr_q);
            return res.rows.map(row => {
                const r_row = { _id: row._id };
                if (row.value === null) {
                    return _.defaults(r_row, { value: 1 });
                } else {
                    // _id is unique per object
                    return _.defaults(r_row, { value: decode_json(this.schema, row.value) });
                }
            });
        } catch (err) {
            dbg.error('mapReduceListObjects failed', options, mr_q, err);
            throw err;
        }
    }

    async mapReduceAggregate(func, options) {

        let mr_q;
        let query_string;
        try {
            const where_clause = convert_timestamps(mongo_to_pg('data', encode_json(this.schema, options.query)));
            query_string = `SELECT * FROM ${this.name} WHERE ${where_clause}`;
            mr_q = `SELECT _id, SUM(value) AS value FROM ${func}($$${query_string}$$) GROUP BY _id`;
            const res = await this.single_query(mr_q);
            return res.rows;
        } catch (err) {
            dbg.error('mapReduceAggregate failed', func, options, query_string, mr_q, err);
            throw err;
        }
    }

    async _reduceFinalizeFuncStats(rows, scope) {

        let response_times;
        // this is the reduce part of the map reduce
        const values = [];
        rows.map(row => values.push(row.value));

        const reduced = values.reduce((bin, other) => {
            bin.invoked += other.invoked;
            bin.fulfilled += other.fulfilled;
            bin.rejected += other.rejected;
            bin.aggr_response_time += other.aggr_response_time;
            bin.max_response_time = Math.max(
                bin.max_response_time,
                other.max_response_time
            );
            bin.completed_response_times = [
                ...bin.completed_response_times,
                ...other.completed_response_times
            ];

            return bin;
        });

        // Reduce the sample size to max_samples
        response_times = reduced.completed_response_times;
        if (response_times.length > scope.max_samples) {
            reduced.completed_response_times = Array.from({ length: scope.max_samples },
                () => response_times[
                    Math.floor(Math.random() * response_times.length)
                ]
            );
        }

        // this is the finalize part of the map reduce
        response_times = reduced.completed_response_times.sort((a, b) => a - b);

        const return_value = {
            invoked: reduced.invoked,
            fulfilled: reduced.fulfilled,
            rejected: reduced.rejected,
            max_response_time: reduced.max_response_time,
            aggr_response_time: reduced.aggr_response_time,
            avg_response_time: reduced.fulfilled > 0 ?
                Math.round(reduced.aggr_response_time / reduced.fulfilled) : 0,
            response_percentiles: scope.percentiles.map(percentile => {
                const index = Math.floor(response_times.length * percentile);
                const value = response_times[index] || 0;
                return { percentile, value };
            })
        };

        return return_value;
    }

    async mapReduceFuncStats(func, options) {
        let query_string;
        let map_reduce_query;
        let map;
        const map_reduced_array = [];
        try {
            // this is the map part of the map reduce
            query_string = `SELECT * FROM ${this.name} WHERE ${mongo_to_pg('data', encode_json(this.schema, options.query), {disableContainmentQuery: true})}`;
            map_reduce_query = `SELECT * FROM ${func}($$${query_string}$$)`;
            map = await this.single_query(map_reduce_query);
        } catch (err) {
            dbg.error('mapReduceFuncStats failed', options, query_string, map_reduce_query, err);
            throw err;
        }

        //If there are no matching results then returning an empty array
        if (map.rows.length === 0) {
            return map.rows;
        }

        //Working on all the results from the query
        let return_value = await this._reduceFinalizeFuncStats(map.rows, options.scope);

        map_reduced_array.push({
            _id: -1,
            value: return_value,
        });

        //Working on each column 
        try {
            map = await this.single_query(map_reduce_query);
        } catch (err) {
            dbg.error('mapReduceFuncStats failed', options, query_string, map_reduce_query, err);
            throw err;
        }
        const step = options.scope.step;
        const groupByKeys = _.groupBy(map.rows, r => Math.floor(new Date(r.time_stamp).valueOf() / step) * step);
        for (const [key, rows] of Object.entries(groupByKeys)) {
            return_value = await this._reduceFinalizeFuncStats(rows, options.scope);
            map_reduced_array.push({
                _id: key,
                value: return_value,
            });
        }

        return map_reduced_array;

    }

    async mapReduce(map, reduce, params) {
        switch (map) {
            case mongo_functions.map_aggregate_objects:
                return this.mapReduceAggregate('map_aggregate_objects', params);
            case mongo_functions.map_aggregate_chunks:
                return this.mapReduceAggregate('map_aggregate_chunks', params);
            case mongo_functions.map_aggregate_blocks:
                return this.mapReduceAggregate('map_aggregate_blocks', params);
            case mongo_functions.map_common_prefixes:
                return this.mapReduceListObjects(params);
            case mongo_functions.map_func_stats:
                return this.mapReduceFuncStats('map_func_stats', params);
            default:
                throw new Error('TODO mapReduce');
        }
    }

    async distinct(property, query, options) {

        const sql_query = {};
        const select = {};
        select[property] = 1;
        sql_query.select = mongo_to_pg.convertSelect('data', select);
        sql_query.where = mongo_to_pg('data', encode_json(this.schema, query), { disableContainmentQuery: true });
        sql_query.order_by = options.sort && convert_sort(options.sort).replace("data->'bucket'", "data->>'bucket'");
        sql_query.limit = options.limit;
        sql_query.offset = options.skip;
        let query_string = `SELECT DISTINCT ON (data->>'${property}') ${sql_query.select} FROM ${this.name} WHERE ${sql_query.where}`;
        if (sql_query.order_by) {
            query_string += ` ORDER BY ${sql_query.order_by}`;
        }
        if (sql_query.limit) {
            query_string += ` LIMIT ${sql_query.limit}`;
        }
        if (sql_query.offset) {
            query_string += ` OFFSET ${sql_query.offset}`;
        }
        try {
            const res = await this.single_query(query_string);
            return res.rows.map(row => decode_json(this.schema, row.data)[property]);
        } catch (err) {
            dbg.error('distinct failed', query, options, query_string, err);
            throw err;
        }
    }

    _prepare_aggregate_group_query(obj) {
        const selects = [];
        let gby;
        _.forIn(obj, (value, key) => {
            if (_.isObjectLike(value)) {
                const op = Object.keys(value)[0];
                switch (op) {
                    case '$sum': {
                        let v = value[op];
                        if (_.isString(v) && v.indexOf('$') === 0) {
                            v = `data->>'${v.substring(1)}'`;
                        } else if (_.isNumber(v)) {
                            v = v.toString();
                        }
                        selects.push(`SUM((${v})::NUMERIC) AS ${key}`);
                        break;
                    }
                    case '$max': {
                        let v = value[op];
                        if (_.isString(v) && v.indexOf('$') === 0) {
                            v = `data->>'${v.substring(1)}'`;
                        } else if (_.isNumber(v)) {
                            v = v.toString();
                        }
                        selects.push(`MAX((${v})::NUMERIC) AS ${key}`);
                        break;
                    }
                    case '$push': {
                        let v = value[op];
                        if (_.isObjectLike(v)) {
                            const json = [];
                            _.forIn(v, (pv, pk) => {
                                json.push(`'${pk}'`);
                                if (_.isString(pv) && pv.indexOf('$') === 0) {
                                    json.push(`data->>'${pv.substring(1)}'`);
                                }
                            });
                            v = `json_agg(json_build_object(${json.join(',')}))`;
                        }
                        selects.push(`${v} AS ${key}`);
                        break;
                    }
                    default:
                        break;
                }
            } else if (_.isString(value) && value.indexOf('$') === 0) {
                const prop = value.substring(1);
                if (key === '_id') gby = prop;
                selects.push(`(data->'${prop}') AS ${key}`);
            }
        });

        return {
            SELECT: `${selects.join(',')}`,
            GROUP_BY: `data->'${gby}'`,
        };
    }

    _prepare_aggregate_count_query(str) {
        return `SELECT COUNT(*) AS ${str} FROM %TABLE%`;
    }

    _prepare_aggregate_sample_query(obj) {
        const { size } = obj;
        return `SELECT * FROM %TABLE% ORDER BY RANDOM() LIMIT ${size}`;
    }

    async groupBy(match, group) {
        const WHERE = mongo_to_pg('data', encode_json(this.schema, match), { disableContainmentQuery: true });
        const P_GROUP = this._prepare_aggregate_group_query(group);
        try {
            const res = await this.single_query(`SELECT ${P_GROUP.SELECT} FROM ${this.name} WHERE ${WHERE} GROUP BY ${P_GROUP.GROUP_BY}`);
            return res.rows.map(row => { // this is temp fix as all the keys suppose to be ints except _id
                const new_row = {};
                for (const key of Object.keys(row)) {
                    if (key === '_id') {
                        new_row._id = new mongodb.ObjectID(row[key]);
                    } else {
                        new_row[key] = parseInt(row[key], 10);
                    }
                }
                return new_row;
            });
        } catch (err) {
            dbg.error('groupBy failed', match, group, WHERE, P_GROUP, err);
            throw err;
        }
    }

    async findOneAndUpdate(query, update, options) {
        if (options.returnOriginal !== false) {
            throw new Error('returnOriginal=true is not supported by the DB client API. must be set to false explicitly');
        }
        const { upsert } = options;
        if (upsert) {
            return this._upsert(query, update, options);
        } else {
            const update_res = await this.updateOne(query, update, options);
            if (update_res.rowCount > 0) {
                return { value: update_res.rows.map(row => decode_json(this.schema, row.data))[0] };
            } else {
                return null;
            }
        }
    }


    async try_lock_table(client) {
        // the advisory_xact_lock is a transaction level lock that is auto released when the transaction ends
        const res = await client.query('SELECT pg_try_advisory_lock($1)', [this.advisory_lock_key]);
        if (!res.rows || !res.rows.length || _.isUndefined(res.rows[0].pg_try_advisory_lock)) {
            throw new Error('unexpected response for pg_try_advisory_lock');
        }
        return res.rows[0].pg_try_advisory_lock;

    }

    async unlock_table(client) {
        // the advisory_xact_lock is a transaction level lock that is auto released when the transaction ends
        const res = await client.query('SELECT pg_advisory_unlock($1)', [this.advisory_lock_key]);
        if (!res.rows || !res.rows.length || _.isUndefined(res.rows[0].pg_advisory_unlock)) {
            throw new Error('unexpected response for pg_advisory_unlock');
        }
        return res.rows[0].pg_advisory_unlock;
    }

    async _upsert(query, update, options) {
        await this.init_promise;
        const MAX_RETRIES = 5;
        let retries = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
            let pg_client;
            let locked;
            try {
                pg_client = await this.client.pool.connect();
                let update_res = await this._updateOneWithClient(pg_client, query, update, options);
                if (update_res.rowCount === 0) {
                    // try to lock the advisory_lock_key for this table, try update and insert the first doc if 0 docs updated
                    locked = await this.try_lock_table(pg_client);
                    if (locked) {
                        // try update again to avoid race conditions
                        update_res = await this._updateOneWithClient(pg_client, query, update, options);
                        if (update_res.rowCount === 0) {
                            const data = { _id: this.client.generate_id() };
                            await this.insertOne(data);
                            update_res = await this.updateOne(data, update, options);
                        }
                        await this.unlock_table(pg_client);
                        locked = false;
                    } else {
                        // lock was already taken which means that another call to findOneAndUpdate should have inserted.
                        // throw and retry
                        dbg.log0(`advisory lock is taken. throwing and retrying`);
                        let err = new Error(`retry update after advisory lock release ${this.name}`);
                        err.retry = true;
                        throw err;
                    }
                }
                return { value: update_res.rows.map(row => decode_json(this.schema, row.data))[0] };
            } catch (err) {
                if (err.retry && retries < MAX_RETRIES) {
                    retries += 1;
                    // TODO: should we add a delay here?
                    dbg.log0(`${err.message} - will retry. retries=${retries}`);
                } else {
                    dbg.error(`findOneAndUpdate failed`, query, update, options, err);
                    throw err;
                }
            } finally {
                if (locked) {
                    await this.unlock_table(pg_client);
                    locked = false;
                }
                if (pg_client) pg_client.release();
            }
        }
    }

    async stats() {
        // TODO 
        return {
            ns: 'TODO',
            count: Infinity,
            size: Infinity,
            avgObjSize: Infinity,
            storageSize: Infinity,
            numExtents: Infinity,
            nindexes: Infinity,
            lastExtentSize: Infinity,
            paddingFactor: Infinity,
            totalIndexSize: Infinity,
            indexSizes: {
                _id_: Infinity,
                dedup_key_1: Infinity,
            },
            capped: false,
            max: Infinity,
            maxSize: Infinity,
            ok: Infinity,
        };
    }

    async deleteOne(selector) {

        const pg_selector = mongo_to_pg('data', encode_json(this.schema, selector), { disableContainmentQuery: true });
        const query = `DELETE FROM ${this.name} WHERE ${pg_selector}`;
        try {
            await this.single_query(query);
            // TODO: To be compatible with type
            return {};
        } catch (err) {
            dbg.error(`deleteOne failed`, selector, query, err);
            throw err;
        }
    }

    validate(doc, warn) {
        const validator = this.client._ajv.getSchema(this.name);
        if (!validator(doc)) {
            const msg = `INVALID_SCHEMA_DB ${this.name}`;
            if (warn === 'warn') {
                dbg.warn(msg,
                    'ERRORS', util.inspect(validator.errors, true, null, true),
                    'DOC', util.inspect(doc, true, null, true));
            } else {
                dbg.error(msg,
                    'ERRORS', util.inspect(validator.errors, true, null, true),
                    'DOC', util.inspect(doc, true, null, true));
                throw new Error(msg);
            }
        }
        return doc;
    }

    col() {
        return this;
    }

}


class PostgresClient extends EventEmitter {

    /**
     * @param {PostgresClient} client
     * @returns {nb.DBClient}
     */
    static implements_interface(client) { return client; }

    // JENIA TODO:
    async is_collection_indexes_ready() { return true; }

    async dropDatabase() {
        let pg_client;
        try {
            pg_client = new Client({ ...this.new_pool_params, database: undefined });
            await pg_client.connect();
            await pg_client.query(`DROP DATABASE ${this.new_pool_params.database}`);
        } catch (err) {
            if (err.code === '3D000') return;
            throw err;
        } finally {
            if (pg_client) await pg_client.end();
        }
    }

    async createDatabase() {
        let pg_client;
        try {
            pg_client = new Client({ ...this.new_pool_params, database: undefined });
            await pg_client.connect();
            await pg_client.query(`CREATE DATABASE ${this.new_pool_params.database} WITH LC_COLLATE = 'C' TEMPLATE template0`);
        } catch (err) {
            if (err.code === '3D000') return;
            throw err;
        } finally {
            if (pg_client) await pg_client.end();
        }
    }

    async disconnect() {
        dbg.log0('disconnect called');
        this._disconnected_state = true;
        this._connect_promise = null;
        if (this.pool) {
            this.pool.end();
            this.pool = null;
        }
    }

    async reconnect() {
        dbg.log0(`reconnect called`);
        this.disconnect();
        return this.connect();
    }

    set_db_name(name) {
        if (this.is_connected()) throw new Error('Cannot set DB name to connected DB');
        this.new_pool_params.database = name;
    }
    get_db_name() {
        return this.new_pool_params.database;
    }

    constructor(params) {
        super();
        this.tables = [];
        this.sequences = [];
        const postgres_port = parseInt(process.env.POSTGRES_PORT || '5432', 10);

        // TODO: This need to move to another function
        this.new_pool_params = {

            // TODO: check the effect of max clients. default is 10
            max: config.POSTGRES_MAX_CLIENTS,

            host: process.env.POSTGRES_HOST || 'localhost',
            user: process.env.POSTGRES_USER || 'postgres',
            password: process.env.POSTGRES_PASSWORD || 'noobaa',
            database: process.env.POSTGRES_DBNAME || 'nbcore',
            port: postgres_port,
            ...params,
        };

        PostgresClient.implements_interface(this);
        this._ajv = new Ajv({ verbose: true, allErrors: true });
        this._ajv.addKeyword(schema_keywords.KEYWORDS.methods);
        this._ajv.addKeyword(schema_keywords.KEYWORDS.doc);
        this._ajv.addKeyword(schema_keywords.KEYWORDS.date);
        this._ajv.addKeyword(schema_keywords.KEYWORDS.idate);
        this._ajv.addKeyword(schema_keywords.KEYWORDS.objectid);
        this._ajv.addKeyword(schema_keywords.KEYWORDS.binary);
        this._ajv.addKeyword(schema_keywords.KEYWORDS.wrapper);
        this._ajv.addSchema(common_api);

        // this.emit('reconnect');

        /* exported constants */
        this.operators = new Set([
            '$inc',
            '$mul',
            '$rename',
            '$setOnInsert',
            '$set',
            '$unset',
            '$min',
            '$max',
            '$currentDate',
            '$addToSet',
            '$pop',
            '$pullAll',
            '$pull',
            '$pushAll',
            '$push',
            '$each',
            '$slice',
            '$sort',
            '$position',
            '$bit',
            '$isolated'
        ]);
    }

    /**
     * @returns {PostgresClient}
     */
    static instance() {
        if (!PostgresClient._instance) PostgresClient._instance = new PostgresClient();
        return PostgresClient._instance;
    }

    // Loading the postgres functions into the DB from sql_functions/
    async _load_sql_functions(pool) {
        let pg_client;
        try {
            pg_client = await pool.connect();
            const sql_functions = fs.readdirSync(`${__dirname}/sql_functions/`).sort();
            for (const fname of sql_functions) {
                dbg.log0("apply_sql_functions sql function", fname);
                const func = fs.readFileSync(`${__dirname}/sql_functions/${fname}`, "utf8");
                await pg_client.query(func);
            }
        } catch (err) {
            dbg.error('apply_sql_functions execute error', err);
            throw err;
        } finally {
            if (pg_client) pg_client.release();
        }
    }

    define_sequence(params) {
        if (_.find(this.sequences, s => s.name === params.name)) {
            throw new Error('define_sequence: sequence already defined ' + params.name);
        }
        const seq = new PostgresSequence({ ...params, client: this });
        this.sequences.push(seq);

        if (this.pool) {
            seq.init_promise = seq._create(this.pool).catch(_.noop); // TODO what is best to do when init_collection fails here?
        }

        return seq;
    }

    define_collection(table_params) {
        if (_.find(this.tables, t => t.name === table_params.name)) {
            throw new Error('define_table: table already defined ' + table_params.name);
        }

        const table = new PostgresTable({ ...table_params, client: this });
        this.tables.push(table);

        if (this.pool) {
            table.init_promise = table._create_table(this.pool).catch(_.noop); // TODO what is best to do when init_collection fails here?
        }

        return table;
    }

    async _init_collections(pool) {
        await this._load_sql_functions(pool);
        await Promise.all(this.tables.map(async table => table._create_table(pool)));
        await Promise.all(this.sequences.map(async seq => seq._create(pool)));
    }

    validate(table_name, doc, warn) {
        const validator = this._ajv.getSchema(table_name);
        if (!validator(doc)) {
            const msg = `INVALID_SCHEMA_DB ${table_name}`;
            if (warn === 'warn') {
                dbg.warn(msg,
                    'ERRORS', util.inspect(validator.errors, true, null, true),
                    'DOC', util.inspect(doc, true, null, true));
            } else {
                dbg.error(msg,
                    'ERRORS', util.inspect(validator.errors, true, null, true),
                    'DOC', util.inspect(doc, true, null, true));
                throw new Error(msg);
            }
        }
        return doc;
    }

    generate_id() {
        return new mongodb.ObjectId();
    }

    collection(name) {
        const table = _.find(this.tables, t => t.name === name);
        if (!table) {
            throw new Error('table: table not defined ' + name);
        }
        return table;
    }

    is_connected() {
        return Boolean(this.pool);
    }

    async connect(skip_init_db) {
        this._disconnected_state = false;
        if (this._connect_promise) return this._connect_promise;
        dbg.log0('connect called, current url', this.new_pool_params);
        this._connect_promise = this._connect(skip_init_db);
        return this._connect_promise;
    }

    async _connect(skip_init_db) {
        // TODO: check if we need to listen for events from pool (https://node-postgres.com/api/pool#events)
        // this.pool = new Pool(this.new_pool_params);

        // await this._load_sql_functions();
        // await this.ta
        // return this.wait_for_client_init();

        let pool;
        let is_connected = false;
        while (!is_connected) {
            try {
                if (this._disconnected_state) return;
                if (this.pool) return;
                dbg.log0('_connect: called with', this.new_pool_params);
                // this._set_connect_timeout();
                // client = await mongodb.MongoClient.connect(this.url, this.config);
                pool = new Pool(this.new_pool_params);
                if (skip_init_db !== 'skip_init_db') {
                    await this._init_collections(pool);
                }
                dbg.log0('_connect: connected', this.new_pool_params);
                // this._reset_connect_timeout();
                this.pool = pool;
                this.pool.on('error', err => {
                    dbg.error('got error on postgres pool', err);
                });
                this.emit('reconnect');
                dbg.log0(`connected`);
                is_connected = true;
                // return this.mongo_client.db();
            } catch (err) {
                // autoReconnect only works once initial connection is created,
                // so we need to handle retry in initial connect.
                dbg.error('_connect: initial connect failed, will retry', err.message);
                if (pool) {
                    pool.end();
                    pool = null;
                    this.pool = null;
                }
                await P.delay(3000);
            }
        }
    }

    define_gridfs(bucket) {
        bucket.gridfs = () => null;
        return bucket;
    }

    /*
     *@param base - the array to subtract from
     *@param values - array of values to subtract from base
     *@out - return an array of string containing values in base which did no appear in values
     */
    obj_ids_difference(base, values) {
        const map_base = {};
        for (let i = 0; i < base.length; ++i) {
            map_base[base[i]] = base[i];
        }
        for (let i = 0; i < values.length; ++i) {
            delete map_base[values[i]];
        }
        return _.values(map_base);
    }

    /**
     * make a list of ObjectId unique by indexing their string value
     * this is needed since ObjectId is an object so === comparison is not
     * logically correct for it even for two objects with the same id.
     */
    uniq_ids(docs, doc_path) {
        const map = {};
        _.each(docs, doc => {
            let id = _.get(doc, doc_path);
            if (id) {
                id = id._id || id;
                map[String(id)] = id;
            }
        });
        return _.values(map);
    }

    /**
     * populate a certain doc path which contains object ids to another collection
     * @template {{}} T
     * @param {T[]} docs
     * @param {string} doc_path
     * @param {nb.DBCollection} collection
     * @param {Object} [fields]
     * @returns {Promise<T[]>}
     */
    async populate(docs, doc_path, collection, fields) {
        const docs_list = _.isArray(docs) ? docs : [docs];
        const ids = this.uniq_ids(docs_list, doc_path);
        if (!ids.length) return docs;
        const items = await collection.find({ _id: { $in: ids } }, { projection: fields });
        const idmap = _.keyBy(items, '_id');
        _.each(docs_list, doc => {
            const id = _.get(doc, doc_path);
            if (id) {
                const item = idmap[String(id)];
                _.set(doc, doc_path, item);
            }
        });
        return docs;
    }


    resolve_object_ids_recursive(idmap, item) {
        _.each(item, (val, key) => {
            if (val instanceof mongodb.ObjectId) {
                if (key !== '_id') {
                    const obj = idmap[val.toHexString()];
                    if (obj) {
                        item[key] = obj;
                    }
                }
            } else if (_.isObject(val) && !_.isString(val)) {
                this.resolve_object_ids_recursive(idmap, val);
            }
        });
        return item;
    }

    resolve_object_ids_paths(idmap, item, paths, allow_missing) {
        _.each(paths, path => {
            const ref = _.get(item, path);
            if (this.is_object_id(ref)) {
                const obj = idmap[ref];
                if (obj) {
                    _.set(item, path, obj);
                } else if (!allow_missing) {
                    throw new Error('resolve_object_ids_paths missing ref to ' +
                        path + ' - ' + ref + ' from item ' + util.inspect(item));
                }
            } else if (!allow_missing) {
                if (!ref || !this.is_object_id(ref._id)) {
                    throw new Error('resolve_object_ids_paths missing ref id to ' +
                        path + ' - ' + ref + ' from item ' + util.inspect(item));
                }
            }
        });
        return item;
    }

    /**
     * @returns {nb.ID}
     */
    new_object_id() {
        return new mongodb.ObjectId();
    }

    /**
     * @param {string} id_str
     * @returns {nb.ID}
     */
    parse_object_id(id_str) {
        return new mongodb.ObjectId(String(id_str || undefined));
    }

    fix_id_type(doc) {
        if (_.isArray(doc)) {
            _.each(doc, d => this.fix_id_type(d));
        } else if (doc && doc._id) {
            doc._id = new mongodb.ObjectId(doc._id);
        }
        return doc;
    }

    is_object_id(id) {
        return (id instanceof mongodb.ObjectId);
    }

    // TODO: Figure out error codes
    is_err_duplicate_key(err) {
        return err && err.code === '23505';
    }

    check_duplicate_key_conflict(err, entity) {
        if (this.is_err_duplicate_key(err)) {
            throw new RpcError('CONFLICT', entity + ' already exists');
        } else {
            throw err;
        }
    }

    check_entity_not_found(doc, entity) {
        if (doc) {
            return doc;
        }
        throw new RpcError('NO_SUCH_' + entity.toUpperCase());
    }

    check_entity_not_deleted(doc, entity) {
        if (doc && !doc.deleted) {
            return doc;
        }
        throw new RpcError('NO_SUCH_' + entity.toUpperCase());
    }

    check_update_one(res, entity) {
        // We only verify here that the query actually matched a single document.
        if (!res || res.rowCount !== 1) {
            throw new RpcError('NO_SUCH_' + entity.toUpperCase());
        }
    }

    make_object_diff(current, prev) {
        const set_map = _.pickBy(current, (value, key) => !_.isEqual(value, prev[key]));
        const unset_map = _.pickBy(prev, (value, key) => !(key in current));
        const diff = {};
        if (!_.isEmpty(set_map)) diff.$set = set_map;
        if (!_.isEmpty(unset_map)) diff.$unset = _.mapValues(unset_map, () => 1);
        return diff;
    }

    // TODO: Replace that with an actual code
    async get_db_stats() {
        return { fsUsedSize: 0, fsTotalSize: Infinity };
    }

}


PostgresClient._instance = undefined;

// EXPORTS
exports.PostgresClient = PostgresClient;
exports.instance = PostgresClient.instance;
