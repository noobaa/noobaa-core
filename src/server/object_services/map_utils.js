/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const dbg = require('../../util/debug_module')(__filename);
const system_store = require('../system_services/system_store').get_instance();
const config = require('../../../config');
const size_utils = require('../../util/size_utils');
const EMPTY_CONST_ARRAY = Object.freeze([]);
const SPECIAL_CHUNK_CONTENT_TYPES = ['video/mp4', 'video/webm'];
const SPECIAL_CHUNK_REPLICA_MULTIPLIER = 2;

function analyze_special_chunks(chunks, parts, objects) {
    _.forEach(chunks, chunk => {
        chunk.is_special = false;
        var tmp_parts = _.filter(parts, part => String(part.chunk) === String(chunk._id));
        var tmp_objects = _.filter(objects, obj => _.find(tmp_parts, part => String(part.obj) === String(obj._id)));
        _.forEach(tmp_objects, obj => {
            if (_.includes(SPECIAL_CHUNK_CONTENT_TYPES, obj.content_type)) {
                let obj_parts = _.filter(tmp_parts, part => String(part.obj) === String(obj._id));
                _.forEach(obj_parts, part => {
                    if (part.start === 0 || part.end === obj.size) {
                        chunk.is_special = true;
                    }
                });
            }
        });
    });
}

// This is used in order to select the best possible mirror for the upload allocation (first alloc)
function select_prefered_mirrors(tier, tiering_status) {
    // We will always prefer to allocate on working premise pools
    const WEIGHTS = {
        non_writable_pool: 10,
        mongo_pool: 3,
        cloud_pool: 2,
        on_premise_pool: 1,
    };

    // This sort is mainly relevant to mirror allocations on uploads
    // The purpose of it is to pick a valid pool in order for upload to succeed
    let sorted_spread_tiers = _.sortBy(tier.mirrors, mirror => {
        let pool_weight = 0;
        _.forEach(mirror.spread_pools, spread_pool => {
            // Checking if the pool is writable
            if (!_.get(tiering_status,
                    `${tier._id}.pools.${spread_pool._id}.valid_for_allocation`, false)) {
                pool_weight += WEIGHTS.non_writable_pool;
            }

            // On premise pools are in higher priority than cloud and mongo pools
            if (spread_pool.cloud_pool_info) {
                pool_weight += WEIGHTS.cloud_pool;
            } else if (spread_pool.mongo_pool_info) {
                pool_weight += WEIGHTS.mongo_pool;
            } else {
                pool_weight += WEIGHTS.on_premise_pool;
            }
        });

        const spread_pools_length = _.get(mirror, 'spread_pools.length') || 1;
        // Normalize the weight according to number of pools in spread
        return pool_weight ? (pool_weight / spread_pools_length) : pool_weight;
    });

    let best_spread = _.first(sorted_spread_tiers);
    return best_spread ? [best_spread] : [];
}


// This is mainly used in order to pick a type of allocation
// For each chunk we randomize where we prefer to allocate (mongo/cloud or on premise)
// This decision may be changed when we actually check the status of the blocks
function select_pool_type(tier, spread_pools, tiering_status) {
    const spread_pools_length = (spread_pools && spread_pools.length) || 0;
    if (!spread_pools_length) {
        console.warn('select_pool_type:: There are no pools in current mirror');
    }

    let mirror_status = {
        regular_pools: [],
        mongo_or_cloud_pools: [],
        regular_pools_valid: false,
        mongo_or_cloud_pools_valid: false,
        picked_pools: []
    };

    // Currently we just randomly get 1 pool for the spread and decide to allocate using his type
    let selected_pool_type = spread_pools[Math.max(_.random(spread_pools_length - 1), 0)];

    let pools_partitions = _.partition(spread_pools,
        pool => !pool.cloud_pool_info && !pool.mongo_pool_info);
    mirror_status.regular_pools = pools_partitions[0];
    mirror_status.mongo_or_cloud_pools = pools_partitions[1];

    // Checking if there are any valid on premise pools
    mirror_status.regular_pools_valid = _.some(mirror_status.regular_pools,
        pool => _.get(tiering_status, `${tier._id}.pools.${pool._id}.valid_for_allocation`, false));
    // Checking if there are any valid mongo or cloud pools
    mirror_status.mongo_or_cloud_pools_valid = _.some(mirror_status.mongo_or_cloud_pools,
        pool => _.get(tiering_status, `${tier._id}.pools.${pool._id}.valid_for_allocation`, false));

    // Checking what type of a pool we've selected above
    if ((selected_pool_type && selected_pool_type.cloud_pool_info) ||
        (selected_pool_type && selected_pool_type.mongo_pool_info)) {
        // In case that we don't have any valid pools from that type we return the other type
        mirror_status.picked_pools = mirror_status.mongo_or_cloud_pools_valid ?
            mirror_status.mongo_or_cloud_pools : mirror_status.regular_pools;
    } else {
        mirror_status.picked_pools = mirror_status.regular_pools_valid ?
            mirror_status.regular_pools : mirror_status.mongo_or_cloud_pools;
    }

    return mirror_status;
}


