/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const mocha = require('mocha');
const assert = require('assert');
const fs_utils = require('../../../util/fs_utils');
const nb_native = require('../../../util/nb_native');
const { get_process_fs_context } = require('../../../util/native_fs_utils');

const DEFAULT_FS_CONFIG = get_process_fs_context('GPFS');

mocha.describe('nb_native fs', function() {

    mocha.it('gpfs linkat - success', async function() {
        const { open } = nb_native().fs;
        const dir_path = '/gpfs/gpfs1/';
        const PATH = `link_success${Date.now()}_1`;
        const full_path = dir_path + PATH;

        const temp_file = await open(DEFAULT_FS_CONFIG, dir_path, 'wt');
        await temp_file.linkfileat(DEFAULT_FS_CONFIG, full_path);
        await temp_file.close(DEFAULT_FS_CONFIG);
        await fs_utils.file_must_exist(full_path);

    });

    mocha.it('gpfs linkat - success', async function() {
        const { open } = nb_native().fs;
        const dir_path = '/gpfs/gpfs1/';
        const PATH = `unlink${Date.now()}_2`;
        const full_path = dir_path + PATH;

        await create_file(full_path);
        const p2_file = await open(DEFAULT_FS_CONFIG, full_path);

        const temp_file = await open(DEFAULT_FS_CONFIG, dir_path, 'wt');
        await temp_file.linkfileat(DEFAULT_FS_CONFIG, full_path, p2_file.fd);
        await temp_file.close(DEFAULT_FS_CONFIG);
        await p2_file.close(DEFAULT_FS_CONFIG);
        await fs_utils.file_must_exist(full_path);

    });

    mocha.it('gpfs linkat - failure', async function() {
        const { open } = nb_native().fs;
        const dir_path = '/gpfs/gpfs1/';
        const PATH = `unlink${Date.now()}_2`;
        const full_path = dir_path + PATH;

        await create_file(full_path);
        const p2_file = await open(DEFAULT_FS_CONFIG, full_path);
        const temp_file = await open(DEFAULT_FS_CONFIG, dir_path, 'wt');
        try {
            await temp_file.linkfileat(DEFAULT_FS_CONFIG, full_path, p2_file.fd);
        } catch (err) {
            assert.equal(err.code, 'EEXIST');
        }
        await temp_file.close(DEFAULT_FS_CONFIG);
        await p2_file.close(DEFAULT_FS_CONFIG);
    });

    mocha.it('gpfs unlinkat - failure - verified fd = 0', async function() {
        const dir_path = '/gpfs/gpfs1/';
        const PATH1 = `unlink${Date.now()}_1`;
        const full_p = dir_path + PATH1;

        await create_file(full_p);
        const dir_file = await nb_native().fs.open(DEFAULT_FS_CONFIG, dir_path);
        try {
            await dir_file.unlinkfileat(DEFAULT_FS_CONFIG, PATH1);
        } catch (err) {
            assert.equal(err.code, 'EINVAL');
        } finally {
            await dir_file.close(DEFAULT_FS_CONFIG);
        }
        await fs_utils.file_must_exist(full_p);
        });

    mocha.it('gpfs unlinkat - success - gpfs verification', async function() {
        const dir_path = '/gpfs/gpfs1/';
        const PATH1 = `unlink${Date.now()}_1`;
        const full_p = dir_path + PATH1;

        await create_file(full_p);
        const dir_file = await nb_native().fs.open(DEFAULT_FS_CONFIG, dir_path);
        const file = await nb_native().fs.open(DEFAULT_FS_CONFIG, full_p);
        await dir_file.unlinkfileat(DEFAULT_FS_CONFIG, PATH1, file.fd);
        await fs_utils.file_must_not_exist(full_p);
        await dir_file.close(DEFAULT_FS_CONFIG);
        await file.close(DEFAULT_FS_CONFIG);
    });

    mocha.it('gpfs unlink - failure EEXIST', async function() {
        const dir_path = '/gpfs/gpfs1/';
        const PATH1 = `unlink${Date.now()}_1`;
        const PATH2 = `unlink${Date.now()}_2`;
        const full_p = dir_path + PATH1;
        const full_p2 = dir_path + PATH2;

        await create_file(full_p);
        await create_file(full_p2);
        const dir_file = await nb_native().fs.open(DEFAULT_FS_CONFIG, dir_path);
        const file = await nb_native().fs.open(DEFAULT_FS_CONFIG, full_p);
        const file2 = await nb_native().fs.open(DEFAULT_FS_CONFIG, full_p2);
        await file2.linkfileat(DEFAULT_FS_CONFIG, full_p);
        try {
            await dir_file.unlinkfileat(DEFAULT_FS_CONFIG, PATH1, file.fd);
        } catch (err) {
            assert.equal(err.code, 'EEXIST');
            await fs_utils.file_must_exist(full_p);
        } finally {
            await file2.close(DEFAULT_FS_CONFIG);
            await file.close(DEFAULT_FS_CONFIG);
            await dir_file.close(DEFAULT_FS_CONFIG);
        }
    });

    // non existing throw invalid argument
    mocha.it('gpfs unlink - failure EINVAL', async function() {
        const dir_path = '/gpfs/gpfs1/';
        const PATH1 = `unlink${Date.now()}_1`;
        const full_p = dir_path + PATH1;
        await create_file(full_p);
        const dir_file = await nb_native().fs.open(DEFAULT_FS_CONFIG, dir_path);
        try {
            await dir_file.unlinkfileat(DEFAULT_FS_CONFIG, PATH1, 135); // 135
        } catch (err) {
            assert.equal(err.code, 'EINVAL');
        } finally {
            await dir_file.close(DEFAULT_FS_CONFIG);
        }
        await fs_utils.file_must_exist(full_p);
    });
});

function create_file(file_path) {
    return fs.promises.appendFile(file_path, file_path + '\n');
}
