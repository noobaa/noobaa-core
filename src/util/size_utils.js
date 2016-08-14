// module targets: nodejs & browserify
'use strict';

const _ = require('lodash');
const BigInteger = require('big-integer');
const make_object = require('./js_utils').make_object;
const mongo_functions = require('./mongo_functions');

/**
 * functions to handle storage sizes that might not fit into single integer
 * supports either a single number;
 *      which might have a floating point fraction and therefore not completely accurate,
 * or an object for big sizes with structure -
 *  { n: bytes, peta: petabytes }
 */

const KILOBYTE = 1024;
const MEGABYTE = 1024 * KILOBYTE;
const GIGABYTE = 1024 * MEGABYTE;
const TERABYTE = 1024 * GIGABYTE;
const PETABYTE = 1024 * TERABYTE;

// cant do 1<<32 because javascript bitwise is limited to 32 bits
const MAX_UINT32 = (1 << 16) * (1 << 16);

const SIZE_UNITS = ['', 'K', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y'];

const SOTRAGE_OBJ_KEYS = [
    'total',
    'used',
    'used_other',
    // 'used_reduced',
    'free',
    'reserved',
    'unavailable_free',
    'limit',
    'alloc',
    'real',
];

BigInteger.PETABYTE = new BigInteger(PETABYTE);

BigInteger.prototype.toJSON = function() {
    return bigint_to_json(this);
};

/**
 * take a BigInteger object and convert to json {peta:.., n: ..} format if needed
 */
function bigint_to_json(bi) {
    const dm = bi.divmod(BigInteger.PETABYTE);
    const peta = dm.quotient.toJSNumber();
    const n = dm.remainder.toJSNumber();
    return peta ? {
        n: n,
        peta: peta,
    } : n;
}

/**
 * take a json format {peta:.., n: ..} and convert to BigInteger
 */
function json_to_bigint(x) {
    var n = 0;
    var peta = 0;
    if (x && typeof(x) === 'object' && 'n' in x && 'peta' in x) {
        n = Math.floor(x.n) || 0;
        peta = Math.floor(x.peta) || 0;
    } else {
        n = Math.floor(Number(x)) || 0;
    }
    return new BigInteger(peta)
        .multiply(BigInteger.PETABYTE)
        .add(new BigInteger(n));
}

/**
 * For every key in the storage object parse as json number, and return to json
 *
 * This is needed specifically to enforce that the format
 * of the numbers will be always be consistent.
 */
function to_bigint_storage(storage) {
    return _.mapValues(storage, x => bigint_to_json(json_to_bigint(x)));
}

/**
 * mult_factor & div_factor must be positive integers.
 */
function reduce_storage(reducer, storage_items, mult_factor, div_factor) {
    let accumulator = _.reduce(storage_items,
        (accumulator, item) => {
            _.each(SOTRAGE_OBJ_KEYS, key => item && item[key] && accumulator[key].push(item[key]));
            return accumulator;
        },
        make_object(SOTRAGE_OBJ_KEYS, key => []));

    return _.reduce(accumulator,
        (storage, values, key) => {
            if (!_.isEmpty(values)) {
                // reduce the values using the provided reducer (sum/min)
                const reduced_value = reducer(key, values);
                // using BigInteger to calculate the factors
                const factored_value = json_to_bigint(reduced_value)
                    .multiply(mult_factor)
                    .divide(div_factor);
                // convert back to json for json schemas (rpc/db)
                storage[key] = bigint_to_json(factored_value);
            }
            return storage;
        }, {});
}


// a map-reduce part for finding the minimum value
// this function must be self contained to be able to send to mongo mapReduce()
// so not using any functions or constants from above.
function reduce_minimum(key, values) {
    var PETABYTE = 1024 * 1024 * 1024 * 1024 * 1024;
    var n_min = PETABYTE;
    var peta_min = 100000;
    values.forEach(function(v) {
        var n = 0;
        var peta = 0;
        if (typeof(v) === 'number') {
            n = v;
        } else if (v) {
            n = v.n;
            peta = v.peta;
        }
        while (n >= PETABYTE) {
            n -= PETABYTE;
            peta += 1;
        }

        if (peta < peta_min || (peta === peta_min && n < n_min)) {
            n_min = n;
            peta_min = peta;
        }
    });
    return peta_min ? {
        n: n_min,
        peta: peta_min,
    } : n_min;
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
            x = bytes.peta + (bytes.n / PETABYTE);
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
    } else if (x < 99) {
        // precision formatting applied for 2 digits numbers for fraction rounding up/down.
        // NOTE: for some reason Number(99.5).toPrecision(2) returns '1.0e+2'
        // which we don't want, so we only use precision formating below 99
        return x.toPrecision(2) + ' ' + SIZE_UNITS[i] + 'B';
    } else {
        // fixed formatting truncates the fraction part which is negligible for 3 digit numbers
        return x.toFixed(0) + ' ' + SIZE_UNITS[i] + 'B';
    }
}


/**
 *
 * human_offset
 *
 * @param offset - must be integer
 *
 */
function human_offset(offset) {
    var res = '';
    var sign = '';
    var i;
    var n;
    var peta;
    var mod;

    if (typeof(offset) === 'object') {
        peta = offset.peta;
        n = offset.n;
        sign = '';
    } else {
        peta = 0;
        n = offset;
    }

    if (n < 0) {
        n = -n;
        sign = '-';
    }

    // always include the lowest offset unit
    i = 0;
    do {
        mod = n % 1024;
        if (res) {
            res = mod + SIZE_UNITS[i] + '.' + res;
        } else if (mod) {
            res = mod + SIZE_UNITS[i];
        }
        n = Math.floor(n / 1024);
        i++;
    } while (n);

    i = 5;
    while (peta) {
        mod = peta % 1024;
        res = mod + SIZE_UNITS[i] + '.' + res;
        peta = Math.floor(peta / 1024);
        i++;
    }

    return sign + res || '0';
}


exports.BigInteger = BigInteger;
exports.bigint_to_json = bigint_to_json;
exports.json_to_bigint = json_to_bigint;
exports.to_bigint_storage = to_bigint_storage;
exports.reduce_storage = reduce_storage;
exports.reduce_minimum = reduce_minimum;
exports.reduce_sum = mongo_functions.reduce_sum;
exports.human_size = human_size;
exports.human_offset = human_offset;
exports.KILOBYTE = KILOBYTE;
exports.MEGABYTE = MEGABYTE;
exports.GIGABYTE = GIGABYTE;
exports.TERABYTE = TERABYTE;
exports.PETABYTE = PETABYTE;
exports.MAX_UINT32 = MAX_UINT32;
