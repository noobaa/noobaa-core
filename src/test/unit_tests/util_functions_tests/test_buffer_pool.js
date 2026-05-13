/* Copyright (C) 2016 NooBaa */
'use strict';
const mocha = require('mocha');
const assert = require('assert');
const buffer_utils = require('../../../util/buffer_utils');
const semaphore = require('../../../util/semaphore');

mocha.describe('Test buffers pool', function() {

    mocha.it('Work parallel with buf_size and respect semaphore', async function() {
        const SEM_LIMIT = 64 * 1024 * 1024;
        const BUF_LIMIT = 8 * 1024 * 1024;
        const MAX_POOL_ALLOWED = SEM_LIMIT / BUF_LIMIT;
        const SLEEP_BEFORE_RELEASE = 264;
        const buffers_pool_sem = new semaphore.Semaphore(SEM_LIMIT);
        const buffers_pool = new buffer_utils.BuffersPool({
            buf_size: BUF_LIMIT,
            sem: buffers_pool_sem,
            warning_timeout: false
        });
        // Allocate the buffers in a lazy fashion and verify
        const lazy_fill = new Array(MAX_POOL_ALLOWED).fill(0);
        const from_pool_fill = new Array(MAX_POOL_ALLOWED * 2).fill(0);
        const lazy_buffer_allocation = lazy_fill.map(async () => {
            const { buffer, callback } = await buffers_pool.get_buffer();
            await new Promise((resolve, reject) => setTimeout(resolve, SLEEP_BEFORE_RELEASE));
            console.log('Lazy allocation', buffer.length, buffers_pool.buffers.length, buffers_pool.sem.value);
            callback();
        });
        const lazy_buffers = await Promise.all(lazy_buffer_allocation);
        assert(lazy_buffers.length === MAX_POOL_ALLOWED, 'Allocated more buffers than requested');
        assert(buffers_pool.buffers.length === MAX_POOL_ALLOWED, 'Buffer pool allocated more than semaphore allows');
        assert(buffers_pool.sem.value === SEM_LIMIT, 'Smepahore did not deallocate after buffers release');
        // Re-use buffer pool and verify that we do not allocate new buffers and respect the semaphore
        const from_pool_allocation = from_pool_fill.map(async () => {
            const { buffer, callback } = await buffers_pool.get_buffer();
            await new Promise((resolve, reject) => setTimeout(resolve, SLEEP_BEFORE_RELEASE));
            console.log('From pool allocations', buffer.length, buffers_pool.buffers.length, buffers_pool.sem.value);
            callback();
        });
        const from_pool_buffers = await Promise.all(from_pool_allocation);
        assert(from_pool_buffers.length === MAX_POOL_ALLOWED * 2, 'Allocated more buffers than requested');
        assert(buffers_pool.buffers.length === MAX_POOL_ALLOWED, 'Buffer pool allocated more than semaphore allows');
        assert(buffers_pool.sem.value === SEM_LIMIT, 'Smepahore did not deallocate after buffers release');
    });

    mocha.it('Work parallel with buffers with different sizes and different semaphores', async function() {
        const BUF_LIMIT1 = 4 * 1024;
        const SEM_LIMIT1 = 1024 * BUF_LIMIT1;
        const BUF_LIMIT2 = 64 * 1024;
        const SEM_LIMIT2 = 256 * BUF_LIMIT2;
        const BUF_LIMIT3 = 1 * 1024 * 1024;
        const SEM_LIMIT3 = 128 * BUF_LIMIT3;
        const MAX_POOL_ALLOWED1 = SEM_LIMIT1 / BUF_LIMIT1;
        const SLEEP_BEFORE_RELEASE = 264;
        const multi_buffer_pool = new buffer_utils.MultiSizeBuffersPool({
            sorted_buf_sizes: [{
                size: BUF_LIMIT1,
                sem_size: SEM_LIMIT1,
            }, {
                size: BUF_LIMIT2,
                sem_size: SEM_LIMIT2,
            }, {
                size: BUF_LIMIT3,
                sem_size: SEM_LIMIT3,
            }],
            warning_timeout: 0,
        });
        const lazy_fill = new Array(MAX_POOL_ALLOWED1 + 2).fill(0);
        const from_pool_allocation = lazy_fill.map(async () => {
            const { buffer, callback } = await multi_buffer_pool.get_buffers_pool(BUF_LIMIT1 - 500).get_buffer();
            await new Promise((resolve, reject) => setTimeout(resolve, SLEEP_BEFORE_RELEASE));
            console.log('From pool allocations', buffer.length,
                multi_buffer_pool.pools[0].buffers.length, multi_buffer_pool.pools[0].sem.value);
            assert(buffer.length === BUF_LIMIT1, 'Allocated different buffer size than expected');
            callback();
        });
        let buf = await multi_buffer_pool.get_buffers_pool(BUF_LIMIT1 + 500).get_buffer();
        console.log('From pool allocations', buf.buffer.length,
            multi_buffer_pool.pools[1].buffers.length, multi_buffer_pool.pools[1].sem.value);
        buf.callback();
        assert(buf.buffer.length === BUF_LIMIT2, 'Allocated different buffer size than expected');
        const from_pool_buffers = await Promise.all(from_pool_allocation);
        assert(from_pool_buffers.length === MAX_POOL_ALLOWED1 + 2, 'Allocated more buffers than requested');
        assert(multi_buffer_pool.pools[0].buffers.length === MAX_POOL_ALLOWED1,
            `Buffer pool allocated more than semaphore allows: ${multi_buffer_pool.pools[0].buffers.length}`);
        assert(multi_buffer_pool.pools[0].sem.value === SEM_LIMIT1, 'Sempahore did not deallocate after buffers release');
        buf = await multi_buffer_pool.get_buffers_pool(BUF_LIMIT2 + 500).get_buffer();
        console.log('From pool allocations', buf.buffer.length,
            multi_buffer_pool.pools[2].buffers.length, multi_buffer_pool.pools[2].sem.value);
        buf.callback();
        assert(buf.buffer.length === BUF_LIMIT3, 'Allocated different buffer size than expected');
        buf = await multi_buffer_pool.get_buffers_pool(0).get_buffer();
        assert(buf.buffer.length === BUF_LIMIT1, 'Allocated different buffer size than expected for 0 size');
        buf = await multi_buffer_pool.get_buffers_pool(undefined).get_buffer();
        assert(buf.buffer.length === BUF_LIMIT3, 'Allocated different buffer size than expected for undefined');
        buf = await multi_buffer_pool.get_buffers_pool(-1).get_buffer();
        assert(buf.buffer.length === BUF_LIMIT3, 'Allocated different buffer size than expected for negative');
    });


    mocha.it('picks pool by is_default, min_size, is_overcommit', async function() {
        const SIZE_S = 1024;
        const SIZE_M = 4 * SIZE_S;
        const SIZE_L = 4 * SIZE_M;
        const SIZE_XL = 4 * SIZE_L;
        const MIN_SIZE_XL = SIZE_XL / 2;
        const NUM_BUFFERS = 8;
        const multi_buffer_pool = new buffer_utils.MultiSizeBuffersPool({
            sorted_buf_sizes: [{
                size: SIZE_S,
                sem_size: SIZE_S * NUM_BUFFERS,
            }, {
                size: SIZE_M,
                sem_size: SIZE_M * NUM_BUFFERS,
            }, {
                size: SIZE_L,
                sem_size: SIZE_L * NUM_BUFFERS,
                is_default: true,
            }, {
                size: SIZE_XL,
                sem_size: SIZE_XL * NUM_BUFFERS,
                min_size: MIN_SIZE_XL,
                is_overcommit: true,
            }],
        });

        /**
         * @param {number} expected_size 
         * @param {boolean} allow_overcommit
         * @param {any} size
         */
        const expect = (expected_size, allow_overcommit, size) => {
            const bp = multi_buffer_pool.get_buffers_pool(size, allow_overcommit);
            assert.strictEqual(bp.buf_size, expected_size, `get_buffers_pool(${size}) returned pool ${bp.buf_size} expected ${expected_size}`);
        };

        /**
         * @param {number} expected_size 
         * @param {any} size
         */
        const expect_always = (expected_size, size) => {
            expect(expected_size, false, size);
            expect(expected_size, true, size);
        };

        expect_always(SIZE_S, 0);
        expect_always(SIZE_S, 1);
        expect_always(SIZE_S, SIZE_S - 1);
        expect_always(SIZE_S, SIZE_S);

        expect_always(SIZE_M, SIZE_S + 1);
        expect_always(SIZE_M, SIZE_S * 2);
        expect_always(SIZE_M, SIZE_M - 1);
        expect_always(SIZE_M, SIZE_M);

        expect_always(SIZE_L, SIZE_M + 1);
        expect_always(SIZE_L, SIZE_M * 2);
        expect_always(SIZE_L, SIZE_L - 1);
        expect_always(SIZE_L, SIZE_L);
        expect_always(SIZE_L, SIZE_L + 1);
        expect_always(SIZE_L, MIN_SIZE_XL - 1);

        // edge cases pick default pool (probably config/calculation error)
        expect_always(SIZE_L, -1);
        expect_always(SIZE_L, '1');
        expect_always(SIZE_L, 1n);
        expect_always(SIZE_L, false);
        expect_always(SIZE_L, NaN);
        expect_always(SIZE_L, Infinity);
        expect_always(SIZE_L, -Infinity);
        expect_always(SIZE_L, undefined);

        // no overcommit
        expect(SIZE_L, false, MIN_SIZE_XL);
        expect(SIZE_L, false, MIN_SIZE_XL + 1);
        expect(SIZE_L, false, SIZE_XL - 1);
        expect(SIZE_L, false, SIZE_XL);
        expect(SIZE_L, false, SIZE_XL + 1);
        expect(SIZE_L, false, SIZE_XL * 1000000000);

        // with overcommit
        expect(SIZE_XL, true, MIN_SIZE_XL);
        expect(SIZE_XL, true, MIN_SIZE_XL + 1);
        expect(SIZE_XL, true, SIZE_L * 2);
        expect(SIZE_XL, true, SIZE_XL - 1);
        expect(SIZE_XL, true, SIZE_XL);
        expect(SIZE_XL, true, SIZE_XL + 1);
        expect(SIZE_XL, true, SIZE_XL * 1000000000);
    });

    mocha.it('releases unused buffers', async function() {
        // @ts-ignore
        this.timeout(60000); // eslint-disable-line no-invalid-this
        const DT = 100;
        const BUF_SIZE = 1024;
        const NUM_BUFFERS = 8;
        const SEM_LIMIT = BUF_SIZE * NUM_BUFFERS;
        const bp = new buffer_utils.BuffersPool({
            buf_size: BUF_SIZE,
            sem: new semaphore.Semaphore(SEM_LIMIT, {
                timeout: DT * 2,
                timeout_error_code: 'TEST_BUFFER_POOL_TIMEOUT',
            }),
            warning_timeout: DT * 2,
            release_unused_interval: DT,
        });

        /**
         * @param {number} n 
         * @returns {Promise<Array<{ buffer: Buffer, callback: () => void }>>}
         */
        const allocate = async n => await Promise.all(new Array(n).fill(0).map(() => bp.get_buffer()));

        /**
         * @param {Array<{ buffer: Buffer, callback: () => void }>} allocs 
         */
        const deallocate = allocs => allocs.forEach(alloc => alloc.callback());

        await new Promise(r => setTimeout(r, DT / 4));
        for (let t = 0; t < 100; t++) {
            const used = Math.floor(Math.random() * (NUM_BUFFERS + 1));
            const unused = Math.max(bp.buffers.length - used, 0);
            console.log(`Test iteration ${t} buffers ${bp.buffers.length} used ${used} unused ${unused} sem ${bp.sem.value}`);
            const allocs = await allocate(used);
            assert.strictEqual(bp.buffers.length, unused, 'buffers.length != unused after allocation');
            assert.strictEqual(bp.sem.value, SEM_LIMIT - used * BUF_SIZE, 'sem.value != SEM_LIMIT - used * BUF_SIZE');
            deallocate(allocs);
            assert.strictEqual(bp.buffers.length, unused + used, 'buffers.length != unused + used after deallocation');
            assert.strictEqual(bp.sem.value, SEM_LIMIT, 'sem.value != SEM_LIMIT after deallocation');
            await new Promise(r => setTimeout(r, DT));
            assert.strictEqual(bp.buffers.length, used, 'buffers.length != used after release interval');
            assert.strictEqual(bp.sem.value, SEM_LIMIT, 'sem.value != SEM_LIMIT after release interval');
        }

    });

});
