/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const P = require('../../util/promise');
// const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config.js');
const mapper = require('./mapper');
const MDStore = require('./md_store').MDStore;
const node_allocator = require('../node_services/node_allocator');
const system_store = require('../system_services/system_store').get_instance();
const system_utils = require('../utils/system_utils');


/**
 *
 * read_object_mappings
 *
 * query the db for existing parts and blocks which intersect the requested range,
 * return the blocks inside each part (part.fragments) like the api format
 * to make it ready for replying and simpler to iterate
 *
 */
function read_object_mappings(obj, start, end, skip, limit, adminfo) {
    // check for empty range
    const rng = sanitize_object_range(obj, start, end);
    if (!rng) return P.resolve([]);

    // find parts intersecting the [start,end) range
    return MDStore.instance().find_parts_by_start_range({
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
        })
        .then(parts => MDStore.instance().populate_chunks_for_parts(parts))
        .then(parts => read_parts_mappings(parts, adminfo));
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
        .then(parts => read_parts_mappings(parts, true, true))
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
function read_parts_mappings(parts, adminfo, set_obj) {
    const chunks = _.map(parts, 'chunk');
    const chunks_buckets = _.uniq(_.map(chunks, chunk => String(chunk.bucket)));
    const tiering_status_by_bucket_id = {};
    return P.join(
            MDStore.instance().load_blocks_for_chunks(chunks),
            adminfo && P.map(chunks_buckets, bucket_id => {
                const bucket = system_store.data.get_by_id(bucket_id);
                if (!bucket) {
                    console.error(`read_parts_mappings: Bucket ${bucket_id} does not exist`);
                    return P.resolve();
                }

                return node_allocator.refresh_tiering_alloc(bucket.tiering)
                    .then(() => {
                        tiering_status_by_bucket_id[bucket_id] =
                            node_allocator.get_tiering_status(bucket.tiering);
                    });
            })
        )
        .then(() => _.map(parts, part => {
            system_utils.populate_pools_for_blocks(part.chunk.blocks);
            part.chunk.chunk_coder_config = system_store.data.get_by_id(part.chunk.chunk_config).chunk_coder_config;
            const part_info = mapper.get_part_info(
                part, adminfo, tiering_status_by_bucket_id[part.chunk.bucket]
            );
            if (set_obj) {
                part_info.obj = part.obj;
            }
            return part_info;
        }));
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
