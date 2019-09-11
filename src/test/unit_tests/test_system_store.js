/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
const promise_utils = require('../../util/promise_utils');
const P = require('../../util/promise');
const _ = require('lodash');
const mongo_client = require('../../util/mongo_client');
coretest.setup({ pools_to_create: [coretest.POOL_LIST[0]] });

const mocha = require('mocha');
const assert = require('assert');

const system_store = require('../../server/system_services/system_store').get_instance();

function _get_wiredtiger_log() {
    return mongo_client.instance().connect()
        .then(() => mongo_client.instance().db().command({ serverStatus: 1 }))
        .then(res => res.wiredTiger.log);
}

function _get_wiredtiger_log_diff(a, b) {
    return _.omitBy(_.mergeWith(a, b, (a_prop, b_prop) => b_prop - a_prop), value => !value);
}


mocha.describe('system_store', function() {

    // eslint-disable-next-line no-undef
    afterEach(function() {
        // hacky - all the added systems were failing some of the next tests
        // remove all dummy systems
        coretest.log('cleaning test systems:');
        return mongo_client.instance().collection('systems').deleteMany({
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
        let first_log;
        let second_log;
        return _get_wiredtiger_log()
            .then(first_log_res => {
                first_log = first_log_res;
                coretest.log('Loop make_changes: First WiredTiger Log', first_log_res);
                return promise_utils.loop(LOOP_CYCLES, cycle => system_store.make_changes({
                    insert: {
                        systems: [{
                            _id: system_store.new_system_store_id(),
                            name: `JenTheMajesticSlothSystemStoreLoop-${cycle}`,
                            owner: system_store.new_system_store_id()
                        }]
                    }
                }));
            })
            .then(() => _get_wiredtiger_log())
            .then(second_log_res => {
                second_log = second_log_res;
                coretest.log('Loop make_changes: Second WiredTiger Log', second_log_res);
                const log_diff = _get_wiredtiger_log_diff(first_log, second_log);
                coretest.log('Loop make_changes: WiredTiger Log Diff', log_diff);
            });
    });

    mocha.it('Parallel make_changes', function() {
        const PARALLEL_CHANGES = 26;
        let first_log;
        let second_log;
        return _get_wiredtiger_log()
            .then(first_log_res => {
                first_log = first_log_res;
                coretest.log('Parallel make_changes: First WiredTiger Log', first_log_res);
                return P.map(new Array(PARALLEL_CHANGES), (x, i) => system_store.make_changes({
                    insert: {
                        systems: [{
                            _id: system_store.new_system_store_id(),
                            name: `JenTheMajesticSlothSystemStoreParallel-${i}`,
                            owner: system_store.new_system_store_id()
                        }]
                    }
                }));
            })
            .then(() => _get_wiredtiger_log())
            .then(second_log_res => {
                second_log = second_log_res;
                coretest.log('Parallel make_changes: Second WiredTiger Log', second_log_res);
                const log_diff = _get_wiredtiger_log_diff(first_log, second_log);
                coretest.log('Parallel make_changes: WiredTiger Log Diff', log_diff);
            });
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
