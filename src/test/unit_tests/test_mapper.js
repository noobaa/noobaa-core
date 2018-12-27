/* Copyright (C) 2016 NooBaa */
/* eslint max-lines-per-function: ['error', 625] */
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.no_setup();

const _ = require('lodash');
const mocha = require('mocha');
const assert = require('assert');
const mongodb = require('mongodb');

const config = require('../../../config.js');
const mapper = require('../../server/object_services/mapper');

coretest.describe_mapper_test_case({
    name: 'mapper',
}, ({
    test_name,
    bucket_name,
    data_placement,
    num_pools,
    replicas,
    data_frags,
    parity_frags,
    total_frags,
    total_blocks,
    total_replicas,
    chunk_coder_config,
}) => {

    const frags = _.concat(
        _.times(data_frags, data_index => ({ _id: new mongodb.ObjectId(), data_index })),
        _.times(parity_frags, parity_index => ({ _id: new mongodb.ObjectId(), parity_index }))
    );
    const regular_pools = _.times(num_pools, i => ({ _id: new mongodb.ObjectId(), name: 'regular_pool' + i, }));
    const spill_pools = _.times(num_pools, i => ({ _id: new mongodb.ObjectId(), name: 'spill_pool' + i, }));
    const external_pools = _.times(num_pools, i => ({ _id: new mongodb.ObjectId(), name: 'external_pool' + i, }));
    const pool_by_id = _.keyBy(_.concat(regular_pools, spill_pools, external_pools), '_id');
    const regular_mirrors = data_placement === 'MIRROR' ?
        regular_pools.map(pool => ({
            _id: new mongodb.ObjectId(),
            spread_pools: [pool]
        })) : [{
            _id: new mongodb.ObjectId(),
            spread_pools: regular_pools
        }];
    const spill_mirrors = data_placement === 'MIRROR' ?
        spill_pools.map(pool => ({
            _id: new mongodb.ObjectId(),
            spread_pools: [pool]
        })) : [{
            _id: new mongodb.ObjectId(),
            spread_pools: spill_pools
        }];
    const regular_tier = {
        _id: new mongodb.ObjectId(),
        name: 'regular_tier',
        data_placement,
        mirrors: regular_mirrors,
        chunk_config: { chunk_coder_config },
    };
    const second_tier = {
        _id: new mongodb.ObjectId(),
        name: 'second_tier',
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
            tier: second_tier,
            spillover: false,
            disabled: false
        }]
    };

    const pools_by_tier_id = _.fromPairs(_.map(tiering.tiers,
        ({ tier }) => [tier._id, _.flatMap(tier.mirrors, 'spread_pools')]
    ));

    const ZERO_STORAGE = { free: 0, regular_free: 0, redundant_free: 0 };
    const FULL_STORAGE = {
        free: { peta: 2, n: 0 },
        regular_free: { peta: 1, n: 0 },
        redundant_free: { peta: 1, n: 0 }
    };

    const default_tiering_status = _.fromPairs(_.map(tiering.tiers,
        ({ tier, spillover }) => [tier._id, {
            pools: _.fromPairs(_.map(pools_by_tier_id[tier._id],
                pool => [pool._id, { valid_for_allocation: true, num_nodes: config.NODES_MIN_COUNT }]
            )),
            mirrors_storage: tier.mirrors.map(mirror => FULL_STORAGE)
        }]
    ));
    const second_tiering_status = _.fromPairs(_.map(tiering.tiers,
        ({ tier, order }) => [tier._id, {
            pools: _.fromPairs(_.map(pools_by_tier_id[tier._id],
                pool => [pool._id, { valid_for_allocation: true, num_nodes: config.NODES_MIN_COUNT }]
            )),
            mirrors_storage: tier.mirrors.map(mirror => (order === 1 ? FULL_STORAGE : ZERO_STORAGE))
        }]
    ));
    const empty_tiering_status = _.fromPairs(_.map(tiering.tiers,
        ({ tier, spillover }) => [tier._id, {
            pools: _.fromPairs(_.map(pools_by_tier_id[tier._id],
                pool => [pool._id, { valid_for_allocation: true, num_nodes: config.NODES_MIN_COUNT }]
            )),
            mirrors_storage: tier.mirrors.map(mirror => ZERO_STORAGE)
        }]
    ));
    const first_mirror_empty_tiering_status = _.fromPairs(_.map(tiering.tiers,
        ({ tier, spillover }) => [tier._id, {
            pools: _.fromPairs(_.map(pools_by_tier_id[tier._id],
                pool => [pool._id, { valid_for_allocation: true, num_nodes: config.NODES_MIN_COUNT }]
            )),
            mirrors_storage: tier.mirrors.map((mirror, index) => (index === 0 ? ZERO_STORAGE : FULL_STORAGE))
        }]
    ));
    const regular_tiering_status = _.fromPairs(_.map(tiering.tiers,
        ({ tier, order }) => [tier._id, {
            pools: _.fromPairs(_.map(pools_by_tier_id[tier._id],
                pool => [pool._id, { valid_for_allocation: true, num_nodes: config.NODES_MIN_COUNT }]
            )),
            mirrors_storage: tier.mirrors.map(mirror => (order === 1 ? ZERO_STORAGE : FULL_STORAGE))
        }]
    ));

    mocha.describe('allocations', function() {

        mocha.it('should allocate from regular_tier', function() {
            const chunk = {
                frags,
                chunk_coder_config,
            };
            const selected_tier = mapper.select_tier_for_write(tiering, default_tiering_status);
            const mapping = mapper.map_chunk(chunk, selected_tier, tiering, default_tiering_status);
            assert(!mapping.accessible, '!accessible');
            assert.strictEqual(mapping.allocations.length, replicas * total_frags);
            assert.strictEqual(mapping.deletions, undefined);
            assert_allocations_in_tier(mapping.allocations, regular_tier);
            // TODO assert frags
        });

        mocha.it('should allocate from second_tier', function() {
            const chunk = {
                frags,
                chunk_coder_config,
            };
            const selected_tier = mapper.select_tier_for_write(tiering, second_tiering_status);
            const mapping = mapper.map_chunk(chunk, selected_tier, tiering, second_tiering_status);
            assert(!mapping.accessible, '!accessible');
            assert.strictEqual(mapping.allocations.length, replicas * total_frags);
            assert.strictEqual(mapping.deletions, undefined);
            assert_allocations_in_tier(mapping.allocations, second_tier);
            // TODO assert frags
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
            const selected_tier = mapper.select_tier_for_write(tiering, default_tiering_status);
            const mapping = mapper.map_chunk(chunk, selected_tier, tiering, default_tiering_status);
            assert(mapping.accessible, 'accessible');
            assert.strictEqual(mapping.allocations, undefined);
            assert.strictEqual(mapping.deletions, undefined);
        });

        mocha.it('should remove blocks from pools not in the tier', function() {
            const external_blocks = make_blocks({ pool: external_pools[0] });
            const chunk = {
                _id: 1,
                frags,
                chunk_coder_config,
                blocks: _.concat(make_blocks(), external_blocks),
            };
            const selected_tier = mapper.select_tier_for_write(tiering, default_tiering_status);
            const mapping = mapper.map_chunk(chunk, selected_tier, tiering, default_tiering_status);
            assert(mapping.accessible, 'accessible');
            assert.strictEqual(mapping.allocations, undefined);
            assert.strictEqual(mapping.deletions.length, total_blocks);
            mapping.deletions.forEach(block => assert(external_blocks.includes(block)));
        });

        mocha.it('should delete inaccessible block', function() {
            const inaccessible_blocks = make_blocks({ count: 1, readable: false });
            const chunk = {
                _id: 1,
                frags,
                chunk_coder_config,
                blocks: _.concat(make_blocks(), inaccessible_blocks),
            };
            const selected_tier = mapper.select_tier_for_write(tiering, default_tiering_status);
            const mapping = mapper.map_chunk(chunk, selected_tier, tiering, default_tiering_status);
            assert(mapping.accessible, 'accessible');
            assert.strictEqual(mapping.allocations, undefined);
            assert.strictEqual(mapping.deletions.length, 1);
            assert_deletions_in_tier(mapping.deletions, regular_tier);
            mapping.deletions.forEach(block => assert(inaccessible_blocks.includes(block)));
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
            const selected_tier = mapper.select_tier_for_write(tiering, default_tiering_status);
            const mapping = mapper.map_chunk(chunk, selected_tier, tiering, default_tiering_status);
            assert(mapping.accessible, 'accessible');
            assert.strictEqual(mapping.deletions, undefined);
            if (total_blocks === total_frags) {
                assert.strictEqual(mapping.allocations, undefined);
            } else {
                assert.strictEqual(mapping.allocations.length, total_blocks - total_frags);
                // TODO check allocations on all fragments
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
            const selected_tier = mapper.select_tier_for_write(tiering, default_tiering_status);
            const mapping = mapper.map_chunk(chunk, selected_tier, tiering, default_tiering_status);
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
                const selected_tier2 = mapper.select_tier_for_write(tiering, default_tiering_status);
                const mapping2 = mapper.map_chunk(chunk, selected_tier2, tiering, default_tiering_status);
                assert(mapping2.accessible, 'accessible');
                assert.strictEqual(mapping2.allocations, undefined);
                assert.strictEqual(mapping2.deletions.length, 1);
                assert_deletions_in_tier(mapping2.deletions, regular_tier);
            }
        });

        mocha.it('should rebuild missing EC fragment', function() {
            // TODO separate to 3 cases - only parity, only data, mix
            const avail_frags = _.sampleSize(frags, data_frags);
            const missing_frags = _.difference(frags, avail_frags);
            const chunk = {
                _id: 1,
                frags,
                chunk_coder_config,
                blocks: make_blocks({ count: data_frags * total_replicas, frags: avail_frags }),
            };
            const selected_tier = mapper.select_tier_for_write(tiering, default_tiering_status);
            const mapping = mapper.map_chunk(chunk, selected_tier, tiering, default_tiering_status);
            assert(mapping.accessible, 'accessible');
            assert.strictEqual(mapping.deletions, undefined);
            if (parity_frags) {
                const allocs_per_frag = _.groupBy(mapping.allocations, ({ frag }) => _frag_index(frag));
                assert.deepStrictEqual(Object.keys(allocs_per_frag).sort(), missing_frags.map(_frag_index).sort(),
                    `Object.keys(allocs_per_frag).sort() === missing_frags.map(_frag_index).sort()`);
                assert.deepStrictEqual(_.uniq(mapping.missing_frags).map(_frag_index).sort(), missing_frags.map(_frag_index).sort(),
                    `mapping.missing_frags.map(_frag_index).sort() === missing_frags.map(_frag_index).sort()`);
                _.forEach(allocs_per_frag, allocs => {
                    assert.strictEqual(allocs.length, total_replicas, `allocs.length === total_replicas`);
                    _.forEach(allocs, alloc => {
                        assert.strictEqual(alloc.sources, undefined);
                        // const sources_by_frag = _.groupBy(alloc.sources.accessible_blocks, ({ frag_index }) => frag_index);
                        // assert.deepStrictEqual(Object.keys(sources_by_frag).sort(), avail_frags.map(_frag_index).sort(),
                        //     `Object.keys(sources_by_frag).sort() === avail_frags.map(_frag_index).sort()`);
                    });
                });
                assert.strictEqual(mapping.allocations.length, parity_frags * total_replicas);
                assert_allocations_in_tier(mapping.allocations, regular_tier);
            } else {
                assert.strictEqual(mapping.allocations, undefined);
            }
        });

    });

    // mocha.describe('spillover', function() {

    //     mocha.it('should spillover on non writable nodes', function() {
    //         const chunk = {
    //             _id: 1,
    //             frags,
    //             chunk_coder_config,
    //             blocks: make_blocks({ writable: false }),
    //         };
    //         const mapping = mapper.map_chunk(chunk, tiering, spillover_tiering_status);
    //         assert(mapping.accessible, 'accessible');
    //         assert.strictEqual(mapping.allocations.length, total_blocks);
    //         assert.strictEqual(mapping.deletions, undefined);
    //         assert_allocations_in_tier(mapping.allocations, spillover_tier);
    //     });

    //     mocha.it('should spillover on non policy pools', function() {
    //         const chunk = {
    //             _id: 1,
    //             frags,
    //             chunk_coder_config,
    //             blocks: make_blocks({ pool: external_pools[0] }),
    //         };
    //         const mapping = mapper.map_chunk(chunk, tiering, spillover_tiering_status);
    //         assert(mapping.accessible, 'accessible');
    //         assert.strictEqual(mapping.allocations.length, total_blocks);
    //         assert.strictEqual(mapping.deletions, undefined);
    //         assert_allocations_in_tier(mapping.allocations, spillover_tier);
    //     });

    //     mocha.it('should spillback', function() {
    //         const chunk = {
    //             _id: 1,
    //             frags,
    //             chunk_coder_config,
    //             blocks: make_blocks({ tier: spillover_tier }),
    //         };
    //         const mapping = mapper.map_chunk(chunk, tiering, default_tiering_status);
    //         assert(mapping.accessible, 'accessible');
    //         assert.strictEqual(mapping.allocations.length, total_blocks);
    //         assert.strictEqual(mapping.deletions, undefined);
    //         assert_allocations_in_tier(mapping.allocations, regular_tier);
    //     });

    //     mocha.it('should delete unneeded blocks from spillover', function() {
    //         const chunk = {
    //             _id: 1,
    //             frags,
    //             chunk_coder_config,
    //             blocks: _.concat(
    //                 make_blocks({ tier: regular_tier }),
    //                 make_blocks({ tier: spillover_tier })
    //             ),
    //         };
    //         const mapping = mapper.map_chunk(chunk, tiering, default_tiering_status);
    //         assert(mapping.accessible, 'accessible');
    //         assert.strictEqual(mapping.allocations, undefined);
    //         assert.strictEqual(mapping.deletions.length, total_blocks);
    //         assert_deletions_in_tier(mapping.deletions, spillover_tier);
    //     });

    // });

    mocha.describe('local replication', function() {
        mocha.it('should replicate to local pool', function() {
            const location_info = {
                pool_id: String(regular_pools[0]._id)
            };
            const chunk = {
                _id: 1,
                frags,
                chunk_coder_config,
                blocks: regular_pools.length > 1 ? make_blocks({ pools: regular_pools.slice(1) }) : [],
            };
            const selected_tier = mapper.select_tier_for_write(tiering, default_tiering_status);
            const mapping = mapper.map_chunk(chunk, selected_tier, tiering, default_tiering_status, location_info);
            const should_rebuild = mapper.should_rebuild_chunk_to_local_mirror(mapping, location_info);
            if (data_placement === 'MIRROR' && regular_pools.length > 1) {
                assert.strictEqual(should_rebuild, true);
            } else {
                assert.strictEqual(should_rebuild, false);
                assert.strictEqual(((mapping.blocks_in_use && mapping.blocks_in_use.length) || 0) +
                    ((mapping.allocations && mapping.allocations.length) || 0), total_blocks);
                assert_allocations_in_tier(mapping.allocations, regular_tier);
            }
        });

        mocha.it('should replicate to pool with the same region', function() {
            const location_info = {
                region: 'REGION-X'
            };
            const chunk = {
                _id: 1,
                frags,
                chunk_coder_config,
                blocks: regular_pools.length > 1 ? make_blocks({ pools: regular_pools.slice(1) }) : [],
            };
            if (data_placement === 'MIRROR' && regular_pools.length > 1) {
                regular_pools[0].region = 'REGION-X';
            }
            const selected_tier = mapper.select_tier_for_write(tiering, default_tiering_status);
            const mapping = mapper.map_chunk(chunk, selected_tier, tiering, default_tiering_status, location_info);
            const should_rebuild = mapper.should_rebuild_chunk_to_local_mirror(mapping, location_info);
            if (data_placement === 'MIRROR' && regular_pools.length > 1) {
                assert.strictEqual(should_rebuild, true);
            } else {
                assert.strictEqual(should_rebuild, false);
                assert.strictEqual(((mapping.blocks_in_use && mapping.blocks_in_use.length) || 0) +
                    ((mapping.allocations && mapping.allocations.length) || 0), total_blocks);
                assert_allocations_in_tier(mapping.allocations, regular_tier);
            }
        });

        mocha.it('should not replicate to pool with the different region', function() {
            const location_info = {
                region: 'REGION-Y'
            };
            const chunk = {
                _id: 1,
                frags,
                chunk_coder_config,
                blocks: regular_pools.length > 1 ? make_blocks({ pools: regular_pools.slice(1) }) : [],
            };
            if (data_placement === 'MIRROR' && regular_pools.length > 1) {
                regular_pools[0].region = 'REGION-X';
            }
            const selected_tier = mapper.select_tier_for_write(tiering, default_tiering_status);
            const mapping = mapper.map_chunk(chunk, selected_tier, tiering, default_tiering_status, location_info);
            assert.strictEqual(mapper.should_rebuild_chunk_to_local_mirror(mapping, location_info), false);
        });

        mocha.it('should not replicate to local pool if local already has blocks', function() {
            const location_info = {
                pool_id: String(regular_pools[0]._id)
            };
            const chunk = {
                _id: 1,
                frags,
                chunk_coder_config,
                blocks: regular_pools.length > 1 ?
                    make_blocks({ pools: regular_pools.slice(0, regular_pools.length - 1) }) : make_blocks({ pool: regular_pools[0] }),
            };
            const selected_tier = mapper.select_tier_for_write(tiering, default_tiering_status);
            const mapping = mapper.map_chunk(chunk, selected_tier, tiering, default_tiering_status, location_info);
            assert.strictEqual(mapper.should_rebuild_chunk_to_local_mirror(mapping, location_info), false);
        });

        mocha.it('should not replicate to local pool if no allocation needed', function() {
            const location_info = {
                pool_id: String(regular_pools[0]._id)
            };
            const chunk = {
                _id: 1,
                frags,
                chunk_coder_config,
                blocks: regular_pools.length > 1 ?
                    make_blocks({ pools: regular_pools }) : make_blocks({ pool: regular_pools[0] })
            };
            const selected_tier = mapper.select_tier_for_write(tiering, default_tiering_status);
            const mapping = mapper.map_chunk(chunk, selected_tier, tiering, default_tiering_status, location_info);
            assert.strictEqual(mapper.should_rebuild_chunk_to_local_mirror(mapping, location_info), false);
        });

        mocha.it('should not replicate to local pool if local is full', function() {
            const location_info = {
                pool_id: String(regular_pools[0]._id)
            };
            const chunk = {
                _id: 1,
                frags,
                chunk_coder_config,
                blocks: regular_pools.length > 1 ? // will put blocks only on last pool - should allocate only to the empty pool, or none - pool[0] doesn't suppose to appear
                    make_blocks({ pools: regular_pools.slice(regular_pools.length - 1) }) : [],
            };
            const selected_tier = mapper.select_tier_for_write(tiering, first_mirror_empty_tiering_status);
            const mapping = mapper.map_chunk(chunk, selected_tier, tiering, first_mirror_empty_tiering_status, location_info);
            const should_rebuild = mapper.should_rebuild_chunk_to_local_mirror(mapping, location_info);
            assert.strictEqual(should_rebuild, false);
        });
    });

    mocha.describe('tiering', function() {

        const REGULAR = 'regular';
        const SECOND = 'second';
        const TIERING_STATUS = Symbol('tiering_status_symbol');
        const tiering_tests = {
            all_tiers_have_space: {
                [TIERING_STATUS]: default_tiering_status,
                all_tiers_have_chunk: REGULAR,
                all_tiers_dont_have_chunk: REGULAR,
                only_regular_tier_has_chunk: REGULAR,
                only_second_tier_has_chunk: REGULAR,
            },
            all_tiers_dont_have_space: {
                [TIERING_STATUS]: empty_tiering_status,
                all_tiers_have_chunk: REGULAR,
                all_tiers_dont_have_chunk: REGULAR,
                only_regular_tier_has_chunk: REGULAR,
                only_second_tier_has_chunk: SECOND,
            },
            only_second_tier_has_space: {
                [TIERING_STATUS]: second_tiering_status,
                all_tiers_have_chunk: REGULAR,
                all_tiers_dont_have_chunk: SECOND,
                only_regular_tier_has_chunk: REGULAR,
                only_second_tier_has_chunk: SECOND,
            },
            only_regular_tier_has_space: {
                [TIERING_STATUS]: regular_tiering_status,
                all_tiers_have_chunk: REGULAR,
                all_tiers_dont_have_chunk: REGULAR,
                only_regular_tier_has_chunk: REGULAR,
                only_second_tier_has_chunk: REGULAR,
            },
        };

        _.forEach(tiering_tests, (chunk_tests, tiering_test) => {
            mocha.describe(tiering_test, function() {
                const tiering_status = chunk_tests[TIERING_STATUS];
                _.forEach(chunk_tests, (map_result, chunk_test) => {
                    mocha.it(chunk_test, function() {
                        const expected_tier = map_result === SECOND ? second_tier : regular_tier;
                        const unexpected_tier = map_result === SECOND ? regular_tier : second_tier;
                        const chunk = {
                            _id: 1,
                            frags,
                            chunk_coder_config,
                            blocks: _.concat(
                                (
                                    chunk_test === 'all_tiers_have_chunk' ||
                                    chunk_test === 'only_regular_tier_has_chunk'
                                ) ? make_blocks({ tier: regular_tier }) : [],
                                (
                                    chunk_test === 'all_tiers_have_chunk' ||
                                    chunk_test === 'only_second_tier_has_chunk'
                                ) ? make_blocks({ tier: second_tier }) : []
                            ),
                        };
                        // const selected_tier = mapper.select_tier_for_write(tiering, tiering_status);
                        const mapping = mapper.map_chunk(chunk, regular_tier, tiering, tiering_status);
                        assert_allocations_in_tier(mapping.allocations, expected_tier);
                        assert_deletions_in_tier(mapping.deletions, unexpected_tier);
                    });
                });
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

        const frags_to_use = params.frags || frags;
        const frag_i = i % frags_to_use.length;
        const frag = params.frag || frags_to_use[frag_i];
        const frag_index = frag && _frag_index(frag);

        const pools_to_use = params.pools || pools_by_tier_id[tier._id];
        const pool_i = Math.floor(i / frags_to_use.length) % pools_to_use.length;
        const pool = params.pool || pools_to_use[pool_i];
        const pool_name = pool.name;

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
        _.forEach(allocations, ({ pools }) => (
            _.forEach(pools, pool => (
                assert(_.includes(tier_pools, pool), `assert_allocations_in_tier expected tier ${tier.name} found pool ${pool.name}`)
            ))
        ));
    }

    function assert_deletions_in_tier(deletions, tier) {
        const tier_pools = pools_by_tier_id[tier._id].map(pool => pool._id);
        _.forEach(deletions, block => (
            assert(_.includes(tier_pools, block.pool), `assert_deletions_in_tier expected tier ${tier.name} found pool ${pool_by_id[block.pool].name}`)
        ));
    }

});

function _frag_index(frag) {
    if (frag.data_index >= 0) return `D${frag.data_index}`;
    if (frag.parity_index >= 0) return `P${frag.parity_index}`;
    if (frag.lrc_index >= 0) return `L${frag.lrc_index}`;
    throw new Error('BAD FRAG ' + JSON.stringify(frag));
}
