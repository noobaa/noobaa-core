/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const dbg = require('../../util/debug_module')(__filename);
const system_store = require('../system_services/system_store').get_instance();

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
function select_prefered_mirrors(tier, tiering_pools_status) {
    // We will always prefer to allocate on working premise pools
    const WEIGHTS = {
        non_writable_pool: 10,
        on_premise_pool: 1,
        cloud_pool: 2
    };

    // This sort is mainly relevant to mirror allocations on uploads
    // The purpose of it is to pick a valid pool in order for upload to succeed
    let sorted_spread_tiers = _.sortBy(tier.mirrors, mirror => {
        let pool_weight = 0;
        _.forEach(mirror.spread_pools, spread_pool => {
            // Checking if the pool is writable
            if (!_.get(tiering_pools_status[spread_pool.name], 'valid_for_allocation', false)) {
                pool_weight += WEIGHTS.non_writable_pool;
            }

            // On premise pools are in higher priority than cloud pools
            if (spread_pool.cloud_pool_info) {
                pool_weight += WEIGHTS.cloud_pool;
            } else {
                pool_weight += WEIGHTS.on_premise_pool;
            }
        });

        // Normalize the weight according to number of pools in spread
        return pool_weight ? (pool_weight / _.get(mirror.spread_pools, 'length', 1)) : pool_weight;
    });

    let best_spread = _.first(sorted_spread_tiers);
    return best_spread ? [best_spread] : [];
}


// This is mainly used in order to pick a type of allocation
// For each chunk we randomize where we prefer to allocate (cloud or on premise)
// This decision may be changed when we actually check the status of the blocks
function select_pool_type(spread_pools, tiering_pools_status) {
    if (!_.get(spread_pools, 'length', 0)) {
        console.warn('select_pool_type:: There are no pools in current mirror');
    }

    let mirror_status = {
        regular_pools: [],
        cloud_pools: [],
        regular_pools_valid: false,
        cloud_pools_valid: false,
        picked_pools: []
    };

    // Currently we just randomly get 1 pool for the spread and decide to allocate using his type
    let selected_pool_type = spread_pools[Math.max(_.random(_.get(spread_pools, 'length', 0) - 1), 0)];

    let pools_partitions = _.partition(spread_pools,
        pool => !pool.cloud_pool_info);
    mirror_status.regular_pools = pools_partitions[0];
    mirror_status.cloud_pools = pools_partitions[1];

    // Checking if there are any valid on premise pools
    mirror_status.regular_pools_valid = _.some(mirror_status.regular_pools,
        pool => _.get(tiering_pools_status, pool.name, false));
    // Checking if there are any valid cloud pools
    mirror_status.cloud_pools_valid = _.some(mirror_status.cloud_pools,
        pool => _.get(tiering_pools_status, pool.name, false));

    // Checking what type of a pool we've selected above
    if (_.get(selected_pool_type, 'cloud_pool_info', false)) {
        // In case that we don't have any valid pools from that type we return the other type
        mirror_status.picked_pools = mirror_status.regular_pools_valid ?
            mirror_status.regular_pools : mirror_status.cloud_pools;
    } else {
        mirror_status.picked_pools = mirror_status.cloud_pools_valid ?
            mirror_status.cloud_pools : mirror_status.regular_pools;
    }

    return mirror_status;
}


