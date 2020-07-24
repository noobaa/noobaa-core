/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
const promise_utils = require('../../util/promise_utils');
const P = require('../../util/promise');
const _ = require('lodash');
const db_client = require('../../util/db_client');
coretest.setup({ pools_to_create: [coretest.POOL_LIST[0]] });

const mocha = require('mocha');
const assert = require('assert');

const system_store = require('../../server/system_services/system_store').get_instance();

mocha.describe('system_store', function() {

    // eslint-disable-next-line no-undef
    afterEach(function() {
        // hacky - all the added systems were failing some of the next tests
        // remove all dummy systems
        coretest.log('cleaning test systems:');
        return db_client.instance().collection('systems').deleteMany({
            name: {
                $nin: ['demo', 'coretest']
            }
        }).then(() => {
            system_store.clean_system_store();
            return system_store.load();
        });
    });

    mocha.it('load()', function() {
        return system_store.load();
    });

    mocha.it('Loop make_changes', function() {
        const LOOP_CYCLES = 26;
        return promise_utils.loop(LOOP_CYCLES, cycle => system_store.make_changes({
            insert: {
                systems: [{
                    _id: system_store.new_system_store_id(),
                    name: `JenTheMajesticSlothSystemStoreLoop-${cycle}`,
                    owner: system_store.new_system_store_id()
                }]
            }
        }));
    });

    mocha.it('Parallel make_changes', function() {
        const PARALLEL_CHANGES = 26;
        return P.map(new Array(PARALLEL_CHANGES), (x, i) => system_store.make_changes({
            insert: {
                systems: [{
                    _id: system_store.new_system_store_id(),
                    name: `JenTheMajesticSlothSystemStoreParallel-${i}`,
                    owner: system_store.new_system_store_id()
                }]
            }
        }));
    });

    mocha.it('Check make_changes updates new created systems', function() {
        const LOOP_CYCLES = 10;
        let first_data_store;
        return system_store.load()
            .then(data1 => {
                first_data_store = _.cloneDeep(data1);
                console.log('first_data_store', first_data_store.systems.length);
                return promise_utils.loop(LOOP_CYCLES, cycle => system_store.make_changes({
                    insert: {
                        systems: [{
                            _id: system_store.new_system_store_id(),
                            name: `JenTheMajesticSlothSystemStoreLoop2-${cycle}`,
                            owner: system_store.new_system_store_id()
                        }]
                    }
                }));
            })
            .then(() => system_store.load())
            .then(data2 => {
                console.log('new_data_store', data2.systems.length);
                assert.deepStrictEqual(first_data_store.systems.length + LOOP_CYCLES, data2.systems.length);
            });
    });

    mocha.it('Check make_changes returns no diff when not changing last_update', function() {
        const system_id = system_store.new_system_store_id();
        const orig_name = `JenTheMajesticSlothSystemStoreLoop3`;
        return system_store.load()
            .then(() => system_store.make_changes({
                insert: {
                    systems: [{
                        _id: system_id,
                        name: orig_name,
                        owner: system_store.new_system_store_id(),
                    }]
                }
            }))
            .then(() => system_store.make_changes({
                update: {
                    systems: [{
                        _id: system_id,
                        name: 'new_name',
                        dont_change_last_update: true
                    }]
                }
            }))
            .then(() => system_store.load())
            .then(data2 => {
                console.log('new_data_store', data2.systems.length);
                assert.strictEqual(data2.systems[0].name, orig_name);
            });
    });

    mocha.it('Check make_changes returns diff when changing last_update', function() {
        const system_id = system_store.new_system_store_id();
        const orig_name = `JenTheMajesticSlothSystemStoreLoop3`;
        return system_store.load()
            .then(() => system_store.make_changes({
                insert: {
                    systems: [{
                        _id: system_id,
                        name: orig_name,
                        owner: system_store.new_system_store_id(),
                    }]
                }
            }))
            .then(() => system_store.make_changes({
                update: {
                    systems: [{
                        _id: system_id,
                        name: 'new_name',
                        dont_change_last_update: false
                    }]
                }
            }))
            .then(() => system_store.load())
            .then(data2 => {
                console.log('new_data_store', data2.systems.length);
                assert.strictEqual(data2.systems[0].name, 'new_name');
            });
    });


    // TODO continue test_system_store ...

});
