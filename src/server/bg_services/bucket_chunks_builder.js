/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const dbg = require('../../util/debug_module')(__filename);


/**
 *
 * BucketChunksBuilder 
 *
 * - iterate in batches from start_marker to end_marker and call build_chunks_func on each batch
 * - each run_batch call will return success\failure with the list of chunk_ids processed in this batch
 * - the marker for next batch is always advancing regardless of the success\failure of current batch
 *   failures should be handled by the user of this class
 * 
 * start_marker is optional - if not given starts from the beginning.
 * end_marker is optional - if not given the iteration will continue forever
 *
 */
class BucketChunksBuilder {

    constructor({ iterate_chunks_func, build_chunks_func, start_marker, end_marker }) {
        this.build_chunks_func = build_chunks_func;
        this.iterate_chunks_func = iterate_chunks_func;
        // this.marker is last chunk that was processed (regadless of success\failure)
        // start_marker is optional
        this.marker = start_marker;
        this.end_marker = end_marker; // optional end marker for iteration
        dbg.log0(`Created new BucketChunksBuilder. start marker [${this.marker}]. failure marker [${this.failure_marker}]`);
    }

    // run iteration for given buckets array. buckets can change between iterations
    async run_batch(buckets) {
        let res = { successful: true, chunk_ids: [] };
        if (!buckets || !buckets.length) {
            return res;
        }
        if (this.marker) {
            dbg.log1('Bucket chunks builder: looking for chunks to mirror. starting from', this.marker);
        } else {
            dbg.log0('Bucket chunks builder: marker not set. starting from beginning');
        }

        try {
            const { marker, chunk_ids } = await this.iterate_chunks_func(this.marker, this.end_marker, buckets);
            res.chunk_ids = chunk_ids;
            if (!marker) {
                // no more chunks for specified range. if end_marker is specified return done.
                if (!_.isUndefined(this.end_marker)) {
                    res.done = true;
                }
                return res;
            }

            // we advance marker regardless of the build_chunks result. 
            // if build chunks fails error is reported to caller
            this.marker = marker;
            await this.build_chunks_func(chunk_ids);
        } catch (err) {
            dbg.error('run_batch failed with error:', err);
            res.successful = false;
        }
        return res;
    }

    get_start_marker() {
        return this.marker;
    }

    get_end_marker() {
        return this.end_marker;
    }

    get_chunks_range() {
        return {
            start: this.get_start_marker(),
            end: this.get_end_marker()
        };
    }

}


exports.BucketChunksBuilder = BucketChunksBuilder;
