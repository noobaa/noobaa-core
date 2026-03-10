/* Copyright (C) 2020 NooBaa */
'use strict';


const path = require('path');
const mocha = require('mocha');
const assert = require('assert');
const config = require('../../../../config');
const fs_utils = require('../../../util/fs_utils');
const native_fs_utils = require('../../../util/native_fs_utils');
const nb_native = require('../../../util/nb_native');
const ObjectSDK = require('../../../sdk/object_sdk');
const test_utils = require('../../system_tests/test_utils');
const fs = require('fs');
const { TMP_PATH } = require('../../system_tests/test_utils');
const NamespaceFS = require('../../../sdk/namespace_fs');
const buffer_utils = require('../../../util/buffer_utils');
const endpoint_stats_collector = require('../../../sdk/endpoint_stats_collector');
const SensitiveString = require('../../../util/sensitive_string');
const { RpcError } = require('../../../rpc');

const new_umask = process.env.NOOBAA_ENDPOINT_UMASK || 0o000;
const old_umask = process.umask(new_umask);
console.log('test_nsfs_access: replacing old umask: ', old_umask.toString(8), 'with new umask: ', new_umask.toString(8));


mocha.describe('new tests check', async function() {
    const p = '/tmp/dir/';
    const root_dir = 'root_dir';
    const non_root_dir = 'non_root_dir';
    const non_root_dir2 = 'non_root_dir2';
    const full_path_root = path.join(p, root_dir);
    const full_path_non_root = path.join(full_path_root, non_root_dir);
    const full_path_non_root1 = path.join(p, non_root_dir);
    const full_path_non_root2 = path.join(p, non_root_dir2);

    const ROOT_FS_CONFIG = {
        uid: process.getuid(),
        gid: process.getgid(),
        backend: '',
        warn_threshold_ms: 100,
    };
    const NON_ROOT1_FS_CONFIG = {
        uid: 1572,
        gid: 1572,
        backend: '',
        warn_threshold_ms: 100,
    };

    const NON_ROOT2_FS_CONFIG = {
        uid: 1573,
        gid: 1573,
        backend: '',
        warn_threshold_ms: 100,
    };

    const NON_ROOT3_FS_CONFIG = {
        uid: 1574,
        gid: 1574,
        backend: '',
        supplemental_groups: [1572, 1577], //gid of non-root1 and unrelated gid
        warn_threshold_ms: 100,
    };

    mocha.before(async function() {
        if (test_utils.invalid_nsfs_root_permissions()) this.skip(); // eslint-disable-line no-invalid-this
        await fs_utils.create_fresh_path(p, 0o777);
        await fs_utils.file_must_exist(p);
        await fs_utils.create_fresh_path(full_path_root, 0o770);
        await fs_utils.file_must_exist(full_path_root);
    });

    mocha.after(async function() {
        this.timeout(60000); // eslint-disable-line no-invalid-this
        await fs_utils.folder_delete(p);
    });

    mocha.it('ROOT readdir - sucsses', async function() {
        const root_entries = await nb_native().fs.readdir(ROOT_FS_CONFIG, full_path_root);
        assert.equal(root_entries && root_entries.length, 0);
    });
    mocha.it('NON ROOT 1 readdir - failure', async function() {
        try {
            const non_root_entries = await nb_native().fs.readdir(NON_ROOT1_FS_CONFIG, full_path_root);
            assert.fail(`non root has access to root dir ${non_root_entries}`);
        } catch (err) {
            assert.equal(err.code, 'EACCES');
        }
    });
    mocha.it('NON ROOT 1 mkdir - failure', async function() {
        try {
            const mkdir_res = await nb_native().fs.mkdir(NON_ROOT1_FS_CONFIG, full_path_non_root, 0o770);
            assert.fail(`non root has access to mkdir under root dir ${mkdir_res}`);
        } catch (err) {
            assert.equal(err.code, 'EACCES');
        }
    });
    mocha.it('ROOT readdir - dir created by non dir - success', async function() {
        try {
            const root_entries = await nb_native().fs.readdir(ROOT_FS_CONFIG, full_path_non_root);
            assert.fail(`root has access to a folder that should not exist - ${root_entries}`);
        } catch (err) {
            assert.equal(err.code, 'ENOENT');
        }
    });

    mocha.it('NON ROOT 1 readdir - success', async function() {
        try {
            const non_root_entries = await nb_native().fs.readdir(NON_ROOT1_FS_CONFIG, full_path_non_root);
            assert.fail(`non root 1 has access to a folder created by root with 770 perm - ${p} - ${non_root_entries}`);
        } catch (err) {
            assert.equal(err.code, 'EACCES');
        }
    });

    mocha.it('NON ROOT 2 readdir - failure', async function() {
        try {
            const non_root_entries = await nb_native().fs.readdir(NON_ROOT2_FS_CONFIG, full_path_non_root);
            assert.fail(`non root 2 has access to a folder created by root with 770 perm - ${p} ${non_root_entries}`);
        } catch (err) {
            assert.equal(err.code, 'EACCES');
        }
    });

    mocha.it('NON ROOT 3 with suplemental group - success', async function() {
        await nb_native().fs.mkdir(NON_ROOT1_FS_CONFIG, full_path_non_root1, 0o770);
        //TODO on mac new directories are created with the parents directory GID and not with the process GID. manually change the gid
        await fs.promises.chown(full_path_non_root1, NON_ROOT1_FS_CONFIG.uid, NON_ROOT1_FS_CONFIG.gid);
        //non root3 has non-root1 group as supplemental group, so it should succeed
        const non_root_entries = await nb_native().fs.readdir(NON_ROOT3_FS_CONFIG, full_path_non_root1);
        assert.equal(non_root_entries && non_root_entries.length, 0);
    });

    mocha.it('NON ROOT 3 suplemental group without the files gid - failure', async function() {
        await nb_native().fs.mkdir(NON_ROOT2_FS_CONFIG, full_path_non_root2, 0o770);
        //TODO on mac new directories are created with the parents directory GID and not with the process GID. manually change the gid
        await fs.promises.chown(full_path_non_root2, NON_ROOT2_FS_CONFIG.uid, NON_ROOT2_FS_CONFIG.gid);
        try {
            //non root3 doesn't have non-root2 group as supplemental group, so it should fail
            const non_root_entries = await nb_native().fs.readdir(NON_ROOT3_FS_CONFIG, full_path_non_root2);
            assert.fail(`non root 3 has access to a folder created by user with gid not in supplemental groups - ${p} ${non_root_entries}`);
        } catch (err) {
            assert.equal(err.code, 'EACCES');
        }
    });

});

