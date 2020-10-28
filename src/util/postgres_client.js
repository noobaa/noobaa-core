/* Copyright (C) 2016 NooBaa */
/*eslint no-use-before-define: ["error", { "classes": false }]*/
'use strict';

const _ = require('lodash');

const assert = require('assert');
const Ajv = require('ajv');
const util = require('util');
const EventEmitter = require('events').EventEmitter;
const { Pool, Client } = require('pg');

const dbg = require('./debug_module')(__filename);
const common_api = require('../api/common_api');
const schema_utils = require('./schema_utils');
const promise_utils = require('./promise_utils');
const mongodb = require('mongodb');
const mongo_to_pg = require('mongo-query-to-postgres-jsonb');
const fs = require('fs');
// TODO: Shouldn't be like that, we shouldn't use MongoDB functions to compare
const mongo_functions = require('./mongo_functions');
const { RpcError } = require('../rpc');

mongodb.Binary.prototype[util.inspect.custom] = function custom_inspect_binary() {
    return `<mongodb.Binary ${this.buffer.toString('base64')} >`;
};

let query_counter = 0;

async function _do_query(pg_client, q, transaction_counter) {
    query_counter += 1;
    const tag = `T${_.padStart(transaction_counter, 8, '0')}|Q${_.padStart(query_counter.toString(), 8, '0')}`;
    try {
        dbg.log0(`postgres_client: ${tag}: ${q.text}`, util.inspect(q.values, { depth: 6 }));
        const res = await pg_client.query(q);
        dbg.log0(`postgres_client: ${tag}: got result:`, util.inspect(res, { depth: 6 }));
        return res;
    } catch (err) {
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

class PgTransaction {

    constructor({ client, name, ordered }) {
        this.name = name;
        this.ordered = ordered;
        this.length = 0;
        this.client = client;
        this.operations = [];
        this._init = this._begin();
        this.nInserted = 0;
        this.nMatched = 0;
        this.nModified = 0;
    }

    async _begin() {
        this.pg_client = await this.client.pool.connect();
        await _do_query(this.pg_client, { text: 'BEGIN TRANSACTION' });
        this._init = null;
    }

    insert(data) {
        const _id = get_id(data);
        this._query(`INSERT INTO ${this.name} (_id, data) VALUES ($1, $2)`, [String(_id), data]);
        // TODO
        this.nInserted += 1;
        return this;
    }

    _query(text, values) {
        const q = { text, values };
        this.length += 1;
        this.operations.push({ q, length: this.length });
    }

    async execute() {
        let ok = false;
        let errmsg;
        try {
            await promise_utils.wait_until(() => this._init === null);
            if (this.ordered) {
                for (const op of this.operations) {
                    await _do_query(this.pg_client, op.q, op.length);
                }
            } else {
                await Promise.all(this.operations.map(async args => _do_query(this.pg_client, args.q, args.length)));
            }
            await this._commit();
            ok = true;
        } catch (err) {
            errmsg = err;
            dbg.error('PgTransaction execute error', err);
            await this._rollback();
            throw err;
        } finally {
            this.pg_client.release();
            // TODO: Implement interface
            // eslint-disable-next-line no-unsafe-finally
            return {
                ok,
                nInserted: this.nInserted,
                nMatched: this.nMatched,
                nModified: this.nModified,
                nUpserted: Infinity,
                nRemoved: Infinity,
                getInsertedIds: () => undefined,
                getLastOp: () => undefined,
                getRawResponse: () => undefined,
                getUpsertedIdAt: index => undefined,
                getUpsertedIds: () => undefined,
                getWriteConcernError: () => (ok ? undefined : ({ code: errmsg.code || Infinity, errmsg: errmsg })),
                getWriteErrorAt: index => (ok ? undefined : ({ code: errmsg.code || Infinity, index, errmsg: errmsg })),
                getWriteErrorCount: () => (ok ? undefined : Infinity),
                getWriteErrors: () => (ok ? undefined : ([])),
                hasWriteErrors: () => !ok
            };
        }
    }

    findAndUpdateOne(find, update) {
        const pg_update = mongo_to_pg.convertUpdate('data', update);
        const pg_selector = mongo_to_pg('data', find);
        const query = `UPDATE ${this.name} SET data = ${pg_update} WHERE ${pg_selector}`;
        this._query(query);
        // TODO
        this.nModified += 1;
        this.nMatched += 1;
        return this;
    }

    async _commit() {
        await _do_query(this.pg_client, { text: 'COMMIT TRANSACTION' });
    }

    async _rollback() {
        await _do_query(this.pg_client, { text: 'ROLLBACK TRANSACTION' });
    }

}

class UnorderedBulkOp extends PgTransaction {

    constructor(params) {
        super(_.defaults(params, { ordered: false }));
    }

    find(selector) {
        return {
            // TODO length?
            length: this.length,
            remove: () => { throw new Error('TODO'); },
            removeOne: () => this.findAndRemoveOne(selector),
            replaceOne: doc => { throw new Error('TODO'); },
            update: doc => { throw new Error('TODO'); },
            updateOne: doc => this.findAndUpdateOne(selector, doc),
            upsert: () => { throw new Error('TODO'); }
        };
    }

    findAndRemoveOne(find) {
        const pg_selector = mongo_to_pg('data', find);
        const query = `DELETE FROM ${this.name} WHERE ${pg_selector}`;
        this._query(query);
        return this;
    }
}

class OrderedBulkOp extends PgTransaction {

    constructor(params) {
        super(_.defaults(params, { ordered: true }));
    }

    find(selector) {
        return {
            delete: () => { throw new Error('TODO'); },
            deleteOne: () => { throw new Error('TODO'); },
            replaceOne: doc => { throw new Error('TODO'); },
            update: doc => { throw new Error('TODO'); },
            updateOne: doc => this.findAndUpdateOne(selector, doc),
            upsert: () => { throw new Error('TODO'); }
        };
    }

}


// TODO: Hint for the index is ignored
class PostgresTable {
    constructor(table_params) {
        const { schema, name, db_indexes, client, init_function } = table_params;
        this.name = name;
        this.init_function = init_function;
        this.db_indexes = db_indexes;
        this.schema = schema;
        this.client = client;

        if (schema) {
            schema_utils.strictify(schema, {
                additionalProperties: false
            });
            this.client._ajv.addSchema(schema, name);
        }

        // Run once a day
        setInterval(this.vacuumAndAnalyze, 86400000, this);
    }

    initializeUnorderedBulkOp() {
        return new UnorderedBulkOp({ name: this.name, client: this.client });
    }

    initializeOrderedBulkOp() {
        return new OrderedBulkOp({ name: this.name, client: this.client });
    }

    async _create_table(pool) {
        const { init_function } = this;
        try {
            dbg.log0(`creating table ${this.name}`);
            await this.single_query(`CREATE TABLE IF NOT EXISTS ${this.name} (_id char(24) PRIMARY KEY, data jsonb)`, undefined, pool);
            if (init_function) await init_function(this);
        } catch (err) {
            dbg.error('got error on _init_table:', err);
            throw err;
        }
        // TODO: create indexes
    }

    async single_query(text, values, pool) {
        const q = { text, values };
        // for simple queries pass pool to use pool.query
        return _do_query(pool || this.client.pool, q, 0);
    }

    get_id(data) {
        return get_id(data);
    }

    async countDocuments(query) {
        let query_string = `SELECT COUNT(*) FROM ${this.name}`;
        if (!_.isEmpty(query)) query_string += ` WHERE ${mongo_to_pg('data', query)}`;
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
        await this.single_query(`INSERT INTO ${this.name} (_id, data) VALUES ($1, $2)`, [String(_id), data]);
        // TODO: Implement type
        return {};
    }

    async insertMany(data, options) {

        let queries = [];
        const ordered = _.isUndefined(options.ordered) ? true : options.ordered;
        for (const doc of data) {
            const _id = this.get_id(doc);
            queries.push([String(_id), doc]);
        }
        if (ordered) {
            for (const args of queries) {
                await this.single_query(`INSERT INTO ${this.name} (_id, data) VALUES ($1, $2)`, args);
            }
        } else {
            await Promise.all(queries.map(args => this.single_query(`INSERT INTO ${this.name} (_id, data) VALUES ($1, $2)`, args)));
        }
        // TODO: Implement type
        return {};
    }

    async updateOne(selector, update, options = {}) {
        // console.warn('JENIA updateOne', selector, update, options);
        const pg_update = mongo_to_pg.convertUpdate('data', update);
        const pg_selector = mongo_to_pg('data', selector);
        let query = `UPDATE ${this.name} SET data = ${pg_update} WHERE ${pg_selector} RETURNING _id, data`;
        // console.warn('JENIA updateOne query', query);
        try {
            const res = await this.single_query(query);
            // console.warn('JENIA updateOne res', res);
            assert(res.rowCount <= 1, `_id must be unique. found ${res.rowCount} rows with _id=${selector._id} in table ${this.name}`);
            return res;
        } catch (err) {
            dbg.error(`updateOne failed`, selector, update, query, err);
        }
    }

    async updateMany(selector, update) {

        const pg_update = mongo_to_pg.convertUpdate('data', update);
        const pg_selector = mongo_to_pg('data', selector);
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

        const pg_selector = mongo_to_pg('data', selector);
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

        const sql_query = {};
        sql_query.select = options.projection ? mongo_to_pg.convertSelect('data', options.projection) : '*';
        sql_query.where = mongo_to_pg('data', query);
        sql_query.order_by = options.sort && mongo_to_pg.convertSort('data', options.sort);
        sql_query.limit = options.limit;
        sql_query.offset = options.skip;
        let query_string = `SELECT ${sql_query.select} FROM ${this.name} WHERE ${sql_query.where}`;
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
            return res.rows.map(row => this.decode_json(this.schema, row.data));
        } catch (err) {
            dbg.error('find failed', query, options, query_string, err);
            throw err;
        }

    }

    async findOne(query, options = {}) {

        let query_string = `SELECT * FROM ${this.name} WHERE ${mongo_to_pg('data', query)}`;
        if (options.sort) {
            query_string += ` ORDER BY ${mongo_to_pg.convertSort('data', options.sort)}`;
        }
        query_string += ' LIMIT 1';
        try {
            const res = await this.single_query(query_string);
            if (res.rowCount === 0) return null;
            return res.rows.map(row => this.decode_json(this.schema, row.data))[0];
        } catch (err) {
            dbg.error('findOne failed', query, query_string, err);
            throw err;
        }
    }

    async mapReduceListObjects(options) {

        const sql_query = {};
        let mr_q;
        sql_query.where = mongo_to_pg('data', options.query);
        sql_query.order_by = options.sort && mongo_to_pg.convertSort('data', options.sort);
        sql_query.limit = options.limit;
        let query_string = `SELECT * FROM ${this.name} WHERE ${sql_query.where}`;
        if (sql_query.order_by) {
            query_string += ` ORDER BY ${sql_query.order_by}`;
        }
        if (sql_query.limit) {
            query_string += ` LIMIT ${sql_query.limit}`;
        }
        try {
            mr_q = `SELECT _id, SUM(value) FROM map_common_prefixes('${options.scope.prefix || ''}', '${options.scope.delimiter || ''}', $$${query_string}$$) GROUP BY _id`;
            const res = await this.single_query(mr_q);
            return res.rows.map(row => {
                if (row.value) {
                    return _.defaults({ value: this.decode_json(this.schema, row.value) }, row);
                } else {
                    return row;
                }
            });
        } catch (err) {
            dbg.error('mapReduceListObjects failed', options, query_string, mr_q, err);
            throw err;
        }
    }

    async mapReduceAggregate(func, options) {

        let mr_q;
        let query_string;
        try {
            query_string = `SELECT * FROM ${this.name} WHERE ${mongo_to_pg('data', options.query)}`;
            mr_q = `SELECT _id, SUM(value) FROM ${func}($$${query_string}$$) GROUP BY _id`;
            const res = await this.single_query(mr_q);
            return res.rows;
        } catch (err) {
            dbg.error('mapReduceAggregate failed', func, options, query_string, mr_q, err);
            throw err;
        }
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
            default:
                throw new Error('TODO mapReduce');
        }
    }

    async distinct(property, query, options) {

        const sql_query = {};
        const select = {};
        select[property] = 1;
        sql_query.select = mongo_to_pg.convertSelect('data', select);
        sql_query.where = mongo_to_pg('data', query);
        sql_query.order_by = options.sort && mongo_to_pg.convertSort('data', options.sort);
        sql_query.limit = options.limit;
        sql_query.offset = options.skip;
        let query_string = `SELECT DISTINCT ON (data->'${property}') ${sql_query.select} FROM ${this.name} WHERE ${sql_query.where}`;
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
            return res.rows.map(row => this.decode_json(this.schema, row.data)[property]);
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
        const WHERE = mongo_to_pg('data', match);
        const P_GROUP = this._prepare_aggregate_group_query(group);
        try {
            const res = await this.single_query(`SELECT ${P_GROUP.SELECT} FROM ${this.name} WHERE ${WHERE} GROUP BY ${P_GROUP.GROUP_BY}`);
            return res.rows;
        } catch (err) {
            dbg.error('groupBy failed', match, group, WHERE, P_GROUP, err);
            throw err;
        }
    }

    async findOneAndUpdate(query, update, options) {
        const { upsert } = options;
        try {
            let response = null;
            await this.single_query('BEGIN');
            const update_res = await this.updateOne(query, update, options);
            if (update_res.rowCount > 0) {
                response = { value: update_res.rows.map(row => this.decode_json(this.schema, row.data))[0] };
            } else if (upsert) {
                const data = { _id: this.client.generate_id() };
                await this.insertOne(data);
                // TODO: This will $inc two times, since findOneAndUpdate will be called due to null response
                // Relevant to other ops besides $inc as well
                await this.updateOne(data, update, options);
            }
            await this.single_query('COMMIT');
            return response;
        } catch (err) {
            await this.single_query('ROLLBACK');
            dbg.error(`findOneAndUpdate failed`, query, update, options, err);
            throw err;
            // TODO: Should finally release?
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

        const pg_selector = mongo_to_pg('data', selector);
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

    decode_json(schema, val) {
        if (!schema) {
            return val;
        }
        if (schema.objectid === true) {
            return new mongodb.ObjectId(val);
        }
        if (schema.date === true) {
            return new Date(val);
        }

        if (schema.type === 'object') {
            const obj = {};
            for (const key of Object.keys(val)) {
                obj[key] = this.decode_json(schema.properties[key], val[key]);
            }
            return obj;
        }

        if (schema.type === 'array') {
            const item_schema = schema.items;
            const arr = [];
            for (const item of val) {
                arr.push(this.decode_json(item_schema, item));
            }
            return arr;
        }

        return val;
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
            await pg_client.query(`CREATE DATABASE ${this.new_pool_params.database}`);
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
        const postgres_port = parseInt(process.env.POSTGRES_PORT || '5432', 10);

        // TODO: This need to move to another function
        this.new_pool_params = {
            host: process.env.POSTGRES_HOST || '127.0.0.1',
            user: process.env.POSTGRES_USER || 'postgres',
            password: process.env.POSTGRES_PASSWORD || 'noobaa',
            database: process.env.POSTGRES_DBNAME || 'nbcore',
            port: postgres_port,
            ...params,
        };

        PostgresClient.implements_interface(this);
        this._ajv = new Ajv({ verbose: true, schemaId: 'auto', allErrors: true });
        this._ajv.addKeyword('date', schema_utils.KEYWORDS.date);
        this._ajv.addKeyword('idate', schema_utils.KEYWORDS.idate);
        this._ajv.addKeyword('objectid', schema_utils.KEYWORDS.objectid);
        this._ajv.addKeyword('binary', schema_utils.KEYWORDS.binary);
        this._ajv.addKeyword('wrapper', schema_utils.KEYWORDS.wrapper);
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
            if (pg_client) pg_client.end();
        }
    }

    define_collection(table_params) {
        if (_.find(this.tables, t => t.name === table_params.name)) {
            throw new Error('define_table: table already defined ' + table_params.name);
        }

        const table = new PostgresTable({ ...table_params, client: this });
        this.tables.push(table);

        if (this.pool) {
            table._create_table(this.pool).catch(_.noop); // TODO what is best to do when init_collection fails here?
        }

        return table;
    }

    async _init_collections(pool) {
        await Promise.all(this.tables.map(table => table._create_table(pool)));
        await this._load_sql_functions(pool);
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
            // this.pool.on('reconnect', () => {
            //     dbg.log('got reconnect', this.url);
            //     this.emit('reconnect');
            //     this._reset_connect_timeout();
            // });
            // this.mongo_client.db().on('close', () => {
            //     dbg.warn('got close', this.url);
            //     this.emit('close');
            //     this._set_connect_timeout();
            // });
            this.emit('reconnect');
            dbg.log0(`connected`);
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
            await promise_utils.delay_unblocking(3000);
            return this._connect(skip_init_db);
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
        return err && err.code === 11000;
    }

    // TODO: Figure out error codes
    is_err_namespace_exists(err) {
        return err && err.code === 48;
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
