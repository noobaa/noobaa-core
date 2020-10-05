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


// declare names that these functions expect to have in scope
// so that lint tools will not give warnings.
let emit = (key, value) => value;
let prefix = '';
let delimiter = '';

/**
 * @this mongodb doc being mapped
 * The function maps the common prefixes.
 * In case of common prefix it will emit it's key with value 1.
 * In case of an object it will emit the object key with the object itself.
 */
function map_common_prefixes() {
    var suffix = this.key.slice(prefix.length);
    var pos = suffix.indexOf(delimiter);
    if (pos >= 0) {
        emit([suffix.slice(0, pos + 1), 'common_prefix'], 1);
    } else {
        emit([suffix, this._id], this);
    }
}

/**
 * Reduce function of the common prefixes map.
 * In case of common prefix it will return the key and the number of occurrences.
 * In case of an object it will return the object's details.
 */
function reduce_common_prefixes(key, values) {
    if (key[1] === 'common_prefix') {
        // For common prefixes we count the number of objects that were emitted on that prefix
        // This count is not really used, so we could also just return 1, but we count it anyway.
        var count = 0;
        for (var i = 0; i < values.length; ++i) count += values[i];
        return count;
    } else {
        // Objects are uniquely emitted with their _id, so we do not expect multiple values.
        // Actually mongo should not even call us when there is a single emitted value to reduce,
        // so this code is here just for completeness.
        return values[0];
    }
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
    emit([this.bucket, 'content_type', this.content_type, 'count'], 1);
    emit([this.bucket, 'content_type', this.content_type, 'size'], this.size);
}

/**
 * @this mongodb doc being mapped
 */
function map_aggregate_chunks() {
    const compress_size = this.compress_size || this.size;
    emit(['', 'compress_size'], compress_size);
    emit([this.bucket, 'compress_size'], compress_size);
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

const func_stats_exports = (function() {
    // The following vars are defined here in order to simulate scope variables inside
    // the map/reduce/finalize function below and prevent lint errors.
    let step;
    let max_samples;
    let percentiles = [];

    /**
     * @this mongodb doc being mapped
     */
    function map() {
        const key = Math.floor(this.time.valueOf() / step) * step;
        const res = this.error ? {
            invoked: 1,
            fulfilled: 0,
            rejected: 1,
            aggr_response_time: 0,
            max_response_time: 0,
            completed_response_times: []
        } : {
            invoked: 1,
            fulfilled: 1,
            rejected: 0,
            aggr_response_time: this.took,
            max_response_time: this.took,
            completed_response_times: [this.took]
        };

        emit(-1, res);
        emit(key, res);
    }

    function reduce(key, values) {
        const reduced = values.reduce((bin, other) => {
            bin.invoked += other.invoked;
            bin.fulfilled += other.fulfilled;
            bin.rejected += other.rejected;
            bin.aggr_response_time += other.aggr_response_time;
            bin.max_response_time = Math.max(
                bin.max_response_time,
                other.max_response_time
            );
            bin.completed_response_times = [
                ...bin.completed_response_times,
                ...other.completed_response_times
            ];

            return bin;
        });

        // Reduce the sample size to max_samples
        const response_times = reduced.completed_response_times;
        if (response_times.length > max_samples) {
            reduced.completed_response_times = Array.from({ length: max_samples },
                () => response_times[
                    Math.floor(Math.random() * response_times.length)
                ]
            );
        }

        return reduced;
    }

    function finalize(key, bin) {
        const response_times = bin.completed_response_times
            .sort((a, b) => a - b);

        return {
            invoked: bin.invoked,
            fulfilled: bin.fulfilled,
            rejected: bin.rejected,
            max_response_time: bin.max_response_time,
            aggr_response_time: bin.aggr_response_time,
            avg_response_time: bin.fulfilled > 0 ?
                Math.round(bin.aggr_response_time / bin.fulfilled) : 0,
            response_percentiles: percentiles.map(percentile => {
                const index = Math.floor(response_times.length * percentile);
                const value = response_times[index] || 0;
                return { percentile, value };
            })
        };
    }

    return { map, reduce, finalize };
}());

module.exports = {
    map_aggregate_objects: map_aggregate_objects,
    map_aggregate_chunks: map_aggregate_chunks,
    map_aggregate_blocks: map_aggregate_blocks,
    map_key_with_prefix_delimiter: map_key_with_prefix_delimiter,
    reduce_sum: reduce_sum,
    reduce_noop: reduce_noop,
    map_common_prefixes: map_common_prefixes,
    reduce_common_prefixes: reduce_common_prefixes,
    map_func_stats: func_stats_exports.map,
    reduce_func_stats: func_stats_exports.reduce,
    finalize_func_stats: func_stats_exports.finalize
};
