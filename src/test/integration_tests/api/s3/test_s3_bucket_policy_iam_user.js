/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const config = require('../../../../../config');
config.OBJECT_SDK_ACCOUNT_CACHE_EXPIRY_MS = 1;
const { require_coretest, TMP_PATH, generate_iam_client, is_nc_coretest } = require('../../../system_tests/test_utils');
const coretest = require_coretest();
const { rpc_client, EMAIL, POOL_LIST } = coretest;
coretest.setup({ pools_to_create: process.env.NC_CORETEST ? undefined : [POOL_LIST[1]] });
const path = require('path');
const fs_utils = require('../../../../util/fs_utils');

const { S3 } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require("@smithy/node-http-handler");
const http = require('http');
const mocha = require('mocha');
const assert = require('assert');

async function assert_throws_async(promise, expected_message = 'Access Denied') {
    try {
        await promise;
        assert.fail('Test was supposed to fail with ' + expected_message);
    } catch (err) {
        if (err.message !== expected_message) {
            throw err;
        }
    }
}

const { CreateUserCommand, CreateAccessKeyCommand, PutUserPolicyCommand, GetUserPolicyCommand,
        DeleteAccessKeyCommand, DeleteUserPolicyCommand, DeleteUserCommand} = require('@aws-sdk/client-iam');

const BKT = 'iam-bucket-policy-ops';
const BKT_B = 'iam-bucket-policy-ops-1';
const BKT_C = 'iam-bucket-policy-ops-2';

const policy_name = 'AllAccessPolicy';
const allow_all_iam_user_inline_policy_document = '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:*"],"Resource":"*"}]}';

const deny_all_iam_user_inline_policy_document = '{"Version":"2012-10-17","Statement":[{"Effect":"Deny","Action":["s3:*"],"Resource":"*"}]}';

const KEY = 'file1.txt';
const user_a = 'allen';
const user_b = 'ben';
const BODY = "Some data for the file... bla bla bla... ";
let s3_account_b;
let s3_owner;

let s3_user_a;
let s3_user_b;

let user_a_arn;
let user_b_arn;

// the account creation details (in NC we want to use them)
let a_account_details;
let b_account_details;

let user_a_id;

let admin_info;


let iam_account_a;
let iam_account_b;

let iam_user_a_s3_creds;
let iam_user_b_s3_creds;

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
            new_buckets_path: tmp_fs_root
        };
    }
    admin_info = (await rpc_client.account.read_account({
        email: EMAIL,
    }));
    const admin_keys = admin_info.access_keys;
    account.name = user_a;
    account.email = user_a;
    a_account_details = await rpc_client.account.create_account(account);
    console.log('a_account_details', a_account_details);
    const user_a_keys = a_account_details.access_keys;
    account.name = user_b;
    account.email = user_b;
    b_account_details = await rpc_client.account.create_account(account);
    console.log('b_account_details', b_account_details);
    const user_b_keys = b_account_details.access_keys;
    s3_creds.credentials = {
        accessKeyId: user_b_keys[0].access_key.unwrap(),
        secretAccessKey: user_b_keys[0].secret_key.unwrap(),
    };
    s3_account_b = new S3(s3_creds);
    await s3_account_b.createBucket({ Bucket: BKT_B });
    s3_creds.credentials = {
        accessKeyId: admin_keys[0].access_key.unwrap(),
        secretAccessKey: admin_keys[0].secret_key.unwrap(),
    };
    const coretest_endpoint_iam = coretest.get_https_address_iam();
    iam_account_a = generate_iam_client(user_a_keys[0].access_key.unwrap(), user_a_keys[0].secret_key.unwrap(), coretest_endpoint_iam);
    iam_account_b = generate_iam_client(user_b_keys[0].access_key.unwrap(), user_b_keys[0].secret_key.unwrap(), coretest_endpoint_iam);

    s3_owner = new S3(s3_creds);
    await s3_owner.createBucket({ Bucket: BKT });
    await s3_owner.createBucket({ Bucket: BKT_C });

    iam_user_a_s3_creds = {
        endpoint: coretest.get_http_address(),
        forcePathStyle: true,
        region: config.DEFAULT_REGION,
        requestHandler: new NodeHttpHandler({
            httpAgent: new http.Agent({ keepAlive: false })
        }),
    };
    iam_user_b_s3_creds = {
        endpoint: coretest.get_http_address(),
        forcePathStyle: true,
        region: config.DEFAULT_REGION,
        requestHandler: new NodeHttpHandler({
            httpAgent: new http.Agent({ keepAlive: false })
        }),
    };

}

