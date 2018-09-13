/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const util = require('util');

const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const size_utils = require('../../util/size_utils');
const system_store = require('../system_services/system_store').get_instance();


/**
 *
 *
 * ChunkMapper
 *
 *
 */
class ChunkMapper {

    constructor(chunk) {
        this.chunk = chunk;
        this.is_write = !chunk._id;
        this.frags_by_index = _.keyBy(chunk.frags, _frag_index);
        const frags_by_id = _.keyBy(chunk.frags, '_id');
        this.blocks_by_index = _.groupBy(chunk.blocks, block => _frag_index(frags_by_id[block.frag]));
        this.accessible = this.is_accessible();
    }

    is_accessible() {

        const {
            blocks_by_index,
            chunk: {
                chunk_coder_config: {
                    data_frags = 1,
                    parity_frags = 0,
                }
            },
        } = this;

        let num_accessible = 0;

        for (let data_index = 0; data_index < data_frags; ++data_index) {
            const frag_index = `D${data_index}`;
            const blocks = blocks_by_index[frag_index];
            if (blocks) {
                for (let i = 0; i < blocks.length; ++i) {
                    if (_is_block_accessible(blocks[i])) {
                        num_accessible += 1;
                        break;
                    }
                }
            }
        }
        if (num_accessible >= data_frags) return true;

        for (let parity_index = 0; parity_index < parity_frags; ++parity_index) {
            const frag_index = `P${parity_index}`;
            const blocks = blocks_by_index[frag_index];
            if (blocks) {
                for (let i = 0; i < blocks.length; ++i) {
                    if (_is_block_accessible(blocks[i])) {
                        num_accessible += 1;
                        break;
                    }
                }
            }
        }
        return num_accessible >= data_frags;
    }
}


/**
 *
 *
 * MirrorMapper
 *
 *
 */
class MirrorMapper {

    constructor(mirror, chunk_coder_config, mirror_index) {
        const { _id: mirror_id, spread_pools } = mirror;
        this.mirror_group = String(mirror_id);
        this.spread_pools = spread_pools;
        this.chunk_coder_config = chunk_coder_config;
        this.pools_by_id = _.keyBy(spread_pools, '_id');
        if (!spread_pools.length) dbg.log1('MirrorMapper: no pools in current mirror', mirror);
        const pools_partitions = _.partition(spread_pools, _pool_has_redundancy);
        this.redundant_pools = pools_partitions[0];
        this.regular_pools = pools_partitions[1];
        this.mirror_index = mirror_index;
    }

    update_status(tier_status, location_info) {
        const { redundant_pools, spread_pools } = this;
        this.regular_pools_valid = false;
        this.redundant_pools_valid = false;

        this.has_online_pool = _.some(spread_pools, pool => tier_status.pools[pool._id].valid_for_allocation);
        // to decide which mirror to use for the first writing mirror
        // we set a weight for each mirror_mapper based on the pool types
        // when all are regular pools we
        const { regular_free, redundant_free } = _.get(tier_status, `mirrors_storage.${this.mirror_index}`, {});
        this.regular_pools_valid = size_utils.json_to_bigint(regular_free).greater(config.MIN_TIER_FREE_THRESHOLD);
        this.redundant_pools_valid = size_utils.json_to_bigint(redundant_free).greater(config.MIN_TIER_FREE_THRESHOLD);
        const regular_weight = this.regular_pools_valid ? 3 : 0;
        this.is_local_mirror = Boolean(find_local_pool(spread_pools, location_info));
        const local_weight = this.is_local_mirror && (this.regular_pools_valid || this.redundant_pools_valid) ? 4 : 0;
        let redundant_weight = 0;
        if (this.redundant_pools_valid) {
            const redundant_has_mongo = redundant_pools.some(pool => Boolean(pool.mongo_pool_info));
            if (redundant_has_mongo) {
                redundant_weight = 1;
            } else {
                redundant_weight = 2;
            }
        }
        this.weight = local_weight || redundant_weight || regular_weight;
    }

    /**
     * @return >0 if mapper1 is best for write, <0 if mapper2 is best for write.
     */
    static compare_mapper_for_write(mapper1, mapper2) {
        // when equal weight, pick at random to spread the writes load
        // we should add more data to this decision such as pools available space and load factor.
        return (mapper1.weight - mapper2.weight) || (Math.random() - 0.5);
    }

