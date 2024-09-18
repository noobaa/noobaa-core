/* Copyright (C) 2020 NooBaa */
/* eslint-disable max-lines-per-function */
/*eslint max-lines: ["error",3200]*/
'use strict';

const fs = require('fs');
const path = require('path');
const mocha = require('mocha');
const assert = require('assert');
const fs_utils = require('../../util/fs_utils');
const nb_native = require('../../util/nb_native');
const size_utils = require('../../util/size_utils');
const { TMP_PATH, is_nc_coretest, set_path_permissions_and_owner, generate_nsfs_account, get_new_buckets_path_by_test_env,
    invalid_nsfs_root_permissions, generate_s3_client, get_coretest_path } = require('../system_tests/test_utils');
const { get_process_fs_context } = require('../../util/native_fs_utils');

const coretest_path = get_coretest_path();
const coretest = require(coretest_path);
const { rpc_client, EMAIL, get_admin_mock_account_details } = coretest;
coretest.setup({});

const XATTR_INTERNAL_NOOBAA_PREFIX = 'user.noobaa.';
const XATTR_VERSION_ID = XATTR_INTERNAL_NOOBAA_PREFIX + 'version_id';
const XATTR_DELETE_MARKER = XATTR_INTERNAL_NOOBAA_PREFIX + 'delete_marker';
const NULL_VERSION_ID = 'null';

const DEFAULT_FS_CONFIG = get_process_fs_context();
let CORETEST_ENDPOINT;

const tmp_fs_root = path.join(TMP_PATH, 'test_bucket_namespace_fs_versioning');
// on NC - new_buckets_path is full absolute path
// on Containerized - new_buckets_path is the directory
const new_bucket_path_param = get_new_buckets_path_by_test_env(tmp_fs_root, '/');

