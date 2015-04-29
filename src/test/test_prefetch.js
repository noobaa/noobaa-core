// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
/* exported describe, it, before, after, beforeEach, afterEach */
'use strict';

var _ = require('lodash');
var Q = require('q');
// var assert = require('assert');
var Prefetch = require('../util/prefetch');


describe('prefetch', function() {

    it('should work', function(done) {
        var pr;
        Q.fcall(function() {
                var id = 0;
                pr = new Prefetch({
                    low_length: 30,
                    high_length: 32,
                    load: function(count) {
                        var n = count;
                        console.log('... LOAD', n, '(' + count + ')', 'length', pr.length);
                        return Q.delay(5).then(function() {
                            console.log('>>> LOAD', n, '(' + count + ')', 'length', pr.length);
                            return _.times(n, function() {
                                id += 1;
                                return id;
                            });
                        });
                    }
                });
            })
            .delay(10)
            .then(function() {
                console.log('A - length', pr.length);
                var promise = Q.resolve();
                _.times(10, function() {
                    promise = promise.delay(0).then(function() {
                        return pr.fetch(2).then(function(res) {
                            console.log('A - fetch', res, 'length', pr.length);
                        });
                    });
                });
                return promise;
            })
            .delay(10)
            .then(function() {
                console.log('B - length', pr.length);
                return Q.all(_.times(10, function() {
                    return pr.fetch(2).then(function(res) {
                        console.log('B - fetch', res, 'length', pr.length);
                    });
                }));
            })
            .delay(10)
            .then(function() {
                console.log('length', pr.length);
            })
            .nodeify(done);
    });

});