function _handle_under_policy_threshold(decision_params) {
    let spill_status = {
        deletions: [],
        allocations: []
    };

    // Checking if have any blocks related assigned to cloud/mongo pools
    let only_on_premise_blocks = _.every(decision_params.blocks_partitions.good_blocks,
            block => !block.node.is_cloud_node && !block.node.is_mongo_node) &&
        _.every(decision_params.blocks_partitions.bad_blocks,
            block => !block.node.is_cloud_node && !block.node.is_mongo_node);

    let num_of_allocated_blocks =
        _.get(decision_params, 'blocks_partitions.good_blocks.length', 0) +
        _.get(decision_params, 'blocks_partitions.bad_blocks.length', 0);

    // We will always prefer to allocate on premise pools
    // In case that we did not have any blocks on cloud/mongo pools
    if (num_of_allocated_blocks > 0 && only_on_premise_blocks) {
        if (_.get(decision_params, 'mirror_status.regular_pools_valid', false)) {
            spill_status.allocations = _.concat(spill_status.allocations,
                decision_params.mirror_status.regular_pools);
        } else if (_.get(decision_params, 'mirror_status.mongo_or_cloud_pools_valid', false)) {
            if (_.get(decision_params, 'blocks_partitions.good_on_premise_blocks.length', 0)) {
                spill_status.deletions = _.concat(spill_status.deletions,
                    decision_params.blocks_partitions.good_on_premise_blocks);
            }
            spill_status.allocations = _.concat(spill_status.allocations,
                decision_params.mirror_status.mongo_or_cloud_pools);
        } else {
            console.warn('_handle_under_policy_threshold:: Cannot allocate without valid pools');
            spill_status.allocations = _.concat(spill_status.allocations, ['']);
        }
    } else if (_.get(decision_params, 'mirror_status.picked_pools.length', 0)) {
        spill_status.allocations = _.concat(spill_status.allocations,
            decision_params.mirror_status.picked_pools);
    } else {
        console.warn('_handle_under_policy_threshold:: Cannot allocate without valid pools');
        spill_status.allocations = _.concat(spill_status.allocations, ['']);
    }

    return spill_status;
}


// The logic here is to delete oldest blocks until we reach the needed policy threshold
function _handle_over_policy_threshold(decision_params) {
    let spill_status = {
        deletions: [],
        allocations: []
    };

    let current_weight = decision_params.current_weight;

    // Sorting blocks by their creation timestamp in mongodb
    let sorted_blocks = _.sortBy(
        _.get(decision_params, 'blocks_partitions.good_blocks') || [],
        block => block._id.getTimestamp().getTime()
    );

    _.forEach(sorted_blocks, block => {
        // Checking if we've deleted enough blocks
        if (current_weight === decision_params.max_replicas) {
            return spill_status;
        }

        // Decide the weight of the block being inspected by the allocation pool
        let block_weight = block.node.is_cloud_node || block.node.is_mongo_node ?
            decision_params.placement_weights.mongo_or_cloud_pool :
            decision_params.placement_weights.on_premise_pool;

        // Checking if the deletion of the block will place us below policy threshold
        if (current_weight - block_weight >= decision_params.max_replicas) {
            current_weight -= block_weight;
            spill_status.deletions.push(block);
        }
    });

    return spill_status;
}


