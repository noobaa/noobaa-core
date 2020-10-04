/* Copyright (C) 2016 NooBaa */
'use strict';

/** @typedef {typeof import('../../sdk/nb')} nb */

const _ = require('lodash');
const assert = require('assert');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const mapper = require('./mapper');
const MDStore = require('./md_store').MDStore;
const time_utils = require('../../util/time_utils');
const size_utils = require('../../util/size_utils');
const server_rpc = require('../server_rpc');
const auth_server = require('../common_services/auth_server');
const map_deleter = require('./map_deleter');
const nodes_client = require('../node_services/nodes_client');
const system_store = require('../system_services/system_store').get_instance();
const node_allocator = require('../node_services/node_allocator');
const PeriodicReporter = require('../../util/periodic_reporter');
const Barrier = require('../../util/barrier');
const KeysSemaphore = require('../../util/keys_semaphore');
const { ChunkDB, BlockDB } = require('./map_db_types');
const { BlockAPI, get_all_chunks_blocks } = require('../../sdk/map_api_types');

const map_reporter = new PeriodicReporter('map_reporter', false);
const make_room_semaphore = new KeysSemaphore(1);
const ensure_room_barrier = new Barrier({
    max_length: 10,
    expiry_ms: 100,
    process: ensure_room_barrier_process,
});

/**
 *
 * GetMapping
 *
 * TODO:
 * - location_info
 * - alloc.sources?
 *
 */
class GetMapping {

    /**
     * @param {Object} props
     * @param {nb.Chunk[]} props.chunks
     * @param {boolean} props.check_dups
     * @param {nb.Tier} [props.move_to_tier]
     * @param {nb.LocationInfo} [props.location_info]
     */
    constructor(props) {
        this.chunks = props.chunks;
        this.move_to_tier = props.move_to_tier;
        this.check_dups = props.check_dups;
        this.location_info = props.location_info;

        this.chunks_per_bucket = _.groupBy(this.chunks, chunk => chunk.bucket_id);
        Object.seal(this);
    }

    /**
     * @returns {Promise<nb.Chunk[]>}
     */
    async run() {
        const millistamp = time_utils.millistamp();
        dbg.log1('GetMapping: start');
        try {
            await this.find_dups();
            await this.do_allocations();
            dbg.log1('GetMapping: DONE. chunks', this.chunks.length,
                'took', time_utils.millitook(millistamp));
            return this.chunks;
        } catch (err) {
            dbg.error('GetMapping: ERROR', err.stack || err);
            throw err;
        }
    }

    async find_dups() {
        if (!this.check_dups) return;
        if (!config.DEDUP_ENABLED) return;
        await Promise.all(Object.values(this.chunks_per_bucket).map(async chunks => {
            const bucket = chunks[0].bucket;
            const dedup_keys = _.compact(_.map(chunks,
                chunk => chunk.digest_b64 && Buffer.from(chunk.digest_b64, 'base64')));
            if (!dedup_keys.length) return;
            dbg.log0('GetMapping.find_dups: found keys', dedup_keys.length);
            const dup_chunks_db = await MDStore.instance().find_chunks_by_dedup_key(bucket, dedup_keys);
            const dup_chunks = dup_chunks_db.map(chunk_db => new ChunkDB(chunk_db));
            dbg.log0('GetMapping.find_dups: dup_chunks', dup_chunks);
            await _prepare_chunks_group({ chunks: dup_chunks, location_info: this.location_info });
            for (const dup_chunk of dup_chunks) {
                if (mapper.is_chunk_good_for_dedup(dup_chunk)) {
                    for (const chunk of chunks) {
                        if (chunk.size === dup_chunk.size &&
                            chunk.digest_b64 === dup_chunk.digest_b64) {
                            chunk.dup_chunk_id = dup_chunk._id;
                        }
                    }
                }
            }
        }));
    }

