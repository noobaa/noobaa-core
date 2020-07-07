/* Copyright (C) 2016 NooBaa */
'use strict';

const mocha = require('mocha');
const { PostgresClient } = require('../../util/postgres_client');
const mongo_utils = require('../../util/mongo_utils');
const assert = require('assert');
const _ = require('lodash');


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
        system: { objectid: true },
        name: { type: 'string' },
        deleted: { date: true },
        version: { type: 'integer' },
        enabled: { type: 'boolean' },
    }
};


const POSTGRES_PARAMS = {
    host: '127.0.0.1',
    port: 5432,
    user: 'postgres',
    password: 'noobaa',
    database: 'nbcore'
};

let postgres_client;
const test_table_name = 'test_table_' + Date.now();
let test_table;

mocha.describe('postgres_client', function() {

    mocha.before(async function() {
        postgres_client = new PostgresClient(POSTGRES_PARAMS);
        test_table = postgres_client.define_table({
            name: test_table_name,
            schema: test_schema,
            // db_indexes: test_indexes,
        });
        await postgres_client.wait_for_tables_init();
    });

    mocha.it('should insert_one data without errors', async function() {
        const data = {
            _id: postgres_client.generate_id(),
            system: postgres_client.generate_id(),
            name: 'test_record'
        };
        await test_table.insert_one(data);
    });

    mocha.it('should find existing id in the table', async function() {
        const data = {
            _id: postgres_client.generate_id(),
            system: postgres_client.generate_id(),
            name: 'test_record'
        };
        await test_table.insert_one(data);
        const find_res = await test_table.find({ _id: String(data._id) });
        const actual = {
            _id: mongo_utils.parse_object_id(find_res[0]._id),
            system: mongo_utils.parse_object_id(find_res[0].system),
            name: find_res[0].name,
        };
        const expected = data;
        assert.deepEqual(actual, expected, 'the returned data should match the inserted data');
    });

    mocha.it('should update one', async function() {
        const data = {
            _id: postgres_client.generate_id(),
            system: postgres_client.generate_id(),
            version: 2,
            name: 'test_record'
        };
        await test_table.insert_one(data);
        const now = new Date();
        await test_table.update_one({ _id: data._id }, { $set: { deleted: now }, $unset: { name: true }, $inc: { version: 3 } });
        const find_res = await test_table.find({ _id: String(data._id) });
        const actual = {
            _id: mongo_utils.parse_object_id(find_res[0]._id),
            system: mongo_utils.parse_object_id(find_res[0].system),
            // name: find_res[0].name,
            deleted: find_res[0].deleted,
            version: find_res[0].version
        };
        const expected = { _id: data._id, system: data.system, deleted: now, version: 5 };
        assert.deepEqual(actual, expected, 'the returned data should match the inserted data');
    });

    mocha.it('should find by sort order', async function() {
        const data1 = {
            _id: postgres_client.generate_id(),
            system: postgres_client.generate_id(),
            name: 'test_sort',
            version: 1
        };
        const data2 = {
            _id: postgres_client.generate_id(),
            system: postgres_client.generate_id(),
            name: 'test_sort',
            version: 2
        };
        const data3 = {
            _id: postgres_client.generate_id(),
            system: postgres_client.generate_id(),
            name: 'test_sort',
            version: 3
        };
        await test_table.insert_one(data1);
        await test_table.insert_one(data2);
        await test_table.insert_one(data3);
        const find_asc = await test_table.find({ name: 'test_sort' }, { sort: { version: 1 } });
        assert.deepEqual(find_asc.map(doc => doc.version), [1, 2, 3], 'the returned data should be sorted by ascending version');
        const find_des = await test_table.find({ name: 'test_sort' }, { sort: { version: -1 } });
        assert.deepEqual(find_des.map(doc => doc.version), [3, 2, 1], 'the returned data should be sorted by descending version');
    });

    mocha.it('should find with limit', async function() {
        const data1 = {
            _id: postgres_client.generate_id(),
            system: postgres_client.generate_id(),
            name: 'test_limit',
            version: 1
        };
        const data2 = {
            _id: postgres_client.generate_id(),
            system: postgres_client.generate_id(),
            name: 'test_limit',
            version: 2
        };
        const data3 = {
            _id: postgres_client.generate_id(),
            system: postgres_client.generate_id(),
            name: 'test_limit',
            version: 3
        };
        await test_table.insert_one(data1);
        await test_table.insert_one(data2);
        await test_table.insert_one(data3);
        const find_res = await test_table.find({ name: 'test_limit' }, { limit: 1 });
        assert.deepEqual(find_res, [data1], 'the returned data should be only data1');
    });

    mocha.it('should find with skip', async function() {
        const data1 = {
            _id: postgres_client.generate_id(),
            system: postgres_client.generate_id(),
            name: 'test_skip',
            version: 1
        };
        const data2 = {
            _id: postgres_client.generate_id(),
            system: postgres_client.generate_id(),
            name: 'test_skip',
            version: 2
        };
        const data3 = {
            _id: postgres_client.generate_id(),
            system: postgres_client.generate_id(),
            name: 'test_skip',
            version: 3
        };
        await test_table.insert_one(data1);
        await test_table.insert_one(data2);
        await test_table.insert_one(data3);
        const find_res = await test_table.find({ name: 'test_skip' }, { skip: 1 });
        assert.deepEqual(find_res, [data2, data3], 'the returned data should be only data2 and data3');
    });

    mocha.it('should find with projection', async function() {
        const data1 = {
            _id: postgres_client.generate_id(),
            system: postgres_client.generate_id(),
            name: 'test_projection',
            version: 1
        };
        await test_table.insert_one(data1);
        const find_res = await test_table.find({ name: 'test_projection' }, { projection: { name: 1, version: 1 } });
        assert.deepEqual(find_res, [_.pick(data1, ['_id', 'name', 'version'])], 'the returned data should contain only id, name and version');
    });


});