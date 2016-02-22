'use strict';

var _ = require('lodash');
var mocha = require('mocha');
var assert = require('assert');
var map_utils = require('../server/mapper/map_utils');

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
            let pools = bucket.tiering.tiers[0].tier.pools;

            mocha.describe(test_name, function() {

                mocha.it('should allocate when no blocks', function() {
                    let chunk = {};
                    chunk.frags = map_utils.get_missing_frags_in_chunk(
                        chunk, tiering.tiers[0].tier);
                    let status = map_utils.get_chunk_status(chunk, tiering);
                    assert.strictEqual(status.allocations.length, total_num_blocks);
                    assert.strictEqual(status.deletions.length, 0);
                    assert(!status.accessible, '!accessible');
                    _.each(status.allocations, alloc => {
                        assert(_.find(pools, alloc.pool), 'alloc.pool');
                    });
                });


                mocha.it('should do nothing when blocks are good', function() {
                    let now = new Date();
                    let chunk = {};
                    map_utils.set_chunk_frags_from_blocks(chunk,
                        _.times(total_num_blocks, i => ({
                            layer: 'D',
                            frag: 0,
                            node: {
                                heartbeat: now,
                                pool: pools[i % num_pools]._id,
                            }
                        })));
                    let status = map_utils.get_chunk_status(chunk, tiering);
                    assert.strictEqual(status.allocations.length, 0);
                    assert.strictEqual(status.deletions.length, 0);
                    assert(status.accessible, 'accessible');
                });


                mocha.it('should remove blocks from pools not in the tier', function() {
                    let now = new Date();
                    let chunk = {};
                    let blocks = _.times(total_num_blocks, i => ({
                        layer: 'D',
                        frag: 0,
                        node: {
                            heartbeat: now,
                            pool: pools[i % num_pools]._id,
                        }
                    }));
                    let num_extra = replicas;
                    _.times(num_extra, () => {
                        blocks.push({
                            layer: 'D',
                            frag: 0,
                            node: {
                                heartbeat: now,
                                pool: 'extra'
                            }
                        });
                    });
                    map_utils.set_chunk_frags_from_blocks(chunk, blocks);
                    let status = map_utils.get_chunk_status(chunk, tiering);
                    assert.strictEqual(status.allocations.length, 0);
                    assert.strictEqual(status.deletions.length, num_extra);
                    assert(status.accessible, 'accessible');
                });


                mocha.it('should replicate from single block', function() {
                    let now = new Date();
                    let chunk = {};
                    map_utils.set_chunk_frags_from_blocks(chunk, [{
                        layer: 'D',
                        frag: 0,
                        node: {
                            heartbeat: now,
                            pool: pools[0]._id,
                        }
                    }]);
                    let status = map_utils.get_chunk_status(chunk, tiering);
                    assert.strictEqual(status.allocations.length, total_num_blocks - 1);
                    assert.strictEqual(status.deletions.length, 0);
                    assert(status.accessible, 'accessible');
                    _.each(status.allocations, alloc => {
                        assert.strictEqual(alloc.tier, tiering.tiers[0].tier);
                    });
                });

                mocha.it('should remove long gone blocks', function() {
                    let now = new Date();
                    let chunk = {};
                    map_utils.set_chunk_frags_from_blocks(chunk, [{
                        layer: 'D',
                        frag: 0,
                        node: {
                            heartbeat: new Date(now.getTime() - 24 * 3600 * 1000),
                            pool: pools[0]._id,
                        }
                    }, {
                        layer: 'D',
                        frag: 0,
                        node: {
                            heartbeat: now,
                            pool: pools[0]._id,
                        }
                    }]);
                    let status = map_utils.get_chunk_status(chunk, tiering);
                    assert.strictEqual(status.allocations.length, total_num_blocks - 1);
                    assert.strictEqual(status.deletions.length, 1);
                    assert(status.accessible, 'accessible');
                    _.each(status.allocations, alloc => {
                        alloc.fragment.blocks.push({
                            layer: alloc.fragment.layer,
                            frag: alloc.fragment.frag,
                            node: {
                                heartbeat: now,
                                pool: alloc.pool && alloc.pool._id ||
                                    alloc.tier.pools[0]._id
                            }
                        });
                    });
                    status = map_utils.get_chunk_status(chunk, tiering);
                    assert.strictEqual(status.allocations.length, 0);
                    assert.strictEqual(status.deletions.length, 1);
                    assert(status.accessible, 'accessible');
                });

            });
        }

        function mock_bucket(num_pools, replicas, data_placement) {
            let pools = _.times(num_pools, i => ({
                _id: 'pool' + i,
                name: 'pool' + i,
            }));
            let tier = {
                name: 'tier',
                pools: pools,
                data_placement: data_placement,
                replicas: replicas,
                data_fragments: 1,
                parity_fragments: 0,
            };
            let tiering_policy = {
                name: 'tiering_policy',
                tiers: [{
                    order: 0,
                    tier: tier
                }]
            };
            let bucket = {
                name: 'bucket',
                tiering: tiering_policy
            };
            return bucket;
        }

    });
});