    async do_allocations() {
        await Promise.all(Object.values(this.chunks_per_bucket).map(async chunks => {
            const bucket = chunks[0].bucket;
            const total_size = _.sumBy(chunks, 'size');
            await _prepare_chunks_group({ chunks, move_to_tier: this.move_to_tier, location_info: this.location_info });
            let done = false;
            let retries = 0;
            while (!done) {
                const start_alloc_time = Date.now();
                done = await this.allocate_chunks(chunks);
                map_reporter.add_event(`allocate_chunks(${bucket.name})`, total_size, Date.now() - start_alloc_time);
                if (!done) {
                    retries += 1;
                    if (retries > config.IO_WRITE_BLOCK_RETRIES) {
                        const err = new Error('Couldn\'t allocate chunk - Will stop retries');
                        err.rpc_code = 'NOT_ENOUGH_SPACE';
                        throw err;
                    }
                    const uniq_tiers = _.uniq(_.map(chunks, 'tier'));
                    await P.map(uniq_tiers, tier => ensure_room_in_tier(tier, bucket));
                    await P.delay(config.ALLOCATE_RETRY_DELAY_MS);
                    // TODO Decide if we want to update the chunks mappings when looping
                    // await _prepare_chunks_group({ chunks, move_to_tier: this.move_to_tier, location_info: this.location_info });
                }
            }
        }));
    }

    /**
     * @param {nb.Chunk[]} chunks
     */
    async allocate_chunks(chunks) {
        for (const chunk of chunks) {
            if (chunk.dup_chunk_id) continue;
            const done = await this.allocate_chunk(chunk);
            if (!done) return false;
        }
        return true;
    }

    /**
     * @param {nb.Chunk} chunk
     */
    async allocate_chunk(chunk) {
        const avoid_blocks = _.flatMap(chunk.frags, frag => frag.blocks.filter(block =>
            block.node.node_type === 'BLOCK_STORE_FS'
        ));
        const avoid_nodes = avoid_blocks.map(block => String(block.node._id));
        const allocated_hosts = avoid_blocks.map(block => block.node.host_id);
        const preallocate_list = [];

        const has_room = enough_room_in_tier(chunk.tier, chunk.bucket);
        for (const frag of chunk.frags) {
            for (const alloc of frag.allocations) {
                const node = node_allocator.allocate_node({ pools: alloc.pools, avoid_nodes, allocated_hosts });
                if (!node) {
                    dbg.warn(`GetMapping allocate_blocks: no nodes for allocation ` +
                        `avoid_nodes ${avoid_nodes.join(',')} ` +
                        `allocation_pools [${alloc.pools ? alloc.pools.join(',') : ''}]`
                    );
                    return false;
                }
                const pool = chunk.tier.system.pools_by_name[node.pool];
                alloc.block_md.node = node._id.toHexString();
                alloc.block_md.pool = pool._id.toHexString();
                alloc.block_md.address = node.rpc_address;
                alloc.block_md.node_type = node.node_type;
                alloc.locality_level = 0;
                if (this.location_info) {
                    if (this.location_info.node_id === alloc.block_md.node) {
                        alloc.locality_level = 4;
                    } else if (this.location_info.host_id === node.host_id) {
                        alloc.locality_level = 3;
                    } else if (this.location_info.pool_id === alloc.block_md.pool) {
                        alloc.locality_level = 2;
                    } else if (this.location_info.region === pool.region) {
                        alloc.locality_level = 1;
                    }
                }
                if (node.node_type === 'BLOCK_STORE_FS') {
                    avoid_nodes.push(String(node._id));
                    allocated_hosts.push(node.host_id);
                }
                if (!has_room) preallocate_list.push(alloc);
            }
            // sort allocations by location_info
            frag.allocations.sort((alloc1, alloc2) => alloc2.locality_level - alloc1.locality_level);
        }

        if (preallocate_list.length) {
            let ok = true;
            await P.map(preallocate_list, async alloc => {
                try {
                    await server_rpc.client.block_store.preallocate_block({
                        block_md: alloc.block_md,
                    }, {
                        address: alloc.block_md.address,
                        timeout: config.IO_REPLICATE_BLOCK_TIMEOUT,
                        auth_token: auth_server.make_auth_token({
                            system_id: chunk.bucket.system._id,
                            role: 'admin',
                        })
                    });
                    alloc.block_md.is_preallocated = true;
                } catch (err) {
                    dbg.warn('GetMapping: preallocate_block failed, will retry', alloc.block_md);
                    ok = false;
                }
            });
            if (!ok) return false;
        }

        return true;
    }



}


