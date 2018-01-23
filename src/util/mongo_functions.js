/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 *
 * this module exists to collect all the functions that are
 * serialized and sent to mongodb.
 *
 * The reason they need to be collected in a module is that
 * when running coverage (istanbul) it injects statements into the code
 * which gets serialized as well and breaks the mongodb execution
 * with ReferenceError.
 *
 * This file is excluded from the coverage code injection in package.json.
 *
 */

module.exports = {
    map_aggregate_objects: map_aggregate_objects,
    map_aggregate_chunks: map_aggregate_chunks,
    map_aggregate_blocks: map_aggregate_blocks,
    map_key_with_prefix_delimiter: map_key_with_prefix_delimiter,
    reduce_sum: reduce_sum,
    reduce_noop: reduce_noop,
    map_common_prefixes_and_objects: map_common_prefixes_and_objects,
    reduce_common_prefixes_occurrence_and_objects: reduce_common_prefixes_occurrence_and_objects
};

// declare names that these functions expect to have in scope
// so that lint tools will not give warnings.
let emit;
let prefix;
let delimiter;

/**
 * @this mongodb doc being mapped
 */
// The function maps the common prefixes.
// In case of common prefix it will emit it's key with value 1.
// In case of an object it will emit the object key with the object itself.
function map_common_prefixes_and_objects() {
    var suffix = this.key.slice(prefix.length);
    var pos = suffix.indexOf(delimiter);
    if (pos >= 0) {
        emit([suffix.slice(0, pos + 1)], 1);
    } else {
        emit([suffix, this._id], this);
    }
}

// Reduce function of the common prefixes map.
// In case of common prefix it will return the key and the number of occurrences.
// In case of an object it will return the object's details.
function reduce_common_prefixes_occurrence_and_objects(key, values) {
    if (values.length > 1) {
        return values.reduce(function(total, curr) {
            return total + curr;
        }, 0);
    }
    return values[0];
}

/**
 * @this mongodb doc being mapped
 */
function map_aggregate_objects() {
    emit(['', 'size'], this.size);
    emit(['', 'count'], 1);
    emit([this.bucket, 'size'], this.size);
    emit([this.bucket, 'count'], 1);

    // map for histogram calcs - emit the size and count with a key that is the log2 of the size
    var pow = 0;
    if (this.size > 1) {
        pow = Math.ceil(Math.log2(this.size));
    }
    emit([this.bucket, 'count_pow2_' + pow], 1);
    emit([this.bucket, 'size_pow2_' + pow], this.size);
}

/**
 * @this mongodb doc being mapped
 */
function map_aggregate_chunks() {
    emit(['', 'compress_size'], this.compress_size);
    emit([this.bucket, 'compress_size'], this.compress_size);
}

/**
 * @this mongodb doc being mapped
 */
function map_aggregate_blocks() {
    emit(['total', ''], this.size);
    emit(['bucket', this.bucket], this.size);
    emit(['bucket_and_pool', this.bucket, this.pool], this.size);
    emit(['pool', this.pool], this.size);
}

/**
 * @this mongodb doc being mapped
 */
function map_key_with_prefix_delimiter() {
    var suffix = this.key.slice(prefix.length);
    var pos = suffix.indexOf(delimiter);
    if (pos >= 0) {
        emit(suffix.slice(0, pos), undefined);
    }
}



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
        } else if (v) {
            n += v.n;
            peta += v.peta;
        }
        while (n >= PETABYTE) {
            n -= PETABYTE;
            peta += 1;
        }
    });
    return peta ? {
        n: n,
        peta: peta,
    } : n;
}

function reduce_noop() { /* Empty Func */ }
