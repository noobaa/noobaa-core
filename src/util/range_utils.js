// this module is written for both nodejs, or for client with browserify.
'use strict';

var _ = require('lodash');

module.exports = {
    intersection: intersection,
    align_down_bitwise: align_down_bitwise,
    align_up_bitwise: align_up_bitwise,
    truncate_range_end_to_boundary_bitwise: truncate_range_end_to_boundary_bitwise,
};

function intersection(start1, end1, start2, end2) {
    var start = start1 > start2 ? start1 : start2;
    var end = end1 < end2 ? end1 : end2;
    return (end <= start) ? null : {
        start: start,
        end: end,
    };
}

function align_down_bitwise(offset, nbits) {
    var mask_up = ((~0) >>> nbits << nbits);
    return offset & mask_up;
}

function align_up_bitwise(offset, nbits) {
    var mask_up = ((~0) >>> nbits << nbits);
    var size = (1 << nbits);
    return (offset + size - 1) & mask_up;
}

function truncate_range_end_to_boundary_bitwise(start, end, nbits) {
    var new_end = align_down_bitwise(end, nbits);
    return (new_end > start) ? new_end : end;
}
