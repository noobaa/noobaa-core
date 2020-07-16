/* Copyright (C) 2016 NooBaa */
/*eslint no-use-before-define: ["error", { "classes": false }]*/
'use strict';

const _ = require('lodash');

const assert = require('assert');
const Ajv = require('ajv');
const util = require('util');
const EventEmitter = require('events').EventEmitter;
const { Pool } = require('pg');

const dbg = require('./debug_module')(__filename);
const common_api = require('../api/common_api');
const schema_utils = require('./schema_utils');
const promise_utils = require('./promise_utils');
const { ObjectId } = require('mongodb');
const mongo_to_pg = require('mongo-query-to-postgres-jsonb');



let query_counter = 0;

function pg_log(...args) {
    dbg.log0(...args);
}

function pg_error(...args) {
    dbg.error(...args);
}

async function _do_query(client, q, transaction_counter) {
    // DZDZ change all logs to higher log level or remove;
    query_counter += 1;
    const tag = `T${_.padStart(transaction_counter, 8, '0')}|Q${_.padStart(query_counter, 8, '0')}`;
    try {
        pg_log(`postgres_client: ${tag}: ${q.text}`, util.inspect(q.values, { depth: 6 }));
        const res = await client.query(q);
        pg_log(`postgres_client: ${tag}: got result:`, util.inspect(res, { depth: 6 }));
        return res;
    } catch (err) {
        dbg.error(`postgres_client: ${tag}: failed with error:`, err);
        throw err;
    }
}


class PgTransaction {

    constructor(table) {
        this.table = table;
        this.length = 0;
        this.pool = table.pool;
        this.operations = [];
        this._init = this._begin();
    }

    async _begin() {
        this.client = await this.pool.connect();
        await _do_query(this.client, { text: 'BEGIN TRANSACTION' });
        // await this._query('BEGIN TRANSACTION');
        this._init = null;
    }

    async insert(data) {
        // await this.wait_for_table_init();
        const _id = this.table.get_id(data);
        return this._query(`INSERT INTO ${this.table.name} (_id, data) VALUES ($1, $2)`, [String(_id), data]);
        // this.operations.push([`INSERT INTO ${this.table.name} (_id, data) VALUES ($1, $2)`, [String(_id), data]]);
    }

    async findAndUpdateOne(find, update) { // selector, update) {
        const pg_update = mongo_to_pg.convertUpdate('data', update);
        const pg_selector = mongo_to_pg('data', find);
        const query = `UPDATE ${this.table.name} SET data = ${pg_update} WHERE ${pg_selector}`;
        return this._query(query);
        // this.operations.push([query]);
        // return Promise.resolve()
        //     .then(async () => {
        //         try {
        //             const { rowCount } = await this._query(query);
        //             assert(rowCount <= 1, `_id must be unique. found ${rowCount} rows with _id=${find._id} in table ${this.table.name}`);
        //         } catch (err) {
        //             dbg.error(`update_one failed`, find, update, query, err);
        //             throw err;
        //         }
        //     });
    }

    async findAndRemoveOne(find) { // selector, update) {
        const pg_selector = mongo_to_pg('data', find);
        const query = `DELETE FROM ${this.table.name} WHERE ${pg_selector}`;
        return this._query(query);
        // this.operations.push([query]);
        // return Promise.resolve()
        //     .then(async () => {
        //         try {
        //             const { rowCount } = await this._query(query);
        //             assert(rowCount <= 1, `_id must be unique. found ${rowCount} rows with _id=${find._id} in table ${this.table.name}`);
        //         } catch (err) {
        //             dbg.error(`update_one failed`, find, update, query, err);
        //             throw err;
        //         }
        //     });
    }

    async _query(text, values) {
        // if (this.should_begin) {
        //     this.should_begin = false;
        //     await this._begin();
        // }
        const q = { text, values };
        this.length += 1;
        this.operations.push({ q, length: this.length });
        // await this.begin_transaction;
        // return _do_query(this.client, q, this.length);
    }

    async execute() {
        try {
            await promise_utils.wait_until(() => this._init === null);
            await Promise.all(this.operations.map(args => _do_query(this.client, args.q, args.length)));
            await this._commit();
        } catch (err) {
            pg_error('PgTransaction execute error', err);
            await this._rollback();
            throw err;
        } finally {
            this.client.release();
        }
    }

    async _commit() {
        await _do_query(this.client, { text: 'COMMIT TRANSACTION' });
        // this.client.release();
    }

    async _rollback() {
        await _do_query(this.client, { text: 'ROLLBACK TRANSACTION' });
        // await this._query('ROLLBACK TRANSACTION');
        // this.client.release();
    }

}