mocha.describe('dynamic supplemental groups - get_fs_context flow', function() {
    const dynamic_supplemental_groups_enabled_backup = config.NSFS_ENABLE_DYNAMIC_SUPPLEMENTAL_GROUPS;
    const p = '/tmp/dir_dynamic_sg/';
    const full_path_non_root1 = path.join(p, 'non_root_dir1');
    const full_path_non_root2 = path.join(p, 'non_root_dir2');
    const test_user_name = 'test_user_dyn_sg';
    const test_group_name = 'test_group_dyn_sg';
    const NON_ROOT4_UID = 1575;
    const NON_ROOT4_GID = 1575;
    const NON_ROOT1_GID = 1572;
    const NON_ROOT2_GID = 1573;

    mocha.before(async function() {
        config.NSFS_ENABLE_DYNAMIC_SUPPLEMENTAL_GROUPS = true;
        this.timeout(60000); // eslint-disable-line no-invalid-this
        if (test_utils.invalid_nsfs_root_permissions()) this.skip(); // eslint-disable-line no-invalid-this
        await fs_utils.create_fresh_path(p, 0o777);
        await test_utils.create_fs_user_by_platform(test_user_name, test_user_name, NON_ROOT4_UID, NON_ROOT4_GID);
        await test_utils.create_fs_group_by_platform(test_group_name, NON_ROOT1_GID, test_user_name);
        await nb_native().fs.mkdir({ uid: 1572, gid: 1572, backend: '', warn_threshold_ms: 100 }, full_path_non_root1, 0o770);
        await fs.promises.chown(full_path_non_root1, 1572, 1572);
        await nb_native().fs.mkdir({ uid: 1573, gid: 1573, backend: '', warn_threshold_ms: 100 }, full_path_non_root2, 0o770);
        await fs.promises.chown(full_path_non_root2, 1573, 1573);
    });

    mocha.after(async function() {
        this.timeout(60000); // eslint-disable-line no-invalid-this
        await fs_utils.folder_delete(p);
        await test_utils.delete_fs_user_by_platform(test_user_name).catch(() => { /* ignore cleanup */ });
        await test_utils.delete_fs_group_by_platform(test_group_name).catch(() => { /* ignore cleanup */ });
        config.NSFS_ENABLE_DYNAMIC_SUPPLEMENTAL_GROUPS = dynamic_supplemental_groups_enabled_backup;
    });

    mocha.it('get_fs_context with uid/gid and dynamic enabled - supplemental groups resolved, readdir succeeds', async function() {
        const nsfs_account_config = { uid: NON_ROOT4_UID, gid: NON_ROOT4_GID };
        const fs_context = await native_fs_utils.get_fs_context(nsfs_account_config, '');
        assert.ok(fs_context.supplemental_groups, 'should have supplemental groups from OS');
        assert.ok(fs_context.supplemental_groups.includes(NON_ROOT1_GID), 'should include test_group gid');
        const entries = await nb_native().fs.readdir(fs_context, full_path_non_root1);
        assert.equal(entries && entries.length, 0);
    });

    mocha.it('get_fs_context with uid/gid and dynamic disabled - no supplemental groups, readdir fails with EACCES', async function() {
        try {
            config.NSFS_ENABLE_DYNAMIC_SUPPLEMENTAL_GROUPS = false;
            const nsfs_account_config = { uid: NON_ROOT4_UID, gid: NON_ROOT4_GID };
            const fs_context = await native_fs_utils.get_fs_context(nsfs_account_config, '');
            assert.ok(!fs_context.supplemental_groups || fs_context.supplemental_groups.length === 0);
            await nb_native().fs.readdir(fs_context, full_path_non_root1);
            assert.fail('readdir should fail with EACCES');
        } catch (err) {
            assert.equal(err.code, 'EACCES');
        } finally {
            config.NSFS_ENABLE_DYNAMIC_SUPPLEMENTAL_GROUPS = true;
        }
    });

    mocha.it('get_fs_context with supplemental_groups defined - uses account config, readdir succeeds', async function() {
        const nsfs_account_config = {
            uid: NON_ROOT4_UID,
            gid: NON_ROOT4_GID,
            supplemental_groups: [NON_ROOT1_GID]
        };
        const fs_context = await native_fs_utils.get_fs_context(nsfs_account_config, '');
        assert.deepStrictEqual(fs_context.supplemental_groups, [NON_ROOT1_GID]);
        const entries = await nb_native().fs.readdir(fs_context, full_path_non_root1);
        assert.equal(entries && entries.length, 0);
    });

    mocha.it('get_fs_context with distinguished_name - resolves uid/gid and supplemental groups, readdir succeeds', async function() {
        const nsfs_account_config = { distinguished_name: test_user_name };
        const fs_context = await native_fs_utils.get_fs_context(nsfs_account_config, '');
        assert.strictEqual(fs_context.uid, NON_ROOT4_UID);
        assert.strictEqual(fs_context.gid, NON_ROOT4_GID);
        assert.ok(fs_context.supplemental_groups && fs_context.supplemental_groups.includes(NON_ROOT1_GID));
        const entries = await nb_native().fs.readdir(fs_context, full_path_non_root1);
        assert.equal(entries && entries.length, 0);
    });

    mocha.it('get_fs_context dynamic groups do not contain file gid - readdir fails with EACCES', async function() {
        try {
            const nsfs_account_config = { uid: NON_ROOT4_UID, gid: NON_ROOT4_GID };
            const fs_context = await native_fs_utils.get_fs_context(nsfs_account_config, '');
            assert.ok(fs_context.supplemental_groups);
            assert.ok(!fs_context.supplemental_groups.includes(NON_ROOT2_GID), 'should not have non_root2 group');
            await nb_native().fs.readdir(fs_context, full_path_non_root2);
            assert.fail('readdir should fail with EACCES');
        } catch (err) {
            assert.equal(err.code, 'EACCES');
        }
    });
});

