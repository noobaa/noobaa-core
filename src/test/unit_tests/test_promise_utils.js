'use strict';

var _ = require('lodash');
var P = require('../../util/promise');
var mocha = require('mocha');
var assert = require('assert');
var promise_utils = require('../../util/promise_utils');


mocha.describe('promise_utils', function() {

    mocha.describe('iterate', function() {

        mocha.it('should handle small array', function() {
            return promise_utils.iterate([1, 2, 3, 4], function(i) {
                return P.delay();
            });
        });

        mocha.it('should handle large array', function() {
            var len = 1000;
            var func = Math.sqrt;
            var input = _.times(len);
            var output = _.times(len, func);
            return promise_utils.iterate(input, function(i) {
                    return func(i);
                })
                .then(function(res) {
                    assert(_.isEqual(res, output), 'unexpected output');
                });
        });

        mocha.it('should return empty array when given empty array', function() {
            return promise_utils.iterate([], function thrower() {
                    throw new Error('shouldnt call me');
                })
                .then(function(res) {
                    assert(_.isArray(res));
                    assert.strictEqual(res.length, 0);
                });
        });

        mocha.it('should return empty array when given null values', function() {
            var falsy_values = [null, undefined, false, NaN, 0, ''];
            return P.all(_.map(falsy_values, function(val) {
                return promise_utils.iterate(val).then(function(res) {
                    assert(_.isArray(res));
                    assert.strictEqual(res.length, 0);
                });
            }));
        });

    });


    mocha.describe('loop', function() {
        function test_loop_count(n) {
            var count = 0;
            return P.fcall(function() {
                    return promise_utils.loop(n, function() {
                        count += 1;
                    });
                })
                .then(function() {
                    assert.strictEqual(count, n);
                });
        }
        mocha.it('should work with 0', test_loop_count.bind(null, 0));
        mocha.it('should work with 10', test_loop_count.bind(null, 10));
        mocha.it('should work with 98', test_loop_count.bind(null, 98));
    });

});