// function update_data(data, set_updates, unset_updates, inc_updates) {
//     // set updates
//     if (set_updates) {
//         _.each(set_updates, (val, key) => {
//             _.set(data, key, val);
//         });
//     }

//     // unset updates
//     if (unset_updates) {
//         for (const key of Object.keys(unset_updates)) {
//             _.unset(data, key);
//         }
//     }

//     if (inc_updates) {
//         _.each(inc_updates, (increment, key) => {
//             let val = _.get(data, key, 0);
//             val += increment;
//             _.set(data, key, val);
//         });
//     }
// }


class PostgresTable {
    constructor(table_params) {
        this._ajv = table_params.ajv;
        if (table_params.schema) {
            schema_utils.strictify(table_params.schema, {
                additionalProperties: false
            });
            this._ajv.addSchema(table_params.schema, table_params.name);
            table_params.validate = (doc, warn) => this.validate(table_params.name, doc, warn);
        }

        this.name = table_params.name;
        this.db_indexes = table_params.db_indexes;
        this.schema = table_params.schema;
        this.pool = table_params.pool;

        // this.set_table_functions(table_params);

        // DZDZ - find a better location to call init_table to avoid a race condition 
        // where a store is trying to query before the table is created
        this._init = this._init_table(table_params).then(() => {
            this._init = null;
        }).catch(err => {
            dbg.error(`got error on init_table ${table_params.name}`, err);
        });
    }

    initializeUnorderedBulkOp() {
        return new PgTransaction(this);
    }

    async _init_table(table_params) {
        try {
            // DZDZ - consider what should the id type be, check dependency in mongo objectid
            pg_log(`creating table ${table_params.name}`);
            await this.single_query(`CREATE TABLE IF NOT EXISTS ${table_params.name} (_id char(24) PRIMARY KEY, data jsonb)`);
        } catch (err) {
            dbg.error('got error on _init_table:', err);
            throw err;
        }
        //DZDZ TODO: create indexes
    }

    async wait_for_table_init() {
        if (this._init) {
            await this._init;
        }
    }

    async single_query(text, values) {
        const q = { text, values };
        // for simple queries pass pool to use pool.query
        const client = this.pool;
        return _do_query(client, q, 0);
    }

    get_id(data) {
        if (!data || !data._id) {
            throw new Error('data does not contain _id field');
        }
        return data._id;
    }

    async countDocuments(query) {
        let query_string = `SELECT COUNT(*) FROM ${this.name}`;
        if (!_.isEmpty(query)) query_string += ` WHERE ${mongo_to_pg('data', query)}`;
        try {
            const count = await this.single_query(query_string);
            return count;
        } catch (err) {
            dbg.error('countDocuments failed', query, query_string, err);
            throw err;
        }
    }

    async insert_one(data) {
        await this.wait_for_table_init();
        const _id = this.get_id(data);
        await this.single_query(`INSERT INTO ${this.name} (_id, data) VALUES ($1, $2)`, [String(_id), data]);
    }

    async update_one(selector, update) {
        await this.wait_for_table_init();
        const pg_update = mongo_to_pg.convertUpdate('data', update);
        const pg_selector = mongo_to_pg('data', selector);
        const query = `UPDATE ${this.name} SET data = ${pg_update} WHERE ${pg_selector}`;
        try {
            const { rowCount } = await this.single_query(query);
            assert(rowCount <= 1, `_id must be unique. found ${rowCount} rows with _id=${selector._id} in table ${this.name}`);
        } catch (err) {
            dbg.error(`update_one failed`, selector, update, query, err);
        }
    }

