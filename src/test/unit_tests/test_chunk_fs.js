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
});
