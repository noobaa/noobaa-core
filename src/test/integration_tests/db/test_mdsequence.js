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

    mocha.it('nextNsequences should not leave pooled connections inside a transaction', async function() {
        this.timeout(60000); // eslint-disable-line no-invalid-this
        const application_name = 'mdsequence_nextn_test';
        const pgc = await get_postgres_client({ ...POSTGRES_PARAMS, application_name });
        try {
            const nativeSeq = pgc.define_sequence({ name: 'testnsequence' });
            const pool = pgc.get_pool();
            // keep the pool saturated, like a busy md pool, so a released
            // connection goes to another waiting query
            const load_state = { stop: false };
            const load = Promise.all(Array.from({ length: 30 }, async () => {
                while (!load_state.stop) await pool.query('SELECT 1');
            }));
            try {
                for (let i = 0; i < 100; i++) {
                    const { start, end } = await nativeSeq.nextNsequences(10);
                    assert(start > 0 && end >= start + 9, `bad range ${start}-${end}`);
                }
            } finally {
                load_state.stop = true;
                await load;
            }
            const res = await postgres_client.get_pool().query(
                `SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = $1 AND state = 'idle in transaction'`,
                [application_name]);
            assert.equal(res.rows[0].n, 0, 'connections left idle in transaction');
        } finally {
            await pgc.disconnect();
        }
    });

});
