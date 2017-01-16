/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const P = require('../../util/promise');
// const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config.js');
const MDStore = require('./md_store').MDStore;
const map_utils = require('./map_utils');
const mongo_utils = require('../../util/mongo_utils');
const system_store = require('../system_services/system_store').get_instance();


/**
 *
 * read_object_mappings
 *
 * query the db for existing parts and blocks which intersect the requested range,
 * return the blocks inside each part (part.fragments) like the api format
 * to make it ready for replying and simpler to iterate
 *
 * @params: obj, start, end, skip, limit
 */
function read_object_mappings(params) {
    // check for empty range
    const rng = map_utils.sanitize_object_range(params.obj, params.start, params.end);
    if (!rng) return P.resolve([]);

    // find parts intersecting the [start,end) range
    return MDStore.instance().find_parts_by_start_range({
            obj_id: params.obj._id,
            // since end is not indexed we query start with both
            // low and high constraint, which allows the index to reduce scan
            // we use a constant that limits the max part size because
            // this is the only way to limit the minimal start value
            start_gte: rng.start - config.MAX_OBJECT_PART_SIZE,
            start_lt: rng.end,
            end_gt: rng.start,
            skip: params.skip,
            limit: params.limit,
        })
        .then(parts => MDStore.instance().populate_chunks_for_parts(parts))
        .then(parts => read_parts_mappings({
            parts: parts,
            adminfo: params.adminfo
        }));
}


/**
 *
 * read_node_mappings
 *
 * @params: node_id, skip, limit
 */
function read_node_mappings(params) {
    return MDStore.instance().iterate_node_chunks({
            node_id: mongo_utils.make_object_id(params.node_id),
            skip: params.skip || 0,
            limit: params.limit || 0,
        })
        .then(res => MDStore.instance().find_parts_by_chunk_ids(res.chunk_ids))
        .then(parts => P.join(
            MDStore.instance().populate_chunks_for_parts(parts),
            MDStore.instance().populate_objects(parts, 'obj')
        ).return(parts))
        .then(parts => read_parts_mappings({
            parts: parts,
            set_obj: true,
            adminfo: true
        }))
        .then(parts => {
            const objects_by_id = {};
            const parts_per_obj_id = _.groupBy(parts, part => {
                var obj = part.obj;
                delete part.obj;
                objects_by_id[obj._id] = obj;
                return obj._id;
            });
            const objects_reply = _.map(objects_by_id, (obj, obj_id) => ({
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
function read_parts_mappings(params) {
    const chunks = _.map(params.parts, 'chunk');
    return P.resolve()
        .then(() => MDStore.instance().load_blocks_for_chunks(chunks))
        .then(() => _.map(params.parts, part => {
            map_utils.set_chunk_frags_from_blocks(part.chunk, part.chunk.blocks);
            let part_info = map_utils.get_part_info(part, params.adminfo);
            if (params.set_obj) {
                part_info.obj = part.obj;
            }
            return part_info;
        }));
}


// EXPORTS
exports.read_object_mappings = read_object_mappings;
exports.read_node_mappings = read_node_mappings;
