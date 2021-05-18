/* Copyright (C) 2020 NooBaa */
'use strict';


const mocha = require('mocha');
const util = require('util');
const AWS = require('aws-sdk');
const http = require('http');
const assert = require('assert');
const coretest = require('./coretest');
const { rpc_client, EMAIL, PASSWORD, SYSTEM} = coretest;
const fs_utils = require('../../util/fs_utils');
coretest.setup({ pools_to_create: [coretest.POOL_LIST[0]] });

const inspect = (x, max_arr = 5) => util.inspect(x, { colors: true, depth: null, maxArrayLength: max_arr });

let new_account_params = {
    has_login: false,
    s3_access: true,
    allowed_buckets: {
        full_permission: true
    }
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
    mocha.before(async () => fs_utils.create_fresh_path(tmp_fs_root, 0o777));
    mocha.before(async () => fs_utils.create_fresh_path(tmp_fs_root + bucket_path, 0o770));
    mocha.before(async () => fs_utils.create_fresh_path(tmp_fs_root + other_bucket_path, 0o770));

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
        const res = await s3_owner.listBuckets().promise();
        console.log(inspect(res));
        const bucket = bucket_in_list(bucket_name, res.Buckets);
        assert.ok(!bucket);
        const first_bucket = bucket_in_list('first.bucket', res.Buckets);
        assert.ok(first_bucket);
    });

    mocha.it('create account 1 with uid, gid - wrong uid', async function() {
        account_wrong_uid = await rpc_client.account.create_account({...new_account_params,
                email: 'account_wrong_uid0@noobaa.com',
                name: 'account_wrong_uid0',
                nsfs_account_config: {
                    uid: 26041992,
                    gid: 26041992,
                }
            }
        );
        console.log(inspect(account_wrong_uid));
        s3_creds.accessKeyId = account_wrong_uid.access_keys[0].access_key.unwrap();
        s3_creds.secretAccessKey = account_wrong_uid.access_keys[0].secret_key.unwrap();
        s3_creds.endpoint = coretest.get_http_address();
        s3_wrong_uid = new AWS.S3(s3_creds);
    });

    mocha.it('list buckets with wrong uid, gid', async function() {
        const res = await s3_wrong_uid.listBuckets().promise();
        console.log(inspect(res));
        const bucket = bucket_in_list(bucket_name, res.Buckets);
        assert.ok(!bucket);
        const first_bucket = bucket_in_list('first.bucket', res.Buckets);
        assert.ok(first_bucket);

    });

    mocha.it('list namespace resources after creation', async function() {
        await rpc_client.create_auth_token({
            email: EMAIL,
            password: PASSWORD,
            system: SYSTEM,
        });
        const res = await rpc_client.pool.read_namespace_resource({ name: nsr});
        assert.ok(res.name === nsr && res.fs_root_path === tmp_fs_root);
    });

    mocha.it('create account 2 uid, gid', async function() {
        account_correct_uid = await rpc_client.account.create_account({...new_account_params,
                email: 'account_correct_uid@noobaa.com',
                name: 'account_correct_uid',
                nsfs_account_config: {
                    uid: process.getuid(),
                    gid: process.getgid(),
                }
            }
        );
        console.log(inspect(account_correct_uid));
        s3_creds.accessKeyId = account_correct_uid.access_keys[0].access_key.unwrap();
        s3_creds.secretAccessKey = account_correct_uid.access_keys[0].secret_key.unwrap();
        s3_creds.endpoint = coretest.get_http_address();
        s3_correct_uid = new AWS.S3(s3_creds);
    });

    mocha.it('list buckets with uid, gid', async function() {
        const res = await s3_correct_uid.listBuckets().promise();
        console.log(inspect(res));
        const bucket = bucket_in_list(bucket_name, res.Buckets);
        assert.ok(bucket);
    });

    mocha.it('delete bucket with uid, gid', async function() {
        const res = await s3_owner.deleteBucket({ Bucket: bucket_name}).promise();
        console.log(inspect(res));
    });

    mocha.it('list buckets after deletion', async function() {
        const res = await s3_correct_uid.listBuckets().promise();
        console.log(inspect(res));
        const bucket = bucket_in_list(bucket_name, res.Buckets);
        assert.ok(!bucket);
    });

    mocha.it('list namespace resources after deletion', async function() {
        try {
        const res = await rpc_client.pool.read_namespace_resource({ name: nsr });
        assert.fail(`found namespace resource: ${res}`);
        } catch (err) {
            assert.ok('could not find namespace resource - as it should');
        }
        assert.ok(fs_utils.file_must_not_exist(tmp_fs_root));
    });

    mocha.it('delete account by uid, gid', async function() {
        let read_account_resp1 = await rpc_client.account.read_account({ email: 'account_wrong_uid0@noobaa.com' });
        assert.ok(read_account_resp1);

        // create another account with the same uid gid
        let account_wrong_uid1 = await rpc_client.account.create_account({...new_account_params,
                email: 'account_wrong_uid1@noobaa.com',
                name: 'account_wrong_uid1',
                nsfs_account_config: {
                    uid: 26041992,
                    gid: 26041992,
                }
            }
        );
        console.log(inspect(account_wrong_uid1));
        assert.ok(account_wrong_uid1);
        await rpc_client.account.delete_account_by_property({
                nsfs_account_config: {
                    uid: 26041992,
                    gid: 26041992,
                }
            }
        );
        // check that both accounts deleted
        for (let i = 0; i < 2; i++) {
            try {
                let deleted_account_exist = await rpc_client.account.read_account({ email: `account_wrong_uid${i}@noobaa.com` });
                assert.fail(`found account: ${deleted_account_exist} - account should be deleted`);
            } catch (err) {
                assert.ok(err.rpc_code === 'NO_SUCH_ACCOUNT');
            }
        }
        let list_account_resp2 = (await rpc_client.account.list_accounts()).accounts;
        assert.ok(list_account_resp2.length > 0);
    });

    mocha.it('delete account by uid, gid - no such account', async function() {

        let list_account_resp1 = (await rpc_client.account.list_accounts()).accounts;
        assert.ok(list_account_resp1.length > 0);
        await rpc_client.account.delete_account_by_property({
                nsfs_account_config: {
                    uid: 26041993,
                    gid: 26041993,
                }
            }
        );
        let list_account_resp2 = (await rpc_client.account.list_accounts()).accounts;
        assert.deepStrictEqual(list_account_resp1, list_account_resp2);
        assert.ok(list_account_resp2.length > 0);

    });
});

function bucket_in_list(bucket_name, s3_buckets_list_response) {
    return s3_buckets_list_response.find(bucket => bucket.Name === bucket_name);
}