mocha.describe('dynamic supplemental groups - load_requesting_account flow', function() {
    const dynamic_supplemental_groups_enabled_backup = config.NSFS_ENABLE_DYNAMIC_SUPPLEMENTAL_GROUPS;
    const test_access_key = 'a-test-dynamic-sg-key';
    const NON_ROOT4_UID = 1575;
    const NON_ROOT4_GID = 1575;
    const DYNAMIC_GROUPS_GID = 1572;
    const CLI_SET_GID = 1573;
    const test_user_name = 'test_user_dyn_sg';
    const test_group_name = 'test_group_dyn_sg';
    const p_load = '/tmp/dir_dynamic_sg_load/';
    const full_path_sg_read = path.join(p_load, 'sg_read');

    mocha.before(async function() {
        if (test_utils.invalid_nsfs_root_permissions()) this.skip(); // eslint-disable-line no-invalid-this
        this.timeout(60000); // eslint-disable-line no-invalid-this
        config.NSFS_ENABLE_DYNAMIC_SUPPLEMENTAL_GROUPS = true;
        await test_utils.create_fs_user_by_platform(test_user_name, test_user_name, NON_ROOT4_UID, NON_ROOT4_GID)
            .catch(() => { /* ignore if exists */ });
        await test_utils.create_fs_group_by_platform(test_group_name, DYNAMIC_GROUPS_GID, test_user_name)
            .catch(() => { /* ignore if exists */ });
        await fs_utils.create_fresh_path(p_load, 0o777);
        await nb_native().fs.mkdir({ uid: 1572, gid: DYNAMIC_GROUPS_GID, backend: '', warn_threshold_ms: 100 }, full_path_sg_read, 0o770);
        await fs.promises.chown(full_path_sg_read, 1572, DYNAMIC_GROUPS_GID);
    });

    mocha.after(async function() {
        this.timeout(60000); // eslint-disable-line no-invalid-this
        await fs_utils.folder_delete(p_load);
        await test_utils.delete_fs_user_by_platform(test_user_name).catch(() => { /* ignore cleanup */ });
        await test_utils.delete_fs_group_by_platform(test_group_name).catch(() => { /* ignore cleanup */ });
        config.NSFS_ENABLE_DYNAMIC_SUPPLEMENTAL_GROUPS = dynamic_supplemental_groups_enabled_backup;
    });

    mocha.it('load_requesting_account with uid/gid and dynamic enabled - populates supplemental_groups on account', async function() {
        const account = {
            nsfs_account_config: { uid: NON_ROOT4_UID, gid: NON_ROOT4_GID },
            access_keys: [{ access_key: test_access_key }]
        };
        const mock_bucketspace = {
            read_account_by_access_key: async ({ access_key }) => {
                if (access_key === test_access_key) return account;
                throw new RpcError('NO_SUCH_ACCOUNT', 'Account not found');
            },
            is_nsfs_containerized_user_anonymous: () => false
        };
        const object_sdk = new ObjectSDK({ rpc_client: { options: {} }, internal_rpc_client: {} });
        object_sdk.bucketspace = mock_bucketspace;
        object_sdk.set_auth_token({ access_key: test_access_key });
        await object_sdk.load_requesting_account({});
        assert.ok(object_sdk.requesting_account.nsfs_account_config.supplemental_groups);
        assert.ok(object_sdk.requesting_account.nsfs_account_config.supplemental_groups.includes(DYNAMIC_GROUPS_GID));
    });

    mocha.it('load_requesting_account with uid/gid and dynamic disabled - no supplemental_groups on account', async function() {
        try {
            config.NSFS_ENABLE_DYNAMIC_SUPPLEMENTAL_GROUPS = false;
            const account = {
                nsfs_account_config: { uid: NON_ROOT4_UID, gid: NON_ROOT4_GID },
                access_keys: [{ access_key: test_access_key + '_disabled' }]
            };
            const mock_bucketspace = {
                read_account_by_access_key: async ({ access_key }) => {
                    if (access_key === test_access_key + '_disabled') return account;
                    throw new RpcError('NO_SUCH_ACCOUNT', 'Account not found');
                },
                is_nsfs_containerized_user_anonymous: () => false
            };
            const object_sdk = new ObjectSDK({ rpc_client: { options: {} }, internal_rpc_client: {} });
            object_sdk.bucketspace = mock_bucketspace;
            object_sdk.set_auth_token({ access_key: test_access_key + '_disabled' });
            await object_sdk.load_requesting_account({});
            assert.ok(!object_sdk.requesting_account.nsfs_account_config.supplemental_groups ||
                object_sdk.requesting_account.nsfs_account_config.supplemental_groups.length === 0);
        } finally {
            config.NSFS_ENABLE_DYNAMIC_SUPPLEMENTAL_GROUPS = true;
        }
    });

    mocha.it('load_requesting_account with distinguished_name - populates supplemental_groups via optimized path', async function() {
        const account = {
            nsfs_account_config: {
                distinguished_name: new SensitiveString(test_user_name)
            },
            access_keys: [{ access_key: test_access_key + '_dn' }]
        };
        const mock_bucketspace = {
            read_account_by_access_key: async ({ access_key }) => {
                if (access_key === test_access_key + '_dn') return account;
                throw new RpcError('NO_SUCH_ACCOUNT', 'Account not found');
            },
            is_nsfs_containerized_user_anonymous: () => false
        };
        const object_sdk = new ObjectSDK({ rpc_client: { options: {} }, internal_rpc_client: {} });
        object_sdk.bucketspace = mock_bucketspace;
        object_sdk.set_auth_token({ access_key: test_access_key + '_dn' });
        await object_sdk.load_requesting_account({});
        assert.strictEqual(object_sdk.requesting_account.nsfs_account_config.uid, NON_ROOT4_UID);
        assert.strictEqual(object_sdk.requesting_account.nsfs_account_config.gid, NON_ROOT4_GID);
        assert.ok(object_sdk.requesting_account.nsfs_account_config.supplemental_groups);
        assert.ok(object_sdk.requesting_account.nsfs_account_config.supplemental_groups.includes(DYNAMIC_GROUPS_GID));
    });

    mocha.it('load_requesting_account with supplemental_groups on account - overrides dynamic allocation', async function() {
        const account = {
            nsfs_account_config: {
                uid: NON_ROOT4_UID,
                gid: NON_ROOT4_GID,
                supplemental_groups: [CLI_SET_GID]
            },
            access_keys: [{ access_key: test_access_key + '_override' }]
        };
        const mock_bucketspace = {
            read_account_by_access_key: async ({ access_key }) => {
                if (access_key === test_access_key + '_override') return account;
                throw new RpcError('NO_SUCH_ACCOUNT', 'Account not found');
            },
            is_nsfs_containerized_user_anonymous: () => false
        };
        const object_sdk = new ObjectSDK({ rpc_client: { options: {} }, internal_rpc_client: {} });
        object_sdk.bucketspace = mock_bucketspace;
        object_sdk.set_auth_token({ access_key: test_access_key + '_override' });
        await object_sdk.load_requesting_account({});
        assert.deepStrictEqual(
            object_sdk.requesting_account.nsfs_account_config.supplemental_groups,
            [CLI_SET_GID],
            'should use account config, not dynamic lookup'
        );
    });

    mocha.it('load_requesting_account - user can read dir with supplemental_groups access', async function() {
        const account = {
            nsfs_account_config: { uid: NON_ROOT4_UID, gid: NON_ROOT4_GID },
            access_keys: [{ access_key: test_access_key + '_read' }]
        };
        const mock_bucketspace = {
            read_account_by_access_key: async ({ access_key }) => {
                if (access_key === test_access_key + '_read') return account;
                throw new RpcError('NO_SUCH_ACCOUNT', 'Account not found');
            },
            is_nsfs_containerized_user_anonymous: () => false
        };
        const object_sdk = new ObjectSDK({ rpc_client: { options: {} }, internal_rpc_client: {} });
        object_sdk.bucketspace = mock_bucketspace;
        object_sdk.set_auth_token({ access_key: test_access_key + '_read' });
        await object_sdk.load_requesting_account({});
        const fs_context = await native_fs_utils.get_fs_context(
            object_sdk.requesting_account.nsfs_account_config, '');
        const entries = await nb_native().fs.readdir(fs_context, full_path_sg_read);
        assert.equal(entries && entries.length, 0);
    });
});

