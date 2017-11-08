/* Copyright (C) 2016 NooBaa */
'use strict';

var _ = require('lodash');
var mocha = require('mocha');
var assert = require('assert');
var map_utils = require('../../server/object_services/map_utils');
var config = require('../../../config.js');

mocha.describe('map_utils', function() {

    mocha.describe('get_chunk_status', function() {

        _.each(['SPREAD', 'MIRROR'], data_placement => {
            _.each([1, 2, 3, 4, 5, 17], num_pools => {
                _.each([1, 2, 3, 4, 5, 13], replicas => {
                    make_tests(num_pools, replicas, data_placement);
                });
            });
        });

        function make_tests(num_pools, replicas, data_placement) {
            const test_name = 'tier with num_pools=' + num_pools +
                ' replicas=' + replicas +
                ' ' + data_placement;
            const total_num_blocks =
                data_placement === 'MIRROR' ? replicas * num_pools : replicas;
            let bucket = mock_bucket(num_pools, replicas, data_placement);
            let tiering = bucket.tiering;
            let tiering_status = {};
            let pools_by_tier_id = {};
            _.forEach(bucket.tiering.tiers, tier_and_order => {
                let pools = [];
                _.forEach(tier_and_order.tier.mirrors, mirror_object => {
                    pools = _.concat(pools, (mirror_object && mirror_object.spread_pools) || []);
                });
                pools = _.concat(pools);
                let tier_pools_status = {};
                _.forEach(pools, pool => {
                    tier_pools_status[pool._id] = {
                        valid_for_allocation: true,
                        num_nodes: config.NODES_MIN_COUNT
                    };
                });
                tiering_status[tier_and_order.tier._id] = {
                    pools: tier_pools_status,
                    mirrors_storage: [{
                        free: {
                            peta: 1,
                            n: 0
                        }
                    }]
                };
                pools_by_tier_id[tier_and_order.tier._id] = pools;
            });

            mocha.describe(test_name, function() {

                mocha.it('should allocate when no blocks', function() {
                    let chunk = {};
                    chunk.frags = map_utils.get_missing_frags_in_chunk(
                        chunk, tiering.tiers[0].tier);
                    let status = map_utils.get_chunk_status(chunk, tiering, {
                        tiering_status: tiering_status
                    });
                    assert.strictEqual(status.allocations.length, total_num_blocks);
                    assert.strictEqual(status.deletions.length, 0);
                    assert(!status.accessible, '!accessible');
                    _.each(status.allocations, alloc => {
                        _.each(alloc.pools, pool => {
                            assert(_.includes(pools_by_tier_id[tiering.tiers[0].tier._id], pool), 'alloc.pool');
                        });
                    });
                });


                mocha.it('should do nothing when blocks are good', function() {
                    let chunk = {};
                    map_utils.set_chunk_frags_from_blocks(chunk,
                        _.times(total_num_blocks, i => ({
                            layer: 'D',
                            frag: 0,
                            node: mock_node(pools_by_tier_id[tiering.tiers[0].tier._id][i % num_pools]._id)
                        })));
                    let status = map_utils.get_chunk_status(chunk, tiering, {
                        tiering_status: tiering_status
                    });
                    assert.strictEqual(status.allocations.length, 0);
                    assert.strictEqual(status.deletions.length, 0);
                    assert(status.accessible, 'accessible');
                });


                mocha.it('should remove blocks from pools not in the tier', function() {
                    let chunk = {};
                    let blocks = _.times(total_num_blocks, i => ({
                        layer: 'D',
                        frag: 0,
                        node: mock_node(pools_by_tier_id[tiering.tiers[0].tier._id][i % num_pools]._id)
                    }));
                    let num_extra = replicas;
                    _.times(num_extra, () => {
                        blocks.push({
                            layer: 'D',
                            frag: 0,
                            node: mock_node('extra')
                        });
                    });
                    map_utils.set_chunk_frags_from_blocks(chunk, blocks);
                    let status = map_utils.get_chunk_status(chunk, tiering, {
                        tiering_status: tiering_status
                    });
                    assert.strictEqual(status.allocations.length, 0);
                    assert.strictEqual(status.deletions.length, num_extra);
                    assert(status.accessible, 'accessible');
                });


                mocha.it('should replicate from single block', function() {
                    let chunk = {};
                    map_utils.set_chunk_frags_from_blocks(chunk, [{
                        layer: 'D',
                        frag: 0,
                        node: mock_node(pools_by_tier_id[tiering.tiers[0].tier._id][0]._id)
                    }]);
                    let status = map_utils.get_chunk_status(chunk, tiering, {
                        tiering_status: tiering_status
                    });
                    assert.strictEqual(status.allocations.length, total_num_blocks - 1);
                    assert.strictEqual(status.deletions.length, 0);
                    assert(status.accessible, 'accessible');
                    _.each(status.allocations, alloc => {
                        _.each(alloc.pools, pool => {
                            assert(_.includes(pools_by_tier_id[tiering.tiers[0].tier._id], pool), 'alloc.pool');
                        });
                    });
                });

                mocha.it('should remove long gone blocks', function() {
                    let chunk = {};
                    let blocks = [{
                        layer: 'D',
                        frag: 0,
                        node: _.extend(mock_node(pools_by_tier_id[tiering.tiers[0].tier._id][0]._id), {
                            online: false,
                            readable: false,
                            writable: false,
                        })
                    }, {
                        layer: 'D',
                        frag: 0,
                        node: mock_node(pools_by_tier_id[tiering.tiers[0].tier._id][0]._id)
                    }];
                    map_utils.set_chunk_frags_from_blocks(chunk, blocks);
                    let status = map_utils.get_chunk_status(chunk, tiering, {
                        tiering_status: tiering_status
                    });
                    assert.strictEqual(status.allocations.length, total_num_blocks - 1);
                    assert.strictEqual(status.deletions.length, 1);
                    assert(status.accessible, 'accessible');
                    _.each(status.allocations, alloc => {
                        blocks.push({
                            layer: alloc.fragment.layer,
                            frag: alloc.fragment.frag,
                            node: mock_node(alloc.pools[0]._id)
                        });
                    });
                    map_utils.set_chunk_frags_from_blocks(chunk, blocks);
                    status = map_utils.get_chunk_status(chunk, tiering, {
                        tiering_status: tiering_status
                    });
                    assert.strictEqual(status.allocations.length, 0);
                    assert.strictEqual(status.deletions.length, 1);
                    assert(status.accessible, 'accessible');
                });

                mocha.it('should move back spilled over blocks', function() {
                    let chunk = {};
                    map_utils.set_chunk_frags_from_blocks(chunk,
                        _.times(total_num_blocks, i => ({
                            layer: 'D',
                            frag: 0,
                            node: mock_node(pools_by_tier_id[tiering.tiers[1].tier._id][i % num_pools]._id)
                        })));
                    let status = map_utils.get_chunk_status(chunk, tiering, {
                        tiering_status: tiering_status
                    });
                    assert.strictEqual(status.allocations.length, total_num_blocks);
                    assert.strictEqual(status.deletions.length, total_num_blocks);
                    assert(status.accessible, 'accessible');
                    _.each(status.allocations, alloc => {
                        _.each(alloc.pools, pool => {
                            assert(_.includes(pools_by_tier_id[tiering.tiers[0].tier._id], pool), 'alloc.pool');
                        });
                    });
                });

                mocha.it('should prefer blocks not on spillover', function() {
                    let chunk = {};
                    map_utils.set_chunk_frags_from_blocks(chunk,
                        _.concat(_.times(total_num_blocks, i => ({
                            layer: 'D',
                            frag: 0,
                            node: mock_node(pools_by_tier_id[tiering.tiers[0].tier._id][i % num_pools]._id)
                        })), _.times(total_num_blocks, i => ({
                            layer: 'D',
                            frag: 0,
                            node: mock_node(pools_by_tier_id[tiering.tiers[1].tier._id][i % num_pools]._id)
                        })))
                    );
                    let status = map_utils.get_chunk_status(chunk, tiering, {
                        tiering_status: tiering_status
                    });
                    assert.strictEqual(status.allocations.length, 0);
                    assert.strictEqual(status.deletions.length, total_num_blocks);
                    assert(status.accessible, 'accessible');
                    _.each(status.deletions, block => {
                        assert(
                            _.includes(
                                _.map(pools_by_tier_id[tiering.tiers[1].tier._id], '_id'),
                                block.node.pool
                            ),
                            'deletion pool'
                        );
                    });
                });

                mocha.it('should rebuild blocks to spill over', function() {
                    let chunk = {};
                    map_utils.set_chunk_frags_from_blocks(chunk,
                        _.times(total_num_blocks, i => ({
                            layer: 'D',
                            frag: 0,
                            node: mock_node(
                                pools_by_tier_id[tiering.tiers[0].tier._id][i % num_pools]._id, {
                                    online: false,
                                    readable: false,
                                    writable: false
                                }
                            )
                        }))
                    );
                    const tmp_tiering_status = _.clone(tiering_status);
                    tmp_tiering_status[tiering.tiers[0].tier._id].mirrors_storage = [{
                        free: 0
                    }];
                    let status = map_utils.get_chunk_status(chunk, tiering, {
                        tiering_status: tmp_tiering_status
                    });
                    assert.strictEqual(status.allocations.length, total_num_blocks);
                    assert.strictEqual(status.deletions.length, total_num_blocks);
                    assert(!status.accessible, '!accessible');
                    _.each(status.allocations, alloc => {
                        _.each(alloc.pools, pool => {
                            assert(_.includes(pools_by_tier_id[tiering.tiers[1].tier._id], pool), 'alloc.pool');
                        });
                    });
                    _.each(status.deletions, block => {
                        assert(
                            _.includes(
                                _.map(pools_by_tier_id[tiering.tiers[0].tier._id], '_id'),
                                block.node.pool
                            ),
                            'deletion pool'
                        );
                    });
                });
            });
        }

        function mock_bucket(num_pools, replicas, data_placement) {
            let regular_pools = _.times(num_pools, i => ({
                _id: 'pool' + i,
                name: 'pool' + i,
            }));

            let spill_pools = _.times(num_pools, i => ({
                _id: 'spill_pool' + i,
                name: 'spill_pool' + i,
            }));

            let regular_mirrors = [];
            let spill_mirrors = [];
            if (data_placement === 'MIRROR') {
                _.forEach(regular_pools, pool => regular_mirrors.push({ spread_pools: [pool] }));
                _.forEach(spill_pools, pool => spill_mirrors.push({ spread_pools: [pool] }));
            } else {
                regular_mirrors.push({ spread_pools: regular_pools });
                spill_mirrors.push({ spread_pools: spill_pools });
            }

            let regular_tier = {
                _id: 'tier_id',
                name: 'tier',
                mirrors: regular_mirrors,
                data_placement: data_placement,
                chunk_config: {
                    chunk_coder_config: { replicas, data_frags: 1, parity_frags: 0 },
                },
            };

            let spill_tier = {
                _id: 'spill_tier_id',
                name: 'spill_tier',
                mirrors: spill_mirrors,
                data_placement: data_placement,
                chunk_config: {
                    chunk_coder_config: { replicas, data_frags: 1, parity_frags: 0 },
                },
            };

            let tiering_policy = {
                name: 'tiering_policy',
                tiers: [{
                    order: 0,
                    tier: regular_tier,
                    spillover: false,
                    disabled: false
                }, {
                    order: 1,
                    tier: spill_tier,
                    spillover: true,
                    disabled: false
                }]
            };
            let bucket = {
                name: 'bucket',
                tiering: tiering_policy
            };
            return bucket;
        }

        function mock_node(pool_id, prop) {
            return {
                pool: pool_id,
                heartbeat: prop ? prop.heartbeat : new Date(),
                online: prop ? prop.online : true,
                is_cloud_node: prop ? prop.is_cloud_node : false,
                readable: prop ? prop.readable : true,
                writable: prop ? prop.writable : true,
                storage: prop ? prop.storage : {
                    free: 100 * 1024 * 1024 * 1024
                }
            };
        }

    });
});
