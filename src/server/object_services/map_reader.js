/* Copyright (C) 2016 NooBaa */
'use strict';

/** @typedef {typeof import('../../sdk/nb')} nb */

const _ = require('lodash');
const util = require('util');

const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config.js');
const MDStore = require('./md_store').MDStore;
const map_server = require('./map_server');
const db_client = require('../../util/db_client');
const { ChunkDB } = require('./map_db_types');
const { ChunkAPI } = require('../../sdk/map_api_types');
const server_rpc = require('../server_rpc');
const auth_server = require('../common_services/auth_server');
const system_store = require('../system_services/system_store').get_instance();


/**
 * Builds prepared ChunkDB instances from pre-fetched parts and chunks_db rows.
 * Groups each part with its matching chunk and calls prepare_chunks to resolve
 * block locations before returning.
 *
 * @param {nb.PartSchemaDB[]} parts
 * @param {nb.ChunkSchemaDB[]} chunks_db
 * @returns {Promise<nb.Chunk[]>}
 */
async function assemble_chunks_from_parts(parts, chunks_db) {
    const chunks_db_by_id = _.keyBy(chunks_db, '_id');
    const chunks = parts.map(part =>
        new ChunkDB({ ...chunks_db_by_id[part.chunk.toHexString()], parts: [part] })
    );
    await map_server.prepare_chunks({ chunks });
    return chunks;
}

/**
 * Fetch parts and chunks by range, build and return ChunkDB array.
 * @param {nb.ID} obj_id
 * @param {{ start: number, end: number }} rng
 * @param {(a: any, b: any) => number} sorter
 * @returns {Promise<nb.Chunk[]>}
 */
async function read_parts_mapping_postgres(obj_id, rng, sorter) {
    const { parts, chunks_db } = await MDStore.instance().find_parts_chunks_blocks_by_range({
        obj_id,
        start_gte: rng.start - config.MAX_OBJECT_PART_SIZE,
        start_lt: rng.end,
        end_gt: rng.start,
        sorter,
    });
    if (parts.length === 0) return [];
    return assemble_chunks_from_parts(parts, chunks_db);
}

/**
 *
 * read_object_mapping
 *
 * query the db for existing parts and blocks which intersect the requested range,
 * return the blocks inside each part (part.fragments) like the api format
 * to make it ready for replying and simpler to iterate
 *
 * @param {nb.ObjectMD} obj
 * @param {number} [start]
 * @param {number} [end]
 * @param {nb.LocationInfo} [location_info]
 * @param {nb.ChunkInfo[]} [prefetched_chunks_info]
 * @returns {Promise<nb.Chunk[]>}
 */
async function read_object_mapping(obj, start, end, location_info, prefetched_chunks_info) {
    // check for empty range
    const rng = sanitize_object_range(obj, start, end);
    if (!rng) return [];

    let chunks;
    if (config.DB_TYPE === 'postgres') {
        // Combined query: parts + chunks + blocks in one round-trip.
        // If pre-fetched chunk data was passed from read_object_md, use it to skip the DB
        const sorter = location_info ? _block_sorter_local(location_info) : _block_sorter_basic;
        if (prefetched_chunks_info && prefetched_chunks_info.length) {
            chunks = prefetched_chunks_info.map(chunk_info => new ChunkAPI(chunk_info, system_store));
        } else {
            chunks = await read_parts_mapping_postgres(obj._id, rng, sorter);
        }
        if (chunks.length === 0) return [];
        if (await update_chunks_on_read(chunks, location_info)) {
            chunks = await read_parts_mapping_postgres(obj._id, rng, sorter);
        }
        return chunks;
    }
    // find parts intersecting the [start,end) range
    const parts = await MDStore.instance().find_parts_by_start_range({
        obj_id: obj._id,
        // since end is not indexed we query start with both
        // low and high constraint, which allows the index to reduce scan
        // we use a constant that limits the max part size because
        // this is the only way to limit the minimal start value
        start_gte: rng.start - config.MAX_OBJECT_PART_SIZE,
        start_lt: rng.end,
        end_gt: rng.start,
    });

    if (parts.length === 0) return [];
    chunks = await read_parts_mapping(parts, location_info);
    if (await update_chunks_on_read(chunks, location_info)) {
        chunks = await read_parts_mapping(parts, location_info);
    }
    return chunks;
}


/**
 *
 * read_object_mapping
 *
 * query the db for existing parts and blocks which intersect the requested range,
 * return the blocks inside each part (part.fragments) like the api format
 * to make it ready for replying and simpler to iterate
 *
 * @param {nb.ObjectMD} obj
 * @param {number} [skip]
 * @param {number} [limit]
 * @returns {Promise<nb.Chunk[]>}
 */
