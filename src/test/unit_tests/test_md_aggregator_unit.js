/* Copyright (C) 2016 NooBaa */
/*eslint max-lines-per-function: ["error", 560]*/
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup({ pools_to_create: [coretest.POOL_LIST[0]] });

const _ = require('lodash');
const util = require('util');
const mocha = require('mocha');
const assert = require('assert');
// const mongodb = require('mongodb');

const P = require('../../util/promise');
const config = require('../../../config.js');
const MDStore = require('../../server/object_services/md_store').MDStore;
const md_aggregator = require('../../server/bg_services/md_aggregator.js');

function make_test_system_store(last_update, md_store) {

    const systems = _.times(1, i => ({
        _id: md_store.make_md_id(),
        name: `system${i}`,
        owner: md_store.make_md_id(),
    }));

    const buckets = _.times(10, i => ({
        _id: md_store.make_md_id(),
        name: `bucket${i}`,
        storage_stats: {
            last_update,
            chunks_capacity: 0,
            blocks_size: 0,
            pools: {},
            objects_size: 0,
            objects_count: 0,
            objects_hist: [],
        },
    }));

    const pools = _.times(10, i => ({
        _id: md_store.make_md_id(),
        name: `pool${i}`,
        storage_stats: {
            last_update,
            blocks_size: 0,
        }
    }));

    const system_store = {
        is_finished_initial_load: true,
        data: {
            buckets,
            pools,
            systems,
        },
        changes_list: [],
        debug: true,
        find_system_by_id(id) {
            return _.find(this.data.systems, system => String(system._id) === String(id));
        },
        find_bucket_by_id(id) {
            return _.find(this.data.buckets, bucket => String(bucket._id) === String(id));
        },
        find_pool_by_id(id) {
            return _.find(this.data.pools, pool => String(pool._id) === String(id));
        },
        make_changes(changes) {
            this.changes_list.push(changes);
            if (this.debug) {
                coretest.log('system store changes #',
                    this.changes_list.length,
                    util.inspect(changes, true, null, true)
                );
            }
            if (changes.update.systems) {
                changes.update.systems.forEach(updates => {
                    const system = this.find_system_by_id(updates._id);
                    _.forEach(updates, (val, key) => {
                        if (key !== '_id') _.set(system, key, val);
                    });
                });
            }
            if (changes.update.buckets) {
                changes.update.buckets.forEach(updates => {
                    const bucket = this.find_bucket_by_id(updates._id);
                    _.forEach(updates, (val, key) => {
                        if (key !== '_id') _.set(bucket, key, val);
                    });
                });
            }
            if (changes.update.pools) {
                changes.update.pools.forEach(updates => {
                    const pool = this.find_pool_by_id(updates._id);
                    _.forEach(updates, (val, key) => {
                        if (key !== '_id') _.set(pool, key, val);
                    });
                });
            }
            return P.resolve();
        },
    };

    return system_store;
}

