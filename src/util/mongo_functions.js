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
    map_size: map_size,
    map_aggregate_objects: map_aggregate_objects,
    map_key_with_prefix_delimiter: map_key_with_prefix_delimiter,
    reduce_sum: reduce_sum,
    reduce_noop: reduce_noop,
};

// declare names that these functions expect to have in scope
// so that lint tools will not give warnings.
let emit;
let prefix;
let delimiter;

function map_size() {
    /* jshint validthis: true */
    emit('size', this.size);
}

function map_aggregate_objects() {
    /* jshint validthis: true */
    emit(['', 'size'], this.size);
    emit(['', 'count'], 1);
    emit([this.bucket, 'size'], this.size);
    emit([this.bucket, 'count'], 1);
}


function map_key_with_prefix_delimiter() {
    /* jshint validthis: true */
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

function reduce_noop() {}
