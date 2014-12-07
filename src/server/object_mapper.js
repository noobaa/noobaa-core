/* jshint node:true */
'use strict';

var _ = require('lodash');
var Q = require('q');
var assert = require('assert');
var db = require('./db');
var range_utils = require('../util/range_utils');
var block_allocator = require('./block_allocator');

module.exports = {
    allocate_object_part: allocate_object_part,
    read_object_mappings: read_object_mappings,
    bad_block_in_part: bad_block_in_part,
};

// default split of chunks with kfrag
var CHUNK_KFRAG_BITWISE = 0; // TODO: pick kfrag?
var CHUNK_KFRAG = 1 << CHUNK_KFRAG_BITWISE;


function allocate_object_part(bucket, obj, start, end, chunk_size, crypt) {
    // chunk size is aligned up to be an integer multiple of kfrag*block_size
    chunk_size = range_utils.align_up_bitwise(chunk_size, CHUNK_KFRAG_BITWISE);

    if (!bucket.tiering || bucket.tiering.length !== 1) {
        throw new Error('only single tier supported per bucket/chunk');
    }

    var new_chunk = new db.DataChunk({
        system: obj.system,
        tier: bucket.tiering[0].tier,
        size: chunk_size,
        kfrag: CHUNK_KFRAG,
        crypt: crypt,
    });
    var new_part = new db.ObjectPart({
        system: obj.system,
        obj: obj.id,
        start: start,
        end: end,
        chunks: [{
            chunk: new_chunk,
            // chunk_offset: 0, // not required
        }]
    });
    var part_info;

    return Q.fcall(function() {
            // console.log('create chunk', new_chunk);
            return db.DataChunk.create(new_chunk);
        })
        .then(function() {
            // console.log('allocate_blocks_for_new_chunk');
            return block_allocator.allocate_blocks_for_new_chunk(new_chunk);
        })
        .then(function(new_blocks) {
            // console.log('create blocks', new_blocks);
            part_info = get_part_info(new_part, new_chunk, new_blocks);
            return db.DataBlock.create(new_blocks);
        })
        .then(function() {
            // console.log('create part', new_part);
            return db.ObjectPart.create(new_part);
        })
        .then(function() {
            console.log('part info', part_info);
            return part_info;
        });

}


// query the db for existing parts and blocks which intersect the requested range,
// return the blocks inside each part (part.fragments) like the api format
// to make it ready for replying and simpler to iterate
function read_object_mappings(obj, start, end) {
    var rng = sanitize_object_range(obj, start, end);
    if (!rng) { // empty range
        return [];
    }
    start = rng.start;
    end = rng.end;
    var parts;

    return Q.fcall(function() {

            // find parts intersecting the [start,end) range
            return db.ObjectPart
                .find({
                    obj: obj.id,
                    start: {
                        $lt: end
                    },
                    end: {
                        $gt: start
                    },
                })
                .sort('start')
                .populate('chunks.chunk')
                .exec();
        })
        .then(function(parts_arg) {
            parts = parts_arg;

            var chunks = _.pluck(_.flatten(_.map(parts, 'chunks')), 'chunk');
            var chunk_ids = _.pluck(chunks, 'id');

            // find all blocks of the resulting parts
            return db.DataBlock
                .find({
                    chunk: {
                        $in: chunk_ids
                    },
                    deleted: null,
                })
                .sort('fragment')
                .populate('node')
                .exec();
        })
        .then(function(blocks) {
            var blocks_by_chunk = _.groupBy(blocks, 'chunk');
            var parts_reply = _.map(parts, function(part) {
                if (!part.chunks || part.chunks.length !== 1) {
                    throw new Error('only single tier supported per bucket/chunk');
                }
                var chunk = part.chunks[0].chunk;
                var blocks = blocks_by_chunk[chunk.id];
                return get_part_info(part, chunk, blocks);
            });
            // console.log('get_existing_parts', parts_reply);
            return parts_reply;
        });
}


function bad_block_in_part(obj, start, end, fragment, block_id, is_write) {
    return Q.all([
            db.DataBlock.findById(block_id).exec(),
            db.ObjectPart.findOne({
                system: obj.system,
                obj: obj.id,
                start: start,
                end: end,
            })
            .populate('chunks.chunk')
            .exec(),
        ])
        .spread(function(block, part) {
            if (!part || !part.chunks || !part.chunks[0] || !part.chunks[0].chunk) {
                console.error('bad block - invalid part/chunk', block, part);
                throw new Error('invalid bad block request');
            }
            var chunk = part.chunks[0].chunk;
            if (!block || block.fragment !== fragment ||
                String(block.chunk) !== String(chunk.id)) {
                console.error('bad block - invalid block', block, part);
                throw new Error('invalid bad block request');
            }

            if (is_write) {
                var new_block;

                return block_allocator.reallocate_bad_block(chunk, block)
                    .then(function(new_block_arg) {
                        new_block = new_block_arg;
                        return db.DataBlock.create(new_block);
                    })
                    .then(function() {
                        return get_block_info(new_block);
                    });

            } else {
                // TODO mark the block as bad for next reads and decide when to trigger rebuild
            }

        });
}


// chunk is optional
function get_part_info(part, chunk, blocks) {
    var fragments = [];
    _.each(_.groupBy(blocks, 'fragment'), function(fragment_blocks, fragment) {
        fragments[fragment] = _.map(fragment_blocks, get_block_info);
    });
    var p = _.pick(part, 'start', 'end', 'chunk_offset');
    p.fragments = fragments;
    p.kfrag = chunk.kfrag;
    p.crypt = _.pick(chunk.crypt, 'hash_type', 'hash_val', 'cipher_type', 'cipher_val');
    p.chunk_size = chunk.size;
    p.chunk_offset = p.chunk_offset || 0;
    return p;
}

function get_block_info(block) {
    var b = _.pick(block, 'id');
    b.node = _.pick(block.node, 'id', 'ip', 'port');
    return b;
}


// sanitizing start & end: we want them to be integers, positive, up to obj.size.
function sanitize_object_range(obj, start, end) {
    // truncate end to the actual object size
    if (obj.size < end) {
        end = obj.size;
    }
    // force integers
    start = start | 0;
    end = end | 0;
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
