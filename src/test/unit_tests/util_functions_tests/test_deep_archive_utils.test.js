/* Copyright (C) 2026 NooBaa */
'use strict';

const deep_archive_utils = require('../../../util/deep_archive_utils');

describe('is_restore_active', () => {
    const now = new Date('2026-06-01T00:00:00Z');

    it('returns false when restore_status is missing', () => {
        const res = deep_archive_utils.is_restore_active(undefined, now);
        expect(res).toBe(false);
    });

    it('returns false when ongoing is true', () => {
        const res = deep_archive_utils.is_restore_active({ ongoing: true, days: 7 }, now);
        expect(res).toBe(false);
    });

    it('returns false when expiry_time is missing', () => {
        const res = deep_archive_utils.is_restore_active({ ongoing: false }, now);
        expect(res).toBe(false);
    });

    it('returns false when expiry is in the past', () => {
        const res = deep_archive_utils.is_restore_active({
            ongoing: false,
            expiry_time: new Date('2020-01-01T00:00:00Z'),
        }, now);
        expect(res).toBe(false);
    });

    it('returns false when expiry_time equals now', () => {
        const res = deep_archive_utils.is_restore_active({
            ongoing: false,
            expiry_time: now,
        }, now);
        expect(res).toBe(false);
    });

    it('returns true when ongoing is false and expiry is in the future', () => {
        const res = deep_archive_utils.is_restore_active({
            ongoing: false,
            expiry_time: new Date('2099-01-01T00:00:00Z'),
        }, now);
        expect(res).toBe(true);
    });

    it('returns true when expiry_time is an epoch milliseconds', () => {
        const res = deep_archive_utils.is_restore_active({
            ongoing: false,
            expiry_time: new Date('2099-01-01T00:00:00Z').getTime(), // epoch milliseconds
        }, now);
        expect(res).toBe(true);
    });

    it('returns false when expiry_time is invalid', () => {
        const res = deep_archive_utils.is_restore_active({
            ongoing: false,
            expiry_time: 'not-a-date',
        }, now);
        expect(res).toBe(false);
    });
});

describe('compute_restore_expiry', () => {
    it('matches AWS 3-day restore example', () => {
        // https://docs.aws.amazon.com/AmazonS3/latest/userguide/archived-objects.html
        // Oct 15 10:30 UTC + 3 days -> Oct 19 00:00 UTC
        const now = new Date('2012-10-15T10:30:00.000Z');
        const res = deep_archive_utils.compute_restore_expiry(3, now);
        expect(res.toISOString()).toBe('2012-10-19T00:00:00.000Z');
    });

    it('keeps exact midnight UTC without adding another day', () => {
        const now = new Date('2026-01-01T00:00:00.000Z');
        const res = deep_archive_utils.compute_restore_expiry(7, now);
        expect(res.toISOString()).toBe('2026-01-08T00:00:00.000Z');
    });
});
