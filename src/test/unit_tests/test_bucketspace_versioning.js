/* Copyright (C) 2020 NooBaa */
/*eslint max-lines-per-function: ["error", 1000]*/
'use strict';


const mocha = require('mocha');
const AWS = require('aws-sdk');
const http = require('http');
const assert = require('assert');
const coretest = require('./coretest');
const { rpc_client, EMAIL } = coretest;
const fs_utils = require('../../util/fs_utils');
const size_utils = require('../../util/size_utils');
const path = require('path');
const nb_native = require('../../util/nb_native');
coretest.setup({ pools_to_create: [coretest.POOL_LIST[1]] });

const MAC_PLATFORM = 'darwin';
const XATTR_VERSION_ID = 'user.version_id';
const XATTR_PREV_VERSION_ID = 'user.prev_version_id';
const XATTR_DELETE_MARKER = 'user.delete_marker';

const DEFAULT_FS_CONFIG = {
    uid: process.getuid(),
    gid: process.getgid(),
    backend: '',
    warn_threshold_ms: 100,
};

mocha.describe('bucketspace namespace_fs - versioning', function() {
    const nsr = 'versioned-nsr';
    const bucket_name = 'versioned-bucket';
    const disabled_bucket_name = 'disabled-bucket';

    let tmp_fs_root = '/tmp/test_bucket_namespace_fs_versioning';
    if (process.platform === MAC_PLATFORM) {
        tmp_fs_root = '/private/' + tmp_fs_root;
    }
    const bucket_path = '/bucket';
    const full_path = tmp_fs_root + bucket_path;
    const disabled_bucket_path = '/disabled_bucket';
    const disabled_full_path = tmp_fs_root + disabled_bucket_path;
    const versions_path = path.join(full_path, '.versions/');
    let s3_uid5;
    let s3_uid6;
    let s3_admin;
    let accounts = [];
    const disabled_key = 'disabled_key.txt';
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

    mocha.before(async function() {
        if (process.getgid() !== 0 || process.getuid() !== 0) {
            coretest.log('No Root permissions found in env. Skipping test');
            this.skip(); // eslint-disable-line no-invalid-this
        }
        // create paths 
        await fs_utils.create_fresh_path(tmp_fs_root, 0o777);
        await fs_utils.create_fresh_path(full_path, 0o770);
        await fs_utils.file_must_exist(full_path);
        await fs_utils.create_fresh_path(disabled_full_path, 0o770);
        await fs_utils.file_must_exist(disabled_full_path);

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
        let res = await generate_nsfs_account({ admin: true });
        s3_admin = generate_s3_client(res.access_key, res.secret_key);
        await s3_admin.putBucketPolicy({
            Bucket: bucket_name,
            Policy: JSON.stringify(policy)
        }).promise();

        await s3_admin.putBucketPolicy({
            Bucket: disabled_bucket_name,
            Policy: JSON.stringify(policy)
        }).promise();

        res = await generate_nsfs_account({ uid: 5, gid: 5 });
        s3_uid5 = generate_s3_client(res.access_key, res.secret_key);
        accounts.push(res.email);

        res = await generate_nsfs_account();
        s3_uid6 = generate_s3_client(res.access_key, res.secret_key);
        accounts.push(res.email);
    });

    mocha.after(async () => {
        fs_utils.folder_delete(tmp_fs_root);
        for (let email of accounts) {
            await rpc_client.account.delete_account({ email });
        }
    });
    mocha.describe('put/get versioning', function() {
        mocha.it('put object - versioning disabled - to be enabled', async function() {
            await s3_uid6.putObject({ Bucket: bucket_name, Key: disabled_key, Body: body1 }).promise();
        });

        mocha.it('put object - versioning disabled bucket', async function() {
            await s3_uid6.putObject({ Bucket: disabled_bucket_name, Key: disabled_key, Body: body1 }).promise();
        });

        mocha.it('set bucket versioning - Enabled - should fail - no permissions', async function() {
            try {
                await s3_uid5.putBucketVersioning({ Bucket: bucket_name, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } }).promise();
                assert.fail(`put bucket versioning succeeded for account without permissions`);
            } catch (err) {
                assert.equal(err.code, 'AccessDenied');
            }
        });
        mocha.it('set bucket versioning - Enabled - admin - should fail - no permissions', async function() {
            try {
                await s3_admin.putBucketVersioning({ Bucket: bucket_name, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } }).promise();
                assert.fail(`put bucket versioning succeeded for account without permissions`);
            } catch (err) {
                assert.equal(err.code, 'AccessDenied');
            }
        });

        mocha.it('set bucket versioning - Enabled', async function() {
            await s3_uid6.putBucketVersioning({ Bucket: bucket_name, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } }).promise();
            const res = await s3_uid6.getBucketVersioning({ Bucket: bucket_name }).promise();
            assert.equal(res.Status, 'Enabled');
        });
    });
    mocha.describe('versioning enabled', function() {

        mocha.describe('put object', function() {

            mocha.it('put object 1st time - no existing objects in bucket', async function() {
                const res = await s3_uid6.putObject({ Bucket: bucket_name, Key: key1, Body: body1 }).promise();
                const comp_res = await compare_version_ids(full_path, key1, res.VersionId);
                assert.ok(comp_res);
                await fs_utils.file_must_not_exist(versions_path);
                key1_ver1 = res.VersionId;
            });

            mocha.it('put object 2nd time - versioning enabled', async function() {
                const prev_version_id = await stat_and_get_version_id(full_path, key1);
                const res = await s3_uid6.putObject({ Bucket: bucket_name, Key: key1, Body: body2 }).promise();
                const comp_res = await compare_version_ids(full_path, key1, res.VersionId, prev_version_id);
                assert.ok(comp_res);
                const exist = await version_file_exists(full_path, key1, '', prev_version_id);
                assert.ok(exist);
                key1_cur_ver = res.VersionId;
            });

            mocha.it('put object 2nd time - versioning enabled - disabled key', async function() {
                const prev_version_id = await stat_and_get_version_id(full_path, disabled_key);
                const res = await s3_uid6.putObject({ Bucket: bucket_name, Key: disabled_key, Body: body2 }).promise();
                const comp_res = await compare_version_ids(full_path, disabled_key, res.VersionId, prev_version_id);
                assert.ok(comp_res);
                const exist = await version_file_exists(full_path, disabled_key, '', 'null');
                assert.ok(exist);
            });

            mocha.it('put object 3rd time - versioning enabled - disabled key', async function() {
                const prev_version_id = await stat_and_get_version_id(full_path, disabled_key);
                const res = await s3_uid6.putObject({ Bucket: bucket_name, Key: disabled_key, Body: body3 }).promise();
                const comp_res = await compare_version_ids(full_path, disabled_key, res.VersionId, prev_version_id);
                assert.ok(comp_res);
                let exist = await version_file_exists(full_path, disabled_key, '', prev_version_id);
                assert.ok(exist);
                exist = await version_file_exists(full_path, disabled_key, '', 'null');
                assert.ok(exist);
            });
            mocha.it('put object 1st time - versioning enabled - nested', async function() {
                const res = await s3_uid6.putObject({ Bucket: bucket_name, Key: nested_key1, Body: body1 }).promise();
                await fs_utils.file_must_not_exist(dir1_versions_path);
                const comp_res = await compare_version_ids(full_path, nested_key1, res.VersionId);
                assert.ok(comp_res);
            });

            mocha.it('put object 2nd time - versioning enabled - nested', async function() {
                const prev_version_id = await stat_and_get_version_id(full_path, nested_key1);
                const res = await s3_uid6.putObject({ Bucket: bucket_name, Key: nested_key1, Body: body2 }).promise();
                const comp_res = await compare_version_ids(full_path, nested_key1, res.VersionId, prev_version_id);
                assert.ok(comp_res);
                const exist = await version_file_exists(full_path, key1, dir1, prev_version_id);
                assert.ok(exist);
            });
        });

        mocha.describe('mpu object', function() {
            mocha.it('mpu object 1st time - versioning enabled', async function() {
                const mpu_res = await s3_uid6.createMultipartUpload({ Bucket: bucket_name, Key: mpu_key1 }).promise();
                const upload_id = mpu_res.UploadId;
                const part1 = await s3_uid6.uploadPart({
                    Bucket: bucket_name, Key: mpu_key1, Body: body1, UploadId: upload_id, PartNumber: 1 }).promise();
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
                }).promise();
                const comp_res = await compare_version_ids(full_path, mpu_key1, res.VersionId);
                assert.ok(comp_res);
            });

            mocha.it('mpu object 2nd time - versioning enabled', async function() {
                const prev_version_id = await stat_and_get_version_id(full_path, mpu_key1);
                const mpu_res = await s3_uid6.createMultipartUpload({ Bucket: bucket_name, Key: mpu_key1 }).promise();
                const upload_id = mpu_res.UploadId;
                const part1 = await s3_uid6.uploadPart({
                    Bucket: bucket_name, Key: mpu_key1, Body: body1, UploadId: upload_id, PartNumber: 1 }).promise();
                const part2 = await s3_uid6.uploadPart({
                    Bucket: bucket_name, Key: mpu_key1, Body: body2, UploadId: upload_id, PartNumber: 2 }).promise();
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
                }).promise();
                const comp_res = await compare_version_ids(full_path, mpu_key1, res.VersionId, prev_version_id);
                assert.ok(comp_res);
                const exist = await version_file_exists(full_path, mpu_key1, '', prev_version_id);
                assert.ok(exist);
            });
        });
    });

    mocha.describe('copy object - versioning enabled - nsfs copy fallback flow', function() {

        mocha.it('copy object - target bucket versioning enabled - 1st', async function() {
            const res = await s3_uid6.copyObject({ Bucket: bucket_name, Key: copied_key1, CopySource: `${bucket_name}/${key1}` }).promise();
            const comp_res = await compare_version_ids(full_path, copied_key1, res.VersionId);
            assert.ok(comp_res);
        });

        mocha.it('copy object - target bucket versioning enabled - 2nd', async function() {
            const prev_version_id = await stat_and_get_version_id(full_path, copied_key1);
            const res = await s3_uid6.copyObject({ Bucket: bucket_name, Key: copied_key1, CopySource: `${bucket_name}/${key1}` }).promise();
            const comp_res = await compare_version_ids(full_path, copied_key1, res.VersionId, prev_version_id);
            assert.ok(comp_res);
            const exist = await version_file_exists(full_path, copied_key1, '', prev_version_id);
            assert.ok(exist);
        });

        mocha.it('copy object latest - source bucket versioning enabled', async function() {
            const key = 'copied_key2.txt';
            const res = await s3_uid6.copyObject({ Bucket: bucket_name, Key: key,
                CopySource: `${bucket_name}/${key1}`}).promise();
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
                    CopySource: `${bucket_name}/${key1}?versionId=${non_exist_version}`}).promise();
                assert.fail('copy non existing version should have failed');
            } catch (err) {
                assert.equal(err.code, 'NoSuchKey');
            }
        });

        mocha.it('copy object latest & versionId - source bucket versioning enabled', async function() {
            const key = 'copied_key3.txt';
            const res = await s3_uid6.copyObject({ Bucket: bucket_name, Key: key,
                CopySource: `${bucket_name}/${key1}?versionId=${key1_cur_ver}`}).promise();
            const body_comp_res = await get_obj_and_compare_data(s3_uid6, bucket_name, key, body2);
            assert.ok(body_comp_res);
            const comp_res = await compare_version_ids(full_path, key, res.VersionId);
            assert.ok(comp_res);
        });

        mocha.it('copy object version id - source bucket versioning enabled', async function() {
            const key = 'copied_key4.txt';
            const res = await s3_uid6.copyObject({ Bucket: bucket_name, Key: key,
                CopySource: `${bucket_name}/${key1}?versionId=${key1_ver1}`}).promise();
            const body_comp_res = await get_obj_and_compare_data(s3_uid6, bucket_name, key, body1);
            assert.ok(body_comp_res);
            const comp_res = await compare_version_ids(full_path, key, res.VersionId);
            assert.ok(comp_res);
        });

        mocha.it('copy object version null - version is in .versions/', async function() {
            const res = await s3_uid6.copyObject({ Bucket: bucket_name, Key: copied_key5,
                CopySource: `${bucket_name}/${disabled_key}?versionId=null`}).promise();
            const body_comp_res = await get_obj_and_compare_data(s3_uid6, bucket_name, copied_key5, body1);
            assert.ok(body_comp_res);
            const comp_res = await compare_version_ids(full_path, copied_key5, res.VersionId);
            assert.ok(comp_res);
        });

        mocha.it('copy object version null - no version null - should fail', async function() {
            try {
                await s3_uid6.copyObject({ Bucket: bucket_name, Key: copied_key5,
                    CopySource: `${bucket_name}/${key1}?versionId=null`}).promise();
                assert.fail('should have failed');
            } catch (err) {
                assert.equal(err.code, 'NoSuchKey');
            }
        });

        mocha.it('copy object - version does not exist - should fail', async function() {
            try {
                await s3_uid6.copyObject({ Bucket: bucket_name, Key: copied_key5,
                    CopySource: `${bucket_name}/${key1}?versionId=mtime-123-ino-123`}).promise();
                assert.fail('should have failed');
            } catch (err) {
                assert.equal(err.code, 'NoSuchKey');
            }
        });

        mocha.it('copy object version null from disabled bucket - version is in parent', async function() {
            const key = 'copied_key6.txt';
            const res = await s3_uid6.copyObject({ Bucket: bucket_name, Key: key,
                CopySource: `${disabled_bucket_name}/${disabled_key}?versionId=null`}).promise();
            const body_comp_res = await get_obj_and_compare_data(s3_uid6, bucket_name, key, body1);
            assert.ok(body_comp_res);
            const comp_res = await compare_version_ids(full_path, key, res.VersionId);
            assert.ok(comp_res);
        });

        mocha.it('set bucket versioning - Enabled', async function() {
            await s3_uid6.putBucketVersioning({ Bucket: disabled_bucket_name, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } }).promise();
            const res = await s3_uid6.getBucketVersioning({ Bucket: disabled_bucket_name }).promise();
            assert.equal(res.Status, 'Enabled');
        });

        mocha.it('copy object version null from enabled bucket - version is in parent', async function() {
            const key = 'copied_key7.txt';
            const res = await s3_uid6.copyObject({ Bucket: bucket_name, Key: key,
                CopySource: `${disabled_bucket_name}/${disabled_key}?versionId=null`}).promise();
            const body_comp_res = await get_obj_and_compare_data(s3_uid6, bucket_name, key, body1);
            assert.ok(body_comp_res);
            const comp_res = await compare_version_ids(full_path, key, res.VersionId);
            assert.ok(comp_res);
        });

        mocha.it('delete object latest - non existing version', async function() {
            const non_exist_version = 'mtime-dsad-ino-sdfasd';
            const res = await s3_uid6.deleteObject({ Bucket: bucket_name, Key: disabled_key, VersionId: non_exist_version }).promise();
            assert.equal(res.VersionId, non_exist_version);
        });

        mocha.it('delete object latest - create dm & move latest -> .versions/', async function() {
            const prev_version_id = await stat_and_get_version_id(full_path, disabled_key);
            const max_version1 = await find_max_version_past(full_path, disabled_key, '');
            const res = await s3_uid6.deleteObject({ Bucket: bucket_name, Key: disabled_key }).promise();
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
            const res = await s3_uid6.deleteObject({ Bucket: bucket_name, Key: key1 }).promise();
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
            const res = await s3_uid6.deleteObject({ Bucket: bucket_name, Key: key1 }).promise();
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

    mocha.describe('delete object', function() {
        const delete_object_test_bucket_reg = 'delete-object-test-bucket-reg';
        const delete_object_test_bucket_null = 'delete-object-test-bucket-null';
        const delete_object_test_bucket_dm = 'delete-object-test-bucket-dm';

        const full_delete_path = tmp_fs_root + '/' + delete_object_test_bucket_reg;
        const full_delete_path_null = tmp_fs_root + '/' + delete_object_test_bucket_null;
        const full_delete_path_dm = tmp_fs_root + '/' + delete_object_test_bucket_dm;

        let account_with_access;
        mocha.describe('delete object - versioning enabled', function() {
            mocha.describe('delete object - regular version - versioning enabled', async function() {
                mocha.before(async function() {
                    const res = await generate_nsfs_account({ default_resource: nsr });
                    account_with_access = generate_s3_client(res.access_key, res.secret_key);
                    await account_with_access.createBucket({ Bucket: delete_object_test_bucket_reg }).promise();
                    await put_allow_all_bucket_policy(s3_admin, delete_object_test_bucket_reg);
                    await account_with_access.createBucket({ Bucket: delete_object_test_bucket_null }).promise();
                    await put_allow_all_bucket_policy(s3_admin, delete_object_test_bucket_null);
                    await account_with_access.createBucket({ Bucket: delete_object_test_bucket_dm }).promise();
                    await put_allow_all_bucket_policy(s3_admin, delete_object_test_bucket_dm);
                });

            mocha.it('delete version id - fake id - should fail with NoSuchKey', async function() {
                const max_version1 = await find_max_version_past(full_path, key1, '');
                try {
                    await account_with_access.deleteObject({ Bucket: delete_object_test_bucket_reg, Key: key1, VersionId: 'mtime-123-ino-123'}).promise();
                    assert.fail('delete object should have failed on ENOENT');
                } catch (err) {
                    assert.equal(err.code, 'NoSuchKey');
                }
                const max_version2 = await find_max_version_past(full_path, key1, '');
                assert.equal(max_version1, max_version2);
            });

            mocha.it('delete object version id - latest - second latest is null version', async function() {
                const upload_res_arr = await upload_object_versions(account_with_access, delete_object_test_bucket_reg, key1, ['null', 'regular']);
                const cur_version_id1 = await stat_and_get_version_id(full_delete_path, key1);

                const delete_res = await account_with_access.deleteObject({ Bucket: delete_object_test_bucket_reg,
                    Key: key1, VersionId: upload_res_arr[1].VersionId }).promise();
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
                const cur_ver_info = await stat_and_get_all(full_delete_path, key1);
                assert.equal(cur_ver_info.xattr[XATTR_PREV_VERSION_ID], max_version0);
                const is_dm = await is_delete_marker(full_delete_path, '', key1, max_version0);
                assert.ok(is_dm);

                const delete_res = await account_with_access.deleteObject({ Bucket: delete_object_test_bucket_reg,
                    Key: key1, VersionId: upload_res_arr[2].VersionId }).promise();
                assert.equal(delete_res.VersionId, cur_version_id1);
                await fs_utils.file_must_not_exist(path.join(full_delete_path, key1));
                const max_version1 = await find_max_version_past(full_delete_path, key1, '');
                assert.equal(max_version1, max_version0);
                await delete_object_versions(full_delete_path, key1);
            });

            mocha.it('delete object version id - in .versions/', async function() {
                const put_res = await account_with_access.putObject({
                    Bucket: delete_object_test_bucket_reg, Key: key1, Body: body1 }).promise();
                await account_with_access.putObject({ Bucket: delete_object_test_bucket_reg, Key: key1, Body: body1 }).promise();
                const cur_version_id1 = await stat_and_get_version_id(full_delete_path, key1);
                const delete_res = await account_with_access.deleteObject({ Bucket: delete_object_test_bucket_reg,
                    Key: key1, VersionId: put_res.VersionId }).promise();
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
                    Key: key1, VersionId: cur_version_id }).promise();
                await fs_utils.file_must_not_exist(path.join(full_delete_path, key1 + '_' + cur_version_id));
                const max_version1 = await find_max_version_past(full_delete_path, key1, '');
                assert.equal(max_version1, undefined);
            });

            mocha.it('delete object version id - in .versions/ 2 - latest exist and it\'s a regular version', async function() {
                const upload_res_arr = await upload_object_versions(account_with_access, delete_object_test_bucket_reg, key1, ['regular', 'regular', 'regular']);

                const cur_version_id1 = await stat_and_get_version_id(full_delete_path, key1);
                assert.equal(cur_version_id1, upload_res_arr[2].VersionId);

                const delete_res = await account_with_access.deleteObject({ Bucket: delete_object_test_bucket_reg,
                    Key: key1, VersionId: upload_res_arr[1].VersionId }).promise();
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
                    Key: key1, VersionId: upload_res_arr[1].VersionId }).promise();
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
                    Key: key1, VersionId: upload_res_arr[1].VersionId }).promise();

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
                    Key: key1, VersionId: 'null' }).promise();

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
                    Key: key1, VersionId: 'null' }).promise();

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
                    Key: key1, VersionId: max_version }).promise();

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
                    Key: key1, VersionId: second_max_version1 }).promise();

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
                    Key: key1, VersionId: max_version }).promise();

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
                    Key: key1, VersionId: max_version }).promise();

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
                    Key: key1, VersionId: max_version }).promise();

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
                    Key: key1, VersionId: max_version }).promise();

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
                    Key: key1, VersionId: put_res[1].VersionId }).promise();

                await fs_utils.file_must_not_exist(path.join(full_delete_path_dm, key1));
                const latest_dm2 = await find_max_version_past(full_delete_path_dm, key1, '');
                assert.equal(latest_dm1, latest_dm2);
                await delete_object_versions(full_delete_path_dm, key1);
            });
        });
    });
});
    mocha.describe('delete multiple objects', function() {
        const delete_multi_object_test_bucket = 'delete-multi-object-test-bucket';
        const full_multi_delete_path = tmp_fs_root + '/' + delete_multi_object_test_bucket;
        let account_with_access;

        mocha.before(async function() {
            const res = await generate_nsfs_account({ default_resource: nsr });
            account_with_access = generate_s3_client(res.access_key, res.secret_key);
            await account_with_access.createBucket({ Bucket: delete_multi_object_test_bucket }).promise();
            await put_allow_all_bucket_policy(s3_admin, delete_multi_object_test_bucket);
        });

        mocha.it('delete multiple objects - no version id - versioning disabled', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(80000);
            let keys = [];
            for (let i = 0; i < 50; i++) {
                let random_key = (Math.random() + 1).toString(36).substring(7);
                keys.push(random_key);
                await upload_object_versions(account_with_access, delete_multi_object_test_bucket, random_key, ['null']);
            }
            const to_delete_arr = keys.map(key => ({ Key: key }));
            const delete_res = await account_with_access.deleteObjects({
                    Bucket: delete_multi_object_test_bucket, Delete: { Objects: to_delete_arr } }).promise();
            assert.equal(delete_res.Deleted.length, 50);
            assert.deepStrictEqual(delete_res.Deleted, to_delete_arr);
            for (let res of delete_res.Deleted) {
                assert.equal(res.DeleteMarker, undefined);
                assert.equal(res.VersionId, undefined);
            }
            const versions_dir = path.join(full_multi_delete_path, '.versions');
            await fs_utils.file_must_not_exist(versions_dir);
            let objects = await nb_native().fs.readdir(DEFAULT_FS_CONFIG, full_multi_delete_path);
            assert.equal(objects.length, 1);
            assert.ok(objects[0].name.startsWith('.noobaa-nsfs_'));

        });

        mocha.it('delete multiple objects - no version id', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(60000);
            let versions_type_arr = ['null'];
            for (let i = 0; i < 300; i++) {
                 versions_type_arr.push(i % 2 === 0 ? 'regular' : 'delete_marker');
            }
            await upload_object_versions(account_with_access, delete_multi_object_test_bucket, key1, versions_type_arr);
            let arr = [];
            for (let i = 0; i < 200; i++) {
                arr.push({ Key: 'a' });
            }
            const delete_res = await account_with_access.deleteObjects({
                    Bucket: delete_multi_object_test_bucket, Delete: { Objects: arr } }).promise();
            assert.equal(delete_res.Deleted.length, 200);
            for (let res of delete_res.Deleted) {
                assert.equal(res.DeleteMarker, true);
            }
            const versions_dir = path.join(full_multi_delete_path, '.versions');
            let versions = await nb_native().fs.readdir(DEFAULT_FS_CONFIG, versions_dir);
            assert.equal(versions.length, 501);
            await delete_object_versions(full_multi_delete_path, key1);
            await delete_object_versions(full_multi_delete_path, 'a');
        });

        mocha.it('delete multiple objects - delete only delete markers', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(60000);
            let versions_type_arr = [];
            for (let i = 0; i < 300; i++) {
                 versions_type_arr.push(i % 2 === 0 ? 'regular' : 'delete_marker');
            }
            let put_res = await upload_object_versions(account_with_access, delete_multi_object_test_bucket, key1, versions_type_arr);
            let arr = [];
            for (let i = 0; i < 300; i++) {
                if (i % 2 === 1) arr.push({ Key: key1, VersionId: put_res[i].VersionId });
            }
            const delete_res = await account_with_access.deleteObjects({
                    Bucket: delete_multi_object_test_bucket, Delete: { Objects: arr } }).promise();
            assert.equal(delete_res.Deleted.length, 150);
            for (let res of delete_res.Deleted) {
                assert.equal(res.DeleteMarker, true);
            }
            const versions_dir = path.join(full_multi_delete_path, '.versions');
            let versions = await nb_native().fs.readdir(DEFAULT_FS_CONFIG, versions_dir);
            assert.equal(versions.length, 149);
            await fs_utils.file_must_exist(path.join(full_multi_delete_path, key1));
            let latest_stat = await stat_and_get_all(full_multi_delete_path, key1);
            assert.equal(latest_stat.xattr[XATTR_VERSION_ID], put_res[298].VersionId);
            await delete_object_versions(full_multi_delete_path, key1);
        });

        mocha.it('delete multiple objects - delete only regular versions key1, delete delete markers key2', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(60000);
            const key2 = 'key2';
            let versions_type_arr = [];
            for (let i = 0; i < 300; i++) {
                 versions_type_arr.push(i % 2 === 0 ? 'regular' : 'delete_marker');
            }
            let put_res = await upload_object_versions(account_with_access, delete_multi_object_test_bucket, key1, versions_type_arr);
            let put_res2 = await upload_object_versions(account_with_access, delete_multi_object_test_bucket, key2, versions_type_arr);
            let arr = [];
            for (let i = 0; i < 300; i++) {
                if (i % 2 === 0) arr.push({ Key: key1, VersionId: put_res[i].VersionId });
                if (i % 2 === 1) arr.push({ Key: key2, VersionId: put_res2[i].VersionId });
            }
            const delete_res = await account_with_access.deleteObjects({
                    Bucket: delete_multi_object_test_bucket, Delete: { Objects: arr } }).promise();
            assert.equal(delete_res.Deleted.length, 300);
            for (let res of delete_res.Deleted.slice(0, 150)) {
                assert.equal(res.DeleteMarker, undefined);
            }
            for (let res of delete_res.Deleted.slice(150)) {
                assert.equal(res.DeleteMarker, true);
            }
            const versions_dir = path.join(full_multi_delete_path, '.versions');
            let versions = await nb_native().fs.readdir(DEFAULT_FS_CONFIG, versions_dir);
            // 150 of key1 and 149 of key2 (latest version of key2 is in the parent dir)
            assert.equal(versions.length, 299);
            await fs_utils.file_must_not_exist(path.join(full_multi_delete_path, key1));
            await fs_utils.file_must_exist(path.join(full_multi_delete_path, key2));
            let latest_dm_version = await find_max_version_past(full_multi_delete_path, key1);
            const version_path = path.join(full_multi_delete_path, '.versions', key1 + '_' + latest_dm_version);
            const version_info = await stat_and_get_all(version_path, '');
            assert.equal(version_info.xattr[XATTR_DELETE_MARKER], 'true');
            assert.equal(version_info.xattr[XATTR_VERSION_ID], put_res[299].VersionId);
            await delete_object_versions(full_multi_delete_path, key1);
            await delete_object_versions(full_multi_delete_path, key2);
        });

        mocha.it('delete multiple objects - delete regular versions & delete markers - new latest is dm', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(60000);
            let versions_type_arr = [];
            for (let i = 0; i < 300; i++) {
                 versions_type_arr.push(i % 2 === 0 ? 'regular' : 'delete_marker');
            }
            let put_res = await upload_object_versions(account_with_access, delete_multi_object_test_bucket, key1, versions_type_arr);
            let arr = [];
            for (let i = 200; i < 300; i++) {
                arr.push({ Key: key1, VersionId: put_res[i].VersionId });
            }
            const delete_res = await account_with_access.deleteObjects({
                    Bucket: delete_multi_object_test_bucket, Delete: { Objects: arr } }).promise();
            assert.equal(delete_res.Deleted.length, 100);
            for (let i = 0; i < 100; i++) {
                if (i % 2 === 1) assert.equal(delete_res.Deleted[i].DeleteMarker, true);
                if (i % 2 === 0) assert.equal(delete_res.Deleted[i].DeleteMarker, undefined);
            }
            const versions_dir = path.join(full_multi_delete_path, '.versions');
            let versions = await nb_native().fs.readdir(DEFAULT_FS_CONFIG, versions_dir);
            assert.equal(versions.length, 200);
            await fs_utils.file_must_not_exist(path.join(full_multi_delete_path, key1));
            let latest_dm_version = await find_max_version_past(full_multi_delete_path, key1);
            const version_path = path.join(full_multi_delete_path, '.versions', key1 + '_' + latest_dm_version);
            const version_info = await stat_and_get_all(version_path, '');
            assert.equal(version_info.xattr[XATTR_VERSION_ID], put_res[199].VersionId);
            await delete_object_versions(full_multi_delete_path, key1);
        });

        mocha.it('delete multiple objects - delete regular versions & delete markers - new latest is regular version', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(60000);
            let versions_type_arr = [];
            for (let i = 0; i < 300; i++) {
                 versions_type_arr.push(i % 2 === 0 ? 'regular' : 'delete_marker');
            }
            let put_res = await upload_object_versions(account_with_access, delete_multi_object_test_bucket, key1, versions_type_arr);
            let arr = [];
            for (let i = 100; i < 200; i++) {
                arr.push({ Key: key1, VersionId: put_res[i].VersionId });
            }
            arr.push({ Key: key1, VersionId: put_res[299].VersionId });
            const delete_res = await account_with_access.deleteObjects({
                    Bucket: delete_multi_object_test_bucket, Delete: { Objects: arr } }).promise();
            assert.equal(delete_res.Deleted.length, 101);
            for (let i = 0; i < 100; i++) {
                if (i % 2 === 1) assert.equal(delete_res.Deleted[i].DeleteMarker, true);
                if (i % 2 === 0) assert.equal(delete_res.Deleted[i].DeleteMarker, undefined);
            }
            const versions_dir = path.join(full_multi_delete_path, '.versions');
            let versions = await nb_native().fs.readdir(DEFAULT_FS_CONFIG, versions_dir);

            assert.equal(versions.length, 198);
            await fs_utils.file_must_exist(path.join(full_multi_delete_path, key1));
            let latest_stat = await stat_and_get_all(full_multi_delete_path, key1);
            assert.equal(latest_stat.xattr[XATTR_VERSION_ID], put_res[298].VersionId);
            await delete_object_versions(full_multi_delete_path, key1);
        });

        mocha.it('delete multiple objects - delete keys & regular versions & delete markers ', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(60000);
            let versions_type_arr = [];
            for (let i = 0; i < 300; i++) {
                 versions_type_arr.push(i % 2 === 0 ? 'regular' : 'delete_marker');
            }
            let put_res = await upload_object_versions(account_with_access, delete_multi_object_test_bucket, key1, versions_type_arr);
            let arr = [];
            for (let i = 0; i < 50; i++) {
                arr.push({ Key: key1 });
            }
            for (let i = 100; i < 200; i++) {
                arr.push({ Key: key1, VersionId: put_res[i].VersionId });
            }

            const delete_res = await account_with_access.deleteObjects({
                    Bucket: delete_multi_object_test_bucket, Delete: { Objects: arr } }).promise();
            assert.equal(delete_res.Deleted.length, 150);
            for (let i = 0; i < 50; i++) {
                assert.notEqual(delete_res.Deleted[i].DeleteMarkerVersionId, undefined);
                assert.equal(delete_res.Deleted[i].DeleteMarker, true);
            }
            for (let i = 50; i < 150; i++) {
                if (i % 2 === 1) assert.equal(delete_res.Deleted[i].DeleteMarker, true);
                if (i % 2 === 0) assert.equal(delete_res.Deleted[i].DeleteMarker, undefined);
            }
            const versions_dir = path.join(full_multi_delete_path, '.versions');
            let versions = await nb_native().fs.readdir(DEFAULT_FS_CONFIG, versions_dir);

            assert.equal(versions.length, 250);
            await fs_utils.file_must_not_exist(path.join(full_multi_delete_path, key1));
            await delete_object_versions(full_multi_delete_path, key1);
        });


        mocha.it('delete multiple objects - delete regular versions & delete markers & latest & keys- ', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(60000);
            let versions_type_arr = [];
            for (let i = 0; i < 300; i++) {
                 versions_type_arr.push(i % 2 === 1 ? 'regular' : 'delete_marker');
            }
            let put_res = await upload_object_versions(account_with_access, delete_multi_object_test_bucket, key1, versions_type_arr);
            let arr = [];
            for (let i = 200; i < 300; i++) {
                arr.push({ Key: key1, VersionId: put_res[i].VersionId });
            }

            for (let i = 0; i < 50; i++) {
                arr.push({ Key: key1 });
            }
            const delete_res = await account_with_access.deleteObjects({
                    Bucket: delete_multi_object_test_bucket, Delete: { Objects: arr } }).promise();
            assert.equal(delete_res.Deleted.length, 150);
            for (let i = 0; i < 100; i++) {
                if (i % 2 === 1) assert.equal(delete_res.Deleted[i].DeleteMarker, undefined);
                if (i % 2 === 0) assert.equal(delete_res.Deleted[i].DeleteMarker, true);
            }
            for (let i = 100; i < 150; i++) {
                assert.notEqual(delete_res.Deleted[i].DeleteMarkerVersionId, undefined);
                assert.equal(delete_res.Deleted[i].DeleteMarker, true);
            }
            const versions_dir = path.join(full_multi_delete_path, '.versions');
            let versions = await nb_native().fs.readdir(DEFAULT_FS_CONFIG, versions_dir);

            assert.equal(versions.length, 250);
            await fs_utils.file_must_not_exist(path.join(full_multi_delete_path, key1));
            await delete_object_versions(full_multi_delete_path, key1);
        });
    });
});



