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
coretest.setup({ pools_to_create: [coretest.POOL_LIST[1]] });
mocha.describe('bucketspace namespace_fs - versioning', function() {
    const nsr = 'versioned-nsr';
    const bucket_name = 'versioned-bucket';
    const tmp_fs_root = '/tmp/test_bucket_namespace_fs_versioning';
    const bucket_path = '/bucket';
    let s3_uid5;
    let s3_uid6;
    let s3_admin;
    let accounts = [];

    mocha.before(async function() {
        if (process.getgid() !== 0 || process.getuid() !== 0) {
            coretest.log('No Root permissions found in env. Skipping test');
            this.skip(); // eslint-disable-line no-invalid-this
        }
        // create paths 
        const full_path = tmp_fs_root + bucket_path;
        fs_utils.create_fresh_path(tmp_fs_root, 0o777);
        fs_utils.create_fresh_path(full_path, 0o770);

        // export dir as a bucket
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

        const policy = {
            Version: '2012-10-17',
            Statement: [{
                Sid: 'id-1',
                Effect: 'Allow',
                Principal: { AWS: "*" },
                Action: ['s3:PutBucketVersioning', 's3:GetBucketVersioning'],
                Resource: [`arn:aws:s3:::${bucket_name}`]
            }]
        };
        // create accounts
        let res = await generate_nsfs_account({ admin: true });
        s3_admin = generate_s3_client(res.access_key, res.secret_key);
        await s3_admin.putBucketPolicy({
            Bucket: bucket_name,
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

    mocha.it('set bucket versioning - Enabled - should fail - no permissions', async function() {
        try {
            await s3_uid5.putBucketVersioning({ Bucket: bucket_name, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } }).promise();
            assert.fail(`put bucket versioning succeeded for account without permissions`);
        } catch (err) {
            assert.ok(err.code === 'AccessDenied');
        }
    });

    mocha.it('set bucket versioning - Enabled - admin - should fail - no permissions', async function() {
        try {
            await s3_admin.putBucketVersioning({ Bucket: bucket_name, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } }).promise();
            assert.fail(`put bucket versioning succeeded for account without permissions`);
        } catch (err) {
            assert.ok(err.code === 'AccessDenied');
        }
    });

    mocha.it('set bucket versioning - Enabled', async function() {
        await s3_uid6.putBucketVersioning({ Bucket: bucket_name, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } }).promise();
        const res = await s3_uid6.getBucketVersioning({ Bucket: bucket_name }).promise();
        assert.equal(res.Status, 'Enabled');
    });
});


/////// UTILS ///////

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
