/* Copyright (C) 2016 NooBaa */
/* eslint max-lines-per-function: ['error', 650] */
'use strict';

// setup coretest first to prepare the env
const { get_coretest_path, TMP_PATH } = require('../system_tests/test_utils');
const coretest_path = get_coretest_path();
const coretest = require(coretest_path);
const { rpc_client, EMAIL, POOL_LIST, anon_rpc_client } = coretest;
const MDStore = require('../../server/object_services/md_store').MDStore;
coretest.setup({ pools_to_create: process.env.NC_CORETEST ? undefined : [POOL_LIST[1]] });
const path = require('path');
const fs_utils = require('../../util/fs_utils');

const { S3 } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require("@smithy/node-http-handler");
const http = require('http');
const mocha = require('mocha');
const assert = require('assert');
const { S3Error } = require('../../endpoint/s3/s3_errors');
const config = require('../../../config');

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
const BODY = "Some data for the file... bla bla bla... ";
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
        forcePathStyle: true,
        region: config.DEFAULT_REGION,
        requestHandler: new NodeHttpHandler({
            httpAgent: new http.Agent({ keepAlive: false })
        }),
    };
    const nsr = 's3_bucket_policy_nsr';
    const tmp_fs_root = path.join(TMP_PATH, 'test_s3_bucket_policy');

    if (process.env.NC_CORETEST) {
        await fs_utils.create_fresh_path(tmp_fs_root, 0o777);
        await rpc_client.pool.create_namespace_resource({
            name: nsr,
            nsfs_config: {
                fs_root_path: tmp_fs_root,
            }
        });
    }
    const account = {
        has_login: false,
        s3_access: true,
        default_resource: process.env.NC_CORETEST ? nsr : POOL_LIST[1].name
    };
    if (process.env.NC_CORETEST) {
        account.nsfs_account_config = {
            uid: process.getuid(),
            gid: process.getgid(),
            new_buckets_path: '/'
        };
    }
    const admin_keys = (await rpc_client.account.read_account({
        email: EMAIL,
    })).access_keys;
    account.name = user_a;
    account.email = user_a;
    const user_a_keys = (await rpc_client.account.create_account(account)).access_keys;
    account.name = user_b;
    account.email = user_b;
    const user_b_keys = (await rpc_client.account.create_account(account)).access_keys;
    s3_creds.credentials = {
        accessKeyId: user_a_keys[0].access_key.unwrap(),
        secretAccessKey: user_a_keys[0].secret_key.unwrap(),
    };
    s3_a = new S3(s3_creds);
    s3_creds.credentials = {
        accessKeyId: user_b_keys[0].access_key.unwrap(),
        secretAccessKey: user_b_keys[0].secret_key.unwrap(),
    };
    s3_b = new S3(s3_creds);
    await s3_b.createBucket({ Bucket: BKT_B });
    s3_creds.credentials = {
        accessKeyId: admin_keys[0].access_key.unwrap(),
        secretAccessKey: admin_keys[0].secret_key.unwrap(),
    };
    s3_owner = new S3(s3_creds);
    await s3_owner.createBucket({ Bucket: BKT });
    s3_anon = new S3({
        ...s3_creds,
        credentials: {
            accessKeyId: undefined,
            secretAccessKey: undefined,
        },
        // workaround for makeUnauthenticatedRequest that doesn't exist in AWS SDK V3
        // taken form here: https://github.com/aws/aws-sdk-js-v3/issues/2321#issuecomment-916336230
        // It is a custom signer that returns the request as is (not modifying the request)
        signer: { sign: async request => request },
    });
}

