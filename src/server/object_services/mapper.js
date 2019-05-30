/* Copyright (C) 2016 NooBaa */
'use strict';

/** @typedef {typeof import('../../sdk/nb')} nb */

const _ = require('lodash');
// const util = require('util');

const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const size_utils = require('../../util/size_utils');
// const system_store = require('../system_services/system_store').get_instance();


/**
 * @param {nb.Tiering} tiering
 * @param {nb.TieringStatus} tiering_status See node_allocator.get_tiering_status()
 * @param {number} [start_tier_order]
 * @returns {nb.Tier}
 */
function select_tier_for_write(tiering, tiering_status, start_tier_order) {
    let selected;
    for (const t of tiering.tiers) {
        if (t.disabled) continue;
        if (start_tier_order >= 0 && t.order < start_tier_order) continue;
        if (!selected) selected = t;
        const tier_status = tiering_status[t.tier._id.toHexString()];
        const tier_has_space = t.tier.mirrors.every((mirror, i) =>
            size_utils.json_to_bigint(tier_status.mirrors_storage[i].free)
            .greater(config.MIN_TIER_FREE_THRESHOLD)
        );
        if (!tier_has_space) continue;
        if (t.order < selected.order) selected = t;
    }
    return selected && selected.tier;
}


/**
 * To decide which mirror to use for the first writing mirror
 * we set a weight for each mirror_mapper based on the pool types
 * when all are regular pools we ...
 * @param {nb.Tier} tier
 * @param {nb.Tiering} tiering
 * @param {nb.TieringStatus} tiering_status See node_allocator.get_tiering_status()
 * @param {nb.LocationInfo} [location_info]
 * @returns {nb.TierMirror}
 */
function select_mirror_for_write(tier, tiering, tiering_status, location_info) {
    const tier_status = tiering_status[tier._id.toHexString()];
    let mirror_index = 0;
    let selected;
    let selected_weight;
    for (const mirror of tier.mirrors) {
        const mirror_status = tier_status.mirrors_storage[mirror_index];
        const local_pool = find_local_pool(mirror.spread_pools, location_info);
        const is_mongo_included = mirror.spread_pools.some(pool => Boolean(pool.mongo_pool_info));
        const is_local_pool_valid = local_pool && tier_status.pools[local_pool._id.toHexString()].valid_for_allocation;
        const is_regular_pools_valid = size_utils.json_to_bigint(mirror_status.regular_free).greater(config.MIN_TIER_FREE_THRESHOLD);
        const is_redundant_pools_valid = size_utils.json_to_bigint(mirror_status.redundant_free).greater(config.MIN_TIER_FREE_THRESHOLD);

        let weight = 0;
        if (is_mongo_included) {
            weight = 1;
        } else if (is_local_pool_valid) {
            weight = 4;
        } else if (is_regular_pools_valid) {
            weight = 3;
        } else if (is_redundant_pools_valid) {
            weight = 2;
        }

        if (!selected || weight > selected_weight || (weight === selected_weight && Math.random() > 0.5)) {
            selected = mirror;
            selected_weight = weight;
        }

        mirror_index += 1;
    }
    return selected;
}


/**
 * decide how to map a given chunk, either new, or existing
 *
 * @param {nb.Chunk} chunk The data chunk, with blocks populated
 * @param {nb.Tier} tier The chunk target tier
 * @param {nb.Tiering} tiering The bucket tiering
 * @param {nb.TieringStatus} tiering_status See node_allocator.get_tiering_status()
 * @param {nb.LocationInfo} [location_info]
 */
