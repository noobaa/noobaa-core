/* Copyright (C) 2016 NooBaa */
'use strict';

// TODO: Should implement the test

const mocha = require('mocha');
const { PostgresClient } = require('../../util/postgres_client');
const SensitiveString = require('../../util/sensitive_string');
// const db_client = require('../../util/db_client');
const assert = require('assert');
// const { find } = require('tslint/lib/utils');
const _ = require('lodash');
const wtf = require('wtfnode');
const P = require('../../util/promise');
// const { date } = require('azure-storage');


const test_schema = {
    $id: 'test_postgres_client_schema',
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
    host: 'localhost',
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



async function get_postgres_client(params) {
    let pgc = new PostgresClient(params);
    await pgc.connect();
    console.log('deleting old database', params.database);
    await pgc.dropDatabase();
    console.log('creating new database', params.database);
    await pgc.createDatabase();
    console.log('created database successfully', params.database);
    return pgc;
}





mocha.describe('postgres_client', function() {

    // eslint-disable-next-line no-invalid-this
    this.timeout(10000);

    mocha.before('postgres-client-test-before-all', async function() {
        postgres_client = await get_postgres_client(POSTGRES_PARAMS);
        test_table = postgres_client.define_collection({
            name: test_table_name,
            schema: test_schema,
            // db_indexes: test_indexes,
        });
        await test_table.init_promise;
    });

    mocha.after('postgres-client-test-after-all', async function() {
        postgres_client.disconnect();
        let tries_left = 3;
        setInterval(function check_dangling_handles() {
            tries_left -= 1;
            console.info(`Waiting for dangling handles to release, re-sample in 30s (tries left: ${tries_left})`);
            wtf.dump();

            if (tries_left === 0) {
                console.error('Tests cannot complete successfully, running tests resulted in dangling handles');

                // Force the test suite to fail (ignoring the exist handle that mocha sets up in order to return a fail
                // exit code)
                process.removeAllListeners('exit');
                process.exit(1);
            }
        }, 30000).unref();

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
        assert.deepStrictEqual(find_res[0], data, 'the returned data should match the inserted data');
    });

    mocha.it('should update one', async function() {
        const data = {
            _id: postgres_client.generate_id(),
            objectid_field: postgres_client.generate_id(),
            string_field: 'test update',
            date_field: test_date,
            int_field: 1,
            bool_field: true,
            bin_field: test_binary,
            idate_field: test_idate,
            sensitive_string: new SensitiveString('sensitive data'),
            other: additional_properties
        };
        await test_table.insertOne(data);
        const now = new Date();
        await test_table.updateOne({ _id: data._id }, {
            $set: { date_field: now },
            $unset: { string_field: true },
            $inc: { int_field: 3 }
        });
        const find_res = await test_table.find({ _id: data._id });
        // const actual = {
        //     _id: db_client.instance().parse_object_id(find_res[0]._id),
        //     system: db_client.instance().parse_object_id(find_res[0].system),
        //     // name: find_res[0].name,
        //     deleted: find_res[0].deleted,
        //     version: find_res[0].version
        // };
        const expected = _.omit({ ...data, date_field: now, int_field: 4 }, 'string_field');

        assert.deepStrictEqual(find_res[0], expected, 'the returned data should match the inserted data');
    });



    mocha.it('should insert a single doc on multiple parallel upserts', async function() {
        let upsert_table = postgres_client.define_collection({
            name: `upsert_${test_table_name}`,
            schema: test_schema,
            // db_indexes: test_indexes,
        });
        await upsert_table.init_promise;
        const query = {};
        const update = { $inc: { int_field: 1 } };
        const options = { upsert: true, returnOriginal: false };

        // perform parallel upserts
        const num_upserts = 40;
        await P.map(_.times(num_upserts), async i => upsert_table.findOneAndUpdate(query, update, options));
        // check that there is only one doc and the int_field is as num_upserts
        let find_res = await upsert_table.find({});
        assert.strictEqual(find_res.length, 1, 'number of inserted documents must be 1');
    });

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
    //     assert.deepStrictEqual(find_asc.map(doc => doc.version), [1, 2, 3], 'the returned data should be sorted by ascending version');
    //     const find_des = await test_table.find({ name: 'test_sort' }, { sort: { version: -1 } });
    //     assert.deepStrictEqual(find_des.map(doc => doc.version), [3, 2, 1], 'the returned data should be sorted by descending version');
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
    //     assert.deepStrictEqual(find_res, [data1], 'the returned data should be only data1');
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
    //     assert.deepStrictEqual(find_res, [data2, data3], 'the returned data should be only data2 and data3');
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
    //     assert.deepStrictEqual(find_res, [_.pick(data1, ['_id', 'name', 'version'])], 'the returned data should contain only id, name and version');
    // });


});
