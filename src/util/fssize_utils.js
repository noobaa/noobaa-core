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
    clone: clone,
    is_equal: is_equal,
    add_bytes: add_bytes,
    reduce_sum: reduce_sum,
};

var GB = 1024 * 1024 * 1024;

function init(b, gb) {
    var fssize = {};
    while (b >= GB) {
        b -= GB;
        gb += 1;
    }
    while (b <= -GB) {
        b += GB;
        gb -= 1;
    }
    if (gb) {
        fssize.gb = gb;
    }
    if (b) {
        fssize.b = b;
    }
    return fssize;
}

function clone(fssize) {
    return init(fssize.b, fssize.gb);
}

function is_equal(fssize1, fssize2) {
    return (fssize1.b === fssize2.b && fssize1.gb === fssize2.gb);
}

function add_bytes(fssize, bytes) {
    return init({
        b: (fssize.b || 0) + bytes,
        gb: fssize.gb
    });
}

// a map-reduce part for summing up
// this function must be self contained to be able to send to mongo mapReduce()
// so not using any functions or constants from above.
function reduce_sum(key, values) {
    var GB = 1073741824;
    var b = 0;
    var gb = 0;
    values.forEach(function(v) {
        if (typeof(v) === 'number') {
            b += v;
        } else {
            b += v.b;
            gb += v.gb;
        }
        while (b >= GB) {
            b -= GB;
            gb += 1;
        }
    });
    return {
        b: b,
        gb: gb,
    };
}
