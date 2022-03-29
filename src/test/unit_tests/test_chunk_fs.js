/* Copyright (C) 2020 NooBaa */
/* eslint-disable no-invalid-this */
'use strict';

const mocha = require('mocha');
const chunk_fs_hashing = require('../../tools/chunk_fs_hashing');

mocha.describe('ChunkFS', function() {
    const RUN_TIMEOUT = 10 * 60 * 1000;

    mocha.it('Concurrent ChunkFS with hash target', async function() {
        const self = this;
        self.timeout(RUN_TIMEOUT);
        await chunk_fs_hashing.hash_target();
    });

    mocha.it('Concurrent ChunkFS with file target', async function() {
        const self = this;
        self.timeout(RUN_TIMEOUT);
        await chunk_fs_hashing.file_target();
    });

    mocha.it('Concurrent ChunkFS with file target - produce num_chunks > 1024 && total_chunks_size < config.NSFS_BUF_SIZE', async function() {
        const self = this;
        self.timeout(RUN_TIMEOUT);
        // The goal of this test is to produce num_chunks > 1024 && total_chunks_size < config.NSFS_BUF_SIZE
        // so we will flush buffers because of reaching max num of buffers and not because we reached the max NSFS buf size
        // chunk size = 100, num_chunks = (10 * 1024 * 1024)/100 < 104587, 104587 = num_chunks > 1024 
        // chunk size = 100, total_chunks_size after having 1024 chunks is = 100 * 1024 < config.NSFS_BUF_SIZE
        const chunk_size = 100;
        const parts_s = 50;
        await chunk_fs_hashing.file_target(chunk_size, parts_s);
    });
});