/**
 *
 * PUT_MAPPING
 *
 */
class PutMapping {

    /**
     * @param {Object} props
     * @param {nb.Chunk[]} props.chunks
     * @param {nb.Tier} props.move_to_tier
     */
    constructor(props) {
        this.chunks = props.chunks;
        this.move_to_tier = props.move_to_tier;

        /** @type {nb.BlockSchemaDB[]} */
        this.new_blocks = [];
        /** @type {nb.ChunkSchemaDB[]} */
        this.new_chunks = [];
        /** @type {nb.PartSchemaDB[]} */
        this.new_parts = [];
        /** @type {nb.Block[]} */
        this.delete_blocks = [];
        /** @type {nb.ID[]} */
        this.update_chunk_ids = [];
        Object.seal(this);
    }

    async run() {
        const millistamp = time_utils.millistamp();
        dbg.log1('PutMapping: Start.');
        try {
            this.add_chunks();
            await this.update_db();
            dbg.log1('PutMapping: DONE. chunks', this.chunks.length,
                'took', time_utils.millitook(millistamp));
            return this.chunks;
        } catch (err) {
            dbg.error('PutMapping: ERROR', err.stack || err);
            throw err;
        }
    }

    add_chunks() {
        for (const chunk of this.chunks) {
            if (chunk.dup_chunk_id) { // duplicated chunk
                this.add_new_parts(chunk.parts, chunk);
            } else if (chunk._id) {
                this.add_existing_chunk(chunk);
            } else {
                this.add_new_chunk(chunk);
            }
        }
    }

    /**
     * @param {nb.Chunk} chunk
     */
    add_new_chunk(chunk) {
        chunk.set_new_chunk_id();
        this.add_new_parts(chunk.parts, chunk);
        for (const frag of chunk.frags) {
            frag.set_new_frag_id();
            assert.strictEqual(frag.blocks.length, 0);
            for (const alloc of frag.allocations) {
                this.add_new_block(alloc.block_md, frag, chunk);
            }
        }
        this.new_chunks.push(chunk.to_db());
    }

    /**
     * @param {nb.Chunk} chunk
     */
    add_existing_chunk(chunk) {
        this.update_chunk_ids.push(chunk._id);
        for (const frag of chunk.frags) {
            for (const alloc of frag.allocations) {
                this.add_new_block(alloc.block_md, frag, chunk);
            }
            for (const block of frag.blocks) {
                if (block.is_deletion) {
                    this.delete_blocks.push(block);
                }
            }
        }
    }

    /**
     * @param {nb.Part[]} parts
     * @param {nb.Chunk} chunk
     */
    add_new_parts(parts, chunk) {
        // let upload_size = obj.upload_size || 0;
        const chunk_id = chunk.dup_chunk_id ? chunk.dup_chunk_id : chunk._id;
        for (const part of parts) {
            // if (upload_size < part.end) {
            //     upload_size = part.end;
            // }
            part.set_new_part_id();
            part.set_chunk(chunk_id);
            this.new_parts.push(part.to_db());
        }
    }

