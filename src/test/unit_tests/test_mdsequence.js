/* Copyright (C) 2022 NooBaa */
'use strict';

const mocha = require('mocha');
const { PostgresClient } = require('../../util/postgres_client');
const assert = require('assert');
const { MongoSequence } = require('../../util/mongo_client');

async function get_postgres_client(params) {
    let pgc = new PostgresClient(params);
    await pgc.connect();
    return pgc;
}

mocha.describe('mdsequence', function() {
    if (process.env.DB_TYPE !== 'postgres') {
        console.log('Skip mdsequence test DB_TYPE', process.env.DB_TYPE);
        return;
    }

    const POSTGRES_PARAMS = {
        database: 'coretest',
    };
    let postgres_client;

    mocha.before('mdsequence-test-before-all', async function() {
        postgres_client = await get_postgres_client(POSTGRES_PARAMS);
    });

    mocha.after('mdsequence-test-after-all', async function() {
        postgres_client.disconnect();
    });

    mocha.it('should migrate from mongo sequence', async function() {
        const name = 'testsequence';
        console.log('should migrate from mongo sequence', name);
        const mongoSeq = new MongoSequence({ name, client: postgres_client });
        let start;
        for (let i = 0; i < Math.floor(Math.random() * 100) + 1; i++) {
            start = await mongoSeq.nextsequence();
        }
        console.log('MongoSequence start', start);
        postgres_client.tables = postgres_client.tables.filter(t => t.name !== name);

        const nativeSeq = postgres_client.define_sequence({name});
        const nativestart = await nativeSeq.nextsequence();

        console.log('MongoSequence nativestart', nativestart);
        assert.equal(start + 1, nativestart);
    });

});
