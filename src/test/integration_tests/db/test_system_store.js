/* Copyright (C) 2016 NooBaa */
'use strict';

const mocha = require('mocha');
const assert = require('assert');
const coretest = require('../../utils/coretest/coretest');
const db_client = require('../../../util/db_client');
const { SystemStore, SOURCE } = require('../../../server/system_services/system_store');

// setup coretest first to prepare the env
coretest.setup();

const TEST_NAME_PREFIX = 'JenTheMajesticSloth';

mocha.describe('system_store', function() {
    this.timeout(90000); // eslint-disable-line no-invalid-this

    // eslint-disable-next-line global-require
    const system_store = require('../../../server/system_services/system_store').get_instance();

    // eslint-disable-next-line no-undef
    afterEach(async function() {
        // hacky - all the added systems were failing some of the next tests
        // remove all dummy systems
        coretest.log('cleaning test systems:');
        await db_client.instance().collection('systems').deleteMany({
            name: {
                $nin: ['demo', 'coretest']
            }
        });
        // drop accounts/buckets created by these tests (keep demo/support accounts)
        await db_client.instance().collection('accounts').deleteMany({
            name: { $regex: `^${TEST_NAME_PREFIX}` }
        });
        await db_client.instance().collection('buckets').deleteMany({
            name: { $regex: `^${TEST_NAME_PREFIX}` }
        });
        system_store.clean_system_store();
        await system_store.load();
    });

    mocha.it('load()', async function() {
        await system_store.load();
    });

    mocha.it('Loop make_changes', async function() {
        const LOOP_CYCLES = 26;
        for (let cycle = 0; cycle < LOOP_CYCLES; ++cycle) {
            await system_store.make_changes({
                insert: {
                    systems: [{
                        _id: system_store.new_system_store_id(),
                        name: `JenTheMajesticSlothSystemStoreLoop-${cycle}`,
                        owner: system_store.new_system_store_id()
                    }]
                }
            });
        }
    });

    mocha.it('Parallel make_changes', async function() {
        const PARALLEL_CHANGES = 26;
        await Promise.all(Array(PARALLEL_CHANGES).fill().map(async (x, i) => {
            await system_store.make_changes({
                insert: {
                    systems: [{
                        _id: system_store.new_system_store_id(),
                        name: `JenTheMajesticSlothSystemStoreParallel-${i}`,
                        owner: system_store.new_system_store_id()
                    }]
                }
            });
        }));
    });

    mocha.it('Check make_changes updates new created systems', async function() {
        const LOOP_CYCLES = 10;
        const data1 = await system_store.load();
        console.log('first_data_store', data1.systems.length);
        for (let cycle = 0; cycle < LOOP_CYCLES; ++cycle) {
            await system_store.make_changes({
                insert: {
                    systems: [{
                        _id: system_store.new_system_store_id(),
                        name: `JenTheMajesticSlothSystemStoreLoop2-${cycle}`,
                        owner: system_store.new_system_store_id()
                    }]
                }
            });
        }
        const data2 = await system_store.load();
        console.log('new_data_store', data2.systems.length);
        assert.deepStrictEqual(data1.systems.length + LOOP_CYCLES, data2.systems.length);
    });

    mocha.it('Check make_changes returns no diff when not changing last_update', async function() {
        const system_id = system_store.new_system_store_id();
        const orig_name = `JenTheMajesticSlothSystemStoreLoop3`;
        await system_store.load();
        await system_store.make_changes({
            insert: {
                systems: [{
                    _id: system_id,
                    name: orig_name,
                    owner: system_store.new_system_store_id(),
                }]
            }
        });
        await system_store.make_changes({
            update: {
                systems: [{
                    _id: system_id,
                    name: 'new_name',
                    dont_change_last_update: true
                }]
            }
        });
        const data2 = await system_store.load();
        console.log('new_data_store', data2.systems.length);
        assert.strictEqual(data2.systems[0].name, orig_name);
    });

    mocha.it('Check make_changes returns diff when changing last_update', async function() {
        const system_id = system_store.new_system_store_id();
        const orig_name = `JenTheMajesticSlothSystemStoreLoop3`;
        await system_store.load();
        await system_store.make_changes({
            insert: {
                systems: [{
                    _id: system_id,
                    name: orig_name,
                    owner: system_store.new_system_store_id(),
                }]
            }
        });
        await system_store.make_changes({
            update: {
                systems: [{
                    _id: system_id,
                    name: 'new_name',
                    dont_change_last_update: false
                }]
            }
        });
        const data2 = await system_store.load();
        console.log('new_data_store', data2.systems.length);
        assert.strictEqual(data2.systems[0].name, 'new_name');
    });

    mocha.it("Load from core", async function() {

        const system_store_from_core = new SystemStore({
            source: SOURCE.CORE,
            skip_define_for_tests: true
        });

        const from_db = await system_store.load();
        const from_core = await system_store_from_core.load(undefined, SOURCE.CORE);

        assert.deepStrictEqual(from_db.data, from_core.data);

    });

    mocha.it('make_changes multi-collection insert succeeds', async function() {
        const bucket_id = system_store.new_system_store_id();
        const account_id = system_store.new_system_store_id();
        const bucket_name = `${TEST_NAME_PREFIX}MultiInsertBucket`;
        const account_name = `${TEST_NAME_PREFIX}MultiInsertAccount`;
        const account_email = `${TEST_NAME_PREFIX}MultiInsert@noobaa.test`;

        await system_store.load();
        const system_id = system_store.data.systems[0]._id;
        await system_store.make_changes({
            insert: {
                buckets: [{
                    _id: bucket_id,
                    name: bucket_name,
                    system: system_id,
                    versioning: 'DISABLED',
                    owner_account: account_id,
                }],
                accounts: [{
                    _id: account_id,
                    name: account_name,
                    email: account_email,
                    has_login: false,
                    identity_type: 'ACCOUNT',
                }],
            }
        });

        const data = await system_store.load();
        const bucket = data.buckets.find(b => String(b._id) === String(bucket_id));
        const account = data.accounts.find(a => String(a._id) === String(account_id));
        assert.ok(bucket, 'bucket should be inserted');
        assert.strictEqual(bucket.name.unwrap(), bucket_name);
        assert.ok(account, 'account should be inserted');
        assert.strictEqual(account.name.unwrap(), account_name);
        assert.strictEqual(account.email.unwrap(), account_email);
    });

    mocha.it('make_changes multi-collection rolls back on mid-batch failure', async function() {
        const existing_account_id = system_store.new_system_store_id();
        const new_bucket_id = system_store.new_system_store_id();
        const existing_account_name = `${TEST_NAME_PREFIX}RollbackSeedAccount`;
        const new_bucket_name = `${TEST_NAME_PREFIX}RollbackBucket`;

        await system_store.load();
        const system_id = system_store.data.systems[0]._id;
        await system_store.make_changes({
            insert: {
                accounts: [{
                    _id: existing_account_id,
                    name: existing_account_name,
                    email: `${TEST_NAME_PREFIX}RollbackSeed@noobaa.test`,
                    has_login: false,
                    identity_type: 'ACCOUNT',
                }],
            }
        });

        await assert.rejects(
            () => system_store.make_changes({
                insert: {
                    // buckets first so the account duplicate fails after the bucket write
                    buckets: [{
                        _id: new_bucket_id,
                        name: new_bucket_name,
                        system: system_id,
                        versioning: 'DISABLED',
                        owner_account: existing_account_id,
                    }],
                    accounts: [{
                        _id: existing_account_id,
                        name: `${TEST_NAME_PREFIX}RollbackDupAccount`,
                        email: `${TEST_NAME_PREFIX}RollbackDup@noobaa.test`,
                        has_login: false,
                        identity_type: 'ACCOUNT',
                    }],
                }
            }),
            { code: '23505' } // unique_violation from the accounts insert, after the bucket write
        );

        const data = await system_store.load();
        const rolled_back_bucket = data.buckets.find(b => String(b._id) === String(new_bucket_id));
        assert.strictEqual(rolled_back_bucket, undefined, 'bucket insert must roll back with failed account insert');
        const seed_account = data.accounts.find(a => String(a._id) === String(existing_account_id));
        assert.ok(seed_account, 'seed account should still exist');
        assert.strictEqual(seed_account.name.unwrap(), existing_account_name);
    });

});
