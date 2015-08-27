// make jshint ignore mocha globals
// /* global describe, it, before, after, beforeEach, afterEach */
/* global describe, it */
'use strict';

// var _ = require('lodash');
var Q = require('q');
var assert = require('assert');
var Semaphore = require('../util/semaphore');

describe('semaphore', function() {

    it('should create ok', function() {
        var sem = new Semaphore();
        assert.strictEqual(sem.length, 0);
        assert.strictEqual(sem.value, 0);
    });

    it('should handle single item', function(done) {
        var sem;
        var woke = 0;
        var do_wake = function() {
            woke++;
        };

        Q.fcall(function() {
            sem = new Semaphore(10);
            assert.strictEqual(sem.length, 0);
            assert.strictEqual(sem.value, 10);

            Q.when(sem.wait(2)).then(do_wake);
            assert.strictEqual(sem.length, 0);
            assert.strictEqual(sem.value, 8);
            assert.strictEqual(woke, 0);

            Q.when(sem.wait()).then(do_wake);
            assert.strictEqual(sem.length, 0);
            assert.strictEqual(sem.value, 7);
            assert.strictEqual(woke, 0);

            Q.when(sem.wait(8)).then(do_wake);
            assert.strictEqual(sem.length, 1);
            assert.strictEqual(sem.value, 7);
            assert.strictEqual(woke, 0);

            Q.when(sem.wait(10)).then(do_wake);
            assert.strictEqual(sem.length, 2);
            assert.strictEqual(sem.value, 7);
            assert.strictEqual(woke, 0);

            sem.release(1);

        }).delay(0).then(function() {
            assert.strictEqual(sem.length, 1);
            assert.strictEqual(sem.value, 0);
            assert.strictEqual(woke, 3);

            sem.release();

        }).delay(0).then(function() {
            assert.strictEqual(sem.length, 1);
            assert.strictEqual(sem.value, 1);
            assert.strictEqual(woke, 3);

            sem.release(14);

        }).delay(0).then(function() {
            assert.strictEqual(sem.length, 0);
            assert.strictEqual(sem.value, 5);
            assert.strictEqual(woke, 4);
        }).done(done);
    });

    it('should surround', function(done) {
        var sem;
        Q.fcall(function() {
            sem = new Semaphore(10);
            assert.strictEqual(sem.length, 0);
            assert.strictEqual(sem.value, 10);
            return Q.allSettled([
                sem.surround(function() {
                    assert.strictEqual(sem.length, 2);
                    assert.strictEqual(sem.value, 9);
                    return 11;
                }), sem.surround(10, function() {
                    assert.strictEqual(sem.length, 1);
                    assert.strictEqual(sem.value, 0);
                    throw 42;
                }), sem.surround(4, function() {
                    assert.strictEqual(sem.length, 0);
                    assert.strictEqual(sem.value, 6);
                    return 22;
                })
            ]);
        }).then(function(results) {
            assert.deepEqual(results, [{
                state: "fulfilled",
                value: 11
            }, {
                state: "rejected",
                reason: 42
            }, {
                state: "fulfilled",
                value: 22
            }]);
            assert.strictEqual(sem.length, 0);
            assert.strictEqual(sem.value, 10);
        }).done(done);
    });


});
