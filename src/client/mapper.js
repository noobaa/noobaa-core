// this module is written for both nodejs, or for client with browserify.
'use strict';

var _ = require('lodash');
var Q = require('q');


module.exports = Mapper;


// mappings structure is decribed in object_api.get_object_mappings.reply
function Mapper(mappings) {
    this.mappings = mappings;
}



// iterate()
//
// handler - function(params) will be called for every iterated "block_set"
//    with the following params (object):
//    - blocks ... TODO
//    - block_sets - TODO
//
// return (promise)
//
Mapper.prototype.iterate = function(start, end, handler) {
    var self = this;
    return Q.all(_.map(self.mappings.parts, function(part) {
        return self.iterate_part(part, start, end, handler);
    }));
};

Mapper.prototype.iterate_part = function(part, start, end, handler) {
    var self = this;

    // get intersection of the part range with the iterated range.
    var iter_range = range_intersection(part.start, part.end, start, end);
    if (!iter_range) {
        return;
    }

    // the chunk offset is the part's offset in the data
    var chunk_offset = part.chunk_offset || 0;
    // chunk_start/end are offsets inside the part's chunk
    var chunk_start = chunk_offset + iter_range.start - part.start;
    var chunk_end = chunk_offset + part.end - iter_range.end;

    var kblocks = part.kblocks;
    var part_size = part.end - part.start;
    var block_size = (part_size / kblocks) | 0; // integer division

    var block_sets = [];
    return Q.all(_.map(part.blocks, function(block) {
        var bs = block_sets[block.index];
        if (bs) {
            // block_set already inited, just append to blocks list
            bs.blocks.push(block);
            return;
        }
        var block_start = block.index * block_size;
        // block_range is the
        var block_iter_range = range_intersection(
            chunk_start, chunk_end,
            block_start, block_start + block_size);
            /*
        bs = block_sets[block.index] = {
            block_range: block_range,
            blocks: [],
            promise: null,
            block_sets: block_sets,
        };
        if (rng) {
            return params.handler(bs);
        }
        */
    }));
};


function range_intersection(start1, end1, start2, end2) {
    var start = start1 > start2 ? start1 : start2;
    var end = end1 < end2 ? end1 : end2;
    return (end <= start) ? null : {
        start: start,
        end: end,
    };
}
