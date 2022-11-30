/* Copyright (C) 2020 NooBaa */
/*eslint max-lines-per-function: ["error", 600]*/
'use strict';


const mocha = require('mocha');
const assert = require('assert');
const coretest = require('./coretest');
const fs_utils = require('../../util/fs_utils');
const NamespaceFS = require('../../sdk/namespace_fs');

const MAC_PLATFORM = 'darwin';


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
        }
    };
}

mocha.describe('namespace_fs - versioning', function() {

    mocha.before(function() {
        if (process.getgid() !== 0 || process.getuid() !== 0) {
            coretest.log('No Root permissions found in env. Skipping test');
            this.skip(); // eslint-disable-line no-invalid-this
        }
    });
    const bucket_name = 'bucket';
    let tmp_fs_root = '/tmp/test_nsfs_versioning';
    if (process.platform === MAC_PLATFORM) {
        tmp_fs_root = '/private/' + tmp_fs_root;
    }
    const ns_tmp_bucket_path = `${tmp_fs_root}/${bucket_name}`;

    mocha.before(async () => fs_utils.create_fresh_path(tmp_fs_root, 0o777));
    mocha.before(async () => fs_utils.create_fresh_path(ns_tmp_bucket_path, 0o770));
    mocha.after(async () => fs_utils.folder_delete(tmp_fs_root));

    const dummy_object_sdk = make_dummy_object_sdk(true);
    const dummy_object_sdk_no_nsfs_config = make_dummy_object_sdk(false);
    const dummy_object_sdk_no_nsfs_permissions = make_dummy_object_sdk(true, 5, 5);
    const ns_tmp = new NamespaceFS({ bucket_path: ns_tmp_bucket_path, bucket_id: '1', namespace_resource_id: undefined });

    mocha.it('set bucket versioning - Enabled - should fail - no permissions', async function() {
        try {
            await ns_tmp.set_bucket_versioning({
                name: bucket_name,
                versioning: 'ENABLED'
            }, dummy_object_sdk_no_nsfs_permissions);
            assert.fail(`put bucket versioning succeeded for account without permissions`);
        } catch (err) {
            assert.equal(err.rpc_code, 'UNAUTHORIZED');
        }
    });

    mocha.it('set bucket versioning - Enabled - should fail - no nsfs config', async function() {
        try {
            await ns_tmp.set_bucket_versioning({
                name: bucket_name,
                versioning: 'ENABLED'
            }, dummy_object_sdk_no_nsfs_config);
            assert.fail(`put bucket versioning succeeded for account without permissions`);
        } catch (err) {
            assert.equal(err.rpc_code, 'UNAUTHORIZED');
        }
    });

    mocha.it('set bucket versioning - Enabled', async function() {
        await ns_tmp.set_bucket_versioning({
            name: bucket_name,
            versioning: 'ENABLED'
        }, dummy_object_sdk);
    });
});
