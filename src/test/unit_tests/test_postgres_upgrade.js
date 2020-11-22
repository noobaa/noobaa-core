/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
// const coretest = require('./coretest');
const mocha = require('mocha');
const { Migrator } = require('../../upgrade/migrator');
const assert = require('assert');
const EventEmitter = require('events').EventEmitter;
const _ = require('lodash');
const postgres_client = require('../../util/postgres_client');
const wtf = require('wtfnode');


// coretest.setup({ pools_to_create: [], db_name: 'upgradetest' });
process.env.CORETEST = 'upgrade-test';

const default_schema = {
    id: 'default_schema',
    type: 'object',
    required: [
        '_id',
        'key1',
        'key2',
        'key3',
    ],
    properties: {
        _id: { objectid: true },
        key1: { type: 'string' },
        key2: { type: 'boolean' },
        key3: {
            type: 'array',
            items: {
                type: 'string',
                enum: ['val1', 'val2', 'val3', 'val4']
            }
        },
        key4: {
            type: 'object',
            properties: {
                key1: {
                    type: 'number',
                },
                key2: {
                    type: 'string',
                },
                when: {
                    date: true
                }
            }
        },
        epoch: {
            idate: true
        }
    }
};

class TestCollection {

    /**
     * @param {TestCollection} col
     * @returns {nb.DBCollection}
     */
    static implements_interface(col) { return col; }

    constructor(col, size) {
        TestCollection.implements_interface(this);
        this.schema = col.schema;
        this.name = col.name;
        this.db_indexes = col.db_indexes;
        this.size = size;
        this.data = _.times(this.size, i => ({ _id: i + 1,
            key1: 'value1-' + i,
            key2: Boolean(i % 2),
            key3: _.times(i % 10, j => 'val' + j),
            key4: {
                key1: i,
                key2: 'val2-' + i,
                when: new Date(),
            },
            epoch: Date.now(),
        }));
    }

    async find(query, options = {}) {
        const start = (query && query._id && query._id.$gt) || 0;
        const end = options.limit ? start + options.limit : this.size;
        return this.data.slice(start, end);
    }

    async countDocuments(query) {
        if (_.isEmpty(query)) return this.size;
    }
}

class TestClient extends EventEmitter {
    /**
     * @param {TestClient} client
     * @returns {nb.DBClient}
     */
    static implements_interface(client) { return client; }

    constructor(size) {
        super();
        TestClient.implements_interface(this);
        this.collections = {};
        this.size = size;
    }

    async connect(skip_init_db) {
        console.log('connected!');
    }

    async disconnect(skip_init_db) {
        console.log('bye!');
    }

    /**
     * 
     * @returns {nb.DBCollection}
     */
    define_collection(col) {
        if (this.collections[col.name]) {
            throw new Error('define_collection: collection already defined ' + col.name);
        }
        const test_collection = new TestCollection(col, this.size, this);
        this.collections[col.name] = test_collection;
        return test_collection;
    }

    /**
     * 
     * @returns {nb.DBCollection}
     */
    collection(col_name) {
        return this.collections[col_name];
    }
}

mocha.describe('upgrade_mongo_postgress', function() {
    let to_client;

    async function announce(msg) {
        if (process.env.SUPPRESS_LOGS) return;
        const l = Math.max(80, msg.length + 4);
        console.log('='.repeat(l));
        console.log('=' + ' '.repeat(l - 2) + '=');
        console.log('= ' + msg + ' '.repeat(l - msg.length - 3) + '=');
        console.log('=' + ' '.repeat(l - 2) + '=');
        console.log('='.repeat(l));
    }

    mocha.after('upgradetest-after-all', async function() {
        // to_client.disconnect();
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

    mocha.beforeEach('upgradetest-before', async function() {
        this.timeout(60000); // eslint-disable-line no-invalid-this
        to_client = new postgres_client.PostgresClient();
        to_client.set_db_name('upgrade_test');
        await to_client.connect();
        await announce('db_client dropDatabase()');
        await to_client.dropDatabase();
        await announce('db_client createDatabase()');
        await to_client.createDatabase();
        await to_client.disconnect();
    });

    mocha.afterEach('clean-test', async function() {
        await to_client.disconnect();
    });

    mocha.it('verify moving one collection with many rows', async function() {
        this.timeout(60000); // eslint-disable-line no-invalid-this
        const collection_size = 3000;
        const from_client = new TestClient(collection_size);
        const collections = _.times(1, i => ({
            name: 'test1_collection' + i,
            schema: default_schema,
        }));
        const migrator = new Migrator(from_client, to_client, collections);
        await migrator.migrate_db();
        await to_client.connect();
        const new_table = to_client.collection(collections[0].name);
        assert.strictEqual(await new_table.countDocuments(), collection_size);
        await to_client.disconnect();
    });

    mocha.it('verify moving many collection with few rows', async function() {
        this.timeout(60000); // eslint-disable-line no-invalid-this
        const collection_number = 100;
        const collection_size = 30;
        const from_client = new TestClient(collection_size);
        const collections = _.times(collection_number, i => ({
            name: 'test2_collection' + i,
            schema: default_schema,
        }));
        const migrator = new Migrator(from_client, to_client, collections);
        await migrator.migrate_db();
        await to_client.connect();
        for (let i = 0; i < collection_number; ++i) {
            const table = to_client.collection(collections[i].name);
            assert.strictEqual(await table.countDocuments(), collection_size);
        }
        await to_client.disconnect();
    });

    mocha.it('verify a collection from after spesific marker', async function() {
        this.timeout(60000); // eslint-disable-line no-invalid-this
        const collection_number = 4;
        const collection_size = 350;
        const from_client = new TestClient(collection_size);
        const collections = _.times(collection_number, i => ({
            name: 'test3_collection' + i,
            schema: default_schema,
        }));
        to_client.define_collection({ name: 'migrate_status' });
        await to_client.connect();
        await to_client.collection('migrate_status').updateOne({}, {
            collection_index: collection_number / 2,
            marker: collection_size / 2,
        });
        to_client.tables = [];
        await to_client.disconnect();
        const migrator = new Migrator(from_client, to_client, collections);
        await migrator.migrate_db();
        await to_client.connect();
        for (let i = (collection_number / 2); i < collection_number; ++i) {
            const table_i = to_client.collection(collections[i].name);
            assert.strictEqual(await table_i.countDocuments(), collection_size);
        }
        await to_client.disconnect();
    });

    mocha.it('verify a collection moved success with wrong marker', async function() {
        this.timeout(60000); // eslint-disable-line no-invalid-this
        const collection_number = 4;
        const collection_size = 350;
        let from_client = new TestClient(collection_size);
        const collections = _.times(collection_number, i => ({
            name: 'test4_collection' + i,
            schema: default_schema,
        }));
        let migrator = new Migrator(from_client, to_client, collections.slice(0, collection_number / 2));
        await migrator.migrate_db();
        await to_client.connect();
        await to_client.collection('migrate_status').updateOne({}, { $set: {collection_index: (collection_number / 2) - 1}});
        await to_client.disconnect();
        from_client = new TestClient(collection_size);
        to_client = new postgres_client.PostgresClient();
        to_client.set_db_name('upgrade_test');
        migrator = new Migrator(from_client, to_client, collections);
        await migrator.migrate_db();
        await to_client.connect();
        for (let i = 0; i < collection_number; ++i) {
            const table = to_client.collection(collections[i].name);
            assert.strictEqual(await table.countDocuments(), collection_size);
        }
        await to_client.disconnect();
    });

});