    map_mirror(chunk_mapper, tier_mapping) {

        const {
            chunk_coder_config: {
                replicas = 1,
                data_frags = 1,
                parity_frags = 0,
            }
        } = this;

        const {
            chunk: {
                chunk_coder_config: {
                    replicas: chunk_replicas = 1,
                    data_frags: chunk_data_frags = 1,
                    parity_frags: chunk_parity_frags = 0,
                }
            },
            is_write,
            frags_by_index,
            blocks_by_index,
        } = chunk_mapper;

        // TODO GUY GAP handle change of data_frags between tier vs. chunk
        let desired_data_frags = data_frags;
        let desired_parity_frags = parity_frags;
        let desired_replicas = replicas;
        if (data_frags !== chunk_data_frags) {
            dbg.log0(`MirrorMapper: tier frags ${data_frags}+${parity_frags}`,
                `requires recoding chunk ${chunk_data_frags}+${chunk_parity_frags}`,
                '(not yet implemented)');
            desired_data_frags = chunk_data_frags;
            desired_parity_frags = chunk_parity_frags;
            desired_replicas = chunk_replicas;
        }

        for (let data_index = 0; data_index < desired_data_frags; ++data_index) {
            const frag_index = `D${data_index}`;
            this._map_frag(
                chunk_mapper,
                tier_mapping,
                frags_by_index[frag_index],
                blocks_by_index[frag_index],
                desired_replicas,
                is_write);
        }
        for (let parity_index = 0; parity_index < desired_parity_frags; ++parity_index) {
            const frag_index = `P${parity_index}`;
            this._map_frag(
                chunk_mapper,
                tier_mapping,
                frags_by_index[frag_index],
                blocks_by_index[frag_index],
                desired_replicas,
                is_write);
        }
    }

    _map_frag(chunk_mapper, tier_mapping, frag, blocks, replicas, is_write) {
        const {
            pools_by_id,
            regular_pools,
            regular_pools_valid,
        } = this;
        const { blocks_in_use } = tier_mapping;

        const accessible_blocks = _.filter(blocks, _is_block_accessible);
        const accessible = accessible_blocks.length > 0;
        const used_blocks = [];

        // rebuild from other frags
        if (!accessible && !is_write) {
            tier_mapping.missing_frags = tier_mapping.missing_frags || [];
            tier_mapping.missing_frags.push(frag);
        }

        let used_replicas = 0;
        let used_redundant_blocks = false;
        for (let i = 0; i < accessible_blocks.length; ++i) {
            const block = accessible_blocks[i];
            // block on pools that do not belong to the current mirror anymore
            // can be accessible but will eventually be deallocated
            const pool = pools_by_id[block.pool];
            const is_good_node = _is_block_good_node(block);
            if (is_good_node && pool) {
                block.is_local_mirror = this.is_local_mirror;
                used_blocks.push(block);
                // Also we calculate the weight of the current block allocations
                // Notice that we do not calculate bad blocks into the weight
                // We consider one replica in cloud/mongo valid for any policy
                if (_pool_has_redundancy(pool)) {
                    used_redundant_blocks = true;
                    used_replicas += replicas;
                } else {
                    used_replicas += 1;
                }
            }
        }

        if (used_replicas === replicas) {

            for (let i = 0; i < used_blocks.length; ++i) {
                blocks_in_use.push(used_blocks[i]);
            }

        } else if (used_replicas < replicas) {

            for (let i = 0; i < used_blocks.length; ++i) {
                blocks_in_use.push(used_blocks[i]);
            }

            const sources = accessible ? {
                accessible_blocks,
                // We assume that even if we fail we will take a different source in the next cycle
                // Other option is to try different sources on replication at error
                next_source: Math.floor(Math.random() * accessible_blocks.length)
            } : undefined;

            // We prefer to keep regular pools if possible, otherwise pick at random
            const pools = used_replicas && !used_redundant_blocks && regular_pools_valid ?
                regular_pools : this._pick_pools();

            // num_missing of required replicas, which are a must to have for the chunk
            // In case of redundant pool allocation we consider one block as a fulfilment of all policy
            // Notice that in case of redundant pools we expect to be here only on the first allocation
            // Since the weight calculation above which adds max_replicas for every replica on redundant pool
            // Will block us from performing the current context and statement.
            const is_redundant = _.every(pools, _pool_has_redundancy);
            const num_missing = is_redundant ? 1 : Math.max(0, replicas - used_replicas);

            // Notice that we push the minimum required replicas in higher priority
            // This is done in order to insure that we will allocate them before the additional replicas
            if (num_missing > 0) {
                tier_mapping.allocations = tier_mapping.allocations || [];
                for (let i = 0; i < num_missing; ++i) {
                    tier_mapping.allocations.push({ frag, pools, sources, mirror_group: this.mirror_group });
                }
            }


        } else {

            // To pick blocks to keep we sort by their creation timestamp in mongodb
            // and will keep newest blocks before older blocks
            // this approach helps to get rid of our "old" mapping decisions in favor of new decisions
            used_blocks.sort(_block_newer_first_sort);
            let keep_replicas = 0;
            for (let i = 0; i < used_blocks.length; ++i) {
                if (keep_replicas >= replicas) break;
                const block = used_blocks[i];
                keep_replicas += _pool_has_redundancy(pools_by_id[block.pool]) ? replicas : 1;
                blocks_in_use.push(block);
            }
        }
    }