function map_chunk(chunk, tier, tiering, tiering_status, location_info) {
    const tier_status = tiering_status[tier._id.toHexString()];
    const blocks_in_use = new Set();
    const is_new_chunk = !chunk._id;

    const {
        replicas: tier_replicas = 1,
        data_frags: tier_data_frags = 1,
        parity_frags: tier_parity_frags = 0,
    } = tier.chunk_config.chunk_coder_config;

    const {
        replicas: chunk_replicas = 1,
        data_frags: chunk_data_frags = 1,
        parity_frags: chunk_parity_frags = 0,
    } = chunk.chunk_coder_config;

    // TODO GUY GAP handle change of data_frags between tier vs. chunk
    let replicas = tier_replicas;
    let data_frags = tier_data_frags;
    let parity_frags = tier_parity_frags;
    if (data_frags !== chunk_data_frags) {
        dbg.log0(`MirrorMapper: tier frags ${tier_data_frags}+${tier_parity_frags}`,
            `requires recoding chunk ${chunk_data_frags}+${chunk_parity_frags}`,
            '(not yet implemented)');
        replicas = chunk_replicas;
        data_frags = chunk_data_frags;
        parity_frags = chunk_parity_frags;
    }

    const mirror_for_write = is_new_chunk ? select_mirror_for_write(tier, tiering, tiering_status, location_info) : undefined;

    for (let data_index = 0; data_index < data_frags; ++data_index) {
        map_frag(chunk.frag_by_index[`D${data_index}`]);
    }
    for (let parity_index = 0; parity_index < parity_frags; ++parity_index) {
        map_frag(chunk.frag_by_index[`P${parity_index}`]);
    }

    if (!is_new_chunk) {
        const can_delete = chunk.is_accessible && !chunk.is_building_blocks;
        for (const frag of chunk.frags) {
            for (const block of frag.blocks) {
                if (blocks_in_use.has(block)) continue;
                if (can_delete) {
                    block.is_deletion = true;
                } else {
                    block.is_future_deletion = true;
                }
            }
        }
    }

    // Protect from too many deletions by checking:
    // - the number of unused blocks to delete does not include all blocks
    // - the number of unused blocks to delete does not exceed number blocks that should exist
    // - the number of used blocks against the the expected number of blocks
    // const min_num_blocks = this.tier.chunk_config.chunk_coder_config.data_frags || 1;
    // if (unused_blocks.length >= blocks.length ||
    //     unused_blocks.length > blocks.length - min_num_blocks ||
    //     used_blocks.length < min_num_blocks) {
    //     dbg.error('TierMapper.map_tier: ASSERT protect from too many deletions!',
    //         'min_num_blocks', min_num_blocks,
    //         'blocks.length', blocks.length,
    //         'used_blocks.length', used_blocks.length,
    //         'unused_blocks.length', unused_blocks.length,
    //         'tier', this.tier,
    //         'tier_mapping', tier_mapping,
    //         'chunk', chunk,
    //         'used_blocks', used_blocks,
    //         'unused_blocks', unused_blocks);
    // } else {
    //     tier_mapping.deletions = unused_blocks;
    // }

    /**
     * @param {nb.Frag} frag
     */
    function map_frag(frag) {
        const accessible_blocks = _.filter(frag.blocks, block => block.is_accessible);
        if (is_new_chunk) {
            // new chunk
            map_frag_in_mirror(mirror_for_write);
        } else {
            // if this frag is not accessible in existing chunk we
            // should attempt to rebuild from other frags
            if (!frag.is_accessible) {
                chunk.is_building_frags = true;
            }
            // existing chunk
            for (const mirror of tier.mirrors) {
                map_frag_in_mirror(mirror);
            }
        }

        /**
         * @param {nb.TierMirror} mirror 
         */
        function map_frag_in_mirror(mirror) {
            const used_blocks = [];
            const mirror_index = tier.mirrors.indexOf(mirror);
            const mirror_status = tier_status.mirrors_storage[mirror_index];
            const is_regular_pools_valid = size_utils.json_to_bigint(mirror_status.regular_free)
                .greater(config.MIN_TIER_FREE_THRESHOLD);
            const is_redundant_pools_valid = size_utils.json_to_bigint(mirror_status.redundant_free)
                .greater(config.MIN_TIER_FREE_THRESHOLD);
            const [redundant_pools, regular_pools] = _.partition(mirror.spread_pools, _pool_has_redundancy);

            let used_replicas = 0;
            let used_redundant_blocks = false;
            for (const block of accessible_blocks) {
                // block on pools that do not belong to the current mirror anymore
                // can be accessible but will eventually be deallocated
                const block_pool_in_mirror = mirror.spread_pools.find(pool => pool._id.toHexString() === block.pool_id.toHexString());
                const is_misplaced = !block.node.writable;
                if (!is_misplaced && block_pool_in_mirror) {
                    used_blocks.push(block);
                    // Also we calculate the weight of the current block allocations
                    // Notice that we do not calculate bad blocks into the weight
                    // We consider one replica in cloud/mongo valid for any policy
                    if (_pool_has_redundancy(block_pool_in_mirror)) {
                        used_redundant_blocks = true;
                        used_replicas += replicas;
                    } else {
                        used_replicas += 1;
                    }
                }
            }

            if (used_replicas === replicas) {

                for (let i = 0; i < used_blocks.length; ++i) {
                    blocks_in_use.add(used_blocks[i]);
                }

            } else if (used_replicas < replicas) {

                for (let i = 0; i < used_blocks.length; ++i) {
                    blocks_in_use.add(used_blocks[i]);
                }

                // We prefer to keep regular pools if possible, otherwise pick at random
                const pools = used_replicas && !used_redundant_blocks && is_regular_pools_valid ?
                    regular_pools : pick_pools();

                // num_missing of required replicas, which are a must to have for the chunk
                // In case of redundant pool allocation we consider one block as a fulfilment of all policy
                // Notice that in case of redundant pools we expect to be here only on the first allocation
                // Since the weight calculation above which adds max_replicas for every replica on redundant pool
                // Will block us from performing the current context and statement.
                const is_redundant = pools.length > 0 && pools === redundant_pools;
                const num_missing = is_redundant ? 1 : Math.max(0, replicas - used_replicas);

                // Notice that we push the minimum required replicas in higher priority
                // This is done in order to insure that we will allocate them before the additional replicas
                for (let i = 0; i < num_missing; ++i) chunk.add_block_allocation(frag, pools, mirror);

            } else {

                // To pick blocks to keep we sort by their creation timestamp in mongodb
                // and will keep newest blocks before older blocks
                // this approach helps to get rid of our "old" mapping decisions in favor of new decisions
                used_blocks.sort(_block_sort_newer_first);
                let keep_replicas = 0;
                for (let i = 0; i < used_blocks.length; ++i) {
                    if (keep_replicas >= replicas) break;
                    const block = used_blocks[i];
                    keep_replicas += _pool_has_redundancy(block.pool) ? replicas : 1;
                    blocks_in_use.add(block);
                }
            }


            /**
             * Pick random pool which sets the allocation type between redundant/regular pools
             * @returns {nb.Pool[]}
             */
            function pick_pools() {
                // handle the corner cases of redundant pools not valid and regular are valid (or vice versa).
                // in that case, return regular pools (or redundant pools in the opposite case).
                if (is_regular_pools_valid && !is_redundant_pools_valid) return regular_pools;
                if (!is_regular_pools_valid && is_redundant_pools_valid) return redundant_pools;

                // otherwise, pick a random pool to select which type to use.
                const picked_pool = mirror.spread_pools[Math.max(_.random(mirror.spread_pools.length - 1), 0)];
                if (picked_pool && _pool_has_redundancy(picked_pool)) {
                    return redundant_pools;
                } else {
                    return regular_pools;
                }
            }

        }
    }
}

