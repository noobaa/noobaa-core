/* Copyright (C) 2016 NooBaa */
'use strict';

const util = require('util');
const mocha = require('mocha');
const assert = require('assert');
const semaphore = require('../../../util/semaphore');
const debug_module = require('../../../util/debug_module');

const setImmediateAsync = util.promisify(setImmediate);
const delay = util.promisify(setTimeout);

// All DebugLogger instances share a prototype, so patching it here also intercepts
// the logger that semaphore.js logs its stuck-item warning through.
const dbg_proto = Object.getPrototypeOf(debug_module(__filename));

function capture_dbg_errors() {
    const captured = [];
    const orig_error = dbg_proto.error;
    dbg_proto.error = function(...args) {
        captured.push(util.format(...args));
    };
    return {
        captured,
        restore: () => {
            dbg_proto.error = orig_error;
        },
    };
}

// named so that the test can assert the warning's stack points back at the caller
function call_surround_that_gets_stuck(sem, never_settles) {
    return sem.surround(() => never_settles);
}

mocha.describe('semaphore', function() {

    mocha.it('should create ok', function() {
        const sem = new semaphore.Semaphore(0);
        assert.strictEqual(sem.length, 0);
        assert.strictEqual(sem.value, 0);
    });

    mocha.it('should handle single item', async function() {
        let woke = 0;

        function do_wake() {
            woke += 1;
        }

        const sem = new semaphore.Semaphore(10);
        assert.strictEqual(sem.length, 0);
        assert.strictEqual(sem.value, 10);

        sem.wait(2).then(do_wake);
        assert.strictEqual(sem.length, 0);
        assert.strictEqual(sem.value, 8);
        assert.strictEqual(woke, 0);

        sem.wait().then(do_wake);
        assert.strictEqual(sem.length, 0);
        assert.strictEqual(sem.value, 7);
        assert.strictEqual(woke, 0);

        sem.wait(8).then(do_wake);
        assert.strictEqual(sem.length, 1);
        assert.strictEqual(sem.value, 7);
        assert.strictEqual(woke, 0);

        sem.wait(10).then(do_wake);
        assert.strictEqual(sem.length, 2);
        assert.strictEqual(sem.value, 7);
        assert.strictEqual(woke, 0);

        sem.release(1);

        await setImmediateAsync();
        await setImmediateAsync(); //no real reason other than that it takes 1 more cycles for the items to awake

        assert.strictEqual(sem.length, 1);
        assert.strictEqual(sem.value, 0);
        assert.strictEqual(woke, 3);

        sem.release();

        await setImmediateAsync();

        assert.strictEqual(sem.length, 1);
        assert.strictEqual(sem.value, 1);
        assert.strictEqual(woke, 3);

        sem.release(14);

        await setImmediateAsync();

        assert.strictEqual(sem.length, 0);
        assert.strictEqual(sem.value, 5);
        assert.strictEqual(woke, 4);
    });

    mocha.it('should surround', async function() {
        const throw_err = new Error();
        const sem = new semaphore.Semaphore(10);
        assert.strictEqual(sem.length, 0);
        assert.strictEqual(sem.value, 10);

        const results = await Promise.all([

            sem.surround(function() {
                assert.strictEqual(sem.length, 2);
                assert.strictEqual(sem.value, 9);
                return 11;
            }).then(res => ({ res }), err => ({ err })),

            sem.surround_count(10, function() {
                assert.strictEqual(sem.length, 1);
                assert.strictEqual(sem.value, 0);
                throw throw_err;
            }).then(res => ({ res }), err => ({ err })),

            sem.surround_count(4, function() {
                assert.strictEqual(sem.length, 0);
                assert.strictEqual(sem.value, 6);
                return 22;
            }).then(res => ({ res }), err => ({ err })),

        ]);

        assert.strictEqual(results[0].res, 11);
        assert.strictEqual(results[0].err, undefined);
        assert.strictEqual(results[1].err, throw_err);
        assert.strictEqual(results[1].res, undefined);
        assert.strictEqual(results[2].res, 22);
        assert.strictEqual(results[2].err, undefined);
        assert.strictEqual(sem.length, 0);
        assert.strictEqual(sem.value, 10);
    });

    mocha.it('should fail on timeout in surround', async function() {
        const sem = new semaphore.Semaphore(1, {
            // Just using the minimum timeout without any place inside the semaphore
            // This means that we are just interested in failing as quickly as we can
            // With the item inside the waiting queue
            timeout: 1,
            timeout_error_code: 'MAJESTIC_SLOTH'
        });
        assert.strictEqual(sem.length, 0);
        assert.strictEqual(sem.value, 1);

        const results = await Promise.all([
            sem.surround_count(2604, function() {
                return 'MAGIC';
            }).then(res => ({ res }), err => ({ err })),
        ]);

        assert.strictEqual(results[0].err.code, 'MAJESTIC_SLOTH');
        assert.strictEqual(sem.length, 0);
        assert.strictEqual(sem.value, 1);
        assert.strictEqual(sem.waiting_value, 0);
    });

    mocha.it('should release value on non settled worker', async function() {
        const sem = new semaphore.Semaphore(1, {
            work_timeout: 1,
            work_timeout_error_code: 'MAJESTIC_SLOTH_TIMEOUT'
        });
        assert.strictEqual(sem.length, 0);
        assert.strictEqual(sem.value, 1);
        try {
            await sem.surround_count(1, async function() {
                return new Promise((resolve, reject) => setTimeout(resolve, 500));
            });
            throw new Error('Semaphore did not throw an error on non settled worker');
        } catch (error) {
            assert.strictEqual(error.code, 'MAJESTIC_SLOTH_TIMEOUT');
            assert.strictEqual(error.message, 'Semaphore Worker Timeout');
        }
        assert.strictEqual(sem.length, 0);
        assert.strictEqual(sem.value, 1);
        assert.strictEqual(sem.waiting_value, 0);
    });

    mocha.it('should warn with the caller stack when a surround item is stuck', async function() {
        const spy = capture_dbg_errors();
        let unstick;
        const never_settles = new Promise(resolve => { unstick = resolve; });
        try {
            const sem = new semaphore.Semaphore(1, { warning_timeout: 50 });
            const surrounded = call_surround_that_gets_stuck(sem, never_settles);

            await delay(250);

            assert.strictEqual(spy.captured.length, 1,
                `expected exactly one stuck warning, got ${spy.captured.length}`);
            assert.ok(spy.captured[0].includes('Warning stuck surround item'),
                `unexpected warning text: ${spy.captured[0]}`);
            // The stack must identify the caller, not just Semaphore.surround itself -
            // capturing it after the first await loses the frames that matter.
            assert.ok(spy.captured[0].includes('call_surround_that_gets_stuck'),
                `warning stack does not name the caller:\n${spy.captured[0]}`);

            unstick();
            await surrounded;
            assert.strictEqual(sem.value, 1);
        } finally {
            unstick();
            spy.restore();
        }
    });

    mocha.it('should not warn when a surround item completes in time', async function() {
        const spy = capture_dbg_errors();
        try {
            const sem = new semaphore.Semaphore(1, { warning_timeout: 200 });
            await sem.surround(async () => delay(1));
            await delay(300);
            assert.deepStrictEqual(spy.captured, []);
        } finally {
            spy.restore();
        }
    });

});
