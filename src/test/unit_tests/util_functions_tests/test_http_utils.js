/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const mocha = require('mocha');
const assert = require('assert');
const http_utils = require('../../../util/http_utils');

mocha.describe('http_utils', function() {

    mocha.describe('match_etag', function() {

        // see https://www.w3.org/Protocols/rfc2616/rfc2616-sec14.html#sec14.24

        function add_test(condition, etags) {
            mocha.it(`if-match ${condition}`, function() {
                _.each(etags, (val, etag) => {
                    assert(val === http_utils.match_etag(condition, etag));
                });
            });
        }

        add_test('*', {
            'xyzzy': true,
            'xyzz': true,
            '*': true,
            ' ': true,
            ',': true,
            '': true,
        });

        add_test('"xyzzy"', {
            'xyzzy': true,
            'xyzz': false,
            '': false,
        });

        add_test('"xyzzy", "r2d2xxxx", "c3piozzzz"', {
            'c3piozzzz': true,
            'r2d2xxxx': true,
            'xyzzy': true,
            'xyzzy ': false,
            ' ': false,
            ',': false,
            'xyzzy", "r2d2xxxx", "c3piozzzz': false,
        });

        add_test('xyzzy', {
            'xyzzy': true,
            'xyzz': false,
            '': false,
        });

        add_test('"xyzzy", ', {
            'xyzzy': false,
            'xyzzy ': false,
            ' ': false,
            ',': false,
        });

    });

    mocha.describe('normalize_http_ranges', function() {

        function normalize(range_header, size) {
            return http_utils.normalize_http_ranges(
                http_utils.parse_http_ranges(range_header),
                size
            );
        }

        function assert_416(range_header, size) {
            try {
                normalize(range_header, size);
                assert.fail('expected 416 InvalidRange');
            } catch (err) {
                assert.strictEqual(err.ranges_code, 416);
            }
        }

        mocha.it('should return 416 for range on empty object (AWS S3)', function() {
            assert_416('bytes=0-99', 0);
            assert_416('bytes=0-0', 0);
            assert_416('bytes=0-', 0);
        });

        mocha.it('should return 416 when first-byte-pos is past the end', function() {
            assert_416('bytes=100-200', 100);
            assert_416('bytes=5-10', 5);
        });

        mocha.it('should clamp end and return a valid range when overlapping', function() {
            const ranges = normalize('bytes=0-99', 100);
            assert.deepStrictEqual(ranges, [{ start: 0, end: 100 }]);
            const clamped = normalize('bytes=90-200', 100);
            assert.deepStrictEqual(clamped, [{ start: 90, end: 100 }]);
        });

    });

});
