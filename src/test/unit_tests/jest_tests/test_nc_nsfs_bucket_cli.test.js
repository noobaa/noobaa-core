/* Copyright (C) 2016 NooBaa */
/* eslint-disable no-undef */
'use strict';

// disabling init_rand_seed as it takes longer than the actual test execution
process.env.DISABLE_INIT_RANDOM_SEED = "true";

const _ = require('lodash');
const path = require('path');
const P = require('../../../util/promise');
const fs_utils = require('../../../util/fs_utils');
const os_util = require('../../../util/os_utils');
const config_module = require('../../../../config');
const native_fs_utils = require('../../../util/native_fs_utils');

const MAC_PLATFORM = 'darwin';
let tmp_fs_path = '/tmp/test_bucketspace_fs';
if (process.platform === MAC_PLATFORM) {
    tmp_fs_path = '/private/' + tmp_fs_path;
}
let bucket_storage_path;
let bucket_temp_dir_path;

const DEFAULT_FS_CONFIG = {
    uid: process.getuid(),
    gid: process.getgid(),
    backend: '',
    warn_threshold_ms: 100,
};

const nc_nsfs_manage_actions = {
    ADD: 'add',
    UPDATE: 'update',
    LIST: 'list',
    DELETE: 'delete',
    STATUS: 'status',
};

// eslint-disable-next-line max-lines-per-function
describe('manage nsfs cli account flow', () => {
    const buckets_schema_dir = 'buckets';

    describe('cli delete bucket', () => {
        const config_root = path.join(tmp_fs_path, 'config_root_manage_nsfs2');
        const root_path = path.join(tmp_fs_path, 'root_path_manage_nsfs2/');
        bucket_storage_path = path.join(tmp_fs_path, 'root_path_manage_nsfs2', 'bucket1');

        const account_defaults = {
            _id: '65a9fbe7ab49fd2fe430bc3f',
            type: 'account',
            name: 'account_test',
            email: 'account1@noobaa.io',
            new_buckets_path: `${root_path}new_buckets_path_user1/`,
            uid: 999,
            gid: 999,
            access_key: 'GIGiFAnjaaE7OKD5N7hX',
            secret_key: 'G2AYaMpU3zRDcRFWmvzgQr9MoHIAsD+3oEXAMPLE',
            creation_date: '2024-01-19T04:34:47.273Z',
        };

        const bucket_defaults = {
            type: 'bucket',
            name: 'bucket1',
            tag:'',
            owner_account: 'account_test',
            system_owner: 'account1@noobaa.io',
            bucket_owner: 'account1@noobaa.io',
            email: 'account1@noobaa.io',
            path: bucket_storage_path,
            should_create_underlying_storage: true,
            creation_date: '2024-01-19T04:34:47.273Z',
        };

        beforeEach(async () => {
            await P.all(_.map([buckets_schema_dir], async dir =>
                fs_utils.create_fresh_path(`${config_root}/${dir}`)));
            await fs_utils.create_fresh_path(root_path);
            await fs_utils.create_fresh_path(bucket_storage_path);
            const action = nc_nsfs_manage_actions.ADD;
            // Account add
            const { type: account_type, new_buckets_path: account_path } = account_defaults;
            const account_options = { config_root, ...account_defaults };
            await fs_utils.create_fresh_path(account_path);
            await fs_utils.file_must_exist(account_path);
            await exec_manage_cli(account_type, action, account_options);

            //bucket add
            const { type: bucket_type, path: bucket_path } = bucket_defaults;
            const bucket_options = { config_root, ...bucket_defaults };
            await fs_utils.create_fresh_path(bucket_path);
            await fs_utils.file_must_exist(bucket_path);
            const resp = await exec_manage_cli(bucket_type, action, bucket_options);
            const bucket_resp = JSON.parse(resp);
            expect(bucket_resp.response.reply._id).not.toBeNull();
            //create temp dir
            bucket_temp_dir_path = path.join(bucket_storage_path,
                config_module.NSFS_TEMP_DIR_NAME + "_" + bucket_resp.response.reply._id);
            await fs_utils.create_fresh_path(bucket_temp_dir_path);
            await fs_utils.file_must_exist(bucket_temp_dir_path);
        });

        afterEach(async () => {
            await fs_utils.folder_delete(`${config_root}`);
            await fs_utils.folder_delete(`${root_path}`);
        });

        it('cli delete bucket and delete temp dir', async () => {
            let is_path_exists = await native_fs_utils.is_path_exists(DEFAULT_FS_CONFIG, bucket_temp_dir_path);
            expect(is_path_exists).toBe(true);
            const account_options = { config_root, name: 'bucket1'};
            const action = nc_nsfs_manage_actions.DELETE;
            await exec_manage_cli('bucket', action, account_options);
            is_path_exists = await native_fs_utils.is_path_exists(DEFAULT_FS_CONFIG, bucket_temp_dir_path);
            expect(is_path_exists).toBe(false);
        });
    });
})

/**
 * exec_manage_cli will get the flags for the cli and runs the cli with it's flags
 * @param {string} type
 * @param {string} action
 * @param {object} options
 */
async function exec_manage_cli(type, action, options) {
    let account_flags = ``;
    for (const key in options) {
        if (Object.hasOwn(options, key)) {
            if (typeof options[key] === 'boolean') {
                account_flags += `--${key} `;
            } else {
                account_flags += `--${key} ${options[key]} `;
            }
        }
    }
    account_flags = account_flags.trim();

    const command = `node src/cmd/manage_nsfs ${type} ${action} ${account_flags}`;
    let res;
    try {
        res = await os_util.exec(command, { return_stdout: true });
    } catch (e) {
        res = e;
    }
    return res;
}