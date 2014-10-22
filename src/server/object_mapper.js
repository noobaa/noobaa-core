/* jshint node:true */
'use strict';

var _ = require('lodash');
var Q = require('q');
var ObjectPart = require('./models/object_part');
var DataChunk = require('./models/data_chunk');
var DataBlock = require('./models/data_block');
var range_utils = require('../util/range_utils');
var block_allocator = require('./block_allocator');

module.exports = {
    get_object_mappings: get_object_mappings,
};


function get_object_mappings(obj, start, end) {
    // sanitizing start & end:
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

    // start the flow
    return Q.fcall(get_existing_parts, obj, start, end)
        .then(function(parts) {
            return allocate_missing_parts(obj, start, end, parts);
        })
        .then(function(parts) {
            return allocate_missing_blocks(obj, start, end, parts);
        })
        .then(function(parts) {
            console.log('get_object_mappings', parts);
            return {
                parts: parts
            };
        });
}

// returns existing parts and their blocks which intersect with the requested range
function get_existing_parts(obj, start, end) {
    var parts, blocks;

    return Q.fcall(function() {
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
        })
        .then(function(parts_arg) {
            parts = parts_arg;
            // find all blocks of the resulting parts
            return DataBlock.find({
                chunk: {
                    $in: _.pluck(parts, '_id')
                }
            }).sort('index').populate('node').lean().exec();
        })
        .then(function(blocks) {
            var blocks_by_chunk = _.groupBy(blocks, 'chunk');
            _.each(parts, function(part) {
                var blocks = blocks_by_chunk[part.chunk.id];
                part.indexes = _.groupBy(blocks, 'index');
                part.nblocks = part.chunk.nblocks;
                delete part.chunk;
            });
            console.log('get_existing_parts', parts);
            return parts;
        });
}

var PART_SIZE_ALLOCATION_BITWISE = 14; // 16 MB
var CHUNK_NBLOCKS_BITWISE = 7;
var CHUNK_NBLOCKS = 1 << CHUNK_NBLOCKS_BITWISE; // 128

function allocate_missing_parts(obj, start, end, parts) {
    // going over the parts (expected them to be sorted by start offset)
    var pos = start;
    var chunks_to_create = [];
    var blocks_to_create = [];
    var new_parts_to_create = [];
    var parts_and_new_parts = _.flatten(_.map(parts, function(part) {
        var part_range = range_utils.intersection(part.start, part.end, pos, end);
        if (!part_range) {
            // intersection may be empty if this part overlaps the previous parts
            // or if not relevant at all to the requested range
            console.log('PART DOESNT INTERSECT', part, pos, end);
            // return empty array so that _.flatten will ignore
            return [];
        }
        // use current part, but adjust the range to the intersection with current position
        part.chunk_offset = part.chunk_offset + part_range.start - part.start;
        part.start = part_range.start;
        part.end = part_range.end;
        // add new parts to be created
        var new_parts = allocate_parts_for_range(
            obj, pos, part_range.start,
            new_parts_to_create,
            chunks_to_create,
            blocks_to_create);
        // add current part
        new_parts.push(part);
        console.log('allocate_missing_parts', new_parts);
        // advance pos to end of this range and go on
        pos = part_range.end;
        return new_parts;
    }));
    if (pos < end) {
        var new_parts = allocate_parts_for_range(
            obj, pos, end,
            new_parts_to_create,
            chunks_to_create,
            blocks_to_create);
        _.each(new_parts, parts_and_new_parts.push, parts_and_new_parts);
        console.log('allocate_missing_parts tail', new_parts);
    }
    return Q.fcall(function() {
            // first create the chunks
            console.log('chunks_to_create', chunks_to_create);
            return DataChunk.create(chunks_to_create);
        })
        .then(function() {
            // create the blocks pointing to the chunks
            console.log('blocks_to_create', blocks_to_create);
            return DataBlock.create(blocks_to_create);
        })
        .then(function() {
            // create the parts pointing to the chunks
            console.log('new_parts_to_create', new_parts_to_create);
            return ObjectPart.create(new_parts_to_create);
        })
        .then(function() {
            console.log('allocate_missing_parts', parts_and_new_parts);
            return parts_and_new_parts;
        });
}

function allocate_parts_for_range(
    obj, start, end, new_parts_to_create, chunks_to_create, blocks_to_create) {
    var new_parts = [];

    while (start < end) {
        var new_end = range_utils.truncate_range_end_to_boundary_bitwise(
            start, end, PART_SIZE_ALLOCATION_BITWISE);
        console.log('new_end', start, end, new_end);
        if (new_end <= start) {
            process.exit(1);
        }
        // chunk size is aligned up to be an integer multiple of kblocks*block_size
        var chunk_size = range_utils.align_up_bitwise(
            new_end - start, CHUNK_NBLOCKS_BITWISE);
        var new_chunk = new DataChunk({
            size: chunk_size,
            kblocks: CHUNK_NBLOCKS,
        });
        var new_part = new ObjectPart({
            obj: obj.id,
            start: start,
            end: new_end,
            chunk: new_chunk,
            // chunk_offset: 0, // not required
        });

        // TODO - fix here - allocate returns promise!!!
        // TODO - fix here - allocate returns promise!!!
        // TODO - fix here - allocate returns promise!!!
        var new_blocks = block_allocator.allocate_blocks_for_new_chunk(new_chunk);
        // TODO - fix here - allocate returns promise!!!
        // TODO - fix here - allocate returns promise!!!
        // TODO - fix here - allocate returns promise!!!

        var new_part_lean = new_part.toObject();
        new_part_lean.indexes = _.groupBy(new_blocks, 'index');
        new_part_lean.nblocks = new_chunk.nblocks;
        delete new_part_lean.chunk;
        console.log('allocate_parts_for_range', new_part_lean);
        new_parts.push(new_part_lean);
        new_parts_to_create.push(new_part);
        chunks_to_create.push(new_chunk);
        _.each(new_blocks, blocks_to_create.push, blocks_to_create);
        start = new_end;
    }
    return new_parts;
}

function allocate_missing_blocks(obj, start, end, parts) {
    // TODO
    return parts;
}