function get_chunk_status(chunk, tiering, additional_params) {
    const tier_chunk_statuses = _.map(tiering.tiers, tier_and_order =>
        ({
            status: _get_chunk_status_in_tier(chunk, tier_and_order.tier, additional_params),
            tier: tier_and_order.tier
        })
    );

    const prefered_tier = get_tiering_prefered_tier(tiering,
        additional_params, tier_chunk_statuses);

    const status = {
        allocations: [],
        deletions: [],
        accessible: false
    };

    _.each(tier_chunk_statuses, chunk_status => {
        status.accessible = status.accessible || chunk_status.status.accessible;
        if (String(chunk_status.tier._id) === String(prefered_tier._id)) {
            status.allocations = chunk_status.status.allocations;
            status.deletions = chunk_status.status.deletions;
            status.extra_allocations = chunk_status.status.extra_allocations;
        }
    });

    return status;
}


function _get_chunk_status_in_tier(chunk, tier, additional_params) {
    let chunk_status = {
        allocations: [],
        extra_allocations: [],
        deletions: [],
        accessible: false,
    };

    // When allocating we will pick the best mirror using weights algorithm
    const participating_mirrors = _.get(additional_params, 'async_mirror', false) ?
        select_prefered_mirrors(tier, _.get(additional_params, 'tiering_status') || {}) :
        tier.mirrors || [];

    let used_blocks = [];
    let unused_blocks = [];

    // Each mirror of the tier is treated like a spread between all pools inside
    _.each(participating_mirrors, mirror => {
        // Selecting the allocating pool for the current mirror
        // Notice that this is only relevant to the current chunk
        let mirror_status = select_pool_type(tier, mirror.spread_pools,
            _.get(additional_params, 'tiering_status') || {});
        let status_result = _get_mirror_chunk_status(chunk, tier, mirror_status,
            mirror.spread_pools, additional_params);
        chunk_status.allocations = _.concat(chunk_status.allocations, status_result.allocations);
        chunk_status.extra_allocations = _.concat(chunk_status.extra_allocations, status_result.extra_allocations);
        chunk_status.deletions = _.concat(chunk_status.deletions, status_result.deletions);
        // These two are used in order to delete all unused blocks by the policy
        // Which actually means blocks that are not relevant to the tier policy anymore
        // Like blocks that were placed on pools that got migrated to other bucket etc...
        unused_blocks = _.concat(unused_blocks, status_result.unused_blocks);
        used_blocks = _.concat(used_blocks, status_result.used_blocks);
        // Notice that there is an OR operator between the responses
        // This is because it is enough for one mirror to be accessible
        chunk_status.accessible = chunk_status.accessible || status_result.accessible;
    });

    // Deleted all of the blocks that are not relevant anymore
    unused_blocks = _.uniq(unused_blocks);
    used_blocks = _.uniq(used_blocks);
    chunk_status.deletions = _.concat(chunk_status.deletions, _.difference(unused_blocks, used_blocks));
    return chunk_status;
}


