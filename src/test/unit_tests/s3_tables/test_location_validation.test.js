/* Copyright (C) 2026 NooBaa */
'use strict';

const table_metadata = require('../../../sdk/s3_tables/table_metadata');
const fixtures = require('./s3_tables_fixtures');
const { BACKING_BUCKET, TABLE_ID, TABLE_LOCATION, make_ctx, expect_error_code } = fixtures;

/**
 * Design §6.1.1 - compare literally, then refuse anything whose meaning is not already
 * fixed. Exported from table_metadata because story 17 (§6.1.4) applies the identical
 * rule to an imperative commit's metadata location: a check present on one protocol
 * only is exploitable by choosing the other.
 */
describe('s3_tables location validation (§6.1.1)', () => {

    const ctx = make_ctx();

    describe('accepted', () => {

        it.each([
            ['a data file', `s3://${BACKING_BUCKET}/${TABLE_ID}/data/00000-0-abc.parquet`],
            ['a metadata file', `s3://${BACKING_BUCKET}/${TABLE_ID}/metadata/00001-abc.metadata.json`],
            ['the table location itself', TABLE_LOCATION],
            ['a deep key', `s3://${BACKING_BUCKET}/${TABLE_ID}/data/a/b/c/d.parquet`],
            ['a segment containing a dot', `s3://${BACKING_BUCKET}/${TABLE_ID}/data/.hidden`],
        ])('%s', (_name, value) => {
            expect(table_metadata.validate_location(value, ctx)).toBe(value);
        });

        it('a directory value with one trailing slash, when allowed', () => {
            const value = `s3://${BACKING_BUCKET}/${TABLE_ID}/data/`;
            expect(table_metadata.validate_location(value, ctx, { allow_trailing_slash: true })).toBe(value);
        });

    });

    describe('refused', () => {

        it.each([
            ['another scheme', `s3a://${BACKING_BUCKET}/${TABLE_ID}/data/x`],
            ['an uppercase scheme', `S3://${BACKING_BUCKET}/${TABLE_ID}/data/x`],
            ['no scheme', `/${BACKING_BUCKET}/${TABLE_ID}/data/x`],
            ['another bucket', `s3://other-bucket/${TABLE_ID}/data/x`],
            ['a case-differing bucket', `s3://${BACKING_BUCKET.toUpperCase()}/${TABLE_ID}/data/x`],
            ['a bucket the backing bucket is a prefix of', `s3://${BACKING_BUCKET}x/${TABLE_ID}/data/x`],
            ['another table id', `s3://${BACKING_BUCKET}/6812a1b2c3d4e5f607182931/data/x`],
            ['a table id the real one is a prefix of', `s3://${BACKING_BUCKET}/${TABLE_ID}x/data/x`],
            ['the bucket root', `s3://${BACKING_BUCKET}`],
            ['the bucket root with a slash', `s3://${BACKING_BUCKET}/`],
            ['a parent segment', `s3://${BACKING_BUCKET}/${TABLE_ID}/../other/x`],
            ['a current segment', `s3://${BACKING_BUCKET}/${TABLE_ID}/./x`],
            ['a leading parent segment', `s3://${BACKING_BUCKET}/../${TABLE_ID}/x`],
            ['an empty segment', `s3://${BACKING_BUCKET}/${TABLE_ID}//x`],
            ['a doubled separator at the end', `s3://${BACKING_BUCKET}/${TABLE_ID}/data//`],
            ['a percent-encoded slash', `s3://${BACKING_BUCKET}/${TABLE_ID}%2Fdata/x`],
            ['a percent-encoded slash inside the key', `s3://${BACKING_BUCKET}/${TABLE_ID}/data%2Fx`],
            ['any percent sign', `s3://${BACKING_BUCKET}/${TABLE_ID}/data/100%25.parquet`],
            ['a backslash', `s3://${BACKING_BUCKET}/${TABLE_ID}/data\\x`],
            ['a question mark', `s3://${BACKING_BUCKET}/${TABLE_ID}/data/x?versionId=1`],
            ['a fragment marker', `s3://${BACKING_BUCKET}/${TABLE_ID}/data/x#frag`],
            ['an empty string', ''],
        ])('%s', (_name, value) => {
            expect_error_code(() => table_metadata.validate_location(value, ctx), 'InvalidRequest');
        });

        it('a trailing slash where it is not allowed', () => {
            expect_error_code(
                () => table_metadata.validate_location(`s3://${BACKING_BUCKET}/${TABLE_ID}/data/`, ctx),
                'InvalidRequest');
        });

        it('a non-string value', () => {
            expect_error_code(() => table_metadata.validate_location(null, ctx), 'InvalidRequest');
            expect_error_code(() => table_metadata.validate_location(7, ctx), 'InvalidRequest');
        });

    });

    describe('location_matches_assigned', () => {

        it('accepts the assigned location with and without one trailing slash', () => {
            expect(table_metadata.location_matches_assigned(TABLE_LOCATION, ctx)).toBe(true);
            expect(table_metadata.location_matches_assigned(`${TABLE_LOCATION}/`, ctx)).toBe(true);
        });

        it('refuses two trailing slashes, a subdirectory and another table', () => {
            expect(table_metadata.location_matches_assigned(`${TABLE_LOCATION}//`, ctx)).toBe(false);
            expect(table_metadata.location_matches_assigned(`${TABLE_LOCATION}/data`, ctx)).toBe(false);
            expect(table_metadata.location_matches_assigned(`s3://${BACKING_BUCKET}/other`, ctx)).toBe(false);
            expect(table_metadata.location_matches_assigned(undefined, ctx)).toBe(false);
        });

    });

});
