/* Copyright (C) 2016 NooBaa */
'use strict';

const P = require('../../util/promise');
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

    mocha.describe('P.defer', function() {
        mocha.it('resolves immediately', /** @this {Mocha.Context} */ async function() {
            const defer = new P.Defer();
            defer.resolve(this.test.title);
            assert.strictEqual(await defer.promise, this.test.title);
        });
        mocha.it('resolves later', /** @this {Mocha.Context} */ async function() {
            const defer = new P.Defer();
            setTimeout(() => defer.resolve(this.test.title), 12);
            assert.strictEqual(await defer.promise, this.test.title);
        });
        mocha.it('rejects immediately', /** @this {Mocha.Context} */ async function() {
            const defer = new P.Defer();
            defer.reject(new Error(this.test.title));
            assert.rejects(defer.promise);
        });
        mocha.it('rejects later', /** @this {Mocha.Context} */ async function() {
            const defer = new P.Defer();
            setTimeout(() => defer.reject(new Error(this.test.title)), 12);
            assert.rejects(defer.promise);
        });
    });

});