function _get_mirror_chunk_status(chunk, tier, mirror_status, mirror_pools, additional_params) {
    const tier_pools_by_name = _.keyBy(mirror_pools, 'name');

    let allocations = [];
    let extra_allocations = []; // used for special replicas
    let deletions = [];
    let chunk_accessible = true;

    let missing_frags = get_missing_frags_in_chunk(chunk, tier);
    if (missing_frags && missing_frags.length) {
        // for now just log the error and mark as not accessible,
        // but no point in throwing as the caller
        // will not know how to handle and what is wrong
        console.error('get_chunk_status: missing fragments', chunk, missing_frags);
        chunk_accessible = false;
    }

    function check_blocks_group(blocks, fragment) {
        // This is the optimal maximum number of replicas that are required
        // Currently this is mainly used to special replica chunks which are allocated opportunistically
        let max_replicas;

        // Currently we pick the highest replicas in our alloocation pools, which are on premise pools
        if (chunk.is_special) {
            max_replicas = tier.replicas * SPECIAL_CHUNK_REPLICA_MULTIPLIER;
        } else {
            max_replicas = tier.replicas;
        }

        const PLACEMENT_WEIGHTS = {
            on_premise_pool: 1,
            // We consider one replica in cloud/mongo valid for any policy
            mongo_or_cloud_pool: max_replicas
        };

        let num_good = 0;
        let num_accessible = 0;
        let block_partitions = {};

        // Build partitions of good and accessible blocks and bad unaccesible blocks
        // Also we calculate the weight of the current block allocations
        // Notice that we do not calculate bad blocks into the weight
        let partition = _.partition(blocks,
            block => {
                let partition_result = false;
                if (is_block_accessible(block)) {
                    num_accessible += 1;
                }
                if (is_block_good(block, tier_pools_by_name)) {
                    if (block.node.is_cloud_node || block.node.is_mongo_node) {
                        num_good += PLACEMENT_WEIGHTS.mongo_or_cloud_pool;
                    } else {
                        num_good += PLACEMENT_WEIGHTS.on_premise_pool;
                    }
                    partition_result = true;
                }
                return partition_result;
            });
        block_partitions.good_blocks = partition[0];
        block_partitions.bad_blocks = partition[1];

        let spill_status = {
            deletions: [],
            allocations: []
        };
        let decision_params = {
            blocks_partitions: block_partitions,
            mirror_status: mirror_status,
            placement_weights: PLACEMENT_WEIGHTS,
            max_replicas: max_replicas,
            current_weight: num_good,
            additional_params: additional_params
        };

        // Checking if we are under and over the policy threshold
        if (num_good > max_replicas) {
            spill_status = _handle_over_policy_threshold(decision_params);
        } else if (num_good < max_replicas) {
            spill_status = _handle_under_policy_threshold(decision_params);
        }

        // We automatically delete all of the bad blocks, in order to rebuild them
        _.each(block_partitions.bad_blocks, block => deletions.push(block));

        if (_.get(spill_status, 'deletions.length', 0)) {
            deletions = _.concat(deletions, spill_status.deletions);
        }

        if (_.get(spill_status, 'allocations.length', 0)) {
            let alloc = {
                pools: spill_status.allocations,
                fragment: fragment
            };

            // We look at the allocations array as a single type array
            let is_mongo_or_cloud_allocation = _.every(spill_status.allocations, pool => pool.cloud_pool_info || pool.mongo_pool_info);

            // These are the total missing blocks including the special blocks which are opportunistic
            let num_missing = Math.max(0, max_replicas - num_good);

            // These are the minimum required replicas, which are a must to have for the chunk
            // In case of cloud/mongo pool allocation we consider one block as a fulfilment of all policy
            let min_replicas = is_mongo_or_cloud_allocation ? (max_replicas / PLACEMENT_WEIGHTS.mongo_or_cloud_pool) :
                Math.max(0, tier.replicas - num_good);

            // Notice that we push the minimum required replicas in higher priority
            // This is done in order to insure that we will allocate them before the additional replicas
            _.times(min_replicas, () => allocations.push(_.clone(alloc)));

            // There is no point in special replicas when save in cloud/mongo
            if (!is_mongo_or_cloud_allocation) {
                _.times(num_missing - min_replicas, () => extra_allocations.push(_.defaults(_.clone(alloc), {
                    special_replica: true
                })));
            }
        }

        return num_accessible;
    }

    let unused_blocks = [];
    let used_blocks = [];

    _.each(chunk.frags, f => {

        dbg.log1('get_chunk_status:', 'chunk', chunk, 'fragment', f);

        let blocks = f.blocks || EMPTY_CONST_ARRAY;
        let num_accessible = 0;

        // We devide the blocks to allocated on pools of the current mirror pools policy and not
        let blocks_partition = _.partition(blocks, block => tier_pools_by_name[block.node.pool]);
        unused_blocks = _.concat(unused_blocks, blocks_partition[1]);
        used_blocks = _.concat(used_blocks, blocks_partition[0]);

        num_accessible += check_blocks_group(blocks_partition[0], f);

        if (!num_accessible) {
            chunk_accessible = false;
        }
    });

    return {
        allocations: allocations,
        extra_allocations: extra_allocations,
        deletions: deletions,
        accessible: chunk_accessible,
        unused_blocks: unused_blocks,
        used_blocks: used_blocks
    };
}