mocha.describe('list object access check', function() {
    this.timeout(10 * 60 * 1000); // eslint-disable-line no-invalid-this

    const key_files_set_first = make_keys(10, i => `small_key_files_set_first${i}`);
    const key_files_set_second = make_keys(10, i => `small_key_files_set_second${i}`);
    const max_keys_files_set = make_keys(981, i => `max_keys_files_set${i}`);
    const access_src_bkt = 'access_src';
    const tmp_fs_path = path.join(TMP_PATH, 'test_namespace_access_fs');
    const ns_tmp_bucket_path = path.join(tmp_fs_path, access_src_bkt);
    const first_file_path = path.join(ns_tmp_bucket_path, 'small_key_files_set_first1');
    const bucket1 = 'access_bucket1';
    const ns_src = new NamespaceFS({
        bucket_path: ns_tmp_bucket_path,
        bucket_id: '5',
        namespace_resource_id: undefined,
        access_mode: undefined,
        versioning: undefined,
        force_md5_etag: false,
        stats: endpoint_stats_collector.instance(),
    });
    const custom_dummy_object_sdk1 = make_custom_dummy_object_sdk(200, 200);
    const custom_dummy_object_sdk2 = make_custom_dummy_object_sdk(300, 200);
    const custom_dummy_object_sdk3 = make_custom_dummy_object_sdk(400, 400);
    mocha.before(async function() {
        await fs_utils.create_fresh_path(tmp_fs_path, 0o777);
        await fs_utils.file_must_exist(tmp_fs_path);
        await fs_utils.create_fresh_path(ns_tmp_bucket_path, 0o770);
        await fs_utils.file_must_exist(ns_tmp_bucket_path);
        await fs.promises.chmod(tmp_fs_path, 0o777);
        await fs.promises.chmod(ns_tmp_bucket_path, 0o770);
        await fs.promises.chown(ns_tmp_bucket_path, custom_dummy_object_sdk1.requesting_account.nsfs_account_config.uid,
            custom_dummy_object_sdk1.requesting_account.nsfs_account_config.gid);
    });
    mocha.after(async function() {
        fs_utils.folder_delete(ns_tmp_bucket_path);
        fs_utils.folder_delete(tmp_fs_path);
    });

    mocha.it('list object with inaccessible item, smae UI and GID', async function() {
        await upload_objects(key_files_set_first, custom_dummy_object_sdk1, bucket1, ns_src);
        // change ownership for one file, and account can not access this file
        await fs.promises.chown(first_file_path, 999, 999);
        const r = await ns_src.list_objects({
            bucket: bucket1,
        }, custom_dummy_object_sdk1);
        // skipping inaccessible file, list rest of the files
        assert_list_items(r, [...key_files_set_first], 9);
    });

    mocha.it('list object with different account and same GID', async function() {
        await upload_objects(key_files_set_second, custom_dummy_object_sdk2, bucket1, ns_src);
        const r = await ns_src.list_objects({
            bucket: bucket1,
        }, custom_dummy_object_sdk2);
        assert_list_items(r, [...key_files_set_first, ...key_files_set_second], 19);
    });

    mocha.it('list object with different account and different GID', async function() {
        try {
            await upload_objects(["Banana"], custom_dummy_object_sdk3, bucket1, ns_src);
        } catch (err) {
            assert.strictEqual(err instanceof Error, true);
            assert.strictEqual(err.code, 'EACCES');
        }
        const r = await ns_src.list_objects({
            bucket: bucket1,
        }, custom_dummy_object_sdk2);
        assert_list_items(r, [...key_files_set_first, ...key_files_set_second], 19);
    });

    mocha.it('max - list object with different account and same GID', async function() {
        await upload_objects(max_keys_files_set, custom_dummy_object_sdk1, bucket1, ns_src);
        const r = await ns_src.list_objects({
            bucket: bucket1,
        }, custom_dummy_object_sdk1);
        // Total number of object would be 9+10+981 = 1000
        assert_list_items(r, [...key_files_set_first, ...key_files_set_second, ...max_keys_files_set], 1000);
    });
});