    // Pick random pool which sets the allocation type between redundant/regular pools
    _pick_pools() {
        const { spread_pools } = this;
        const picked_pool = spread_pools[Math.max(_.random(spread_pools.length - 1), 0)];
        if (picked_pool && _pool_has_redundancy(picked_pool)) {
            return this.redundant_pools_valid ? this.redundant_pools : this.regular_pools;
        } else {
            return this.regular_pools_valid ? this.regular_pools : this.redundant_pools;
        }
    }
}


/**
 *
 *
 * TierMapper
 *
 *
 */
class TierMapper {

    constructor({ tier, order, spillover }) {
        this.tier = tier;
        this.order = order;
        this.spillover = spillover;
        const { chunk_coder_config } = tier.chunk_config;
        this.mirror_mappers = tier.mirrors
            .map((mirror, mirror_index) => new MirrorMapper(mirror, chunk_coder_config, mirror_index));
        this.write_mapper = this.mirror_mappers[0];
    }

    update_status(tier_status, location_info) {
        const { mirror_mappers } = this;
        this.write_mapper = undefined;
        this.online = true;

        for (let i = 0; i < mirror_mappers.length; ++i) {
            const mirror_mapper = mirror_mappers[i];
            mirror_mapper.update_status(tier_status, location_info);
            if (!this.write_mapper || MirrorMapper.compare_mapper_for_write(mirror_mapper, this.write_mapper) > 0) {
                this.write_mapper = mirror_mapper;
            }
            if (!mirror_mapper.has_online_pool) {
                this.online = false;
            }
        }

        // TODO GUY GAP maximum between mirrors? not minimum?

        // We allow to upload to one mirror even if other mirrors don't have any space left
        // That is why we are picking the maximum value of free from the mirrors of the tier
        const available_to_upload = size_utils.json_to_bigint(size_utils.reduce_maximum(
            'free', tier_status.mirrors_storage.map(storage => (storage.free || 0))
        ));
        this.valid_for_allocation = available_to_upload &&
            available_to_upload.greater(config.MIN_TIER_FREE_THRESHOLD) &&
            available_to_upload.greater(config.MAX_TIER_FREE_THRESHOLD);
    }

    map_tier(chunk_mapper) {
        const { mirror_mappers, write_mapper } = this;
        const { is_write, accessible } = chunk_mapper;

        const tier_mapping = Object.seal({
            tier: this.tier,
            accessible,
            blocks_in_use: [],
            deletions: undefined,
            allocations: undefined,
            missing_frags: undefined,
        });

        if (is_write) {
            write_mapper.map_mirror(chunk_mapper, tier_mapping);
        } else {
            // TODO GUY OPTIMIZE try to bail out faster if best_mapping is better
            for (let i = 0; i < mirror_mappers.length; ++i) {
                const mirror_mapper = mirror_mappers[i];
                mirror_mapper.map_mirror(chunk_mapper, tier_mapping);
            }
        }

        if (accessible && !tier_mapping.allocations) {
            const { blocks } = chunk_mapper.chunk;
            const used_blocks = _.uniq(tier_mapping.blocks_in_use);
            const unused_blocks = _.uniq(_.difference(blocks, used_blocks));
            if (unused_blocks.length) {
                // Protect from too many deletions by checking:
                // - the number of unused blocks to delete does not include all blocks
                // - the number of unused blocks to delete does not exceed number blocks that should exist
                // - the number of used blocks against the the expected number of blocks
                const min_num_blocks = this.tier.chunk_config.chunk_coder_config.data_frags || 1;
                if (unused_blocks.length >= blocks.length ||
                    unused_blocks.length > blocks.length - min_num_blocks ||
                    used_blocks.length < min_num_blocks) {
                    dbg.error('TierMapper.map_tier: ASSERT protect from too many deletions!',
                        'min_num_blocks', min_num_blocks,
                        'blocks.length', blocks.length,
                        'used_blocks.length', used_blocks.length,
                        'unused_blocks.length', unused_blocks.length,
                        'tier', this.tier,
                        'tier_mapping', tier_mapping,
                        'chunk', chunk_mapper.chunk,
                        'used_blocks', used_blocks,
                        'unused_blocks', unused_blocks);
                } else {
                    tier_mapping.deletions = unused_blocks;
                }
            }
        }

        return tier_mapping;
    }

