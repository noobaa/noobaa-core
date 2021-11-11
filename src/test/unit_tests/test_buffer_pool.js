/* Copyright (C) 2016 NooBaa */
'use strict';
const mocha = require('mocha');
const assert = require('assert');
const buffer_utils = require('../../util/buffer_utils');
const Semaphore = require('../../util/semaphore');

mocha.describe('Test buffers pool', function() {

    mocha.it('Work parallel with buf_size and respect semaphore', async function() {
        const SEM_LIMIT = 64 * 1024 * 1024;
        const BUF_LIMIT = 8 * 1024 * 1024;
        const MAX_POOL_ALLOWED = SEM_LIMIT / BUF_LIMIT;
        const SLEEP_BEFORE_RELEASE = 264;
        const buffers_pool_sem = new Semaphore(SEM_LIMIT);
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

});
