/* Copyright (C) 2026 NooBaa */
'use strict';

const lossless_json = require('../../../sdk/s3_tables/lossless_json');
const { BIG_SNAPSHOT_ID, BIG_SNAPSHOT_ID_NEXT, expect_error_code } = require('./s3_tables_fixtures');

const MAX_SAFE = String(Number.MAX_SAFE_INTEGER); // 2^53 - 1
const TWO_POW_53 = '9007199254740992';
const TWO_POW_53_PLUS_1 = '9007199254740993';

describe('s3_tables lossless_json', () => {

    describe('parse and stringify', () => {

        it('round trips an out-of-range integer byte for byte', () => {
            const text = `{"snapshot-id":${BIG_SNAPSHOT_ID}}`;
            expect(lossless_json.stringify(lossless_json.parse(text))).toBe(text);
        });

        it('round trips a negative out-of-range integer byte for byte', () => {
            const text = `{"snapshot-id":-${BIG_SNAPSHOT_ID}}`;
            expect(lossless_json.stringify(lossless_json.parse(text))).toBe(text);
        });

        it('shows what a plain JSON round trip does to the same value', () => {
            // the corruption this module exists to prevent - deterministic and silent
            const text = `{"snapshot-id":${BIG_SNAPSHOT_ID}}`;
            expect(JSON.stringify(JSON.parse(text))).not.toBe(text);
        });

        it('keeps safe integers as ordinary numbers', () => {
            const parsed = lossless_json.parse(`{"a":0,"b":-7,"c":${MAX_SAFE}}`);
            expect(typeof parsed.a).toBe('number');
            expect(typeof parsed.b).toBe('number');
            expect(typeof parsed.c).toBe('number');
            expect(parsed.c).toBe(Number.MAX_SAFE_INTEGER);
        });

        it('keeps genuine floats as numbers, not source text', () => {
            // gating on the integer-literal shape, not on !isSafeInteger alone, is what
            // makes this true
            const parsed = lossless_json.parse('{"a":1.5,"b":1e300,"c":-0.0}');
            expect(typeof parsed.a).toBe('number');
            expect(typeof parsed.b).toBe('number');
            expect(typeof parsed.c).toBe('number');
        });

        it('preserves out-of-range integers nested in arrays and objects', () => {
            const text = `{"snapshot-log":[{"timestamp-ms":1,"snapshot-id":${BIG_SNAPSHOT_ID}}],` +
                `"refs":{"main":{"snapshot-id":${BIG_SNAPSHOT_ID},"type":"branch"}}}`;
            expect(lossless_json.stringify(lossless_json.parse(text))).toBe(text);
        });

        it('preserves exactly 2^53, which is already outside the safe range', () => {
            const text = `{"n":${TWO_POW_53}}`;
            expect(lossless_json.stringify(lossless_json.parse(text))).toBe(text);
        });

        it('throws SyntaxError on malformed input, leaving the semantic error to the caller', () => {
            expect(() => lossless_json.parse('{')).toThrow(SyntaxError);
        });

    });

    describe('id_text', () => {

        it('returns the exact source text of a preserved integer', () => {
            const parsed = lossless_json.parse(`{"id":${BIG_SNAPSHOT_ID}}`);
            expect(lossless_json.id_text(parsed.id)).toBe(BIG_SNAPSHOT_ID);
        });

        it('returns canonical text for an in-range integer', () => {
            expect(lossless_json.id_text(42)).toBe('42');
            expect(lossless_json.id_text(-1)).toBe('-1');
            expect(lossless_json.id_text(0)).toBe('0');
        });

        it('returns undefined for null and for an absent field', () => {
            expect(lossless_json.id_text(null)).toBeUndefined();
            expect(lossless_json.id_text(undefined)).toBeUndefined();
        });

        it('rejects a non-integer value', () => {
            expect_error_code(() => lossless_json.id_text(1.5, 'snapshot-id'), 'InvalidRequest');
            expect_error_code(() => lossless_json.id_text('7', 'snapshot-id'), 'InvalidRequest');
            expect_error_code(() => lossless_json.id_text(true, 'snapshot-id'), 'InvalidRequest');
            expect_error_code(() => lossless_json.id_text({}, 'snapshot-id'), 'InvalidRequest');
        });

    });

    describe('id_equals', () => {

        it('distinguishes two ids that round to the same Number', () => {
            const stored = lossless_json.parse(`{"id":${BIG_SNAPSHOT_ID}}`).id;
            const asserted = lossless_json.parse(`{"id":${BIG_SNAPSHOT_ID_NEXT}}`).id;
            // the discriminating case - a numeric comparison would call these equal
            expect(Number(BIG_SNAPSHOT_ID)).toBe(Number(BIG_SNAPSHOT_ID_NEXT));
            expect(lossless_json.id_equals(stored, asserted)).toBe(false);
        });

        it('matches equal preserved ids, and a preserved id against its own text', () => {
            const a = lossless_json.parse(`{"id":${BIG_SNAPSHOT_ID}}`).id;
            const b = lossless_json.parse(`{"id":${BIG_SNAPSHOT_ID}}`).id;
            expect(lossless_json.id_equals(a, b)).toBe(true);
        });

        it('treats two absent values as equal and absent versus present as different', () => {
            expect(lossless_json.id_equals(null, undefined)).toBe(true);
            expect(lossless_json.id_equals(null, 3)).toBe(false);
        });

        it('compares in-range ids by value', () => {
            expect(lossless_json.id_equals(5, 5)).toBe(true);
            expect(lossless_json.id_equals(5, 6)).toBe(false);
        });

    });

    describe('safe_int', () => {

        it('accepts 2^53 - 1', () => {
            expect(lossless_json.safe_int(Number.MAX_SAFE_INTEGER, 'sequence-number'))
                .toBe(Number.MAX_SAFE_INTEGER);
        });

        it('rejects exactly 2^53', () => {
            const value = lossless_json.parse(`{"n":${TWO_POW_53}}`).n;
            expect_error_code(() => lossless_json.safe_int(value, 'sequence-number'), 'InvalidRequest');
        });

        it('rejects 2^53 + 1', () => {
            const value = lossless_json.parse(`{"n":${TWO_POW_53_PLUS_1}}`).n;
            expect_error_code(() => lossless_json.safe_int(value, 'sequence-number'), 'InvalidRequest');
        });

        it('rejects a fraction, a numeric string and a missing value', () => {
            expect_error_code(() => lossless_json.safe_int(1.5, 'sequence-number'), 'InvalidRequest');
            expect_error_code(() => lossless_json.safe_int('7', 'sequence-number'), 'InvalidRequest');
            expect_error_code(() => lossless_json.safe_int(undefined, 'sequence-number'), 'InvalidRequest');
        });

    });

});
