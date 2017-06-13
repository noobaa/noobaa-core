/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const mocha = require('mocha');
const assert = require('assert');
const http_utils = require('../../util/http_utils');

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

});
