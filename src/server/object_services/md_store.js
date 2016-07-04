'use strict';

const _ = require('lodash');
const mongodb = require('mongodb');

const P = require('../../util/promise');
const ObjectMD = require('./schemas/object_md');
const ObjectPart = require('./schemas/object_part');
const DataChunk = require('./schemas/data_chunk');
const DataBlock = require('./schemas/data_block');
const map_utils = require('./map_utils');
const nodes_client = require('../node_services/nodes_client');
const mongo_utils = require('../../util/mongo_utils');
const mongo_functions = require('../../util/mongo_functions');
// const dbg = require('../../util/debug_module')(__filename);


/**
 *
 * aggregate_objects
 *
 * counts the number of objects and sum of sizes, both for the entire query, and per bucket.
 *
 * @return <Object> buckets - the '' key represents the entire query and others are bucket ids.
 *      each bucket value is an object with properties: size, count.
 *
 */
function aggregate_objects(query) {
    return ObjectMD.mapReduce({
        query: query,
        map: mongo_functions.map_aggregate_objects,
        reduce: mongo_functions.reduce_sum
    }).then(function(res) {
        var buckets = {};
        _.each(res, function(r) {
            var b = buckets[r._id[0]] = buckets[r._id[0]] || {};
            b[r._id[1]] = r.value;
        });
        return buckets;
    });
}

function load_chunks_by_digest(bucket, digest_list) {
    let chunks;
    return P.resolve(DataChunk.collection.find({
            system: bucket.system._id,
            bucket: bucket._id,
            digest_b64: {
                $in: digest_list
            },
            deleted: null,
            building: null
        }, {
            sort: {
                _id: -1 // get newer chunks first
            }
        }).toArray())
        .then(res => {
            chunks = res;
            return load_blocks_for_chunks(chunks);
        })
        .then(blocks => {
            let chunks_by_digest = _.groupBy(chunks, chunk => chunk.digest_b64);
            return chunks_by_digest;
        });
}


function load_blocks_for_chunks(chunks) {
    if (!chunks || !chunks.length) return;
    return P.resolve(DataBlock.collection.find({
            chunk: {
                $in: mongo_utils.uniq_ids(chunks, '_id')
            },
            deleted: null,
        }).toArray())
        .then(blocks => nodes_client.instance().populate_nodes_for_map(
            blocks[0] && blocks[0].system, blocks, 'node'))
        .then(blocks => {
            // remove from the list blocks that their node is not found
            // and consider these blocks just like deleted blocks
            let orphan_blocks = _.remove(blocks,
                block => !block.node || !block.node._id);
            if (orphan_blocks.length) {
                console.log('ORPHAN BLOCKS (ignoring)', orphan_blocks);
            }
            let blocks_by_chunk = _.groupBy(blocks, 'chunk');
            _.each(chunks, chunk => {
                chunk.blocks = blocks_by_chunk[chunk._id];
            });
        });
}

function load_parts_objects_for_chunks(chunks) {
    let parts;
    let objects;
    if (!chunks || !chunks.length) return;
    return P.resolve(ObjectPart.collection.find({
            chunk: {
                $in: mongo_utils.uniq_ids(chunks, '_id')
            },
            deleted: null,
        }).toArray())
        .then(res_parts => {
            parts = res_parts;
            return ObjectMD.collection.find({
                _id: {
                    $in: mongo_utils.uniq_ids(res_parts, 'obj')
                },
                deleted: null,
            }).toArray();
        })
        .then(res_objects => {
            objects = res_objects;
            return P.resolve(map_utils.analyze_special_chunks(chunks, parts, objects));
        });
}

function make_md_id(id_str) {
    return new mongodb.ObjectId(id_str);
}

// EXPORTS
exports.ObjectMD = ObjectMD;
exports.ObjectPart = ObjectPart;
exports.DataChunk = DataChunk;
exports.DataBlock = DataBlock;
exports.aggregate_objects = aggregate_objects;
exports.load_chunks_by_digest = load_chunks_by_digest;
exports.load_blocks_for_chunks = load_blocks_for_chunks;
exports.load_parts_objects_for_chunks = load_parts_objects_for_chunks;
exports.make_md_id = make_md_id;
