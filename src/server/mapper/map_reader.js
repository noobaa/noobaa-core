'use strict';

module.exports = {
    read_object_mappings: read_object_mappings,
    read_node_mappings: read_node_mappings,
};

var _ = require('lodash');
var P = require('../../util/promise');
var db = require('../db');
var map_utils = require('./map_utils');
var system_store = require('../stores/system_store');
var nodes_store = require('../stores/nodes_store');
var mongo_utils = require('../../util/mongo_utils');
var dbg = require('../../util/debug_module')(__filename);
var config = require('../../../config.js');



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
            return db.ObjectPart.collection.find({
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
        .then(parts => mongo_utils.populate(parts, 'chunk', db.DataChunk))
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
 * @params: node, skip, limit
 */
function read_node_mappings(params) {
    var objects = {};
    var parts_per_obj_id = {};

    return P.fcall(function() {
            return db.DataBlock.collection.find({
                node: params.node._id,
                deleted: null,
            }, {
                sort: '-_id',
                skip: params.skip || 0,
                limit: params.limit || 0
            }).toArray();
        })
        .then(function(blocks) {
            dbg.warn('read_node_mappings: SLOW QUERY',
                'ObjectPart.find(chunk $in array).',
                'adding chunk index?');
            return db.ObjectPart.collection.find({
                chunk: {
                    $in: mongo_utils.uniq_ids(blocks, 'chunk')
                },
                deleted: null,
            }).toArray();
        })
        .then(parts => P.join(
            mongo_utils.populate(parts, 'chunk', db.DataChunk),
            mongo_utils.populate(parts, 'obj', db.ObjectMD)
        ).return(parts))
        .then(function(parts) {
            return read_parts_mappings({
                parts: parts,
                set_obj: true,
                adminfo: true
            });
        })
        .then(function(parts) {
            objects = {};
            parts_per_obj_id = _.groupBy(parts, function(part) {
                var obj = part.obj;
                delete part.obj;
                objects[obj._id] = obj;
                return obj._id;
            });

            return _.map(objects, function(obj, obj_id) {
                return {
                    key: obj.key,
                    bucket: system_store.data.get_by_id(obj.bucket).name,
                    parts: parts_per_obj_id[obj_id]
                };
            });
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
    return P.when(db.DataBlock.collection.find({
            chunk: {
                $in: chunk_ids
            },
            deleted: null,
        }, {
            sort: 'frag'
        }).toArray())
        .then(blocks => nodes_store.populate_nodes_for_map(blocks, 'node'))
        .then(blocks => {
            var blocks_by_chunk = _.groupBy(blocks, 'chunk');
            return _.map(params.parts, part => {
                // console.log('GGG part', require('util').inspect(part, {
                //     depth: null
                // }), require('util').inspect(blocks_by_chunk[part.chunk._id], {
                //     depth: null
                // }));
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
