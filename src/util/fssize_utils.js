// module targets: nodejs & browserify
'use strict';

var _ = require('lodash');

/**
 * functions to handle big storage sizes that don't fit into single integer
 * fssize is an object of the form
 * { b: number, gb: number }
 */

module.exports = {
    init: init,
    is_equal: is_equal,
    clone: clone,
    reduce_sum: reduce_sum,
};

function init(b, gb) {
    return {
        b: b,
        gb: gb,
    };
}

function clone(x) {
    var res = {};
    if (x.b) {
        res.b = x.b;
    }
    if (x.gb) {
        res.gb = x.gb;
    }
    return res;
}

function is_equal(x, y) {
    return (x.b === y.b && x.gb === y.gb);
}


// a map-reduce part for summing up
function reduce_sum(key, values) {
    var GB = 1073741824;
    var b = 0;
    var gb = 0;
    values.forEach(function(v) {
        if (typeof(v) === 'number') {
            while (v > GB) {
                v -= GB;
                gb += 1;
            }
            b += v;
        } else {
            b += v.b;
            gb += v.gb;
        }
    });
    return {
        b: b,
        gb: gb,
    };
}
