/* Copyright (C) 2016 NooBaa */
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

const MAX_UINT32 = 256 * 256 * 256 * 256; // 4 times 8-bit

const SIZE_UNITS = ['', 'K', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y'];

const SOTRAGE_OBJ_KEYS = [
    'total',
    'used',
    'used_other',
    // 'used_reduced',
    'free',
    'reserved',
    'unavailable_free',
    'unavailable_used',
    'limit',
    'alloc',
    'real',
];

BigInteger.PETABYTE = new BigInteger(PETABYTE);

// We are overriding BigInteger.prototype.toJSON to make sure that JSON.stringify({ size: bigint }) will behave nicely
// however BigInteger creates 3 prototypes internally (Integer, SmallInteger, BigInteger)
// and writes the 'toJSON' property explicitly for all of them, we have to overwrite all 3.
const IntegerPrototype = BigInteger.prototype;
const BigIntegerPrototype = Object.getPrototypeOf(BigInteger.PETABYTE.multiply(BigInteger.PETABYTE));
const SmallIntegerPrototype = Object.getPrototypeOf(BigInteger.zero);
IntegerPrototype.toJSON = bigint_to_json_method;
BigIntegerPrototype.toJSON = bigint_to_json_method;
SmallIntegerPrototype.toJSON = bigint_to_json_method;

/**
 * @this {BigInteger}
 */
function bigint_to_json_method() {
    return bigint_to_json(this);
}

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


function to_storage_bigint(storage) {
    return _.mapValues(storage, x => json_to_bigint(x));
}

/* Help function taken from frontent - This function, if passed a size object, will convert the object to a non exact
 * integer representation of the size object. A difference may happen for sizes above
 * Number.MAX_SAFE_INTEGER because of the inability of floating point numbers to
 * represent very big numbers.
 */
function bigint_to_bytes(bigint) {
    const peta = _.isUndefined(bigint.peta) ? 0 : bigint.peta;
    const n = _.isUndefined(bigint.n) ? bigint : bigint.n;
    return (peta * PETABYTE) + n;
}

/**
 * convert size number with floating point to BigInt based on unit.
 * @param {number} size - size number with floating point.
 * @param {string} unit - supported units: PETABYTE, TERABYTE, GIGABYTE
 * @returns {BigInt}
 */
function size_unit_to_bigint(size, unit) {
    if (size === 0) {
        return BigInt(0);
    }

    let big;
    if (unit === 'P') {
        big = BigInt(PETABYTE);
    } else if (unit === 'T') {
        big = BigInt(TERABYTE);
    } else if (unit === 'G') {
        big = BigInt(GIGABYTE);
    }

    /**
     * Convert floating point if exists to BigInt.
     * Count the number of digits in decimal part.
     * Remove floating point an convert the number to BigInt.
     * Devide the BigInt number by number of digits.
     * Result for instance:
     * 1.2536G = 1346042750.5664 Bytes
     * int = 1; decimalLength = 4
     * BigInt(12536) * GIGABYTE / 10^4 = 1346042750n Bytes
     */
    const splittedSize = size.toString().split(".");
    const int = BigInt(splittedSize[0] + (splittedSize[1] ? splittedSize[1] : ""));
    const decimalLength = (splittedSize[1] ? splittedSize[1].length : 0);
    const multiplier = 10n ** BigInt(decimalLength);
    return (int * big) / multiplier;
}

/**
 * mult_factor & div_factor must be positive integers.
 */
function reduce_storage(reducer, storage_items, mult_factor, div_factor) {
    let accumulator = _.reduce(storage_items,
        (acc, item) => {
            _.each(SOTRAGE_OBJ_KEYS, key => {
                if (item && !_.isUndefined(item[key])) {
                    acc[key].push(item[key]);
                }
            });
            return acc;
        },
        make_object(SOTRAGE_OBJ_KEYS, key => []));

    return _.reduce(accumulator,
        (storage, values, key) => {
            if (!_.isEmpty(values)) {
                // reduce the values using the provided reducer (sum/min)
                const reduced_value = reducer(key, values);
                // using BigInteger to calculate the factors
                const factored_value = json_to_bigint(reduced_value)
                    .multiply(_.isUndefined(mult_factor) ? 1 : mult_factor)
                    .divide(_.isUndefined(div_factor) ? 1 : div_factor);
                // convert back to json for json schemas (rpc/db)
                storage[key] = bigint_to_json(factored_value);
            }
            return storage;
        }, {});
}

// returns the sum of 2 bigints in json format
function sum_bigint_json(a, b) {
    const bigint_a = json_to_bigint(a);
    const bigint_b = json_to_bigint(b);
    return bigint_a.plus(bigint_b).toJSON();
}


function size_min(values) {
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

function size_max(values) {
    var n_max = 0;
    var peta_max = 0;
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

        if (peta > peta_max || (peta === peta_max && n > n_max)) {
            n_max = n;
            peta_max = peta;
        }
    });
    return peta_max ? {
        n: n_max,
        peta: peta_max,
    } : n_max;
}


function reduce_minimum(key, values) {
    return size_min(values);
}


function reduce_maximum(key, values) {
    return size_max(values);
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
 * @param offset integer or {peta,n} object
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
        i += 1;
    } while (n);

    i = 5;
    while (peta) {
        mod = peta % 1024;
        res = mod + SIZE_UNITS[i] + '.' + res;
        peta = Math.floor(peta / 1024);
        i += 1;
    }

    return sign + res || '0';
}


exports.BigInteger = BigInteger;
exports.bigint_to_json = bigint_to_json;
exports.bigint_to_bytes = bigint_to_bytes;
exports.json_to_bigint = json_to_bigint;
exports.size_unit_to_bigint = size_unit_to_bigint;
exports.to_bigint_storage = to_bigint_storage;
exports.to_storage_bigint = to_storage_bigint;
exports.reduce_storage = reduce_storage;
exports.sum_bigint_json = sum_bigint_json;
exports.size_min = size_min;
exports.size_max = size_max;
exports.reduce_minimum = reduce_minimum;
exports.reduce_maximum = reduce_maximum;
exports.reduce_sum = mongo_functions.reduce_sum;
exports.human_size = human_size;
exports.human_offset = human_offset;
exports.KILOBYTE = KILOBYTE;
exports.MEGABYTE = MEGABYTE;
exports.GIGABYTE = GIGABYTE;
exports.TERABYTE = TERABYTE;
exports.PETABYTE = PETABYTE;
exports.MAX_UINT32 = MAX_UINT32;
