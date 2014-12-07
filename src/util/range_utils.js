// module targets: nodejs & browserify
'use strict';

var _ = require('lodash');
var size_utils = require('./size_utils');

module.exports = {
    intersection: intersection,
    align_down_bitwise: align_down_bitwise,
    align_up_bitwise: align_up_bitwise,
    truncate_range_end_to_boundary_bitwise: truncate_range_end_to_boundary_bitwise,
    human_range: human_range,
};


/**
 * find the intersection between two ranges
 */
function intersection(start1, end1, start2, end2) {
    var start = start1 > start2 ? start1 : start2;
    var end = end1 < end2 ? end1 : end2;
    return (end <= start) ? null : {
        start: start,
        end: end,
    };
}


/**
 * align the given offset down with boundary 1<<nbits
 */
function align_down_bitwise(offset, nbits) {
    var mask_up = ((~0) >>> nbits << nbits);
    return offset & mask_up;
}


/**
 * align the given offset up with boundary 1<<nbits
 */
function align_up_bitwise(offset, nbits) {
    var mask_up = ((~0) >>> nbits << nbits);
    var size = (1 << nbits);
    return (offset + size - 1) & mask_up;
}


/**
 * return the end of the range aligned down to the closest boundary of 1<<nbits
 * but only if such boundary exists between start and end.
 */
function truncate_range_end_to_boundary_bitwise(start, end, nbits) {
    var new_end = align_down_bitwise(end, nbits);
    return (new_end > start) ? new_end : end;
}

function human_range(range) {
    return '[ ' + size_utils.human_offset(range.start) +
        ' .. ' + size_utils.human_offset(range.end) + ' ]';
}
