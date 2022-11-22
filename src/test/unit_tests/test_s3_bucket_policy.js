/* Copyright (C) 2016 NooBaa */
/* eslint max-lines-per-function: ['error', 650] */
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
const { rpc_client, EMAIL, POOL_LIST, anon_rpc_client } = coretest;
const MDStore = require('../../server/object_services/md_store').MDStore;
coretest.setup({ pools_to_create: POOL_LIST });

const AWS = require('aws-sdk');
const http = require('http');
const mocha = require('mocha');
const assert = require('assert');

async function assert_throws_async(promise, expected_message = 'Access Denied') {
    try {
        await promise;
        assert.fail('Test was suppose to fail on ' + expected_message);
    } catch (err) {
        if (err.message !== expected_message) {
            throw err;
        }
    }
}
const BKT = 'test2-bucket-policy-ops';
const BKT_B = 'test2-bucket-policy-ops-1';
const KEY = 'file1.txt';
const user_a = 'alice';
const user_b = 'bob';
let s3_a;
let s3_b;
let s3_owner;
let s3_anon;

const anon_access_policy = {
    Version: '2012-10-17',
    Statement: [{
        Effect: 'Allow',
        Principal: { AWS: "*" },
        Action: ['s3:GetObject', 's3:ListBucket'],
        Resource: [`arn:aws:s3:::*`]
    }]
};

// core_test_store is a global object created with the intention
// to store data between tests.
const cross_test_store = {};

async function setup() {
    const self = this; // eslint-disable-line no-invalid-this
    self.timeout(60000);
    const s3_creds = {
        endpoint: coretest.get_http_address(),
        s3ForcePathStyle: true,
        signatureVersion: 'v4',
        computeChecksums: true,
        s3DisableBodySigning: false,
        region: 'us-east-1',
        httpOptions: { agent: new http.Agent({ keepAlive: false }) },
    };
    const account = {
        has_login: false,
        s3_access: true,
        default_resource: POOL_LIST[0].name
    };
    const admin_keys = (await rpc_client.account.read_account({
        email: EMAIL,
    })).access_keys;
    account.name = user_a;
    account.email = user_a;
    const user_a_keys = (await rpc_client.account.create_account(account)).access_keys;
    account.name = user_b;
    account.email = user_b;
    const user_b_keys = (await rpc_client.account.create_account(account)).access_keys;
    s3_creds.accessKeyId = user_a_keys[0].access_key.unwrap();
    s3_creds.secretAccessKey = user_a_keys[0].secret_key.unwrap();
    s3_a = new AWS.S3(s3_creds);
    s3_creds.accessKeyId = user_b_keys[0].access_key.unwrap();
    s3_creds.secretAccessKey = user_b_keys[0].secret_key.unwrap();
    s3_b = new AWS.S3(s3_creds);
    s3_creds.accessKeyId = admin_keys[0].access_key.unwrap();
    s3_creds.secretAccessKey = admin_keys[0].secret_key.unwrap();
    await s3_b.createBucket({ Bucket: BKT_B }).promise();
    s3_creds.accessKeyId = admin_keys[0].access_key.unwrap();
    s3_creds.secretAccessKey = admin_keys[0].secret_key.unwrap();
    s3_owner = new AWS.S3(s3_creds);
    await s3_owner.createBucket({ Bucket: BKT }).promise();
    s3_anon = new AWS.S3({
        ...s3_creds,
        accessKeyId: undefined,
        secretAccessKey: undefined,
    });
}

