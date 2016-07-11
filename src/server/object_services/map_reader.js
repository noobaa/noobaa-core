'use strict';

const _ = require('lodash');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config.js');
const map_utils = require('./map_utils');
const mongo_utils = require('../../util/mongo_utils');
const md_store = require('./md_store');
const nodes_client = require('../node_services/nodes_client');
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
    var rng = map_utils.sanitize_object_range(params.obj, params.start, params.end);
    if (!rng) { // empty range
        return [];
    }
    var start = rng.start;
    var end = rng.end;

    return P.fcall(function() {
            // find parts intersecting the [start,end) range
            return md_store.ObjectPart.collection.find({
                obj: params.obj._id,
                start: {
                    // since end is not indexed we query start with both
                    // low and high constraint, which allows the index to reduce scan
                    // we use a constant that limits the max part size because
                    // this is the only way to limit the minimal start value
                    $gte: start - config.MAX_OBJECT_PART_SIZE,
                    $lt: end,
                },
                end: {
                    $gt: start
                },
                deleted: null,
            }, {
                sort: 'start',
                skip: params.skip || 0,
                limit: params.limit || 0
            }).toArray();
        })
        .then(parts => mongo_utils.populate(parts, 'chunk', md_store.DataChunk))
        .then(function(parts) {
            return read_parts_mappings({
                parts: parts,
                adminfo: params.adminfo
            });
        });
}


/**
 *
 * read_node_mappings
 *
 * @params: node_id, skip, limit
 */
function read_node_mappings(params) {
    return P.resolve()
        .then(() => md_store.DataBlock.collection.find({
            system: params.system._id,
            node: mongo_utils.make_object_id(params.node_id),
            deleted: null,
        }, {
            sort: {
                _id: -1
            },
            skip: params.skip || 0,
            limit: params.limit || 0
        }).toArray())
        .then(blocks => {
            dbg.warn('read_node_mappings: SLOW QUERY',
                'ObjectPart.find(chunk $in array).',
                'adding chunk index?');
            return md_store.ObjectPart.collection.find({
                chunk: {
                    $in: mongo_utils.uniq_ids(blocks, 'chunk')
                },
                deleted: null,
            }).toArray();
        })
        .then(parts => P.join(
            mongo_utils.populate(parts, 'chunk', md_store.DataChunk),
            mongo_utils.populate(parts, 'obj', md_store.ObjectMD)
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
            const objects_reply = _.map(objects_by_id, (obj, obj_id) => {
                return {
                    key: obj.key,
                    bucket: system_store.data.get_by_id(obj.bucket).name,
                    parts: parts_per_obj_id[obj_id]
                };
            });
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
    var chunks = _.map(params.parts, 'chunk');
    var chunk_ids = mongo_utils.uniq_ids(chunks, '_id');

    // find all blocks of the resulting parts
    return P.resolve(md_store.DataBlock.collection.find({
            chunk: {
                $in: chunk_ids
            },
            deleted: null,
        }, {
            sort: 'frag'
        }).toArray())
        .then(blocks => nodes_client.instance().populate_nodes_for_map(
            blocks[0] && blocks[0].system, blocks, 'node'))
        .then(blocks => {
            var blocks_by_chunk = _.groupBy(blocks, 'chunk');
            return _.map(params.parts, part => {
                // console.log('GGG part',
                //     require('util').inspect(part, {
                //         depth: null
                //     }),
                //     require('util').inspect(blocks_by_chunk[part.chunk._id], {
                //         depth: null
                //     }));
                map_utils.set_chunk_frags_from_blocks(
                    part.chunk, blocks_by_chunk[part.chunk._id]);
                let part_info = map_utils.get_part_info(part, params.adminfo);
                if (params.set_obj) {
                    part_info.obj = part.obj;
                }
                return part_info;
            });
        });
}


// EXPORTS
exports.read_object_mappings = read_object_mappings;
exports.read_node_mappings = read_node_mappings;
