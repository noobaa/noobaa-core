/* Copyright (C) 2022 NooBaa */
'use strict';

const coretest = require('../../utils/coretest/coretest');
coretest.setup();

const mocha = require('mocha');
const assert = require('assert');
const config = require('../../../../config');
const { MongoSequence } = require('../../../util/mongo_client');
const { PostgresClient } = require('../../../util/postgres_client');

async function get_postgres_client(params) {
    const pgc = new PostgresClient(params);
    await pgc.connect();
    return pgc;
}

mocha.describe('mdsequence', function() {
    if (config.DB_TYPE !== 'postgres') {
        console.log(`Skip mdsequence test for DB_TYPE=${config.DB_TYPE}`);
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