    /**
     * @param {nb.BlockMD} block_md
     * @param {nb.Frag} frag
     * @param {nb.Chunk} chunk
     */
    add_new_block(block_md, frag, chunk) {
        const block = new BlockAPI({ block_md }, system_store);
        block.set_parent_ids(frag, chunk);
        const bucket = chunk.bucket;
        const now = Date.now();
        const block_id_time = block._id.getTimestamp().getTime();
        if (block_id_time < now - (config.MD_GRACE_IN_MILLISECONDS - config.MD_AGGREGATOR_INTERVAL)) {
            dbg.error('PutMapping: A big gap was found between id creation and addition to DB:',
                block, bucket.name, block_id_time, now);
        }
        if (block_id_time < bucket.storage_stats.last_update + config.MD_AGGREGATOR_INTERVAL) {
            dbg.error('PutMapping: A big gap was found between id creation and bucket last update:',
                block, bucket.name, block_id_time, bucket.storage_stats.last_update);
        }
        if (!block.node_id || !block.pool_id) {
            dbg.error('PutMapping: Missing node/pool for block', block);
            throw new Error('PutMapping: Missing node/pool for block');
        }
        this.new_blocks.push(block.to_db());
    }

    async update_db() {
        await Promise.all([
            MDStore.instance().insert_blocks(this.new_blocks),
            MDStore.instance().insert_chunks(this.new_chunks),
            MDStore.instance().insert_parts(this.new_parts),
            map_deleter.delete_blocks(this.delete_blocks),

            // TODO
            // (upload_size > obj.upload_size) && MDStore.instance().update_object_by_id(obj._id, { upload_size: upload_size })

        ]);
    }

}

/**
 * @param {nb.Bucket} bucket
 * @returns {Promise<nb.Tier>}
 */
async function select_tier_for_write(bucket) {
    const tiering = bucket.tiering;
    await node_allocator.refresh_tiering_alloc(tiering);
    const tiering_status = node_allocator.get_tiering_status(tiering);
    return mapper.select_tier_for_write(tiering, tiering_status);
}

/**
 * @param {nb.Tier} tier
 * @param {nb.Tiering} tiering
 * @param {nb.LocationInfo} location_info
 * @returns {Promise<nb.TierMirror>}
 */
async function select_mirror_for_write(tier, tiering, location_info) {
    await node_allocator.refresh_tiering_alloc(tiering);
    const tiering_status = node_allocator.get_tiering_status(tiering);
    return mapper.select_mirror_for_write(tier, tiering, tiering_status, location_info);
}


/**
 * @param {nb.ID} tier_id
 * @param {nb.ID} bucket_id
 */
async function make_room_in_tier(tier_id, bucket_id) {
    return make_room_semaphore.surround_key(String(tier_id), async () => {
        /** @type {nb.Tier} */
        const tier = tier_id && system_store.data.get_by_id(tier_id);
        /** @type {nb.Bucket} */
        const bucket = bucket_id && system_store.data.get_by_id(bucket_id);
        const tiering = bucket.tiering;
        const tier_and_order = tiering.tiers.find(t => String(t.tier._id) === String(tier_id));

        await node_allocator.refresh_tiering_alloc(tiering);
        if (enough_room_in_tier(tier, bucket)) return;

        const tiering_status = node_allocator.get_tiering_status(tiering);
        const next_tier = mapper.select_tier_for_write(tiering, tiering_status, tier_and_order.order + 1);
        if (!next_tier) {
            dbg.warn(`make_room_in_tier: No next tier to move data to`, tier.name);
            return;
        }

        const chunk_ids = await MDStore.instance().find_oldest_tier_chunk_ids(tier._id, config.CHUNK_MOVE_LIMIT, 1);
        const start_alloc_time = Date.now();
        await server_rpc.client.scrubber.build_chunks({
            chunk_ids,
            tier: next_tier._id,
        }, {
            auth_token: auth_server.make_auth_token({
                system_id: bucket.system._id,
                role: 'admin'
            })
        });
        map_reporter.add_event(`scrubber.build_chunks(${tier.name})`, chunk_ids.length, Date.now() - start_alloc_time);
        dbg.log0(`make_room_in_tier: moved ${chunk_ids.length} to next tier`);

        // TODO avoid multiple calls, maybe plan how much to move before and refresh after moving enough
        await node_allocator.refresh_tiering_alloc(tiering, 'force');
    });
}
/**
 * @param {Array<{ tier: nb.Tier, bucket: nb.Bucket }>} tiers_and_buckets
 */
