/* Copyright (C) 2020 NooBaa */
/*eslint max-lines-per-function: ["error", 600]*/
'use strict';


const mocha = require('mocha');
const AWS = require('aws-sdk');
const http = require('http');
const assert = require('assert');
const coretest = require('./coretest');
const { rpc_client, EMAIL } = coretest;
const fs_utils = require('../../util/fs_utils');
const path = require('path');
const nb_native = require('../../util/nb_native');
coretest.setup({ pools_to_create: [coretest.POOL_LIST[1]] });

const MAC_PLATFORM = 'darwin';
const XATTR_VERSION_ID = 'user.version_id';
const XATTR_PREV_VERSION_ID = 'user.prev_version_id';

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
                    CopySource: `${bucket_name}/${key1}?versionId=123`}).promise();
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
    });
});



/////// UTILS ///////

async function version_file_exists(full_path, key, dir, version_id) {
    const version_path = path.join(full_path, dir, '.versions', key + '_' + version_id);
    await fs_utils.file_must_exist(version_path);
    return true;
}

async function get_obj_and_compare_data(s3, bucket_name, key, expected_body) {
    const get_res = await s3.getObject({ Bucket: bucket_name, Key: key }).promise();
    assert.equal(get_res.Body.toString(), expected_body);
    return true;
}

async function stat_and_get_version_id(full_path, key) {
    const key_path = path.join(full_path, key);
    const stat = await nb_native().fs.stat(DEFAULT_FS_CONFIG, key_path);
    return get_version_id_by_xattr(stat);
}

async function compare_version_ids(full_path, key, put_result_version_id, prev_version_id) {
    const key_path = path.join(full_path, key);
    const stat = await nb_native().fs.stat(DEFAULT_FS_CONFIG, key_path);
    console.log('STAT: ', stat);
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
    const { uid, gid, new_buckets_path, nsfs_only, admin } = options;
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
        nsfs_account_config
    });
    return {
        access_key: account.access_keys[0].access_key.unwrap(),
        secret_key: account.access_keys[0].secret_key.unwrap(),
        email: `${random_name}@noobaa.com`
    };
}

exports.generate_nsfs_account = generate_nsfs_account;
exports.generate_s3_client = generate_s3_client;
