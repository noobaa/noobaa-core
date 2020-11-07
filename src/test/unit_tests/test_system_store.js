/* Copyright (C) 2016 NooBaa */
'use strict';

const mocha = require('mocha');
const assert = require('assert');
const coretest = require('./coretest');
const db_client = require('../../util/db_client');

// setup coretest first to prepare the env
coretest.setup({ pools_to_create: [coretest.POOL_LIST[0]] });


mocha.describe('system_store', function() {
    this.timeout(90000); // eslint-disable-line no-invalid-this

    // eslint-disable-next-line global-require
    const system_store = require('../../server/system_services/system_store').get_instance();

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

});
