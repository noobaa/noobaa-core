'use strict';

var _ = require('lodash');
var mocha = require('mocha');
var assert = require('assert');
var map_utils = require('../../server/object_services/map_utils');

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
                        _.each(alloc.pools, pool => {
                            assert(_.includes(pools, pool), 'alloc.pool');
                        });
                    });
                });


                mocha.it('should do nothing when blocks are good', function() {
                    let chunk = {};
                    map_utils.set_chunk_frags_from_blocks(chunk,
                        _.times(total_num_blocks, i => ({
                            layer: 'D',
                            frag: 0,
                            node: mock_node(pools[i % num_pools]._id)
                        })));
                    let status = map_utils.get_chunk_status(chunk, tiering);
                    assert.strictEqual(status.allocations.length, 0);
                    assert.strictEqual(status.deletions.length, 0);
                    assert(status.accessible, 'accessible');
                });


                mocha.it('should remove blocks from pools not in the tier', function() {
                    let chunk = {};
                    let blocks = _.times(total_num_blocks, i => ({
                        layer: 'D',
                        frag: 0,
                        node: mock_node(pools[i % num_pools]._id)
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
                    let status = map_utils.get_chunk_status(chunk, tiering);
                    assert.strictEqual(status.allocations.length, 0);
                    assert.strictEqual(status.deletions.length, num_extra);
                    assert(status.accessible, 'accessible');
                });


                mocha.it('should replicate from single block', function() {
                    let chunk = {};
                    map_utils.set_chunk_frags_from_blocks(chunk, [{
                        layer: 'D',
                        frag: 0,
                        node: mock_node(pools[0]._id)
                    }]);
                    let status = map_utils.get_chunk_status(chunk, tiering);
                    assert.strictEqual(status.allocations.length, total_num_blocks - 1);
                    assert.strictEqual(status.deletions.length, 0);
                    assert(status.accessible, 'accessible');
                    _.each(status.allocations, alloc => {
                        _.each(alloc.pools, pool => {
                            assert(_.includes(pools, pool), 'alloc.pool');
                        });
                    });
                });

                mocha.it('should remove long gone blocks', function() {
                    let chunk = {};
                    let blocks = [{
                        layer: 'D',
                        frag: 0,
                        node: _.extend(mock_node(pools[0]._id), {
                            online: false,
                            readable: false,
                            writable: false,
                        })
                    }, {
                        layer: 'D',
                        frag: 0,
                        node: mock_node(pools[0]._id)
                    }];
                    map_utils.set_chunk_frags_from_blocks(chunk, blocks);
                    let status = map_utils.get_chunk_status(chunk, tiering);
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

        function mock_node(pool_id) {
            return {
                pool: pool_id,
                heartbeat: new Date(),
                online: true,
                readable: true,
                writable: true,
                storage: {
                    free: 100 * 1024 * 1024 * 1024
                }
            };
        }

    });
});