function set_chunk_frags_from_blocks(chunk, blocks) {
    let blocks_by_frag_key = _.groupBy(blocks, get_frag_key);
    chunk.frags = _.map(blocks_by_frag_key, frag_blocks => {
        let f = _.pick(frag_blocks[0],
            'layer',
            'layer_n',
            'frag',
            'size',
            'digest_type',
            'digest_b64');
        // sorting the blocks to have most available node on front
        // TODO add load balancing (maybe random the order of good blocks)
        // TODO need stable sorting here for parallel decision making...
        frag_blocks.sort(block_access_sort);
        f.blocks = frag_blocks;
        return f;
    });
}

function get_missing_frags_in_chunk(chunk, tier) {
    let missing_frags;
    let fragments_by_frag_key = _.keyBy(chunk.frags, get_frag_key);
    // TODO handle parity fragments
    _.times(tier.data_fragments, frag => {
        let f = {
            layer: 'D',
            frag: frag,
        };
        let frag_key = get_frag_key(f);
        if (!fragments_by_frag_key[frag_key]) {
            missing_frags = missing_frags || [];
            missing_frags.push(f);
        }
    });
    return missing_frags;
}

function is_block_good(block, tier_pools_by_name) {
    if (!is_block_accessible(block)) {
        return false;
    }

    // detect nodes that are not writable -
    // either because they are offline, or storage is full, etc.
    if (!block.node.writable) return false;

    // detect nodes that do not belong to the tier pools
    // to be deleted once they are not needed as source
    if (!tier_pools_by_name[block.node.pool]) {
        return false;
    }

    return true;
}

function is_block_accessible(block) {
    return Boolean(block.node.readable);
}

function is_chunk_good_for_dedup(chunk, tiering, tiering_status) {
    const status = get_chunk_status(chunk, tiering, {
        tiering_status: tiering_status
    });

    return status.accessible && !status.allocations.length;
}


function get_part_info(part, adminfo, tiering_status) {
    return {
        start: part.start,
        end: part.end,
        seq: part.seq,
        multipart_id: String(part.multipart_id),
        chunk_id: String(part.chunk._id),
        chunk: get_chunk_info(part.chunk, adminfo, tiering_status),
        chunk_offset: part.chunk_offset, // currently undefined
    };
}

function get_chunk_info(chunk, adminfo, tiering_status) {
    let c = _.pick(chunk,
        'size',
        'digest_type',
        'digest_b64',
        'compress_type',
        'compress_size',
        'cipher_type',
        'cipher_key_b64',
        'cipher_iv_b64',
        'cipher_auth_tag_b64',
        'data_frags',
        'lrc_frags');
    c.frags = _.map(chunk.frags, f => get_frag_info(f, adminfo));
    if (adminfo) {
        c.adminfo = {};
        let bucket = system_store.data.get_by_id(chunk.bucket);

        const status = get_chunk_status(chunk, bucket.tiering, {
            tiering_status: tiering_status
        });

        if (!status.accessible) {
            c.adminfo.health = 'unavailable';
        } else if (status.allocations.length) {
            c.adminfo.health = 'building';
        } else {
            c.adminfo.health = 'available';
        }
    }
    return c;
}


function get_frag_info(fragment, adminfo) {
    let f = _.pick(fragment,
        'layer',
        'layer_n',
        'frag',
        'size',
        'digest_type',
        'digest_b64');
    f.blocks = _.map(fragment.blocks, block => get_block_info(block, adminfo));
    return f;
}


function get_block_info(block, adminfo) {
    const ret = {
        block_md: get_block_md(block),
    };
    if (adminfo) {
        const node = block.node;
        const system = system_store.data.get_by_id(block.system);
        const pool = system.pools_by_name[node.pool];
        ret.adminfo = {
            pool_name: pool.name,
            node_name: node.os_info.hostname + '#' + node.host_seq,
            host_name: node.os_info.hostname,
            node_ip: node.ip,
            in_cloud_pool: Boolean(node.is_cloud_node),
            in_mongo_pool: Boolean(node.is_mongo_node),
            online: Boolean(node.online),
        };
    }
    return ret;
}

function get_block_md(block) {
    var b = _.pick(block, 'size', 'digest_type', 'digest_b64');
    b.id = String(block._id);
    b.address = block.node.rpc_address;
    b.node = String(block.node._id);
    if (block.node.node_type === 'BLOCK_STORE_S3') {
        b.delegator = 'DELEGATOR_S3';
    } else if (block.node.node_type === 'BLOCK_STORE_AZURE') {
        b.delegator = 'DELEGATOR_AZURE';
    }
    b.pool = String(block.pool);
    return b;
}

