/* Copyright (C) 2016 NooBaa */
'use strict';

/** @typedef {typeof import('../../sdk/nb')} nb */

const _ = require('lodash');
// const util = require('util');

// const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config.js');
const MDStore = require('./md_store').MDStore;
const map_server = require('./map_server');
const mongo_utils = require('../../util/mongo_utils');
const { ChunkDB } = require('./map_db_types');

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
 * @returns {Promise<nb.Chunk[]>}
 */
async function read_object_mapping(obj, start, end, location_info) {
    // check for empty range
    const rng = sanitize_object_range(obj, start, end);
    if (!rng) return [];

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
    // console.log('TODO GGG read_object_mapping', parts);
    const chunks = await read_parts_mapping(parts);
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
    const chunks = await read_parts_mapping(parts);
    return chunks;
}


/**
 * 
 * @param {nb.PartSchemaDB[]} parts
 * @returns {Promise<nb.Chunk[]>}
 */
async function read_parts_mapping(parts) {
    const chunks_db = await MDStore.instance().find_chunks_by_ids(mongo_utils.uniq_ids(parts, 'chunk'));
    await MDStore.instance().load_blocks_for_chunks(chunks_db);
    const chunks_db_by_id = _.keyBy(chunks_db, '_id');
    const chunks = parts.map(part => {
        const chunk_db = chunks_db_by_id[part.chunk.toHexString()];
        if (chunk_db.parts) {
            chunk_db.parts.push(part);
        } else {
            chunk_db.parts = [part];
        }
        const chunk = new ChunkDB(chunk_db);
        return chunk;
    });
    await map_server.prepare_chunks({ chunks });
    return chunks;
}


// /**
//  * @param {nb.Chunk[]} chunks
//  * @param {nb.LocationInfo} [location_info]
//  */
// async function update_chunks_on_read(chunks, location_info) {
//     const chunks = _.map(parts, 'chunk');
//     const tiering_status_by_bucket_id = {};

//     for (const chunk of chunks) {
//         map_server.populate_chunk(chunk);
//     }

//     await _load_chunk_mappings(chunks, tiering_status_by_bucket_id);

//     const chunks_to_scrub = [];
//     try {
//         const bucket = system_store.data.get_by_id(chunks[0].bucket);
//         const tiering_status = tiering_status_by_bucket_id[bucket._id];
//         const selected_tier = mapper.select_tier_for_write(bucket.tiering, tiering_status);
//         for (const chunk of chunks) {
//             map_server.populate_chunk(chunk);
//             if (!chunk.tier._id || !_.isEqual(chunk.tier._id, selected_tier._id)) {
//                 dbg.log0('Chunk with low tier will be sent for rebuilding', chunk);
//                 chunks_to_scrub.push(chunk);
//             } else if (location_info) {
//                 const chunk_info = mapper.get_chunk_info(chunk);
//                 const mapping = mapper.map_chunk(chunk_info, chunk.tier, bucket.tiering, tiering_status, location_info);
//                 if (mapper.should_rebuild_chunk_to_local_mirror(mapping, location_info)) {
//                     dbg.log2('Chunk with following mapping will be sent for rebuilding', chunk, mapping);
//                     chunks_to_scrub.push(chunk);
//                 }
//             }
//         }
//         if (chunks_to_scrub.length) {
//             dbg.log1('Chunks wasn\'t found in local pool - the following will be rebuilt:', util.inspect(chunks_to_scrub));
//             await server_rpc.client.scrubber.build_chunks({
//                 chunk_ids: _.map(chunks_to_scrub, '_id'),
//                 tier: selected_tier._id,
//             }, {
//                 auth_token: auth_server.make_auth_token({
//                     system_id: chunks_to_scrub[0].system,
//                     role: 'admin'
//                 })
//             });
//         }
//     } catch (err) {
//         dbg.warn('Chunks failed to rebuilt - skipping');
//     }
//     if (chunks_to_scrub.length) {
//         // mismatch type...
//         await MDStore.instance().load_blocks_for_chunks(chunks);
//     }
// }

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

// EXPORTS
exports.read_object_mapping = read_object_mapping;
exports.read_object_mapping_admin = read_object_mapping_admin;
exports.read_node_mapping = read_node_mapping;
