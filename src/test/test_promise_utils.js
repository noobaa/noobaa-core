// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
/* exported describe, it, before, after, beforeEach, afterEach */
'use strict';

var _ = require('lodash');
var Q = require('q');
var assert = require('assert');
var promise_utils = require('../util/promise_utils');


describe('promise_utils', function() {

    describe('iterate', function() {

        it('should handle small array', function(done) {
            Q.fcall(function() {
                    return promise_utils.iterate([1, 2, 3, 4], function(i) {
                        return Q.delay();
                    });
                })
                .nodeify(done);
        });

        it('should handle large array', function(done) {
            var len = 1000;
            var func = Math.sqrt;
            var input = _.times(len);
            var output = _.times(len, func);
            Q.fcall(function() {
                    return promise_utils.iterate(input, function(i) {
                        return func(i);
                    });
                })
                .then(function(res) {
                    assert(_.isEqual(res, output), 'unexpected output');
                })
                .nodeify(done);
        });

        it('should return empty array when given empty array', function(done) {
            Q.fcall(function() {
                    return promise_utils.iterate([], function thrower() {
                        throw new Error('shouldnt call me');
                    });
                })
                .then(function(res) {
                    assert(_.isArray(res));
                    assert.strictEqual(res.length, 0);
                })
                .nodeify(done);
        });

        it('should return empty array when given null values', function(done) {
            Q.fcall(function() {
                    var falsy_values = [null, undefined, false, NaN, 0, ''];
                    return Q.all(_.map(falsy_values, function(val) {
                        return promise_utils.iterate(val).then(function(res) {
                            assert(_.isArray(res));
                            assert.strictEqual(res.length, 0);
                        });
                    }));
                })
                .nodeify(done);
        });

    });


    describe('loop', function() {
        function test_loop_count(n, done) {
            var count = 0;
            Q.fcall(function() {
                    return promise_utils.loop(n, function() {
                        count += 1;
                    });
                })
                .then(function() {
                    assert.strictEqual(count, n);
                })
                .nodeify(done);
        }
        it('should work with 0', test_loop_count.bind(null, 0));
        it('should work with 10', test_loop_count.bind(null, 10));
        it('should work with 98', test_loop_count.bind(null, 98));
    });

});
