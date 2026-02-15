/* Copyright (C) 2020 NooBaa */
/*eslint max-lines-per-function: ["error", 600]*/
'use strict';


const util = require('util');
const path = require('path');
const mocha = require('mocha');
const assert = require('assert');
const crypto = require('crypto');
const fs_utils = require('../../../util/fs_utils');
const NamespaceFS = require('../../../sdk/namespace_fs');
const buffer_utils = require('../../../util/buffer_utils');
const native_fs_utils = require('../../../util/native_fs_utils');
const { TMP_PATH, invalid_nsfs_root_permissions } = require('../../system_tests/test_utils');


function make_dummy_object_sdk(nsfs_config, uid, gid) {
    return {
        requesting_account: {
            nsfs_account_config: nsfs_config && {
                uid: uid || process.getuid(),
                gid: gid || process.getgid(),
            }
        },
        abort_controller: new AbortController(),
        throw_if_aborted() {
            if (this.abort_controller.signal.aborted) throw new Error('request aborted signal');
        },
        read_bucket_full_info(name) {
            return {};
        }
    };
}

mocha.describe('namespace_fs - versioning', function() {

    mocha.before(function() {
        if (invalid_nsfs_root_permissions()) this.skip(); // eslint-disable-line no-invalid-this
    });
    const bucket_name = 'bucket';
    const tmp_fs_root = path.join(TMP_PATH, 'test_nsfs_versioning');
    const ns_tmp_bucket_path = `${tmp_fs_root}/${bucket_name}`;

    mocha.before(async () => fs_utils.create_fresh_path(tmp_fs_root, 0o777));
    mocha.before(async () => fs_utils.create_fresh_path(ns_tmp_bucket_path, 0o770));
    mocha.after(async () => fs_utils.folder_delete(tmp_fs_root));

    const dummy_object_sdk = make_dummy_object_sdk(true);
    const dummy_object_sdk_no_nsfs_config = make_dummy_object_sdk(false);
    const dummy_object_sdk_no_nsfs_permissions = make_dummy_object_sdk(true, 1055, 1055);
    const ns_tmp = new NamespaceFS({ bucket_path: ns_tmp_bucket_path, bucket_id: '1', namespace_resource_id: undefined });

    mocha.it('set bucket versioning - Enabled - should fail - no permissions', async function() {
        try {
            await ns_tmp.set_bucket_versioning('ENABLED', dummy_object_sdk_no_nsfs_permissions);
            assert.fail(`put bucket versioning succeeded for account without permissions`);
        } catch (err) {
            assert.equal(err.rpc_code, 'UNAUTHORIZED');
        }
    });

    mocha.it('set bucket versioning - Enabled - should fail - no nsfs config', async function() {
        try {
            await ns_tmp.set_bucket_versioning('ENABLED', dummy_object_sdk_no_nsfs_config);
            assert.fail(`put bucket versioning succeeded for account without permissions`);
        } catch (err) {
            assert.equal(err.rpc_code, 'UNAUTHORIZED');
        }
    });

    mocha.it('set bucket versioning - Enabled', async function() {
        await ns_tmp.set_bucket_versioning('ENABLED', dummy_object_sdk);
    });

    mocha.it('upload object - Enabled', async function() {
        const file_key = 'file1.txt';
        const data = crypto.randomBytes(100);
        const source = buffer_utils.buffer_to_read_stream(data);
        const upload_res = await ns_tmp.upload_object({
            bucket: bucket_name,
            key: file_key,
            source_stream: source
        }, dummy_object_sdk);
        console.log('upload_object response', util.inspect(upload_res));
    });

    mocha.it('safe move posix - Enabled - should fail, retry, success', async function() {
        const file_key = 'file1.txt';
        const from_path = path.join(ns_tmp_bucket_path, file_key);
        const to_path = path.join(ns_tmp_bucket_path, file_key + '_mtime-1-ino-2');
        const fake_mtime_ino = { mtimeNsBigint: BigInt(0), ino: 0 };
        try {
            const bucket_tmp_dir_path = ns_tmp.get_bucket_tmpdir_full_path();
            await native_fs_utils.safe_move_posix(
                dummy_object_sdk.requesting_account.nsfs_account_config,
                from_path,
                to_path,
                fake_mtime_ino,
                bucket_tmp_dir_path
            );
            assert.fail(`safe_move_posix succeeded but should have failed`);
        } catch (err) {
            assert.equal(err.message, 'FS::SafeLink ERROR link target doesn\'t match expected inode and mtime');
        }
    });

    mocha.it('safe move posix - Enabled - should fail', async function() {
        const file_key2 = 'file2.txt';
        const from_path = path.join(ns_tmp_bucket_path, file_key2);
        const to_path = path.join(ns_tmp_bucket_path, file_key2 + '_mtime-1-ino-2');
        const fake_mtime_ino = { mtimeNsBigint: BigInt(0), ino: 0 };
        try {
            const bucket_tmp_dir_path = ns_tmp.get_bucket_tmpdir_full_path();
            await native_fs_utils.safe_move_posix(
                dummy_object_sdk.requesting_account.nsfs_account_config,
                from_path,
                to_path,
                fake_mtime_ino,
                bucket_tmp_dir_path
            );
            assert.fail(`safe_move_posix succeeded but should have failed`);
        } catch (err) {
            assert.equal(err.code, 'ENOENT');
        }
    });
});