async function ensure_room_barrier_process(tiers_and_buckets) {
    const uniq_tiers_and_buckets = _.uniqBy(tiers_and_buckets, 'tier');
    await P.map(uniq_tiers_and_buckets, async ({ tier, bucket }) => {
        await server_rpc.client.scrubber.make_room_in_tier({
            tier: tier._id,
            bucket: bucket._id,
        }, {
            auth_token: auth_server.make_auth_token({
                system_id: bucket.system._id,
                role: 'admin'
            })
        });
        await node_allocator.refresh_tiering_alloc(bucket.tiering, 'force');
        enough_room_in_tier(tier, bucket); // calling just to do the log prints
    });
}

/**
 * @param {nb.Tier} tier
 * @param {nb.Bucket} bucket
 */
async function ensure_room_in_tier(tier, bucket) {
    await node_allocator.refresh_tiering_alloc(bucket.tiering);
    if (enough_room_in_tier(tier, bucket)) return;
    const start_time = Date.now();
    await ensure_room_barrier.call({ tier, bucket });
    map_reporter.add_event(`ensure_room_in_tier(${tier.name})`, 0, Date.now() - start_time);
}

/**
 * @param {nb.Tier} tier
 * @param {nb.Bucket} bucket
 */
function enough_room_in_tier(tier, bucket) {
    const tiering = bucket.tiering;
    const tier_id_str = tier._id.toHexString();
    const tiering_status = node_allocator.get_tiering_status(tiering);
    const tier_status = tiering_status[tier_id_str];
    const tier_in_tiering = _.find(tiering.tiers, t => String(t.tier._id) === tier_id_str);
    if (!tier_in_tiering || !tier_status) throw new Error(`Can't find current tier in bucket`);
    const available_to_upload = size_utils.json_to_bigint(size_utils.reduce_minimum(
        'free', tier_status.mirrors_storage.map(storage => (storage.free || 0))
    ));
    if (available_to_upload && available_to_upload.greater(config.ENOUGH_ROOM_IN_TIER_THRESHOLD)) {
        dbg.log1('enough_room_in_tier: has enough room', tier.name, available_to_upload.toJSNumber(), '>', config.ENOUGH_ROOM_IN_TIER_THRESHOLD);
        map_reporter.add_event(`has_enough_room(${tier.name})`, available_to_upload.toJSNumber(), 0);
        return true;
    } else {
        dbg.log0_throttled(`enough_room_in_tier: not enough room ${tier.name}:`,
            `${available_to_upload && available_to_upload.toJSNumber()} < ${config.ENOUGH_ROOM_IN_TIER_THRESHOLD} should move chunks to next tier`);
        map_reporter.add_event(`enough_room_in_tier: not_enough_room(${tier.name})`, available_to_upload && available_to_upload.toJSNumber(), 0);
        return false;
    }
}


/**
 * @param {Object} params
 * @param {nb.Chunk[]} params.chunks
 * @param {nb.Tier} [params.move_to_tier]
 * @param {nb.LocationInfo} [params.location_info]
 * @returns {Promise<void>}
 */
async function prepare_chunks({ chunks, move_to_tier, location_info }) {
    const chunks_per_bucket = _.groupBy(chunks, chunk => chunk.bucket_id);
    if (move_to_tier) assert.strictEqual(Object.keys(chunks_per_bucket).length, 1);
    await Promise.all(
        Object.values(chunks_per_bucket).map(chunks_group =>
            _prepare_chunks_group({ chunks: chunks_group, move_to_tier, location_info })
        )
    );
}

/**
 * @param {Object} params
 * @param {nb.Chunk[]} params.chunks
 * @param {nb.Tier} [params.move_to_tier]
 * @param {nb.LocationInfo} [params.location_info]
 * @returns {Promise<void>}
 */
