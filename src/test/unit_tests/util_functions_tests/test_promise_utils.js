/* Copyright (C) 2016 NooBaa */
'use strict';

const P = require('../../../util/promise');
const Defer = require('../../../util/defer');
const mocha = require('mocha');
const assert = require('assert');

mocha.describe('promise utils', function() {

    mocha.describe('P.map_props', function() {

        mocha.it('awaits promise values', async function() {
            const res = await P.map_props({
                one: (async () => {
                    await P.delay(10);
                    return 'OK';
                })(),
                two: (async () => {
                    await P.delay(1);
                    return [1, 2, 3];
                })(),
            });
            assert.deepStrictEqual(res, {
                one: 'OK',
                two: [1, 2, 3],
            });
        });

    });

    mocha.describe('P.map_any', function() {

        mocha.it('return fastest', async function() {
            const start_time = process.hrtime.bigint();
            const res = await P.map_any([500, 100, 10, 1], async n => {
                await P.delay(n);
                return n;
            });
            const took_ms = Number(process.hrtime.bigint() - start_time) / 1e6;
            console.log(`the race took: ${took_ms.toFixed(3)} ms`);
            assert.deepStrictEqual(res, 1);
        });

        mocha.it('ignores fast errors', async function() {
            const start_time = process.hrtime.bigint();
            const res = await P.map_any([1, 100, 10, 500], async n => {
                await P.delay(n);
                if (n < 100) throw new Error('FAST ERROR');
                return n;
            });
            const took_ms = Number(process.hrtime.bigint() - start_time) / 1e6;
            console.log(`the race took: ${took_ms.toFixed(3)} ms`);
            assert.deepStrictEqual(res, 100);
        });

        mocha.it('fails when all fail', async function() {
            const start_time = process.hrtime.bigint();
            try {
                const res = await P.map_any([1, 100, 10], async n => {
                    await P.delay(n);
                    throw new Error('ERRORS FOR ALL');
                });
                assert.fail(`expected error but got result ${res}`);
            } catch (err) {
                const took_ms = Number(process.hrtime.bigint() - start_time) / 1e6;
                console.log(`the race took: ${took_ms.toFixed(3)} ms`);
                assert.deepStrictEqual(err.message, 'P.map_any: all failed');
            }
        });
    });

    mocha.describe('P.map_with_concurrency', function() {
        mocha.it('works', async function() {
            const res = await P.map_with_concurrency(10, Array(100).fill(), async () => {
                await P.delay(Math.floor(Math.random() * 10));
                return 1;
            });
            assert.deepStrictEqual(res, Array(100).fill(1));
        });
    });

    mocha.describe('P.map_one_by_one', function() {
        mocha.it('works', async function() {
            const res = await P.map_with_concurrency(10, Array(100).fill(), async () => {
                await P.delay(Math.floor(Math.random() * 10));
                return 1;
            });
            assert.deepStrictEqual(res, Array(100).fill(1));
        });
    });

    mocha.describe('P.retry', function() {

        mocha.it('should resolve on first attempt when func succeeds', async function() {
            const result = await P.retry({
                attempts: 3,
                delay_ms: 0,
                func: async () => 'ok',
            });
            assert.strictEqual(result, 'ok');
        });

        mocha.it('should retry and resolve when func fails then succeeds', async function() {
            let call_count = 0;
            const result = await P.retry({
                attempts: 3,
                delay_ms: 0,
                func: async () => {
                    call_count += 1;
                    if (call_count < 3) throw new Error(`fail #${call_count}`);
                    return 'recovered';
                },
            });
            assert.strictEqual(result, 'recovered');
            assert.strictEqual(call_count, 3);
        });

        mocha.it('should throw after all attempts are exhausted', async function() {
            let call_count = 0;
            await assert.rejects(
                () => P.retry({
                    attempts: 3,
                    delay_ms: 0,
                    func: async () => {
                        call_count += 1;
                        throw new Error(`fail #${call_count}`);
                    },
                }),
                err => err.message === 'fail #3'
            );
            assert.strictEqual(call_count, 3);
        });

        mocha.it('should retry when should_retry_func returns true', async function() {
            let call_count = 0;
            const result = await P.retry({
                attempts: 3,
                delay_ms: 0,
                func: async () => {
                    call_count += 1;
                    if (call_count === 1) {
                        const err = new Error('retryable');
                        err.code = 'RETRY_ME';
                        throw err;
                    }
                    return 'ok';
                },
                should_retry_func: err => err.code === 'RETRY_ME',
            });
            assert.strictEqual(result, 'ok');
            assert.strictEqual(call_count, 2);
        });

        mocha.it('should stop immediately when should_retry_func returns false', async function() {
            let call_count = 0;
            await assert.rejects(
                () => P.retry({
                    attempts: 5,
                    delay_ms: 0,
                    func: async () => {
                        call_count += 1;
                        throw new Error('non-retryable');
                    },
                    should_retry_func: () => false,
                }),
                err => err.message === 'non-retryable'
            );
            assert.strictEqual(call_count, 1);
        });

        mocha.it('should not retry when error has DO_NOT_RETRY flag', async function() {
            let call_count = 0;
            await assert.rejects(
                () => P.retry({
                    attempts: 5,
                    delay_ms: 0,
                    func: async () => {
                        call_count += 1;
                        const err = new Error('permanent');
                        err.DO_NOT_RETRY = true;
                        throw err;
                    },
                }),
                err => err.message === 'permanent'
            );
            assert.strictEqual(call_count, 1);
        });

        mocha.it('should call error_logger on each retried error', async function() {
            const logged_errors = [];
            let call_count = 0;
            await P.retry({
                attempts: 3,
                delay_ms: 0,
                func: async () => {
                    call_count += 1;
                    if (call_count < 3) throw new Error(`fail #${call_count}`);
                    return 'ok';
                },
                error_logger: err => logged_errors.push(err.message),
            });
            assert.deepStrictEqual(logged_errors, ['fail #1', 'fail #2']);
        });

        mocha.it('should pass remaining attempts to func', async function() {
            const seen_attempts = [];
            await assert.rejects(
                () => P.retry({
                    attempts: 3,
                    delay_ms: 0,
                    func: async remaining => {
                        seen_attempts.push(remaining);
                        throw new Error('fail');
                    },
                }),
            );
            assert.deepStrictEqual(seen_attempts, [3, 2, 1]);
        });

        mocha.it('should delay between retries when delay_ms is set', async function() {
            const start = process.hrtime.bigint();
            let call_count = 0;
            await P.retry({
                attempts: 2,
                delay_ms: 50,
                func: async () => {
                    call_count += 1;
                    if (call_count < 2) throw new Error('fail');
                    return 'ok';
                },
            });
            const elapsed_ms = Number(process.hrtime.bigint() - start) / 1e6;
            // expected elapsed time is taking into account some inaccuracy after observing a failure with elapsed_ms=49.5
            const expected_elapsed_ms = 40;
            assert.strictEqual(call_count, 2);
            assert.ok(elapsed_ms >= expected_elapsed_ms, `expected >= ${expected_elapsed_ms}ms (1 delay of 50ms - 10ms inaccuracy delta) but took ${elapsed_ms.toFixed(1)}ms`);
        });

    });

    mocha.describe('P.defer', function() {
        mocha.it('resolves immediately', /** @this {Mocha.Context} */ async function() {
            const defer = new Defer();
            defer.resolve(this.test.title);
            assert.strictEqual(await defer.promise, this.test.title);
        });
        mocha.it('resolves later', /** @this {Mocha.Context} */ async function() {
            const defer = new Defer();
            setTimeout(() => defer.resolve(this.test.title), 12);
            assert.strictEqual(await defer.promise, this.test.title);
        });
        mocha.it('rejects immediately', /** @this {Mocha.Context} */ async function() {
            const defer = new Defer();
            defer.reject(new Error(this.test.title));
            assert.rejects(defer.promise);
        });
        mocha.it('rejects later', /** @this {Mocha.Context} */ async function() {
            const defer = new Defer();
            setTimeout(() => defer.reject(new Error(this.test.title)), 12);
            assert.rejects(defer.promise);
        });
    });

});
