/* Copyright (C) 2016 NooBaa */
'use strict';

// TODO: Should implement the test

const mocha = require('mocha');
const { PostgresClient } = require('../../util/postgres_client');
const SensitiveString = require('../../util/sensitive_string');
// const db_client = require('../../util/db_client');
const assert = require('assert');
// const _ = require('lodash');
// const { date } = require('azure-storage');


const test_schema = {
    id: 'test_postgres_client_schema',
    type: 'object',
    required: [
        '_id',
        'system',
        'name',
    ],
    properties: {
        _id: { objectid: true },
        objectid_field: { objectid: true },
        string_field: { type: 'string' },
        date_field: { date: true },
        int_field: { type: 'integer' },
        bool_field: { type: 'boolean' },
        bin_field: { binary: true },
        idate_field: { idate: true },
        sensitive_string: { wrapper: SensitiveString },
        noschema_field: {
            type: 'object',
            additionalProperties: true,
            properties: {}
        }
    }
};


const POSTGRES_PARAMS = {
    host: '127.0.0.1',
    port: 5432,
    user: 'postgres',
    password: 'noobaa',
    database: 'test_postgres_client'
};

let postgres_client;
const test_table_name = 'test_table_' + Date.now();
let test_table;

const test_date = new Date();
const test_idate = Date.now();
const test_binary = Buffer.from('this is a test buffer');
const additional_properties = { a: 1, b: '2', c: 3.14 };


mocha.describe('postgres_client', function() {

    mocha.before(async function() {
        postgres_client = new PostgresClient(POSTGRES_PARAMS);
        await postgres_client.connect();
        console.log('deleting old database', POSTGRES_PARAMS.database);
        await postgres_client.dropDatabase();
        console.log('creating new database', POSTGRES_PARAMS.database);
        await postgres_client.createDatabase();
        console.log('created database succesfuly', POSTGRES_PARAMS.database);

        test_table = postgres_client.define_collection({
            name: test_table_name,
            schema: test_schema,
            // db_indexes: test_indexes,
        });
        await test_table.init_promise;
    });

    mocha.it('should insert_one data without errors', async function() {
        const data = {
            _id: postgres_client.generate_id(),
            objectid_field: postgres_client.generate_id(),
            string_field: 'test_record',
            date_field: test_date,
            int_field: 1,
            bool_field: true,
            bin_field: test_binary,
            idate_field: test_idate,
            sensitive_string: new SensitiveString('sensitive data'),
            other: additional_properties
        };
        await test_table.insertOne(data);
    });

    mocha.it('should find existing id in the table', async function() {
        const data = {
            _id: postgres_client.generate_id(),
            objectid_field: postgres_client.generate_id(),
            string_field: 'test insert and find',
            date_field: test_date,
            int_field: 1,
            bool_field: true,
            bin_field: test_binary,
            idate_field: test_idate,
            sensitive_string: new SensitiveString('sensitive data'),
            other: additional_properties
        };
        await test_table.insertOne(data);
        const find_res = await test_table.find({ _id: String(data._id) });
        assert.deepEqual(find_res[0], data, 'the returned data should match the inserted data');
    });

    // mocha.it('should update one', async function() {
    //     const data = {
    //         _id: postgres_client.generate_id(),
    //         system: postgres_client.generate_id(),
    //         version: 2,
    //         name: 'test_record'
    //     };
    //     await test_table.insert_one(data);
    //     const now = new Date();
    //     await test_table.update_one({ _id: data._id }, { $set: { deleted: now }, $unset: { name: true }, $inc: { version: 3 } });
    //     const find_res = await test_table.find({ _id: String(data._id) });
    //     const actual = {
    //         _id: db_client.instance().parse_object_id(find_res[0]._id),
    //         system: db_client.instance().parse_object_id(find_res[0].system),
    //         // name: find_res[0].name,
    //         deleted: find_res[0].deleted,
    //         version: find_res[0].version
    //     };
    //     const expected = { _id: data._id, system: data.system, deleted: now, version: 5 };
    //     assert.deepEqual(actual, expected, 'the returned data should match the inserted data');
    // });

    // mocha.it('should find by sort order', async function() {
    //     const data1 = {
    //         _id: postgres_client.generate_id(),
    //         system: postgres_client.generate_id(),
    //         name: 'test_sort',
    //         version: 1
    //     };
    //     const data2 = {
    //         _id: postgres_client.generate_id(),
    //         system: postgres_client.generate_id(),
    //         name: 'test_sort',
    //         version: 2
    //     };
    //     const data3 = {
    //         _id: postgres_client.generate_id(),
    //         system: postgres_client.generate_id(),
    //         name: 'test_sort',
    //         version: 3
    //     };
    //     await test_table.insert_one(data1);
    //     await test_table.insert_one(data2);
    //     await test_table.insert_one(data3);
    //     const find_asc = await test_table.find({ name: 'test_sort' }, { sort: { version: 1 } });
    //     assert.deepEqual(find_asc.map(doc => doc.version), [1, 2, 3], 'the returned data should be sorted by ascending version');
    //     const find_des = await test_table.find({ name: 'test_sort' }, { sort: { version: -1 } });
    //     assert.deepEqual(find_des.map(doc => doc.version), [3, 2, 1], 'the returned data should be sorted by descending version');
    // });

    // mocha.it('should find with limit', async function() {
    //     const data1 = {
    //         _id: postgres_client.generate_id(),
    //         system: postgres_client.generate_id(),
    //         name: 'test_limit',
    //         version: 1
    //     };
    //     const data2 = {
    //         _id: postgres_client.generate_id(),
    //         system: postgres_client.generate_id(),
    //         name: 'test_limit',
    //         version: 2
    //     };
    //     const data3 = {
    //         _id: postgres_client.generate_id(),
    //         system: postgres_client.generate_id(),
    //         name: 'test_limit',
    //         version: 3
    //     };
    //     await test_table.insert_one(data1);
    //     await test_table.insert_one(data2);
    //     await test_table.insert_one(data3);
    //     const find_res = await test_table.find({ name: 'test_limit' }, { limit: 1 });
    //     assert.deepEqual(find_res, [data1], 'the returned data should be only data1');
    // });

    // mocha.it('should find with skip', async function() {
    //     const data1 = {
    //         _id: postgres_client.generate_id(),
    //         system: postgres_client.generate_id(),
    //         name: 'test_skip',
    //         version: 1
    //     };
    //     const data2 = {
    //         _id: postgres_client.generate_id(),
    //         system: postgres_client.generate_id(),
    //         name: 'test_skip',
    //         version: 2
    //     };
    //     const data3 = {
    //         _id: postgres_client.generate_id(),
    //         system: postgres_client.generate_id(),
    //         name: 'test_skip',
    //         version: 3
    //     };
    //     await test_table.insert_one(data1);
    //     await test_table.insert_one(data2);
    //     await test_table.insert_one(data3);
    //     const find_res = await test_table.find({ name: 'test_skip' }, { skip: 1 });
    //     assert.deepEqual(find_res, [data2, data3], 'the returned data should be only data2 and data3');
    // });

    // mocha.it('should find with projection', async function() {
    //     const data1 = {
    //         _id: postgres_client.generate_id(),
    //         system: postgres_client.generate_id(),
    //         name: 'test_projection',
    //         version: 1
    //     };
    //     await test_table.insert_one(data1);
    //     const find_res = await test_table.find({ name: 'test_projection' }, { projection: { name: 1, version: 1 } });
    //     assert.deepEqual(find_res, [_.pick(data1, ['_id', 'name', 'version'])], 'the returned data should contain only id, name and version');
    // });


});