/////// UTILS ///////

async function delete_object_versions(bucket_path, key) {
    // delete past versions
    const versions_dir = path.join(bucket_path, '.versions');
    try {
        let versions = await nb_native().fs.readdir(DEFAULT_FS_CONFIG, versions_dir);

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

async function upload_object_versions(s3_client, bucket, key, object_types_arr) {
    let res = [];
    const versioning_status = await s3_client.getBucketVersioning({ Bucket: bucket }).promise();
    for (const obj_type of object_types_arr) {
        if (obj_type === 'regular' || obj_type === 'null') {
            if (!versioning_status.Status && obj_type === 'regular') {
                await s3_client.putBucketVersioning({ Bucket: bucket, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } }).promise();
            }
            const random_body = (Math.random() + 1).toString(36).substring(7);
            const put_res = await s3_client.putObject({ Bucket: bucket, Key: key, Body: random_body }).promise();
            res.push(put_res);
        } else if (obj_type === 'delete_marker') {
            if (!versioning_status.Status) {
                await s3_client.putBucketVersioning({ Bucket: bucket, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } }).promise();
            }
            const delete_res = await s3_client.deleteObject({ Bucket: bucket, Key: key }).promise();
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
    const get_res = await s3.getObject({ Bucket: bucket_name, Key: key }).promise();
    assert.equal(get_res.Body.toString(), expected_body);
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

async function compare_version_ids(full_path, key, put_result_version_id, prev_version_id) {
    const key_path = path.join(full_path, key);
    const stat = await nb_native().fs.stat(DEFAULT_FS_CONFIG, key_path);
    const new_version_id = get_version_id_by_stat(stat);
    const xattr_version_id = get_version_id_by_xattr(stat);
    assert.equal(new_version_id, put_result_version_id);
    assert.equal(new_version_id, xattr_version_id);
    if (prev_version_id) {
        const xattr_prev_version_id = get_version_id_by_xattr(stat, true);
        assert.notEqual(new_version_id, prev_version_id);
        assert.equal(xattr_prev_version_id, prev_version_id);
    }
    return true;
}
function get_version_id_by_stat(stat) {
    return 'mtime-' + stat.mtimeNsBigint.toString(36) + '-ino-' + stat.ino.toString(36);
}

function get_version_id_by_xattr(stat, prev) {
    if (prev) return stat && stat.xattr[XATTR_PREV_VERSION_ID];
    return (stat && stat.xattr[XATTR_VERSION_ID]) || 'null';
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
    }).promise();
}

function generate_s3_client(access_key, secret_key) {
    return new AWS.S3({
        s3ForcePathStyle: true,
        signatureVersion: 'v4',
        computeChecksums: true,
        s3DisableBodySigning: false,
        region: 'us-east-1',
        httpOptions: { agent: new http.Agent({ keepAlive: false }) },
        accessKeyId: access_key,
        secretAccessKey: secret_key,
        endpoint: coretest.get_http_address()
    });
}

async function generate_nsfs_account(options = {}) {
    const { uid, gid, new_buckets_path, nsfs_only, admin, default_resource } = options;
    if (admin) {
        const account = await rpc_client.account.read_account({
            email: EMAIL,
        });
        return {
            access_key: account.access_keys[0].access_key.unwrap(),
            secret_key: account.access_keys[0].secret_key.unwrap()
        };
    }
    const random_name = (Math.random() + 1).toString(36).substring(7);
    const nsfs_account_config = {
        uid: uid || process.getuid(),
        gid: gid || process.getgid(),
        new_buckets_path: new_buckets_path || '/',
        nsfs_only: nsfs_only || false
    };

    let account = await rpc_client.account.create_account({
        has_login: false,
        s3_access: true,
        email: `${random_name}@noobaa.com`,
        name: random_name,
        nsfs_account_config,
        default_resource
    });
    return {
        access_key: account.access_keys[0].access_key.unwrap(),
        secret_key: account.access_keys[0].secret_key.unwrap(),
        email: `${random_name}@noobaa.com`
    };
}

exports.generate_nsfs_account = generate_nsfs_account;
exports.generate_s3_client = generate_s3_client;
