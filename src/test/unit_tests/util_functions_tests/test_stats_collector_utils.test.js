/* Copyright (C) 2026 NooBaa */
'use strict';

const { update_nsfs_stats, op_names } = require('../../../util/stats_collector_utils');

/** @param {Record<string, unknown>} entry */
function expect_finite_timing(entry) {
    for (const field of ['min_time_milisec', 'max_time_milisec', 'avg_time_milisec']) {
        expect(entry[field]).not.toBeNull();
        expect(entry[field]).not.toBeUndefined();
        expect(Number.isFinite(entry[field])).toBe(true);
    }
}

describe('stats_collector_utils.update_nsfs_stats', () => {

    it('does not create stats for an error-only initial batch', () => {
        const op_name = 'upload_object';
        expect(op_names).toContain(op_name);
        const stats = {};
        update_nsfs_stats(op_name, stats, {
            count: 1,
            error_count: 1,
            min_time: undefined,
            max_time: undefined,
            sum_time: undefined,
        });
        expect(stats[op_name]).toBeUndefined();
    });

    it('initializes timing from a successful-only batch', () => {
        const op_name = 'create_bucket';
        expect(op_names).toContain(op_name);
        const stats = {};
        update_nsfs_stats(op_name, stats, {
            count: 2,
            error_count: 0,
            min_time: 10,
            max_time: 50,
            sum_time: 60,
        });
        expect(stats[op_name]).toEqual({
            min_time_milisec: 10,
            max_time_milisec: 50,
            avg_time_milisec: 30, // (min_time + max_time) / 2
            count: 2,
            error_count: 0,
        });
        expect_finite_timing(stats[op_name]);
    });

    it('initializes timing from a mixed batch using successful-op count only', () => {
        const op_name = 'list_objects';
        expect(op_names).toContain(op_name);
        const stats = {};
        update_nsfs_stats(op_name, stats, {
            count: 3,
            error_count: 1,
            min_time: 10,
            max_time: 50,
            sum_time: 80,
        });
        expect(stats[op_name]).toEqual({
            min_time_milisec: 10,
            max_time_milisec: 50,
            avg_time_milisec: 40, // (sum_time / (count - error_count))
            count: 3,
            error_count: 1,
        });
        expect_finite_timing(stats[op_name]);
    });

    it('keeps timing metrics when merging an error-only batch after successes', () => {
        const op_name = 'create_bucket';
        expect(op_names).toContain(op_name);
        const stats = {};

        //initial batch with successful ops
        update_nsfs_stats(op_name, stats, {
            count: 2,
            error_count: 0,
            min_time: 10,
            max_time: 50,
            sum_time: 60,
        });

        //error-only batch - should not update the stats
        update_nsfs_stats(op_name, stats, {
            count: 1,
            error_count: 1,
            min_time: undefined,
            max_time: undefined,
            sum_time: undefined,
        });

        expect(stats[op_name]).toEqual({
            min_time_milisec: 10,
            max_time_milisec: 50,
            avg_time_milisec: 30,
            count: 3,
            error_count: 1,
        });
        expect_finite_timing(stats[op_name]);
    });

    it('merges successive successful batches with a weighted average', () => {
        const op_name = 'head_object';
        expect(op_names).toContain(op_name);
        const stats = {};

        //initial batch with successful ops
        update_nsfs_stats(op_name, stats, {
            count: 2,
            error_count: 0,
            min_time: 10,
            max_time: 50,
            sum_time: 60,
        });

        //second batch with successful ops
        update_nsfs_stats(op_name, stats, {
            count: 1,
            error_count: 0,
            min_time: 15,
            max_time: 20,
            sum_time: 20,
        });

        expect(stats[op_name]).toEqual({
            min_time_milisec: 10,
            max_time_milisec: 50,
            avg_time_milisec: 26, // ((sum_time of initial batch + sum_time of second batch) / (count of initial batch + count of second batch))
            count: 3,
            error_count: 0,
        });
        expect_finite_timing(stats[op_name]);
    });

    it('merges a mixed batch into existing stats without NaN timing fields', () => {
        const op_name = 'read_object';
        expect(op_names).toContain(op_name);
        const stats = {};
        update_nsfs_stats(op_name, stats, {
            count: 2,
            error_count: 0,
            min_time: 10,
            max_time: 50,
            sum_time: 60,
        });
        update_nsfs_stats(op_name, stats, {
            count: 2,
            error_count: 1,
            min_time: 5,
            max_time: 100,
            sum_time: 100,
        });

        expect(stats[op_name]).toEqual({
            min_time_milisec: 5,
            max_time_milisec: 100,
            avg_time_milisec: 53, // ((sum_time of initial batch + sum_time of second batch) / (count of initial batch + count of second batch))
            count: 4,
            error_count: 1,
        });
        expect_finite_timing(stats[op_name]);
    });

    it('treats undefined sum_time in error-only batches as zero when recomputing average', () => {
        const op_name = 'delete_object';
        expect(op_names).toContain(op_name);
        const stats = {};
        update_nsfs_stats(op_name, stats, {
            count: 1,
            error_count: 0,
            min_time: 100,
            max_time: 100,
            sum_time: 100,
        });
        update_nsfs_stats(op_name, stats, {
            count: 1,
            error_count: 1,
            min_time: undefined,
            max_time: undefined,
            sum_time: undefined,
        });

        expect(stats[op_name].avg_time_milisec).toBe(100);
        expect(stats[op_name].count).toBe(2);
        expect(stats[op_name].error_count).toBe(1);
        expect_finite_timing(stats[op_name]);
    });
});