function _handle_under_policy_threshold(decision_params) {
    let spill_status = {
        deletions: [],
        allocations: []
    };

    // Checking if have any blocks related assigned to cloud pools
    let only_on_premise_blocks = _.every(decision_params.blocks_partitions.good_blocks,
            block => !block.node.is_cloud_node) &&
        _.every(decision_params.blocks_partitions.bad_blocks,
            block => !block.node.is_cloud_node);

    let num_of_allocated_blocks =
        _.get(decision_params, 'blocks_partitions.good_blocks.length', 0) +
        _.get(decision_params, 'blocks_partitions.bad_blocks.length', 0);

    // We will always prefer to allocate on premise pools
    // In case that we did not have any blocks on cloud pools
    if (num_of_allocated_blocks > 0 && only_on_premise_blocks) {
        if (_.get(decision_params.mirror_status, 'regular_pools_valid', false)) {
            spill_status.allocations = _.concat(spill_status.allocations,
                decision_params.mirror_status.regular_pools);
        } else if (_.get(decision_params.mirror_status, 'cloud_pools_valid', false)) {
            if (_.get(decision_params.blocks_partitions, 'good_on_premise_blocks.length', 0)) {
                spill_status.deletions = _.concat(spill_status.deletions,
                    decision_params.blocks_partitions.good_on_premise_blocks);
            }
            spill_status.allocations = _.concat(spill_status.allocations,
                decision_params.mirror_status.cloud_pools);
        } else if (_.get(decision_params, 'additional_params.status_check', false)) {
            // This is used when we only check the status without any actions
            spill_status.allocations = _.concat(spill_status.allocations, ['dummy']);
        } else {
            throw new Error('_handle_under_policy_threshold:: Cannot allocate without valid pools');
        }
    } else if (_.get(decision_params.mirror_status, 'picked_pools.length', 0)) {
        spill_status.allocations = _.concat(spill_status.allocations,
            decision_params.mirror_status.picked_pools);
    } else if (_.get(decision_params, 'additional_params.status_check', false)) {
        // This is used when we only check the status without any actions
        spill_status.allocations = _.concat(spill_status.allocations, ['dummy']);
    } else {
        throw new Error('_handle_under_policy_threshold:: Cannot allocate without valid pools');
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
        _.get(decision_params, 'blocks_partitions.good_blocks', []),
        block => block._id.getTimestamp().getTime()
    );

    _.forEach(sorted_blocks, block => {
        // Checking if we've deleted enough blocks
        if (current_weight === decision_params.max_replicas) {
            return spill_status;
        }

        // Decide the weight of the block being inspected by the allocation pool
        let block_weight = block.node.is_cloud_node ? decision_params.placement_weights.cloud_pool :
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
    // TODO handle multi-tiering
    if (tiering.tiers.length !== 1) {
        throw new Error('analyze_chunk: ' +
            'tiering policy must have exactly one tier and not ' +
            tiering.tiers.length);
    }
    const tier = tiering.tiers[0].tier;

    let chunk_status = {
        allocations: [],
        deletions: [],
        accessible: false,
    };

    // When allocating we will pick the best mirror using weights algorithm
    const participating_mirrors = _.get(additional_params, 'async_mirror', false) ?
        select_prefered_mirrors(tier, _.get(additional_params, 'tiering_pools_status', undefined)) :
        tier.mirrors || [];

    let used_blocks = [];
    let unused_blocks = [];

    // Each mirror of the tier is treated like a spread between all pools inside
    _.each(participating_mirrors, mirror => {
        // Selecting the allocating pool for the current mirror
        // Notice that this is only relevant to the current chunk
        let mirror_status = select_pool_type(mirror.spread_pools,
            _.get(additional_params, 'tiering_pools_status', undefined));
        let status_result = _get_mirror_chunk_status(chunk, tier, mirror_status,
            mirror.spread_pools, additional_params);
        chunk_status.allocations = _.concat(chunk_status.allocations, status_result.allocations);
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
            // We consider one replica in cloud valid for any policy
            cloud_pool: max_replicas
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
                    if (block.node.is_cloud_node) {
                        num_good += PLACEMENT_WEIGHTS.cloud_pool;
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
            let is_cloud_allocation = _.every(spill_status.allocations, pool => pool.cloud_pool_info);

            // These are the total missing blocks including the special blocks which are opportunistic
            let num_missing = Math.max(0, max_replicas - num_good);

            // These are the minimum required replicas, which are a must to have for the chunk
            // In case of cloud pool allocation we consider one block as a fulfilment of all policy
            let min_replicas = is_cloud_allocation ? (max_replicas / PLACEMENT_WEIGHTS.cloud_pool) :
                Math.max(0, tier.replicas - num_good);

            // Notice that we push the minimum required replicas in higher priority
            // This is done in order to insure that we will allocate them before the additional replicas
            _.times(min_replicas, () => allocations.push(_.clone(alloc)));

            // There is no point in special replicas when save in cloud
            if (!is_cloud_allocation) {
                _.times(num_missing - min_replicas, () => allocations.push(_.defaults(_.clone(alloc), {
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

function is_chunk_good(chunk, tiering) {
    let status = get_chunk_status(chunk, tiering, {
        status_check: true
    });
    return status.accessible && !status.allocations.length;
}

function is_chunk_accessible(chunk, tiering) {
    let status = get_chunk_status(chunk, tiering, {
        status_check: true
    });
    return status.accessible;
}


function get_part_info(part, adminfo) {
    let p = _.pick(part,
        'start',
        'end',
        'chunk_offset');
    p.chunk = get_chunk_info(part.chunk, adminfo);
    return p;
}

function get_chunk_info(chunk, adminfo) {
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
        let status = get_chunk_status(chunk, bucket.tiering, {
            status_check: true
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
            node_name: node.name,
            node_ip: node.ip,
            in_cloud_pool: Boolean(node.is_cloud_node),
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
    return b;
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


// EXPORTS
exports.get_chunk_status = get_chunk_status;
exports.set_chunk_frags_from_blocks = set_chunk_frags_from_blocks;
exports.get_missing_frags_in_chunk = get_missing_frags_in_chunk;
exports.is_block_good = is_block_good;
exports.is_block_accessible = is_block_accessible;
exports.is_chunk_good = is_chunk_good;
exports.is_chunk_accessible = is_chunk_accessible;
exports.get_part_info = get_part_info;
exports.get_chunk_info = get_chunk_info;
exports.get_frag_info = get_frag_info;
exports.get_block_info = get_block_info;
exports.get_block_md = get_block_md;
exports.get_frag_key = get_frag_key;
exports.sanitize_object_range = sanitize_object_range;
exports.analyze_special_chunks = analyze_special_chunks;
