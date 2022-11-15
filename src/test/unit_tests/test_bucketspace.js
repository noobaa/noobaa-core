/* Copyright (C) 2020 NooBaa */
/*eslint max-lines-per-function: ["error", 600]*/
'use strict';


const mocha = require('mocha');
const util = require('util');
const AWS = require('aws-sdk');
const http = require('http');
const assert = require('assert');
const coretest = require('./coretest');
const { rpc_client, EMAIL, PASSWORD, SYSTEM } = coretest;
const fs_utils = require('../../util/fs_utils');
coretest.setup({ pools_to_create: [coretest.POOL_LIST[0]] });
const path = require('path');
const _ = require('lodash');
const P = require('../../util/promise');
const fs = require('fs');
const test_utils = require('../system_tests/test_utils');

const inspect = (x, max_arr = 5) => util.inspect(x, { colors: true, depth: null, maxArrayLength: max_arr });

let new_account_params = {
    has_login: false,
    s3_access: true,
};

// currently will pass only when running locally
mocha.describe('bucket operations - namespace_fs', function() {
    const nsr = 'nsr';
    const bucket_name = 'src-bucket';
    const tmp_fs_root = '/tmp/test_bucket_namespace_fs';
    const bucket_path = '/src';
    const other_bucket_path = '/src1';
    let account_wrong_uid;
    let account_correct_uid;
    let s3_owner;
    let s3_wrong_uid;
    let s3_correct_uid;
    let s3_correct_uid_default_nsr;

    let s3_creds = {
        s3ForcePathStyle: true,
        signatureVersion: 'v4',
        computeChecksums: true,
        s3DisableBodySigning: false,
        region: 'us-east-1',
        httpOptions: { agent: new http.Agent({ keepAlive: false }) },
    };
    mocha.before(function() {
        if (process.getgid() !== 0 || process.getuid() !== 0) {
            coretest.log('No Root permissions found in env. Skipping test');
            this.skip(); // eslint-disable-line no-invalid-this
        }
    });
    mocha.before(async () => fs_utils.create_fresh_path(tmp_fs_root + '/new_s3_buckets_dir', 0o770));
    mocha.before(async () => fs_utils.create_fresh_path(tmp_fs_root + bucket_path, 0o770));
    mocha.before(async () => fs_utils.create_fresh_path(tmp_fs_root + other_bucket_path, 0o770));
    mocha.after(async () => fs_utils.folder_delete(tmp_fs_root));
    mocha.it('read namespace resource before creation', async function() {
        try {
            await rpc_client.pool.read_namespace_resource({ name: 'dummy' });
        } catch (err) {
            assert.ok(err.rpc_code === 'NO_SUCH_NAMESPACE_RESOURCE');
        }
    });
    mocha.it('export dir as bucket', async function() {
        await rpc_client.pool.create_namespace_resource({
            name: nsr,
            nsfs_config: {
                fs_root_path: tmp_fs_root,
                fs_backend: 'GPFS'
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
    });
    mocha.it('export same dir as bucket - should fail', async function() {
        const obj_nsr = { resource: nsr, path: bucket_path };
        try {
            await rpc_client.bucket.create_bucket({
                name: bucket_name + '-should-fail',
                namespace: {
                    read_resources: [obj_nsr],
                    write_resource: obj_nsr
                }
            });
            assert.fail(`created 2 buckets on the same dir:`);
        } catch (err) {
            assert.ok(err.rpc_code === 'BUCKET_ALREADY_EXISTS');
        }
    });
    mocha.it('export other dir as bucket - and update bucket path to original bucket path', async function() {
        const obj_nsr = { resource: nsr, path: bucket_path };
        const other_obj_nsr = { resource: nsr, path: other_bucket_path };
        await rpc_client.bucket.create_bucket({
            name: bucket_name + '-other1',
            namespace: {
                read_resources: [other_obj_nsr],
                write_resource: other_obj_nsr
            }
        });
        try {
            await rpc_client.bucket.update_bucket({
                name: bucket_name + '-other1',
                namespace: {
                    read_resources: [obj_nsr],
                    write_resource: obj_nsr
                }
            });
            assert.fail(`can not update nsfs bucket for using path of existing exported bucket:`);
        } catch (err) {
            assert.ok(err.rpc_code === 'BUCKET_ALREADY_EXISTS');
        }
    });

    mocha.it('Init S3 owner connection', async function() {
        const admin_keys = (await rpc_client.account.read_account({ email: EMAIL, })).access_keys;
        s3_creds.accessKeyId = admin_keys[0].access_key.unwrap();
        s3_creds.secretAccessKey = admin_keys[0].secret_key.unwrap();
        s3_creds.endpoint = coretest.get_http_address();
        s3_owner = new AWS.S3(s3_creds);
    });

    mocha.it('list buckets without uid, gid', async function() {
        // Give s3_owner access to the required buckets
        await Promise.all(
            ["first.bucket"]
            .map(bucket => test_utils.generate_s3_policy(EMAIL, bucket, ["s3:*"]))
            .map(generated =>
                rpc_client.bucket.put_bucket_policy({
                    name: generated.params.bucket,
                    policy: generated.policy,
                })
            )
        );
        const res = await s3_owner.listBuckets().promise();
        console.log(inspect(res));
        const list_ok = bucket_in_list(['first.bucket'], [bucket_name], res.Buckets);
        assert.ok(list_ok);
    });
    mocha.it('create account 1 with uid, gid - wrong uid', async function() {
        account_wrong_uid = await rpc_client.account.create_account({
            ...new_account_params,
            email: 'account_wrong_uid0@noobaa.com',
            name: 'account_wrong_uid0',
            nsfs_account_config: {
                uid: 26041992,
                gid: 26041992,
                new_buckets_path: '/',
                nsfs_only: false
            }
        });
        console.log(inspect(account_wrong_uid));
        s3_creds.accessKeyId = account_wrong_uid.access_keys[0].access_key.unwrap();
        s3_creds.secretAccessKey = account_wrong_uid.access_keys[0].secret_key.unwrap();
        s3_creds.endpoint = coretest.get_http_address();
        s3_wrong_uid = new AWS.S3(s3_creds);
    });
    mocha.it('list buckets with wrong uid, gid', async function() {
        // Give s3_wrong_uid access to the required buckets
        await Promise.all(
            ["first.bucket"]
            .map(bucket => test_utils.generate_s3_policy('account_wrong_uid0@noobaa.com', bucket, ["s3:*"]))
            .map(generated =>
                rpc_client.bucket.put_bucket_policy({
                    name: generated.params.bucket,
                    policy: generated.policy,
                })
            )
        );
        const res = await s3_wrong_uid.listBuckets().promise();
        console.log(inspect(res));
        const list_ok = bucket_in_list(['first.bucket'], [bucket_name], res.Buckets);
        assert.ok(list_ok);
    });
    mocha.it('update account', async function() {
        const email = 'account_wrong_uid0@noobaa.com';
        const account = await rpc_client.account.read_account({ email: email });
        const default_resource = account.default_resource;
        const arr = [{ nsfs_account_config: { uid: 26041993 }, default_resource, should_fail: false },
            { nsfs_account_config: { new_buckets_path: 'dummy_dir1/' }, default_resource, should_fail: false },
            { nsfs_account_config: {}, default_resource, should_fail: true },
            { nsfs_account_config: { uid: 26041992 }, default_resource, should_fail: false }
        ];
        await P.all(_.map(arr, async item =>
            update_account_nsfs_config(email, item.default_resource, item.nsfs_account_config, item.should_fail)));
    });
    mocha.it('list namespace resources after creation', async function() {
        await rpc_client.create_auth_token({
            email: EMAIL,
            password: PASSWORD,
            system: SYSTEM,
        });
        const res = await rpc_client.pool.read_namespace_resource({ name: nsr });
        assert.ok(res.name === nsr && res.fs_root_path === tmp_fs_root);
    });
    mocha.it('create account 2 uid, gid', async function() {
        account_correct_uid = await rpc_client.account.create_account({
            ...new_account_params,
            email: 'account_correct_uid@noobaa.com',
            name: 'account_correct_uid',
            nsfs_account_config: {
                uid: process.getuid(),
                gid: process.getgid(),
                new_buckets_path: '/',
                nsfs_only: false
            }
        });
        console.log(inspect(account_correct_uid));
        s3_creds.accessKeyId = account_correct_uid.access_keys[0].access_key.unwrap();
        s3_creds.secretAccessKey = account_correct_uid.access_keys[0].secret_key.unwrap();
        s3_creds.endpoint = coretest.get_http_address();
        s3_correct_uid = new AWS.S3(s3_creds);
    });
    // s3 workflow 
    mocha.it('create account with namespace resource as default pool but without nsfs_account_config', async function() {
        try {
            const res = await rpc_client.account.create_account({
                ...new_account_params,
                email: 'account_s3_correct_uid1@noobaa.com',
                name: 'account_s3_correct_uid1',
                s3_access: true,
                default_resource: nsr
            });
            assert.fail(inspect(res));
        } catch (err) {
            assert.strictEqual(err.message, 'Invalid account configuration - must specify nsfs_account_config when default resource is a namespace resource');
        }
    });
    mocha.it('create s3 bucket with correct uid and gid - existing directory', async function() {
        const account_s3_correct_uid1 = await rpc_client.account.create_account({
            ...new_account_params,
            email: 'account_s3_correct_uid1@noobaa.com',
            name: 'account_s3_correct_uid1',
            s3_access: true,
            default_resource: nsr,
            nsfs_account_config: {
                uid: process.getuid(),
                gid: process.getgid(),
                new_buckets_path: '/',
                nsfs_only: false
            }
        });
        s3_creds.accessKeyId = account_s3_correct_uid1.access_keys[0].access_key.unwrap();
        s3_creds.secretAccessKey = account_s3_correct_uid1.access_keys[0].secret_key.unwrap();
        s3_creds.endpoint = coretest.get_http_address();
        s3_correct_uid_default_nsr = new AWS.S3(s3_creds);
        const buck1 = 'buck1';
        fs_utils.create_fresh_path(tmp_fs_root + '/buck1');
        try {
            const res = await s3_correct_uid_default_nsr.createBucket({
                Bucket: buck1,
            }).promise();
            assert.fail(inspect(res));
        } catch (err) {
            assert.strictEqual(err.code, 'BucketAlreadyExists');
        }
        await fs_utils.file_must_exist(path.join(tmp_fs_root, '/buck1'));
    });
    mocha.it('create s3 bucket with correct uid and gid', async function() {
        const account_s3_correct_uid = await rpc_client.account.create_account({
            ...new_account_params,
            email: 'account_s3_correct_uid@noobaa.com',
            name: 'account_s3_correct_uid',
            s3_access: true,
            default_resource: nsr,
            nsfs_account_config: {
                uid: process.getuid(),
                gid: process.getgid(),
                new_buckets_path: '/new_s3_buckets_dir',
                nsfs_only: false
            }
        });
        s3_creds.accessKeyId = account_s3_correct_uid.access_keys[0].access_key.unwrap();
        s3_creds.secretAccessKey = account_s3_correct_uid.access_keys[0].secret_key.unwrap();
        s3_creds.endpoint = coretest.get_http_address();
        s3_correct_uid_default_nsr = new AWS.S3(s3_creds);
        const res = await s3_correct_uid_default_nsr.createBucket({ Bucket: bucket_name + '-s3', }).promise();
        console.log(inspect(res));
        await fs_utils.file_must_exist(path.join(tmp_fs_root, '/new_s3_buckets_dir', bucket_name + '-s3'));
    });
    mocha.it('create s3 bucket with incorrect uid and gid', async function() {
        const incorrect_params = {
            ...new_account_params,
            email: 'account_s3_incorrect_uid@noobaa.com',
            name: 'account_s3_incorrect_uid',
            s3_access: true,
            default_resource: nsr,
            nsfs_account_config: {
                uid: 26041992,
                gid: 26041992,
                new_buckets_path: '/new_s3_buckets_dir',
                nsfs_only: false
            }
        };
        const account_s3_incorrect_uid = await rpc_client.account.create_account(incorrect_params);
        s3_creds.accessKeyId = account_s3_incorrect_uid.access_keys[0].access_key.unwrap();
        s3_creds.secretAccessKey = account_s3_incorrect_uid.access_keys[0].secret_key.unwrap();
        s3_creds.endpoint = coretest.get_http_address();
        const s3_incorrect_uid_default_nsr = new AWS.S3(s3_creds);
        try {
            await s3_incorrect_uid_default_nsr.createBucket({
                Bucket: bucket_name + '-s3-should-fail',
            }).promise();
            assert.fail('unpreviliged account could create bucket on nsfs: ');
        } catch (err) {
            assert.ok(err + '- failed as it should');
            assert.strictEqual(err.code, 'AccessDenied');
        }
        await fs_utils.file_must_not_exist(path.join(tmp_fs_root, '/new_s3_buckets_dir', bucket_name + '-s3-should-fail'));
    });

    mocha.it('list buckets with uid, gid', async function() {
        // Give s3_correct_uid access to the required buckets
        await Promise.all(
            [bucket_name]
            .map(bucket => test_utils.generate_s3_policy('account_correct_uid@noobaa.com', bucket, ["s3:*"]))
            .map(generated =>
                rpc_client.bucket.put_bucket_policy({
                    name: generated.params.bucket,
                    policy: generated.policy,
                })
            )
        );
        const res = await s3_correct_uid.listBuckets().promise();
        console.log(inspect(res));
        const list_ok = bucket_in_list([bucket_name], [], res.Buckets);
        assert.ok(list_ok);
    });
    mocha.it('put object with out uid gid', async function() {
        try {
            const res = await s3_owner.putObject({ Bucket: bucket_name + '-s3', Key: 'ob1.txt', Body: 'AAAABBBBBCCCCCCDDDDD' }).promise();
            console.log(inspect(res));
            assert.fail('unpreviliged account could put object on nsfs bucket');
        } catch (err) {
            assert.strictEqual(err.code, 'AccessDenied');
        }
    });
    mocha.it('upload object with wrong uid gid', async function() {
        try {
            const res = await s3_wrong_uid.upload({ Bucket: bucket_name + '-s3', Key: 'ob1.txt', Body: 'AAAABBBBBCCCCCCDDDDD' }).promise();
            console.log(inspect(res));
            assert.fail('unpreviliged account could upload object on nsfs bucket');
        } catch (err) {
            assert.strictEqual(err.code, 'AccessDenied');
        }
    });
    mocha.it('list parts with wrong uid gid', async function() {
        // eslint-disable-next-line no-invalid-this
        this.timeout(600000);

        // Give s3_correct_uid access to the required buckets
        await Promise.all(
            [bucket_name]
            .map(bucket => test_utils.generate_s3_policy('account_correct_uid@noobaa.com', bucket, ["s3:*"]))
            .map(generated =>
                rpc_client.bucket.put_bucket_policy({
                    name: generated.params.bucket,
                    policy: generated.policy,
                })
            )
        );

        const res1 = await s3_correct_uid.createMultipartUpload({
            Bucket: bucket_name,
            Key: 'ob1.txt'
        }).promise();
        await s3_correct_uid.uploadPart({
            Bucket: bucket_name,
            Key: 'ob1.txt',
            UploadId: res1.UploadId,
            PartNumber: 1,
            Body: 'AAAABBBBBCCCCCCDDDDD',
        }).promise();
        try {
            // list_multiparts
            const res = await s3_wrong_uid.listParts({ Bucket: bucket_name + '-s3', Key: 'ob1.txt', UploadId: res1.UploadId }).promise();
            console.log(inspect(res));
            assert.fail('unpreviliged account could not list object parts on nsfs bucket');
        } catch (err) {
            assert.strictEqual(err.code, 'AccessDenied');
        }
    });
    mocha.it('put object with correct uid gid', async function() {
        // Give s3_correct_uid access to the required buckets
        await Promise.all(
            [bucket_name + '-s3']
            .map(bucket => test_utils.generate_s3_policy('account_correct_uid@noobaa.com', bucket, ["s3:*"]))
            .map(generated =>
                rpc_client.bucket.put_bucket_policy({
                    name: generated.params.bucket,
                    policy: generated.policy,
                })
            )
        );
        const res = await s3_correct_uid.putObject({ Bucket: bucket_name + '-s3', Key: 'ob1.txt', Body: 'AAAABBBBBCCCCCCDDDDD' }).promise();
        assert.ok(res && res.ETag);
    });
    mocha.it('delete bucket without uid, gid - bucket is not empty', async function() {
        try {
            const res = await s3_owner.deleteBucket({ Bucket: bucket_name + '-s3' }).promise();
            console.log(inspect(res));
            assert.fail('unpreviliged account could delete bucket on nsfs: ');
        } catch (err) {
            assert.strictEqual(err.code, 'AccessDenied');
        }
    });
    mocha.it('copy objects with wrong uid gid', async function() {
        try {
            const res = await s3_wrong_uid.copyObject({ Bucket: bucket_name + '-s3', Key: 'ob2.txt', CopySource: bucket_name + '-s3/ob1.txt' }).promise();
            console.log(inspect(res));
            assert.fail('unpreviliged account could copy objects on nsfs bucket');
        } catch (err) {
            assert.strictEqual(err.code, 'AccessDenied');
        }
    });
    mocha.it('list objects with wrong uid gid', async function() {
        try {
            const res = await s3_wrong_uid.listObjects({ Bucket: bucket_name + '-s3' }).promise();
            console.log(inspect(res));
            assert.fail('unpreviliged account could list objects on nsfs bucket');
        } catch (err) {
            assert.strictEqual(err.code, 'AccessDenied');
        }
    });
    mocha.it('delete bucket with uid, gid - bucket is not empty', async function() {
        try {
            const res = await s3_correct_uid_default_nsr.deleteBucket({ Bucket: bucket_name + '-s3' }).promise();
            console.log(inspect(res));
            assert.fail('should fail deletion od bucket, bucket is not empty');
        } catch (err) {
            assert.strictEqual(err.code, 'BucketNotEmpty');
        }
    });
    mocha.it('delete object without uid, gid - bucket is empty', async function() {
        try {
            const res = await s3_owner.deleteObject({ Bucket: bucket_name + '-s3', Key: 'ob1.txt' }).promise();
            console.log(inspect(res));
            assert.fail('unpreviliged account could delete object on nsfs bucket ');
        } catch (err) {
            assert.strictEqual(err.code, 'AccessDenied');
        }
    });
    mocha.it('delete object with uid, gid', async function() {
        const res = await s3_correct_uid_default_nsr.deleteObject({ Bucket: bucket_name + '-s3', Key: 'ob1.txt' }).promise();
        console.log(inspect(res));
    });
    mocha.it('delete bucket without uid, gid - bucket is empty', async function() {
        try {
            const res = await s3_owner.deleteBucket({ Bucket: bucket_name + '-s3' }).promise();
            console.log(inspect(res));
            assert.fail('unpreviliged account could delete bucket on nsfs: ');
        } catch (err) {
            assert.strictEqual(err.code, 'AccessDenied');
        }
    });
    mocha.it('delete bucket with uid, gid - bucket is empty', async function() {
        const res = await s3_correct_uid_default_nsr.deleteBucket({ Bucket: bucket_name + '-s3' }).promise();
        console.log(inspect(res));
    });
    mocha.it('list buckets after deletion', async function() {
        const res = await s3_correct_uid.listBuckets().promise();
        console.log(inspect(res));
        const list_ok = bucket_in_list([], [bucket_name + '-s3'], res.Buckets);
        assert.ok(list_ok);
    });
    mocha.it('check dir doesnt exist after deletion', async function() {
        await fs_utils.file_must_not_exist(path.join(tmp_fs_root, '/new_s3_buckets_dir', bucket_name + '-s3'));
        await fs_utils.file_must_exist(path.join(tmp_fs_root, '/new_s3_buckets_dir'));
    });
    mocha.it('delete account by uid, gid', async function() {
        let read_account_resp1 = await rpc_client.account.read_account({ email: 'account_wrong_uid0@noobaa.com' });
        assert.ok(read_account_resp1);
        // create another account with the same uid gid
        let account_wrong_uid1 = await rpc_client.account.create_account({
            ...new_account_params,
            email: 'account_wrong_uid1@noobaa.com',
            name: 'account_wrong_uid1',
            nsfs_account_config: {
                uid: 26041992,
                gid: 26041992,
                new_buckets_path: '/',
                nsfs_only: false
            }
        });
        console.log(inspect(account_wrong_uid1));
        assert.ok(account_wrong_uid1);
        await rpc_client.account.delete_account_by_property({
            nsfs_account_config: {
                uid: 26041992,
                gid: 26041992,
            }
        });
        // check that both accounts deleted
        for (let i = 0; i < 2; i++) {
            try {
                let deleted_account_exist = await rpc_client.account.read_account({ email: `account_wrong_uid${i}@noobaa.com` });
                assert.fail(`found account: ${deleted_account_exist} - account should be deleted`);
            } catch (err) {
                assert.ok(err.rpc_code === 'NO_SUCH_ACCOUNT');
            }
        }
        let list_account_resp2 = (await rpc_client.account.list_accounts({})).accounts;
        assert.ok(list_account_resp2.length > 0);
    });
    mocha.it('delete account by uid, gid - no such account', async function() {
        let list_account_resp1 = (await rpc_client.account.list_accounts({})).accounts;
        assert.ok(list_account_resp1.length > 0);
        try {
            await rpc_client.account.delete_account_by_property({ nsfs_account_config: { uid: 26041993, gid: 26041993 } });
            assert.fail(`delete account succeeded for none existing account`);
        } catch (err) {
            assert.ok(err.rpc_code === 'NO_SUCH_ACCOUNT');
        }
    });
    mocha.it('delete bucket with uid, gid - bucket is empty', async function() {
        // Give s3_correct_uid_default_nsr access to the required buckets
        await Promise.all(
            [bucket_name + '-other1', bucket_name]
            .map(bucket => test_utils.generate_s3_policy('account_s3_correct_uid@noobaa.com', bucket, ["s3:*"]))
            .map(generated =>
                rpc_client.bucket.put_bucket_policy({
                    name: generated.params.bucket,
                    policy: generated.policy,
                })
            )
        );
        await s3_correct_uid_default_nsr.deleteBucket({ Bucket: bucket_name }).promise();
        await s3_correct_uid_default_nsr.deleteBucket({ Bucket: bucket_name + '-other1' }).promise();
    });
});

function create_random_body() {
    return Math.random().toString(36).slice(50);
}

function bucket_in_list(exist_buckets, not_exist_buckets, s3_buckets_list_response) {
    const bucket_names = s3_buckets_list_response.map(bucket => bucket.Name);
    let exist_checker = exist_buckets.every(v => bucket_names.includes(v));
    let doesnt_exist_checker = not_exist_buckets.every(v => !bucket_names.includes(v));
    return exist_checker && doesnt_exist_checker;
}

function object_in_list(res, key) {
    const ans = res.Contents.find(obj => obj.Key === key);
    console.log('object_in_list:', object_in_list);
    return ans;
}

async function update_account_nsfs_config(email, default_resource, new_nsfs_account_config, should_fail) {
    try {
        await rpc_client.account.update_account_s3_access({
            email,
            s3_access: true,
            default_resource,
            nsfs_account_config: new_nsfs_account_config
        });
        if (should_fail) {
            assert.fail(`update_account_nsfs_config - action should fail but it didn't`);
        }
    } catch (err) {
        if (should_fail) {
            assert.ok(err.rpc_code === 'FORBIDDEN');
            return;
        }
        assert.fail(`update_account_nsfs_config failed ${err}, ${err.stack}`);
    }
}


mocha.describe('list objects - namespace_fs', function() {
    const nsr = 'nsr1-list';
    const bucket_name = 'bucket-to-list1';
    const tmp_fs_root = '/tmp/test_bucket_namespace_fs1';
    const bucket_path = '/bucket';
    let s3_uid5;
    let s3_uid26041993;
    let s3_uid6;

    let s3_creds = {
        s3ForcePathStyle: true,
        signatureVersion: 'v4',
        computeChecksums: true,
        s3DisableBodySigning: false,
        region: 'us-east-1',
        httpOptions: { agent: new http.Agent({ keepAlive: false }) },
    };

    mocha.before(function() {
        if (process.getgid() !== 0 || process.getuid() !== 0) {
            coretest.log('No Root permissions found in env. Skipping test');
            this.skip(); // eslint-disable-line no-invalid-this
        }
    });
    const full_path = tmp_fs_root + bucket_path;
    mocha.before(async () => fs_utils.create_fresh_path(tmp_fs_root, 0o777));
    mocha.before(async () => fs_utils.create_fresh_path(full_path, 0o770));
    mocha.after(async () => fs_utils.folder_delete(tmp_fs_root));

    mocha.it('export dir as bucket', async function() {
        await rpc_client.pool.create_namespace_resource({
            name: nsr,
            nsfs_config: {
                fs_root_path: tmp_fs_root,
                fs_backend: 'GPFS'
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
    });

    mocha.it('create account uid, gid 5', async function() {
        const account = await rpc_client.account.create_account({
            ...new_account_params,
            email: 'account_wrong_uid_list@noobaa.com',
            name: 'account_wrong_uid_list',
            nsfs_account_config: {
                uid: 5,
                gid: 5,
                new_buckets_path: '/',
                nsfs_only: false
            }
        });
        console.log(inspect(account));
        s3_creds.accessKeyId = account.access_keys[0].access_key.unwrap();
        s3_creds.secretAccessKey = account.access_keys[0].secret_key.unwrap();
        s3_creds.endpoint = coretest.get_http_address();
        s3_uid5 = new AWS.S3(s3_creds);
    });

    mocha.it('create account with uid, gid 26041993', async function() {
        const account = await rpc_client.account.create_account({
            ...new_account_params,
            email: `account_correct_uid_list@noobaa.com`,
            name: 'account_correct_uid_list',
            nsfs_account_config: {
                uid: 26041993,
                gid: 26041993,
                new_buckets_path: '/',
                nsfs_only: false
            }
        });
        console.log(inspect(account));
        s3_creds.accessKeyId = account.access_keys[0].access_key.unwrap();
        s3_creds.secretAccessKey = account.access_keys[0].secret_key.unwrap();
        s3_creds.endpoint = coretest.get_http_address();
        s3_uid26041993 = new AWS.S3(s3_creds);
    });

    mocha.it('create account with uid, gid 0', async function() {
        const account = await rpc_client.account.create_account({
            ...new_account_params,
            email: 'account_correct_uid_list1@noobaa.com',
            name: 'account_correct_uid_list1',
            nsfs_account_config: {
                uid: 6,
                gid: 6,
                new_buckets_path: '/',
                nsfs_only: false
            }
        });
        console.log(inspect(account));
        s3_creds.accessKeyId = account.access_keys[0].access_key.unwrap();
        s3_creds.secretAccessKey = account.access_keys[0].secret_key.unwrap();
        s3_creds.endpoint = coretest.get_http_address();
        s3_uid6 = new AWS.S3(s3_creds);
    });
    mocha.it('put object 1 with uid gid - 5 - should fail', async function() {
        try {
            await s3_uid5.putObject({ Bucket: bucket_name, Key: 'only5_1', Body: 'AAAABBBBBCCCCCCDDDDD' }).promise();
            assert.fail(`put object succeeded for account without permissions`);
        } catch (err) {
            assert.ok(err.code === 'AccessDenied');
        }
    });
    mocha.it('list objects - no access to bucket - with uid gid - 26041993 - should fail', async function() {
        try {
            await s3_uid26041993.listObjects({ Bucket: bucket_name }).promise();
            assert.fail(`list objects succeeded for account without permissions`);
        } catch (err) {
            assert.ok(err.code === 'AccessDenied');
        }
    });
    mocha.it('change mode of /bucket/ to 0o777: ', async function() {
        await fs.promises.chmod(full_path, 0o777);
        const stat1 = await fs.promises.stat(full_path);
        assert.ok(stat1.mode === 16895);
    });

    mocha.it('put object 1 with uid gid - 5', async function() {
        await Promise.all(
            [bucket_name]
            .map(bucket => test_utils.generate_s3_policy('account_wrong_uid_list@noobaa.com', bucket, ["s3:*"]))
            .map(generated =>
                rpc_client.bucket.put_bucket_policy({
                    name: generated.params.bucket,
                    policy: generated.policy,
                })
            )
        );

        let res = await s3_uid5.putObject({ Bucket: bucket_name, Key: 'only5_1', Body: 'AAAABBBBBCCCCCCDDDDD' }).promise();
        console.log(inspect(res));
        res = await s3_uid5.putObject({ Bucket: bucket_name, Key: 'dir1/only5_2', Body: 'AAAABBBBBCCCCCCDDDDD' }).promise();
        console.log(inspect(res));
    });
    // changing /dir dir permissions - should skip it in list objects when no permissions
    // changing /only5_1 object permissions - should still see it in list objects
    mocha.it('change mode of /bucket/dir1 to 0o770: ', async function() {
        await fs.promises.chmod(full_path + '/dir1', 0o770);
        await fs.promises.chmod(full_path + '/only5_1', 0o770);
        const stat1 = await fs.promises.stat(full_path + '/dir1');
        const stat2 = await fs.promises.stat(full_path + '/only5_1');
        assert.ok(stat1.mode === 16888 && stat2.mode === 33272);
    });
    mocha.it('list object - with correct uid gid - 5', async function() {
        await Promise.all(
            [bucket_name]
            .map(bucket => test_utils.generate_s3_policy('account_wrong_uid_list@noobaa.com', bucket, ["s3:*"]))
            .map(generated =>
                rpc_client.bucket.put_bucket_policy({
                    name: generated.params.bucket,
                    policy: generated.policy,
                })
            )
        );

        const res = await s3_uid5.listObjects({ Bucket: bucket_name }).promise();
        assert.ok(object_in_list(res, 'dir1/only5_2') && object_in_list(res, 'only5_1'));
    });

    mocha.it('list object - with correct uid gid - 6', async function() {
        await Promise.all(
            [bucket_name]
            .map(bucket => test_utils.generate_s3_policy('account_correct_uid_list1@noobaa.com', bucket, ["s3:*"]))
            .map(generated =>
                rpc_client.bucket.put_bucket_policy({
                    name: generated.params.bucket,
                    policy: generated.policy,
                })
            )
        );

        const res = await s3_uid6.listObjects({ Bucket: bucket_name }).promise();
        assert.ok(!object_in_list(res, 'dir1/only5_2') && object_in_list(res, 'only5_1'));
    });

    mocha.it('list object - with correct uid gid - 26041993', async function() {
        await Promise.all(
            [bucket_name]
            .map(bucket => test_utils.generate_s3_policy('account_correct_uid_list@noobaa.com', bucket, ["s3:*"]))
            .map(generated =>
                rpc_client.bucket.put_bucket_policy({
                    name: generated.params.bucket,
                    policy: generated.policy,
                })
            )
        );

        const res = await s3_uid26041993.listObjects({ Bucket: bucket_name }).promise();
        assert.ok(!object_in_list(res, 'dir1/only5_2') && object_in_list(res, 'only5_1'));
    });
});


async function put_and_delete_objects(s3_account, bucket, key, body, should_fail) {
    try {
        await s3_account.putObject({
            Bucket: bucket,
            Key: key,
            Body: body
        }).promise();
        if (should_fail) {
            assert.fail(`put_object - action should fail but it didn't`);
        }
    } catch (err) {
        if (should_fail) {
            assert.ok(err.code === 'AccessDenied');
            return;
        }
        assert.fail(`put_object failed ${err}, ${err.stack}`);
    }

    await s3_account.deleteObject({
        Bucket: bucket,
        Key: key,
    }).promise();
}

mocha.describe('nsfs account configurations', function() {
    this.timeout(10000); // eslint-disable-line no-invalid-this
    const nsr1 = 'nsr1';
    const nsr2 = 'nsr2';
    const bucket_name1 = 'src-bucket1';
    const non_nsfs_bucket1 = 'first.bucket';
    const non_nsfs_bucket2 = 'second.bucket';
    const nsr2_connection = 'nsr2_connection';
    const tmp_fs_root1 = '/tmp/test_bucket_namespace_fs2';
    const bucket_path = '/nsfs_accounts';
    const accounts = {}; // {account_name : s3_account_object...}
    const regular_bucket_name = ['regular-bucket', 'regular-bucket1', 'regular-bucket2'];
    const regular_bucket_fail = ['regular-bucket-fail', 'regular-bucket-fail1', 'regular-bucket-fail2'];
    const data_bucket = 'data-bucket';
    let s3_creds = {
        s3ForcePathStyle: true,
        signatureVersion: 'v4',
        computeChecksums: true,
        s3DisableBodySigning: false,
        region: 'us-east-1',
        httpOptions: { agent: new http.Agent({ keepAlive: false }) },
    };
    mocha.before(function() {
        if (process.getgid() !== 0 || process.getuid() !== 0) {
            coretest.log('No Root permissions found in env. Skipping test');
            this.skip(); // eslint-disable-line no-invalid-this
        }
    });

    mocha.before(async () => fs_utils.create_fresh_path(tmp_fs_root1 + bucket_path, 0o770));
    mocha.after(async () => fs_utils.folder_delete(tmp_fs_root1));
    mocha.it('export dir as bucket', async function() {
        await rpc_client.pool.create_namespace_resource({
            name: nsr1,
            nsfs_config: {
                fs_root_path: tmp_fs_root1,
                fs_backend: 'GPFS'
            }
        });
        const obj_nsr = { resource: nsr1, path: bucket_path };
        await rpc_client.bucket.create_bucket({
            name: bucket_name1,
            namespace: {
                read_resources: [obj_nsr],
                write_resource: obj_nsr
            }
        });

        await rpc_client.bucket.create_bucket({
            name: data_bucket,
        });
    });

    mocha.it('create s3 compatible ns bucket', async function() {
        const admin_keys = (await rpc_client.account.read_account({ email: EMAIL, })).access_keys;
        await rpc_client.account.add_external_connection({
            name: nsr2_connection,
            endpoint: coretest.get_http_address(),
            endpoint_type: 'S3_COMPATIBLE',
            identity: admin_keys[0].access_key.unwrap(),
            secret: admin_keys[0].secret_key.unwrap()
        });
        await rpc_client.pool.create_namespace_resource({
            name: nsr2,
            connection: nsr2_connection,
            target_bucket: data_bucket
        });
        const obj_nsr = { resource: nsr2 };
        await rpc_client.bucket.create_bucket({
            name: non_nsfs_bucket2,
            namespace: {
                read_resources: [obj_nsr],
                write_resource: obj_nsr
            }
        });
    });

    mocha.it('create accounts', async function() {
        const names_and_default_resources = {
            account1: { default_resource: undefined, nsfs_only: false }, // undefined = default_pool
            account2: { default_resource: nsr2, nsfs_only: false }, // nsr2 = s3 compatible nsr
            account3: { default_resource: nsr1, nsfs_only: false }, // nsr1 = nsfs nsr
            account_nsfs_only1: { default_resource: undefined, nsfs_only: true },
            account_nsfs_only2: { default_resource: nsr2, nsfs_only: true },
            account_nsfs_only3: { default_resource: nsr1, nsfs_only: true }
        };
        for (const name of Object.keys(names_and_default_resources)) {
            let config = names_and_default_resources[name];
            let cur_account = await rpc_client.account.create_account({
                ...new_account_params,
                email: `${name}@noobaa.io`,
                name: name,
                default_resource: config.default_resource,
                nsfs_account_config: {
                    uid: process.getuid(),
                    gid: process.getgid(),
                    new_buckets_path: '/',
                    nsfs_only: config.nsfs_only
                }
            });
            s3_creds.accessKeyId = cur_account.access_keys[0].access_key.unwrap();
            s3_creds.secretAccessKey = cur_account.access_keys[0].secret_key.unwrap();
            s3_creds.endpoint = coretest.get_http_address();
            let cur_s3_account = new AWS.S3(s3_creds);
            accounts[name] = cur_s3_account;
        }
    });

    ///////////////////
    // create bucket //
    ///////////////////

    // default pool
    mocha.it('s3 put bucket allowed non nsfs buckets - default pool', async function() {
        const s3_account = accounts.account1;
        await s3_account.createBucket({ Bucket: regular_bucket_name[0] }).promise();
        // Give account access to the required buckets
        await Promise.all(
            [bucket_name1, non_nsfs_bucket1, non_nsfs_bucket2, regular_bucket_name[0]]
            .map(bucket => test_utils.generate_s3_policy('account1@noobaa.io', bucket, ["s3:*"]))
            .map(generated =>
                rpc_client.bucket.put_bucket_policy({
                    name: generated.params.bucket,
                    policy: generated.policy,
                })
            )
        );
        const res = await s3_account.listBuckets().promise();
        console.log(inspect(res));
        const list_ok = bucket_in_list([bucket_name1, non_nsfs_bucket1, non_nsfs_bucket2, regular_bucket_name[0]], [], res.Buckets);
        assert.ok(list_ok);
    });

    // default nsr - nsfs 
    mocha.it('s3 put bucket allowed non nsfs buckets - default nsr - nsfs', async function() {
        const s3_account = accounts.account3;
        await s3_account.createBucket({ Bucket: regular_bucket_name[1] }).promise();
        // Give account access to the required buckets
        await Promise.all(
            [bucket_name1, non_nsfs_bucket1, non_nsfs_bucket2, regular_bucket_name[1]]
            .map(bucket => test_utils.generate_s3_policy('account3@noobaa.io', bucket, ["s3:*"]))
            .map(generated =>
                rpc_client.bucket.put_bucket_policy({
                    name: generated.params.bucket,
                    policy: generated.policy,
                })
            )
        );
        const res = await s3_account.listBuckets().promise();
        console.log(inspect(res));
        const list_ok = bucket_in_list([bucket_name1, non_nsfs_bucket1, non_nsfs_bucket2, regular_bucket_name[1]], [], res.Buckets);
        assert.ok(list_ok);
    });

    mocha.it('s3 put bucket not allowed non nsfs buckets - default nsr - nsfs', async function() {
        const s3_account = accounts.account_nsfs_only3;
        await s3_account.createBucket({ Bucket: regular_bucket_name[2] }).promise();
        // Give account access to the required buckets
        await Promise.all(
            [bucket_name1, regular_bucket_name[2]]
            .map(bucket => test_utils.generate_s3_policy('account_nsfs_only3@noobaa.io', bucket, ["s3:*"]))
            .map(generated =>
                rpc_client.bucket.put_bucket_policy({
                    name: generated.params.bucket,
                    policy: generated.policy,
                })
            )
        );
        const res = await s3_account.listBuckets().promise();
        console.log(inspect(res));
        const list_ok = bucket_in_list([bucket_name1, regular_bucket_name[2]], [non_nsfs_bucket1, non_nsfs_bucket2], res.Buckets);
        assert.ok(list_ok);
    });

    mocha.it('s3 put bucket not allowed non nsfs buckets - default pool', async function() {
        try {
            const s3_account = accounts.account_nsfs_only1;
            await s3_account.createBucket({ Bucket: regular_bucket_fail[0] }).promise();
            assert.fail('account should not be allowed to create bucket');
        } catch (err) {
            assert.ok(err.code === 'AccessDenied');
        }
    });

    // default nsr - s3 compatible
    mocha.it('s3 put bucket allowed non nsfs buckets - default nsr - s3 compatible', async function() {
        try {
            const s3_account = accounts.account2;
            await s3_account.createBucket({ Bucket: regular_bucket_fail[1] }).promise();
        } catch (err) {
            // create uls in namespace s3 compatible is not implement yet - but the error is not access denied
            assert.ok(err.code === 'InternalError');
        }
    });

    mocha.it('s3 put bucket not allowed non nsfs buckets - default nsr - s3 compatible', async function() {
        try {
            const s3_account = accounts.account_nsfs_only2;
            await s3_account.createBucket({ Bucket: regular_bucket_fail[2] }).promise();
            assert.fail('account should not be allowed to create bucket');
        } catch (err) {
            assert.ok(err.code === 'AccessDenied');
        }
    });


    ///////////////////
    // list buckets  //
    ///////////////////

    mocha.it('s3 list buckets allowed non nsfs buckets', async function() {
        const s3_account = accounts.account1;
        // Give account access to the required buckets
        await Promise.all(
            [bucket_name1, non_nsfs_bucket1, non_nsfs_bucket2]
            .map(bucket => test_utils.generate_s3_policy('account1@noobaa.io', bucket, ["s3:*"]))
            .map(generated =>
                rpc_client.bucket.put_bucket_policy({
                    name: generated.params.bucket,
                    policy: generated.policy,
                })
            )
        );
        const res = await s3_account.listBuckets().promise();
        console.log(inspect(res));
        const list_ok = bucket_in_list([bucket_name1, non_nsfs_bucket1, non_nsfs_bucket2], [], res.Buckets);
        assert.ok(list_ok);
    });


    mocha.it('s3 list buckets allowed non nsfs buckets', async function() {
        const s3_account = accounts.account_nsfs_only1;
        // Give account access to the required buckets
        await Promise.all(
            [bucket_name1]
            .map(bucket => test_utils.generate_s3_policy('account_nsfs_only1@noobaa.io', bucket, ["s3:*"]))
            .map(generated =>
                rpc_client.bucket.put_bucket_policy({
                    name: generated.params.bucket,
                    policy: generated.policy,
                })
            )
        );
        const res = await s3_account.listBuckets().promise();
        console.log(inspect(res));
        const list_ok = bucket_in_list([bucket_name1], [non_nsfs_bucket1, non_nsfs_bucket2], res.Buckets);
        assert.ok(list_ok);
    });

    ///////////////////
    //  put object   //
    ///////////////////

    mocha.it('s3 object bucket using nsfs_only=false account - regular-bucket', async function() {
        const s3_account = accounts.account1;
        // Give account access to the required buckets
        await Promise.all(
            [regular_bucket_name[0]]
            .map(bucket => test_utils.generate_s3_policy('account1@noobaa.io', bucket, ["s3:*"]))
            .map(generated =>
                rpc_client.bucket.put_bucket_policy({
                    name: generated.params.bucket,
                    policy: generated.policy,
                })
            )
        );
        await put_and_delete_objects(s3_account,
            regular_bucket_name[0],
            'allowed_key',
            create_random_body()
        );
    });

    mocha.it('s3 put object using nsfs_only=true account - first.bucket', async function() {
        const s3_account = accounts.account_nsfs_only1;
        // Give account access to the required buckets
        await Promise.all(
            [non_nsfs_bucket1]
            .map(bucket => test_utils.generate_s3_policy('account_nsfs_only1@noobaa.io', bucket, ["s3:*"]))
            .map(generated =>
                rpc_client.bucket.put_bucket_policy({
                    name: generated.params.bucket,
                    policy: generated.policy,
                })
            )
        );
        await put_and_delete_objects(s3_account,
            non_nsfs_bucket1,
            'allowed_key12',
            create_random_body(),
            true
        );
    });

    mocha.it('s3 put object using nsfs_only=false account - second.bucket(s3 compatible namespace bucket)', async function() {
        const s3_account = accounts.account1;
        // Give account access to the required buckets
        await Promise.all(
            [non_nsfs_bucket2]
            .map(bucket => test_utils.generate_s3_policy('account1@noobaa.io', bucket, ["s3:*"]))
            .map(generated =>
                rpc_client.bucket.put_bucket_policy({
                    name: generated.params.bucket,
                    policy: generated.policy,
                })
            )
        );
        await put_and_delete_objects(s3_account,
            non_nsfs_bucket2,
            'allowed_key',
            create_random_body()
        );
    });

    mocha.it('s3 put object using nsfs_only=true account - second.bucket(s3 compatible namespace bucket)', async function() {
        const s3_account = accounts.account_nsfs_only1;
        // Give account access to the required buckets
        await Promise.all(
            [non_nsfs_bucket2]
            .map(bucket => test_utils.generate_s3_policy('account_nsfs_only1@noobaa.io', bucket, ["s3:*"]))
            .map(generated =>
                rpc_client.bucket.put_bucket_policy({
                    name: generated.params.bucket,
                    policy: generated.policy,
                })
            )
        );
        await put_and_delete_objects(s3_account,
            non_nsfs_bucket2,
            'allowed_key',
            create_random_body(),
            true
        );
    });

    mocha.it('s3 put object allowed non nsfs buckets - nsfs bucket', async function() {
        const s3_account = accounts.account1;
        // Give account access to the required buckets
        await Promise.all(
            [bucket_name1]
            .map(bucket => test_utils.generate_s3_policy('account1@noobaa.io', bucket, ["s3:*"]))
            .map(generated =>
                rpc_client.bucket.put_bucket_policy({
                    name: generated.params.bucket,
                    policy: generated.policy,
                })
            )
        );
        await put_and_delete_objects(s3_account,
            bucket_name1,
            'allowed_key-nsfs1',
            create_random_body()
        );
    });

    mocha.it('s3 put object allowed non nsfs buckets - nsfs bucket', async function() {
        const s3_account = accounts.account_nsfs_only1;
        // Give account access to the required buckets
        await Promise.all(
            [bucket_name1]
            .map(bucket => test_utils.generate_s3_policy('account_nsfs_only1@noobaa.io', bucket, ["s3:*"]))
            .map(generated =>
                rpc_client.bucket.put_bucket_policy({
                    name: generated.params.bucket,
                    policy: generated.policy,
                })
            )
        );
        await put_and_delete_objects(s3_account,
            bucket_name1,
            'allowed_key-nsfs2',
            create_random_body()
        );
    });


    mocha.it('delete buckets', async function() {
        for (const bucket of regular_bucket_name) {
            await rpc_client.bucket.delete_bucket({ name: bucket });
        }
    });

    ////////////////////////
    //   delete accounts  //
    ////////////////////////

    mocha.it('delete accounts', async function() {
        for (const account_name of Object.keys(accounts)) {
            await rpc_client.account.delete_account({ email: `${account_name}@noobaa.io` });
        }
    });
});