/*eslint max-lines-per-function: ["error", 1300]*/
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
        }), 'Invalid principal in policy');
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
        }), 'Policy has invalid resource');
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
        }), 'Policy has invalid action');
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
        });
        const res_a = await s3_a.getBucketPolicy({ // should work - user a has get_bucket_policy permission
            Bucket: BKT,
        });
        console.log('Policy set', res_a);
        await assert_throws_async(s3_b.getBucketPolicy({ // should fail - user b has no permissions
            Bucket: BKT,
        }));
    });

    mocha.it('should be able to set bucket policy when none set', async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(15000);
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
        });
        await s3_owner.putBucketPolicy({ // s3_owner can set the policy
            Bucket: BKT,
            Policy: JSON.stringify(policy)
        });
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
        });
        await assert_throws_async(s3_a.putObject({
            Body: BODY,
            Bucket: BKT,
            Key: KEY
        }), 'Access Denied');
        await assert_throws_async(s3_a.putObject({
            Body: BODY,
            Bucket: BKT,
            Key: KEY
        }));
        await s3_b.putObject({
            Body: BODY,
            Bucket: BKT,
            Key: KEY
        });
        await s3_a.listObjects({ // should succeed - user a has can list
            Bucket: BKT,
        });
        await assert_throws_async(s3_b.listObjects({ // should fail - user b can't
            Bucket: BKT,
        }));
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
        });
        await s3_b.putObject({
            Body: BODY,
            Bucket: BKT,
            Key: file_in_user_b_dir
        });
        await assert_throws_async(s3_a.getObject({
            Bucket: BKT,
            Key: file_in_user_b_dir
        }));
        await s3_b.deleteObject({
            Bucket: BKT,
            Key: file_in_user_b_dir
        });
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
        });
        await assert_throws_async(s3_a.putObject({
            Body: BODY,
            Bucket: BKT,
            Key: apply_to_rule1
        }));
        await assert_throws_async(s3_a.putObject({
            Body: BODY,
            Bucket: BKT,
            Key: apply_to_rule2
        }));
        await s3_a.putObject({
            Body: BODY,
            Bucket: BKT,
            Key: not_apply_to_rule1
        });
        await s3_a.putObject({
            Body: BODY,
            Bucket: BKT,
            Key: not_apply_to_rule2
        });
        await s3_b.deleteObject({
            Bucket: BKT,
            Key: not_apply_to_rule1
        });
        await s3_b.deleteObject({
            Bucket: BKT,
            Key: not_apply_to_rule2
        });
    });

    mocha.it('should be able to put versionning when bucket policy permits', async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(15000);
        const new_key = 'file101.txt';
        const policy = {
            Version: '2012-10-17',
            Statement: [{
                Sid: 'id-1',
                Effect: 'Allow',
                Principal: { AWS: user_a },
                Action: ['s3:PutObject', 's3:DeleteObjectVersion'],
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
                Action: ['s3:DeleteObject'],
                Resource: [`arn:aws:s3:::${BKT}/*`]
            }]
        };
        await s3_owner.putBucketPolicy({
            Bucket: BKT,
            Policy: JSON.stringify(policy)
        });
        const first_res = await s3_a.putObject({
            Body: 'Some data for the file... bla bla bla... version I',
            Bucket: BKT,
            Key: new_key
        });
        const first_version_etag = first_res.ETag.replaceAll('"', '');
        await s3_b.putBucketVersioning({
            Bucket: BKT,
            VersioningConfiguration: {
                MFADelete: 'Disabled',
                Status: 'Enabled'
            }
        });
        const res = await s3_a.putObject({
            Body: 'Some data for the file... bla bla bla bla... version II',
            Bucket: BKT,
            Key: new_key
        });
        const seq = Number(res.VersionId.split('-')[1]);
        await assert_throws_async(s3_a.deleteObject({
            Bucket: BKT,
            Key: new_key,
        }));
        await s3_a.deleteObject({ // delete the file versions
            Bucket: BKT,
            Key: new_key,
            VersionId: process.env.NC_CORETEST ? res.VersionId : 'nbver-' + seq
        });
        await s3_a.deleteObject({
            Bucket: BKT,
            Key: new_key,
            VersionId: process.env.NC_CORETEST ? first_version_etag : 'nbver-' + (seq - 1)
        });
    });

    mocha.it('should deny bucket owner access', async function() {
        // test fails on NC_CORETEST because system_owner === bucket_owner, until this behavior changes skipping the test
        if (process.env.NC_CORETEST) this.skip(); // eslint-disable-line no-invalid-this
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
        });

        await assert_throws_async(s3_b.listObjects({ // should fail - bucket owner cwas explicitly denied
            Bucket: BKT_B,
        }));
    });

    mocha.it('should allow acces after adding anonymous access', async function() {
        await s3_owner.putBucketPolicy({ // should work - system owner can always update the buckets policy
            Bucket: BKT,
            Policy: JSON.stringify(anon_access_policy)
        });
        await s3_a.listObjects({
            Bucket: BKT,
        });
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
        });
        await s3_owner.deleteBucketPolicy({ // should work - owner can always delete the buckets policy
            Bucket: BKT,
        });
    });

    mocha.it('anonymous user should be able to list bucket objects', async function() {
        await s3_owner.putBucketPolicy({
            Bucket: BKT,
            Policy: JSON.stringify(anon_access_policy)
        });

        await s3_anon.listObjects({ Bucket: BKT });
    });

    mocha.it('anonymous user should not be able to list bucket objects when there is no policy', async function() {
        await s3_owner.deleteBucketPolicy({
            Bucket: BKT,
        });

        await assert_throws_async(s3_anon.listObjects({ Bucket: BKT }));
    });

    mocha.it('anonymous user should not be able to list bucket objects when policy doesn\'t allow', async function() {
        const anon_deny_policy = {
            Version: '2012-10-17',
            Statement: [
                {
                    Effect: 'Deny',
                    Principal: { AWS: "*" },
                    Action: ['s3:GetObject', 's3:ListBucket'],
                    Resource: [`arn:aws:s3:::*`]
                },
            ]
        };

        await s3_owner.putBucketPolicy({
            Bucket: BKT,
            Policy: JSON.stringify(anon_deny_policy)
        });

        await assert_throws_async(s3_anon.listObjects({ Bucket: BKT }));
    });

    mocha.it('[RPC TEST]: anonymous user should not be able to read_object_md when not explicitly allowed', async function() {
        // MD ops not implemented on NC - skipping
        if (process.env.NC_CORETEST) this.skip(); // eslint-disable-line no-invalid-this
        // Ensure that the bucket has no policy
        await s3_owner.deleteBucketPolicy({
            Bucket: BKT,
        });

        await assert_throws_async(anon_rpc_client.object.read_object_md({
            bucket: BKT,
            key: KEY,
        }), 'requesting account is not authorized to read the object');
    });

    mocha.it('[RPC TEST]: anonymous user should be able to read_object_md when explicitly allowed', async function() {
        // MD ops not implemented on NC - skipping
        if (process.env.NC_CORETEST) this.skip(); // eslint-disable-line no-invalid-this
        const anon_read_policy = {
            Version: '2012-10-17',
            Statement: [
                {
                    Effect: 'Allow',
                    Principal: "*",
                    Action: ['s3:GetObject'],
                    Resource: [`arn:aws:s3:::*`]
                },
            ]
        };
        await s3_owner.putBucketPolicy({
            Bucket: BKT,
            Policy: JSON.stringify(anon_read_policy)
        });

        cross_test_store.obj = await anon_rpc_client.object.read_object_md({
            bucket: BKT,
            key: KEY,
        });
    });

    mocha.it('[RPC TEST]: anonymous user should be able to read_object_md when explicitly allowed to access only specific key', async function() {
        // MD ops not implemented on NC - skipping
        if (process.env.NC_CORETEST) this.skip(); // eslint-disable-line no-invalid-this
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
        });

        cross_test_store.obj = await anon_rpc_client.object.read_object_md({
            bucket: BKT,
            key: KEY,
        });
    });


    mocha.it('[RPC TEST]: anonymous user should not be able to read_object_mapping when not explicitly allowed', async function() {
        // MD ops not implemented on NC - skipping
        if (process.env.NC_CORETEST) this.skip(); // eslint-disable-line no-invalid-this
        // Ensure that the bucket has no policy
        await s3_owner.deleteBucketPolicy({
            Bucket: BKT,
        });

        await assert_throws_async(anon_rpc_client.object.read_object_mapping({
            bucket: BKT,
            key: KEY,
            obj_id: MDStore.instance().make_md_id(cross_test_store.obj.obj_id),
        }), 'requesting account is not authorized to read the object');
    });

    mocha.it('[RPC TEST]: anonymous user should be able to read_object_mapping when explicitly allowed', async function() {
        // MD ops not implemented on NC - skipping
        if (process.env.NC_CORETEST) this.skip(); // eslint-disable-line no-invalid-this
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
        });

        await anon_rpc_client.object.read_object_mapping({
            bucket: BKT,
            key: KEY,
            obj_id: MDStore.instance().make_md_id(cross_test_store.obj.obj_id),
        });
    });

    mocha.it('[RPC TEST]: anonymous user should be able to read_object_mapping when explicitly allowed to access only specific key', async function() {
        // MD ops not implemented on NC - skipping
        if (process.env.NC_CORETEST) this.skip(); // eslint-disable-line no-invalid-this
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
        });

        await anon_rpc_client.object.read_object_mapping({
            bucket: BKT,
            key: KEY,
            obj_id: MDStore.instance().make_md_id(cross_test_store.obj.obj_id),
        });
    });

    mocha.it('should be able to deny based on server side encryption', async function() {
        // SSE not implemented on NC - skipping
        if (process.env.NC_CORETEST) this.skip(); // eslint-disable-line no-invalid-this
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(15000);
        const auth_put_policy = {
            Version: '2012-10-17',
            Statement: [
                {
                    Effect: 'Allow',
                    Principal: { AWS: "*" },
                    Action: ['s3:PutObject'],
                    Resource: [`arn:aws:s3:::${BKT}/${KEY}`]
                },
                {
                    Effect: 'Deny',
                    Principal: { AWS: "*"},
                    Action: ['s3:PutObject'],
                    Resource: [`arn:aws:s3:::${BKT}/${KEY}`],
                    Condition: { "StringNotEquals": { "s3:x-amz-server-side-encryption": "AES256" }}
                },
            ]};
        await s3_owner.putBucketPolicy({
            Bucket: BKT,
            Policy: JSON.stringify(auth_put_policy)
        });

        await s3_a.putObject({
            Body: BODY,
            Bucket: BKT,
            Key: KEY,
            ServerSideEncryption: "AES256"
        });

        await assert_throws_async(s3_a.putObject({
            Body: BODY,
            Bucket: BKT,
            Key: KEY,
            ServerSideEncryption: "aws:kms",
            SSEKMSKeyId: "dummy_key"
        }), 'Access Denied');
    });

    mocha.it('should be able to deny unencrypted object uploads', async function() {
        // SSE not implemented on NC - skipping
        if (process.env.NC_CORETEST) this.skip(); // eslint-disable-line no-invalid-this
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(15000);
        const auth_put_policy = {
            Version: '2012-10-17',
            Statement: [
                {
                    Effect: 'Allow',
                    Principal: { AWS: "*" },
                    Action: ['s3:PutObject'],
                    Resource: [`arn:aws:s3:::${BKT}/${KEY}`]
                },
                {
                    Effect: 'Deny',
                    Principal: { AWS: "*"},
                    Action: ['s3:PutObject'],
                    Resource: [`arn:aws:s3:::${BKT}/${KEY}`],
                    Condition: { "Null": { "s3:x-amz-server-side-encryption": "true" }
                    }
                },
            ]};
        await s3_owner.putBucketPolicy({
            Bucket: BKT,
            Policy: JSON.stringify(auth_put_policy)
        });

        await assert_throws_async(s3_a.putObject({
            Body: BODY,
            Bucket: BKT,
            Key: KEY,
        }), 'Access Denied');

        await s3_a.putObject({
            Body: BODY,
            Bucket: BKT,
            Key: KEY,
            ServerSideEncryption: "AES256"
        });
    });

    mocha.it('should be able to add StringLike and StringEqualsIgnoreCase condition statements, ', async function() {
        // SSE not implemented on NC - skipping
        if (process.env.NC_CORETEST) this.skip(); // eslint-disable-line no-invalid-this
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(15000);
        const ignore_case_policy = {
            Version: '2012-10-17',
            Statement: [
                {
                    Effect: 'Allow',
                    Principal: { AWS: "*" },
                    Action: ['s3:PutObject'],
                    Resource: [`arn:aws:s3:::${BKT}/${KEY}`],
                    Condition: { "StringEqualsIgnoreCase": { "s3:x-amz-server-side-encryption": "aes256" }}
                },
            ]};
            const string_like_policy = {
                Version: '2012-10-17',
                Statement: [
                    {
                        Effect: 'Allow',
                        Principal: { AWS: "*" },
                        Action: ['s3:PutObject'],
                        Resource: [`arn:aws:s3:::${BKT}/${KEY}`],
                        Condition: { "StringLike": { "s3:x-amz-server-side-encryption": "AES*" }}
                    },
                ]};
        await s3_owner.putBucketPolicy({
            Bucket: BKT,
            Policy: JSON.stringify(ignore_case_policy)
        });

        await s3_a.putObject({
            Body: BODY,
            Bucket: BKT,
            Key: KEY,
            ServerSideEncryption: "AES256"
        });

        await s3_owner.putBucketPolicy({
            Bucket: BKT,
            Policy: JSON.stringify(string_like_policy)
        });

        await s3_a.putObject({
            Body: BODY,
            Bucket: BKT,
            Key: KEY,
            ServerSideEncryption: "AES256"
        });
    });

    mocha.it('should be able to deny based on object tag', async function() {
        // Tags not implemented on NC - skipping
        if (process.env.NC_CORETEST) this.skip(); // eslint-disable-line no-invalid-this
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(15000);
        const allow_tag = {key: "key", value: "allow"};
        const deny_tag = {key: "key", value: "deny"};
        const auth_put_policy = {
            Version: '2012-10-17',
            Statement: [
                {
                    Effect: 'Allow',
                    Principal: { AWS: "*" },
                    Action: ['s3:PutObject'],
                    Resource: [`arn:aws:s3:::${BKT}/*`]
                },
                {
                    Effect: 'Allow',
                    Principal: { AWS: "*"},
                    Action: ['s3:GetObject'],
                    Resource: [`arn:aws:s3:::${BKT}/*`],
                    Condition: { 'StringEquals': { [`s3:ExistingObjectTag/${allow_tag.key}`]: allow_tag.value }
                    }
                },
            ]};
        await s3_owner.putBucketPolicy({
            Bucket: BKT,
            Policy: JSON.stringify(auth_put_policy)
        });

        await s3_a.putObject({
            Body: BODY,
            Bucket: BKT,
            Key: KEY,
            Tagging: `${allow_tag.key}=${allow_tag.value}`
        });

        await s3_a.getObject({
            Bucket: BKT,
            Key: KEY
        });

        await s3_a.putObject({
            Body: BODY,
            Bucket: BKT,
            Key: KEY,
            Tagging: `${deny_tag.key}=${deny_tag.value}`
        });

        await assert_throws_async(s3_a.getObject({
            Bucket: BKT,
            Key: KEY
        }));

    });

    mocha.it('get_bucket_policy should return correct condition values', async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(15000);
       const encryption_policy = {
        Version: '2012-10-17',
        Statement: [
            {
                Effect: 'Allow',
                Principal: { AWS: "*" },
                Action: ['s3:GetBucketPolicy'],
                Resource: [`arn:aws:s3:::${BKT}`]
            },
            {
                Effect: 'Deny',
                Principal: { AWS: "*"},
                Action: ['s3:PutObject'],
                Resource: [`arn:aws:s3:::${BKT}/${KEY}`],
                Condition: { "StringNotEquals": { "s3:x-amz-server-side-encryption": "AES256" }}
            },
            {
                Effect: 'Allow',
                Principal: { AWS: "*"},
                Action: ['s3:GetObject'],
                Resource: [`arn:aws:s3:::${BKT}/${KEY}`],
                Condition: { "StringEquals": { "s3:ExistingObjectTag/key": "value" }}
            }
        ]};
       await s3_owner.putBucketPolicy({
            Bucket: BKT,
            Policy: JSON.stringify(encryption_policy)
        });
       const res = await s3_a.getBucketPolicy({Bucket: BKT});
       const policy = JSON.parse(res.Policy);
       const actualEncryptionCondition = policy.Statement[1].Condition;
       assert.strictEqual(Object.keys(actualEncryptionCondition)[0], "StringNotEquals");
       assert.strictEqual(Object.keys(actualEncryptionCondition.StringNotEquals)[0], "s3:x-amz-server-side-encryption");
       assert.strictEqual(Object.values(actualEncryptionCondition.StringNotEquals)[0], "AES256");
       const actualObjectTagCondition = policy.Statement[2].Condition;
       assert.strictEqual(Object.keys(actualObjectTagCondition)[0], "StringEquals");
       assert.strictEqual(Object.keys(actualObjectTagCondition.StringEquals)[0], "s3:ExistingObjectTag/key");
       assert.strictEqual(actualObjectTagCondition.StringEquals["s3:ExistingObjectTag/key"], "value");
    });

    mocha.it('should be able to use notAction', async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(15000);
        const auth_put_policy = {
        Version: '2012-10-17',
        Statement: [
            {
                Effect: 'Allow',
                Principal: { AWS: "*" },
                NotAction: ['s3:GetObject'],
                Resource: [`arn:aws:s3:::${BKT}/*`]
            }
        ]};
        await s3_owner.putBucketPolicy({
            Bucket: BKT,
            Policy: JSON.stringify(auth_put_policy)
        });

        await s3_a.putObject({
            Body: BODY,
            Bucket: BKT,
            Key: KEY,
        });

        await assert_throws_async(s3_a.getObject({
            Bucket: BKT,
            Key: KEY
        }));
    });

    mocha.it.skip('should be able to use notPrincipal', async function() {
        //This test is broken - Effect Allow can't be used with NotPrincipal.
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(15000);
        const auth_put_policy = {
        Version: '2012-10-17',
        Statement: [
            {
                Effect: 'Allow',
                NotPrincipal: { AWS: user_a },
                Action: ['s3:PutObject'],
                Resource: [`arn:aws:s3:::${BKT}/*`]
            }
        ]};
        await s3_owner.putBucketPolicy({
            Bucket: BKT,
            Policy: JSON.stringify(auth_put_policy)
        });

        await s3_b.putObject({
            Body: BODY,
            Bucket: BKT,
            Key: KEY,
        });

        await assert_throws_async(s3_a.putObject({
            Body: BODY,
            Bucket: BKT,
            Key: KEY,
        }));
    });

    mocha.it('should be able to use notResource', async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(15000);
        const auth_put_policy = {
        Version: '2012-10-17',
        Statement: [
            {
                Effect: 'Allow',
                Principal: { AWS: user_a },
                Action: ['s3:PutObject'],
                NotResource: [`arn:aws:s3:::${BKT}/*`]
            }
        ]};
        await s3_owner.putBucketPolicy({
            Bucket: BKT,
            Policy: JSON.stringify(auth_put_policy)
        });

        await s3_b.putObject({
            Body: BODY,
            Bucket: BKT_B,
            Key: KEY,
        });

        await assert_throws_async(s3_a.putObject({
            Body: BODY,
            Bucket: BKT,
            Key: KEY,
        }));
    });

    mocha.describe('should only one of Argument or NotArgument', async function() {

        mocha.it('should not allow both Action and NotAction', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(15000);
            const s3_policy = {
                Version: '2012-10-17',
                Statement: [
                    {
                        Effect: 'Allow',
                        Principal: { AWS: user_a },
                        Action: ['s3:PutObject'],
                        NotAction: ['s3:GetObject'],
                        Resource: [`arn:aws:s3:::${BKT}/*`]
                    }
                ]};
            try {
                await s3_owner.putBucketPolicy({
                    Bucket: BKT,
                    Policy: JSON.stringify(s3_policy)
                });
                assert.fail('Test was suppose to fail on ' + S3Error.MalformedPolicy.code);
            } catch (err) {
                if (err.Code !== S3Error.MalformedPolicy.code) {
                    throw err;
                }
            }
        });

        mocha.it('should not allow both Principal and NotPrincipal', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(15000);
            const s3_policy = {
                Version: '2012-10-17',
                Statement: [
                    {
                        Effect: 'Allow',
                        Principal: { AWS: user_a },
                        NotPrincipal: { AWS: user_a },
                        Action: ['s3:PutObject'],
                        Resource: [`arn:aws:s3:::${BKT}/*`]
                    }
                ]};
            try {
                await s3_owner.putBucketPolicy({
                    Bucket: BKT,
                    Policy: JSON.stringify(s3_policy)
                });
                assert.fail('Test was suppose to fail on ' + S3Error.MalformedPolicy.code);
            } catch (err) {
                if (err.Code !== S3Error.MalformedPolicy.code) {
                    throw err;
                }
            }
        });

        mocha.it('should not allow both Resource and NotResource', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(15000);
            const s3_policy = {
                Version: '2012-10-17',
                Statement: [
                    {
                        Effect: 'Allow',
                        Principal: { AWS: user_a },
                        Action: ['s3:PutObject'],
                        Resource: [`arn:aws:s3:::${BKT}/*`],
                        NotResource: [`arn:aws:s3:::${BKT}/*`]
                    }
                ]};
            try {
                await s3_owner.putBucketPolicy({
                    Bucket: BKT,
                    Policy: JSON.stringify(s3_policy)
                });
                assert.fail('Test was suppose to fail on ' + S3Error.MalformedPolicy.code);
            } catch (err) {
                if (err.Code !== S3Error.MalformedPolicy.code) {
                    throw err;
                }
            }
        });

        mocha.it('should not allow policy without Principal or notPrincipal', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(15000);
            const s3_policy = {
                Version: '2012-10-17',
                Statement: [
                    {
                        Effect: 'Allow',
                        Action: ['s3:PutObject'],
                        Resource: [`arn:aws:s3:::${BKT}/*`],
                    }
                ]};
            try {
                await s3_owner.putBucketPolicy({
                    Bucket: BKT,
                    Policy: JSON.stringify(s3_policy)
                });
                assert.fail('Test was suppose to fail on ' + S3Error.MalformedPolicy.code);
            } catch (err) {
                if (err.Code !== S3Error.MalformedPolicy.code) {
                    throw err;
                }
            }
        });

        mocha.it('should not allow policy without Resource or notResource', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(15000);
            const s3_policy = {
                Version: '2012-10-17',
                Statement: [
                    {
                        Effect: 'Allow',
                        Principal: { AWS: user_a },
                        Action: ['s3:PutObject'],
                    }
                ]};
            try {
                await s3_owner.putBucketPolicy({
                    Bucket: BKT,
                    Policy: JSON.stringify(s3_policy)
                });
                assert.fail('Test was suppose to fail on ' + S3Error.MalformedPolicy.code);
            } catch (err) {
                if (err.Code !== S3Error.MalformedPolicy.code) {
                    throw err;
                }
            }
        });

        mocha.it('should not allow policy without action or notAction', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(15000);
            const s3_policy = {
                Version: '2012-10-17',
                Statement: [
                    {
                        Effect: 'Allow',
                        Principal: { AWS: user_a },
                        Resource: [`arn:aws:s3:::${BKT}/*`],
                    }
                ]};
            try {
                await s3_owner.putBucketPolicy({
                    Bucket: BKT,
                    Policy: JSON.stringify(s3_policy)
                });
                assert.fail('Test was suppose to fail on ' + S3Error.MalformedPolicy.code);
            } catch (err) {
                if (err.Code !== S3Error.MalformedPolicy.code) {
                    throw err;
                }
            }
        });

        mocha.it('should not allow invalid json', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(15000);
            const s3_policy = "this is not a json";
            try {
                await s3_owner.putBucketPolicy({
                    Bucket: BKT,
                    Policy: s3_policy
                });
                assert.fail('Test was suppose to fail on ' + S3Error.MalformedPolicy.code);
            } catch (err) {
                if (err.Code !== S3Error.MalformedPolicy.code) {
                    throw err;
                }
            }
        });
    });

    mocha.describe('get-bucket-policy status should work', async function() {

        mocha.it('get-bucket-policy status should return true for public policy', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(15000);
            const s3_policy = {
                Version: '2012-10-17',
                //Effect allow and principal equals '*'. public policy
                Statement: [
                    {
                        Action: ['s3:PutObject'],
                        Effect: 'Allow',
                        Principal: { AWS: "*" },
                        Resource: [`arn:aws:s3:::${BKT}/*`],
                    }
                ]};
            await s3_owner.putBucketPolicy({
                Bucket: BKT,
                Policy: JSON.stringify(s3_policy)
            });
            const res = await s3_owner.getBucketPolicyStatus({Bucket: BKT});
            assert.strictEqual(res.PolicyStatus.IsPublic, true);
        });

        mocha.it('get-bucket-policy status should return false for non "*" principal', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(15000);
            const s3_policy = {
                Version: '2012-10-17',
                Statement: [
                    {
                        Action: ['s3:PutObject'],
                        Effect: 'Allow',
                        Principal: { AWS: user_a }, //principal is user
                        Resource: [`arn:aws:s3:::${BKT}/*`],
                    }
                ]};
            await s3_owner.putBucketPolicy({
                Bucket: BKT,
                Policy: JSON.stringify(s3_policy)
            });
            const res = await s3_owner.getBucketPolicyStatus({Bucket: BKT});
            assert.strictEqual(res.PolicyStatus.IsPublic, false);
        });

        mocha.it('get-bucket-policy status should return false for Deny actions', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(15000);
            const s3_policy = {
                Version: '2012-10-17',
                Statement: [
                    {
                        Action: ['s3:PutObject'],
                        Effect: 'Deny',
                        Principal: { AWS: "*" },
                        Resource: [`arn:aws:s3:::${BKT}/*`],
                    }
                ]};
            await s3_owner.putBucketPolicy({
                Bucket: BKT,
                Policy: JSON.stringify(s3_policy)
            });
            const res = await s3_owner.getBucketPolicyStatus({Bucket: BKT});
            assert.strictEqual(res.PolicyStatus.IsPublic, false);
        });

        mocha.it('get-bucket-policy status should work for pricipal as a string', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(15000);
            const s3_policy = {
                Version: '2012-10-17',
                Statement: [
                    {
                        Action: ['s3:PutObject'],
                        Effect: 'Allow',
                        Principal: "*",
                        Resource: [`arn:aws:s3:::${BKT}/*`],
                    }
                ]};
            await s3_owner.putBucketPolicy({
                Bucket: BKT,
                Policy: JSON.stringify(s3_policy)
            });
            const res = await s3_owner.getBucketPolicyStatus({Bucket: BKT});
            assert.strictEqual(res.PolicyStatus.IsPublic, true);
        });

        mocha.it('get-bucket-policy principal should return true if at least one statement is public with principal * ', async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(15000);
            const s3_policy = {
                Version: '2012-10-17',
                Statement: [
                    {
                        Action: ['s3:PutObject'],
                        Effect: 'Allow',
                        Principal: "*",
                        Resource: [`arn:aws:s3:::${BKT}/*`],
                    },
                    {
                        Action: ['s3:GetObject'],
                        Effect: 'Deny',
                        Principal: "*",
                        Resource: [`arn:aws:s3:::${BKT}/*`],
                    }
                ]};
            await s3_owner.putBucketPolicy({
                Bucket: BKT,
                Policy: JSON.stringify(s3_policy)
            });
            const res = await s3_owner.getBucketPolicyStatus({Bucket: BKT});
            assert.strictEqual(res.PolicyStatus.IsPublic, true);
        });
    });
});