mocha.describe('md_aggregator', function() {

    const md_store = new MDStore(`_test_md_store_${Date.now().toString(36)}`);

    mocha.describe('calculations', function() {

        mocha.it('should update each pool right', function() {
            const pools = [
                { _id: 123 },
                { _id: 234 },
            ];
            const existing_blocks_aggregate = {
                pools: {
                    123: { _id: '123', size: 50000 },
                    234: { _id: '234', size: 41000 }
                }
            };
            const deleted_blocks_aggregate = {
                pools: {
                    123: { _id: '123', size: 45000 },
                    234: { _id: '234', size: 18000 }
                }
            };
            _.each(pools, pool => {
                const pool_update = md_aggregator.calculate_new_pool({
                    pool,
                    existing_blocks_aggregate,
                    deleted_blocks_aggregate,
                });
                assert(pool_update.blocks_size ===
                    (existing_blocks_aggregate.pools[pool._id].size -
                        deleted_blocks_aggregate.pools[pool._id].size));
            });
        });

        mocha.it('should calculate pool delta', function() {
            const existing_blocks_aggregate = {
                buckets: {
                    123: {
                        pools: {
                            890: { size: 150000 },
                            789: { size: 18112 }
                        }
                    },
                    234: {
                        pools: {
                            678: { size: 151007 },
                            567: { size: 12321 }
                        }
                    }
                }
            };
            const deleted_blocks_aggregate = {
                buckets: {
                    123: {
                        pools: {
                            890: { size: 500 },
                            789: { size: 8112 },
                            150: { size: 112 }
                        }
                    },
                    234: {
                        pools: {
                            678: { size: 7 },
                            567: { size: 0 }
                        }
                    }
                }
            };
            // coretest.log(pool_deltas);
            const bucket_update = md_aggregator.calculate_new_bucket({
                bucket: { _id: 123 },
                existing_chunks_aggregate: { 123: null, 234: null },
                deleted_chunks_aggregate: { 123: null, 234: null },
                existing_objects_aggregate: { 123: null, 234: null },
                deleted_objects_aggregate: { 123: null, 234: null },
                existing_blocks_aggregate: _.cloneDeep(existing_blocks_aggregate),
                deleted_blocks_aggregate: _.cloneDeep(deleted_blocks_aggregate),
            });
            _.each(bucket_update.pools, function(pool, id) {
                const add = existing_blocks_aggregate.buckets[123].pools[id];
                const del = deleted_blocks_aggregate.buckets[123].pools[id];
                const added_block_size = (add && add.size) || 0;
                const deleted_block_size = (del && del.size) || 0;
                assert(pool.blocks_size === (added_block_size - deleted_block_size));
            });
        });

        mocha.it('should update storage stats', function() {
            const storage_stats = {
                chunks_capacity: 10000,
                blocks_size: 30000,
                objects_size: 8000,
                objects_count: 400,
                pools: {
                    '890': { blocks_size: 10000 },
                    '789': { blocks_size: 10000 },
                    '900': { blocks_size: 10000 },
                    '901': undefined
                }
            };
            const added_chunk = {
                '123': { compress_size: 2000 }
            };
            const deleted_chunk = {
                '123': { compress_size: 3000 }
            };
            const added_block = {
                buckets: {
                    '123': {
                        size: 1800,
                        pools: {
                            '890': { size: 500 },
                            '789': { size: 600 },
                            '902': { size: 700 }
                        }
                    }
                }
            };
            const deleted_block = {
                buckets: {
                    '123': {
                        size: 2400,
                        pools: {
                            '890': { size: 500 },
                            '789': { size: 1200 },
                            '902': { size: 700 }
                        }
                    }
                }
            };
            const added_object = {
                '123': {
                    count: 20,
                    size: 400
                }
            };
            const deleted_object = {
                '123': {
                    count: 50,
                    size: 500
                }
            };

            const expected_storage_stats = {
                chunks_capacity: storage_stats.chunks_capacity + added_chunk['123'].compress_size - deleted_chunk['123'].compress_size,
                blocks_size: storage_stats.blocks_size + added_block.buckets['123'].size - deleted_block.buckets['123'].size,
                objects_size: storage_stats.objects_size + added_object['123'].size - deleted_object['123'].size,
                objects_count: storage_stats.objects_count + added_object['123'].count - deleted_object['123'].count,
                stats_by_content_type: [],
                pools: {
                    '890': {
                        blocks_size: storage_stats.pools['890'].blocks_size +
                            added_block.buckets['123'].pools['890'].size - deleted_block.buckets['123'].pools['890'].size
                    },
                    '789': {
                        blocks_size: storage_stats.pools['789'].blocks_size +
                            added_block.buckets['123'].pools['789'].size - deleted_block.buckets['123'].pools['789'].size
                    },
                    '900': {
                        blocks_size: storage_stats.pools['900'].blocks_size
                    },
                },
                objects_hist: []
            };

            const new_storage_stats = md_aggregator.calculate_new_bucket({
                bucket: { _id: 123, storage_stats: storage_stats },
                existing_chunks_aggregate: added_chunk,
                deleted_chunks_aggregate: deleted_chunk,
                existing_objects_aggregate: added_object,
                deleted_objects_aggregate: deleted_object,
                existing_blocks_aggregate: added_block,
                deleted_blocks_aggregate: deleted_block,
            });
            // coretest.log(new_storage_stats);
            assert.deepStrictEqual(new_storage_stats, expected_storage_stats);
        });

    });

    mocha.describe('aggregation', function() {

        const CYCLE = config.MD_AGGREGATOR_INTERVAL;
        const ID_RESOLUTION = 3000;

        function sub_cycle() {
            const x = Math.random() * CYCLE;
            return (CYCLE - x < ID_RESOLUTION) ? CYCLE - ID_RESOLUTION : x;
        }

        mocha.it('should aggregate basic', function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(30000);
            const last_update = Date.now();
            const target_now = last_update + CYCLE;
            const system_store = make_test_system_store(last_update, md_store);
            const block_id1 = md_store.make_md_id_from_time(last_update + sub_cycle());
            coretest.log('block 1 addtion date', block_id1.getTimestamp().getTime());
            const system_id = system_store.data.systems[0]._id;

            return P.resolve()
                .then(() => md_store.insert_blocks([{
                    _id: block_id1,
                    system: system_id,
                    bucket: system_store.data.buckets[0]._id,
                    pool: system_store.data.pools[0]._id,
                    node: md_store.make_md_id(),
                    chunk: md_store.make_md_id(),
                    size: 12,
                }]))
                .then(() => md_store.insert_chunks([{
                    _id: md_store.make_md_id_from_time(last_update + sub_cycle()),
                    system: system_id,
                    bucket: system_store.data.buckets[0]._id,
                    size: 12,
                }]))
                .then(() => md_store.insert_object({
                    _id: md_store.make_md_id_from_time(last_update + sub_cycle()),
                    system: system_id,
                    bucket: system_store.data.buckets[0]._id,
                    key: '',
                    content_type: '',
                }))
                .then(() => md_aggregator.run_md_aggregator(md_store, system_store, target_now, 0))
                .then(() => {
                    assert.strictEqual(system_store.changes_list.length, 2);
                    const changes = system_store.changes_list[0];
                    assert.strictEqual(changes.update.buckets.length, system_store.data.buckets.length);
                    assert.strictEqual(changes.update.pools.length, system_store.data.pools.length);
                    assert.strictEqual(changes.update.buckets[0].storage_stats.blocks_size, 12);
                    assert.strictEqual(changes.update.pools[0].storage_stats.blocks_size, 12);
                    changes.update.buckets.forEach(item => {
                        assert.strictEqual(item.storage_stats.last_update, last_update + CYCLE);
                    });
                    changes.update.pools.forEach(item => {
                        assert.strictEqual(item.storage_stats.last_update, last_update + CYCLE);
                    });
                });
        });

        mocha.it('should aggregate deletions', function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(30000);
            const last_update = Date.now();
            const target_now = last_update + (2 * CYCLE);
            const system_store = make_test_system_store(last_update, md_store);
            const block_id1 = md_store.make_md_id_from_time(last_update + sub_cycle());
            const block_id2 = md_store.make_md_id_from_time(last_update + sub_cycle());
            const bucket = system_store.data.buckets[0];
            const pool = system_store.data.pools[0];
            coretest.log('block 1 addtion date', block_id1.getTimestamp().getTime());
            coretest.log('block 2 addtion date', block_id2.getTimestamp().getTime());
            const system_id = system_store.data.systems[0]._id;

            return P.resolve()
                .then(() => md_store.insert_blocks([
                    make_block(block_id1, 120, bucket, pool, system_id),
                    make_block(block_id2, 350, bucket, pool, system_id),
                ]))
                .then(() => md_store.insert_chunks([{
                    _id: md_store.make_md_id_from_time(last_update + sub_cycle()),
                    system: system_id,
                    bucket: system_store.data.buckets[0]._id,
                    size: 230,
                }]))
                .then(() => md_store.insert_object({
                    _id: md_store.make_md_id_from_time(last_update + sub_cycle()),
                    system: system_id,
                    bucket: system_store.data.buckets[0]._id,
                    key: '',
                    content_type: '',
                }))
                .then(() => md_store.update_blocks_by_ids([block_id2], {
                    deleted: new Date(last_update + CYCLE + sub_cycle())
                }))
                .then(() => md_aggregator.run_md_aggregator(md_store, system_store, target_now, 0))
                .then(() => {
                    assert.strictEqual(system_store.changes_list.length, 4);
                    const changes0 = system_store.changes_list[0];
                    assert.strictEqual(changes0.update.buckets.length, system_store.data.buckets.length);
                    assert.strictEqual(changes0.update.pools.length, system_store.data.pools.length);
                    assert.strictEqual(changes0.update.buckets[0].storage_stats.blocks_size, 470);
                    assert.strictEqual(changes0.update.pools[0].storage_stats.blocks_size, 470);
                    changes0.update.buckets.forEach(item => {
                        assert.strictEqual(item.storage_stats.last_update, last_update + CYCLE);
                    });
                    changes0.update.pools.forEach(item => {
                        assert.strictEqual(item.storage_stats.last_update, last_update + CYCLE);
                    });
                    const changes1 = system_store.changes_list[2];
                    assert.strictEqual(changes1.update.buckets[0].storage_stats.blocks_size, 120);
                    assert.strictEqual(changes1.update.pools[0].storage_stats.blocks_size, 120);
                    changes1.update.buckets.forEach(item => {
                        assert.strictEqual(item.storage_stats.last_update, last_update + (2 * CYCLE));
                    });
                    changes1.update.pools.forEach(item => {
                        assert.strictEqual(item.storage_stats.last_update, last_update + (2 * CYCLE));
                    });
                });
        });

        mocha.it('should aggregate petabytes', function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(30000);
            const last_update = Date.now();
            const target_now = last_update + (2 * CYCLE);
            const system_store = make_test_system_store(last_update, md_store);
            const bucket = system_store.data.buckets[0];
            const pool = system_store.data.pools[0];
            const blocks_to_delete = [];
            const system_id = system_store.data.systems[0]._id;

            return P.resolve()
                .then(() => {
                    const blocks = [];
                    for (let i = 0; i < 1024; ++i) { // 1 PB
                        const block_id = md_store.make_md_id_from_time(last_update + sub_cycle());
                        blocks.push(make_block(block_id, 1024 * 1024 * 1024 * 1024, bucket, pool, system_id));
                        if (i % 2) blocks_to_delete.push(block_id);
                    }
                    return md_store.insert_blocks(blocks);
                })
                .then(() => md_store.insert_chunks([{
                    _id: md_store.make_md_id_from_time(last_update + sub_cycle()),
                    system: system_id,
                    bucket: system_store.data.buckets[0]._id,
                    size: 300000,
                }]))
                .then(() => md_store.insert_object({
                    _id: md_store.make_md_id_from_time(last_update + sub_cycle()),
                    system: system_id,
                    bucket: system_store.data.buckets[0]._id,
                    key: '',
                    content_type: '',
                }))
                .then(() => md_store.update_blocks_by_ids(blocks_to_delete, {
                    deleted: new Date(last_update + CYCLE + sub_cycle())
                }))
                .then(() => md_aggregator.run_md_aggregator(md_store, system_store, target_now, 0))
                .then(() => {
                    assert.strictEqual(system_store.changes_list.length, 4);
                    const changes0 = system_store.changes_list[0];
                    assert.strictEqual(changes0.update.buckets.length, system_store.data.buckets.length);
                    assert.strictEqual(changes0.update.pools.length, system_store.data.pools.length);
                    assert.deepEqual(changes0.update.buckets[0].storage_stats.blocks_size, { n: 0, peta: 1 });
                    assert.deepEqual(changes0.update.pools[0].storage_stats.blocks_size, { n: 0, peta: 1 });
                    changes0.update.buckets.forEach(item => {
                        assert.strictEqual(item.storage_stats.last_update, last_update + CYCLE);
                    });
                    changes0.update.pools.forEach(item => {
                        assert.strictEqual(item.storage_stats.last_update, last_update + CYCLE);
                    });
                    const changes1 = system_store.changes_list[2];
                    assert.deepEqual(changes1.update.buckets[0].storage_stats.blocks_size, (2 ** 49));
                    assert.deepEqual(changes1.update.pools[0].storage_stats.blocks_size, (2 ** 49));
                    changes1.update.buckets.forEach(item => {
                        assert.strictEqual(item.storage_stats.last_update, last_update + (2 * CYCLE));
                    });
                    changes1.update.pools.forEach(item => {
                        assert.strictEqual(item.storage_stats.last_update, last_update + (2 * CYCLE));
                    });
                });
        });


        mocha.it('should aggregate multiple ranges', function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(30000);
            const last_update = Date.now();
            const system_store = make_test_system_store(last_update, md_store);
            const num_ranges = system_store.data.buckets.length;
            const range = CYCLE / 2;
            const target_now = last_update + (num_ranges * range);
            const system_id = system_store.data.systems[0]._id;

            return P.resolve()
                .then(() => md_store.insert_blocks(_.times(num_ranges, i => {
                    const current_cycle = last_update + (i * range);
                    const bucket = system_store.data.buckets[i];
                    const pool = system_store.data.pools[i];
                    bucket.storage_stats.last_update = current_cycle;
                    pool.storage_stats.last_update = current_cycle;
                    const block_id = md_store.make_md_id_from_time(current_cycle + (sub_cycle() / 2));
                    return make_block(block_id, 666, bucket, pool, system_id);
                })))
                .then(() => md_store.insert_chunks([{
                    _id: md_store.make_md_id_from_time(last_update + sub_cycle()),
                    system: system_id,
                    bucket: system_store.data.buckets[0]._id,
                    size: 300000,
                }]))
                .then(() => md_store.insert_object({
                    _id: md_store.make_md_id_from_time(last_update + sub_cycle()),
                    system: system_id,
                    bucket: system_store.data.buckets[0]._id,
                    key: '',
                    content_type: '',
                }))
                .then(() => md_aggregator.run_md_aggregator(md_store, system_store, target_now, 0))
                .then(() => {
                    assert.strictEqual(system_store.changes_list.length, num_ranges * 2);
                    system_store.changes_list.forEach((changes, i) => {
                        if (!changes.update.systems) {
                            assert.strictEqual(changes.update.buckets.length, (i / 2) + 1);
                            assert.strictEqual(changes.update.pools.length, (i / 2) + 1);
                            assert.strictEqual(changes.update.buckets[0].storage_stats.blocks_size, 666);
                            assert.strictEqual(changes.update.pools[0].storage_stats.blocks_size, 666);
                            changes.update.buckets.forEach(item => {
                                assert.strictEqual(item.storage_stats.last_update, last_update + (((i / 2) + 1) * range));
                            });
                            changes.update.pools.forEach(item => {
                                assert.strictEqual(item.storage_stats.last_update, last_update + (((i / 2) + 1) * range));
                            });
                        }
                    });
                });
        });

        mocha.it('should reset to epoch', function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(30000);
            const last_update = Date.now();
            const target_now = last_update - 1;
            const system_store = make_test_system_store(last_update, md_store);

            return P.resolve()
                .then(() => md_aggregator.run_md_aggregator(md_store, system_store, target_now, 0))
                .then(() => {
                    assert.strictEqual(system_store.changes_list.length, 1);
                    const changes0 = system_store.changes_list[0];
                    assert.strictEqual(changes0.update.buckets.length, system_store.data.buckets.length);
                    assert.strictEqual(changes0.update.pools.length, system_store.data.pools.length);
                    changes0.update.buckets.forEach(item => {
                        assert.strictEqual(item.storage_stats.last_update, config.NOOBAA_EPOCH);
                        assert.strictEqual(item.storage_stats.blocks_size, 0);
                        assert.strictEqual(item.storage_stats.chunks_capacity, 0);
                        assert.strictEqual(item.storage_stats.objects_size, 0);
                        assert.strictEqual(item.storage_stats.objects_count, 0);
                    });
                    changes0.update.pools.forEach(item => {
                        assert.strictEqual(item.storage_stats.last_update, config.NOOBAA_EPOCH);
                        assert.strictEqual(item.storage_stats.blocks_size, 0);
                    });
                });
        });

        mocha.it('should split cycles from epoch', function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(300000);
            const num_splits = 13;
            const last_update = Date.now();
            const target_now = last_update + (num_splits * CYCLE);
            const system_store = make_test_system_store(last_update, md_store);
            system_store.debug = false;

            return P.resolve()
                .then(() => md_aggregator.run_md_aggregator(md_store, system_store, target_now, 0))
                .then(() => {
                    assert.strictEqual(system_store.changes_list.length, num_splits * 2);
                    system_store.changes_list.forEach((changes, i) => {
                        if (!changes.update.systems) {
                            assert.strictEqual(changes.update.buckets.length, system_store.data.buckets.length);
                            assert.strictEqual(changes.update.pools.length, system_store.data.pools.length);
                        }
                    });
                });
        });

    });

    function make_block(block_id, size, bucket, pool, system_id) {
        return {
            _id: block_id,
            system: system_id,
            bucket: bucket._id,
            pool: pool._id,
            node: md_store.make_md_id(),
            chunk: md_store.make_md_id(),
            size,
        };
    }
});
