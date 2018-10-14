/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config.js');
const mapper = require('./mapper');
const util = require('util');
const MDStore = require('./md_store').MDStore;
const node_allocator = require('../node_services/node_allocator');
const system_store = require('../system_services/system_store').get_instance();
const system_utils = require('../utils/system_utils');
const server_rpc = require('../server_rpc');
const auth_server = require('../common_services/auth_server');


/**
 *
 * read_object_mappings
 *
 * query the db for existing parts and blocks which intersect the requested range,
 * return the blocks inside each part (part.fragments) like the api format
 * to make it ready for replying and simpler to iterate
 *
 */
async function read_object_mappings(obj, start, end, skip, limit, adminfo, location_info) {
    // check for empty range
    const rng = sanitize_object_range(obj, start, end);
<<<<<<< HEAD
    if (!rng) return [];
=======
    if (!rng) return P.resolve([]);
    if (!obj._id) return P.reject(new Error('Object missing object ID'));
>>>>>>> f706327a4... commit after reset head

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
        skip,
        limit,
    });
    // console.log('TODO GGG read_object_mappings', parts);
    await MDStore.instance().populate_chunks_for_parts(parts);
    const parts_mappings = await read_parts_mappings({ parts, adminfo, location_info });
    return parts_mappings;
}


/**
 *
 * read_node_mappings
 *
 */
function read_node_mappings(node_ids, skip, limit) {
    return MDStore.instance().iterate_multi_nodes_chunks({
            node_ids,
            skip: skip || 0,
            limit: limit || 0,
        })
        .then(res => MDStore.instance().find_parts_by_chunk_ids(res.chunk_ids))
        .then(parts => P.join(
            MDStore.instance().populate_chunks_for_parts(parts),
            MDStore.instance().populate_objects(parts, 'obj')
        ).return(parts))
        .then(parts => read_parts_mappings({ parts, adminfo: true, set_obj: true }))
        .then(parts => {
            const objects_by_id = {};
            const parts_per_obj_id = _.groupBy(parts, part => {
                var obj = part.obj;
                delete part.obj;
                objects_by_id[obj._id] = obj;
                return obj._id;
            });
            const objects_reply = _.map(objects_by_id, (obj, obj_id) => ({
                obj_id,
                upload_started: obj.upload_started ? obj.upload_started.getTimestamp().getTime() : undefined,
                key: obj.key,
                version_id: MDStore.instance().get_object_version_id(obj),
                bucket: system_store.data.get_by_id(obj.bucket).name,
                parts: parts_per_obj_id[obj_id],
            }));
            return objects_reply;
        });
}


/**
 *
 * read_parts_mappings
 *
 * parts should have populated chunks
 *
 * @params: parts, set_obj, adminfo
 */
async function read_parts_mappings({ parts, adminfo, set_obj, location_info, same_bucket }) {
    const chunks = _.map(parts, 'chunk');
    const tiering_status_by_bucket_id = {};

    await _load_chunk_mappings(chunks, tiering_status_by_bucket_id);


    if (same_bucket && !adminfo) {
        const chunks_to_scrub = [];
        try {
            const bucket = system_store.data.get_by_id(chunks[0].bucket);
            const tiering_status = tiering_status_by_bucket_id[bucket._id];
            const selected_tier = mapper.select_tier_for_write(bucket.tiering, tiering_status);
            for (const chunk of chunks) {
                system_utils.prepare_chunk_for_mapping(chunk);
                if (!chunk.tier._id || !_.isEqual(chunk.tier._id, selected_tier._id)) {
                    dbg.log0('Chunk with low tier will be sent for rebuilding', chunk);
                    chunks_to_scrub.push(chunk);
                } else if (location_info) {
                    const mapping = mapper.map_chunk(chunk, chunk.tier, bucket.tiering, tiering_status, location_info);
                    if (mapper.should_rebuild_chunk_to_local_mirror(mapping, location_info)) {
                        dbg.log2('Chunk with following mapping will be sent for rebuilding', chunk, mapping);
                        chunks_to_scrub.push(chunk);
                    }
                }
            }
            if (chunks_to_scrub.length) {
                dbg.log1('Chunks wasn\'t found in local pool - the following will be rebuilt:', util.inspect(chunks_to_scrub));
                await server_rpc.client.scrubber.build_chunks({
                    chunk_ids: _.map(chunks_to_scrub, '_id'),
                    tier: selected_tier._id,
                }, {
                    auth_token: auth_server.make_auth_token({
                        system_id: chunks_to_scrub[0].system,
                        role: 'admin'
                    })
                });
            }
        } catch (err) {
            dbg.warn('Chunks failed to rebuilt - skipping');
        }
        if (chunks_to_scrub.length) {
            await _load_chunk_mappings(chunks, tiering_status_by_bucket_id);
        }
    }

    return _.map(parts, part => {
        system_utils.prepare_chunk_for_mapping(part.chunk);
        const part_info = mapper.get_part_info(
            part, adminfo, tiering_status_by_bucket_id[part.chunk.bucket], location_info
        );
        if (set_obj) {
            part_info.obj = part.obj;
        }
        return part_info;
    });
}

async function _load_chunk_mappings(chunks, tiering_status_by_bucket_id) {
    const chunks_buckets = _.uniq(_.map(chunks, chunk => String(chunk.bucket)));
    return P.join(
        MDStore.instance().load_blocks_for_chunks(chunks),
        P.map(chunks_buckets, async bucket_id => {
            const bucket = system_store.data.get_by_id(bucket_id);
            if (!bucket) {
                console.error(`read_parts_mappings: Bucket ${bucket_id} does not exist`);
                return;
            }
            await node_allocator.refresh_tiering_alloc(bucket.tiering);
            tiering_status_by_bucket_id[bucket_id] = node_allocator.get_tiering_status(bucket.tiering);
        })
    );
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

// EXPORTS
exports.read_object_mappings = read_object_mappings;
exports.read_node_mappings = read_node_mappings;