    async update_many(selector, update) {
        await this.wait_for_table_init();
        const pg_update = mongo_to_pg.convertUpdate('data', update);
        const pg_selector = mongo_to_pg('data', selector);
        const query = `UPDATE ${this.name} SET data = ${pg_update} WHERE ${pg_selector}`;
        try {
            await this.single_query(query);
        } catch (err) {
            dbg.error(`update_many failed`, selector, update, query, err);
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

    async findOne(query) {
        const query_string = `SELECT * FROM ${this.name} WHERE ${mongo_to_pg('data', query)} LIMIT 1`;
        try {
            const res = await this.single_query(query_string);
            return res.rows.map(row => this.decode_json(this.schema, row.data))[0];
        } catch (err) {
            dbg.error('findOne failed', query, query_string, err);
            throw err;
        }
    }


    // table.find_equal = async eq_query => {
    //     await this.wait_for_table_init(table);
    //     const { condition, vals } = this.create_equal_condition(eq_query);
    //     const res = await this.single_query(`SELECT data FROM ${table.name} WHERE ${condition}`, vals);
    //     return res.rows.map(row => this.decode_json(table.schema, row.data));
    // };

    // create_equal_condition(query) {
    //     const vals = [];
    //     let param_counter = 0;
    //     const condition = _.map(query, (val, key) => {
    //         vals.push(val);
    //         param_counter += 1;
    //         return `data->>'${key}' = $${param_counter}`;
    //     }).join(' AND ');
    //     return { condition, vals };
    // }



    // table.update_one = async (_id, set_updates, unset_updates, inc_updates) => {
    //     await this.wait_for_table_init(table);
    //     const t = new PgTransaction(this.pool);
    //     try {
    //         // using FOR UPDATE will lock the row until COMMIT
    //         const res = await t.query(`SELECT * FROM ${table.name} WHERE _id = $1 FOR UPDATE`, [_id]);
    //         if (res.rows.length > 0) {
    //             const { data } = res.rows[0];
    //             update_data(data, set_updates, unset_updates, inc_updates);
    //             const { rowCount } = await t.query(`UPDATE ${table.name} SET data = $1 WHERE _id = $2`, [data, _id]);
    //             assert(rowCount <= 1, `_id must be unique. found ${rowCount} rows with _id=${_id} in table ${table.name}`);
    //         }
    //         await t.commit();
    //     } catch (err) {
    //         await t.rollback();
    //         throw err;
    //     }
    // };

    // table.update_many = async (_ids, set_updates, unset_updates, inc_updates) => {
    //     await this.wait_for_table_init(table);
    //     const t = new PgTransaction(this.pool);
    //     try {
    //         // using FOR UPDATE will lock the row until COMMIT
    //         const res = await t.query(`SELECT * FROM ${table.name} WHERE _id IN $1 FOR UPDATE`, [_ids]);
    //         for (const row of res.rows) {
    //             const { data } = row;
    //             update_data(data, set_updates, unset_updates, inc_updates);
    //         }
    //         await t.query(`UPDATE ${table.name} AS t SET data = c.data FROM (VALUES $1) AS c(_id, data) WHERE c._id = t._id;`, res.rows);
    //         await t.commit();
    //     } catch (err) {
    //         await t.rollback();
    //         throw err;
    //     }
    // };


    validate(doc, warn) {
        const validator = this._ajv.getSchema(this.name);
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
        // console.log(`DZDZ: decode_json`, schema, val);
        if (!schema) {
            return val;
        }
        if (schema.objectid === true) {
            return new ObjectId(val);
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


}


class PostgresClient extends EventEmitter {

    constructor(params) {
        super();
        this.tables = [];

        this._ajv = new Ajv({ verbose: true, schemaId: 'auto', allErrors: true });
        this._ajv.addKeyword('date', schema_utils.KEYWORDS.date);
        this._ajv.addKeyword('idate', schema_utils.KEYWORDS.idate);
        this._ajv.addKeyword('objectid', schema_utils.KEYWORDS.objectid);
        this._ajv.addKeyword('binary', schema_utils.KEYWORDS.binary);
        this._ajv.addKeyword('wrapper', schema_utils.KEYWORDS.wrapper);
        this._ajv.addSchema(common_api);

        const postgres_port = parseInt(process.env.POSTGRES_PORT || '5432', 10);

        const new_pool_params = {
            host: process.env.POSTGRES_HOST || '127.0.0.1',
            user: process.env.POSTGRES_USER || 'postgres',
            password: process.env.POSTGRES_PASSWORD || 'noobaa',
            database: process.env.POSTGRES_DBNAME || 'nbcore',
            port: postgres_port,
            ...params,
        };
        //DZDZ - check if we need to listen for events from pool (https://node-postgres.com/api/pool#events)
        this.pool = new Pool(new_pool_params);
        // this.emit('reconnect');
    }

    /**
     * @returns {PostgresClient}
     */
    static instance() {
        if (!PostgresClient._instance) PostgresClient._instance = new PostgresClient();
        return PostgresClient._instance;
    }

    define_collection(table_params) {
        return this.define_table(table_params);
    }

    define_table(table_params) {
        if (_.find(this.tables, t => t.name === table_params.name)) {
            throw new Error('define_table: table already defined ' + table_params.name);
        }

        const table = new PostgresTable({ ...table_params, ajv: this._ajv, pool: this.pool });
        this.tables.push(table);

        return table;
    }

    async wait_for_tables_init() {
        await Promise.all(this.tables.map(table => table.wait_for_table_init()));
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
        return new ObjectId();
    }

    collection(name) {
        return this.table(name);
    }

    table(name) {
        const table = _.find(this.tables, t => t.name === name);
        if (!table) {
            throw new Error('table: table not defined ' + name);
        }
        return table;
    }

    is_connected() {
        return true;
    }

    connect() {
        return Promise.resolve(true);
    }
}


PostgresClient._instance = undefined;

// EXPORTS
exports.PostgresClient = PostgresClient;
exports.instance = PostgresClient.instance;
