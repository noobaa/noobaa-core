/* Copyright (C) 2020 NooBaa */
'use strict';

const config = require('../../../../config');
const file_writer_hashing = require('../../../tools/file_writer_hashing');
const orig_iov_max = config.NSFS_DEFAULT_IOV_MAX;

// on iov_max small tests we need to use smaller amount of parts and chunks to ensure that the test will finish
// in a reasonable period of time because we will flush max 1/2 buffers at a time.
const small_iov_num_parts = 20;

describe('FileWriter', () => {
    const RUN_TIMEOUT = 10 * 60 * 1000;

    afterEach(() => {
        config.NSFS_DEFAULT_IOV_MAX = orig_iov_max;
    });

    it('Concurrent FileWriter with hash target', async () => {
        await file_writer_hashing.hash_target();
    }, RUN_TIMEOUT);

    it('Concurrent FileWriter with file target', async () => {
        await file_writer_hashing.file_target();
    }, RUN_TIMEOUT);

    it('Concurrent FileWriter with hash target - iov_max=1', async () => {
        await file_writer_hashing.hash_target(undefined, small_iov_num_parts, 1);
    }, RUN_TIMEOUT);

    it('Concurrent FileWriter with file target - iov_max=1', async () => {
        await file_writer_hashing.file_target(undefined, small_iov_num_parts, 1);
    }, RUN_TIMEOUT);

    it('Concurrent FileWriter with hash target - iov_max=2', async () => {
        await file_writer_hashing.hash_target(undefined, small_iov_num_parts, 2);
    }, RUN_TIMEOUT);

    it('Concurrent FileWriter with file target - iov_max=2', async () => {
        await file_writer_hashing.file_target(undefined, small_iov_num_parts, 2);
    }, RUN_TIMEOUT);

    it('Concurrent FileWriter with file target - produce num_chunks > 1024 && total_chunks_size < config.NSFS_BUF_SIZE_L', async () => {
        // The goal of this test is to produce num_chunks > 1024 && total_chunks_size < config.NSFS_BUF_SIZE_L
        // so we will flush buffers because of reaching max num of buffers and not because we reached the max NSFS buf size
        // chunk size = 100, num_chunks = (10 * 1024 * 1024)/100 < 104587, 104587 = num_chunks > 1024 
        // chunk size = 100, total_chunks_size after having 1024 chunks is = 100 * 1024 < config.NSFS_BUF_SIZE_L
        const chunk_size = 100;
        const parts_s = 50;
        await file_writer_hashing.file_target(chunk_size, parts_s);
    }, RUN_TIMEOUT);
});
