/* Copyright (C) 2016 NooBaa */
'use strict';

const P = require('../../../util/promise');
const Defer = require('../../../util/defer');

describe('P.timeout', () => {

    it('returns the promise as-is when millis is undefined', async () => {
        const promise = Promise.resolve('ok');
        await expect(P.timeout(undefined, promise)).resolves.toBe('ok');
    });

    it('throws when promise is not provided', async () => {
        const promise = null;
        await expect(P.timeout(100, promise)).rejects.toThrow(/promise is required/);
    });

    it('resolves when the promise completes before the timeout', async () => {
        const promise = P.delay(10).then(() => 'done');
        const res = await P.timeout(100, promise);
        expect(res).toBe('done');
    });

    it('rejects with TimeoutError when the promise is too slow', async () => {
        const promise = P.delay(100);
        await expect(P.timeout(20, promise)).rejects.toBeInstanceOf(P.TimeoutError);
    });

    it('rejects with a custom timeout error', async () => {
        const promise = P.delay(100);
        const custom_err = new Error('custom timeout');
        const create_timeout_err = () => custom_err;
        await expect(P.timeout(20, promise, create_timeout_err)).rejects.toBe(custom_err);
    });

    it('rejects with the original error when the promise fails before the timeout', async () => {
        const err = new Error('promise failed');
        const promise = Promise.reject(err);
        await expect(P.timeout(100, promise)).rejects.toBe(err);
    });

    // Regression test for the .then(onFulfill, onReject) fix.
    // When promise is already rejected, a separate .then() + .catch() leaves a dangling
    // rejected promise from .then() (no rejection handler), which Node reports as unhandledRejection.
    it('handles an already-rejected promise without unhandled rejection', async () => {
        // Track whether Node emitted an 'unhandledRejection' event during this test.
        // null means none was seen; any other value means a bug left a rejection unhandled.
        let unhandled = null;
        /** @param {unknown} reason */
        const on_unhandled = reason => { unhandled = reason; };

        // Node emits 'unhandledRejection' when a promise rejects and nothing handles it.
        // We listen so we can fail the test if P.timeout leaves a stray rejection behind.
        process.on('unhandledRejection', on_unhandled);
        try {
            const err = new Error('already rejected');
            // Created before P.timeout() runs — mimics e.g. Promise.reject(err) passed as an argument.
            const promise = Promise.reject(err);
            await expect(P.timeout(1000, promise)).rejects.toBe(err);

            // Rejections are delivered on the microtask queue; yield one tick so any
            // unhandledRejection event fires before we check `unhandled`.
            await P.next_tick();
            expect(unhandled).toBeNull();
        } finally {
            process.off('unhandledRejection', on_unhandled);
        }
    });

    it('handles an already-resolved promise', async () => {
        const promise = Promise.resolve('immediate');
        await expect(P.timeout(1000, promise)).resolves.toBe('immediate');
    });

    // A native Promise is created by Promise.resolve/reject or async/await.
    // A thenable is any object with a .then(onFulfilled, onRejected) method — P.timeout only
    // needs .then(), so libraries can pass thenables instead of real Promises.
    // This thenable calls on_rejected immediately (synchronously) inside then().
    it('handles a synchronously rejecting thenable', async () => {
        const err = new Error('sync reject');
        // JSDoc cast only (no runtime effect): this thenable always rejects, never resolves.
        // Promise<never> = "a promise that cannot fulfill successfully".
        const promise = /** @type {Promise<never>} */ ({
            then(_on_fulfilled, on_rejected) {
                on_rejected(err);
            },
        });
        await expect(P.timeout(1000, promise)).rejects.toBe(err);
    });

    // Distinct from "too slow": the inner promise resolves *after* the timeout already rejected.
    // The outer result must stay TimeoutError — a late resolve must not call resolve() successfully.
    it('does not resolve after the timeout has already fired', async () => {
        const defer = new Defer();
        const promise = defer.promise;
        let caught_err = null;
        // Attach .catch immediately so the timeout rejection is handled as soon as it fires.
        const timeout_promise = P.timeout(20, promise).catch(err => {
            caught_err = err;
        });
        await P.delay(30); // timeout fires at 20ms
        defer.resolve('late'); // inner promise resolves after timeout — must be ignored
        await timeout_promise;
        expect(caught_err).toBeInstanceOf(P.TimeoutError);
    });

});
