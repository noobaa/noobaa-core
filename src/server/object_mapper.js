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
    get_object_mappings: get_object_mappings,
};

// default split of object to parts of 2^14 = 16 MB
var PART_SIZE_ALLOCATION_BITWISE = 14;

// default split of chunks with kblocks = 2^7 = 128
var CHUNK_KBLOCKS_BITWISE = 4; // TODO: make 7
var CHUNK_KBLOCKS = 1 << CHUNK_KBLOCKS_BITWISE;


// the main function of this module - get mappings, allocate if needed.
function get_object_mappings(obj, start, end) {
    // sanitizing start & end: we want them to be valid integers for the rest of the flow
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
        return {
            parts: []
        };
    }
    // use default part boundaries for proper allocation size for parts,
    // the reply will be adjusted using adjust_parts_to_range()
    var start_boundry = range_utils.align_down_bitwise(start, PART_SIZE_ALLOCATION_BITWISE);
    var end_boundry = range_utils.align_up_bitwise(end, PART_SIZE_ALLOCATION_BITWISE);
    if (obj.size < end_boundry) {
        end_boundry = obj.size;
    }

    // zis is ze flow:
    // we query to get existing parts, then create missing ones, then adjust the parts for reply.
    return Q.fcall(
        get_existing_parts, obj, start_boundry, end_boundry
    ).then(
        function(parts) {
            return allocate_missing_parts(obj, start_boundry, end_boundry, parts);
        }
    ).then(
        function(parts) {
            var reply_parts = adjust_parts_to_range(obj, start, end, parts);
            console.log('get_object_mappings', reply_parts);
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
    var parts, blocks;

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
            }).sort('start').populate('chunk').lean().exec();
        }
    ).then(
        function(parts_arg) {
            parts = parts_arg;
            // find all blocks of the resulting parts
            return DataBlock.find({
                chunk: {
                    $in: _.pluck(parts, '_id')
                }
            }).sort('index').populate('node').lean().exec();
        }
    ).then(
        function(blocks) {
            var blocks_by_chunk = _.groupBy(blocks, 'chunk');
            _.each(parts, function(part) {
                var blocks = blocks_by_chunk[part.chunk.id];
                part.indexes = _.groupBy(blocks, 'index');
                part.kblocks = part.chunk.kblocks;
                delete part.chunk;
            });
            console.log('get_existing_parts', parts);
            return parts;
        }
    );
}

// going over the parts (expected them to be sorted by start offset)
// and creating new parts where missing.
function allocate_missing_parts(obj, start, end, parts) {
    var pos = start;
    var allocs = {
        chunks: [],
        blocks: [],
        parts: [],
        promises: [],
    };

    var parts_and_new_parts = _.flatten(_.map(parts, function(part) {
        var part_range = range_utils.intersection(part.start, part.end, pos, end);
        // intersection may be empty if this part overlaps the previous parts
        // or if not relevant at all to the requested range
        if (!part_range) {
            // return empty array so that _.flatten will ignore
            console.log('PART DOESNT INTERSECT', part, pos, end);
            return [];
        }
        // use current part, but adjust the range to the intersection with current position
        part.chunk_offset += part_range.start - part.start;
        part.start = part_range.start;
        part.end = part_range.end;
        // create new parts if missing from pos to where current part starts
        var ret_parts = allocate_parts_for_range(obj, pos, part_range.start, allocs);
        // we want this _.map function to return both the allocated parts and the current part
        // se we add the current part and return a single array including all, and _.flatten
        // will reduce these to a single array.
        ret_parts.push(part);
        console.log('allocate_missing_parts', ret_parts);
        // advance pos to end of this range for next _.map loop
        pos = part_range.end;
        return ret_parts;
    }));
    if (pos < end) {
        var ret_parts = allocate_parts_for_range(obj, pos, end, allocs);
        _.each(ret_parts, parts_and_new_parts.push, parts_and_new_parts);
        console.log('allocate_missing_parts tail', ret_parts);
    }
    return Q.all(allocs.promises).
    then(
        function() {
            // first create the chunks
            console.log('create chunks', allocs.chunks);
            return DataChunk.create(allocs.chunks);
        }
    ).then(
        function() {
            // create the blocks pointing to the chunks
            console.log('create blocks', allocs.blocks);
            return DataBlock.create(allocs.blocks);
        }
    ).then(
        function() {
            // create the parts pointing to the chunks
            console.log('create parts', allocs.parts);
            return ObjectPart.create(allocs.parts);
        }
    ).then(
        function() {
            console.log('allocate_missing_parts', parts_and_new_parts);
            return parts_and_new_parts;
        }
    );
}

function allocate_parts_for_range(obj, start, end, allocs) {
    var new_parts = [];

    function add_allocs(new_part, new_chunk, new_blocks) {
        var new_part_lean = new_part.toObject();
        new_part_lean.indexes = _.groupBy(new_blocks, 'index');
        new_part_lean.kblocks = new_chunk.kblocks;
        delete new_part_lean.chunk;
        console.log('allocate_parts_for_range', new_part_lean);
        new_parts.push(new_part_lean);
        allocs.parts.push(new_part);
        allocs.chunks.push(new_chunk);
        _.each(new_blocks, allocs.blocks.push, allocs.blocks);
    }

    while (start < end) {
        var new_end = range_utils.truncate_range_end_to_boundary_bitwise(
            start, end, PART_SIZE_ALLOCATION_BITWISE);
        console.log('new_end', start, end, new_end);
        if (new_end <= start) {
            assert(new_end <= start, 'new_end <= start');
        }
        // chunk size is aligned up to be an integer multiple of kblocks*block_size
        var chunk_size = range_utils.align_up_bitwise(
            new_end - start, CHUNK_KBLOCKS_BITWISE);
        var new_chunk = new DataChunk({
            size: chunk_size,
            kblocks: CHUNK_KBLOCKS,
        });
        var new_part = new ObjectPart({
            obj: obj.id,
            start: start,
            end: new_end,
            chunk: new_chunk,
            // chunk_offset: 0, // not required
        });
        // allocate blocks for the chunk, returns a promise that we should
        // wait for it to complete, so add it to a list of promises for this allocation.
        var promise = block_allocator.allocate_blocks_for_new_chunk(new_chunk)
            .then(add_allocs.bind(null, new_part, new_chunk));
        allocs.promises.push(promise);
        start = new_end;
    }
    return new_parts;
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
