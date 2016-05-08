'use strict';

// var _ = require('lodash');
var P = require('../../util/promise');
var mocha = require('mocha');
var assert = require('assert');
var Semaphore = require('../../util/semaphore');

mocha.describe('semaphore', function() {

    mocha.it('should create ok', function() {
        var sem = new Semaphore();
        assert.strictEqual(sem.length, 0);
        assert.strictEqual(sem.value, 0);
    });

    mocha.it('should handle single item', function() {
        var sem;
        var woke = 0;
        var do_wake = function() {
            woke++;
        };

        return P.fcall(function() {
            sem = new Semaphore(10);
            assert.strictEqual(sem.length, 0);
            assert.strictEqual(sem.value, 10);

            P.when(sem.wait(2)).then(do_wake);
            assert.strictEqual(sem.length, 0);
            assert.strictEqual(sem.value, 8);
            assert.strictEqual(woke, 0);

            P.when(sem.wait()).then(do_wake);
            assert.strictEqual(sem.length, 0);
            assert.strictEqual(sem.value, 7);
            assert.strictEqual(woke, 0);

            P.when(sem.wait(8)).then(do_wake);
            assert.strictEqual(sem.length, 1);
            assert.strictEqual(sem.value, 7);
            assert.strictEqual(woke, 0);

            P.when(sem.wait(10)).then(do_wake);
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
        });
    });

    mocha.it('should surround', function() {
        var sem;
        return P.fcall(function() {
            sem = new Semaphore(10);
            assert.strictEqual(sem.length, 0);
            assert.strictEqual(sem.value, 10);
            return P.settle([
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
            assert(results[0].isFulfilled());
            assert(results[0].value() === 11);
            assert(results[1].isRejected());
            assert(results[1].reason() === 42);
            assert(results[2].isFulfilled());
            assert(results[2].value() === 22);
            assert.strictEqual(sem.length, 0);
            assert.strictEqual(sem.value, 10);
        });
    });


});
