/* Copyright (C) 2022 NooBaa */
'use strict';

const coretest = require('../../utils/coretest/coretest');
coretest.setup();

const mocha = require('mocha');
const assert = require('assert');
const config = require('../../../../config');
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

    mocha.it('should create Postgres sequence and get next value', async function() {
        const name = 'testsequence';
        const nativeSeq = postgres_client.define_sequence({ name });
        const start = await nativeSeq.nextsequence();
        assert.equal(start, 1);
        const next = await nativeSeq.nextsequence();
        assert.equal(next, 2);
    });

});
