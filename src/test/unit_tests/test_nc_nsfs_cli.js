/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const path = require('path');
const mocha = require('mocha');
const assert = require('assert');
const P = require('../../util/promise');
const fs_utils = require('../../util/fs_utils');
const os_util = require('../../util/os_utils');
const nb_native = require('../../util/nb_native');

const MAC_PLATFORM = 'darwin';
let tmp_fs_path = '/tmp/test_bucketspace_fs';
if (process.platform === MAC_PLATFORM) {
    tmp_fs_path = '/private/' + tmp_fs_path;
}
const DEFAULT_FS_CONFIG = {
    uid: process.getuid(),
    gid: process.getgid(),
    backend: '',
    warn_threshold_ms: 100,
};

const nc_nsfs_manage_entity_types = {
    BUCKET: 'bucket',
    ACCOUNT: 'account'
};

const nc_nsfs_manage_actions = {
    ADD: 'add',
    UPDATE: 'update',
    DELETE: 'delete'
};

mocha.describe('manage_nsfs cli', function() {

    const config_root = path.join(tmp_fs_path, 'config_root_manage_nsfs');
    const root_path = path.join(tmp_fs_path, 'root_path_manage_nsfs/');
    const buckets = 'buckets';
    const accounts = 'accounts';

    mocha.before(async () => {
        await P.all(_.map([accounts, buckets], async dir =>
            fs_utils.create_fresh_path(`${config_root}/${dir}`)));
        await fs_utils.create_fresh_path(root_path);

    });
    mocha.after(async () => {
        fs_utils.folder_delete(`${config_root}`);
        fs_utils.folder_delete(`${root_path}`);
    });

    mocha.describe('cli bucket flow - happy path', async function() {
        const type = nc_nsfs_manage_entity_types.BUCKET;
        const bucket_name = 'bucket1';
        let owner_email = 'user1@noobaa.io';
        const bucket_path = `${root_path}${bucket_name}/`;
        const schema_dir = 'buckets';
        const bucket_options = { config_root, bucket_name, owner_email, bucket_path };
        mocha.it('cli bucket create', async function() {
            const action = nc_nsfs_manage_actions.ADD;
            await fs_utils.create_fresh_path(bucket_path);
            await fs_utils.file_must_exist(bucket_path);
            await exec_manage_cli(type, action, bucket_options);
            const bucket = await read_config_file(config_root, schema_dir, bucket_name);
            assert_bucket(bucket, bucket_options);
        });

        mocha.it('cli bucket update', async function() {
            const action = nc_nsfs_manage_actions.UPDATE;
            owner_email = 'user2@noobaa.io';
            await exec_manage_cli(type, action, bucket_options);
            const bucket = await read_config_file(config_root, schema_dir, bucket_name);
            assert_bucket(bucket, bucket_options);
        });

        mocha.it('cli bucket delete', async function() {
            const action = nc_nsfs_manage_actions.DELETE;
            await exec_manage_cli(type, action, bucket_options);
            try {
                await read_config_file(config_root, schema_dir, bucket_name);
                throw new Error('cli bucket delete failed - bucket config file exists after deletion');
            } catch (err) {
                if (err.code !== 'ENOENT') {
                    throw new Error('cli bucket delete failed - read file failed with the following error - ', err.code);
                }
            }
        });
    });

    mocha.describe('cli account flow - happy path', async function() {
        const type = nc_nsfs_manage_entity_types.ACCOUNT;
        const name = 'account1';
        const email = 'account1@noobaa.io';
        const new_buckets_path = `${root_path}new_buckets_path_user1/`;
        const uid = 999;
        const gid = 999;
        const access_key = 'abc';
        const secret_key = '123';
        const account_options = { config_root, name, email, new_buckets_path, uid, gid, access_key, secret_key };
        const schema_dir = 'accounts';

        mocha.it('cli account create', async function() {
            const action = nc_nsfs_manage_actions.ADD;
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await exec_manage_cli(type, action, account_options);
            const account = await read_config_file(config_root, schema_dir, access_key);
            assert_account(account, account_options);
        });

        mocha.it('cli account update', async function() {
            const action = nc_nsfs_manage_actions.UPDATE;
            account_options.account_email = 'account2@noobaa.io';
            account_options.uid = 222;
            account_options.gid = 222;
            await exec_manage_cli(type, action, account_options);
            const account = await read_config_file(config_root, schema_dir, access_key);
            assert_account(account, account_options);
        });

        mocha.it('cli account delete', async function() {
            const action = nc_nsfs_manage_actions.DELETE;
            await exec_manage_cli(type, action, { config_root, access_key });
            try {
                await read_config_file(config_root, schema_dir, access_key);
                throw new Error('cli account delete failed - account config file exists after deletion');
            } catch (err) {
                if (err.code !== 'ENOENT') {
                    throw new Error('cli account delete failed - read file failed with the following error - ', err.code);
                }
            }
        });
    });

});

async function read_config_file(config_root, schema_dir, config_file_name) {
    const config_path = path.join(config_root, schema_dir, config_file_name + '.json');
    const { data } = await nb_native().fs.readFile(DEFAULT_FS_CONFIG, config_path);
    const config = JSON.parse(data.toString());
    return config;
}

function assert_bucket(bucket, bucket_options) {
    assert.strictEqual(bucket.name, bucket_options.bucket_name);
    assert.strictEqual(bucket.system_owner, bucket_options.owner_email);
    assert.strictEqual(bucket.bucket_owner, bucket_options.owner_email);
    assert.strictEqual(bucket.path, bucket_options.bucket_path);
    assert.strictEqual(bucket.should_create_underlying_storage, false);
    assert.strictEqual(bucket.versioning, 'DISABLED');
    return true;
}

function assert_account(account, account_options) {
    assert.deepStrictEqual(account.access_keys[0].access_key, account_options.access_key);
    assert.deepStrictEqual(account.access_keys[0].secret_key, account_options.secret_key);
    assert.equal(account.email, account_options.email);
    assert.equal(account.name, account_options.name);
    assert.equal(account.nsfs_account_config.uid, account_options.uid);
    assert.equal(account.nsfs_account_config.gid, account_options.gid);
    assert.equal(account.nsfs_account_config.new_buckets_path, account_options.new_buckets_path);
    return true;
}

async function exec_manage_cli(type, action, options) {
    const flags = type === 'bucket' ?
        `--name ${options.bucket_name} --email ${options.owner_email} --path ${options.bucket_path}` :
        `--name ${options.name} --email ${options.email} --new_buckets_path ${options.new_buckets_path} --access_key ${options.access_key} --secret_key ${options.secret_key} --uid ${options.uid} --gid ${options.gid}`;
    const add_res = await os_util.exec(`node src/cmd/manage_nsfs ${type} ${action} --config_root ${options.config_root} ${flags}`, { return_stdout: true });
    return add_res;
}
