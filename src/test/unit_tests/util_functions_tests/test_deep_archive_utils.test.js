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
    const now = new Date('2026-01-01T00:00:00Z');

    it('adds days relative to now', () => {
        const res = deep_archive_utils.compute_restore_expiry(7, now);
        expect(res.toISOString()).toBe('2026-01-08T00:00:00.000Z');
    });
});

describe('parse_s3_restore_field', () => {
    it('parses ongoing restore', () => {
        expect(deep_archive_utils.parse_s3_restore_field('ongoing-request="true"')).toEqual({
            ongoing: true,
        });
    });

    it('parses completed restore with expiry', () => {
        const restore_field = 'ongoing-request="false", expiry-date="Fri, 23 Dec 2012 00:00:00 GMT"';
        const result = deep_archive_utils.parse_s3_restore_field(restore_field);
        expect(result.ongoing).toBe(false);
        expect(result.expiry_time).toEqual(new Date('Fri, 23 Dec 2012 00:00:00 GMT'));
    });

    it('returns undefined for missing or unparseable Restore field', () => {
        expect(deep_archive_utils.parse_s3_restore_field(undefined)).toBeUndefined();
        expect(deep_archive_utils.parse_s3_restore_field('')).toBeUndefined();
        expect(deep_archive_utils.parse_s3_restore_field('not-a-restore-value')).toBeUndefined();
    });

    it('omits expiry_time when expiry-date is not a parseable date', () => {
        const result = deep_archive_utils.parse_s3_restore_field(
            'ongoing-request="false", expiry-date="not-a-date"'
        );
        expect(result).toEqual({ ongoing: false });
        expect(result.expiry_time).toBeUndefined();
    });
});
