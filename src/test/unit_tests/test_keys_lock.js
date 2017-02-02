/* Copyright (C) 2016 NooBaa */
'use strict';

// var _ = require('lodash');
var P = require('../../util/promise');
var mocha = require('mocha');
var assert = require('assert');
var KeysLock = require('../../util/keys_lock');

mocha.describe('keys_lock', function() {

    mocha.it('should create ok', function() {
        var kl = new KeysLock();
        assert.strictEqual(kl.length, 0);
    });

    mocha.it('should lock key', function() {
        var kl;
        var first_woke = false;

        function do_wake() {
            return P.resolve()
                .then(() => {
                    first_woke = true;
                });
        }

        return P.resolve()
            .then(function() {
                kl = new KeysLock();
                assert.strictEqual(kl.length, 0);

                P.resolve(kl.surround_keys(['key'], do_wake));
                assert.strictEqual(kl.length, 0);

                P.resolve(kl.surround_keys(['key'], function() {
                    assert.strictEqual(first_woke, true);
                    assert.strictEqual(kl.length, 0);
                }));
                assert.strictEqual(kl.length, 1);
            });
    });

    // mocha.it('should work like guy says', function() {
    //     return test_keys({
    //         kuku: {
    //             ['kuku']
    //         },
    //         jojo: {
    //             keys: ['1', '2'],
    //             after: ['kuku'],
    //             error: true,
    //             lenght: 5
    //         },
    //     })
    // });
    //
    // mocha.it('should work like guy says', function() {
    //     return test_keys({
    //         kuku: ['1'],
    //         jojo: ['2'],
    //     }, [
    //         ['kuku','juju']
    //     ])
    // });


    mocha.it('should work parallel keys', function() {
        var kl;
        var first_woke = false;

        function do_wake_first() {
            return P.resolve()
                .then(() => {
                    first_woke = true;
                });
        }

        return P.resolve()
            .then(function() {
                kl = new KeysLock();
                assert.strictEqual(kl.length, 0);

                P.resolve(kl.surround_keys(['key1'], () => { /* Empty Func */ }));
                assert.strictEqual(kl.length, 0);

                P.resolve(kl.surround_keys(['key2'], do_wake_first));
                assert.strictEqual(kl.length, 0);

                P.resolve(kl.surround_keys(['key2'], function() {
                    assert.strictEqual(first_woke, true);
                    assert.strictEqual(kl.length, 0);
                }));
                assert.strictEqual(kl.length, 1);
            });
    });


    // mocha.it('should surround', function() {
    //     var kl = new KeysLock();
    //     var sloth_err = new Error('Sloth');
    //     assert.strictEqual(kl.length, 0);
    //
    //     const tests = [
    //         kl.surround_keys(['1'], () => P.delay(1)),
    //         kl.surround_keys(['1', '2'], () => P.delay(1)
    //             .then(() => {
    //                 throw sloth_err;
    //             })
    //         ),
    //         kl.surround_keys(['1', '3'], () => P.delay(1)),
    //         kl.surround_keys(['2'], () => P.delay(1)),
    //         kl.surround_keys(['3'], () => P.delay(1))
    //     ];
    //
    //     return P.all(tests.map(test =>
    //             test.then(
    //                 () => Date.now(),
    //                 err => {
    //                     const new_err = new Error();
    //                     new_err.err = err;
    //                     new_err.date = Date.now();
    //                     throw new_err;
    //                 }
    //             )
    //             .reflect()
    //         ))
    //         .then(results => {
    //             console.warn('jen', results);
    //
    //             assert(results[0].isFulfilled());
    //             assert(results[0].value() <= results[3].value());
    //             assert(results[0].value() <= results[4].value());
    //             assert(results[0].value() < results[1].reason().date);
    //             assert(results[0].value() < results[2].value());
    //
    //             assert(results[1].isRejected());
    //             assert(_.isEqual(results[1].reason().err, sloth_err));
    //             assert(results[1].reason().date > results[0].value());
    //             assert(results[1].reason().date > results[3].value());
    //             assert(results[1].reason().date > results[4].value());
    //             assert(results[1].reason().date < results[2].value());
    //
    //             assert(results[2].isFulfilled());
    //             assert(results[2].value() > results[0].value());
    //             assert(results[2].value() > results[1].reason().date);
    //             assert(results[2].value() > results[3].value());
    //             assert(results[2].value() > results[4].value());
    //
    //             assert(results[3].isFulfilled());
    //             assert(results[3].value() >= results[3].value());
    //             assert(results[3].value() <= results[4].value());
    //             assert(results[3].value() < results[1].reason().date);
    //             assert(results[3].value() < results[2].value());
    //
    //             assert(results[4].isFulfilled());
    //             assert(results[4].value() >= results[3].value());
    //             assert(results[4].value() >= results[4].value());
    //             assert(results[4].value() < results[1].reason().date);
    //             assert(results[4].value() < results[2].value());
    //         });
    // });

});