function is_chunk_good_for_dedup(chunk) {
    if (!chunk.tier._id) return false; // chunk tier was deleted so will need to be reallocated
    if (!chunk.is_accessible) return false;
    if (chunk.is_building_blocks) return false;
    if (chunk.is_building_frags) return false;
    return true;
}

function get_num_blocks_per_chunk(tier) {
    const {
        replicas = 1,
            data_frags = 1,
            parity_frags = 0,
    } = tier.chunk_config.chunk_coder_config;
    return replicas * (data_frags + parity_frags);
}

/**
 * sorting function for sorting blocks with most recent heartbeat first
 * @param {nb.Block} block1
 * @param {nb.Block} block2
 */
function _block_sort_newer_first(block1, block2) {
    return block2._id.getTimestamp().getTime() - block1._id.getTimestamp().getTime();
}

// /**
//  * sorting function for sorting blocks with most recent heartbeat first
//  * @param {nb.Block} block1
//  * @param {nb.Block} block2
//  */
// function _block_sorter_basic(block1, block2) {
//     const node1 = block1.node;
//     const node2 = block2.node;
//     if (node2.readable && !node1.readable) return 1;
//     if (node1.readable && !node2.readable) return -1;
//     return node2.heartbeat - node1.heartbeat;
// }

// /**
//  * locality sorting function for blocks
//  * @param {nb.LocationInfo} location_info
//  */
// function _block_sorter_local(location_info) {
//     return sort_func;
//     /**
//      * locality sorting function for blocks
//      * @param {nb.Block} block1
//      * @param {nb.Block} block2
//      */
//     function sort_func(block1, block2) {
//         const node1 = block1.node;
//         const node2 = block2.node;
//         const { node_id, host_id, pool_id, region } = location_info;
//         if (node2.readable && !node1.readable) return 1;
//         if (node1.readable && !node2.readable) return -1;
//         if (String(node2._id) === node_id && String(node1._id) !== node_id) return 1;
//         if (String(node1._id) === node_id && String(node2._id) !== node_id) return -1;
//         if (node2.host_id === host_id && node1.host_id !== host_id) return 1;
//         if (node1.host_id === host_id && node2.host_id !== host_id) return -1;
//         if (String(block2.pool) === pool_id && String(block1.pool) !== pool_id) return 1;
//         if (String(block1.pool) === pool_id && String(block2.pool) !== pool_id) return -1;
//         if (region) {
//             const pool1 = system_store.data.get_by_id(block1.pool);
//             const pool2 = system_store.data.get_by_id(block2.pool);
//             if (pool2.region === region && pool1.region !== region) return 1;
//             if (pool1.region === region && pool2.region !== region) return -1;
//         }
//         return node2.heartbeat - node1.heartbeat;
//     }
// }


