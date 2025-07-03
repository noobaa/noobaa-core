/* Copyright (C) 2016 NooBaa */
'use strict';
const mocha = require('mocha');
const assert = require('assert');
const buffer_utils = require('../../util/buffer_utils');
const semaphore = require('../../util/semaphore');

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
            }, ],
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
});