function assign_node_to_block(block, node, system_id) {
    // keep the node ref, same when populated
    block.node = node;
    const system = system_store.data.systems.find(sys => String(sys._id) === String(system_id));
    if (!system) throw new Error('Could not find system:', system_id);
    const pool = system.pools_by_name[node.pool];
    if (!pool) throw new Error('Could not find pool:', node.pool);
    block.pool = pool._id;
    return block;
}

function get_frag_key(f) {
    return f.layer + f.frag;
}

// sanitizing start & end: we want them to be integers, positive, up to obj.size.
function sanitize_object_range(obj, start, end) {
    if (typeof(start) === 'undefined') {
        start = 0;
    }
    // truncate end to the actual object size
    if (typeof(end) !== 'number' || end > obj.size) {
        end = obj.size;
    }
    // force integers
    start = Math.floor(start);
    end = Math.floor(end);
    // force positive
    if (start < 0) {
        start = 0;
    }
    // quick check for empty range
    if (end <= start) {
        return;
    }
    return {
        start: start,
        end: end,
    };
}


/**
 * sorting function for sorting blocks with most recent heartbeat first
 */
function block_access_sort(block1, block2) {
    if (!block1.node.readable) {
        return 1;
    }
    if (!block2.node.readable) {
        return -1;
    }
    return block2.node.heartbeat - block1.node.heartbeat;
}


function get_tiering_prefered_tier(tiering, additional_params, tier_chunk_statuses) {
    const tiering_status = _.get(additional_params, 'tiering_status') || {};

    const tiering_alloc = _.compact(_.map(tiering.tiers, tier_and_order => {
        // Disabled spillover tiers are not removed from policy
        // They are just marked as disabled, so we shall not check validity on them
        if (tier_and_order.disabled) return;

        const tier_status = _.get(tiering_status, `${tier_and_order.tier._id}`);
        const chunk_in_tier_status = _.find(tier_chunk_statuses, tier_chunk_status =>
            String(tier_and_order.tier._id) === String(tier_chunk_status.tier._id));
        // We allow to upload to one mirror even if other mirrors don't have any space left
        // That is why we are picking the maximum value of free from the mirrors of the tier
        const available_to_upload = size_utils.json_to_bigint(
            size_utils.reduce_maximum('free',
                tier_status.mirrors_storage.map(storage => (storage.free || 0))
            )
        );

        // TODO: JEN Temporary removed with the Threshold issues regarding where to save the last tier state
        // system_store.valid_for_alloc_by_tier[tier_and_order.tier._id] =
        //     available_to_upload &&
        //     ((system_store.valid_for_alloc_by_tier[tier_and_order.tier._id] &&
        //             available_to_upload.greater(config.MIN_TIER_FREE_THRESHOLD)) ||
        //         (!system_store.valid_for_alloc_by_tier[tier_and_order.tier._id] &&
        //             available_to_upload.greater(config.MAX_TIER_FREE_THRESHOLD)));

        return {
            // We use numbers above 0 for orders
            order: tier_and_order.order + 1,
            tier: tier_and_order.tier,
            valid_for_allocation_order: //system_store.valid_for_alloc_by_tier[tier_and_order.tier._id],
                (available_to_upload &&
                    available_to_upload.greater(config.MIN_TIER_FREE_THRESHOLD) &&
                    available_to_upload.greater(config.MAX_TIER_FREE_THRESHOLD)) ? 1 : 2,
            spillover_order: tier_and_order.spillover ? 2 : 1,
            chunk_good_order: (chunk_in_tier_status.status.accessible &&
                !chunk_in_tier_status.status.allocations.length) ? 1 : 2
        };
    }));

    const prefered_tier = _get_prefered_tier(tiering_alloc);

    return prefered_tier.tier;
}