async function read_object_mapping_admin(obj, skip, limit) {
    const parts = await MDStore.instance().find_parts_sorted_by_start({
        obj_id: obj._id,
        skip,
        limit,
    });
    const chunks = await read_parts_mapping(parts);
    return chunks;
}

/**
 * @param {nb.ID[]} node_ids
 * @param {number} [skip]
 * @param {number} [limit]
 * @returns {Promise<nb.Chunk[]>}
 */
async function read_node_mapping(node_ids, skip, limit) {
    const chunk_ids = await MDStore.instance().find_blocks_chunks_by_node_ids(node_ids, skip, limit);
    const parts = await MDStore.instance().find_parts_by_chunk_ids(chunk_ids);
    const chunks = await read_parts_mapping(_.uniqBy(parts, part => part.chunk.toHexString()));
    return chunks;
}


/**
 *
 * @param {nb.PartSchemaDB[]} parts
 * @param {nb.LocationInfo} [location_info]
 * @returns {Promise<nb.Chunk[]>}
 */
async function read_parts_mapping(parts, location_info) {
    const chunks_db = await MDStore.instance().find_chunks_by_ids(db_client.instance().uniq_ids(parts, 'chunk'));
    const sorter = location_info ? _block_sorter_local(location_info) : _block_sorter_basic;
    await MDStore.instance().load_blocks_for_chunks(chunks_db, sorter);
    const chunks_db_by_id = _.keyBy(chunks_db, '_id');
    const chunks = parts.map(part => {
        const chunk = new ChunkDB({ ...chunks_db_by_id[part.chunk.toHexString()], parts: [part] });
        return chunk;
    });
    await map_server.prepare_chunks({ chunks });
    return chunks;
}


/**
 * @param {nb.Chunk[]} chunks
 * @param {nb.LocationInfo} [location_info]
 */
async function update_chunks_on_read(chunks, location_info) {
    const chunks_to_scrub = [];
    try {
        const bucket = chunks[0].bucket;
        const selected_tier = await map_server.select_tier_for_read(bucket);
        for (const chunk of chunks) {
            if ((!chunk.tier._id || !_.isEqual(chunk.tier._id, selected_tier._id)) &&
                map_server.enough_room_in_tier(selected_tier, bucket)) {
                dbg.log0('Chunk with low tier will be sent for rebuilding', chunk._id);
                chunks_to_scrub.push(chunk);
            } else if (location_info) {
                if (chunk.tier.data_placement !== 'MIRROR') return;
                const mirror = await map_server.select_mirror_for_write(chunk.tier, bucket.tiering, location_info);
                if (mirror.spread_pools.find(pool => (location_info.region && location_info.region === pool.region) ||
                        location_info.pool_id === String(pool._id))) {
                    dbg.log2('Chunk with following mapping will be sent for rebuilding', chunk);
                    chunks_to_scrub.push(chunk);
                }
            }
        }
        if (chunks_to_scrub.length) {
            const chunk_ids = chunks_to_scrub.map(chunk => chunk._id);
            const current_tiers = chunks_to_scrub.map(chunk => chunk.tier._id);
            dbg.log1('Chunks wasn\'t found in local pool/upper tier - the following will be rebuilt:', util.inspect(chunks_to_scrub));
            await server_rpc.client.scrubber.build_chunks({
                chunk_ids,
                tier: selected_tier._id,
                current_tiers,
            }, {
                auth_token: auth_server.make_auth_token({
                    system_id: bucket.system._id,
                    role: 'admin'
                })
            });
        }
    } catch (err) {
        dbg.warn('Chunks failed to rebuilt - skipping', err);
    }
    return chunks_to_scrub.length;
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
 * @param {nb.Block} block1
 * @param {nb.Block} block2
 */
function _block_sorter_basic(block1, block2) {
    const node1 = block1.node;
    const node2 = block2.node;
    if (node2.readable && !node1.readable) return 1;
    if (node1.readable && !node2.readable) return -1;
    return node2.heartbeat - node1.heartbeat;
}

/**
 * locality sorting function for blocks
 * @param {nb.LocationInfo} location_info
 */
function _block_sorter_local(location_info) {
    return sort_func;
    /**
     * locality sorting function for blocks
     * @param {nb.Block} block1
     * @param {nb.Block} block2
     */
    function sort_func(block1, block2) {
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
            if (block2.pool.region === region && block1.pool.region !== region) return 1;
            if (block1.pool.region === region && block2.pool.region !== region) return -1;
        }
        return node2.heartbeat - node1.heartbeat;
    }
}

// EXPORTS
exports.assemble_chunks_from_parts = assemble_chunks_from_parts;
exports.read_object_mapping = read_object_mapping;
exports.read_object_mapping_admin = read_object_mapping_admin;
exports.read_node_mapping = read_node_mapping;
