/* Copyright (C) 2020 NooBaa */
'use strict';

const config = require('../../../../config');
const file_writer_hashing = require('../../../tools/file_writer_hashing');
const orig_iov_max = config.NSFS_DEFAULT_IOV_MAX;

// CI-friendly scale: enough concurrency to exercise FileWriter without multi-minute runs.
const default_num_parts = 50;
const default_part_size = 2 * 1024 * 1024;

// on iov_max small tests we need to use smaller amount of parts and chunks to ensure that the test will finish
// in a reasonable period of time because we will flush max 1/2 buffers at a time.
const small_iov_num_parts = 20;

describe('FileWriter', () => {
    const RUN_TIMEOUT = 3 * 60 * 1000;

    afterEach(() => {
        config.NSFS_DEFAULT_IOV_MAX = orig_iov_max;
    });

    it('Concurrent FileWriter with hash target', async () => {
        await file_writer_hashing.hash_target(undefined, default_num_parts, undefined, default_part_size);
    }, RUN_TIMEOUT);

    it('Concurrent FileWriter with file target', async () => {
        await file_writer_hashing.file_target(undefined, default_num_parts, undefined, default_part_size);
    }, RUN_TIMEOUT);

    it('Concurrent FileWriter with hash target - iov_max=1', async () => {
        await file_writer_hashing.hash_target(undefined, small_iov_num_parts, 1, default_part_size);
    }, RUN_TIMEOUT);

    it('Concurrent FileWriter with file target - iov_max=1', async () => {
        await file_writer_hashing.file_target(undefined, small_iov_num_parts, 1, default_part_size);
    }, RUN_TIMEOUT);

    it('Concurrent FileWriter with hash target - iov_max=2', async () => {
        await file_writer_hashing.hash_target(undefined, small_iov_num_parts, 2, default_part_size);
    }, RUN_TIMEOUT);

    it('Concurrent FileWriter with file target - iov_max=2', async () => {
        await file_writer_hashing.file_target(undefined, small_iov_num_parts, 2, default_part_size);
    }, RUN_TIMEOUT);

    it('Concurrent FileWriter with file target - produce num_chunks > 1024 && total_chunks_size < config.NSFS_BUF_SIZE_L', async () => {
        // The goal of this test is to produce num_chunks > 1024 && total_chunks_size < config.NSFS_BUF_SIZE_L
        // so we will flush buffers because of reaching max num of buffers and not because we reached the max NSFS buf size
        // chunk size = 100, part_size = 128KiB => num_chunks = 1310 > 1024
        // chunk size = 100, total_chunks_size after having 1024 chunks is = 100 * 1024 < config.NSFS_BUF_SIZE_L
        const chunk_size = 100;
        const parts_s = 20;
        const part_size = 128 * 1024;
        await file_writer_hashing.file_target(chunk_size, parts_s, undefined, part_size);
    }, RUN_TIMEOUT);
});