/*
                *** PREFERED TIER PICKING DECISION TABLE ***
// NOTICE:
// Prior to the decision table below, we do a sortBy using several properties
// The sortBy massively affects the outcome regarding which tier will be chosen
// The below table hints the sorted array which type we shall choose

ST - Stands for SPILLOVER tier.
NT - Stands for NORMAL tier which means not spill over.
VC -  Stands for VALID chunk status on tier.
NVC - Stands for NOT VALID chunk status on tier.
VU -  Stands for tier which is VALID to upload (has free space).
NVU - Stands for tier which is NOT VALID to upload (has no free space).

Options for Normal Tier and Spillover Tier:
NT = { spillover_order: 1, chunk_good_order: VC/NVC, valid_order: VU/NVU, order: 1 },
ST = { spillover_order: 2, chunk_good_order: VC/NVC, valid_order: VU/NVU, order: 2 },

TODO: Current algorithm was developed for two tiers maximum
// It may behave differently for more complex cases

+-------------------------------+-------------------+------------------+------------------+-----------------+
| Availability / Chunk Validity | NT: NVC - ST: NVC | NT: VC - ST: NVC | NT: NVC - ST: VC | NT: VC - ST: VC |
+-------------------------------+-------------------+------------------+------------------+-----------------+
| NT:   VU                      |    Normal Tier    |    Normal Tier   |    Normal Tier   |    Normal Tier  |
| ST:   VU                      |                   |                  |                  |                 |
+-------------------------------+-------------------+------------------+------------------+-----------------+
| NT:   NVU                     |    Normal Tier    |    Normal Tier   |                  |    Normal Tier  |
| ST:   NVU                     |                   |                  |  Spillover Tier  |                 |
+-------------------------------+-------------------+------------------+------------------+-----------------+
| NT:   NVU                     |                   |    Normal Tier   |                  |    Normal Tier  |
| ST:   VU                      |  Spillover Tier   |                  |  Spillover Tier  |                 |
+-------------------------------+-------------------+------------------+------------------+-----------------+
| NT:   VU                      |    Normal Tier    |    Normal Tier   |    Normal Tier   |    Normal Tier  |
| ST:   NVU                     |                   |                  |                  |                 |
+-------------------------------+-------------------+------------------+------------------+-----------------+
*/

function _get_prefered_tier(tiering_alloc) {
    // True comes after False in the sortBy method, so using "-" to reverse behavior
    const tiering_alloc_sorted_by_order = _.sortBy(tiering_alloc, [
        'chunk_good_order',
        'valid_for_allocation_order',
        'spillover_order',
        'order'
    ]);

    const no_good_tier = _.every(tiering_alloc_sorted_by_order,
        alloc => !_is_chunk_good_alloc(alloc) && !_is_valid_for_allocation_alloc(alloc));
    const best_regular = _.find(tiering_alloc_sorted_by_order,
        alloc => !_is_spillover_alloc(alloc) && (_is_valid_for_allocation_alloc(alloc) || _is_chunk_good_alloc(alloc) || no_good_tier));
    const best_spillover = _.find(tiering_alloc_sorted_by_order,
        alloc => _is_spillover_alloc(alloc));

    return best_regular || best_spillover || tiering_alloc_sorted_by_order[0];
}

function _is_spillover_alloc(alloc_tier) {
    return Boolean(alloc_tier.spillover_order === 2);
}

function _is_chunk_good_alloc(alloc_tier) {
    return Boolean(alloc_tier.chunk_good_order === 1);
}

function _is_valid_for_allocation_alloc(alloc_tier) {
    return Boolean(alloc_tier.valid_for_allocation_order === 1);
}


// EXPORTS
exports.get_chunk_status = get_chunk_status;
exports.set_chunk_frags_from_blocks = set_chunk_frags_from_blocks;
exports.get_missing_frags_in_chunk = get_missing_frags_in_chunk;
exports.is_block_good = is_block_good;
exports.is_block_accessible = is_block_accessible;
exports.is_chunk_good_for_dedup = is_chunk_good_for_dedup;
exports.get_part_info = get_part_info;
exports.get_chunk_info = get_chunk_info;
exports.get_frag_info = get_frag_info;
exports.get_block_info = get_block_info;
exports.get_block_md = get_block_md;
exports.get_frag_key = get_frag_key;
exports.get_tiering_prefered_tier = get_tiering_prefered_tier;
exports.sanitize_object_range = sanitize_object_range;
exports.analyze_special_chunks = analyze_special_chunks;
// This is exported for unit tests
exports._get_prefered_tier = _get_prefered_tier;
exports.assign_node_to_block = assign_node_to_block;