mocha.describe('s3_bucket_policy', function() {
    mocha.before(setup);
    mocha.it('should fail setting bucket policy when user doesn\'t exist', async function() {
        const made_up_user = 'no_way_such_user_exist@no.way';
        const policy = {
            Version: '2012-10-17',
            Statement: [{
                Sid: 'id-1',
                Effect: 'Allow',
                Principal: { AWS: made_up_user },
                Action: ['s3:GetBucketPolicy'],
                Resource: [`arn:aws:s3:::${BKT}`]
            }]
        };
        await assert_throws_async(s3_owner.putBucketPolicy({ // should fail - no such user
            Bucket: BKT,
            Policy: JSON.stringify(policy)
        }).promise(), 'Invalid principal in policy');
    });

    mocha.it('should fail setting bucket policy when resource doesn\'t exist', async function() {
        const made_up_bucket = 'nosuchbucket';
        const policy = {
            Statement: [{
                Sid: 'id-1',
                Effect: 'Allow',
                Principal: { AWS: user_a },
                Action: ['s3:GetBucketPolicy'],
                Resource: [`arn:aws:s3:::${made_up_bucket}`]
            }]
        };
        await assert_throws_async(s3_owner.putBucketPolicy({ // should fail - no such user
            Bucket: BKT,
            Policy: JSON.stringify(policy)
        }).promise(), 'Policy has invalid resource');
    });

    mocha.it('should fail setting bucket policy when action is illeagel', async function() {
        const made_up_action = 's3:GetNoSuchAction';
        const policy = {
            Version: '2012-10-17',
            Statement: [{
                Sid: 'id-1',
                Effect: 'Allow',
                Principal: { AWS: user_a },
                Action: [made_up_action],
                Resource: [`arn:aws:s3:::${BKT}`]
            }]
        };
        await assert_throws_async(s3_owner.putBucketPolicy({ // should fail - no such user
            Bucket: BKT,
            Policy: JSON.stringify(policy)
        }).promise(), 'Policy has invalid action');
    });

    mocha.it('should only read bucket policy when have permission to', async function() {
        const policy = {
            Statement: [{
                Sid: 'id-1',
                Effect: 'Allow',
                Principal: { AWS: user_a },
                Action: ['s3:GetBucketPolicy'],
                Resource: [`arn:aws:s3:::${BKT}`]
            }, {
                Sid: 'id-2',
                Effect: 'Deny',
                Principal: { AWS: user_b },
                Action: ['s3:*'],
                Resource: [`arn:aws:s3:::${BKT}`]
            }]
        };
        await s3_owner.putBucketPolicy({
            Bucket: BKT,
            Policy: JSON.stringify(policy)
        }).promise();
        const res_a = await s3_a.getBucketPolicy({ // should work - user a has get_bucket_policy permission
            Bucket: BKT,
        }).promise();
        console.log('Policy set', res_a);
        await assert_throws_async(s3_b.getBucketPolicy({ // should fail - user b has no permissions
            Bucket: BKT,
        }).promise());
    });

    mocha.it('should be able to set bucket policy when none set', async function() {
        const policy = {
            Version: '2012-10-17',
            Statement: [{
                Sid: 'id-1',
                Effect: 'Allow',
                Principal: { AWS: user_a },
                Action: ['s3:GetBucketPolicy'],
                Resource: [`arn:aws:s3:::${BKT}`]
            }]
        };
        await s3_owner.deleteBucketPolicy({ // should work - owner can always delete the buckets policy
            Bucket: BKT,
        }).promise();
        await s3_owner.putBucketPolicy({ // s3_owner can set the policy
            Bucket: BKT,
            Policy: JSON.stringify(policy)
        }).promise();
    });

    mocha.it('should be able to put and list files when bucket policy permits', async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(15000);
        const policy = {
            Statement: [{
                Sid: 'id-1',
                Effect: 'Allow',
                Principal: { AWS: user_a },
                Action: ['s3:ListBucket'],
                Resource: [`arn:aws:s3:::${BKT}`]
            }, {
                Sid: 'id-2',
                Effect: 'Allow',
                Principal: { AWS: user_b },
                Action: ['s3:PutObject'],
                Resource: [`arn:aws:s3:::${BKT}/*`]
            }, {
                Sid: 'id-4',
                Effect: 'Deny',
                Principal: { AWS: user_a },
                Action: ['s3:PutObject'],
                Resource: [`arn:aws:s3:::${BKT}/*`]
            }, {
                Sid: 'id-5',
                Effect: 'Deny',
                Principal: { AWS: user_b },
                Action: ['s3:ListBucket'],
                Resource: [`arn:aws:s3:::${BKT}`]
            }]
        };

        await s3_owner.putBucketPolicy({
            Bucket: BKT,
            Policy: JSON.stringify(policy)
        }).promise();
        await assert_throws_async(s3_a.putObject({
            Body: 'Some data for the file... bla bla bla...',
            Bucket: BKT,
            Key: KEY
        }).promise(), 'Access Denied');
        await assert_throws_async(s3_a.putObject({
            Body: 'Some data for the file... bla bla bla...',
            Bucket: BKT,
            Key: KEY
        }).promise());
        await s3_b.putObject({
            Body: 'Some data for the file... bla bla bla...',
            Bucket: BKT,
            Key: KEY
        }).promise();
        await s3_a.listObjects({ // should succeed - user a has can list
            Bucket: BKT,
        }).promise();
        await assert_throws_async(s3_b.listObjects({ // should fail - user b can't
            Bucket: BKT,
        }).promise());
    });

    mocha.it('should be able to deny write some file but not other', async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(15000);
        const file_in_user_b_dir = 'user_b_files/just_for_me.txt';
        const policy = {
            Statement: [{
                Sid: 'id-1',
                Effect: 'Deny',
                Principal: { AWS: user_a },
                Action: ['s3:GetObject', 's3:PutObject'],
                Resource: [`arn:aws:s3:::${BKT}/user_b_files/*`]
            }, {
                Sid: 'id-2',
                Effect: 'Allow',
                Principal: { AWS: user_a },
                Action: ['s3:GetObject', 's3:PutObject'],
                Resource: [`arn:aws:s3:::${BKT}/*`]
            }, {
                Sid: 'id-3',
                Effect: 'Allow',
                Principal: { AWS: user_b },
                Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
                Resource: [`arn:aws:s3:::${BKT}/*`]
            }]
        };
        await s3_owner.putBucketPolicy({
            Bucket: BKT,
            Policy: JSON.stringify(policy)
        }).promise();
        await s3_b.putObject({
            Body: 'Some data for the file... bla bla bla... ',
            Bucket: BKT,
            Key: file_in_user_b_dir
        }).promise();
        await assert_throws_async(s3_a.getObject({
            Bucket: BKT,
            Key: file_in_user_b_dir
        }).promise());
        await s3_b.deleteObject({
            Bucket: BKT,
            Key: file_in_user_b_dir
        }).promise();
    });

    mocha.it('should be able to support write * and ? in resource', async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(15000);
        const apply_to_rule1 = 'user_a_files/just_for_me.txt';
        const apply_to_rule2 = 'user_b_files/just_for_me.txt';
        const not_apply_to_rule1 = 'user_files/just_for_me.txt';
        const not_apply_to_rule2 = 'user_z_files/just_for_me.exe';
        const policy = {
            Version: '2012-10-17',
            Statement: [{
                Sid: 'id-1',
                Effect: 'Deny',
                Principal: { AWS: user_a },
                Action: ['s3:GetObject', 's3:PutObject'],
                Resource: [`arn:aws:s3:::${BKT}/user_?_files/j?st_*.txt`]
            }, {
                Sid: 'id-2',
                Effect: 'Allow',
                Principal: { AWS: user_a },
                Action: ['s3:GetObject', 's3:PutObject'],
                Resource: [`arn:aws:s3:::${BKT}/*`]
            }, {
                Sid: 'id-3',
                Effect: 'Allow',
                Principal: { AWS: user_b },
                Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
                Resource: [`arn:aws:s3:::${BKT}/*`]
            }]
        };
        await s3_owner.putBucketPolicy({
            Bucket: BKT,
            Policy: JSON.stringify(policy)
        }).promise();
        await assert_throws_async(s3_a.putObject({
            Body: 'Some data for the file... bla bla bla... ',
            Bucket: BKT,
            Key: apply_to_rule1
        }).promise());
        await assert_throws_async(s3_a.putObject({
            Body: 'Some data for the file... bla bla bla... ',
            Bucket: BKT,
            Key: apply_to_rule2
        }).promise());
        await s3_a.putObject({
            Body: 'Some data for the file... bla bla bla... ',
            Bucket: BKT,
            Key: not_apply_to_rule1
        }).promise();
        await s3_a.putObject({
            Body: 'Some data for the file... bla bla bla... ',
            Bucket: BKT,
            Key: not_apply_to_rule2
        }).promise();
        await s3_b.deleteObject({
            Bucket: BKT,
            Key: not_apply_to_rule1
        }).promise();
        await s3_b.deleteObject({
            Bucket: BKT,
            Key: not_apply_to_rule2
        }).promise();
    });

    mocha.it('should be able to put versionning when bucket policy permits', async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(15000);
        let version_id;
        const policy = {
            Version: '2012-10-17',
            Statement: [{
                Sid: 'id-1',
                Effect: 'Allow',
                Principal: { AWS: user_a },
                Action: ['s3:PutObject', 's3:deleteObjectVersion'],
                Resource: [`arn:aws:s3:::${BKT}/*`]
            }, {
                Sid: 'id-2',
                Effect: 'Allow',
                Principal: { AWS: user_b },
                Action: ['s3:PutBucketVersioning'],
                Resource: [`arn:aws:s3:::${BKT}`]
            }, {
                Sid: 'id-3',
                Effect: 'Deny',
                Principal: { AWS: user_a },
                Action: ['s3:deleteObject'],
                Resource: [`arn:aws:s3:::${BKT}/*`]
            }]
        };
        await s3_owner.putBucketPolicy({
            Bucket: BKT,
            Policy: JSON.stringify(policy)
        }).promise();
        await s3_b.putBucketVersioning({
            Bucket: BKT,
            VersioningConfiguration: {
                MFADelete: 'Disabled',
                Status: 'Enabled'
            }
        }).promise();
        version_id = (await s3_a.putObject({
            Body: 'Some data for the file... bla bla bla... version II',
            Bucket: BKT,
            Key: KEY
        }).promise()).VersionId;
        await assert_throws_async(s3_a.deleteObject({
            Bucket: BKT,
            Key: KEY,
        }).promise());
        await s3_a.deleteObject({ // delete the file versions
            Bucket: BKT,
            Key: KEY,
            VersionId: version_id
        }).promise();
        await s3_a.deleteObject({
            Bucket: BKT,
            Key: KEY,
            VersionId: 'nbver-1'
        }).promise();
    });

    mocha.it('should deny bucket owner access', async function() {
        const policy = {
            Version: '2012-10-17',
            Statement: [{
                Sid: 'id-1',
                Effect: 'Deny',
                Principal: { AWS: user_b },
                Action: ['s3:ListBucket'],
                Resource: [`arn:aws:s3:::${BKT_B}`]
            }]
        };
        await s3_b.putBucketPolicy({ // should work - owner can update the buckets policy unless explicitly denied
            Bucket: BKT_B,
            Policy: JSON.stringify(policy)
        }).promise();

        await assert_throws_async(s3_b.listObjects({ // should fail - bucket owner cwas explicitly denied
            Bucket: BKT_B,
        }).promise());
    });

    mocha.it('should allow acces after adding anonymous access', async function() {
        await s3_owner.putBucketPolicy({ // should work - system owner can always update the buckets policy
            Bucket: BKT,
            Policy: JSON.stringify(anon_access_policy)
        }).promise();
        await s3_a.listObjects({
            Bucket: BKT,
        }).promise();
    });

    mocha.it('should set and delete bucket policy when system owner', async function() {
        const policy = {
            Version: '2012-10-17',
            Statement: [{
                Sid: 'id-1',
                Effect: 'Deny',
                Principal: { AWS: EMAIL },
                Action: ['s3:*'],
                Resource: [`arn:aws:s3:::${BKT}`]
            }]
        };
        await s3_owner.putBucketPolicy({ // should work - owner can always update the buckets policy
            Bucket: BKT,
            Policy: JSON.stringify(policy)
        }).promise();
        await s3_owner.deleteBucketPolicy({ // should work - owner can always delete the buckets policy
            Bucket: BKT,
        }).promise();
    });

    mocha.it('anonymous user should be able to list bucket objects', async function() {
        await s3_owner.putBucketPolicy({
            Bucket: BKT,
            Policy: JSON.stringify(anon_access_policy)
        }).promise();

        await s3_anon.makeUnauthenticatedRequest('listObjects', { Bucket: BKT }).promise();
    });

    mocha.it('anonymous user should not be able to list bucket objects when there is no policy', async function() {
        await s3_owner.deleteBucketPolicy({
            Bucket: BKT,
        }).promise();

        await assert_throws_async(s3_anon.makeUnauthenticatedRequest(
            'listObjects',
            { Bucket: BKT }
        ).promise());
    });

    mocha.it('anonymous user should not be able to list bucket objects when policy doesn\'t allow', async function() {
        const anon_deny_policy = {
            Version: '2012-10-17',
            Statement: [
                {
                    Effect: 'DENY',
                    Principal: { AWS: "*" },
                    Action: ['s3:GetObject', 's3:ListBucket'],
                    Resource: [`arn:aws:s3:::*`]
                },
            ]
        };

        await s3_owner.putBucketPolicy({
            Bucket: BKT,
            Policy: JSON.stringify(anon_deny_policy)
        }).promise();

        await assert_throws_async(s3_anon.makeUnauthenticatedRequest(
            'listObjects',
            { Bucket: BKT }
        ).promise());
    });

    mocha.it('[RPC TEST]: anonymous user should not be able to read_object_md when not explicitly allowed', async function() {
        // Ensure that the bucket has no policy
        await s3_owner.deleteBucketPolicy({
            Bucket: BKT,
        }).promise();

        await assert_throws_async(anon_rpc_client.object.read_object_md({
            bucket: BKT,
            key: KEY,
        }), 'requesting account is not authorized to read the object');
    });

    mocha.it('[RPC TEST]: anonymous user should be able to read_object_md when explicitly allowed', async function() {
        const anon_read_policy = {
            Version: '2012-10-17',
            Statement: [
                {
                    Effect: 'Allow',
                    Principal: { AWS: "*" },
                    Action: ['s3:GetObject'],
                    Resource: [`arn:aws:s3:::*`]
                },
            ]
        };
        await s3_owner.putBucketPolicy({
            Bucket: BKT,
            Policy: JSON.stringify(anon_read_policy)
        }).promise();

        cross_test_store.obj = await anon_rpc_client.object.read_object_md({
            bucket: BKT,
            key: KEY,
        });
    });

    mocha.it('[RPC TEST]: anonymous user should be able to read_object_md when explicitly allowed to access only specific key', async function() {
        const anon_read_policy_2 = {
            Version: '2012-10-17',
            Statement: [
                {
                    Effect: 'Allow',
                    Principal: { AWS: "*"},
                    Action: ['s3:GetObject'],
                    Resource: [`arn:aws:s3:::${BKT}/${KEY}`]
                },
            ]
        };
        await s3_owner.putBucketPolicy({
            Bucket: BKT,
            Policy: JSON.stringify(anon_read_policy_2)
        }).promise();

        cross_test_store.obj = await anon_rpc_client.object.read_object_md({
            bucket: BKT,
            key: KEY,
        });
    });


    mocha.it('[RPC TEST]: anonymous user should not be able to read_object_mapping when not explicitly allowed', async function() {
        // Ensure that the bucket has no policy
        await s3_owner.deleteBucketPolicy({
            Bucket: BKT,
        }).promise();

        await assert_throws_async(anon_rpc_client.object.read_object_mapping({
            bucket: BKT,
            key: KEY,
            obj_id: MDStore.instance().make_md_id(cross_test_store.obj.obj_id),
        }), 'requesting account is not authorized to read the object');
    });

    mocha.it('[RPC TEST]: anonymous user should be able to read_object_mapping when explicitly allowed', async function() {
        const anon_read_policy = {
            Version: '2012-10-17',
            Statement: [
                {
                    Effect: 'Allow',
                    Principal: { AWS: "*" },
                    Action: ['s3:GetObject'],
                    Resource: [`arn:aws:s3:::*`]
                },
            ]
        };
        await s3_owner.putBucketPolicy({
            Bucket: BKT,
            Policy: JSON.stringify(anon_read_policy)
        }).promise();

        await anon_rpc_client.object.read_object_mapping({
            bucket: BKT,
            key: KEY,
            obj_id: MDStore.instance().make_md_id(cross_test_store.obj.obj_id),
        });
    });

    mocha.it('[RPC TEST]: anonymous user should be able to read_object_mapping when explicitly allowed to access only specific key', async function() {
        const anon_read_policy_2 = {
            Version: '2012-10-17',
            Statement: [
                {
                    Effect: 'Allow',
                    Principal: { AWS: "*"
                    },
                    Action: ['s3:GetObject'],
                    Resource: [`arn:aws:s3:::${BKT}/${KEY}`]
                },
            ]
        };
        await s3_owner.putBucketPolicy({
            Bucket: BKT,
            Policy: JSON.stringify(anon_read_policy_2)
        }).promise();

        await anon_rpc_client.object.read_object_mapping({
            bucket: BKT,
            key: KEY,
            obj_id: MDStore.instance().make_md_id(cross_test_store.obj.obj_id),
        });
    });
});