mocha.describe('Integration between IAM and S3 bucket policy', async function() {
    // Skip tests for other DB's
    if (config.DB_TYPE !== 'postgres') return;

    mocha.before(setup);
    mocha.after(async function() {
        this.timeout(60000); // eslint-disable-line no-invalid-this

        // Delete buckets first (before accounts can be deleted)
        await s3_owner.deleteBucket({ Bucket: BKT }).catch(() => { /* ignore */ });
        await s3_owner.deleteBucket({ Bucket: BKT_C }).catch(() => { /* ignore */ });
        await s3_account_b.deleteBucket({ Bucket: BKT_B }).catch(() => { /* ignore */ });

        // Clean up accounts
        const input_a = {
            UserName: user_a,
            AccessKeyId: iam_user_a_s3_creds.credentials.accessKeyId
        };
        const command_access_a = new DeleteAccessKeyCommand(input_a);
        const response_access_a = await iam_account_a.send(command_access_a);
        _check_status_code_ok(response_access_a);

        const inline_input = {
            UserName: user_a,
            PolicyName: policy_name,
        };
        const command_policy_a = new DeleteUserPolicyCommand(inline_input);
        const response_policy_a = await iam_account_a.send(command_policy_a);
        _check_status_code_ok(response_policy_a);

        const delete_input = {
            UserName: user_a,
        };
        const command_delete_a = new DeleteUserCommand(delete_input);
        const response_delete_a = await iam_account_a.send(command_delete_a);
        _check_status_code_ok(response_delete_a);

        //
        const input_b = {
            UserName: user_b,
            AccessKeyId: iam_user_b_s3_creds.credentials.accessKeyId
        };
        const command_access_b = new DeleteAccessKeyCommand(input_b);
        const response_access_b = await iam_account_b.send(command_access_b);
        _check_status_code_ok(response_access_b);

        const inline_inpu_b = {
            UserName: user_b,
            PolicyName: policy_name,
        };
        const command_policy_b = new DeleteUserPolicyCommand(inline_inpu_b);
        const response_policy_b = await iam_account_b.send(command_policy_b);
        _check_status_code_ok(response_policy_b);

        const delete_input_b = {
            UserName: user_b,
        };
        const command_delete_b = new DeleteUserCommand(delete_input_b);
        const response_delete_b = await iam_account_b.send(command_delete_b);
        _check_status_code_ok(response_delete_b);

        await rpc_client.account.delete_account({ email: user_a });
        await rpc_client.account.delete_account({ email: user_b });
    });

    mocha.it('IAM User access bucket with Bucket policy', async function() {
        if (is_nc_coretest) this.skip(); // eslint-disable-line no-invalid-this
        const input = {
            UserName: user_a
        };
        // 1. Create IAM user account
        const command = new CreateUserCommand(input);
        const response = await iam_account_a.send(command);
        _check_status_code_ok(response);
        assert.equal(response.User.UserName, user_a);
        user_a_arn = response.User.Arn;
        user_a_id = response.User.UserId;
        // 2. Create bucket policy with that IAM user and add to bucket
        const s3_policy = {
            Version: '2012-10-17',
            Statement: [
                {
                    Action: ['s3:PutObject'],
                    Effect: 'Allow',
                    Principal: { AWS: [user_a_arn] },
                    Resource: [`arn:aws:s3:::${BKT}/*`],
                }
            ]};

        await s3_owner.putBucketPolicy({
            Bucket: BKT,
            Policy: JSON.stringify(s3_policy)
        });
        const res_get_bucket_policy = await s3_owner.getBucketPolicy({
            Bucket: BKT,
        });
        assert.equal(res_get_bucket_policy.$metadata.httpStatusCode, 200);
        // 3. Create access and secret key for the IAM user
        const access_command = new CreateAccessKeyCommand(input);
        const access_response = await iam_account_a.send(access_command);

        const access_key_id = access_response.AccessKey.AccessKeyId;
        const secret_key = access_response.AccessKey.SecretAccessKey;
        assert(access_key_id !== undefined);

        // 4. Add inline policy to IAM user, without inline policy S3 access will fail.
        const inline_input = {
            UserName: user_a,
            PolicyName: policy_name,
            PolicyDocument: allow_all_iam_user_inline_policy_document
        };
        const inline_command = new PutUserPolicyCommand(inline_input);
        const inline_response = await iam_account_a.send(inline_command);
        _check_status_code_ok(inline_response);

        // 5. Try to put object to bucket with IAM user s3 client, Should not fail
        iam_user_a_s3_creds.credentials = {
            accessKeyId: access_key_id,
            secretAccessKey: secret_key,
        };
        s3_user_a = new S3(iam_user_a_s3_creds);
        const res_put_object = await s3_user_a.putObject({
            Body: BODY,
            Bucket: BKT,
            Key: KEY,
        });
        assert.equal(res_put_object.$metadata.httpStatusCode, 200);
        await s3_owner.deleteObject({
            Bucket: BKT,
            Key: KEY
        });
    });

    mocha.it('IAM User access bucket that its owner account owns (no bucket policy)', async function() {
        if (is_nc_coretest) this.skip(); // eslint-disable-line no-invalid-this
        const input = {
            UserName: user_b
        };
        // 1. Create IAM user account
        const command = new CreateUserCommand(input);
        const response_b = await iam_account_b.send(command);
        _check_status_code_ok(response_b);
        assert.equal(response_b.User.UserName, user_b);
        user_b_arn = response_b.User.Arn;
        // 2. Create access and secret key for the IAM user
        const access_command = new CreateAccessKeyCommand(input);
        const access_response = await iam_account_b.send(access_command);

        const access_key_id = access_response.AccessKey.AccessKeyId;
        const secret_key = access_response.AccessKey.SecretAccessKey;
        assert(access_key_id !== undefined);

        // 3. Add inline policy to account, without inline policy S3 access will fail.
        const inline_input = {
            UserName: user_b,
            PolicyName: policy_name,
            PolicyDocument: allow_all_iam_user_inline_policy_document,
        };
        const inline_command = new PutUserPolicyCommand(inline_input);
        const inline_response = await iam_account_b.send(inline_command);
        _check_status_code_ok(inline_response);

        // 5. Try to put object to bucket with IAM user s3 client, Should not fail
        iam_user_b_s3_creds.credentials = {
            accessKeyId: access_key_id,
            secretAccessKey: secret_key,
        };
        s3_user_b = new S3(iam_user_b_s3_creds);
        const res_put_object = await s3_user_b.putObject({
            Body: BODY,
            Bucket: BKT_B,
            Key: KEY,
        });
        assert.equal(res_put_object.$metadata.httpStatusCode, 200);
        await s3_account_b.deleteObject({
            Bucket: BKT_B,
            Key: KEY
        });
    });

    mocha.it('Should fail: IAM user\'s owner account owns the bucket with bucket policy', async function() {
        if (is_nc_coretest) this.skip(); // eslint-disable-line no-invalid-this
        const s3_policy = {
            Version: '2012-10-17',
            Statement: [
                {
                    Action: ['s3:PutObject'],
                    Effect: 'Allow',
                    Principal: { AWS: [user_a_arn] },
                    Resource: [`arn:aws:s3:::${BKT_B}/*`],
                }
            ]};

        await s3_account_b.putBucketPolicy({
            Bucket: BKT_B,
            Policy: JSON.stringify(s3_policy)
        });
        const res_get_bucket_policy = await s3_account_b.getBucketPolicy({
            Bucket: BKT_B,
        });
        assert.equal(res_get_bucket_policy.$metadata.httpStatusCode, 200);

        s3_user_b = new S3(iam_user_b_s3_creds);
        // If there is bucket policy, owner account bucket access is denied for user.
        await assert_throws_async(s3_user_b.putObject({
            Body: BODY,
            Bucket: BKT_B,
            Key: KEY,
        }));
    });

    mocha.it('Should fail : Bucket policy with IAM User ID not supported', async function() {
        if (is_nc_coretest) this.skip(); // eslint-disable-line no-invalid-this
        const s3_policy = {
            Version: '2012-10-17',
            Statement: [
                {
                    Action: ['s3:PutObject'],
                    Effect: 'Allow',
                    Principal: { AWS: [user_a_id] },
                    Resource: [`arn:aws:s3:::${BKT}/*`],
                }
            ]};
        await assert_throws_async(s3_owner.putBucketPolicy({
            Bucket: BKT,
            Policy: JSON.stringify(s3_policy)
        }), 'Invalid principal in policy');
    });

    mocha.it('Should fail: IAM policy deny all the access for IAM user', async function() {
        if (is_nc_coretest) this.skip(); // eslint-disable-line no-invalid-this
        const inline_input = {
            UserName: user_b,
            PolicyName: policy_name,
            PolicyDocument: deny_all_iam_user_inline_policy_document,
        };
        const inline_command = new PutUserPolicyCommand(inline_input);
        const inline_response = await iam_account_b.send(inline_command);
        _check_status_code_ok(inline_response);

        const inline_get_command = new GetUserPolicyCommand(inline_input);
        const inline_get_response = await iam_account_b.send(inline_get_command);
        _check_status_code_ok(inline_get_response);
        assert.equal(JSON.parse(inline_get_response.PolicyDocument).Statement[0].Effect,
            JSON.parse(deny_all_iam_user_inline_policy_document).Statement[0].Effect);

        const s3_policy = {
            Version: '2012-10-17',
            Statement: [
                {
                    Action: ['s3:PutObject'],
                    Effect: 'Allow',
                    Principal: { AWS: [user_b_arn] },
                    Resource: [`arn:aws:s3:::${BKT_B}/*`],
                }
            ]};
        s3_user_b = new S3(iam_user_b_s3_creds);
        await s3_account_b.putBucketPolicy({
            Bucket: BKT_B,
            Policy: JSON.stringify(s3_policy)
        });
        const res_get_bucket_policy = await s3_account_b.getBucketPolicy({
            Bucket: BKT_B,
        });
        assert.equal(res_get_bucket_policy.$metadata.httpStatusCode, 200);

        // IAM policy deny all the access
        try {
            await s3_user_b.putObject({
                Body: BODY,
                Bucket: BKT_B,
                Key: KEY,
            });
        } catch (err) {
            if (err.Code !== 'AccessDenied') {
                throw err;
            }
        }
    });

    mocha.it('Should fail: IAM policy Allow all the access for IAM user but bucket policy Deny access', async function() {
        if (is_nc_coretest) this.skip(); // eslint-disable-line no-invalid-this
        const inline_input = {
            UserName: user_b,
            PolicyName: policy_name,
            PolicyDocument: allow_all_iam_user_inline_policy_document,
        };
        const inline_command = new PutUserPolicyCommand(inline_input);
        const inline_response = await iam_account_b.send(inline_command);
        _check_status_code_ok(inline_response);

        const inline_get_command = new GetUserPolicyCommand(inline_input);
        const inline_get_response = await iam_account_b.send(inline_get_command);
        _check_status_code_ok(inline_get_response);
        assert.equal(JSON.parse(inline_get_response.PolicyDocument).Statement[0].Effect,
            JSON.parse(allow_all_iam_user_inline_policy_document).Statement[0].Effect);

        const s3_policy = {
            Version: '2012-10-17',
            Statement: [
                {
                    Action: ['s3:PutObject'],
                    Effect: 'Deny',
                    Principal: { AWS: [user_b_arn] },
                    Resource: [`arn:aws:s3:::${BKT_B}/*`],
                }
            ]};
        s3_user_b = new S3(iam_user_b_s3_creds);
        await s3_account_b.putBucketPolicy({
            Bucket: BKT_B,
            Policy: JSON.stringify(s3_policy)
        });
        const res_get_bucket_policy = await s3_account_b.getBucketPolicy({
            Bucket: BKT_B,
        });
        assert.equal(res_get_bucket_policy.$metadata.httpStatusCode, 200);

        // Bucket policy deny overrides IAM policy allow
        await assert_throws_async(s3_user_b.putObject({
            Body: BODY,
            Bucket: BKT_B,
            Key: KEY,
        }));
        await s3_account_b.deleteObject({
            Bucket: BKT_B,
            Key: KEY,
        });
    });

    mocha.it('NotPrincipal with Effect Deny should exclude IAM user from deny', async function() {
        // requires both the IAM user ARN and its root account ARN in NotPrincipal
        // Ref: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_notprincipal.html
        if (is_nc_coretest) this.skip(); // eslint-disable-line no-invalid-this

        const test_key = 'notprincipal-iam-test.txt';

        // ensure IAM users have allow_all inline policy (required for S3 access)
        await iam_account_a.send(new PutUserPolicyCommand({
            UserName: user_a,
            PolicyName: policy_name,
            PolicyDocument: allow_all_iam_user_inline_policy_document
        }));

        const account_a_id = user_a_arn.split(':')[4];
        const root_account_a_arn = `arn:aws:iam::${account_a_id}:root`;

        const s3_policy = {
            Version: '2012-10-17',
            Statement: [
                {
                    Effect: 'Allow',
                    Principal: { AWS: [user_a_arn] },
                    Action: ['s3:*'],
                    Resource: [`arn:aws:s3:::${BKT_B}`, `arn:aws:s3:::${BKT_B}/*`]
                },
                {
                    Effect: 'Deny',
                    NotPrincipal: { AWS: [user_a_arn, root_account_a_arn] }, // user_a and its root account (required) excluded from the deny
                    Action: ['s3:GetObject'],
                    Resource: [`arn:aws:s3:::${BKT_B}/*`]
                }
            ]
        };

        await s3_account_b.putBucketPolicy({ Bucket: BKT_B, Policy: JSON.stringify(s3_policy) });
        await s3_account_b.putObject({ Body: BODY, Bucket: BKT_B, Key: test_key });

        const res = await s3_user_a.getObject({ Bucket: BKT_B, Key: test_key });
        assert.equal(res.$metadata.httpStatusCode, 200);

        await assert_throws_async(s3_account_b.getObject({ Bucket: BKT_B, Key: test_key }));

        // cleanup
        await s3_account_b.deleteObject({ Bucket: BKT_B, Key: test_key });
        await s3_account_b.deleteBucketPolicy({ Bucket: BKT_B });
    });
});


/**
 * _check_status_code_ok is an helper function to check that we got an response from the server
 * @param {{ $metadata: { httpStatusCode: number; }; }} response
 */
function _check_status_code_ok(response) {
    assert.equal(response.$metadata.httpStatusCode, 200);
}