    /**
     * Compare tier based on space, effort, and policy.
     *
     * Regular vs Spillover Decision Table:
     * -----------------------------------
     * The following table describes how we mix the considerations of space and effort to compare regular vs spillover tiers.
     * The row/column titles are matching the test_mapper.js cases.
     *
     * +-------------------------------+----------------------+---------------------------+-----------------------------+-------------------------------+
     * |                               | all_tiers_have_chunk | all_tiers_dont_have_chunk | only_regular_tier_has_chunk | only_spillover_tier_has_chunk |
     * +-------------------------------+----------------------+---------------------------+-----------------------------+-------------------------------+
     * | all_tiers_have_space          |       Regular        |          Regular          |           Regular           |            Regular            |
     * +-------------------------------+----------------------+---------------------------+-----------------------------+-------------------------------+
     * | all_tiers_dont_have_space     |       Regular        |          Regular          |           Regular           |           Spillover           |
     * +-------------------------------+----------------------+---------------------------+-----------------------------+-------------------------------+
     * | only_spillover_tier_has_space |       Regular        |         Spillover         |           Regular           |           Spillover           |
     * +-------------------------------+----------------------+---------------------------+-----------------------------+-------------------------------+
     * | only_regular_tier_has_space   |       Regular        |          Regular          |           Regular           |            Regular            |
     * +-------------------------------+----------------------+---------------------------+-----------------------------+-------------------------------+
     *
     * @param {TierMapper} mapper1 The first tier to compare
     * @param {TierMapper} mapper2 The second tier to compare
     *
     * @returns >0 if (mapper1,mapping1) is best, <0 if (mapper2,mapping2) is best.
     *
     */
    static compare_tier(mapper1, mapper2) {

        const { online: online1, order: order1 } = mapper1;
        const { online: online2, order: order2 } = mapper2;

        if (online1 && order1 <= order2) return 1;
        if (online2 && order2 <= order1) return -1;
        return order2 - order1;
    }
}


/**
 *
 *
 * TieringMapper
 *
 *
 */
class TieringMapper {

    constructor(tiering) {
        this.tier_mappers = tiering.tiers
            .filter(t => !t.disabled)
            .sort((t, s) => t.order - s.order)
            .map(t => new TierMapper(t));
    }

    update_status(tiering_status, location_info) {
        const { tier_mappers } = this;

        for (let i = 0; i < tier_mappers.length; ++i) {
            const tier_mapper = tier_mappers[i];
            const tier_status = tiering_status[tier_mapper.tier._id];
            tier_mapper.update_status(tier_status, location_info);
        }
    }

    /**
     * Map a chunk based on the entire tiering policy
     * Works by picking the tier we want best for the chunk to be stored in,
     * @returns {Object} tier_mapping with mapping info for the chunk (allocations, deletions, ...)
     */
    map_tiering(chunk_mapper, tier) {
        const tier_mapper = _.find(this.tier_mappers, mapper => _.isEqual(mapper.tier._id, tier._id));
        return tier_mapper.map_tier(chunk_mapper);
    }

    select_tier_for_write(tier_id) {
        const { tier_mappers } = this;
        let best_mapper;
        let start_index = 0;
        if (tier_id) {
            const index = _.findIndex(tier_mappers, t => String(t.tier._id) === String(tier_id));
            if (index < 0) return;
            start_index = index + 1;
        }
        for (let i = start_index; i < tier_mappers.length; ++i) {
            const tier_mapper = tier_mappers[i];
            if (!best_mapper || TierMapper.compare_tier(tier_mapper, best_mapper) > 0) {
                best_mapper = tier_mapper;
            }
        }
        return best_mapper;
    }

