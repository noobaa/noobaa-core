// module targets: nodejs & browserify
'use strict';

var size_utils = require('./size_utils');

module.exports = {
    intersection: intersection,
    align_down: align_down,
    align_up: align_up,
    truncate_range_end_to_boundary: truncate_range_end_to_boundary,
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
 * align the given offset down with boundary
 * NOTE! cannot use javascript bitwise on offsets as it is limited to 32bits
 */
function align_down(offset, boundary) {
    return offset - (offset % boundary);
}


/**
 * align the given offset up with boundary
 * NOTE! cannot use javascript bitwise on offsets as it is limited to 32bits
 */
function align_up(offset, boundary) {
    return align_down(offset + boundary - 1, boundary);
}


/**
 * return the end of the range aligned down to the closest boundary
 * but only if such boundary exists between start and end.
 */
function truncate_range_end_to_boundary(start, end, boundary) {
    var new_end = align_down(end, boundary);
    return (new_end > start) ? new_end : end;
}

function human_range(range) {
    return '[ ' + size_utils.human_offset(range.start) +
        ' .. ' + size_utils.human_offset(range.end) + ' ]';
}
