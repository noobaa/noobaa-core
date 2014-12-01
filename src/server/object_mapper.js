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
};

// default split of chunks with kfrag
var CHUNK_KFRAG_BITWISE = 0; // TODO: pick kfrag?
var CHUNK_KFRAG = 1 << CHUNK_KFRAG_BITWISE;


function allocate_object_part(obj, start, end, md5sum) {
    // chunk size is aligned up to be an integer multiple of kfrag*block_size
    var chunk_size = range_utils.align_up_bitwise(
        end - start,
        CHUNK_KFRAG_BITWISE
    );
    var new_chunk = new db.DataChunk({
        size: chunk_size,
        kfrag: CHUNK_KFRAG,
        md5sum: md5sum,
    });
    var new_part = new db.ObjectPart({
        account: obj.account,
        obj: obj.id,
        start: start,
        end: end,
        chunk: new_chunk,
        // chunk_offset: 0, // not required
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
            // console.log('part info', part_info);
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
            return db.ObjectPart.find({
                obj: obj.id,
                start: {
                    $lt: end
                },
                end: {
                    $gt: start
                },
            }).sort('start').populate('chunk').exec();
        })
        .then(function(parts_arg) {
            parts = parts_arg;

            // find all blocks of the resulting parts
            return db.DataBlock.find({
                chunk: {
                    $in: _.pluck(parts, 'chunk')
                }
            }).sort('fragment').populate('node').exec();
        })
        .then(function(blocks) {
            var blocks_by_chunk = _.groupBy(blocks, 'chunk');
            var parts_reply = _.map(parts, function(part) {
                var blocks = blocks_by_chunk[part.chunk.id];
                return get_part_info(part, part.chunk, blocks);
            });
            // console.log('get_existing_parts', parts_reply);
            return parts_reply;
        });
}


// chunk is optional
function get_part_info(part, chunk, blocks) {
    var fragments = [];
    _.each(_.groupBy(blocks, 'fragment'), function(fragment_blocks, fragment) {
        fragments[fragment] = _.map(fragment_blocks, function(block) {
            var b = _.pick(block, 'id');
            b.node = _.pick(block.node, 'id', 'ip', 'port');
            return b;
        });
    });
    var p = _.pick(part, 'start', 'end', 'chunk_offset');
    p.fragments = fragments;
    p.kfrag = chunk.kfrag;
    p.md5sum = chunk.md5sum;
    p.chunk_size = chunk.size;
    p.chunk_offset = p.chunk_offset || 0;
    return p;
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