    // get_tier_mapper(tier, chunk_mapper) {
    //     const tier_mapper = _.find(this.tier_mappers, mapper => _.isEqual(mapper.tier._id, tier));
    //     return tier_mapper.map_tier(chunk_mapper);
    // }
}

const tiering_mapper_cache = {
    hits: 0,
    miss: 0,
    map: new WeakMap(),
};

function _get_cached_tiering_mapper(tiering) {
    let tiering_mapper = tiering_mapper_cache.map.get(tiering);
    if (tiering_mapper) {
        tiering_mapper_cache.hits += 1;
    } else {
        tiering_mapper_cache.miss += 1;
        tiering_mapper = new TieringMapper(tiering);
        tiering_mapper_cache.map.set(tiering, tiering_mapper);
    }
    if ((tiering_mapper_cache.hits + tiering_mapper_cache.miss + 1) % 10000 === 0) {
        dbg.log0('tiering_mapper_cache:', tiering_mapper_cache);
    }
    return tiering_mapper;
}

/**
 *
 * map_chunk() the main mapper functionality
 * decide how to map a given chunk, either new, or existing
 *
 * @param {Object} chunk The data chunk, with chunk.blocks populated
 * @param {Object} tiering The bucket tiering
 * @param {Object} tiering_status See node_allocator.get_tiering_status()
 * @returns {Object} mapping
 */
function map_chunk(chunk, tier, tiering, tiering_status, location_info) {

    // const tiering_mapper = new TieringMapper(tiering);
    const tiering_mapper = _get_cached_tiering_mapper(tiering);
    tiering_mapper.update_status(tiering_status, location_info);

    const chunk_mapper = new ChunkMapper(chunk);
    const mapping = tiering_mapper.map_tiering(chunk_mapper, tier);

    if (dbg.should_log(2)) {
        if (dbg.should_log(3)) {
            dbg.log1('map_chunk: tiering_mapper', util.inspect(tiering_mapper, true, null, true));
            dbg.log1('map_chunk: chunk_mapper', util.inspect(chunk_mapper, true, null, true));
        }
        dbg.log1('map_chunk: mapping', util.inspect(mapping, true, null, true));
    }

    return mapping;
}

function select_tier_for_write(tiering, tiering_status, tier) {
    const tiering_mapper = _get_cached_tiering_mapper(tiering);
    tiering_mapper.update_status(tiering_status);
    const tier_mapper = tiering_mapper.select_tier_for_write(tier);
    return tier_mapper && tier_mapper.tier;
}

function is_chunk_good_for_dedup(chunk, tiering, tiering_status) {
    if (!chunk.tier._id) return false; // chunk tier was deleted so will need to be reallocated
    const mapping = map_chunk(chunk, chunk.tier, tiering, tiering_status);
    return mapping.accessible && !mapping.allocations;
}

function assign_node_to_block(block, node, system_id) {

    const system = system_store.data.get_by_id(system_id);
    if (!system) throw new Error('Could not find system ' + system_id);

    const pool = system.pools_by_name[node.pool];
    if (!pool) throw new Error('Could not find pool ' + node.pool + node);

    block.node = node;
    block.pool = pool._id;
    block.system = system_id;
}

function get_num_blocks_per_chunk(tier) {
    const {
        chunk_coder_config: {
            replicas = 1,
            data_frags = 1,
            parity_frags = 0,
        }
    } = tier.chunk_config;
    return replicas * (data_frags + parity_frags);
}

function get_part_info(part, adminfo, tiering_status, location_info) {
    const chunk_info = get_chunk_info(part.chunk, adminfo, tiering_status, location_info);
    return {
        start: part.start,
        end: part.end,
        seq: part.seq,
        multipart_id: part.multipart,
        chunk_id: part.chunk._id,
        chunk: chunk_info,
        chunk_offset: part.chunk_offset, // currently undefined
    };
}