mocha.describe('bucketspace namespace_fs - versioning', function() {
    const nsr = 'versioned-nsr';
    const bucket_name = 'versioned-enabled-bucket';
    const disabled_bucket_name = 'disabled-bucket'; // be aware that this bucket would become versioned in the copy object tests
    const suspended_bucket_name = 'suspended-bucket';

    const bucket_path = '/bucket';
    const full_path = tmp_fs_root + bucket_path;
    const disabled_bucket_path = '/disabled_bucket';
    const disabled_full_path = tmp_fs_root + disabled_bucket_path;
    const suspended_bucket_path = '/suspended_bucket';
    const suspended_full_path = tmp_fs_root + suspended_bucket_path;
    const versions_path = path.join(full_path, '.versions/');
    const suspended_versions_path = path.join(suspended_full_path, '.versions/');
    let s3_uid5;
    let s3_uid6;
    let s3_admin;
    const accounts = [];
    const disabled_key = 'disabled_key.txt';
    const disabled_key2 = 'disabled_key2.txt';
    const key1 = 'key1.txt';
    const copied_key1 = 'copied_key1.txt';
    const copied_key5 = 'copied_key5.txt';

    const dir1 = 'dir1/';
    const nested_key1 = dir1 + key1;
    const body1 = 'AAAAABBBBBCCCCC';
    const body2 = body1 + 'DDDDD';
    const body3 = body2 + 'EEEEE';

    let key1_ver1;
    let key1_cur_ver;
    const mpu_key1 = 'mpu_key1.txt';
    const dir1_versions_path = path.join(full_path, dir1, '.versions/');
    const suspended_dir1_versions_path = path.join(suspended_full_path, dir1, '.versions/');

    mocha.before(async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        if (invalid_nsfs_root_permissions()) this.skip(); // eslint-disable-line no-invalid-this
        // create paths 
        await fs_utils.create_fresh_path(tmp_fs_root, 0o777);
        await fs_utils.create_fresh_path(full_path, 0o770);
        await fs_utils.file_must_exist(full_path);
        await fs_utils.create_fresh_path(disabled_full_path, 0o770);
        await fs_utils.file_must_exist(disabled_full_path);
        await fs_utils.create_fresh_path(suspended_full_path, 0o770);
        await fs_utils.file_must_exist(suspended_full_path);
        if (is_nc_coretest) {
            const { uid, gid } = get_admin_mock_account_details();
            await set_path_permissions_and_owner(full_path, { uid, gid }, 0o700);
            await set_path_permissions_and_owner(disabled_full_path, { uid, gid }, 0o700);
            await set_path_permissions_and_owner(suspended_full_path, { uid, gid }, 0o700);
        }
        // export dir as a bucket
        await rpc_client.pool.create_namespace_resource({
            name: nsr,
            nsfs_config: {
                fs_root_path: tmp_fs_root,
            }
        });
        const obj_nsr = { resource: nsr, path: bucket_path };
        await rpc_client.bucket.create_bucket({
            name: bucket_name,
            namespace: {
                read_resources: [obj_nsr],
                write_resource: obj_nsr
            }
        });
        const disabled_nsr = { resource: nsr, path: disabled_bucket_path };
        await rpc_client.bucket.create_bucket({
            name: disabled_bucket_name,
            namespace: {
                read_resources: [disabled_nsr],
                write_resource: disabled_nsr
            }
        });
        const suspended_nsr = { resource: nsr, path: suspended_bucket_path };
        await rpc_client.bucket.create_bucket({
            name: suspended_bucket_name,
            namespace: {
                read_resources: [suspended_nsr],
                write_resource: suspended_nsr
            }
        });
        const policy = {
            Version: '2012-10-17',
            Statement: [{
                Sid: 'id-1',
                Effect: 'Allow',
                Principal: { AWS: "*" },
                Action: ['s3:*'],
                Resource: [`arn:aws:s3:::*`]
            }
        ]
        };
        CORETEST_ENDPOINT = coretest.get_http_address();
        // create accounts
        let res = await generate_nsfs_account(rpc_client, EMAIL, new_bucket_path_param, { admin: true });
        s3_admin = generate_s3_client(res.access_key, res.secret_key, CORETEST_ENDPOINT);
        await s3_admin.putBucketPolicy({
            Bucket: bucket_name,
            Policy: JSON.stringify(policy)
        });

        await s3_admin.putBucketPolicy({
            Bucket: disabled_bucket_name,
            Policy: JSON.stringify(policy)
        });

        await s3_admin.putBucketPolicy({
            Bucket: suspended_bucket_name,
            Policy: JSON.stringify(policy)
        });

        res = await generate_nsfs_account(rpc_client, EMAIL, new_bucket_path_param, { uid: 5, gid: 5 });
        s3_uid5 = generate_s3_client(res.access_key, res.secret_key, CORETEST_ENDPOINT);
        accounts.push(res.email);

        res = await generate_nsfs_account(rpc_client, EMAIL, new_bucket_path_param);
        s3_uid6 = generate_s3_client(res.access_key, res.secret_key, CORETEST_ENDPOINT);
        accounts.push(res.email);
    });

    mocha.after(async () => {
        fs_utils.folder_delete(tmp_fs_root);
        for (const email of accounts) {
            await rpc_client.account.delete_account({ email });
        }
    });

    mocha.describe('put/get versioning', function() {
        mocha.it('put object - versioning disabled - to be enabled', async function() {
            await s3_uid6.putObject({ Bucket: bucket_name, Key: disabled_key, Body: body1 });
        });

        mocha.it('put object - versioning disabled - to be suspended', async function() {
            await s3_uid6.putObject({ Bucket: suspended_bucket_name, Key: disabled_key, Body: body1 });
            await s3_uid6.putObject({ Bucket: suspended_bucket_name, Key: disabled_key2, Body: body1 });
        });

        mocha.it('put object - versioning disabled bucket', async function() {
            await s3_uid6.putObject({ Bucket: disabled_bucket_name, Key: disabled_key, Body: body1 });
        });

        mocha.it('set bucket versioning - Enabled - should fail - no permissions', async function() {
            try {
                await s3_uid5.putBucketVersioning({ Bucket: bucket_name, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
                assert.fail(`put bucket versioning succeeded for account without permissions`);
            } catch (err) {
                assert.equal(err.Code, 'AccessDenied');
            }
        });

        mocha.it('set bucket versioning - Enabled - admin - should fail - no permissions', async function() {
            // on NC env - s3_admin is a regular account created for being the owner of buckets created using rpc calls (which are coverted to cli)
            if (is_nc_coretest) return;
            try {
                await s3_admin.putBucketVersioning({ Bucket: bucket_name, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
                assert.fail(`put bucket versioning succeeded for account without permissions`);
            } catch (err) {
                assert.equal(err.Code, 'AccessDenied');
            }
        });

        mocha.it('set bucket versioning - Enabled', async function() {
            await s3_uid6.putBucketVersioning({ Bucket: bucket_name, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
            const res = await s3_uid6.getBucketVersioning({ Bucket: bucket_name });
            assert.equal(res.Status, 'Enabled');
        });

        mocha.it('set bucket versioning - Suspended - should fail - no permissions', async function() {
            try {
                await s3_uid5.putBucketVersioning({ Bucket: suspended_bucket_name, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Suspended' } });
                assert.fail(`put bucket versioning succeeded for account without permissions`);
            } catch (err) {
                assert.equal(err.Code, 'AccessDenied');
            }
         });

        mocha.it('set bucket versioning - Suspended - admin - should fail - no permissions', async function() {
            // on NC env -  s3_admin is a regular account created for being the owner of buckets created via rpc calls (which are coverted to cli)
            if (is_nc_coretest) return;
            try {
                await s3_admin.putBucketVersioning({ Bucket: suspended_bucket_name, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Suspended' } });
                assert.fail(`put bucket versioning succeeded for account without permissions`);
            } catch (err) {
                assert.equal(err.Code, 'AccessDenied');
            }
        });

        mocha.it('set bucket versioning - Suspended', async function() {
            await s3_uid6.putBucketVersioning({ Bucket: suspended_bucket_name, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Suspended' } });
            const res = await s3_uid6.getBucketVersioning({ Bucket: suspended_bucket_name });
            assert.equal(res.Status, 'Suspended');
        });
    });

    mocha.describe('versioning enabled', function() {

        mocha.describe('put object', function() {

            mocha.it('put object 1st time - no existing objects in bucket', async function() {
                const res = await s3_uid6.putObject({ Bucket: bucket_name, Key: key1, Body: body1 });
                const comp_res = await compare_version_ids(full_path, key1, res.VersionId);
                assert.ok(comp_res);
                await fs_utils.file_must_not_exist(versions_path);
                key1_ver1 = res.VersionId;
            });

            mocha.it('put object 2nd time - versioning enabled', async function() {
                const prev_version_id = await stat_and_get_version_id(full_path, key1);
                const res = await s3_uid6.putObject({ Bucket: bucket_name, Key: key1, Body: body2 });
                const comp_res = await compare_version_ids(full_path, key1, res.VersionId, prev_version_id);
                assert.ok(comp_res);
                const exist = await version_file_exists(full_path, key1, '', prev_version_id);
                assert.ok(exist);
                key1_cur_ver = res.VersionId;
            });

            mocha.it('put object 2nd time - versioning enabled - disabled key', async function() {
                const prev_version_id = await stat_and_get_version_id(full_path, disabled_key);
                const res = await s3_uid6.putObject({ Bucket: bucket_name, Key: disabled_key, Body: body2 });
                const comp_res = await compare_version_ids(full_path, disabled_key, res.VersionId, prev_version_id);
                assert.ok(comp_res);
                const exist = await version_file_exists(full_path, disabled_key, '', 'null');
                assert.ok(exist);
            });

            mocha.it('put object 3rd time - versioning enabled - disabled key', async function() {
                const prev_version_id = await stat_and_get_version_id(full_path, disabled_key);
                const res = await s3_uid6.putObject({ Bucket: bucket_name, Key: disabled_key, Body: body3 });
                const comp_res = await compare_version_ids(full_path, disabled_key, res.VersionId, prev_version_id);
                assert.ok(comp_res);
                let exist = await version_file_exists(full_path, disabled_key, '', prev_version_id);
                assert.ok(exist);
                exist = await version_file_exists(full_path, disabled_key, '', 'null');
                assert.ok(exist);
            });
            mocha.it('put object 1st time - versioning enabled - nested', async function() {
                const res = await s3_uid6.putObject({ Bucket: bucket_name, Key: nested_key1, Body: body1 });
                await fs_utils.file_must_not_exist(dir1_versions_path);
                const comp_res = await compare_version_ids(full_path, nested_key1, res.VersionId);
                assert.ok(comp_res);
            });

            mocha.it('put object 2nd time - versioning enabled - nested', async function() {
                const prev_version_id = await stat_and_get_version_id(full_path, nested_key1);
                const res = await s3_uid6.putObject({ Bucket: bucket_name, Key: nested_key1, Body: body2 });
                const comp_res = await compare_version_ids(full_path, nested_key1, res.VersionId, prev_version_id);
                assert.ok(comp_res);
                const exist = await version_file_exists(full_path, key1, dir1, prev_version_id);
                assert.ok(exist);
            });
        });

        mocha.describe('mpu object', function() {
            mocha.it('mpu object 1st time - versioning enabled', async function() {
                const mpu_res = await s3_uid6.createMultipartUpload({ Bucket: bucket_name, Key: mpu_key1 });
                const upload_id = mpu_res.UploadId;
                const part1 = await s3_uid6.uploadPart({
                    Bucket: bucket_name, Key: mpu_key1, Body: body1, UploadId: upload_id, PartNumber: 1 });
                const res = await s3_uid6.completeMultipartUpload({
                    Bucket: bucket_name,
                    Key: mpu_key1,
                    UploadId: upload_id,
                    MultipartUpload: {
                        Parts: [{
                            ETag: part1.ETag,
                            PartNumber: 1
                        }]
                    }
                });
                const comp_res = await compare_version_ids(full_path, mpu_key1, res.VersionId);
                assert.ok(comp_res);
            });

            mocha.it('mpu object 2nd time - versioning enabled', async function() {
                const prev_version_id = await stat_and_get_version_id(full_path, mpu_key1);
                const mpu_res = await s3_uid6.createMultipartUpload({ Bucket: bucket_name, Key: mpu_key1 });
                const upload_id = mpu_res.UploadId;
                const part1 = await s3_uid6.uploadPart({
                    Bucket: bucket_name, Key: mpu_key1, Body: body1, UploadId: upload_id, PartNumber: 1 });
                const part2 = await s3_uid6.uploadPart({
                    Bucket: bucket_name, Key: mpu_key1, Body: body2, UploadId: upload_id, PartNumber: 2 });
                const res = await s3_uid6.completeMultipartUpload({
                    Bucket: bucket_name,
                    Key: mpu_key1,
                    UploadId: upload_id,
                    MultipartUpload: {
                        Parts: [{
                            ETag: part1.ETag,
                            PartNumber: 1
                        },
                        {
                            ETag: part2.ETag,
                            PartNumber: 2
                        }]
                    }
                });
                const comp_res = await compare_version_ids(full_path, mpu_key1, res.VersionId, prev_version_id);
                assert.ok(comp_res);
                const exist = await version_file_exists(full_path, mpu_key1, '', prev_version_id);
                assert.ok(exist);
            });
        });
    });

    // The res of putBucketVersioning is different depends on the versioning state:
    // * Enabled - Etag and VersionId;
    // * Disabled and Suspended - only Etag.
    // Hence, 'res.VersionId' would be undefined when versioning is Suspended.
    // (We would still prefer using it as a parameter instead of explicitly send undefined to function compare_version_ids).
    mocha.describe('put object - versioning suspended - simple cases', function() {
        const is_enabled = false;
        const key2 = 'water.txt';

        // It was already set to Suspended in previous test (just to be on the safe side)
        mocha.before('set bucket versioning - Suspended', async function() {
            await s3_uid6.putBucketVersioning({ Bucket: suspended_bucket_name, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Suspended' } });
        });

        mocha.describe('put object', function() {

            mocha.it('put object 1st time - versioning suspended', async function() {
                const res = await s3_uid6.putObject({ Bucket: suspended_bucket_name, Key: key2, Body: body1 });
                const comp_res = await compare_version_ids(suspended_full_path, key2, res.VersionId, undefined, is_enabled);
                assert.ok(comp_res);
                const exist = await fs_utils.file_not_exists(suspended_versions_path);
                assert.ok(exist);
            });

            mocha.it('put object 2nd time - versioning suspended', async function() {
                const res = await s3_uid6.putObject({ Bucket: suspended_bucket_name, Key: key2, Body: body2 });
                const comp_res = await compare_version_ids(suspended_full_path, key2, res.VersionId, undefined, is_enabled);
                assert.ok(comp_res);
                const exist = await fs_utils.file_not_exists(suspended_versions_path);
                assert.ok(exist);
            });

            mocha.it('put object 2nd time - versioning suspended - disabled key', async function() {
                const res = await s3_uid6.putObject({ Bucket: suspended_bucket_name, Key: disabled_key, Body: body2 });
                const comp_res = await compare_version_ids(suspended_full_path, disabled_key, res.VersionId, undefined, is_enabled);
                assert.ok(comp_res);
                const exist = await fs_utils.file_not_exists(suspended_versions_path);
                assert.ok(exist);
            });

            mocha.it('put object 1st time - versioning suspended - nested', async function() {
                const res = await s3_uid6.putObject({ Bucket: suspended_bucket_name, Key: nested_key1, Body: body1 });
                const exist = await fs_utils.file_not_exists(suspended_dir1_versions_path);
                assert.ok(exist);
                const comp_res = await compare_version_ids(suspended_full_path, nested_key1, res.VersionId, undefined, is_enabled);
                assert.ok(comp_res);
            });

            mocha.it('put object 2nd time - versioning suspended - nested', async function() {
                const res = await s3_uid6.putObject({ Bucket: suspended_bucket_name, Key: nested_key1, Body: body2 });
                const exist = await fs_utils.file_not_exists(suspended_dir1_versions_path);
                assert.ok(exist);
                const comp_res = await compare_version_ids(suspended_full_path, nested_key1, res.VersionId, undefined, is_enabled);
                assert.ok(comp_res);
            });
        });

        // mpu = multipart upload
        mocha.describe('mpu object', function() {

            mocha.it('mpu object 1st time - versioning suspended', async function() {
                const mpu_res = await s3_uid6.createMultipartUpload({ Bucket: suspended_bucket_name, Key: mpu_key1 });
                const upload_id = mpu_res.UploadId;
                const part1 = await s3_uid6.uploadPart({
                    Bucket: suspended_bucket_name, Key: mpu_key1, Body: body1, UploadId: upload_id, PartNumber: 1 });
                const res = await s3_uid6.completeMultipartUpload({
                    Bucket: suspended_bucket_name,
                    Key: mpu_key1,
                    UploadId: upload_id,
                    MultipartUpload: {
                        Parts: [{
                            ETag: part1.ETag,
                            PartNumber: 1
                        }]
                    }
                });
                const comp_res = await compare_version_ids(suspended_full_path, mpu_key1, res.VersionId, undefined, is_enabled);
                assert.ok(comp_res);
            });

            mocha.it('mpu object 2nd time - versioning suspended', async function() {
                const prev_version_id = await stat_and_get_version_id(suspended_full_path, mpu_key1);
                const mpu_res = await s3_uid6.createMultipartUpload({ Bucket: suspended_bucket_name, Key: mpu_key1 });
                const upload_id = mpu_res.UploadId;
                const part1 = await s3_uid6.uploadPart({
                    Bucket: suspended_bucket_name, Key: mpu_key1, Body: body1, UploadId: upload_id, PartNumber: 1 });
                const part2 = await s3_uid6.uploadPart({
                    Bucket: suspended_bucket_name, Key: mpu_key1, Body: body2, UploadId: upload_id, PartNumber: 2 });
                const res = await s3_uid6.completeMultipartUpload({
                    Bucket: suspended_bucket_name,
                    Key: mpu_key1,
                    UploadId: upload_id,
                    MultipartUpload: {
                        Parts: [{
                            ETag: part1.ETag,
                            PartNumber: 1
                        },
                        {
                            ETag: part2.ETag,
                            PartNumber: 2
                        }]
                    }
                });
                const comp_res = await compare_version_ids(suspended_full_path, mpu_key1, res.VersionId, prev_version_id, is_enabled);
                assert.ok(comp_res);
                const exist = await version_file_must_not_exists(suspended_full_path, mpu_key1, '', prev_version_id);
                assert.ok(exist);
            });
        });
    });

    mocha.describe('put object - versioning suspended - should have only one null version ID', function() {

        mocha.before('put object 2nd time - versioning enabled', async function() {
            await s3_uid6.putBucketVersioning({ Bucket: suspended_bucket_name, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
            await s3_uid6.putObject({ Bucket: suspended_bucket_name, Key: disabled_key2, Body: body2 });
        });

        // Start with null version ID in .versions/ directory (this version that was created when versioning was disabled)
        // and unique version ID as latest version (this version that was created when versioning was enabled).
        mocha.it('put object 3rd time - versioning suspended', async function() {
            await s3_uid6.putBucketVersioning({ Bucket: suspended_bucket_name, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Suspended' } });
            const is_enabled = false;
            let exist = await version_file_exists(suspended_full_path, disabled_key2, '', 'null');
            assert.ok(exist);
            const prev_version_id = await stat_and_get_version_id(suspended_full_path, disabled_key2);
            const res = await s3_uid6.putObject({ Bucket: suspended_bucket_name, Key: disabled_key2, Body: body3 });
            const comp_res = await compare_version_ids(suspended_full_path, disabled_key2, res.VersionId, prev_version_id, is_enabled);
            assert.ok(comp_res);
            // unique version ID should move to .versions/ directory
            exist = await version_file_exists(suspended_full_path, disabled_key2, '', prev_version_id);
            assert.ok(exist);
            // latest version is null, we cannot have another null in .versions/ directory
            exist = await version_file_must_not_exists(suspended_full_path, disabled_key2, '', 'null');
            assert.ok(exist);
        });
    });

    mocha.describe('put object - versioning suspended - unique version ID should move to .version/ directory', function() {
        const key2 = 'soda.txt';

        mocha.before('put object - versioning enabled', async function() {
            await s3_uid6.putBucketVersioning({ Bucket: suspended_bucket_name, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
            await s3_uid6.putObject({ Bucket: suspended_bucket_name, Key: key2, Body: body1 });
            await s3_uid6.putBucketVersioning({ Bucket: suspended_bucket_name, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Suspended' } });
        });

        mocha.it('put object 2nd time - versioning suspended', async function() {
            const is_enabled = false;
            const prev_version_id = await stat_and_get_version_id(suspended_full_path, key2);
            const comp_prev = check_enable_version_format(prev_version_id);
            assert.ok(comp_prev);
            const res = await s3_uid6.putObject({ Bucket: suspended_bucket_name, Key: key2, Body: body2 });
            const comp_res = await compare_version_ids(suspended_full_path, key2, res.VersionId, prev_version_id, is_enabled);
            assert.ok(comp_res);
            // unique version ID should move to .versions/ directory
            const exist = await version_file_exists(suspended_full_path, key2, '', prev_version_id);
            assert.ok(exist);
        });

        mocha.it('put object 3rd time - versioning suspended', async function() {
            const is_enabled = false;
            const prev_version_id = await stat_and_get_version_id(suspended_full_path, key2);
            const comp_prev = check_null_version_id(prev_version_id);
            assert.ok(comp_prev);
            const res = await s3_uid6.putObject({ Bucket: suspended_bucket_name, Key: key2, Body: body3 });
            const comp_res = await compare_version_ids(suspended_full_path, key2, res.VersionId, prev_version_id, is_enabled);
            assert.ok(comp_res);
            // the new version is with a null version ID (the previous was overridden)
            const exist = await version_file_must_not_exists(suspended_full_path, key2, '', prev_version_id);
            assert.ok(exist);
        });
    });

    mocha.describe('copy object - versioning enabled - nsfs copy fallback flow', function() {

        mocha.it('copy object - target bucket versioning enabled - 1st', async function() {
            const res = await s3_uid6.copyObject({ Bucket: bucket_name, Key: copied_key1, CopySource: `${bucket_name}/${key1}` });
            const comp_res = await compare_version_ids(full_path, copied_key1, res.VersionId);
            assert.ok(comp_res);
        });

        mocha.it('copy object - target bucket versioning enabled - 2nd', async function() {
            const prev_version_id = await stat_and_get_version_id(full_path, copied_key1);
            const res = await s3_uid6.copyObject({ Bucket: bucket_name, Key: copied_key1, CopySource: `${bucket_name}/${key1}` });
            const comp_res = await compare_version_ids(full_path, copied_key1, res.VersionId, prev_version_id);
            assert.ok(comp_res);
            const exist = await version_file_exists(full_path, copied_key1, '', prev_version_id);
            assert.ok(exist);
        });

        mocha.it('copy object latest - source bucket versioning enabled', async function() {
            const key = 'copied_key2.txt';
            const res = await s3_uid6.copyObject({ Bucket: bucket_name, Key: key,
                CopySource: `${bucket_name}/${key1}`});
            const body_comp_res = await get_obj_and_compare_data(s3_uid6, bucket_name, key, body2);
            assert.ok(body_comp_res);
            const comp_res = await compare_version_ids(full_path, key, res.VersionId);
            assert.ok(comp_res);
        });

        mocha.it('copy object latest & versionId - source bucket versioning enabled - version does not exist', async function() {
            const key = 'copied_key3.txt';
            const non_exist_version = 'mtime-dsbfjb-ino-sjfhjsa';
            try {
                await s3_uid6.copyObject({ Bucket: bucket_name, Key: key,
                    CopySource: `${bucket_name}/${key1}?versionId=${non_exist_version}`});
                assert.fail('copy non existing version should have failed');
            } catch (err) {
                assert.equal(err.Code, 'NoSuchKey');
            }
        });

        mocha.it('copy object latest & versionId - source bucket versioning enabled', async function() {
            const key = 'copied_key3.txt';
            const res = await s3_uid6.copyObject({ Bucket: bucket_name, Key: key,
                CopySource: `${bucket_name}/${key1}?versionId=${key1_cur_ver}`});
            const body_comp_res = await get_obj_and_compare_data(s3_uid6, bucket_name, key, body2);
            assert.ok(body_comp_res);
            const comp_res = await compare_version_ids(full_path, key, res.VersionId);
            assert.ok(comp_res);
        });

        mocha.it('copy object version id - source bucket versioning enabled', async function() {
            const key = 'copied_key4.txt';
            const res = await s3_uid6.copyObject({ Bucket: bucket_name, Key: key,
                CopySource: `${bucket_name}/${key1}?versionId=${key1_ver1}`});
            const body_comp_res = await get_obj_and_compare_data(s3_uid6, bucket_name, key, body1);
            assert.ok(body_comp_res);
            const comp_res = await compare_version_ids(full_path, key, res.VersionId);
            assert.ok(comp_res);
        });

        mocha.it('copy object version null - version is in .versions/', async function() {
            const res = await s3_uid6.copyObject({ Bucket: bucket_name, Key: copied_key5,
                CopySource: `${bucket_name}/${disabled_key}?versionId=null`});
            const body_comp_res = await get_obj_and_compare_data(s3_uid6, bucket_name, copied_key5, body1);
            assert.ok(body_comp_res);
            const comp_res = await compare_version_ids(full_path, copied_key5, res.VersionId);
            assert.ok(comp_res);
        });

        mocha.it('copy object version null - no version null - should fail', async function() {
            try {
                await s3_uid6.copyObject({ Bucket: bucket_name, Key: copied_key5,
                    CopySource: `${bucket_name}/${key1}?versionId=null`});
                assert.fail('should have failed');
            } catch (err) {
                assert.equal(err.Code, 'NoSuchKey');
            }
        });

        mocha.it('copy object - version does not exist - should fail', async function() {
            try {
                await s3_uid6.copyObject({ Bucket: bucket_name, Key: copied_key5,
                    CopySource: `${bucket_name}/${key1}?versionId=mtime-123-ino-123`});
                assert.fail('should have failed');
            } catch (err) {
                assert.equal(err.Code, 'NoSuchKey');
            }
        });

        mocha.it('copy object version null from disabled bucket - version is in parent', async function() {
            const key = 'copied_key6.txt';
            const res = await s3_uid6.copyObject({ Bucket: bucket_name, Key: key,
                CopySource: `${disabled_bucket_name}/${disabled_key}?versionId=null`});
            const body_comp_res = await get_obj_and_compare_data(s3_uid6, bucket_name, key, body1);
            assert.ok(body_comp_res);
            const comp_res = await compare_version_ids(full_path, key, res.VersionId);
            assert.ok(comp_res);
        });

        mocha.it('set bucket versioning - Enabled', async function() {
            await s3_uid6.putBucketVersioning({ Bucket: disabled_bucket_name, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
            const res = await s3_uid6.getBucketVersioning({ Bucket: disabled_bucket_name });
            assert.equal(res.Status, 'Enabled');
        });

        mocha.it('copy object version null from enabled bucket - version is in parent', async function() {
            const key = 'copied_key7.txt';
            const res = await s3_uid6.copyObject({ Bucket: bucket_name, Key: key,
                CopySource: `${disabled_bucket_name}/${disabled_key}?versionId=null`});
            const body_comp_res = await get_obj_and_compare_data(s3_uid6, bucket_name, key, body1);
            assert.ok(body_comp_res);
            const comp_res = await compare_version_ids(full_path, key, res.VersionId);
            assert.ok(comp_res);
        });

        mocha.it('delete object latest - non existing version', async function() {
            const non_exist_version = 'mtime-dsad-ino-sdfasd';
            const res = await s3_uid6.deleteObject({ Bucket: bucket_name, Key: disabled_key, VersionId: non_exist_version });
            assert.equal(res.VersionId, non_exist_version);
        });

        mocha.it('delete object latest - create dm & move latest -> .versions/', async function() {
            const prev_version_id = await stat_and_get_version_id(full_path, disabled_key);
            const max_version1 = await find_max_version_past(full_path, disabled_key, '');
            const res = await s3_uid6.deleteObject({ Bucket: bucket_name, Key: disabled_key });
            assert.equal(res.DeleteMarker, true);

            await fs_utils.file_must_not_exist(path.join(full_path, disabled_key));
            const exist = await version_file_exists(full_path, disabled_key, '', prev_version_id);
            assert.ok(exist);
            const max_version2 = await find_max_version_past(full_path, disabled_key, '');
            assert.notEqual(max_version2, max_version1);
            const is_dm = await is_delete_marker(full_path, '', disabled_key, max_version2);
            assert.ok(is_dm);
            assert.equal(res.VersionId, max_version2);
        });

        mocha.it('delete object - create dm & move latest -> .versions/ - 1st', async function() {
            const prev_version_id = await stat_and_get_version_id(full_path, key1);
            const max_version1 = await find_max_version_past(full_path, key1, '');
            const res = await s3_uid6.deleteObject({ Bucket: bucket_name, Key: key1 });
            assert.equal(res.DeleteMarker, true);

            await fs_utils.file_must_not_exist(path.join(full_path, key1));
            const exist = await version_file_exists(full_path, key1, '', prev_version_id);
            assert.ok(exist);
            const max_version2 = await find_max_version_past(full_path, key1, '');
            assert.notEqual(max_version2, max_version1);
            const is_dm = await is_delete_marker(full_path, '', key1, max_version2);
            assert.ok(is_dm);
            assert.equal(res.VersionId, max_version2);
        });

        mocha.it('delete object - create dm & move latest -> .versions/ - 2nd time', async function() {
            const max_version1 = await find_max_version_past(full_path, key1, '');
            const res = await s3_uid6.deleteObject({ Bucket: bucket_name, Key: key1 });
            assert.equal(res.DeleteMarker, true);

            await fs_utils.file_must_not_exist(path.join(full_path, key1));
            const exist = await version_file_exists(full_path, key1, '', max_version1);
            assert.ok(exist);
            const max_version2 = await find_max_version_past(full_path, key1, '');
            assert.notEqual(max_version2, max_version1);
            assert.equal(max_version2, res.VersionId);
            const is_dm = await is_delete_marker(full_path, '', key1, max_version2);
            assert.ok(is_dm);
        });
    });

    mocha.describe('copy object (latest version) - versioning suspended - nsfs copy fallback flow', function() {
        const is_enabled = false;
        const key_to_copy = 'orange.txt';
        const body_of_copied_key = 'drink orange juice';
        let copied_key = 'copied_orange.txt';

        // It was already set to Suspended in previous test (just to be on the safe side)
        mocha.before('set bucket versioning - Suspended', async function() {
            await s3_uid6.putBucketVersioning({ Bucket: suspended_bucket_name, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Suspended' } });
            await s3_uid6.putObject({ Bucket: suspended_bucket_name, Key: key_to_copy, Body: body_of_copied_key });
        });

        mocha.it('copy object - target bucket versioning suspended - 1st', async function() {
            const res = await s3_uid6.copyObject({ Bucket: suspended_bucket_name, Key: copied_key,
                CopySource: `${suspended_bucket_name}/${key_to_copy}` });
            const comp_res = await compare_version_ids(suspended_full_path, copied_key, res.VersionId, undefined, is_enabled);
            assert.ok(comp_res);
        });

        mocha.it('copy object - target bucket versioning suspended - 2nd', async function() {
            const prev_version_id = await stat_and_get_version_id(suspended_full_path, copied_key);
            const res = await s3_uid6.copyObject({ Bucket: suspended_bucket_name, Key: copied_key,
                CopySource: `${suspended_bucket_name}/${key_to_copy}` });
            const comp_res = await compare_version_ids(suspended_full_path, copied_key, res.VersionId, prev_version_id, is_enabled);
            assert.ok(comp_res);
            const exist = await version_file_must_not_exists(suspended_full_path, copied_key, '', prev_version_id);
            assert.ok(exist);
        });

        mocha.it('copy object latest - source bucket versioning suspended', async function() {
            copied_key = 'copied_orange2.txt';
            const res = await s3_uid6.copyObject({ Bucket: suspended_bucket_name, Key: copied_key,
                CopySource: `${suspended_bucket_name}/${key_to_copy}`});
            const body_comp_res = await get_obj_and_compare_data(s3_uid6, suspended_bucket_name, copied_key, body_of_copied_key);
            assert.ok(body_comp_res);
            const comp_res = await compare_version_ids(suspended_full_path, copied_key, res.VersionId, undefined, is_enabled);
            assert.ok(comp_res);
        });
    });

    mocha.describe('copy object by version id - versioning suspended - nsfs copy fallback flow', function() {
        const is_enabled = false;
        const key_to_copy = 'lemon.txt';
        const key_to_copy2 = 'lime.txt';
        const key_to_copy3 = 'avocado.txt';
        const body_of_copied_key = 'make the lemon lemonade';
        const body_of_copied_key_latest = 'lemons are yellow';
        let copied_key;
        let version_id_to_copy;
        let version_id_to_copy_latest;

        mocha.before('set bucket versioning - Enabled and then Suspended', async function() {
            await s3_uid6.putObject({ Bucket: suspended_bucket_name, Key: key_to_copy3, Body: body1 });
            await s3_uid6.putBucketVersioning({ Bucket: suspended_bucket_name, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
            const res_put = await s3_uid6.putObject({ Bucket: suspended_bucket_name, Key: key_to_copy,
                Body: body_of_copied_key });
            version_id_to_copy = res_put.VersionId;
            const res_put_latest = await s3_uid6.putObject({ Bucket: suspended_bucket_name,
                Key: key_to_copy, Body: body_of_copied_key_latest });
            version_id_to_copy_latest = res_put_latest.VersionId;
            await s3_uid6.putObject({ Bucket: suspended_bucket_name, Key: key_to_copy2, Body: body_of_copied_key });
            await s3_uid6.putObject({ Bucket: suspended_bucket_name, Key: key_to_copy3, Body: body2 });
            await s3_uid6.putBucketVersioning({ Bucket: suspended_bucket_name, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Suspended' } });
        });

        mocha.it('copy object latest & versionId - source bucket versioning suspended', async function() {
            copied_key = 'copied_lemon.txt';
            const res = await s3_uid6.copyObject({ Bucket: suspended_bucket_name, Key: copied_key,
                CopySource: `${suspended_bucket_name}/${key_to_copy}?versionId=${version_id_to_copy_latest}`});
            const body_comp_res = await get_obj_and_compare_data(s3_uid6, suspended_bucket_name, copied_key, body_of_copied_key_latest);
            assert.ok(body_comp_res);
            const comp_res = await compare_version_ids(suspended_full_path, copied_key, res.VersionId, undefined, is_enabled);
            assert.ok(comp_res);
        });

        mocha.it('copy object version id - source bucket versioning suspended', async function() {
            copied_key = 'copied_lemon2.txt';
            const res = await s3_uid6.copyObject({ Bucket: suspended_bucket_name, Key: copied_key,
                CopySource: `${suspended_bucket_name}/${key_to_copy}?versionId=${version_id_to_copy}`});
            const body_comp_res = await get_obj_and_compare_data(s3_uid6, suspended_bucket_name, copied_key, body_of_copied_key);
            assert.ok(body_comp_res);
            const comp_res = await compare_version_ids(suspended_full_path, copied_key, res.VersionId, undefined, is_enabled);
            assert.ok(comp_res);
        });

        mocha.it('copy object version null - versioning suspended - no version null - should fail', async function() {
            copied_key = 'copied_lime.txt';
            try {
                await s3_uid6.copyObject({ Bucket: suspended_bucket_name, Key: copied_key,
                    CopySource: `${suspended_bucket_name}/${key_to_copy2}?versionId=null`});
                assert.fail('should have failed');
            } catch (err) {
                assert.equal(err.Code, 'NoSuchKey');
            }
        });

        mocha.it('copy object - version does not exist - should fail', async function() {
            copied_key = 'copied_lime2.txt';
            try {
                await s3_uid6.copyObject({ Bucket: suspended_bucket_name, Key: copied_key,
                    CopySource: `${suspended_bucket_name}/${key_to_copy2}?versionId=mtime-123-ino-123`});
                assert.fail('should have failed');
            } catch (err) {
                assert.equal(err.Code, 'NoSuchKey');
            }
        });

        mocha.it('copy object version null - version is in .versions/ - versioning suspended', async function() {
            copied_key = 'copied_avocado.txt';
            const res = await s3_uid6.copyObject({ Bucket: suspended_bucket_name, Key: copied_key,
                CopySource: `${suspended_bucket_name}/${key_to_copy3}?versionId=null`});
            const body_comp_res = await get_obj_and_compare_data(s3_uid6, suspended_bucket_name, copied_key, body1);
            assert.ok(body_comp_res);
            const comp_res = await compare_version_ids(suspended_full_path, copied_key, res.VersionId, undefined, is_enabled);
            assert.ok(comp_res);
        });
    });

    mocha.describe('object tagging', function() {

        const tagging_key = "key_tagging";
        const tag_set1 = {TagSet: [{Key: "key1", Value: "Value1"}]};
        const tag_set2 = {TagSet: [{Key: "key2", Value: "Value2"}]};
        let version_id;

        mocha.before(async function() {
            await s3_uid6.putBucketVersioning({ Bucket: suspended_bucket_name, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
            const res_put = await s3_uid6.putObject({ Bucket: suspended_bucket_name, Key: tagging_key, Body: body1 });
            await s3_uid6.putObject({ Bucket: suspended_bucket_name, Key: tagging_key, Body: body1 });
            version_id = res_put.VersionId;
        });

        mocha.it("put object tagging - no versionId", async function() {
            await s3_uid6.putObjectTagging({ Bucket: suspended_bucket_name, Key: tagging_key, Tagging: tag_set1});
            const res = await s3_uid6.getObjectTagging({Bucket: suspended_bucket_name, Key: tagging_key});
            assert.deepEqual(res.TagSet, tag_set1.TagSet);
        });

        mocha.it("put object tagging - specific versionId", async function() {
            await s3_uid6.putObjectTagging({ Bucket: suspended_bucket_name, Key: tagging_key, Tagging: tag_set2, versionId: version_id});
            const res = await s3_uid6.getObjectTagging({Bucket: suspended_bucket_name, Key: tagging_key});
            assert.notDeepEqual(res.TagSet, tag_set2);
            const version_res = await s3_uid6.getObjectTagging({Bucket: suspended_bucket_name, Key: tagging_key});
            assert.deepEqual(version_res.TagSet, tag_set2.TagSet);
        });

        mocha.it("delete object tagging - no versionId", async function() {
            await s3_uid6.deleteObjectTagging({ Bucket: suspended_bucket_name, Key: tagging_key});
            const res = await s3_uid6.getObjectTagging({Bucket: suspended_bucket_name, Key: tagging_key});
            assert.equal(res.TagSet.length, 0);
        });

        mocha.it("delete object tagging - specific versionId", async function() {
            await s3_uid6.deleteObjectTagging({ Bucket: suspended_bucket_name, Key: tagging_key, versionId: version_id});
            const res = await s3_uid6.getObjectTagging({Bucket: suspended_bucket_name, Key: tagging_key, versionId: version_id});
            assert.equal(res.TagSet.length, 0);
        });
    });

    // dm = delete marker
    mocha.describe('delete object latest - versioning suspended', function() {
        const key_to_delete = 'mango.txt';
        const key_to_delete2 = 'plum.txt';
        const key_to_delete3 = 'kiwi.txt';

        mocha.before('set bucket versioning - Enabled and then Suspended', async function() {
            await s3_uid6.putBucketVersioning({ Bucket: suspended_bucket_name, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
            await s3_uid6.putObject({ Bucket: suspended_bucket_name, Key: key_to_delete, Body: body1 });
            await s3_uid6.putObject({ Bucket: suspended_bucket_name, Key: key_to_delete3, Body: body1 });
            await s3_uid6.putBucketVersioning({ Bucket: suspended_bucket_name, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Suspended' } });
            await s3_uid6.putObject({ Bucket: suspended_bucket_name, Key: key_to_delete2, Body: body1 });
        });

        mocha.it('delete object latest - create dm & move latest -> .versions/', async function() {
            const prev_version_id = await stat_and_get_version_id(suspended_full_path, key_to_delete);
            const max_version_before_delete = await find_max_version_past(suspended_full_path, key_to_delete, '');
            const res = await s3_uid6.deleteObject({ Bucket: suspended_bucket_name, Key: key_to_delete });
            assert.equal(res.DeleteMarker, true);

            let exist = await fs_utils.file_not_exists(path.join(suspended_full_path, key_to_delete));
            assert.ok(exist);
            exist = await version_file_exists(suspended_full_path, key_to_delete, '', prev_version_id);
            assert.ok(exist);
            const max_version_after_delete = await find_max_version_past(suspended_full_path, key_to_delete, '');
            assert.notEqual(max_version_after_delete, max_version_before_delete);
            const is_dm = await is_delete_marker(suspended_full_path, '', key_to_delete, max_version_after_delete);
            assert.ok(is_dm);
            assert.equal(res.VersionId, max_version_after_delete);
        });

        mocha.it('delete object - create dm & remove latest', async function() {
            const prev_version_id = await stat_and_get_version_id(suspended_full_path, key_to_delete2);
            const res = await s3_uid6.deleteObject({ Bucket: suspended_bucket_name, Key: key_to_delete2 });
            assert.equal(res.DeleteMarker, true);

            let exist = await fs_utils.file_not_exists(path.join(suspended_full_path, key_to_delete2));
            assert.ok(exist);
            exist = await version_file_exists(suspended_full_path, key_to_delete2, '', prev_version_id);
            assert.ok(exist);
            const max_version_after_delete = await find_max_version_past(suspended_full_path, key_to_delete2, '');
            const is_dm = await is_delete_marker(suspended_full_path, '', key_to_delete2, max_version_after_delete);
            assert.ok(is_dm);
            assert.equal(res.VersionId, max_version_after_delete);
        });

        mocha.it('delete object latest - non existing key', async function() {
            const non_existing_key = 'non_existing_key.txt';
            const res = await s3_uid6.deleteObject({ Bucket: suspended_bucket_name, Key: non_existing_key });
            assert.equal(res.DeleteMarker, true);

            const max_version_after_delete = await find_max_version_past(suspended_full_path, key_to_delete, '');
            const is_dm = await is_delete_marker(suspended_full_path, '', key_to_delete, max_version_after_delete);
            assert.ok(is_dm);
            assert.equal(res.VersionId, max_version_after_delete);
        });

        mocha.it('delete object when the latest is a dm with a unique version ID - should create another dm with null version ID', async function() {
            await s3_uid6.putBucketVersioning({ Bucket: suspended_bucket_name, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
            const prev_dm = await s3_uid6.deleteObject({ Bucket: suspended_bucket_name, Key: key_to_delete3 });
            assert.equal(prev_dm.DeleteMarker, true);
            const comp_prev = check_enable_version_format(prev_dm.VersionId);
            assert.ok(comp_prev);

            await s3_uid6.putBucketVersioning({ Bucket: suspended_bucket_name, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Suspended' } });
            const res = await s3_uid6.deleteObject({ Bucket: suspended_bucket_name, Key: key_to_delete3 });
            assert.equal(res.DeleteMarker, true);
            const comp_cur = check_null_version_id(res.VersionId);
            assert.ok(comp_cur);
            const latest_dm_version = await find_max_version_past(suspended_full_path, key_to_delete3, '');
            assert.equal(res.VersionId, latest_dm_version);
            const is_dm = await is_delete_marker(suspended_full_path, '', key_to_delete3, latest_dm_version);
            assert.ok(is_dm);
            const version_path = path.join(suspended_full_path, '.versions', key_to_delete3 + '_' + latest_dm_version);
            const version_info = await stat_and_get_all(version_path, '');
            assert.equal(version_info.xattr[XATTR_VERSION_ID], NULL_VERSION_ID);
        });
    });

    mocha.describe('delete object version id - versioning enabled', function() {
        const delete_object_test_bucket_reg = 'delete-object-test-bucket-reg';
        const delete_object_test_bucket_null = 'delete-object-test-bucket-null';
        const delete_object_test_bucket_dm = 'delete-object-test-bucket-dm';

        const full_delete_path = path.join(tmp_fs_root, delete_object_test_bucket_reg);
        const full_delete_path_null = path.join(tmp_fs_root, delete_object_test_bucket_null);
        const full_delete_path_dm = path.join(tmp_fs_root, delete_object_test_bucket_dm);

        let account_with_access;
        mocha.describe('delete object - versioning enabled', function() {
            mocha.describe('delete object - regular version - versioning enabled', async function() {
                mocha.before(async function() {
                    const res = await generate_nsfs_account(rpc_client, EMAIL, new_bucket_path_param, { default_resource: nsr});
                    account_with_access = generate_s3_client(res.access_key, res.secret_key, CORETEST_ENDPOINT);
                    await account_with_access.createBucket({ Bucket: delete_object_test_bucket_reg });
                    await put_allow_all_bucket_policy(account_with_access, delete_object_test_bucket_reg);
                    await account_with_access.createBucket({ Bucket: delete_object_test_bucket_null });
                    await put_allow_all_bucket_policy(account_with_access, delete_object_test_bucket_null);
                    await account_with_access.createBucket({ Bucket: delete_object_test_bucket_dm });
                    await put_allow_all_bucket_policy(account_with_access, delete_object_test_bucket_dm);
                });

            mocha.it('delete version id - fake id - nothing to remove', async function() {
                const max_version1 = await find_max_version_past(full_path, key1, '');
                await account_with_access.deleteObject({ Bucket: delete_object_test_bucket_reg, Key: key1, VersionId: 'mtime-123-ino-123'});
                const max_version2 = await find_max_version_past(full_path, key1, '');
                assert.equal(max_version1, max_version2);
            });

            mocha.it('delete object version id - latest - second latest is null version', async function() {
                const upload_res_arr = await upload_object_versions(account_with_access, delete_object_test_bucket_reg, key1, ['null', 'regular']);
                const cur_version_id1 = await stat_and_get_version_id(full_delete_path, key1);

                const delete_res = await account_with_access.deleteObject({
                    Bucket: delete_object_test_bucket_reg,
                    Key: key1, VersionId: upload_res_arr[1].VersionId
                });
                assert.equal(delete_res.VersionId, cur_version_id1);

                const cur_version_id2 = await stat_and_get_version_id(full_delete_path, key1);
                assert.notEqual(cur_version_id1, cur_version_id2);
                assert.equal('null', cur_version_id2);
                await fs_utils.file_must_not_exist(path.join(full_delete_path, key1 + '_' + upload_res_arr[1].VersionId));
                const max_version1 = await find_max_version_past(full_delete_path, key1, '');
                assert.equal(max_version1, undefined);
                await delete_object_versions(full_delete_path, key1);
            });

            mocha.it('delete object version id - latest - second latest is delete marker version ', async function() {
                const upload_res_arr = await upload_object_versions(account_with_access, delete_object_test_bucket_reg, key1, ['regular', 'delete_marker', 'regular']);
                const max_version0 = await find_max_version_past(full_delete_path, key1, '');
                const cur_version_id1 = await stat_and_get_version_id(full_delete_path, key1);
                assert.equal(upload_res_arr[2].VersionId, cur_version_id1);
                const is_dm = await is_delete_marker(full_delete_path, '', key1, max_version0);
                assert.ok(is_dm);

                const delete_res = await account_with_access.deleteObject({ Bucket: delete_object_test_bucket_reg,
                    Key: key1, VersionId: upload_res_arr[2].VersionId });
                assert.equal(delete_res.VersionId, cur_version_id1);
                await fs_utils.file_must_not_exist(path.join(full_delete_path, key1));
                const max_version1 = await find_max_version_past(full_delete_path, key1, '');
                assert.equal(max_version1, max_version0);
                await delete_object_versions(full_delete_path, key1);
            });

            mocha.it('delete object version id - in .versions/', async function() {
                const put_res = await account_with_access.putObject({
                    Bucket: delete_object_test_bucket_reg, Key: key1, Body: body1 });
                await account_with_access.putObject({ Bucket: delete_object_test_bucket_reg, Key: key1, Body: body1 });
                const cur_version_id1 = await stat_and_get_version_id(full_delete_path, key1);
                const delete_res = await account_with_access.deleteObject({ Bucket: delete_object_test_bucket_reg,
                    Key: key1, VersionId: put_res.VersionId });
                assert.equal(put_res.VersionId, delete_res.VersionId);
                const cur_version_id2 = await stat_and_get_version_id(full_delete_path, key1);
                assert.equal(cur_version_id1, cur_version_id2);
                const exist = await version_file_must_not_exists(full_delete_path, key1, '', put_res.VersionId);
                assert.ok(exist);
                const max_version1 = await find_max_version_past(full_delete_path, key1, '');
                assert.equal(max_version1, undefined);
            });

            mocha.it('delete object version id - latest - no second latest', async function() {
                const cur_version_id = await stat_and_get_version_id(full_delete_path, key1);
                await account_with_access.deleteObject({ Bucket: delete_object_test_bucket_reg,
                    Key: key1, VersionId: cur_version_id });
                await fs_utils.file_must_not_exist(path.join(full_delete_path, key1 + '_' + cur_version_id));
                const max_version1 = await find_max_version_past(full_delete_path, key1, '');
                assert.equal(max_version1, undefined);
            });

            mocha.it('delete object version id - in .versions/ 2 - latest exist and it\'s a regular version', async function() {
                const upload_res_arr = await upload_object_versions(account_with_access, delete_object_test_bucket_reg, key1, ['regular', 'regular', 'regular']);

                const cur_version_id1 = await stat_and_get_version_id(full_delete_path, key1);
                assert.equal(cur_version_id1, upload_res_arr[2].VersionId);

                const delete_res = await account_with_access.deleteObject({ Bucket: delete_object_test_bucket_reg,
                    Key: key1, VersionId: upload_res_arr[1].VersionId });
                assert.equal(upload_res_arr[1].VersionId, delete_res.VersionId);
                const cur_version_id2 = await stat_and_get_version_id(full_delete_path, key1);
                assert.equal(cur_version_id1, cur_version_id2);
                const exist = await version_file_must_not_exists(full_delete_path, key1, '', upload_res_arr[1].VersionId);
                assert.ok(exist);
                const max_version1 = await find_max_version_past(full_delete_path, key1, '');
                assert.equal(max_version1, upload_res_arr[0].VersionId);
                await delete_object_versions(full_delete_path, key1);
            });

            mocha.it('delete object version id - in .versions/ 3 - latest exist and it\'s a delete marker', async function() {
                const upload_res_arr = await upload_object_versions(account_with_access, delete_object_test_bucket_reg, key1, ['regular', 'regular', 'delete_marker']);

                await fs_utils.file_must_not_exist(path.join(full_delete_path, key1));
                const latest_dm_version_id1 = await find_max_version_past(full_delete_path, key1, '');
                assert.equal(latest_dm_version_id1, upload_res_arr[2].VersionId);

                const delete_res = await account_with_access.deleteObject({ Bucket: delete_object_test_bucket_reg,
                    Key: key1, VersionId: upload_res_arr[1].VersionId });
                assert.equal(upload_res_arr[1].VersionId, delete_res.VersionId);

                await fs_utils.file_must_not_exist(path.join(full_delete_path, key1));
                const latest_dm_version_id2 = await find_max_version_past(full_delete_path, key1, '');
                assert.equal(latest_dm_version_id1, latest_dm_version_id2);
                const version_deleted = await version_file_must_not_exists(full_delete_path, key1, '', upload_res_arr[1].VersionId);
                assert.ok(version_deleted);
                await delete_object_versions(full_delete_path, key1);
            });

            mocha.it('delete object version id - latest - second latest is regular version ', async function() {
                const upload_res_arr = await upload_object_versions(account_with_access, delete_object_test_bucket_reg, key1, ['regular', 'regular']);
                const cur_version_id1 = await stat_and_get_version_id(full_delete_path, key1);

                await account_with_access.deleteObject({ Bucket: delete_object_test_bucket_reg,
                    Key: key1, VersionId: upload_res_arr[1].VersionId });

                const cur_version_id2 = await stat_and_get_version_id(full_delete_path, key1);

                assert.notEqual(cur_version_id1, cur_version_id2);
                assert.equal(upload_res_arr[0].VersionId, cur_version_id2);
                await fs_utils.file_must_not_exist(path.join(full_delete_path, key1 + '_' + upload_res_arr[1].VersionId));
                const max_version1 = await find_max_version_past(full_delete_path, key1, '');
                assert.equal(max_version1, undefined);
                await delete_object_versions(full_delete_path, key1);
            });

            mocha.it('delete object version null - latest, no second latest', async function() {
                const upload_res_arr = await upload_object_versions(account_with_access, delete_object_test_bucket_null, key1, ['null']);
                const cur_version_id1 = await stat_and_get_version_id(full_delete_path_null, key1);
                assert.equal(upload_res_arr[0].VersionId, undefined);
                assert.equal(cur_version_id1, 'null');

                await account_with_access.deleteObject({ Bucket: delete_object_test_bucket_null,
                    Key: key1, VersionId: 'null' });

                await fs_utils.file_must_not_exist(path.join(full_delete_path_null, key1));
                const max_version1 = await find_max_version_past(full_delete_path_null, key1, '');
                assert.equal(max_version1, undefined);
                await delete_object_versions(full_delete_path_null, key1);
            });

            mocha.it('delete object version null - version is in .versions/', async function() {
                const upload_res_arr = await upload_object_versions(account_with_access, delete_object_test_bucket_null, key1, ['null', 'regular']);
                const cur_version_id1 = await stat_and_get_version_id(full_delete_path_null, key1);
                assert.equal(upload_res_arr[0].VersionId, undefined);
                assert.notEqual(cur_version_id1, 'null');
                assert.equal(cur_version_id1, upload_res_arr[1].VersionId);

                await account_with_access.deleteObject({ Bucket: delete_object_test_bucket_null,
                    Key: key1, VersionId: 'null' });

                const max_version1 = await find_max_version_past(full_delete_path_null, key1, '');
                assert.equal(max_version1, undefined);
                const cur_version_id2 = await stat_and_get_version_id(full_delete_path_null, key1);
                assert.equal(cur_version_id1, cur_version_id2);

                await delete_object_versions(full_delete_path_null, key1);
            });

            mocha.it('delete object version delete marker - latest - second latest is a null version', async function() {
                await upload_object_versions(account_with_access, delete_object_test_bucket_dm, key1, ['null', 'delete_marker']);
                await fs_utils.file_must_not_exist(path.join(full_delete_path_dm, key1));
                const max_version = await find_max_version_past(full_delete_path_dm, key1, '');
                const second_max_version1 = await find_max_version_past(full_delete_path_dm, key1, '', [max_version]);

                const delete_res = await account_with_access.deleteObject({ Bucket: delete_object_test_bucket_dm,
                    Key: key1, VersionId: max_version });

                assert.equal(delete_res.DeleteMarker, true);
                assert.equal(delete_res.VersionId, max_version);

                const max_version1 = await find_max_version_past(full_delete_path_dm, key1, '');
                assert.equal(max_version1, undefined);
                await fs_utils.file_must_exist(path.join(full_delete_path_dm, key1));
                await version_file_must_not_exists(full_delete_path_dm, key1, '', second_max_version1);
                const new_latest_ver_id = await stat_and_get_version_id(full_delete_path_dm, key1);
                assert.equal(new_latest_ver_id, 'null');

                await delete_object_versions(full_delete_path_dm, key1);
            });

            mocha.it('delete object version delete marker - non latest', async function() {
                await upload_object_versions(account_with_access, delete_object_test_bucket_dm, key1, ['regular', 'delete_marker', 'delete_marker']);
                await fs_utils.file_must_not_exist(path.join(full_delete_path_dm, key1));
                const max_version = await find_max_version_past(full_delete_path_dm, key1, '');
                const second_max_version1 = await find_max_version_past(full_delete_path_dm, key1, '', [max_version]);

                const delete_res = await account_with_access.deleteObject({ Bucket: delete_object_test_bucket_dm,
                    Key: key1, VersionId: second_max_version1 });

                assert.equal(delete_res.DeleteMarker, true);
                assert.equal(delete_res.VersionId, second_max_version1);

                await fs_utils.file_must_not_exist(path.join(full_delete_path_dm, key1));
                await version_file_must_not_exists(full_delete_path, key1, '', second_max_version1);
                const max_version1 = await find_max_version_past(full_delete_path_dm, key1, '');
                assert.equal(max_version1, max_version);

                await delete_object_versions(full_delete_path_dm, key1);
            });

            mocha.it('delete object version delete marker - latest - second latest is a delete marker', async function() {
                await upload_object_versions(account_with_access, delete_object_test_bucket_dm, key1, ['regular', 'delete_marker', 'delete_marker']);
                await fs_utils.file_must_not_exist(path.join(full_delete_path_dm, key1));
                const max_version = await find_max_version_past(full_delete_path_dm, key1, '');
                const second_max_version1 = await find_max_version_past(full_delete_path_dm, key1, '', [max_version]);

                await account_with_access.deleteObject({ Bucket: delete_object_test_bucket_dm,
                    Key: key1, VersionId: max_version });

                await fs_utils.file_must_not_exist(path.join(full_delete_path_dm, key1));
                await version_file_exists(full_delete_path_dm, key1, '', second_max_version1);
                const max_version1 = await find_max_version_past(full_delete_path_dm, key1, '');
                assert.equal(max_version1, second_max_version1);

                await delete_object_versions(full_delete_path_dm, key1);
            });

            mocha.it('delete object version delete marker - latest - second latest is a regular version', async function() {
                const put_res = await upload_object_versions(account_with_access, delete_object_test_bucket_dm, key1, ['regular', 'regular', 'delete_marker']);
                await fs_utils.file_must_not_exist(path.join(full_delete_path_dm, key1));
                const max_version = await find_max_version_past(full_delete_path_dm, key1, '');
                const second_max_version1 = await find_max_version_past(full_delete_path_dm, key1, '', [max_version]);

                await account_with_access.deleteObject({ Bucket: delete_object_test_bucket_dm,
                    Key: key1, VersionId: max_version });

                await fs_utils.file_must_exist(path.join(full_delete_path_dm, key1));
                await version_file_must_not_exists(full_delete_path_dm, key1, '', second_max_version1);
                const max_version1 = await find_max_version_past(full_delete_path_dm, key1, '');
                assert.notEqual(max_version1, second_max_version1);
                assert.equal(put_res[0].VersionId, max_version1);

                await delete_object_versions(full_delete_path_dm, key1);
            });

            mocha.it('delete object version delete marker - latest - no second latest', async function() {
                const put_res = await upload_object_versions(account_with_access, delete_object_test_bucket_dm, key1, ['delete_marker']);
                await fs_utils.file_must_not_exist(path.join(full_delete_path_dm, key1));
                const max_version = await find_max_version_past(full_delete_path_dm, key1, '');
                assert.equal(put_res[0].VersionId, max_version);

                await account_with_access.deleteObject({ Bucket: delete_object_test_bucket_dm,
                    Key: key1, VersionId: max_version });

                await fs_utils.file_must_not_exist(path.join(full_delete_path_dm, key1));
                await version_file_must_not_exists(full_delete_path_dm, key1, '', max_version);
                const max_version1 = await find_max_version_past(full_delete_path_dm, key1, '');
                assert.equal(max_version1, undefined);
                await delete_object_versions(full_delete_path_dm, key1);
            });

            mocha.it('delete object version delete marker - in .versions/ - latest exist', async function() {
                const put_res = await upload_object_versions(account_with_access, delete_object_test_bucket_dm, key1, ['regular', 'delete_marker', 'regular']);
                const ltst_version_id1 = await stat_and_get_version_id(full_delete_path_dm, key1);
                const max_version = await find_max_version_past(full_delete_path_dm, key1, '');
                const second_max_version1 = await find_max_version_past(full_delete_path_dm, key1, '', [max_version]);

                await account_with_access.deleteObject({ Bucket: delete_object_test_bucket_dm,
                    Key: key1, VersionId: max_version });

                await fs_utils.file_must_exist(path.join(full_delete_path_dm, key1));
                const ltst_version_id2 = await stat_and_get_version_id(full_delete_path_dm, key1);
                assert.equal(ltst_version_id1, ltst_version_id2);
                await version_file_exists(full_delete_path_dm, key1, '', second_max_version1);
                const max_version1 = await find_max_version_past(full_delete_path_dm, key1, '');
                assert.equal(max_version1, second_max_version1);
                assert.equal(put_res[0].VersionId, max_version1);

                await delete_object_versions(full_delete_path_dm, key1);
            });

            mocha.it('delete object version delete marker - in .versions/ - latest is a delete marker', async function() {
                const put_res = await upload_object_versions(account_with_access, delete_object_test_bucket_dm, key1, ['regular', 'delete_marker', 'delete_marker']);
                await fs_utils.file_must_not_exist(path.join(full_delete_path_dm, key1));
                const latest_dm1 = await find_max_version_past(full_delete_path_dm, key1, '');

                await account_with_access.deleteObject({ Bucket: delete_object_test_bucket_dm,
                    Key: key1, VersionId: put_res[1].VersionId });

                await fs_utils.file_must_not_exist(path.join(full_delete_path_dm, key1));
                const latest_dm2 = await find_max_version_past(full_delete_path_dm, key1, '');
                assert.equal(latest_dm1, latest_dm2);
                await delete_object_versions(full_delete_path_dm, key1);
            });
        });
    });
    });

    // Delete object version id is the same implementation to Enabled and Suspended.
    // Thus, the tests are the same and their objective is only to validate that future code changes
    // would not change the behavior of delete object version with suspended mode.
    mocha.describe('delete object version id - versioning suspended', function() {
        const delete_object_test_bucket_reg = 'delete-object-suspended-test-bucket-reg';
        const delete_object_test_bucket_null = 'delete-object-suspended-test-bucket-null';
        const delete_object_test_bucket_dm = 'delete-object-test-suspended-bucket-dm';

        const full_delete_path = path.join(tmp_fs_root, delete_object_test_bucket_reg);
        const full_delete_path_null = path.join(tmp_fs_root, delete_object_test_bucket_null);
        const full_delete_path_dm = path.join(tmp_fs_root, delete_object_test_bucket_dm);

        let account_with_access;
        mocha.before(async function() {
            const res = await generate_nsfs_account(rpc_client, EMAIL, new_bucket_path_param, { default_resource: nsr });
            account_with_access = generate_s3_client(res.access_key, res.secret_key, CORETEST_ENDPOINT);
            await account_with_access.createBucket({ Bucket: delete_object_test_bucket_reg });
            await put_allow_all_bucket_policy(account_with_access, delete_object_test_bucket_reg);
            await account_with_access.createBucket({ Bucket: delete_object_test_bucket_null });
            await put_allow_all_bucket_policy(account_with_access, delete_object_test_bucket_null);
            await account_with_access.createBucket({ Bucket: delete_object_test_bucket_dm });
            await put_allow_all_bucket_policy(account_with_access, delete_object_test_bucket_dm);
        });

        mocha.describe('delete object - regular version - versioning suspended', async function() {

            mocha.it('delete version id - fake id - nothing to remove - bucket will be suspended', async function() {
                const max_version1 = await find_max_version_past(full_delete_path, key1, '');
                assert.equal(max_version1, undefined);
                await account_with_access.deleteObject({ Bucket: delete_object_test_bucket_reg, Key: key1, VersionId: 'mtime-123-ino-123'});
                const max_version2 = await find_max_version_past(full_delete_path, key1, '');
                assert.equal(max_version2, undefined);
            });

            mocha.it('delete object version id - latest - second latest is null version - versioning suspended', async function() {
                const upload_res_arr = await upload_object_versions(account_with_access, delete_object_test_bucket_reg, key1, ['null', 'regular']);
                await s3_uid6.putBucketVersioning({ Bucket: delete_object_test_bucket_reg, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Suspended' } });
                const cur_version_id1 = await stat_and_get_version_id(full_delete_path, key1);

                const delete_res = await account_with_access.deleteObject({ Bucket: delete_object_test_bucket_reg,
                    Key: key1, VersionId: upload_res_arr[1].VersionId });
                assert.equal(delete_res.VersionId, cur_version_id1);

                const cur_version_id2 = await stat_and_get_version_id(full_delete_path, key1);
                assert.notEqual(cur_version_id1, cur_version_id2);
                assert.equal('null', cur_version_id2);
                const exist = await fs_utils.file_not_exists(path.join(full_delete_path, key1 + '_' + upload_res_arr[1].VersionId));
                assert.ok(exist);
                const max_version1 = await find_max_version_past(full_delete_path, key1, '');
                assert.equal(max_version1, undefined);
                await delete_object_versions(full_delete_path, key1);
                await s3_uid6.putBucketVersioning({ Bucket: delete_object_test_bucket_reg, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
            });

            mocha.it('delete object version id - latest - second latest is delete marker version - versioning suspended', async function() {
                const upload_res_arr = await upload_object_versions(account_with_access, delete_object_test_bucket_reg, key1, ['regular', 'delete_marker', 'regular']);
                await s3_uid6.putBucketVersioning({ Bucket: delete_object_test_bucket_reg, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Suspended' } });
                const max_version0 = await find_max_version_past(full_delete_path, key1, '');

                const cur_version_id1 = await stat_and_get_version_id(full_delete_path, key1);
                assert.equal(upload_res_arr[2].VersionId, cur_version_id1);
                const is_dm = await is_delete_marker(full_delete_path, '', key1, max_version0);
                assert.ok(is_dm);

                const delete_res = await account_with_access.deleteObject({ Bucket: delete_object_test_bucket_reg,
                    Key: key1, VersionId: upload_res_arr[2].VersionId });
                assert.equal(delete_res.VersionId, cur_version_id1);
                const exist = await fs_utils.file_not_exists(path.join(full_delete_path, key1));
                assert.ok(exist);
                const max_version1 = await find_max_version_past(full_delete_path, key1, '');
                assert.equal(max_version1, max_version0);
                await delete_object_versions(full_delete_path, key1);
                await s3_uid6.putBucketVersioning({ Bucket: delete_object_test_bucket_reg, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
            });

            mocha.it('delete object version id - in .versions/ - versioning suspended', async function() {
                const put_res = await account_with_access.putObject({
                    Bucket: delete_object_test_bucket_reg, Key: key1, Body: body1 });
                await account_with_access.putObject({ Bucket: delete_object_test_bucket_reg, Key: key1, Body: body1 });
                const cur_version_id1 = await stat_and_get_version_id(full_delete_path, key1);
                await s3_uid6.putBucketVersioning({ Bucket: delete_object_test_bucket_reg, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Suspended' } });

                const delete_res = await account_with_access.deleteObject({ Bucket: delete_object_test_bucket_reg,
                    Key: key1, VersionId: put_res.VersionId });
                assert.equal(put_res.VersionId, delete_res.VersionId);
                const cur_version_id2 = await stat_and_get_version_id(full_delete_path, key1);
                assert.equal(cur_version_id1, cur_version_id2);
                const exist = await version_file_must_not_exists(full_delete_path, key1, '', put_res.VersionId);
                assert.ok(exist);
                const max_version1 = await find_max_version_past(full_delete_path, key1, '');
                assert.equal(max_version1, undefined);
            });

            mocha.it('delete object version id - latest - no second latest - versioning suspended', async function() {
                const cur_version_id = await stat_and_get_version_id(full_delete_path, key1);
                await account_with_access.deleteObject({ Bucket: delete_object_test_bucket_reg,
                    Key: key1, VersionId: cur_version_id });
                const exist = await fs_utils.file_not_exists(path.join(full_delete_path, key1 + '_' + cur_version_id));
                assert.ok(exist);
                const max_version1 = await find_max_version_past(full_delete_path, key1, '');
                assert.equal(max_version1, undefined);
                await s3_uid6.putBucketVersioning({ Bucket: delete_object_test_bucket_reg, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
            });

            mocha.it('delete object version id - in .versions/ 2 - latest exist and it\'s a regular version - versioning suspended', async function() {
                const upload_res_arr = await upload_object_versions(account_with_access, delete_object_test_bucket_reg, key1, ['regular', 'regular', 'regular']);
                await s3_uid6.putBucketVersioning({ Bucket: delete_object_test_bucket_reg, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Suspended' } });
                const cur_version_id1 = await stat_and_get_version_id(full_delete_path, key1);
                assert.equal(cur_version_id1, upload_res_arr[2].VersionId);

                const delete_res = await account_with_access.deleteObject({ Bucket: delete_object_test_bucket_reg,
                    Key: key1, VersionId: upload_res_arr[1].VersionId });
                assert.equal(upload_res_arr[1].VersionId, delete_res.VersionId);
                const cur_version_id2 = await stat_and_get_version_id(full_delete_path, key1);
                assert.equal(cur_version_id1, cur_version_id2);
                const exist = await version_file_must_not_exists(full_delete_path, key1, '', upload_res_arr[1].VersionId);
                assert.ok(exist);
                const max_version1 = await find_max_version_past(full_delete_path, key1, '');
                assert.equal(max_version1, upload_res_arr[0].VersionId);
                await delete_object_versions(full_delete_path, key1);
                await s3_uid6.putBucketVersioning({ Bucket: delete_object_test_bucket_reg, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
            });

            mocha.it('delete object version id - in .versions/ 3 - latest exist and it\'s a delete marker - versioning suspended', async function() {
                const upload_res_arr = await upload_object_versions(account_with_access, delete_object_test_bucket_reg, key1, ['regular', 'regular', 'delete_marker']);
                await s3_uid6.putBucketVersioning({ Bucket: delete_object_test_bucket_reg, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Suspended' } });

                let exist = await fs_utils.file_not_exists(path.join(full_delete_path, key1));
                assert.ok(exist);
                const latest_dm_version_id1 = await find_max_version_past(full_delete_path, key1, '');
                assert.equal(latest_dm_version_id1, upload_res_arr[2].VersionId);

                const delete_res = await account_with_access.deleteObject({ Bucket: delete_object_test_bucket_reg,
                    Key: key1, VersionId: upload_res_arr[1].VersionId });
                assert.equal(upload_res_arr[1].VersionId, delete_res.VersionId);

                exist = await fs_utils.file_not_exists(path.join(full_delete_path, key1));
                assert.ok(exist);
                const latest_dm_version_id2 = await find_max_version_past(full_delete_path, key1, '');
                assert.equal(latest_dm_version_id1, latest_dm_version_id2);
                const version_deleted = await version_file_must_not_exists(full_delete_path, key1, '', upload_res_arr[1].VersionId);
                assert.ok(version_deleted);
                await delete_object_versions(full_delete_path, key1);
                await s3_uid6.putBucketVersioning({ Bucket: delete_object_test_bucket_reg, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
            });

            mocha.it('delete object version id - latest - second latest is regular version - versioning suspended', async function() {
                const upload_res_arr = await upload_object_versions(account_with_access, delete_object_test_bucket_reg, key1, ['regular', 'regular']);
                await s3_uid6.putBucketVersioning({ Bucket: delete_object_test_bucket_reg, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Suspended' } });
                const cur_version_id1 = await stat_and_get_version_id(full_delete_path, key1);

                await account_with_access.deleteObject({ Bucket: delete_object_test_bucket_reg,
                    Key: key1, VersionId: upload_res_arr[1].VersionId });

                const cur_version_id2 = await stat_and_get_version_id(full_delete_path, key1);
                assert.notEqual(cur_version_id1, cur_version_id2);
                assert.equal(upload_res_arr[0].VersionId, cur_version_id2);
                const exist = await fs_utils.file_not_exists(path.join(full_delete_path, key1 + '_' + upload_res_arr[1].VersionId));
                assert.ok(exist);
                const max_version1 = await find_max_version_past(full_delete_path, key1, '');
                assert.equal(max_version1, undefined);
                await delete_object_versions(full_delete_path, key1);
                await s3_uid6.putBucketVersioning({ Bucket: delete_object_test_bucket_reg, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
            });
        });

        mocha.describe('delete object - null version - versioning suspended', async function() {

            mocha.it('delete object version null - latest, no second latest - versioning suspended', async function() {
                const upload_res_arr = await upload_object_versions(account_with_access, delete_object_test_bucket_null, key1, ['null']);
                await s3_uid6.putBucketVersioning({ Bucket: delete_object_test_bucket_null, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Suspended' } });
                const cur_version_id1 = await stat_and_get_version_id(full_delete_path_null, key1);
                assert.equal(upload_res_arr[0].VersionId, undefined);
                assert.equal(cur_version_id1, 'null');

                await account_with_access.deleteObject({ Bucket: delete_object_test_bucket_null,
                    Key: key1, VersionId: 'null' });

                const exist = await fs_utils.file_not_exists(path.join(full_delete_path_null, key1));
                assert.ok(exist);
                const max_version1 = await find_max_version_past(full_delete_path_null, key1, '');
                assert.equal(max_version1, undefined);
                await delete_object_versions(full_delete_path_null, key1);
            });

            mocha.it('delete object version null - version is in .versions/ - versioning suspended', async function() {
                const upload_res_arr = []; // would contain ['null', 'regular'] put_res
                const put_res_null = await account_with_access.putObject({ Bucket: delete_object_test_bucket_null,
                    Key: key1, Body: body1 });
                upload_res_arr.push(put_res_null);
                await s3_uid6.putBucketVersioning({ Bucket: delete_object_test_bucket_null, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
                const put_res_regular = await account_with_access.putObject({ Bucket: delete_object_test_bucket_null,
                        Key: key1, Body: body1 });
                upload_res_arr.push(put_res_regular);
                await s3_uid6.putBucketVersioning({ Bucket: delete_object_test_bucket_null, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Suspended' } });

                const cur_version_id1 = await stat_and_get_version_id(full_delete_path_null, key1);
                assert.equal(upload_res_arr[0].VersionId, undefined);
                assert.notEqual(cur_version_id1, 'null');
                assert.equal(cur_version_id1, upload_res_arr[1].VersionId);

                await account_with_access.deleteObject({ Bucket: delete_object_test_bucket_null,
                    Key: key1, VersionId: 'null' });

                const max_version1 = await find_max_version_past(full_delete_path_null, key1, '');
                assert.equal(max_version1, undefined);
                const cur_version_id2 = await stat_and_get_version_id(full_delete_path_null, key1);
                assert.equal(cur_version_id1, cur_version_id2);

                await delete_object_versions(full_delete_path_null, key1);
                await s3_uid6.putBucketVersioning({ Bucket: delete_object_test_bucket_null, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
            });
        });

        mocha.describe('delete object - delete marker version - versioning suspended', async function() {

            mocha.it('delete object version delete marker - latest - second latest is a null version - versioning suspended', async function() {
                await upload_object_versions(account_with_access, delete_object_test_bucket_dm, key1, ['null', 'delete_marker']);
                await s3_uid6.putBucketVersioning({ Bucket: delete_object_test_bucket_dm, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Suspended' } });

                let exist = await fs_utils.file_not_exists(path.join(full_delete_path_dm, key1));
                assert.ok(exist);
                const max_version = await find_max_version_past(full_delete_path_dm, key1, '');
                const second_max_version1 = await find_max_version_past(full_delete_path_dm, key1, '', [max_version]);


                const delete_res = await account_with_access.deleteObject({ Bucket: delete_object_test_bucket_dm,
                    Key: key1, VersionId: max_version });

                assert.equal(delete_res.DeleteMarker, true);
                assert.equal(delete_res.VersionId, max_version);

                const max_version1 = await find_max_version_past(full_delete_path_dm, key1, '');
                assert.equal(max_version1, undefined);
                exist = await fs_utils.file_exists(path.join(full_delete_path_dm, key1));
                assert.ok(exist);
                exist = await version_file_must_not_exists(full_delete_path_dm, key1, '', second_max_version1);
                assert.ok(exist);
                const new_latest_ver_id = await stat_and_get_version_id(full_delete_path_dm, key1);
                assert.equal(new_latest_ver_id, 'null');

                await delete_object_versions(full_delete_path_dm, key1);
                await s3_uid6.putBucketVersioning({ Bucket: delete_object_test_bucket_dm, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
            });

            mocha.it('delete object version delete marker - non latest - versioning suspended', async function() {
                await upload_object_versions(account_with_access, delete_object_test_bucket_dm, key1, ['regular', 'delete_marker', 'delete_marker']);
                await s3_uid6.putBucketVersioning({ Bucket: delete_object_test_bucket_dm, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Suspended' } });
                let exist = await fs_utils.file_not_exists(path.join(full_delete_path_dm, key1));
                assert.ok(exist);
                const max_version = await find_max_version_past(full_delete_path_dm, key1, '');
                const second_max_version1 = await find_max_version_past(full_delete_path_dm, key1, '', [max_version]);


                const delete_res = await account_with_access.deleteObject({ Bucket: delete_object_test_bucket_dm,
                    Key: key1, VersionId: second_max_version1 });

                assert.equal(delete_res.DeleteMarker, true);
                assert.equal(delete_res.VersionId, second_max_version1);

                exist = await fs_utils.file_not_exists(path.join(full_delete_path_dm, key1));
                assert.ok(exist);
                exist = await version_file_must_not_exists(full_delete_path_dm, key1, '', second_max_version1);
                assert.ok(exist);
                const max_version1 = await find_max_version_past(full_delete_path_dm, key1, '');
                assert.equal(max_version1, max_version);

                await delete_object_versions(full_delete_path_dm, key1);
                await s3_uid6.putBucketVersioning({ Bucket: delete_object_test_bucket_dm, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
            });

            mocha.it('delete object version delete marker - latest - second latest is a delete marker - versioning suspended', async function() {
                await upload_object_versions(account_with_access, delete_object_test_bucket_dm, key1, ['regular', 'delete_marker', 'delete_marker']);
                await s3_uid6.putBucketVersioning({ Bucket: delete_object_test_bucket_dm, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Suspended' } });

                let exist = await fs_utils.file_not_exists(path.join(full_delete_path_dm, key1));
                assert.ok(exist);
                const max_version = await find_max_version_past(full_delete_path_dm, key1, '');
                const second_max_version1 = await find_max_version_past(full_delete_path_dm, key1, '', [max_version]);

                await account_with_access.deleteObject({ Bucket: delete_object_test_bucket_dm,
                    Key: key1, VersionId: max_version });

                exist = await fs_utils.file_not_exists(path.join(full_delete_path_dm, key1));
                assert.ok(exist);
                exist = await version_file_exists(full_delete_path_dm, key1, '', second_max_version1);
                assert.ok(exist);
                const max_version1 = await find_max_version_past(full_delete_path_dm, key1, '');
                assert.equal(max_version1, second_max_version1);

                await delete_object_versions(full_delete_path_dm, key1);
                await s3_uid6.putBucketVersioning({ Bucket: delete_object_test_bucket_dm, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
            });

            mocha.it('delete object version delete marker - latest - second latest is a regular version - versioning suspended', async function() {
                const put_res = await upload_object_versions(account_with_access, delete_object_test_bucket_dm, key1, ['regular', 'regular', 'delete_marker']);
                await s3_uid6.putBucketVersioning({ Bucket: delete_object_test_bucket_dm, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Suspended' } });
                let exist = await fs_utils.file_not_exists(path.join(full_delete_path_dm, key1));
                assert.ok(exist);
                const max_version = await find_max_version_past(full_delete_path_dm, key1, '');
                const second_max_version1 = await find_max_version_past(full_delete_path_dm, key1, '', [max_version]);

                await account_with_access.deleteObject({ Bucket: delete_object_test_bucket_dm,
                    Key: key1, VersionId: max_version });

                exist = await fs_utils.file_exists(path.join(full_delete_path_dm, key1));
                assert.ok(exist);
                exist = await version_file_must_not_exists(full_delete_path_dm, key1, '', second_max_version1);
                assert.ok(exist);
                const max_version1 = await find_max_version_past(full_delete_path_dm, key1, '');
                assert.notEqual(max_version1, second_max_version1);
                assert.equal(put_res[0].VersionId, max_version1);

                await delete_object_versions(full_delete_path_dm, key1);
                await s3_uid6.putBucketVersioning({ Bucket: delete_object_test_bucket_dm, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
            });

            mocha.it('delete object version delete marker - latest - no second latest  - versioning suspended', async function() {
                const put_res = await upload_object_versions(account_with_access, delete_object_test_bucket_dm, key1, ['delete_marker']);
                await s3_uid6.putBucketVersioning({ Bucket: delete_object_test_bucket_dm, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Suspended' } });
                let exist = await fs_utils.file_not_exists(path.join(full_delete_path_dm, key1));
                assert.ok(exist);
                const max_version = await find_max_version_past(full_delete_path_dm, key1, '');
                assert.equal(put_res[0].VersionId, max_version);

                await account_with_access.deleteObject({ Bucket: delete_object_test_bucket_dm,
                    Key: key1, VersionId: max_version });

                exist = await fs_utils.file_not_exists(path.join(full_delete_path_dm, key1));
                assert.ok(exist);
                exist = await version_file_must_not_exists(full_delete_path_dm, key1, '', max_version);
                assert.ok(exist);
                const max_version1 = await find_max_version_past(full_delete_path_dm, key1, '');
                assert.equal(max_version1, undefined);
                await delete_object_versions(full_delete_path_dm, key1);
                await s3_uid6.putBucketVersioning({ Bucket: delete_object_test_bucket_dm, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
            });

            mocha.it('delete object version delete marker - in .versions/ - latest exist', async function() {
                const put_res = await upload_object_versions(account_with_access, delete_object_test_bucket_dm, key1, ['regular', 'delete_marker', 'regular']);
                await s3_uid6.putBucketVersioning({ Bucket: delete_object_test_bucket_dm, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Suspended' } });
                const ltst_version_id1 = await stat_and_get_version_id(full_delete_path_dm, key1);
                const max_version = await find_max_version_past(full_delete_path_dm, key1, '');
                const second_max_version1 = await find_max_version_past(full_delete_path_dm, key1, '', [max_version]);

                await account_with_access.deleteObject({ Bucket: delete_object_test_bucket_dm,
                    Key: key1, VersionId: max_version });

                let exist = await fs_utils.file_exists(path.join(full_delete_path_dm, key1));
                assert.ok(exist);
                const ltst_version_id2 = await stat_and_get_version_id(full_delete_path_dm, key1);
                assert.equal(ltst_version_id1, ltst_version_id2);
                exist = await version_file_exists(full_delete_path_dm, key1, '', second_max_version1);
                assert.ok(exist);
                const max_version1 = await find_max_version_past(full_delete_path_dm, key1, '');
                assert.equal(max_version1, second_max_version1);
                assert.equal(put_res[0].VersionId, max_version1);

                await delete_object_versions(full_delete_path_dm, key1);
                await s3_uid6.putBucketVersioning({ Bucket: delete_object_test_bucket_dm, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
            });

            mocha.it('delete object version delete marker - in .versions/ - latest is a delete marker', async function() {
                const put_res = await upload_object_versions(account_with_access, delete_object_test_bucket_dm, key1, ['regular', 'delete_marker', 'delete_marker']);
                await s3_uid6.putBucketVersioning({ Bucket: delete_object_test_bucket_dm, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Suspended' } });

                let exist = await fs_utils.file_not_exists(path.join(full_delete_path_dm, key1));
                assert.ok(exist);
                const latest_dm1 = await find_max_version_past(full_delete_path_dm, key1, '');

                await account_with_access.deleteObject({ Bucket: delete_object_test_bucket_dm,
                    Key: key1, VersionId: put_res[1].VersionId });

                exist = await fs_utils.file_not_exists(path.join(full_delete_path_dm, key1));
                assert.ok(exist);
                const latest_dm2 = await find_max_version_past(full_delete_path_dm, key1, '');
                assert.equal(latest_dm1, latest_dm2);
                await delete_object_versions(full_delete_path_dm, key1);
                await s3_uid6.putBucketVersioning({ Bucket: delete_object_test_bucket_dm, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
            });
        });
    });

    mocha.describe('delete multiple objects - versioning enabled', function() {
        const delete_multi_object_test_bucket = 'delete-multi-object-test-bucket';
        const full_multi_delete_path = path.join(tmp_fs_root, delete_multi_object_test_bucket);
        let account_with_access;

        mocha.before(async function() {
            const res = await generate_nsfs_account(rpc_client, EMAIL, new_bucket_path_param, { default_resource: nsr });
            account_with_access = generate_s3_client(res.access_key, res.secret_key, CORETEST_ENDPOINT);
            await account_with_access.createBucket({ Bucket: delete_multi_object_test_bucket });
            await put_allow_all_bucket_policy(account_with_access, delete_multi_object_test_bucket);
        });

        mocha.it('delete multiple objects - no version id - versioning disabled', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(80000);
            const keys = [];
            for (let i = 0; i < 50; i++) {
                const random_key = (Math.random() + 1).toString(36).substring(7);
                keys.push(random_key);
                await upload_object_versions(account_with_access, delete_multi_object_test_bucket, random_key, ['null']);
            }
            const to_delete_arr = keys.map(key => ({ Key: key }));
            const delete_res = await account_with_access.deleteObjects({
                    Bucket: delete_multi_object_test_bucket, Delete: { Objects: to_delete_arr } });
            assert.equal(delete_res.Deleted.length, 50);
            assert.deepStrictEqual(delete_res.Deleted, to_delete_arr);
            for (const res of delete_res.Deleted) {
                assert.equal(res.DeleteMarker, undefined);
                assert.equal(res.VersionId, undefined);
            }
            const versions_dir = path.join(full_multi_delete_path, '.versions');
            await fs_utils.file_must_not_exist(versions_dir);
            const objects = await nb_native().fs.readdir(DEFAULT_FS_CONFIG, full_multi_delete_path);
            assert.equal(objects.length, 1);
            assert.ok(objects[0].name.startsWith('.noobaa-nsfs_'));

        });

        mocha.it('delete multiple objects - no version id', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(150000);
            const versions_type_arr = ['null'];
            for (let i = 0; i < 300; i++) {
                 versions_type_arr.push(i % 2 === 0 ? 'regular' : 'delete_marker');
            }
            await upload_object_versions(account_with_access, delete_multi_object_test_bucket, key1, versions_type_arr);
            const arr = [];
            for (let i = 0; i < 200; i++) {
                arr.push({ Key: 'a' });
            }
            const delete_res = await account_with_access.deleteObjects({
                    Bucket: delete_multi_object_test_bucket, Delete: { Objects: arr } });
            assert.equal(delete_res.Deleted.length, 1);
            for (const res of delete_res.Deleted) {
                assert.equal(res.DeleteMarker, true);
            }
            const versions_dir = path.join(full_multi_delete_path, '.versions');
            const versions = await nb_native().fs.readdir(DEFAULT_FS_CONFIG, versions_dir);
            assert.equal(versions.length, 302); // 1 null version + 30 dm and versions + 1 new dm
            await delete_object_versions(full_multi_delete_path, key1);
            await delete_object_versions(full_multi_delete_path, 'a');
        });

        mocha.it('delete multiple objects - delete only delete markers', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(60000);
            const versions_type_arr = [];
            for (let i = 0; i < 300; i++) {
                 versions_type_arr.push(i % 2 === 0 ? 'regular' : 'delete_marker');
            }
            const put_res = await upload_object_versions(account_with_access, delete_multi_object_test_bucket, key1, versions_type_arr);
            const arr = [];
            for (let i = 0; i < 300; i++) {
                if (i % 2 === 1) arr.push({ Key: key1, VersionId: put_res[i].VersionId });
            }
            const delete_res = await account_with_access.deleteObjects({
                    Bucket: delete_multi_object_test_bucket, Delete: { Objects: arr } });
            assert.equal(delete_res.Deleted.length, 150);
            for (const res of delete_res.Deleted) {
                assert.equal(res.DeleteMarker, true);
            }
            const versions_dir = path.join(full_multi_delete_path, '.versions');
            const versions = await nb_native().fs.readdir(DEFAULT_FS_CONFIG, versions_dir);
            assert.equal(versions.length, 149);
            await fs_utils.file_must_exist(path.join(full_multi_delete_path, key1));
            const latest_stat = await stat_and_get_all(full_multi_delete_path, key1);
            assert.equal(latest_stat.xattr[XATTR_VERSION_ID], put_res[298].VersionId);
            await delete_object_versions(full_multi_delete_path, key1);
        });

        mocha.it('delete multiple objects - delete only regular versions key1, delete delete markers key2', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(150000);
            const key2 = 'key2';
            const versions_type_arr = [];
            for (let i = 0; i < 300; i++) {
                 versions_type_arr.push(i % 2 === 0 ? 'regular' : 'delete_marker');
            }
            const put_res = await upload_object_versions(account_with_access, delete_multi_object_test_bucket, key1, versions_type_arr);
            const put_res2 = await upload_object_versions(account_with_access, delete_multi_object_test_bucket, key2, versions_type_arr);
            const arr = [];
            for (let i = 0; i < 300; i++) {
                if (i % 2 === 0) arr.push({ Key: key1, VersionId: put_res[i].VersionId });
                if (i % 2 === 1) arr.push({ Key: key2, VersionId: put_res2[i].VersionId });
            }
            const delete_res = await account_with_access.deleteObjects({
                    Bucket: delete_multi_object_test_bucket, Delete: { Objects: arr } });

            assert.equal(delete_res.Deleted.length, 300);
            for (const res of delete_res.Deleted.slice(0, 150)) {
                assert.equal(res.DeleteMarker, undefined);
            }
            for (const res of delete_res.Deleted.slice(150)) {
                assert.equal(res.DeleteMarker, true);
            }
            const versions_dir = path.join(full_multi_delete_path, '.versions');
            const versions = await nb_native().fs.readdir(DEFAULT_FS_CONFIG, versions_dir);
            // 150 of key1 and 149 of key2 (latest version of key2 is in the parent dir)
            assert.equal(versions.length, 299);
            await fs_utils.file_must_not_exist(path.join(full_multi_delete_path, key1));
            await fs_utils.file_must_exist(path.join(full_multi_delete_path, key2));
            const latest_dm_version = await find_max_version_past(full_multi_delete_path, key1);
            const version_path = path.join(full_multi_delete_path, '.versions', key1 + '_' + latest_dm_version);
            const version_info = await stat_and_get_all(version_path, '');
            assert.equal(version_info.xattr[XATTR_DELETE_MARKER], 'true');
            assert.equal(version_info.xattr[XATTR_VERSION_ID], put_res[299].VersionId);
            await delete_object_versions(full_multi_delete_path, key1);
            await delete_object_versions(full_multi_delete_path, key2);
        });

        mocha.it('delete multiple objects - delete regular versions & delete markers - new latest is dm', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(150000);
            const versions_type_arr = [];
            for (let i = 0; i < 300; i++) {
                 versions_type_arr.push(i % 2 === 0 ? 'regular' : 'delete_marker');
            }
            const put_res = await upload_object_versions(account_with_access, delete_multi_object_test_bucket, key1, versions_type_arr);
            const arr = [];
            for (let i = 200; i < 300; i++) {
                arr.push({ Key: key1, VersionId: put_res[i].VersionId });
            }
            const delete_res = await account_with_access.deleteObjects({
                    Bucket: delete_multi_object_test_bucket, Delete: { Objects: arr } });
            assert.equal(delete_res.Deleted.length, 100);
            for (let i = 0; i < 100; i++) {
                if (i % 2 === 1) assert.equal(delete_res.Deleted[i].DeleteMarker, true);
                if (i % 2 === 0) assert.equal(delete_res.Deleted[i].DeleteMarker, undefined);
            }
            const versions_dir = path.join(full_multi_delete_path, '.versions');
            const versions = await nb_native().fs.readdir(DEFAULT_FS_CONFIG, versions_dir);
            assert.equal(versions.length, 200);
            await fs_utils.file_must_not_exist(path.join(full_multi_delete_path, key1));
            const latest_dm_version = await find_max_version_past(full_multi_delete_path, key1);
            const version_path = path.join(full_multi_delete_path, '.versions', key1 + '_' + latest_dm_version);
            const version_info = await stat_and_get_all(version_path, '');
            assert.equal(version_info.xattr[XATTR_VERSION_ID], put_res[199].VersionId);
            await delete_object_versions(full_multi_delete_path, key1);
        });

        mocha.it('delete multiple objects - delete regular versions & delete markers - new latest is regular version', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(150000);
            const versions_type_arr = [];
            for (let i = 0; i < 300; i++) {
                 versions_type_arr.push(i % 2 === 0 ? 'regular' : 'delete_marker');
            }
            const put_res = await upload_object_versions(account_with_access, delete_multi_object_test_bucket, key1, versions_type_arr);
            const arr = [];
            for (let i = 100; i < 200; i++) {
                arr.push({ Key: key1, VersionId: put_res[i].VersionId });
            }
            arr.push({ Key: key1, VersionId: put_res[299].VersionId });
            const delete_res = await account_with_access.deleteObjects({
                    Bucket: delete_multi_object_test_bucket, Delete: { Objects: arr } });
            assert.equal(delete_res.Deleted.length, 101);
            for (let i = 0; i < 100; i++) {
                if (i % 2 === 1) assert.equal(delete_res.Deleted[i].DeleteMarker, true);
                if (i % 2 === 0) assert.equal(delete_res.Deleted[i].DeleteMarker, undefined);
            }
            const versions_dir = path.join(full_multi_delete_path, '.versions');
            const versions = await nb_native().fs.readdir(DEFAULT_FS_CONFIG, versions_dir);

            assert.equal(versions.length, 198);
            await fs_utils.file_must_exist(path.join(full_multi_delete_path, key1));
            const latest_stat = await stat_and_get_all(full_multi_delete_path, key1);
            assert.equal(latest_stat.xattr[XATTR_VERSION_ID], put_res[298].VersionId);
            await delete_object_versions(full_multi_delete_path, key1);
        });

        mocha.it('delete multiple objects - delete keys & regular versions & delete markers ', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(150000);
            const versions_type_arr = [];
            for (let i = 0; i < 300; i++) {
                 versions_type_arr.push(i % 2 === 0 ? 'regular' : 'delete_marker');
            }
            const put_res = await upload_object_versions(account_with_access, delete_multi_object_test_bucket, key1, versions_type_arr);
            const arr = [];
            for (let i = 0; i < 50; i++) {
                arr.push({ Key: key1 });
            }
            for (let i = 100; i < 200; i++) {
                arr.push({ Key: key1, VersionId: put_res[i].VersionId });
            }

            const delete_res = await account_with_access.deleteObjects({
                    Bucket: delete_multi_object_test_bucket, Delete: { Objects: arr } });
            assert.equal(delete_res.Deleted.length, 101); // 100 dm and versions + 1 new dm
            for (let i = 0; i < 1; i++) {
                assert.notEqual(delete_res.Deleted[i].DeleteMarkerVersionId, undefined);
                assert.equal(delete_res.Deleted[i].DeleteMarker, true);
            }
            for (let i = 1; i < 101; i++) {
                if (i % 2 === 0) assert.equal(delete_res.Deleted[i].DeleteMarker, true);
                if (i % 2 === 1) assert.equal(delete_res.Deleted[i].DeleteMarker, undefined);
            }
            const versions_dir = path.join(full_multi_delete_path, '.versions');
            const versions = await nb_native().fs.readdir(DEFAULT_FS_CONFIG, versions_dir);

            assert.equal(versions.length, 201); // 200 dm and versions + 1 new dm
            await fs_utils.file_must_not_exist(path.join(full_multi_delete_path, key1));
            await delete_object_versions(full_multi_delete_path, key1);
        });


        mocha.it('delete multiple objects - delete regular versions & delete markers & latest & keys- ', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(150000);
            const versions_type_arr = [];
            for (let i = 0; i < 300; i++) {
                 versions_type_arr.push(i % 2 === 1 ? 'regular' : 'delete_marker');
            }
            const put_res = await upload_object_versions(account_with_access, delete_multi_object_test_bucket, key1, versions_type_arr);
            const arr = [];
            for (let i = 200; i < 300; i++) {
                arr.push({ Key: key1, VersionId: put_res[i].VersionId });
            }

            for (let i = 0; i < 50; i++) {
                arr.push({ Key: key1 });
            }
            const delete_res = await account_with_access.deleteObjects({
                    Bucket: delete_multi_object_test_bucket, Delete: { Objects: arr } });
            assert.equal(delete_res.Deleted.length, 101);
            for (let i = 0; i < 100; i++) {
                if (i % 2 === 1) assert.equal(delete_res.Deleted[i].DeleteMarker, undefined);
                if (i % 2 === 0) assert.equal(delete_res.Deleted[i].DeleteMarker, true);
            }
            for (let i = 100; i < 101; i++) {
                assert.notEqual(delete_res.Deleted[i].DeleteMarkerVersionId, undefined);
                assert.equal(delete_res.Deleted[i].DeleteMarker, true);
            }
            const versions_dir = path.join(full_multi_delete_path, '.versions');
            const versions = await nb_native().fs.readdir(DEFAULT_FS_CONFIG, versions_dir);

            assert.equal(versions.length, 201); // 200 dm and versions + dm + new dm
            await fs_utils.file_must_not_exist(path.join(full_multi_delete_path, key1));
            await delete_object_versions(full_multi_delete_path, key1);
        });
    });

    mocha.describe('delete multiple objects - versioning suspended', function() {
        const delete_multi_object_test_bucket = 'delete-multi-object-test-bucket-suspended';
        const full_multi_delete_path = path.join(tmp_fs_root, delete_multi_object_test_bucket);
        let account_with_access;

        mocha.before(async function() {
            const res = await generate_nsfs_account(rpc_client, EMAIL, new_bucket_path_param, { default_resource: nsr });
            account_with_access = generate_s3_client(res.access_key, res.secret_key, CORETEST_ENDPOINT);
            await account_with_access.createBucket({ Bucket: delete_multi_object_test_bucket });
            await put_allow_all_bucket_policy(account_with_access, delete_multi_object_test_bucket);
        });

        mocha.it('delete multiple objects - no version id - versioning disabled - will be suspended', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(80000);
            const keys = [];
            for (let i = 0; i < 50; i++) {
                const random_key = (Math.random() + 1).toString(36).substring(7);
                keys.push(random_key);
                await upload_object_versions(account_with_access, delete_multi_object_test_bucket, random_key, ['null']);
            }
            const to_delete_arr = keys.map(key => ({ Key: key }));
            const delete_res = await account_with_access.deleteObjects({
                    Bucket: delete_multi_object_test_bucket, Delete: { Objects: to_delete_arr } });
            assert.equal(delete_res.Deleted.length, 50);
            assert.deepStrictEqual(delete_res.Deleted, to_delete_arr);
            for (const res of delete_res.Deleted) {
                assert.equal(res.DeleteMarker, undefined);
                assert.equal(res.VersionId, undefined);
            }
            const versions_dir = path.join(full_multi_delete_path, '.versions');
            const exist = await fs_utils.file_not_exists(versions_dir);
            assert.ok(exist);
            const objects = await nb_native().fs.readdir(DEFAULT_FS_CONFIG, full_multi_delete_path);
            assert.equal(objects.length, 1);
            assert.ok(objects[0].name.startsWith('.noobaa-nsfs_'));
        });

        mocha.it('delete multiple objects - no version id - versioning suspended', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(60000);
            const versions_type_arr = ['null'];
            for (let i = 0; i < 3; i++) {
                 versions_type_arr.push(i % 2 === 0 ? 'regular' : 'delete_marker');
            }
            await upload_object_versions(account_with_access, delete_multi_object_test_bucket, key1, versions_type_arr);
            await s3_uid6.putBucketVersioning({ Bucket: delete_multi_object_test_bucket, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Suspended' } });
            const arr = [];
            for (let i = 0; i < 2; i++) {
                arr.push({ Key: 'a' });
            }
            const delete_res = await account_with_access.deleteObjects({
                    Bucket: delete_multi_object_test_bucket, Delete: { Objects: arr } });
            assert.equal(delete_res.Deleted.length, 1);
            for (const res of delete_res.Deleted) {
                assert.equal(res.DeleteMarker, true);
            }
            const versions_dir = path.join(full_multi_delete_path, '.versions');
            const versions = await nb_native().fs.readdir(DEFAULT_FS_CONFIG, versions_dir);
            assert.equal(versions.length, 4); //key1 versions: null, regular and dm (3 total) + a versions: dm (1 total)
            await delete_object_versions(full_multi_delete_path, key1);
            await delete_object_versions(full_multi_delete_path, 'a');
            await s3_uid6.putBucketVersioning({ Bucket: delete_multi_object_test_bucket, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
        });

        mocha.it('delete multiple objects - delete only delete markers - versioning suspended', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(60000);
            const versions_type_arr = [];
            for (let i = 0; i < 5; i++) {
                 versions_type_arr.push(i % 2 === 0 ? 'regular' : 'delete_marker');
            }
            const put_res = await upload_object_versions(account_with_access, delete_multi_object_test_bucket, key1, versions_type_arr);
            await s3_uid6.putBucketVersioning({ Bucket: delete_multi_object_test_bucket, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Suspended' } });
            const arr = [];
            for (let i = 0; i < 5; i++) {
                if (i % 2 === 1) arr.push({ Key: key1, VersionId: put_res[i].VersionId });
            }
            const delete_res = await account_with_access.deleteObjects({
                    Bucket: delete_multi_object_test_bucket, Delete: { Objects: arr } });
            assert.equal(delete_res.Deleted.length, 2);
            for (const res of delete_res.Deleted) {
                assert.equal(res.DeleteMarker, true);
            }
            const versions_dir = path.join(full_multi_delete_path, '.versions');
            const versions = await nb_native().fs.readdir(DEFAULT_FS_CONFIG, versions_dir);
            assert.equal(versions.length, 2);
            const exist = await fs_utils.file_exists(path.join(full_multi_delete_path, key1));
            assert.ok(exist);
            const latest_stat = await stat_and_get_all(full_multi_delete_path, key1);
            assert.equal(latest_stat.xattr[XATTR_VERSION_ID], put_res[4].VersionId);
            await delete_object_versions(full_multi_delete_path, key1);
            await s3_uid6.putBucketVersioning({ Bucket: delete_multi_object_test_bucket, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
        });

        mocha.it('delete multiple objects - delete only regular versions key1, delete delete markers key2 - versioning suspended', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(60000);
            const key2 = 'key2';
            const versions_type_arr = [];
            for (let i = 0; i < 8; i++) {
                 versions_type_arr.push(i % 2 === 0 ? 'regular' : 'delete_marker');
            }
            const put_res = await upload_object_versions(account_with_access, delete_multi_object_test_bucket, key1, versions_type_arr);
            const put_res2 = await upload_object_versions(account_with_access, delete_multi_object_test_bucket, key2, versions_type_arr);
            await s3_uid6.putBucketVersioning({ Bucket: delete_multi_object_test_bucket, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Suspended' } });
            const arr = [];
            for (let i = 0; i < 8; i++) {
                if (i % 2 === 0) arr.push({ Key: key1, VersionId: put_res[i].VersionId });
                if (i % 2 === 1) arr.push({ Key: key2, VersionId: put_res2[i].VersionId });
            }
            const delete_res = await account_with_access.deleteObjects({
                    Bucket: delete_multi_object_test_bucket, Delete: { Objects: arr } });
            assert.equal(delete_res.Deleted.length, 8);
            for (const res of delete_res.Deleted.slice(0, 4)) {
                assert.equal(res.DeleteMarker, undefined);
            }
            for (const res of delete_res.Deleted.slice(4)) {
                assert.equal(res.DeleteMarker, true);
            }
            const versions_dir = path.join(full_multi_delete_path, '.versions');
            const versions = await nb_native().fs.readdir(DEFAULT_FS_CONFIG, versions_dir);
            // 4 of key1 and 3 of key2 (latest version of key2 is in the parent dir)
            assert.equal(versions.length, 7);
            let exist = await fs_utils.file_not_exists(path.join(full_multi_delete_path, key1));
            assert.ok(exist);
            exist = await fs_utils.file_exists(path.join(full_multi_delete_path, key2));
            assert.ok(exist);
            const latest_dm_version = await find_max_version_past(full_multi_delete_path, key1);
            const version_path = path.join(full_multi_delete_path, '.versions', key1 + '_' + latest_dm_version);
            const version_info = await stat_and_get_all(version_path, '');
            assert.equal(version_info.xattr[XATTR_DELETE_MARKER], 'true');
            assert.equal(version_info.xattr[XATTR_VERSION_ID], put_res[7].VersionId);
            await delete_object_versions(full_multi_delete_path, key1);
            await delete_object_versions(full_multi_delete_path, key2);
            await s3_uid6.putBucketVersioning({ Bucket: delete_multi_object_test_bucket, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
        });

        mocha.it('delete multiple objects - delete regular versions & delete markers - new latest is dm - versioning suspended', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(60000);
            const versions_type_arr = [];
            for (let i = 0; i < 5; i++) {
                 versions_type_arr.push(i % 2 === 0 ? 'regular' : 'delete_marker');
            }
            const put_res = await upload_object_versions(account_with_access, delete_multi_object_test_bucket, key1, versions_type_arr);
            await s3_uid6.putBucketVersioning({ Bucket: delete_multi_object_test_bucket, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Suspended' } });
            const arr = [];
            for (let i = 2; i < 5; i++) {
                arr.push({ Key: key1, VersionId: put_res[i].VersionId });
            }
            const delete_res = await account_with_access.deleteObjects({
                    Bucket: delete_multi_object_test_bucket, Delete: { Objects: arr } });
            assert.equal(delete_res.Deleted.length, 3);
            for (let i = 0; i < 3; i++) {
                if (i % 2 === 1) assert.equal(delete_res.Deleted[i].DeleteMarker, true);
                if (i % 2 === 0) assert.equal(delete_res.Deleted[i].DeleteMarker, undefined);
            }
            const versions_dir = path.join(full_multi_delete_path, '.versions');
            const versions = await nb_native().fs.readdir(DEFAULT_FS_CONFIG, versions_dir);
            assert.equal(versions.length, 2);
            const exist = await fs_utils.file_not_exists(path.join(full_multi_delete_path, key1));
            assert.ok(exist);
            const latest_dm_version = await find_max_version_past(full_multi_delete_path, key1);
            const version_path = path.join(full_multi_delete_path, '.versions', key1 + '_' + latest_dm_version);
            const version_info = await stat_and_get_all(version_path, '');
            assert.equal(version_info.xattr[XATTR_VERSION_ID], put_res[1].VersionId);
            await delete_object_versions(full_multi_delete_path, key1);
            await s3_uid6.putBucketVersioning({ Bucket: delete_multi_object_test_bucket, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
        });

        mocha.it('delete multiple objects - delete regular versions & delete markers - new latest is regular version - versioning suspended', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(60000);
            const versions_type_arr = [];
            for (let i = 0; i < 5; i++) {
                 versions_type_arr.push(i % 2 === 0 ? 'regular' : 'delete_marker');
            }
            const put_res = await upload_object_versions(account_with_access, delete_multi_object_test_bucket, key1, versions_type_arr);
            await s3_uid6.putBucketVersioning({ Bucket: delete_multi_object_test_bucket, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Suspended' } });
            const arr = [];
            for (let i = 0; i < 4; i++) {
                arr.push({ Key: key1, VersionId: put_res[i].VersionId });
            }
            const delete_res = await account_with_access.deleteObjects({
                    Bucket: delete_multi_object_test_bucket, Delete: { Objects: arr } });
            assert.equal(delete_res.Deleted.length, 4);
            for (let i = 0; i < 4; i++) {
                if (i % 2 === 0) assert.equal(delete_res.Deleted[i].DeleteMarker, undefined);
                if (i % 2 === 1) assert.equal(delete_res.Deleted[i].DeleteMarker, true);
            }

            const exist = await fs_utils.file_exists(path.join(full_multi_delete_path, key1));
            assert.ok(exist);
            const latest_stat = await stat_and_get_all(full_multi_delete_path, key1);
            assert.equal(latest_stat.xattr[XATTR_VERSION_ID], put_res[4].VersionId);
            await delete_object_versions(full_multi_delete_path, key1);
            await s3_uid6.putBucketVersioning({ Bucket: delete_multi_object_test_bucket, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
        });

        mocha.it('delete multiple objects - delete keys & regular versions & delete markers - versioning suspended', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(60000);
            const versions_type_arr = [];
            for (let i = 0; i < 30; i++) {
                 versions_type_arr.push(i % 2 === 0 ? 'regular' : 'delete_marker');
            }
            const put_res = await upload_object_versions(account_with_access, delete_multi_object_test_bucket, key1, versions_type_arr);
            await s3_uid6.putBucketVersioning({ Bucket: delete_multi_object_test_bucket, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Suspended' } });
            const arr = [];
            for (let i = 0; i < 5; i++) {
                arr.push({ Key: key1 });
            }
            for (let i = 10; i < 20; i++) {
                arr.push({ Key: key1, VersionId: put_res[i].VersionId });
            }

            const delete_res = await account_with_access.deleteObjects({
                    Bucket: delete_multi_object_test_bucket, Delete: { Objects: arr } });
            assert.equal(delete_res.Deleted.length, 11);
            assert.equal(delete_res.Deleted[0].DeleteMarker, true);
            assert.equal(delete_res.Deleted[0].DeleteMarkerVersionId, 'null');
            for (let i = 1; i < 11; i++) {
                if (i % 2 === 0) assert.equal(delete_res.Deleted[i].DeleteMarker, true);
                if (i % 2 === 1) assert.equal(delete_res.Deleted[i].DeleteMarker, undefined);
            }

            const versions_dir = path.join(full_multi_delete_path, '.versions');
            const versions = await nb_native().fs.readdir(DEFAULT_FS_CONFIG, versions_dir);
            assert.equal(versions.length, 21); // 30 - 10 (deleted id-versions) + 1 (null dm on the key delete)
            const exist = await fs_utils.file_not_exists(path.join(full_multi_delete_path, key1));
            assert.ok(exist);
            await delete_object_versions(full_multi_delete_path, key1);
            await s3_uid6.putBucketVersioning({ Bucket: delete_multi_object_test_bucket, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
        });

        mocha.it('delete multiple objects - delete regular versions & delete markers & latest & keys- - versioning suspended', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(60000);
            const versions_type_arr = [];
            for (let i = 0; i < 30; i++) {
                 versions_type_arr.push(i % 2 === 0 ? 'regular' : 'delete_marker');
            }
            const put_res = await upload_object_versions(account_with_access, delete_multi_object_test_bucket, key1, versions_type_arr);
            await s3_uid6.putBucketVersioning({ Bucket: delete_multi_object_test_bucket, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Suspended' } });
            const arr = [];
            for (let i = 20; i < 30; i++) {
                arr.push({ Key: key1, VersionId: put_res[i].VersionId });
            }
            for (let i = 0; i < 5; i++) {
                arr.push({ Key: key1 });
            }
            const delete_res = await account_with_access.deleteObjects({
                    Bucket: delete_multi_object_test_bucket, Delete: { Objects: arr } });
            assert.equal(delete_res.Deleted.length, 11);
            for (let i = 0; i < 10; i++) {
                if (i % 2 === 0) assert.equal(delete_res.Deleted[i].DeleteMarker, undefined);
                if (i % 2 === 1) assert.equal(delete_res.Deleted[i].DeleteMarker, true);
            }
            assert.equal(delete_res.Deleted[10].DeleteMarkerVersionId, NULL_VERSION_ID);
            assert.equal(delete_res.Deleted[10].DeleteMarker, true);

            const versions_dir = path.join(full_multi_delete_path, '.versions');
            const versions = await nb_native().fs.readdir(DEFAULT_FS_CONFIG, versions_dir);
            assert.equal(versions.length, 21); // 30 - 10 (deleted id-versions) + 1 (null dm on the key delete)
            const exist = await fs_utils.file_not_exists(path.join(full_multi_delete_path, key1));
            assert.ok(exist);
            await delete_object_versions(full_multi_delete_path, key1);
            await s3_uid6.putBucketVersioning({ Bucket: delete_multi_object_test_bucket, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
        });
    });

    mocha.describe('list object version - check null version', function() {
        const list_object_versions_test_bucket = 'list-object-versions-test-bucket';
        // const full_path_list_object_versions_test_bucket = tmp_fs_root + '/' + list_object_versions_test_bucket;
        let account_with_access;
        const key_to_list1 = 'car.txt';
        const key_to_list2 = 'bike.txt';
        const key_to_list3 = 'ship.txt';

        mocha.before(async function() {
            const res = await generate_nsfs_account(rpc_client, EMAIL, new_bucket_path_param, { default_resource: nsr });
            account_with_access = generate_s3_client(res.access_key, res.secret_key, CORETEST_ENDPOINT);
            await account_with_access.createBucket({ Bucket: list_object_versions_test_bucket });
            await put_allow_all_bucket_policy(account_with_access, list_object_versions_test_bucket);
        });

        mocha.it('list object versions - only null versions - versioning disabled', async function() {
            await account_with_access.putObject({ Bucket: list_object_versions_test_bucket,
                Key: key_to_list1, Body: body1 });
            await account_with_access.putObject({ Bucket: list_object_versions_test_bucket,
                Key: key_to_list2, Body: body1 });
            const list_object_versions_res = await account_with_access.listObjectVersions({
                Bucket: list_object_versions_test_bucket});
            //bike.txt before car.txt (a-z sort)
            assert.equal(list_object_versions_res.Versions[0].Key, key_to_list2);
            assert.equal(list_object_versions_res.Versions[0].VersionId, NULL_VERSION_ID);
            assert.equal(list_object_versions_res.Versions[1].Key, key_to_list1);
            assert.equal(list_object_versions_res.Versions[1].VersionId, NULL_VERSION_ID);
        });

        mocha.it('list object versions - no null version id - with versioning enabled', async function() {
            const versions_type_arr = [];
            for (let i = 0; i < 3; i++) {
                 versions_type_arr.push('regular');
            }
            const put_res = await upload_object_versions(account_with_access, list_object_versions_test_bucket,
                key_to_list3, versions_type_arr);
            const list_object_versions_res = await account_with_access.listObjectVersions(
                {Bucket: list_object_versions_test_bucket, Prefix: key_to_list3});
            // the order is from latest to oldest
            assert.equal(list_object_versions_res.Versions[0].Key, key_to_list3);
            assert.equal(list_object_versions_res.Versions[0].VersionId, put_res[2].VersionId);
            assert.equal(list_object_versions_res.Versions[1].Key, key_to_list3);
            assert.equal(list_object_versions_res.Versions[1].VersionId, put_res[1].VersionId);
            assert.equal(list_object_versions_res.Versions[2].Key, key_to_list3);
            assert.equal(list_object_versions_res.Versions[2].VersionId, put_res[0].VersionId);
        });

        mocha.it('list object versions - latest version is null version id', async function() {
            await account_with_access.putBucketVersioning({ Bucket: list_object_versions_test_bucket,
                VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Suspended' } });
            await account_with_access.putObject({ Bucket: list_object_versions_test_bucket,
                Key: key_to_list3, Body: body1 });
            const list_object_versions_res = await account_with_access.listObjectVersions(
                {Bucket: list_object_versions_test_bucket, Prefix: key_to_list3});
            // latest version is null (the order is from latest to oldest), hence null is first
            assert.equal(list_object_versions_res.Versions[0].Key, key_to_list3);
            assert.equal(list_object_versions_res.Versions[0].VersionId, NULL_VERSION_ID);
        });

        mocha.it('list object versions -  oldest version is null version id', async function() {
            await account_with_access.putBucketVersioning({ Bucket: list_object_versions_test_bucket,
                VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
            const versions_type_arr = [];
            for (let i = 0; i < 3; i++) {
                 versions_type_arr.push('regular');
            }
            await upload_object_versions(account_with_access, list_object_versions_test_bucket,
                key_to_list2, versions_type_arr);


            const list_object_versions_res = await account_with_access.listObjectVersions(
                {Bucket: list_object_versions_test_bucket, Prefix: key_to_list2});
            for (let i = 0; i < 3; i++) {
                assert.equal(list_object_versions_res.Versions[i].Key, key_to_list2);
                assert.notEqual(list_object_versions_res.Versions[i].VersionId, NULL_VERSION_ID);
            }
            // oldest version is null (the order is from latest to oldest), hence null is last
            assert.equal(list_object_versions_res.Versions[3].Key, key_to_list2);
            assert.equal(list_object_versions_res.Versions[3].VersionId, NULL_VERSION_ID);
        });
    });
});

mocha.describe('bucketspace namespace_fs - versioning', function() {
    mocha.describe('List-objects', function() {
        const nsr = 'noobaa-nsr';
        const bucket_name = 'noobaa-bucket';
        const tmp_fs_root2 = path.join(TMP_PATH, 'test_namespace_fs_list_objects');
        const bucket_path = '/bucket';
        const full_path = tmp_fs_root2 + bucket_path;
        const version_dir = '/.versions';
        const full_path_version_dir = full_path + `${version_dir}`;
        const dir1 = full_path + '/dir1';
        const dir1_version_dir = dir1 + `${version_dir}`;
        const dir2 = full_path + '/dir2';
        const dir2_version_dir = dir2 + `${version_dir}`;
        let s3_client;
        let s3_admin;
        const accounts = [];
        const key = 'key';
        const body = 'AAAA';
        const version_key = 'version_key';
        const version_body = 'A1A1A1A';

        mocha.before(async function() {
            this.timeout(600000); // eslint-disable-line no-invalid-this
            if (invalid_nsfs_root_permissions()) this.skip(); // eslint-disable-line no-invalid-this
            // create paths
            await fs_utils.create_fresh_path(tmp_fs_root2, 0o777);
            await fs_utils.create_fresh_path(full_path, 0o770);
            await fs_utils.file_must_exist(full_path);
            await fs_utils.create_fresh_path(full_path_version_dir, 0o770);
            await fs_utils.file_must_exist(full_path_version_dir);
            await fs_utils.create_fresh_path(dir1, 0o770);
            await fs_utils.file_must_exist(dir1);
            await fs_utils.create_fresh_path(dir1_version_dir, 0o770);
            await fs_utils.file_must_exist(dir1_version_dir);
            await fs_utils.create_fresh_path(dir2, 0o770);
            await fs_utils.file_must_exist(dir2);
            await fs_utils.create_fresh_path(dir2_version_dir, 0o770);
            await fs_utils.file_must_exist(dir2_version_dir);
            const ls_new_buckets_path = get_new_buckets_path_by_test_env(tmp_fs_root2, '/');
            if (is_nc_coretest) {
                const { uid, gid } = get_admin_mock_account_details();
                await set_path_permissions_and_owner(full_path, { uid, gid }, 0o700);
            }
            // export dir as a bucket
            await rpc_client.pool.create_namespace_resource({
                name: nsr,
                nsfs_config: {
                    fs_root_path: tmp_fs_root2,
                }
            });
            const obj_nsr = { resource: nsr, path: bucket_path };
            await rpc_client.bucket.create_bucket({
                name: bucket_name,
                namespace: {
                    read_resources: [obj_nsr],
                    write_resource: obj_nsr
                }
            });
            const policy = {
                Version: '2012-10-17',
                Statement: [{
                    Sid: 'id-1',
                    Effect: 'Allow',
                    Principal: { AWS: "*" },
                    Action: ['s3:*'],
                    Resource: [`arn:aws:s3:::*`]
                },
            ]
            };
            // create accounts
            let res = await generate_nsfs_account(rpc_client, EMAIL, ls_new_buckets_path, { admin: true });
            s3_admin = generate_s3_client(res.access_key, res.secret_key, CORETEST_ENDPOINT);
            await s3_admin.putBucketPolicy({
                Bucket: bucket_name,
                Policy: JSON.stringify(policy)
            });
            // create nsfs account
            res = await generate_nsfs_account(rpc_client, EMAIL, ls_new_buckets_path);
            s3_client = generate_s3_client(res.access_key, res.secret_key, CORETEST_ENDPOINT);
            accounts.push(res.email);
            await s3_client.putBucketVersioning({ Bucket: bucket_name, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
            const bucket_ver = await s3_client.getBucketVersioning({ Bucket: bucket_name });
            assert.equal(bucket_ver.Status, 'Enabled');
            await create_object(`${full_path}/${key}`, body, 'null');
            await create_object(`${full_path_version_dir}/${version_key}`, version_body, 'null');
            await create_object(`${dir1}/${key}`, body, 'null');
            await create_object(`${dir1_version_dir}/${version_key}`, version_body, 'null');
            await create_object(`${dir2}/${key}`, body, 'null');
            await create_object(`${dir1_version_dir}/${version_key}`, version_body, 'null');
        });

        mocha.after(async () => {
            fs_utils.folder_delete(tmp_fs_root);
            for (const email of accounts) {
                await rpc_client.account.delete_account({ email });
            }
        });

        mocha.it('list objects - should return only latest object', async function() {
            const res = await s3_client.listObjects({Bucket: bucket_name});
            res.Contents.forEach(val => {
                if (val.Key.includes('version') === true) {
                    assert.fail('Not Expected: list objects returned contents fo .version dir');
                }
            });
        });
    });

    mocha.describe('Get/Head object', function() {
        const nsr = 'get-head-versioned-nsr';
        const bucket_name = 'get-head-versioned-bucket';
        const disabled_bucket_name = 'get-head-disabled-bucket';
        const tmp_fs_root3 = path.join(TMP_PATH, 'test_namespace_fs_get_objects');

        const bucket_path = '/get-head-bucket/';
        const vesion_dir = '/.versions';
        const full_path = path.join(tmp_fs_root3, bucket_path);
        const disabled_bucket_path = '/get-head-disabled_bucket';
        const disabled_full_path = path.join(tmp_fs_root3, disabled_bucket_path);
        const version_dir_path = path.join(full_path, vesion_dir);
        let file_pointer;
        const versionID_1 = 'mtime-12a345b-ino-c123d45';
        const versionID_2 = 'mtime-e56789f-ino-h56g789';
        const versionID_3 = 'mtime-1i357k9-ino-13l57j9';
        let s3_client;
        let s3_admin;
        const accounts = [];
        const dis_version_key = 'dis_version';
        const dis_version_body = 'AAAAA';
        const en_version_key = 'en_version';
        const en_version_body = 'BBBBB';
        const en_version_key_v1 = versionID_2;
        const en_version_body_v1 = 'CCCCC';
        const key_version = en_version_key + '_' + en_version_key_v1;
        mocha.before(async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(300000);
            if (invalid_nsfs_root_permissions()) this.skip(); // eslint-disable-line no-invalid-this
            // create paths
            await fs_utils.create_fresh_path(tmp_fs_root3, 0o777);
            await fs_utils.create_fresh_path(full_path, 0o770);
            await fs_utils.file_must_exist(full_path);
            await fs_utils.create_fresh_path(version_dir_path, 0o770);
            await fs_utils.file_must_exist(version_dir_path);
            await fs_utils.create_fresh_path(disabled_full_path, 0o770);
            await fs_utils.file_must_exist(disabled_full_path);
            const new_buckets_path3 = get_new_buckets_path_by_test_env(tmp_fs_root3, '/');
            if (is_nc_coretest) {
                const { uid, gid } = get_admin_mock_account_details();
                await set_path_permissions_and_owner(full_path, { uid, gid }, 0o700);
                await set_path_permissions_and_owner(disabled_full_path, { uid, gid }, 0o700);
            }
            // export dir as a bucket
            await rpc_client.pool.create_namespace_resource({
                name: nsr,
                nsfs_config: {
                    fs_root_path: tmp_fs_root3,
                }
            });
            const obj_nsr = { resource: nsr, path: bucket_path };
            await rpc_client.bucket.create_bucket({
                name: bucket_name,
                namespace: {
                    read_resources: [obj_nsr],
                    write_resource: obj_nsr
                }
            });

            const disabled_nsr = { resource: nsr, path: disabled_bucket_path };
            await rpc_client.bucket.create_bucket({
                name: disabled_bucket_name,
                namespace: {
                    read_resources: [disabled_nsr],
                    write_resource: disabled_nsr
                }
            });

            const policy = {
                Version: '2012-10-17',
                Statement: [{
                    Sid: 'id-1',
                    Effect: 'Allow',
                    Principal: { AWS: "*" },
                    Action: ['s3:*'],
                    Resource: [`arn:aws:s3:::*`]
                },
            ]
            };
            // create accounts
            let res = await generate_nsfs_account(rpc_client, EMAIL, new_buckets_path3, { admin: true });
            s3_admin = generate_s3_client(res.access_key, res.secret_key, CORETEST_ENDPOINT);
            await s3_admin.putBucketPolicy({
                Bucket: bucket_name,
                Policy: JSON.stringify(policy)
            });
            await s3_admin.putBucketPolicy({
                Bucket: disabled_bucket_name,
                Policy: JSON.stringify(policy)
            });
            // create nsfs account
            res = await generate_nsfs_account(rpc_client, EMAIL, new_buckets_path3);
            s3_client = generate_s3_client(res.access_key, res.secret_key, CORETEST_ENDPOINT);
            accounts.push(res.email);
            // create a file in version disabled bucket
            await create_object(`${disabled_full_path}/${dis_version_key}`, dis_version_body, 'null');
            // create a file after when versioning not enabled
            await create_object(`${full_path}/${dis_version_key}`, dis_version_body, 'null');
            await s3_client.putBucketVersioning({ Bucket: bucket_name, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
            const bucket_ver = await s3_client.getBucketVersioning({ Bucket: bucket_name });
            assert.equal(bucket_ver.Status, 'Enabled');
            // create base file after versioning enabled
            file_pointer = await create_object(`${full_path}/${en_version_key}`, en_version_body, versionID_1, true);
        });

        mocha.after(async () => {
            if (file_pointer) await file_pointer.close(DEFAULT_FS_CONFIG);
            fs_utils.folder_delete(tmp_fs_root);
            for (const email of accounts) {
                await rpc_client.account.delete_account({ email });
            }
        });

        mocha.it('get object, versioning not enabled - should return latest object', async function() {
            const res = await s3_client.getObject({Bucket: disabled_bucket_name, Key: dis_version_key});
            const body_as_string = await res.Body.transformToString();
            assert.equal(body_as_string, dis_version_body);
        });

        mocha.it('get object, versioning not enabled, version id specified - should return NoSuchKey', async function() {
            try {
                await s3_client.getObject({Bucket: disabled_bucket_name, Key: dis_version_key, VersionId: versionID_1});
                assert.fail('Should fail');
            } catch (err) {
                    assert.equal(err.Code, 'NoSuchKey');
            }
        });

        mocha.it('get object, file created before the version is enabled - should return latest object', async function() {
            const res = await s3_client.getObject({Bucket: bucket_name, Key: dis_version_key});
            const body_as_string = await res.Body.transformToString();
            assert.equal(body_as_string, dis_version_body);
        });

        mocha.it('get object, file created before the version is enabled, version id specified - should return ENOENT', async function() {
            try {
                    await s3_client.getObject({Bucket: bucket_name, Key: dis_version_key, VersionId: versionID_1});
                    assert.fail('Should fail');
            } catch (err) {
                    assert.equal(err.Code, 'NoSuchKey');
            }
        });

        mocha.it('get object, with version enabled, no version id specified - should return latest object', async function() {
            const res = await s3_client.getObject({Bucket: bucket_name, Key: en_version_key});
            const body_as_string = await res.Body.transformToString();
            assert.equal(body_as_string, en_version_body);
        });

        mocha.it('get object, with version enabled, with version id specified and matching with main file - should return latest object', async function() {
            const res = await s3_client.getObject({Bucket: bucket_name, Key: en_version_key, VersionId: versionID_1});
            const body_as_string = await res.Body.transformToString();
            assert.equal(body_as_string, en_version_body);
        });

        mocha.it('get object, with version enabled, with version id specified and not matching with main file - should return $VersionId object', async function() {
            await create_object(`${version_dir_path}/${key_version}`, en_version_body_v1, versionID_2);
            const res = await s3_client.getObject({Bucket: bucket_name, Key: en_version_key, VersionId: versionID_2});
            const body_as_string = await res.Body.transformToString();
            assert.equal(body_as_string, en_version_body_v1);
        });

        mocha.it('get object, with version enabled, with version id specified and versioned object not present - should return NoSuchKey', async function() {
            try {
                await s3_client.getObject({Bucket: bucket_name, Key: en_version_key, VersionId: versionID_3});
                assert.fail('Should fail');
            } catch (err) {
                assert.equal(err.Code, 'NoSuchKey');
            }
        });

        mocha.it('get object, with version enabled, with wrong version id specified - should return Bad Request', async function() {
            try {
                await s3_client.getObject({Bucket: bucket_name, Key: en_version_key, VersionId: 'ctime-12-ino-12a'});
                assert.fail('Should fail');
            } catch (err) {
                assert.equal(err.Code, 'BadRequest');
            }
        });

        mocha.it('head object, version not enabled - should return latest object md', async function() {
            try {
                await s3_client.headObject({Bucket: disabled_bucket_name, Key: dis_version_key});
                assert.ok('Expected latest head object returned');
            } catch (err) {
                assert.fail('Latest head object not found');
            }
        });

        mocha.it('head object, version not enabled, version specified - should return object NotFound', async function() {
            try {
                await s3_client.headObject({Bucket: disabled_bucket_name, Key: dis_version_key, VersionId: versionID_1});
                assert.fail('Should fail');
            } catch (err) {
                assert.equal(err.name, 'NotFound');
            }
        });

        mocha.it('head object, file created before the version is enabled - should return latest object md', async function() {
            try {
                await s3_client.headObject({Bucket: bucket_name, Key: dis_version_key});
                assert.ok('Expected latest head object returned');
            } catch (err) {
                assert.fail('Latest head object not found');
            }
        });

        mocha.it('head object, file created before the version is enabled, version specified - should return NotFound', async function() {
            try {
                await s3_client.headObject({Bucket: bucket_name, Key: dis_version_key, VersionId: versionID_1});
                assert.ok('Expected latest head object returned');
            } catch (err) {
                assert.equal(err.name, 'NotFound');
            }
        });

        mocha.it('head object, with version enabled, no version id specified - should return latest object md', async function() {
            try {
                await s3_client.headObject({Bucket: bucket_name, Key: en_version_key});
                assert.ok('Expected latest head object returned');
            } catch (err) {
                assert.fail(`Failed with an error: ${err.Code}`);
            }
        });

        mocha.it('head object, with version enabled, with version id specified and matching with main file - should return latest object md', async function() {
            try {
                await s3_client.headObject({Bucket: bucket_name, Key: en_version_key, VersionId: versionID_1});
                assert.ok('Expected latest head object returned');
            } catch (err) {
                assert.fail(`Failed with an error: ${err.Code}`);
            }
        });

        mocha.it('head object, with version enabled, with version id specified and not matching with main file - should return $VersionId object md', async function() {
            await create_object(`${version_dir_path}/${key_version}`, en_version_body_v1, versionID_2);
            try {
                await s3_client.headObject({Bucket: bucket_name, Key: en_version_key, VersionId: versionID_2});
                assert.ok('Expected versioned object returned');
            } catch (err) {
                assert.fail(`Failed with an error: ${err.Code}`);
            }
        });

        mocha.it('head object, with version enabled, versioned object not created - should return NotFound', async function() {
            try {
                await s3_client.headObject({Bucket: bucket_name, Key: en_version_key, VersionId: versionID_3});
                assert.fail('Should fail');
            } catch (err) {
                assert.equal(err.name, 'NotFound');
            }
        });

        mocha.it('head object, with version enabled, wrong version id specified - should return NotFound', async function() {
            try {
                await s3_client.headObject({Bucket: bucket_name, Key: en_version_key, VersionId: versionID_3});
                assert.fail('Should fail');
            } catch (err) {
                assert.equal(err.name, 'NotFound');
            }
        });
        mocha.it('Put object when version disbled and do put on the same object when version enabled - get object should return versioned object', async function() {
            let res = await s3_client.getObject({Bucket: disabled_bucket_name, Key: dis_version_key});
            let body_as_string = await res.Body.transformToString();
            assert.equal(body_as_string, dis_version_body);
            const version_obj_path = disabled_full_path + '/.versions';
            const version_key = dis_version_key + '_null';
            const version_body = 'DDDDD';
            const version_body_new_version = 'EEEEE';
            await s3_client.putBucketVersioning({ Bucket: disabled_bucket_name, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
            const bucket_ver = await s3_client.getBucketVersioning({ Bucket: disabled_bucket_name });
            assert.equal(bucket_ver.Status, 'Enabled');
            // May be below 3 steps can be replaced with put_object() to create versioned object
            await fs_utils.create_fresh_path(version_obj_path, 0o770);
            await fs_utils.file_must_exist(version_obj_path);
            await create_object(`${version_obj_path}/${version_key}`, version_body, 'null');
            await create_object(`${disabled_full_path}/${dis_version_key}`, version_body_new_version, 'mtime-jhdfbkjsd-ino-bnsdf7f');
            res = await s3_client.getObject({Bucket: disabled_bucket_name, Key: dis_version_key, VersionId: 'null'});
            body_as_string = await res.Body.transformToString();
            assert.equal(body_as_string, version_body);
        });

        mocha.it('get object, with version enabled, delete marker placed on latest object - should return NoSuchKey', async function() {
            const xattr_delete_marker = { [XATTR_DELETE_MARKER]: 'true' };
            await file_pointer.replacexattr(DEFAULT_FS_CONFIG, xattr_delete_marker);
            try {
                await s3_client.getObject({Bucket: bucket_name, Key: en_version_key});
                assert.fail('Should fail');
            } catch (err) {
                assert.equal(err.Code, 'NoSuchKey');
            }
        });

        mocha.it('get object, with version enabled, delete marker placed on latest object, version id specified - should return the version object', async function() {
            const xattr_delete_marker = { [XATTR_DELETE_MARKER]: 'true' };
            await file_pointer.replacexattr(DEFAULT_FS_CONFIG, xattr_delete_marker);
            const res = await s3_client.getObject({Bucket: bucket_name, Key: en_version_key, VersionId: versionID_2});
            const body_as_string = await res.Body.transformToString();
            assert.equal(body_as_string, en_version_body_v1);
        });

        mocha.it('head object, with version enabled, delete marked xattr placed on latest object - should return ENOENT', async function() {
            const xattr_delete_marker = { [XATTR_DELETE_MARKER]: 'true' };
            await file_pointer.replacexattr(DEFAULT_FS_CONFIG, xattr_delete_marker);
            try {
                await s3_client.headObject({Bucket: bucket_name, Key: en_version_key});
                assert.fail('Should fail');
            } catch (err) {
                assert.equal(err.name, 'NotFound');
            }
        });

        mocha.it('head object, with version enabled, delete marked xattr placed on latest object, version id specified - should return the version object', async function() {
            const xattr_delete_marker = { [XATTR_DELETE_MARKER]: 'true' };
            await file_pointer.replacexattr(DEFAULT_FS_CONFIG, xattr_delete_marker);
            try {
                await s3_client.headObject({Bucket: bucket_name, Key: en_version_key, VersionId: versionID_2});
                assert.ok('Expected versioned object returned');
            } catch (err) {
                assert.fail(`Failed with an error: ${err.Code}`);
            }
        });

        mocha.it('head object, with version enabled, version id specified delete marker - should throw error with code 405', async function() {
            try {
                await s3_client.headObject({Bucket: bucket_name, Key: en_version_key, VersionId: versionID_1});
                assert.fail('Should fail');
            } catch (err) {
                assert.strictEqual(err.$metadata.httpStatusCode, 405);
                // In headObject the AWS SDK doesn't return the err.Code
                // In AWS CLI it looks:
                // An error occurred (405) when calling the HeadObject operation: Method Not Allowed
                // in the docs: https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html
                //    if the HEAD request generates an error, it returns a generic code, such as ...
                //    405 Method Not Allowed, ... It's not possible to retrieve the exact exception of these error codes.
            }
        });

        mocha.it('get object, with version enabled, version id specified delete marker - should throw error with code 405', async function() {
            try {
                await s3_client.getObject({Bucket: bucket_name, Key: en_version_key, VersionId: versionID_1});
                assert.fail('Should fail');
            } catch (err) {
                assert.strictEqual(err.$metadata.httpStatusCode, 405);
                assert.strictEqual(err.Code, 'MethodNotAllowed');
                // In AWS CLI it looks:
                // An error occurred (MethodNotAllowed) when calling the GetObject operation: The specified method is not allowed against this resource.
            }
        });
    });
});



///// UTILS ///////

async function delete_object_versions(bucket_path, key) {
    // delete past versions
    const versions_dir = path.join(bucket_path, '.versions');
    try {
        const versions = await nb_native().fs.readdir(DEFAULT_FS_CONFIG, versions_dir);

        for (const entry of versions) {
            if (entry.name.startsWith(key)) {
                await fs_utils.file_delete(path.join(versions_dir, entry.name));
            }
        }
    } catch (err) {
        console.log('find_max_version_past: .versions is missing');
    }
    // delete latest version
    await fs_utils.file_delete(path.join(bucket_path, key));
}

// upload_object_versions
// object_types_arr:
// 1. Would contain strings 'regular', 'null', and 'delete_marker'.
// 2. If array contains n elements then:
//    at index 0 is the version that was put first (oldest version)
//    at index n-1 is the version that was put last (newest version)
async function upload_object_versions(s3_client, bucket, key, object_types_arr) {
    const res = [];
    const versioning_status = await s3_client.getBucketVersioning({ Bucket: bucket });
    for (const obj_type of object_types_arr) {
        if (obj_type === 'regular' || obj_type === 'null') {
            if (!versioning_status.Status && obj_type === 'regular') {
                await s3_client.putBucketVersioning({ Bucket: bucket, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
            }
            const random_body = (Math.random() + 1).toString(36).substring(7);
            const put_res = await s3_client.putObject({ Bucket: bucket, Key: key, Body: random_body });
            res.push(put_res);
        } else if (obj_type === 'delete_marker') {
            if (!versioning_status.Status) {
                await s3_client.putBucketVersioning({ Bucket: bucket, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
            }
            const delete_res = await s3_client.deleteObject({ Bucket: bucket, Key: key });
            res.push(delete_res);
        }
    }
    return res;
}
// add the prev xattr optimization 
async function find_max_version_past(full_path, key, dir, skip_list) {
    const versions_dir = path.join(full_path, dir || '', '.versions');
    try {
        //let versions = await nb_native().fs.readdir(DEFAULT_FS_CONFIG, versions_dir);
        let max_mtime_nsec = 0;
        let max_path;
        const versions = (await nb_native().fs.readdir(DEFAULT_FS_CONFIG, versions_dir)).filter(entry => {
            const index = entry.name.endsWith('_null') ? entry.name.lastIndexOf('_null') :
                entry.name.lastIndexOf('_mtime-');
            // don't fail if version entry name is invalid, just keep searching
            return index > 0 && entry.name.slice(0, index) === key;
        });
        for (const entry of versions) {
            if (skip_list ? !skip_list.includes(entry.name.slice(key.length + 1)) : true) {
                const version_str = entry.name.slice(key.length + 1);
                const { mtimeNsBigint } = _extract_version_info_from_xattr(version_str) ||
                    (await nb_native().fs.stat(DEFAULT_FS_CONFIG, path.join(versions_dir, entry.name)));

                if (mtimeNsBigint > max_mtime_nsec) {
                    max_mtime_nsec = mtimeNsBigint;
                    max_path = entry.name;
                }
            }
        }
        return max_path && max_path.slice(key.length + 1);
    } catch (err) {
        console.log('find_max_version_past: .versions is missing', err);
    }
}

function _extract_version_info_from_xattr(version_id_str) {
    if (version_id_str === 'null') return;
    const arr = version_id_str.split('mtime-').join('').split('-ino-');
    if (arr.length < 2) throw new Error('Invalid version_id_string, cannot extact attributes');
    return { mtimeNsBigint: size_utils.string_to_bigint(arr[0], 36), ino: parseInt(arr[1], 36) };
}

async function version_file_exists(full_path, key, dir, version_id) {
    const version_path = path.join(full_path, dir, '.versions', key + '_' + version_id);
    await fs_utils.file_must_exist(version_path);
    return true;
}

async function version_file_must_not_exists(full_path, key, dir, version_id) {
    const version_path = path.join(full_path, dir, '.versions', key + '_' + version_id);
    await fs_utils.file_must_not_exist(version_path);
    return true;
}

async function get_obj_and_compare_data(s3, bucket_name, key, expected_body) {
    const get_res = await s3.getObject({ Bucket: bucket_name, Key: key });
    const body_as_string = await get_res.Body.transformToString();
    assert.equal(body_as_string, expected_body);
    return true;
}

async function is_delete_marker(full_path, dir, key, version) {
    const version_path = path.join(full_path, dir, '.versions', key + '_' + version);
    const stat = await nb_native().fs.stat(DEFAULT_FS_CONFIG, version_path);
    return stat && stat.xattr[XATTR_DELETE_MARKER];
}

async function stat_and_get_version_id(full_path, key) {
    const key_path = path.join(full_path, key);
    const stat = await nb_native().fs.stat(DEFAULT_FS_CONFIG, key_path);
    return get_version_id_by_xattr(stat);
}

async function stat_and_get_all(full_path, key) {
    const key_path = path.join(full_path, key);
    const stat = await nb_native().fs.stat(DEFAULT_FS_CONFIG, key_path);
    return stat;
}

async function compare_version_ids(full_path, key, put_result_version_id, prev_version_id, is_enabled = true) {
    const key_path = path.join(full_path, key);
    const stat = await nb_native().fs.stat(DEFAULT_FS_CONFIG, key_path);
    const new_version_id = is_enabled ? get_version_id_by_stat(stat) : NULL_VERSION_ID;
    const xattr_version_id = get_version_id_by_xattr(stat);
    if (is_enabled) {
        assert.equal(new_version_id, put_result_version_id);
    } else {
        // When versioning is Suspended or Disabled the response of put object will include only Etag.
        // Hence, put_result_version_id should be undefined.
        assert.notEqual(new_version_id, put_result_version_id);
    }
    assert.equal(new_version_id, xattr_version_id);
    if (prev_version_id) {
        if (is_enabled) {
            // When versioning is Enabled the version IDs are unique.
            // Hence, the new version ID must be different than the previous one.
            assert.notEqual(new_version_id, prev_version_id);
        }
    }
    return true;
}

function get_version_id_by_stat(stat) {
    return 'mtime-' + stat.mtimeNsBigint.toString(36) + '-ino-' + stat.ino.toString(36);
}

function get_version_id_by_xattr(stat) {
    return (stat && stat.xattr[XATTR_VERSION_ID]) || 'null';
}

function check_enable_version_format(version_id) {
    const v_parts = version_id.split('-');
    if (v_parts[0] !== 'mtime' || v_parts[2] !== 'ino') {
        return false;
    }

    const version_format = /^[a-z0-9]+$/;
    if (!version_format.test(v_parts[1]) || !version_format.test(v_parts[3])) {
        return false;
    }
    return true;
}

function check_null_version_id(version_id) {
    return version_id === NULL_VERSION_ID;
}

async function put_allow_all_bucket_policy(s3_client, bucket) {
    const policy = {
        Version: '2012-10-17',
        Statement: [{
            Sid: 'id-1',
            Effect: 'Allow',
            Principal: { AWS: "*" },
            Action: ['s3:*'],
            Resource: [`arn:aws:s3:::*`]
        }
    ]
    };
    // create accounts
    await s3_client.putBucketPolicy({
        Bucket: bucket,
        Policy: JSON.stringify(policy)
    });
}

mocha.describe('List-objects', function() {
    const nsr = 'noobaa-nsr-object-vesions';
    const bucket_name = 'noobaa-bucket-object-vesions';
    const tmp_fs_root4 = path.join(TMP_PATH, 'test_bucketspace_list_object_versions');
    const bucket_path = '/bucket';
    const full_path = tmp_fs_root4 + bucket_path;
    const version_dir = '/.versions';
    const full_path_version_dir = full_path + `${version_dir}`;
    const dir1 = full_path + '/dir1';
    const dir1_version_dir = dir1 + `${version_dir}`;

    let s3_client;
    let s3_admin;
    const accounts = [];
    const key = 'search_key';
    const body = 'AAAA';
    const version_key_1 = 'search_key_mtime-crh3783sxk3k-ino-guty';
    const version_key_2 = 'search_key_mtime-crkfjum9883k-ino-guu7';
    const version_key_3 = 'search_key_mtime-crkfjx1hui2o-ino-guu9';
    const version_key_4 = 'search_key_mtime-crkfjx1hui2o-ino-guuh';
    const key_version = 'mtime-gffdt785k3k-ino-fgy';

    const dir_key = 'dir1/delete_marker_key';
    const dir_version_key_1 = 'delete_marker_key_mtime-crkfjknr7xmo-ino-guu4';
    const dir_version_key_2 = 'delete_marker_key_mtime-crkfjr98uiv4-ino-guu6';
    const version_body = 'A1A1A1A';

    let file_pointer;

    mocha.before(async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        if (process.getgid() !== 0 || process.getuid() !== 0) {
            console.log('No Root permissions found in env. Skipping test');
            this.skip(); // eslint-disable-line no-invalid-this
        }
        // create paths
        await fs_utils.create_fresh_path(tmp_fs_root4, 0o777);
        await fs_utils.create_fresh_path(full_path, 0o770);
        await fs_utils.file_must_exist(full_path);
        await fs_utils.create_fresh_path(full_path_version_dir, 0o770);
        await fs_utils.file_must_exist(full_path_version_dir);
        await fs_utils.create_fresh_path(dir1, 0o770);
        await fs_utils.file_must_exist(dir1);
        await fs_utils.create_fresh_path(dir1_version_dir, 0o770);
        await fs_utils.file_must_exist(dir1_version_dir);
        const new_bucket_path4 = get_new_buckets_path_by_test_env(tmp_fs_root4, '/');
        if (is_nc_coretest) {
            const { uid, gid } = get_admin_mock_account_details();
            await set_path_permissions_and_owner(full_path, { uid, gid }, 0o700);
        }
        // export dir as a bucket
        await rpc_client.pool.create_namespace_resource({
            name: nsr,
            nsfs_config: {
                fs_root_path: tmp_fs_root4,
            }
        });
        const obj_nsr = { resource: nsr, path: bucket_path };
        await rpc_client.bucket.create_bucket({
            name: bucket_name,
            namespace: {
                read_resources: [obj_nsr],
                write_resource: obj_nsr
            }
        });
        const policy = {
            Version: '2012-10-17',
            Statement: [{
                Sid: 'id-1',
                Effect: 'Allow',
                Principal: { AWS: "*" },
                Action: ['s3:*'],
                Resource: [`arn:aws:s3:::*`]
            },
        ]
        };
        // create accounts
        let res = await generate_nsfs_account(rpc_client, EMAIL, new_bucket_path4, { admin: true });
        s3_admin = generate_s3_client(res.access_key, res.secret_key, CORETEST_ENDPOINT);
        await s3_admin.putBucketPolicy({
            Bucket: bucket_name,
            Policy: JSON.stringify(policy)
        });
        // create nsfs account
        res = await generate_nsfs_account(rpc_client, EMAIL, new_bucket_path4);
        s3_client = generate_s3_client(res.access_key, res.secret_key, CORETEST_ENDPOINT);
        accounts.push(res.email);
        await s3_client.putBucketVersioning({ Bucket: bucket_name, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });
        const bucket_ver = await s3_client.getBucketVersioning({ Bucket: bucket_name });
        assert.equal(bucket_ver.Status, 'Enabled');
        await create_object(`${full_path}/${key}`, body, key_version);
        await create_object(`${full_path_version_dir}/${version_key_1}`, version_body, 'mtime-crh3783sxk3k-ino-guty');
        await create_object(`${full_path_version_dir}/${version_key_2}`, version_body, 'mtime-crkfjum9883k-ino-guu7');
        await create_object(`${full_path_version_dir}/${version_key_3}`, version_body, 'mtime-crkfjx1hui2o-ino-guu9');
        file_pointer = await create_object(`${full_path}/${dir_key}`, version_body, 'null', true);
        await create_object(`${dir1_version_dir}/${dir_version_key_1}`, version_body, 'mtime-crkfjknr7xmo-ino-guu4');
        await create_object(`${dir1_version_dir}/${dir_version_key_2}`, version_body, 'mtime-crkfjr98uiv4-ino-guu6');
    });

    mocha.after(async () => {
        if (file_pointer) await file_pointer.close(DEFAULT_FS_CONFIG);
        fs_utils.folder_delete(tmp_fs_root);
        for (const email of accounts) {
            await rpc_client.account.delete_account({ email });
        }
    });

    mocha.it('list objects - should return only latest object', async function() {
        const res = await s3_client.listObjects({Bucket: bucket_name});
        let count = 0;
        res.Contents.forEach(val => {
            if (val.Key === key) {
                count += 1;
            }
        });
        assert.equal(count, 1);
    });

    mocha.it('list object versions - should return all versions of all the object', async function() {
        const res = await s3_client.listObjectVersions({Bucket: bucket_name});
        let count = 0;
        res.Versions.forEach(val => {
           count += 1;
        });
        assert.equal(count, 7);
    });

    mocha.it('list object versions - should by pass the dir cache and load the objects from the disk', async function() {
        // Creation of version under HIDDER_VERSION_PATH will trigger load() call
        await create_object(`${full_path_version_dir}/${version_key_4}`, version_body, 'null');
        let res = await s3_client.listObjectVersions({Bucket: bucket_name});
        let count = 0;
        res.Versions.forEach(val => {
           count += 1;
        });
        assert.equal(count, 8);
        // Deletion of version under HIDDER_VERSION_PATH will trigger load() call
        await fs_utils.file_delete(path.join(full_path_version_dir, version_key_4));
        res = await s3_client.listObjectVersions({Bucket: bucket_name});
        count = 0;
        res.Versions.forEach(val => {
           count += 1;
        });
        assert.equal(count, 7);
    });

    mocha.it('list object versions - should return all the versions of the requested object', async function() {
        const res = await s3_client.listObjectVersions({Bucket: bucket_name, KeyMarker: key});
        let count = 0;
        res.Versions.forEach(val => {
            count += 1;
        });
        assert.equal(count, 3);
    });

    mocha.it('list object versions - should return only max_key number of elements', async function() {
        const res = await s3_client.listObjectVersions({Bucket: bucket_name, MaxKeys: 2});
        let count = 0;
        res.Versions.forEach(val => {
           count += 1;
        });
        assert.equal(count, 2);
    });

    mocha.it('list object versions - should return only max keys of the versions of the requested object and nextKeyMarker should point to the next version', async function() {
        const res = await s3_client.listObjectVersions({Bucket: bucket_name, KeyMarker: key, MaxKeys: 2});
        let count = 0;
        assert(res.KeyMarker, key);
        assert(res.NextKeyMarker, key);
        assert(res.NextVersionIdMarker, version_key_2);
        res.Versions.forEach(val => {
            count += 1;
        });
        assert.equal(count, 2);
    });

    mocha.it('list object versions - should return only max keys of the versions of the requested object from the version id marker', async function() {
        const res = await s3_client.listObjectVersions({Bucket: bucket_name,
                                                        KeyMarker: key, MaxKeys: 2,
                                                        VersionIdMarker: version_key_3});
        let count = 0;
        res.Versions.forEach(val => {
            count += 1;
        });
        assert.equal(count, 2);
    });

    mocha.it('list object versions - should fail because of missing key_marker', async function() {
        try {
            await s3_client.listObjectVersions({Bucket: bucket_name,
                                                MaxKeys: 2, VersionIdMarker: version_key_3});
            assert.fail(`list object versions passed though key marker is missing`);
        } catch (err) {
            assert.equal(err.Code, 'InvalidArgument');
        }
    });

    mocha.it('list objects - deleted object should not be listed', async function() {
        const xattr_delete_marker = { [XATTR_DELETE_MARKER]: 'true' };
        file_pointer.replacexattr(DEFAULT_FS_CONFIG, xattr_delete_marker);
        const res = await s3_client.listObjects({Bucket: bucket_name});
        let count = 0;
        res.Contents.forEach(val => {
            if (val.Key === dir_key) {
                count += 1;
            }
        });
        assert.equal(count, 0);
    });

    mocha.it('list object versions - All versions of the object should be listed', async function() {
        const xattr_delete_marker = { [XATTR_DELETE_MARKER]: 'true' };
        file_pointer.replacexattr(DEFAULT_FS_CONFIG, xattr_delete_marker);
        const res = await s3_client.listObjectVersions({Bucket: bucket_name});
        let count = 0;
        res.Versions.forEach(val => {
            if (val.Key === dir_key) {
                count += 1;
            }
        });
        assert.equal(count, 2);
    });

    mocha.it('list object versions - Check whether the deleted object is the latest and should be present under delete markers as well', async function() {
        const xattr_delete_marker = { [XATTR_DELETE_MARKER]: 'true' };
        file_pointer.replacexattr(DEFAULT_FS_CONFIG, xattr_delete_marker);
        const res = await s3_client.listObjectVersions({Bucket: bucket_name});

        res.DeleteMarkers.forEach(val => {
            if (val.Key === dir_key) {
                assert.equal(val.IsLatest, true);
                assert.equal(res.DeleteMarkers[0].IsLatest, true);
                assert.equal(res.DeleteMarkers[0].Key, dir_key);
            }
        });
    });

    mocha.it('list object versions - should not list .versions folder', async function() {
        const res = await s3_client.listObjectVersions({Bucket: bucket_name, Delimiter: "/"});
        res.CommonPrefixes?.forEach(obj => {
            assert.notEqual(obj.Prefix, ".versions/");
        });
    });

    mocha.it('list object versions - should show isLatest flag only for latest objects', async function() {
        const res = await s3_client.listObjectVersions({Bucket: bucket_name});
        let count = 0;
        res.Versions.forEach(val => {
            if (val.IsLatest) {
                if (val.Key === key) {
                    assert.equal(val.VersionId, key_version);
                }
                count += 1;
            }
        });
        res.DeleteMarkers.forEach(val => {
            if (val.IsLatest) {
                assert.equal(val.VersionId, 'null');
                count += 1;
            }
        });
        assert.equal(count, 2);
    });

    mocha.it('list object versions - should show version-id in suspention mode', async function() {
        await s3_client.putBucketVersioning({ Bucket: bucket_name, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Suspended' } });
        const res = await s3_client.listObjectVersions({Bucket: bucket_name});
        let count = 0;
        res.Versions.forEach(val => {
            if (val.VersionId !== 'null') {
                count += 1;
            }
        });
        assert.equal(count, 6);
    });
});

async function create_object(object_path, data, version_id, return_fd) {
    const target_file = await nb_native().fs.open(DEFAULT_FS_CONFIG, object_path, 'w+');
    await fs.promises.writeFile(object_path, data);
    if (version_id !== 'null') {
        const xattr_version_id = { [XATTR_VERSION_ID]: `${version_id}` };
        await target_file.replacexattr(DEFAULT_FS_CONFIG, xattr_version_id);
    }
    if (return_fd) return target_file;
    await target_file.close(DEFAULT_FS_CONFIG);
}
