/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const mocha = require('mocha');
const assert = require('assert');

const P = require('../../util/promise');
const WaitQueue = require('../../util/wait_queue');

mocha.describe('wait_queue', function() {

    mocha.it('should create ok', function() {
        const wq = new WaitQueue('a long name just for spite');
        _.noop(wq); // lint unused bypass
    });

    mocha.it('should return null when no items', function() {
        const wq = new WaitQueue();
        assert(!wq.wakeup());
    });

    mocha.it('should handle single item', function() {
        let wq;
        let woke = 0;

        function do_wake() {
            woke += 1;
        }
        var item = {
            foo: 'bar',
        };
        return P.fcall(function() {
                wq = new WaitQueue();
                assert.strictEqual(wq.length, 0);

                wq.wait().then(do_wake);
                assert.strictEqual(wq.length, 1);
                assert.strictEqual(woke, 0);

                wq.wakeup();

            })
            .then(() => P.delay(10))
            .then(function() {
                assert.strictEqual(wq.length, 0);
                assert.strictEqual(woke, 1);

                wq.wait().then(do_wake)
                    .then(function() {
                        item.foo += '!';
                    });
                assert.strictEqual(wq.length, 1);
                assert.strictEqual(woke, 1);

                wq.wakeup();

            })
            .then(() => P.delay(10))
            .then(function() {
                assert.strictEqual(wq.length, 0);
                assert.strictEqual(woke, 2);
                assert.deepEqual(item, {
                    foo: 'bar!',
                });
            });
    });

    mocha.it('should reject on error', function() {
        let wq;
        let woke = 0;
        const error = new Error('WAIT_QUEUE_ERROR');
        error.code = 'WAIT_QUEUE_ERROR';

        function do_wake() {
            woke += 1;
        }
        var item = {
            foo: 'bar!',
        };
        return P.fcall(function() {
                wq = new WaitQueue();
                assert.strictEqual(wq.length, 0);
                // The wait promise will throw an error that will be unhandled (No worries as designed)
                const promise = wq.wait(item).then(do_wake);
                assert.strictEqual(wq.length, 1);
                assert.strictEqual(woke, 0);

                wq.wakeup(item, error);
                return promise;
            })
            .then(() => P.delay(10))
            .then(function() {
                // This is an error since we should reject and not resolve
                assert.strictEqual('Majestic', 'Sloth');
            })
            .catch(err => {
                assert.strictEqual(wq.length, 0);
                assert.strictEqual(woke, 0);
                assert.strictEqual(err, error);
            });
    });

});
