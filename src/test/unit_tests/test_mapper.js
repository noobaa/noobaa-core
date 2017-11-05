/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const mocha = require('mocha');
const assert = require('assert');
const mongodb = require('mongodb');

const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config.js');
const mapper = require('../../server/object_services/mapper');

if (process.argv.includes('--verbose')) {
    dbg.set_level(5, 'core');
}

mocha.describe('mapper', function() {

    mocha.describe('map_chunk', function() {

        const PLACEMENTS = [
            'SPREAD',
            'MIRROR',
        ];
        const NUM_POOLS = [
            1,
            2,
            3,
            // 4,
            // 5,
            // 6,
            13,
        ];
        const REPLICAS = [
            1,
            2,
            3,
            // 6,
            10,
        ];
        const DATA_FRAGS = [
            1,
            2,
            4,
            // 6,
            // 8,
        ];
        const PARITY_FRAGS = [
            0,
            1,
            2,
            // 3,
            // 4,
        ];

        _.forEach(PLACEMENTS, data_placement =>
            _.forEach(NUM_POOLS, num_pools =>
                _.forEach(REPLICAS, replicas =>
                    _.forEach(DATA_FRAGS, data_frags =>
                        _.forEach(PARITY_FRAGS, parity_frags =>
                            make_tests(num_pools, replicas, data_placement, data_frags, parity_frags)
                        )))));


        function make_tests(num_pools, replicas, data_placement, data_frags, parity_frags) {

            const total_frags = data_frags + parity_frags;
            const total_replicas = data_placement === 'MIRROR' ? replicas * num_pools : replicas;
            const total_blocks = total_replicas * total_frags;
            const chunk_coder_config = { replicas, data_frags, parity_frags };
            const frags = _.concat(
                _.times(data_frags, data_index => ({ _id: new mongodb.ObjectId(), data_index })),
                _.times(parity_frags, parity_index => ({ _id: new mongodb.ObjectId(), parity_index }))
            );

            const regular_pools = _.times(num_pools, i => ({ _id: new mongodb.ObjectId(), name: 'regular_pool' + i, }));
            const spill_pools = _.times(num_pools, i => ({ _id: new mongodb.ObjectId(), name: 'spill_pool' + i, }));
            const external_pools = _.times(num_pools, i => ({ _id: new mongodb.ObjectId(), name: 'external_pool' + i, }));
            const regular_mirrors = data_placement === 'MIRROR' ?
                regular_pools.map(pool => ({ spread_pools: [pool] })) : [{ spread_pools: regular_pools }];
            const spill_mirrors = data_placement === 'MIRROR' ?
                spill_pools.map(pool => ({ spread_pools: [pool] })) : [{ spread_pools: spill_pools }];
            const regular_tier = {
                _id: new mongodb.ObjectId(),
                name: 'regular_tier',
                data_placement,
                mirrors: regular_mirrors,
                chunk_config: { chunk_coder_config },
            };
            const spillover_tier = {
                _id: new mongodb.ObjectId(),
                name: 'spillover_tier',
                data_placement,
                mirrors: spill_mirrors,
                chunk_config: { chunk_coder_config },
            };
            const tiering = {
                _id: new mongodb.ObjectId(),
                name: 'tiering_policy',
                tiers: [{
                    order: 0,
                    tier: regular_tier,
                    spillover: false,
                    disabled: false
                }, {
                    order: 1,
                    tier: spillover_tier,
                    spillover: true,
                    disabled: false
                }]
            };

            const pools_by_tier_id = _.fromPairs(_.map(tiering.tiers,
                ({ tier }) => [tier._id, _.flatMap(tier.mirrors, 'spread_pools')]
            ));
            const regular_tiering_status = _.fromPairs(_.map(tiering.tiers,
                ({ tier }) => [tier._id, {
                    pools: _.fromPairs(_.map(pools_by_tier_id[tier._id],
                        pool => [pool._id, { valid_for_allocation: true, num_nodes: config.NODES_MIN_COUNT }]
                    )),
                    mirrors_storage: tier.mirrors.map(mirror => ({ free: { peta: 1, n: 0 } }))
                }]
            ));
            const spillover_tiering_status = _.fromPairs(_.map(tiering.tiers,
                ({ tier, spillover }) => [tier._id, {
                    pools: _.fromPairs(_.map(pools_by_tier_id[tier._id],
                        pool => [pool._id, { valid_for_allocation: true, num_nodes: config.NODES_MIN_COUNT }]
                    )),
                    mirrors_storage: tier.mirrors.map(mirror => ({ free: spillover ? { peta: 1, n: 0 } : 0 }))
                }]
            ));

            const test_name = `num_pools=${num_pools} replicas=${replicas} ${data_placement} data_frags=${data_frags} parity_frags=${parity_frags}`;

            mocha.describe(test_name, function() {

                mocha.describe('allocations', function() {

                    mocha.it('should allocate from regular_tier', function() {
                        const chunk = {
                            frags,
                            chunk_coder_config,
                        };
                        const mapping = mapper.map_chunk(chunk, tiering, regular_tiering_status);
                        assert(!mapping.accessible, '!accessible');
                        assert.strictEqual(mapping.allocations.length, replicas * total_frags);
                        assert.strictEqual(mapping.deletions, undefined);
                        assert_allocations_in_tier(mapping.allocations, regular_tier);
                    });

                    mocha.it('should allocate from spillover_tier', function() {
                        const chunk = {
                            frags,
                            chunk_coder_config,
                        };
                        const mapping = mapper.map_chunk(chunk, tiering, spillover_tiering_status);
                        assert(!mapping.accessible, '!accessible');
                        assert.strictEqual(mapping.allocations.length, replicas * total_frags);
                        assert.strictEqual(mapping.deletions, undefined);
                        assert_allocations_in_tier(mapping.allocations, spillover_tier);
                    });

                });

                mocha.describe('deletions', function() {

                    mocha.it('should do nothing when chunk is good', function() {
                        const chunk = {
                            _id: 1,
                            frags,
                            chunk_coder_config,
                            blocks: make_blocks(),
                        };
                        const mapping = mapper.map_chunk(chunk, tiering, regular_tiering_status);
                        assert(mapping.accessible, 'accessible');
                        assert.strictEqual(mapping.allocations, undefined);
                        assert.strictEqual(mapping.deletions, undefined);
                    });

                    mocha.it('should remove blocks from pools not in the tier', function() {
                        const chunk = {
                            _id: 1,
                            frags,
                            chunk_coder_config,
                            blocks: _.concat(
                                make_blocks(),
                                make_blocks({ pool: external_pools[0] })
                            ),
                        };
                        const mapping = mapper.map_chunk(chunk, tiering, regular_tiering_status);
                        assert(mapping.accessible, 'accessible');
                        assert.strictEqual(mapping.allocations, undefined);
                        assert.strictEqual(mapping.deletions.length, total_blocks);
                    });

                    mocha.it('should delete inaccessible block', function() {
                        const chunk = {
                            _id: 1,
                            frags,
                            chunk_coder_config,
                            blocks: _.concat(
                                make_blocks({ count: 1, readable: false }),
                                make_blocks()
                            ),
                        };
                        const mapping = mapper.map_chunk(chunk, tiering, regular_tiering_status);
                        assert(mapping.accessible, 'accessible');
                        assert.strictEqual(mapping.allocations, undefined);
                        assert.strictEqual(mapping.deletions.length, 1);
                        assert_deletions_in_tier(mapping.deletions, regular_tier);
                    });

                });

                mocha.describe('rebuild', function() {

                    mocha.it('should replicate from single block', function() {
                        const chunk = {
                            _id: 1,
                            frags,
                            chunk_coder_config,
                            blocks: make_blocks({ count: total_frags }),
                        };
                        const mapping = mapper.map_chunk(chunk, tiering, regular_tiering_status);
                        assert(mapping.accessible, 'accessible');
                        assert.strictEqual(mapping.deletions, undefined);
                        if (total_blocks === total_frags) {
                            assert.strictEqual(mapping.allocations, undefined);
                        } else {
                            assert.strictEqual(mapping.allocations.length, total_blocks - total_frags);
                            assert_allocations_in_tier(mapping.allocations, regular_tier);
                        }
                    });

                    mocha.it('should first allocate missing and only then delete inaccessible block', function() {
                        const chunk = {
                            _id: 1,
                            frags,
                            chunk_coder_config,
                            blocks: _.concat(
                                make_blocks({ count: 1, readable: false }),
                                make_blocks({ count: total_frags })
                            ),
                        };
                        const mapping = mapper.map_chunk(chunk, tiering, regular_tiering_status);
                        assert(mapping.accessible, 'accessible');
                        if (total_blocks === total_frags) {
                            assert.strictEqual(mapping.allocations, undefined);
                            assert.strictEqual(mapping.deletions.length, 1);
                            assert_deletions_in_tier(mapping.deletions, regular_tier);
                        } else {
                            assert.strictEqual(mapping.allocations.length, total_blocks - total_frags);
                            assert.strictEqual(mapping.deletions, undefined);
                            assert_allocations_in_tier(mapping.allocations, regular_tier);
                            // "allocate" the requested blocks and try again
                            chunk.blocks = _.concat(chunk.blocks, make_blocks({ allocations: mapping.allocations }));
                            assert.strictEqual(chunk.blocks.length, total_blocks + 1);
                            const mapping2 = mapper.map_chunk(chunk, tiering, regular_tiering_status);
                            assert(mapping2.accessible, 'accessible');
                            assert.strictEqual(mapping2.allocations, undefined);
                            assert.strictEqual(mapping2.deletions.length, 1);
                            assert_deletions_in_tier(mapping2.deletions, regular_tier);
                        }
                    });

                });

                mocha.describe('spillover', function() {

                    mocha.it('should spillover on non writable nodes', function() {
                        const chunk = {
                            _id: 1,
                            frags,
                            chunk_coder_config,
                            blocks: make_blocks({ writable: false }),
                        };
                        const mapping = mapper.map_chunk(chunk, tiering, spillover_tiering_status);
                        assert(mapping.accessible, 'accessible');
                        assert.strictEqual(mapping.allocations.length, total_blocks);
                        assert.strictEqual(mapping.deletions, undefined);
                        assert_allocations_in_tier(mapping.allocations, spillover_tier);
                    });

                    mocha.it('should spillover on non policy pools', function() {
                        const chunk = {
                            _id: 1,
                            frags,
                            chunk_coder_config,
                            blocks: make_blocks({ pool: external_pools[0] }),
                        };
                        const mapping = mapper.map_chunk(chunk, tiering, spillover_tiering_status);
                        assert(mapping.accessible, 'accessible');
                        assert.strictEqual(mapping.allocations.length, total_blocks);
                        assert.strictEqual(mapping.deletions, undefined);
                        assert_allocations_in_tier(mapping.allocations, spillover_tier);
                    });

                    mocha.it('should spillback', function() {
                        const chunk = {
                            _id: 1,
                            frags,
                            chunk_coder_config,
                            blocks: make_blocks({ tier: spillover_tier }),
                        };
                        const mapping = mapper.map_chunk(chunk, tiering, regular_tiering_status);
                        assert(mapping.accessible, 'accessible');
                        assert.strictEqual(mapping.allocations.length, total_blocks);
                        assert.strictEqual(mapping.deletions, undefined);
                        assert_allocations_in_tier(mapping.allocations, regular_tier);
                    });

                    mocha.it('should delete unneeded blocks from spillover', function() {
                        const chunk = {
                            _id: 1,
                            frags,
                            chunk_coder_config,
                            blocks: _.concat(
                                make_blocks({ tier: regular_tier }),
                                make_blocks({ tier: spillover_tier })
                            ),
                        };
                        const mapping = mapper.map_chunk(chunk, tiering, regular_tiering_status);
                        assert(mapping.accessible, 'accessible');
                        assert.strictEqual(mapping.allocations, undefined);
                        assert.strictEqual(mapping.deletions.length, total_blocks);
                        assert_deletions_in_tier(mapping.deletions, spillover_tier);
                    });

                });

            });


            function make_blocks(params = {}) {
                if (params.allocations) {
                    // "allocate" the requested blocks
                    return _.map(params.allocations, ({ frag, pools }) => {
                        params.frag = frag;
                        params.pool = _.sample(pools);
                        return make_block(params);
                    });
                } else {
                    const count = params.count || total_blocks;
                    return _.times(count, i => make_block(params, i));
                }
            }

            function make_block(params = {}, i = 0) {
                let {
                    readable,
                    writable,
                    is_cloud_node,
                    is_mongo_node,
                    tier = regular_tier,
                    storage = { free: 100 * 1024 * 1024 * 1024 },
                    heartbeat = new Date(),
                } = params;

                const pools = pools_by_tier_id[tier._id];
                const pool_i = Math.floor(i / frags.length) % pools.length;
                const pool = params.pool || pools[pool_i];
                const pool_name = pool.name;

                const frag_i = i % frags.length;
                const frag = params.frag || frags[frag_i];
                const frag_index = frag && _frag_index(frag);

                const _id = new mongodb.ObjectID();
                const _id_str = _id.toString();

                return {
                    // FOR DEBUGGING ONLY {
                    pool_name,
                    frag_index,
                    _id_str,
                    // }
                    _id,
                    frag: frag._id,
                    pool: pool._id,
                    node: {
                        pool: pool._id,
                        readable: readable !== false,
                        writable: writable !== false,
                        is_cloud_node,
                        is_mongo_node,
                        storage: storage || { free: 100 * 1024 * 1024 * 1024 },
                        heartbeat: heartbeat || new Date(),
                    },
                };
            }

            function assert_allocations_in_tier(allocations, tier) {
                const tier_pools = pools_by_tier_id[tier._id];
                _.forEach(allocations, ({ pools }) =>
                    _.forEach(pools, pool =>
                        assert(_.includes(tier_pools, pool), 'assert_allocations_in_tier')
                    )
                );
            }

            function assert_deletions_in_tier(deletions, tier) {
                const tier_pools = pools_by_tier_id[tier._id].map(pool => pool._id);
                _.forEach(deletions, block =>
                    assert(_.includes(tier_pools, block.pool), 'assert_deletions_in_tier')
                );

            }
        }

    });
});

function _frag_index(frag) {
    if (frag.data_index >= 0) return `D${frag.data_index}`;
    if (frag.parity_index >= 0) return `P${frag.parity_index}`;
    if (frag.lrc_index >= 0) return `L${frag.lrc_index}`;
    throw new Error('BAD FRAG ' + JSON.stringify(frag));
}