async function _prepare_chunks_group({ chunks, move_to_tier, location_info }) {
    if (!chunks.length) return;

    const bucket = chunks[0].bucket;
    const all_blocks = get_all_chunks_blocks(chunks);

    await Promise.all([
        node_allocator.refresh_tiering_alloc(bucket.tiering),
        prepare_blocks(all_blocks),
    ]);
    const tiering_status = node_allocator.get_tiering_status(bucket.tiering);

    for (const chunk of chunks) {

        chunk.is_accessible = false;
        chunk.is_building_blocks = false;
        chunk.is_building_frags = false;
        let num_accessible_frags = 0;
        for (const frag of chunk.frags) {
            frag.is_accessible = false;
            frag.is_building_blocks = false;
            frag.allocations = [];
            for (const block of frag.blocks) {
                if (!block.node || !block.node._id) {
                    dbg.warn('ORPHAN BLOCK (ignoring)', block);
                }
                block.is_accessible = block.node && block.node.readable;
                if (block.is_accessible && !frag.is_accessible) {
                    frag.is_accessible = true;
                    num_accessible_frags += 1;
                }
            }
        }
        if (num_accessible_frags >= chunk.chunk_coder_config.data_frags) {
            chunk.is_accessible = true;
        }

        let selected_tier;
        if (move_to_tier) {
            selected_tier = move_to_tier;
        } else if (chunk.tier) {
            const tier_and_order = bucket.tiering.tiers.find(t => String(t.tier._id) === String(chunk.tier._id));
            selected_tier = mapper.select_tier_for_write(bucket.tiering, tiering_status, tier_and_order.order);
        } else {
            selected_tier = mapper.select_tier_for_write(bucket.tiering, tiering_status);
        }

        mapper.map_chunk(chunk, selected_tier, bucket.tiering, tiering_status, location_info);
    }
}

/**
 *
 * @param {nb.Block[]} blocks
 */
async function prepare_blocks(blocks) {
    if (!blocks || !blocks.length) return;
    const node_ids = _.uniqBy(blocks.map(block => block.node_id), id => id.toHexString());
    const system_id = blocks[0].system._id;
    const { nodes } = await nodes_client.instance().list_nodes_by_identity(
        system_id,
        node_ids.map(id => ({ id: id.toHexString() })),
        nodes_client.NODE_FIELDS_FOR_MAP
    );
    const nodes_by_id = _.keyBy(nodes, '_id');
    for (const block of blocks) {
        const node = nodes_by_id[block.node_id.toHexString()];
        /** @type {nb.Pool} */
        const pool = system_store.data.systems[0].pools_by_name[node.pool];
        block.set_node(node, pool);
    }
}

/**
 *
 * @param {nb.BlockSchemaDB[]} blocks
 * @return {Promise<nb.Block[]>}
 */
async function prepare_blocks_from_db(blocks) {
    const chunk_ids = blocks.map(block => block.chunk);
    const chunks = await MDStore.instance().find_chunks_by_ids(chunk_ids);
    const chunks_by_id = _.keyBy(chunks, '_id');
    const db_blocks = blocks.map(block => {
        const chunk_db = new ChunkDB(chunks_by_id[block.chunk.toHexString()]);
        const frag_db = _.find(chunk_db.frags, frag =>
            frag._id.toHexString() === block.frag.toHexString());
        const block_db = new BlockDB(block, frag_db, chunk_db);
        return block_db;
    });
    await prepare_blocks(db_blocks);
    return db_blocks;
}


exports.GetMapping = GetMapping;
exports.PutMapping = PutMapping;
exports.select_tier_for_write = select_tier_for_write;
exports.select_mirror_for_write = select_mirror_for_write;
exports.enough_room_in_tier = enough_room_in_tier;
exports.make_room_in_tier = make_room_in_tier;
exports.prepare_chunks = prepare_chunks;
exports.prepare_blocks = prepare_blocks;
exports.prepare_blocks_from_db = prepare_blocks_from_db;
