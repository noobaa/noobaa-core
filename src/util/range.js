// this module is written for both nodejs, or for client with browserify.
'use strict';

var _ = require('lodash');

module.exports = {
    intersection: intersection,
};

function intersection(start1, end1, start2, end2) {
    var start = start1 > start2 ? start1 : start2;
    var end = end1 < end2 ? end1 : end2;
    return (end <= start) ? null : {
        start: start,
        end: end,
    };
}