function get_chunk_info(chunk, adminfo, tiering_status, location_info) {
    let allocations_by_frag_id;
    let deletions_by_frag_id;
    if (adminfo) {
        const bucket = system_store.data.get_by_id(chunk.bucket);
        const mapping = map_chunk(chunk, chunk.tier, bucket.tiering, tiering_status);
        if (!mapping.accessible) {
            adminfo = { health: 'unavailable' };
        } else if (mapping.allocations) {
            adminfo = { health: 'building' };
        } else {
            adminfo = { health: 'available' };
        }
        allocations_by_frag_id = _.groupBy(mapping.allocations, allocation => String(allocation.frag._id));
        deletions_by_frag_id = _.groupBy(mapping.deletions, deletion => String(deletion.frag));
    }
    const blocks_by_frag_id = _.groupBy(chunk.blocks, 'frag');
    return {
        tier: chunk.tier.name,
        chunk_coder_config: chunk.chunk_coder_config,
        size: chunk.size,
        frag_size: chunk.frag_size,
        compress_size: chunk.compress_size,
        digest_b64: chunk.digest && chunk.digest.toString('base64'),
        cipher_key_b64: chunk.cipher_key && chunk.cipher_key.toString('base64'),
        cipher_iv_b64: chunk.cipher_iv && chunk.cipher_iv.toString('base64'),
        cipher_auth_tag_b64: chunk.cipher_auth_tag && chunk.cipher_auth_tag.toString('base64'),
        frags: chunk.frags && _.map(chunk.frags, frag =>
            get_frag_info(chunk, frag, blocks_by_frag_id[frag._id],
                allocations_by_frag_id && allocations_by_frag_id[frag._id],
                deletions_by_frag_id && deletions_by_frag_id[frag._id],
                adminfo,
                location_info)
        ),
        adminfo: adminfo || undefined,
    };
}


function get_frag_info(chunk, frag, blocks, allocations, deletions, adminfo, location_info) {
    // sorting the blocks to have most available node on front
    // TODO GUY OPTIMIZE what about load balancing - maybe random the order of good blocks
    if (blocks) blocks.sort(location_info ? _block_sorter_local(location_info) : _block_sorter_basic);
    return {
        data_index: frag.data_index,
        parity_index: frag.parity_index,
        lrc_index: frag.lrc_index,
        digest_b64: frag.digest && frag.digest.toString('base64'),
        blocks: blocks ? _.map(blocks, block => get_block_info(chunk, frag, block, adminfo)) : [],
        deletions: deletions ? _.map(deletions, block => get_block_info(chunk, frag, block, adminfo)) : [],
        allocations: allocations ? _.map(allocations, alloc => get_alloc_info(alloc)) : [],
    };
}


function get_block_info(chunk, frag, block, adminfo) {
    if (adminfo) {
        const node = block.node;
        const system = system_store.data.get_by_id(block.system);
        const pool = system.pools_by_name[node.pool];
        const bucket = system_store.data.get_by_id(chunk.bucket);

        // Setting mirror_group for the block:
        // We return mirror_group undefined to mark blocks that are no longer relevant to the tiering policy,
        // such as disabled tiers or pools that were removed completely from the tierig policy.
        let mirror_group;
        _.forEach(bucket.tiering.tiers, ({ tier, disabled }) => {
            if (disabled) return;
            _.forEach(tier.mirrors, mirror => {
                if (_.find(mirror.spread_pools, pool)) {
                    mirror_group = String(mirror._id);
                }
            });
        });

        adminfo = {
            pool_name: pool.name,
            mirror_group,
            node_name: node.os_info.hostname + '#' + node.host_seq,
            host_name: node.os_info.hostname,
            mount: node.drive.mount,
            node_ip: node.ip,
            in_cloud_pool: Boolean(node.is_cloud_node),
            in_mongo_pool: Boolean(node.is_mongo_node),
            online: Boolean(node.online),
        };
    }
    return {
        block_md: get_block_md(chunk, frag, block),
        accessible: _is_block_accessible(block),
        adminfo: adminfo || undefined,
    };
}

function get_alloc_info(alloc) {
    return {
        mirror_group: alloc.mirror_group
    };
}

function get_block_md(chunk, frag, block) {
    return {
        size: block.size,
        id: block._id,
        address: block.node.rpc_address,
        node: block.node._id,
        node_type: block.node.node_type,
        pool: block.pool,
        digest_type: chunk.chunk_coder_config.frag_digest_type,
        digest_b64: frag.digest_b64 || (frag.digest && frag.digest.toString('base64')),
    };
}

function _is_block_accessible(block) {
    return block.node.readable && !block.missing && !block.tempered;
}

function _is_block_good_node(block) {
    return block.node.writable;
}