async function upload_objects(keys, custom_object_sdk, user_bucket, user_ns) {
    return Promise.all(keys.map(async key => {
        await user_ns.upload_object({
            bucket: user_bucket,
            key,
            content_type: 'application/octet-stream',
            source_stream: buffer_utils.buffer_to_read_stream(null),
            size: 0
        }, custom_object_sdk);
    }));
}

function make_custom_dummy_object_sdk(uid, gid) {
    return {
        requesting_account: {
            force_md5_etag: false,
            nsfs_account_config: {
                uid: uid,
                gid: gid,
            }
        },
        abort_controller: new AbortController(),
        throw_if_aborted() {
            if (this.abort_controller.signal.aborted) throw new Error('request aborted signal');
        },

        read_bucket_sdk_config_info(name) {
            return {
                bucket_owner: new SensitiveString('dummy-owner'),
                owner_account: {
                    id: 'dummy-id-123',
                }
            };
        },

        read_bucket_full_info(name) {
            return {};
        }
    };
}

/**
 * validate list objects counts and items
 * @param {Object} r 
 * @param {string[]} splice_array
 * @param {number} object_items_count 
 */
function assert_list_items(r, splice_array, object_items_count) {
    assert.equal(r.objects.length, object_items_count);
    const index = splice_array.indexOf('small_key_files_set_first1');
    splice_array.splice(index, 1);
    assert.deepStrictEqual(r.objects.map(it => it.key), splice_array.sort());
}

/**
 * @param {number} count 
 * @param {(i:number)=>string} gen 
 * @returns {string[]}
 */
function make_keys(count, gen) {
    const arr = new Array(count);
    for (let i = 0; i < count; ++i) arr[i] = gen(i);
    arr.sort();
    Object.freeze(arr);
    return arr;
}
