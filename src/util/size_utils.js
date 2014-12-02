// module targets: nodejs & browserify
'use strict';

var _ = require('lodash');

/**
 * functions to handle storage sizes that might not fit into single integer
 * supports either a single number;
 *      which might have a floating point fraction and therefore not completely accurate,
 * or an object for big sizes with structure -
 *  { n: bytes, peta: petabytes }
 */

var KILOBYTE = 1024;
var MEGABYTE = 1024 * KILOBYTE;
var GIGABYTE = 1024 * MEGABYTE;
var PETABYTE = 1024 * GIGABYTE;
var EXABYTE = {
    peta: 1024
};
var ZETABYTE = {
    peta: 1024 * EXABYTE.peta
};
var YOTABYTE = {
    peta: 1024 * ZETABYTE.peta
};

// cant do 1<<32 because javascript bitwise is limited to 32 bits
var MAX_UINT32 = (1 << 16) * (1 << 16);

var SIZE_UNITS = ['', 'K', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y'];


module.exports = {
    reduce_sum: reduce_sum,
    human_size: human_size,
    KILOBYTE: KILOBYTE,
    MEGABYTE: MEGABYTE,
    GIGABYTE: GIGABYTE,
    PETABYTE: PETABYTE,
    EXABYTE: EXABYTE,
    ZETABYTE: ZETABYTE,
    YOTABYTE: YOTABYTE,
};



// a map-reduce part for summing up
// this function must be self contained to be able to send to mongo mapReduce()
// so not using any functions or constants from above.
function reduce_sum(key, values) {
    var PETABYTE = 1024 * 1024 * 1024 * 1024 * 1024;
    var n = 0;
    var peta = 0;
    values.forEach(function(v) {
        if (typeof(v) === 'number') {
            n += v;
        } else {
            n += v.n;
            peta += v.peta;
        }
        while (n >= PETABYTE) {
            n -= PETABYTE;
            peta += 1;
        }
    });
    return !peta ? n : {
        n: n,
        peta: peta,
    };
}


/**
 * return a formatted string for the given size such as 12 KB or 130.5 GB.
 * supports either numbers or an object for big sizes with structure -
 *  { n: bytes, peta: petabytes }
 */
function human_size(bytes) {
    var x;
    var i = 0;
    if (typeof(bytes) === 'object') {
        if (bytes.peta) {
            x = bytes.peta;
            i = 5;
        } else {
            x = bytes.n;
        }
    } else {
        x = Number(bytes);
    }
    if (isNaN(x)) {
        return '';
    }
    while (x >= 1024 && i + 1 < SIZE_UNITS.length) {
        i += 1;
        x /= 1024;
    }
    if (i === 0) {
        return x.toString() + ' B';
    } else {
        return x.toFixed(1) + ' ' + SIZE_UNITS[i] + 'B';
    }
}