/**
 * sorting function for sorting blocks with most recent heartbeat first
 */
function _block_sorter_basic(block1, block2) {
    const node1 = block1.node;
    const node2 = block2.node;
    if (node2.readable && !node1.readable) return 1;
    if (node1.readable && !node2.readable) return -1;
    return node2.heartbeat - node1.heartbeat;
}

function _block_sorter_local(location_info) {
    return function(block1, block2) {
        const node1 = block1.node;
        const node2 = block2.node;
        const { node_id, host_id, pool_id, region } = location_info;
        if (node2.readable && !node1.readable) return 1;
        if (node1.readable && !node2.readable) return -1;
        if (String(node2._id) === node_id && String(node1._id) !== node_id) return 1;
        if (String(node1._id) === node_id && String(node2._id) !== node_id) return -1;
        if (node2.host_id === host_id && node1.host_id !== host_id) return 1;
        if (node1.host_id === host_id && node2.host_id !== host_id) return -1;
        if (String(block2.pool) === pool_id && String(block1.pool) !== pool_id) return 1;
        if (String(block1.pool) === pool_id && String(block2.pool) !== pool_id) return -1;
        if (region) {
            const pool1 = system_store.data.get_by_id(block1.pool);
            const pool2 = system_store.data.get_by_id(block2.pool);
            if (pool2.region === region && pool1.region !== region) return 1;
            if (pool1.region === region && pool2.region !== region) return -1;
        }
        return node2.heartbeat - node1.heartbeat;
    };
}

function _block_newer_first_sort(block1, block2) {
    return block2._id.getTimestamp().getTime() - block1._id.getTimestamp().getTime();
}

function _frag_index(frag) {
    if (frag.data_index >= 0) return `D${frag.data_index}`;
    if (frag.parity_index >= 0) return `P${frag.parity_index}`;
    if (frag.lrc_index >= 0) return `L${frag.lrc_index}`;
    throw new Error('BAD FRAG ' + JSON.stringify(frag));
}

function _pool_has_redundancy(pool) {
    return pool.cloud_pool_info || pool.mongo_pool_info;
}

function should_rebuild_chunk_to_local_mirror(mapping, location_info) {
    if (!location_info) return false;
    if (!location_info.pool_id && !location_info.region) return false;
    if (!mapping.tier) return false;
    // check if the selected tier is in mirroring mode
    if (mapping.tier.data_placement !== 'MIRROR') return false;
    // check if a pool in the selected tier policy is the location range or pool
    if (!find_local_mirror(mapping.tier.mirrors, location_info)) return false;
    // check if there is already a good block on a mirror that we consider local
    if (_.isEmpty(mapping.blocks_in_use)) return false;
    for (const block of mapping.blocks_in_use) {
        if (block.is_local_mirror) return false;
    }
    // check if a pool from the same region appear in the allocations list - 
    // if so then there is enough free space on the pool for this chunk and we should rebuild
    if (!mapping.allocations) return false;
    for (const allocation of mapping.allocations) {
        if (find_local_pool(allocation.pools, location_info)) return true;
    }
    // if we didn't find local pool in all allocations (as supposed to by previous conditions) we shouldn't rebuild - not enough space
    return false;
    // TODO - we don't actually check for available storage on the local mirror - for now we only consider allocations
}

function find_local_mirror(mirrors, location_info) {
    return mirrors.find(mirror => find_local_pool(mirror.spread_pools, location_info));
}

function find_local_pool(pools, location_info) {
    return location_info && pools.find(pool =>
        (location_info.region && location_info.region === pool.region) ||
        location_info.pool_id === String(pool._id)
    );
}

// EXPORTS
// exports.ChunkMapper = ChunkMapper;
// exports.TieringMapper = TieringMapper;
exports.map_chunk = map_chunk;
exports.select_tier_for_write = select_tier_for_write;
exports.is_chunk_good_for_dedup = is_chunk_good_for_dedup;
exports.assign_node_to_block = assign_node_to_block;
exports.get_num_blocks_per_chunk = get_num_blocks_per_chunk;
exports.get_part_info = get_part_info;
exports.get_chunk_info = get_chunk_info;
exports.get_frag_info = get_frag_info;
exports.get_block_info = get_block_info;
exports.get_block_md = get_block_md;
exports.should_rebuild_chunk_to_local_mirror = should_rebuild_chunk_to_local_mirror;
