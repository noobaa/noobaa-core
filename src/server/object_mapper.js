/* jshint node:true */
'use strict';

var _ = require('lodash');
var Q = require('q');
var assert = require('assert');
var ObjectPart = require('./models/object_part');
var DataChunk = require('./models/data_chunk');
var DataBlock = require('./models/data_block');
var range_utils = require('../util/range_utils');
var block_allocator = require('./block_allocator');

module.exports = {
    allocate_object_part: allocate_object_part,
    read_object_mappings: read_object_mappings,
};

// default split of object to parts of 2^14 = 16 MB
var PART_SIZE_ALLOCATION_BITWISE = 14;

// default split of chunks with kblocks = 2^7 = 128
var CHUNK_KBLOCKS_BITWISE = 1; // TODO: make 7
var CHUNK_KBLOCKS = 1 << CHUNK_KBLOCKS_BITWISE;


function allocate_object_part(obj, start, end, md5sum) {
    // chunk size is aligned up to be an integer multiple of kblocks*block_size
    var chunk_size = range_utils.align_up_bitwise(
        end - start,
        CHUNK_KBLOCKS_BITWISE
    );
    var new_chunk = new DataChunk({
        size: chunk_size,
        kblocks: CHUNK_KBLOCKS,
        md5sum: md5sum,
    });
    var new_part = new ObjectPart({
        obj: obj.id,
        start: start,
        end: end,
        chunk: new_chunk,
        // chunk_offset: 0, // not required
    });
    var part_info;

    return Q.fcall(
        function() {
            // console.log('create chunk', new_chunk);
            return DataChunk.create(new_chunk);
        }
    ).then(
        function() {
            // console.log('allocate_blocks_for_new_chunk');
            return block_allocator.allocate_blocks_for_new_chunk(new_chunk);
        }
    ).then(
        function(new_blocks) {
            // console.log('create blocks', new_blocks);
            part_info = get_part_info(new_part, new_chunk, new_blocks);
            return DataBlock.create(new_blocks);
        }
    ).then(
        function() {
            // console.log('create part', new_part);
            return ObjectPart.create(new_part);
        }
    ).then(
        function() {
            // console.log('part info', part_info);
            return part_info;
        }
    );

}


function read_object_mappings(obj, start, end) {
    var rng = sanitize_object_range(obj, start, end);
    if (!rng) { // empty range
        return {
            parts: []
        };
    }

    return Q.fcall(get_existing_parts, obj, rng.start, rng.end).then(
        function(parts) {
            var reply_parts = adjust_parts_to_range(
                obj, rng.start, rng.end, parts);
            // console.log('read_object_mappings', reply_parts);
            return {
                parts: reply_parts
            };
        }
    );
}


// query the db for existing parts and blocks which intersect the requested range,
// return the blocks inside each part (part.indexes) like the api format
// to make it ready for replying and simpler to iterate
function get_existing_parts(obj, start, end) {
    var parts;

    return Q.fcall(
        function() {
            // find parts intersecting the [start,end) range
            return ObjectPart.find({
                obj: obj.id,
                start: {
                    $lt: end
                },
                end: {
                    $gt: start
                },
            }).sort('start').populate('chunk').exec();
        }
    ).then(
        function(parts_arg) {
            parts = parts_arg;
            // find all blocks of the resulting parts
            return DataBlock.find({
                chunk: {
                    $in: _.pluck(parts, 'chunk')
                }
            }).sort('index').populate('node').exec();
        }
    ).then(
        function(blocks) {
            var blocks_by_chunk = _.groupBy(blocks, 'chunk');
            var parts_reply = _.map(parts, function(part) {
                var blocks = blocks_by_chunk[part.chunk.id];
                return get_part_info(part, part.chunk, blocks);
            });
            // console.log('get_existing_parts', parts_reply);
            return parts_reply;
        }
    );
}



function adjust_parts_to_range(obj, start, end, parts) {
    var pos = start;
    return _.flatten(_.map(parts, function(part) {
        var part_range = range_utils.intersection(part.start, part.end, pos, end);
        if (!part_range) {
            return [];
        }
        part.chunk_offset += part_range.start - part.start;
        part.start = part_range.start;
        part.end = part_range.end;
        pos = part_range.end;
        return part;
    }));
}

// chunk is optional
function get_part_info(part, chunk, blocks) {
    var indexes = [];
    _.each(_.groupBy(blocks, 'index'), function(index_blocks, index) {
        indexes[index] = _.map(index_blocks, function(block) {
            var b = _.pick(block, 'id');
            b.node = _.pick(block.node, 'id', 'ip', 'port');
            return b;
        });
    });
    var p = _.pick(part, 'start', 'end', 'chunk_offset');
    p.indexes = indexes;
    p.kblocks = chunk.kblocks;
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
