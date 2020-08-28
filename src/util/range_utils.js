/* Copyright (C) 2016 NooBaa */
// module targets: nodejs & browserify
'use strict';

module.exports = {
    intersection: intersection,
    dedup_ranges: dedup_ranges,
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
 * deduplicated sorted ranges.
 *
 * For example,
 * if sorted_ranges is [ { start: 1, end: 5 }, { start: 1, end: 5 } ],
 * return [ { start: 1, end: 5 } ]
 *
 * if sorted_ranges is [ { start: 1, end: 5 }, { start: 3, end: 18 }, { start: 15, end: 25} ],
 * return [ { start: 1, end: 5 }, { start: 5, end: 18 }, { start: 18, end: 25 } ]
 *
 * if sorted_ranges is [ { start: 1, end: 5 }, { start: 3, end: 10 }, { start: 5, end: 30 },
 *                       { start: 15, end: 25}, { start: 28, end: 40 } ]
 * return [ { start: 1, end: 5 }, { start: 5, end: 10 }, { start: 10, end: 30 }, { start: 30, end: 40 } ]
 *
 * @param {Array<{ start: number, end: number }>} sorted_ranges
 * @returns {Array<{ start: number, end: number }>}
 */
function dedup_ranges(sorted_ranges) {
    if (sorted_ranges.length < 2) return sorted_ranges;

    const ret = [sorted_ranges[0]];
    let p = sorted_ranges[0];
    for (let i = 1; i < sorted_ranges.length; i++) {
        const p1 = sorted_ranges[i];
        const intersect = intersection(p.start, p.end, p1.start, p1.end);
        if (intersect) {
            if (intersect.end === p.end && intersect.end < p1.end) {
                p = {
                   start: intersect.end,
                   end: p1.end,
                };
                ret.push(p);
             }
        } else {
            ret.push(p1);
        }
    }

    return ret;
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
    return `[ ${range.start} .. ${range.end} ]`;
}