/**
 * @param {nb.Pool} pool 
 * @returns {boolean}
 */
function _pool_has_redundancy(pool) {
    return Boolean(pool.cloud_pool_info || pool.mongo_pool_info);
}

// /**
//  * 
//  * @param {nb.Chunk} chunk
//  * @param {nb.LocationInfo} [location_info]
//  */
// function should_rebuild_chunk_to_local_mirror(chunk, location_info) {
//     if (!location_info) return false;
//     if (!location_info.pool_id && !location_info.region) return false;
//     if (!chunk.tier) return false;
//     // check if the selected tier is in mirroring mode
//     if (chunk.tier.data_placement !== 'MIRROR') return false;
//     // check if a pool in the selected tier policy is the location range or pool
//     if (!find_local_mirror(chunk.tier.mirrors, location_info)) return false;
//     // check if there is already a good block on a mirror that we consider local
//     if (_.isEmpty(chunk.blocks_in_use)) return false;
//     for (const block of chunk.blocks_in_use) {
//         if (block.is_local_mirror) return false;
//     }
//     // check if a pool from the same region appear in the allocations list -
//     // if so then there is enough free space on the pool for this chunk and we should rebuild
//     if (!chunk.allocations) return false;
//     for (const allocation of chunk.allocations) {
//         if (find_local_pool(allocation.pools, location_info)) return true;
//     }
//     // if we didn't find local pool in all allocations (as supposed to by previous conditions) we shouldn't rebuild - not enough space
//     return false;
//     // TODO - we don't actually check for available storage on the local mirror - for now we only consider allocations
// }

// /**
//  * @param {nb.TierMirror[]} mirrors
//  * @param {nb.LocationInfo} [location_info]
//  */
// function find_local_mirror(mirrors, location_info) {
//     return mirrors.find(mirror => Boolean(find_local_pool(mirror.spread_pools, location_info)));
// }

/**
 * @param {nb.Pool[]} pools
 * @param {nb.LocationInfo} [location_info]
 */
function find_local_pool(pools, location_info) {
    return location_info && pools.find(pool =>
        (location_info.region && location_info.region === pool.region) ||
        (location_info.pool_id === pool._id.toHexString())
    );
}

// EXPORTS
exports.select_tier_for_write = select_tier_for_write;
exports.select_mirror_for_write = select_mirror_for_write;
exports.map_chunk = map_chunk;

exports.is_chunk_good_for_dedup = is_chunk_good_for_dedup;
exports.get_num_blocks_per_chunk = get_num_blocks_per_chunk;
// exports.should_rebuild_chunk_to_local_mirror = should_rebuild_chunk_to_local_mirror;
