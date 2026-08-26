/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const { require_coretest, is_nc_coretest, generate_iam_client,
    generate_s3_client, generate_sts_client, err_code } = require('../../../system_tests/test_utils');
const coretest = require_coretest();

const path = require('path');
const fs = require('fs');
const mocha = require('mocha');
const assert = require('assert');
const jwt = require('jsonwebtoken');
const stsErr = require('../../../../endpoint/sts/sts_errors').StsError;
const dbg = require('../../../../util/debug_module')(__filename);
const cloud_utils = require('../../../../util/cloud_utils');
const jwt_utils = require('../../../../util/jwt_utils');
const config = require('../../../../../config');
const ldap_client = require('../../../../util/ldap_client');
const { S3Error } = require('../../../../endpoint/s3/s3_errors');
const { CreateRoleCommand, DeleteRoleCommand, DeleteRolePolicyCommand,
    PutRolePolicyCommand, UpdateAssumeRolePolicyCommand,
    CreateUserCommand, CreateAccessKeyCommand, DeleteAccessKeyCommand, DeleteUserCommand,
    PutUserPolicyCommand, DeleteUserPolicyCommand} = require('@aws-sdk/client-iam');
const { AssumeRoleCommand, AssumeRoleWithWebIdentityCommand } = require('@aws-sdk/client-sts');
const { PutPublicAccessBlockCommand } = require('@aws-sdk/client-s3');
const defualt_expiry_seconds = Math.ceil(config.STS_DEFAULT_SESSION_TOKEN_EXPIRY_MS / 1000);


let setup_options;
if (is_nc_coretest) {
    setup_options = { should_run_iam: true, https_port_iam: 7005, debug: 5 };
} else {
    setup_options = { pools_to_create: [coretest.POOL_LIST[1]] };
}
coretest.setup(setup_options);

const errors = {
    expired_token_s3: {
        code: S3Error.ExpiredToken.code,
        message: S3Error.ExpiredToken.message
    },
    expired_token: {
        code: stsErr.ExpiredToken.code,
        message: stsErr.ExpiredToken.message
    },
    invalid_token_s3: {
        code: S3Error.InvalidToken.code,
        message: S3Error.InvalidToken.message
    },
    invalid_token: {
        code: stsErr.InvalidClientTokenId.code,
        message: stsErr.InvalidClientTokenId.message
    },
    access_denied: {
        code: stsErr.AccessDeniedException.code,
        message: stsErr.AccessDeniedException.message
    },
    s3_access_denied: {
        code: S3Error.AccessDenied.code,
        message: S3Error.AccessDenied.message
    },
    invalid_access_key: {
        code: S3Error.InvalidAccessKeyId.code,
        message: S3Error.InvalidAccessKeyId.message
    },
    signature_doesnt_match: {
        code: S3Error.SignatureDoesNotMatch.code,
        message: S3Error.SignatureDoesNotMatch.message
    },
    invalid_action: {
        code: stsErr.InvalidAction.code,
        message: stsErr.InvalidAction.message
    },
    validation_error: {
        code: stsErr.ValidationError.code,
        message: stsErr.ValidationError.message
    },
    invalid_schema_params: {
        code: 'INVALID_SCHEMA_PARAMS',
        message: 'INVALID_SCHEMA_PARAMS CLIENT account_api#/methods/create_account'
    },
    malformed_policy: {
        rpc_code: 'MALFORMED_POLICY',
        message_principal: 'Invalid principal in policy',
        message_action: 'Policy has invalid action'
    },
    invalid_role_config: { // NC CLI error
        rpc_code: 'InvalidRoleConfig',
        message_invalid_effect: 'effect must be "allow" or "deny"',
        message_role_name: 'role_config must have a non-empty string "role_name"',
        message_assume_role_policy: 'role_config.assume_role_policy must have a non-empty "statement" array',
        message_invalid_action: 'Policy has invalid action'
    }
};

mocha.describe('STS tests', function() {
    const { rpc_client, EMAIL } = coretest;
    const user_a = 'alice1';
    const user_b = 'bob1';
    const user_c = 'charlie1';

    let account_info_a;
    let account_info_b;
    let account_info_c;

    let sts_admin;
    let sts;
    let sts_c;
    let anon_sts;
    let admin_keys;
    let user_b_key;
    const role_b = 'RoleB';
    let accounts = [];

    let user_b_id = '';

    /** @type {import('@aws-sdk/client-iam').IAMClient} */
    let iam_client_b;
    let user_b_keys;

    mocha.before(async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);
        const account = { has_login: false, s3_access: true };
        if (is_nc_coretest) {
            account.nsfs_account_config = {
                uid: process.getuid(),
                gid: process.getgid(),
                new_buckets_path: coretest.NC_CORETEST_STORAGE_PATH,
            };
        }
        admin_keys = (await rpc_client.account.read_account({ email: EMAIL })).access_keys;
        sts_admin = generate_sts_client(
            admin_keys[0].access_key.unwrap(),
            admin_keys[0].secret_key.unwrap(),
            coretest.get_https_address_sts());
        account.name = user_a;
        account.email = user_a;
        // In NC mode, the system owner bypass in sts_rest.js is skipped (no system_store).
        // Add the admin email to the principal list so the admin can assume role b.
        const policy = {
            Version: '2012-10-17',
            Statement: [{
                Effect: 'Allow',
                Principal: is_nc_coretest ? {AWS: [user_c, EMAIL]} : {AWS: [user_c]},
                Action: ['sts:AssumeRole'],
            }]
        };
        const user_a_keys = (await rpc_client.account.create_account(account)).access_keys;
        account_info_a = await rpc_client.account.read_account({ email: user_a });
        const user_c_keys = (await rpc_client.account.create_account({ ...account, email: user_c, name: user_c })).access_keys;
        account_info_c = await rpc_client.account.read_account({ email: user_c });
        user_b_keys = (await rpc_client.account.create_account({
            ...account,
            email: user_b,
            name: user_b,
        })).access_keys;

        user_b_key = user_b_keys[0].access_key.unwrap();
        account_info_b = await rpc_client.account.read_account({ email: user_b });
        user_b_id = account_info_b._id.toString();

        // Build an IAM client authenticated as the role-owner account
        iam_client_b = generate_iam_client(
            user_b_keys[0].access_key.unwrap(),
            user_b_keys[0].secret_key.unwrap(),
            coretest.get_https_address_iam()
        );

        await iam_client_b.send(new CreateRoleCommand({
            RoleName: role_b,
            AssumeRolePolicyDocument: JSON.stringify(policy),
        }));
        await iam_client_b.send(new PutRolePolicyCommand({
            RoleName: role_b,
            PolicyName: 'Role_B_S3Access',
            PolicyDocument: JSON.stringify({
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Action: ['s3:*'],
                    Resource: ['arn:aws:s3:::first.bucket/*', 'arn:aws:s3:::first.bucket'],
                }],
            }),
        }));


        const s3accesspolicy = {
            Version: '2012-10-17',
            Statement: [{
                Effect: 'Allow',
                Principal: { AWS: is_nc_coretest ? [user_a, user_b, user_c] : [`arn:aws:iam::${account_info_a._id.toString()}:root`, // existing gap in config_fs.is_account_exists_by_principal for NC, adding all users to be consistent with non-NC mode
                    `arn:aws:iam::${account_info_b._id.toString()}:root`,
                    `arn:aws:iam::${account_info_c._id.toString()}:root`] },
                Action: ['s3:*'],
                Resource: ['arn:aws:s3:::first.bucket/*', 'arn:aws:s3:::first.bucket'],
            }]
        };

        sts = generate_sts_client(
            user_a_keys[0].access_key.unwrap(),
            user_a_keys[0].secret_key.unwrap(),
            coretest.get_https_address_sts());
        sts_c = generate_sts_client(
            user_c_keys[0].access_key.unwrap(),
            user_c_keys[0].secret_key.unwrap(),
            coretest.get_https_address_sts());
        const random_access_keys = cloud_utils.generate_access_keys();
        anon_sts = generate_sts_client(
            random_access_keys.access_key.unwrap(),
            random_access_keys.secret_key.unwrap(),
            coretest.get_https_address_sts());
        accounts = accounts.concat([user_a, user_b, user_c]);

        // Allow all of the accounts full access over 'first.bucket'
        await rpc_client.bucket.put_bucket_policy({
            name: 'first.bucket',
            policy: s3accesspolicy,
        });
    });

    mocha.after(async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);
        await iam_client_b.send(new DeleteRolePolicyCommand({
            RoleName: role_b, PolicyName: 'Role_B_S3Access',
        }));
        await iam_client_b.send(new DeleteRoleCommand({ RoleName: role_b }));
        for (const email of accounts) {
            await rpc_client.account.delete_account({ email });
        }
    });

    mocha.it('user a assume role of admin - should be rejected', async function() {
        await assert_throws_async(sts.send(new AssumeRoleCommand({
            RoleArn: `arn:aws:sts::${user_b_id}:role/${'dummy_role'}`,
            RoleSessionName: 'just_a_dummy_session_name'
        })), errors.access_denied.code, errors.access_denied.message);
    });

    mocha.it('admin assume role of user b - should be allowed', async function() {
        const params = {
            RoleArn: `arn:aws:sts::${user_b_id}:assumed-role/${role_b}`,
            RoleSessionName: 'just_a_dummy_session_name'
        };
        const json = await sts_admin.send(new AssumeRoleCommand(params));
        validate_assume_role_response(json, `arn:aws:sts::${user_b_id}:assumed-role/${role_b}/${params.RoleSessionName}`,
            `${user_b_id}:${params.RoleSessionName}`, user_b_key, defualt_expiry_seconds);
    });

    mocha.it('admin assume non existing role of user b - should be rejected', async function() {
        await assert_throws_async(sts_admin.send(new AssumeRoleCommand({
            RoleArn: `arn:aws:sts::${user_b_id}:role/${'dummy_role2'}`,
            RoleSessionName: 'just_a_dummy_session_name1'
        })), errors.access_denied.code, errors.access_denied.message);
    });

    mocha.it('admin assume non existing role of non existing user - should be rejected', async function() {
        await assert_throws_async(sts_admin.send(new AssumeRoleCommand({
            RoleArn: `arn:aws:sts::${12345}:role/${'dummy_role3'}`,
            RoleSessionName: 'just_a_dummy_session_name2'
        })), errors.access_denied.code, errors.access_denied.message);
    });

    mocha.it('anonymous user a assume role of user b - should be rejected', async function() {
        await assert_throws_async(anon_sts.send(new AssumeRoleCommand({
            RoleArn: `arn:aws:sts::${user_b_id}:role/${role_b}`,
            RoleSessionName: 'just_a_dummy_session_name'
        })), errors.access_denied.code, errors.access_denied.message);
    });

    mocha.it('user c assume role of user b - should be allowed', async function() {
        const params = {
            RoleArn: `arn:aws:sts::${user_b_id}:role/${role_b}`,
            RoleSessionName: 'just_a_dummy_session_name'
        };
        const json = await sts_c.send(new AssumeRoleCommand(params));
        validate_assume_role_response(json, `arn:aws:sts::${user_b_id}:assumed-role/${role_b}/${params.RoleSessionName}`,
            `${user_b_id}:${params.RoleSessionName}`, user_b_key, defualt_expiry_seconds);

        const temp_creds = validate_assume_role_response(json, `arn:aws:sts::${user_b_id}:assumed-role/${role_b}/${params.RoleSessionName}`,
            `${user_b_id}:${params.RoleSessionName}`, user_b_key, defualt_expiry_seconds);
        const s3 = generate_s3_client(
            temp_creds.access_key, temp_creds.secret_key,
            coretest.get_http_address(), temp_creds.session_token);
        const list_objects_res = await s3.listObjects({ Bucket: 'first.bucket' });
        assert.ok(list_objects_res);
    });

    mocha.it('user a assume role of user b - should be rejected', async function() {
        await assert_throws_async(sts.send(new AssumeRoleCommand({
            RoleArn: `arn:aws:sts::${user_b_id}:role/${role_b}`,
            RoleSessionName: 'just_a_dummy_session_name'
        })), errors.access_denied.code, errors.access_denied.message);
    });

    mocha.it('update assume role policy of user b to allow user a', async function() {
        const policy = {
            Version: '2012-10-17',
            Statement: [{
                Effect: 'Allow',
                Principal: {AWS: [user_c, user_a]},
                Action: ['sts:AssumeRole']
            }]
        };

        await iam_client_b.send(new UpdateAssumeRolePolicyCommand({
            RoleName: role_b,
            PolicyDocument: JSON.stringify(policy),
        }));

    });

    mocha.it('user a assume role of user b - should be allowed', async function() {
        const params = {
            RoleArn: `arn:aws:sts::${user_b_id}:role/${role_b}`,
            RoleSessionName: 'just_a_dummy_session_name'
        };
        const json = await sts.send(new AssumeRoleCommand(params));
        validate_assume_role_response(json, `arn:aws:sts::${user_b_id}:assumed-role/${role_b}/${params.RoleSessionName}`,
            `${user_b_id}:${params.RoleSessionName}`, user_b_key, defualt_expiry_seconds);
    });

    mocha.it('update assume role policy of user b to allow user a', async function() {
        const policy = {
            Version: '2012-10-17',
            Statement: [{
                    Effect: 'Deny',
                    Principal: { AWS: [user_a]},
                    Action: ['sts:AssumeRole']
                },
                {
                    Effect: 'Allow',
                    Principal: {AWS: [user_c]},
                    Action: ['sts:AssumeRole']
                }
            ]
        };
        await iam_client_b.send(new UpdateAssumeRolePolicyCommand({
            RoleName: role_b,
            PolicyDocument: JSON.stringify(policy),
        }));
    });

    mocha.it('user a assume role of user b - should be rejected', async function() {
        await assert_throws_async(sts.send(new AssumeRoleCommand({
            RoleArn: `arn:aws:sts::${user_b_id}:role/${role_b}`,
            RoleSessionName: 'just_a_dummy_session_name'
        })), errors.access_denied.code, errors.access_denied.message);
    });

    mocha.it('user c assume role of user b - should be allowed', async function() {
        const params = {
            RoleArn: `arn:aws:sts::${user_b_id}:role/${role_b}`,
            RoleSessionName: 'just_a_dummy_session_name'
        };
        const json = await sts_c.send(new AssumeRoleCommand(params));
        validate_assume_role_response(json, `arn:aws:sts::${user_b_id}:assumed-role/${role_b}/${params.RoleSessionName}`,
            `${user_b_id}:${params.RoleSessionName}`, user_b_key, defualt_expiry_seconds);
    });

    mocha.it('update assume role policy of user b to allow user a sts:*', async function() {
        const policy = {
            Version: '2012-10-17',
            Statement: [{
                    Effect: 'Deny',
                    Principal: {AWS: [user_a]},
                    Action: ['sts:*']
                },
                {
                    Effect: 'Allow',
                    Principal: {AWS: [user_c]},
                    Action: ['sts:AssumeRole']
                }
            ]
        };

        await iam_client_b.send(new UpdateAssumeRolePolicyCommand({
            RoleName: role_b,
            PolicyDocument: JSON.stringify(policy),
        }));
    });

    mocha.it('user a assume role of user b - should be rejected sts:*', async function() {
        await assert_throws_async(sts.send(new AssumeRoleCommand({
            RoleArn: `arn:aws:sts::${user_b_key}:role/${role_b}`,
            RoleSessionName: 'just_a_dummy_session_name'
        })), errors.access_denied.code, errors.access_denied.message);
    });

    mocha.it('user c assume role of user b - should be allowed sts:*', async function() {
        const params = {
            RoleArn: `arn:aws:sts::${user_b_id}:role/${role_b}`,
            RoleSessionName: 'just_a_dummy_session_name'
        };
        const json = await sts_c.send(new AssumeRoleCommand(params));
        validate_assume_role_response(json, `arn:aws:sts::${user_b_id}:assumed-role/${role_b}/${params.RoleSessionName}`,
            `${user_b_id}:${params.RoleSessionName}`, user_b_key, defualt_expiry_seconds);
    });

    mocha.it('update assume role policy of user b to allow user a *', async function() {
        const policy = {
            Version: '2012-10-17',
            Statement: [{
                Effect: 'Deny',
                Principal: {AWS: ['*']},
                Action: ['sts:AssumeRole']
            }]
        };
        await iam_client_b.send(new UpdateAssumeRolePolicyCommand({
            RoleName: role_b,
            PolicyDocument: JSON.stringify(policy),
        }));
    });

    mocha.it('user a assume role of user b - should be rejected *', async function() {
        await assert_throws_async(sts.send(new AssumeRoleCommand({
            RoleArn: `arn:aws:sts::${user_b_id}:role/${role_b}`,
            RoleSessionName: 'just_a_dummy_session_name'
        })), errors.access_denied.code, errors.access_denied.message);
    });

    mocha.it('user c assume role of user b - should be rejected *', async function() {
        await assert_throws_async(sts_c.send(new AssumeRoleCommand({
            RoleArn: `arn:aws:sts::${user_b_id}:role/${role_b}`,
            RoleSessionName: 'just_a_dummy_session_name'
        })), errors.access_denied.code, errors.access_denied.message);
    });
});

function validate_assume_role_response(response, expected_arn, expected_role_id, assumed_access_key, duration_seconds) {
    dbg.log0('test.sts.validate_assume_role_response: ', response);
    assert.ok(response && response.Credentials && response.AssumedRoleUser);
    const credentials = response.Credentials;
    assert.ok(credentials.AccessKeyId && credentials.SecretAccessKey);
    const duration_ms = duration_seconds ? duration_seconds * 1000 : config.STS_DEFAULT_SESSION_TOKEN_EXPIRY_MS;
    const creds_generation_time_ms = new Date(credentials.Expiration).getTime() - duration_ms;
    assert(creds_generation_time_ms < Date.now());
    if (config.STS_DEFAULT_SESSION_TOKEN_EXPIRY_MS !== 0) {
        verify_session_token(credentials.SessionToken, credentials.AccessKeyId,
            credentials.SecretAccessKey, assumed_access_key);
    }
    assert.equal(response.AssumedRoleUser.Arn, expected_arn);
    assert.equal(response.AssumedRoleUser.AssumedRoleId, expected_role_id);
    assert.equal(Number(response.PackedPolicySize || 0), 0);
    return {
        access_key: credentials.AccessKeyId,
        secret_key: credentials.SecretAccessKey,
        session_token: credentials.SessionToken
    };
}

async function assert_throws_async(promise,
    expected_code,
    expected_message) {
    try {
        await promise;
        assert.fail('Test was suppose to fail on ' + expected_message);
    } catch (err) {
        dbg.log0('assert_throws_async err', err);
        dbg.log0('assert_throws_async err.message', err.message, expected_message, err.message !== expected_message);
        dbg.log0('assert_throws_async err.code', err.code, expected_code, err.code !== expected_code);
        dbg.log0('assert_throws_async err.code', err.rpc_code, expected_code, err.rpc_code !== expected_code);
        const code_or_rpc_code = err.code || err.rpc_code || err.Code || err.name;
        if (err.message !== expected_message || code_or_rpc_code !== expected_code) throw err;
    }
}

function verify_session_token(session_token, access_key, secret_key, assumed_role_access_key) {
    const session_token_json = jwt_utils.authorize_jwt_token(session_token);
    assert.equal(access_key, session_token_json.access_key);
    assert.equal(secret_key, session_token_json.secret_key);
    assert.equal(assumed_role_access_key, session_token_json.assumed_role_access_key);
    assert.ok(session_token_json.assumed_role_arn);
}

mocha.describe('Session token tests', function() {
    const { rpc_client } = coretest;
    const alice2 = 'alice2';
    const alice2_buck = 'alice2-test-bucket';
    const bob2 = 'bob2';
    const charlie2 = 'charlie2';
    const accounts = [{ email: alice2 }, { email: bob2 }, { email: charlie2 }];
    const role_alice = 'role_alice';
    let account_info_alice;
    const original_sts_expiry_ms = config.STS_DEFAULT_SESSION_TOKEN_EXPIRY_MS;

    mocha.afterEach(function() {
        config.STS_DEFAULT_SESSION_TOKEN_EXPIRY_MS = original_sts_expiry_ms;
    });

    mocha.after(async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);

        await accounts[0].s3.deleteBucket({ Bucket: alice2_buck });
        await accounts[0].iam.send(new DeleteRolePolicyCommand({
            RoleName: role_alice, PolicyName: 'Role_A_S3Access',
        }));
        await accounts[0].iam.send(new DeleteRoleCommand({ RoleName: role_alice }));
        for (const account of accounts) {
            await rpc_client.account.delete_account({ email: account.email });
        }
    });

    mocha.before(async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);
        const account_defaults = { has_login: false, s3_access: true };
        if (is_nc_coretest) {
            account_defaults.nsfs_account_config = {
                uid: process.getuid(),
                gid: process.getgid(),
                new_buckets_path: coretest.NC_CORETEST_STORAGE_PATH,
            };
        }

        for (const account of accounts) {
            account.access_keys = (await rpc_client.account.create_account({
                ...account_defaults,
                name: account.email,
                email: account.email
            })).access_keys;

            account.sts = generate_sts_client(
                account.access_keys[0].access_key.unwrap(),
                account.access_keys[0].secret_key.unwrap(),
                coretest.get_https_address_sts());

            account.s3 = generate_s3_client(
                account.access_keys[0].access_key.unwrap(),
                account.access_keys[0].secret_key.unwrap(),
                coretest.get_http_address());

            account.iam = generate_iam_client(
                account.access_keys[0].access_key.unwrap(),
                account.access_keys[0].secret_key.unwrap(),
                coretest.get_https_address_iam()
            );

        }

        const policy = {
            Version: '2012-10-17',
            Statement: [{
                Effect: 'Allow',
                Principal: {AWS: [bob2, charlie2]},
                Action: ['sts:AssumeRole'],
            }]
        };

        await accounts[0].iam.send(new CreateRoleCommand({
            RoleName: role_alice,
            AssumeRolePolicyDocument: JSON.stringify(policy),
        }));
        await accounts[0].iam.send(new PutRolePolicyCommand({
            RoleName: role_alice,
            PolicyName: 'Role_A_S3Access',
            PolicyDocument: JSON.stringify({
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Action: ['s3:*'],
                    Resource: ['*'],
                }],
            }),
        }));

        account_info_alice = await rpc_client.account.read_account({ email: alice2 });
        const s3accesspolicy = {
            Version: '2012-10-17',
            Statement: [{
                Effect: 'Allow',
                Principal: { AWS: is_nc_coretest ? alice2 : `arn:aws:iam::${account_info_alice._id.toString()}:root` },
                Action: ['s3:*'],
                Resource: [
                    'arn:aws:s3:::first.bucket/*',
                    'arn:aws:s3:::first.bucket',
                ]
            }]
        };

        // Allow all of the accounts full access over 'first.bucket'
        await rpc_client.bucket.put_bucket_policy({
            name: 'first.bucket',
            policy: s3accesspolicy,
        });

        // create a bucket owned by alice2 for ListBuckets to work
        // Note: bucket policy is not related to ListBuckets operation
        await accounts[0].s3.createBucket({ Bucket: alice2_buck });
    });

    mocha.it('user b assume role of user a - default expiry - list s3 - should be allowed', async function() {
        const user_a_id = account_info_alice._id.toString();
        const user_a_key = accounts[0].access_keys[0].access_key.unwrap();
        const params = {
            RoleArn: `arn:aws:sts::${user_a_id}:role/${role_alice}`,
            RoleSessionName: 'just_a_dummy_session_name'
        };

        const json = await accounts[1].sts.send(new AssumeRoleCommand(params));
        const result_obj = validate_assume_role_response(json, `arn:aws:sts::${user_a_id}:assumed-role/${role_alice}/${params.RoleSessionName}`,
            `${user_a_id}:${params.RoleSessionName}`, user_a_key, defualt_expiry_seconds);

        const temp_s3_with_session_token = generate_s3_client(
            result_obj.access_key, result_obj.secret_key,
            coretest.get_http_address(), result_obj.session_token);

        const buckets1 = await temp_s3_with_session_token.listBuckets({});
        assert.ok(buckets1.Buckets[0].Name === alice2_buck);
    });

    mocha.it('user b assume role of user a - valid expiry via durationSeconds - list s3 - should be allowed', async function() {
        const user_a_id = account_info_alice._id.toString();
        const user_a_key = accounts[0].access_keys[0].access_key.unwrap();
        const duration_seconds = 25000;
        const params = {
            DurationSeconds: duration_seconds,
            RoleArn: `arn:aws:sts::${user_a_id}:role/${role_alice}`,
            RoleSessionName: 'just_a_dummy_session_name'
        };

        const json = await accounts[1].sts.send(new AssumeRoleCommand(params));
        const result_obj = validate_assume_role_response(json, `arn:aws:sts::${user_a_id}:assumed-role/${role_alice}/${params.RoleSessionName}`,
            `${user_a_id}:${params.RoleSessionName}`, user_a_key, duration_seconds);

        const temp_s3_with_session_token = generate_s3_client(
            result_obj.access_key, result_obj.secret_key,
            coretest.get_http_address(), result_obj.session_token);

        const buckets1 = await temp_s3_with_session_token.listBuckets({});
        assert.ok(buckets1.Buckets[0].Name === alice2_buck);
    });

    mocha.it('user b assume role of user a - invalid expiry via durationSeconds - should be rejected', async function() {
        const user_a_id = account_info_alice._id.toString();
        const params = {
            DurationSeconds: 43201,
            RoleArn: `arn:aws:sts::${user_a_id}:role/${role_alice}`,
            RoleSessionName: 'just_a_dummy_session_name'
        };

        const expected_error_message = `Value 43201 for durationSeconds failed to satisfy constraint:
            Member must have value less than or equal to 43200`;
        assert_throws_async(
            accounts[0].sts.send(new AssumeRoleCommand(params)),
            errors.validation_error.code,
            expected_error_message
        );
    });

    mocha.it('user b assume role of user a - default expiry - list s3 without session token - should be rejected', async function() {
        const user_a_id = account_info_alice._id.toString();
        const user_a_key = accounts[0].access_keys[0].access_key.unwrap();
        const params = {
            RoleArn: `arn:aws:sts::${user_a_id}:role/${role_alice}`,
            RoleSessionName: 'just_a_dummy_session_name'
        };

        const json = await accounts[1].sts.send(new AssumeRoleCommand(params));
        const result_obj = validate_assume_role_response(json, `arn:aws:sts::${user_a_id}:assumed-role/${role_alice}/${params.RoleSessionName}`,
            `${user_a_id}:${params.RoleSessionName}`, user_a_key, defualt_expiry_seconds);

        const temp_s3 = generate_s3_client(
            result_obj.access_key, result_obj.secret_key,
            coretest.get_http_address());

        await assert_throws_async(temp_s3.listBuckets({}),
            errors.invalid_access_key.code, errors.invalid_access_key.message);
    });

    mocha.it('user b, user c assume role of user a - default expiry - user b list s3 with session token of user c- should be rejected', async function() {
        const user_a_key = accounts[0].access_keys[0].access_key.unwrap();
        const user_a_id = account_info_alice._id.toString();
        const params = {
            RoleArn: `arn:aws:sts::${user_a_id}:role/${role_alice}`,
            RoleSessionName: 'just_a_dummy_session_name'
        };

        const json1 = await accounts[1].sts.send(new AssumeRoleCommand(params));
        const result_obj1 = validate_assume_role_response(json1, `arn:aws:sts::${user_a_id}:assumed-role/${role_alice}/${params.RoleSessionName}`,
            `${user_a_id}:${params.RoleSessionName}`, user_a_key, defualt_expiry_seconds);

        const json2 = await accounts[2].sts.send(new AssumeRoleCommand(params));
        const result_obj2 = validate_assume_role_response(json2, `arn:aws:sts::${user_a_id}:assumed-role/${role_alice}/${params.RoleSessionName}`,
            `${user_a_id}:${params.RoleSessionName}`, user_a_key, defualt_expiry_seconds);

        const temp_s3 = generate_s3_client(
            result_obj1.access_key, result_obj1.secret_key,
            coretest.get_http_address(), result_obj2.session_token);

        await assert_throws_async(temp_s3.listBuckets({}),
            errors.signature_doesnt_match.code, errors.signature_doesnt_match.message);
    });

    mocha.it('user b assume role of user a - default expiry - list s3 with permanent creds and temp session token- should be allowed', async function() {
        const user_a_key = accounts[0].access_keys[0].access_key.unwrap();
        const user_a_secret = accounts[0].access_keys[0].secret_key.unwrap();
        const user_a_id = account_info_alice._id.toString();
        const params = {
            RoleArn: `arn:aws:sts::${user_a_id}:role/${role_alice}`,
            RoleSessionName: 'just_a_dummy_session_name'
        };

        const json = await accounts[1].sts.send(new AssumeRoleCommand(params));
        const result_obj = validate_assume_role_response(json, `arn:aws:sts::${user_a_id}:assumed-role/${role_alice}/${params.RoleSessionName}`,
            `${user_a_id}:${params.RoleSessionName}`, user_a_key, defualt_expiry_seconds);

        const temp_s3_with_session_token = generate_s3_client(
            user_a_key, user_a_secret,
            coretest.get_http_address(), result_obj.session_token);

        await assert_throws_async(temp_s3_with_session_token.listBuckets({}),
            errors.signature_doesnt_match.code, errors.signature_doesnt_match.message);
    });

    mocha.it('user b assume role of user a - default expiry - list s3 with faulty temp session token- should be allowed', async function() {
        const user_a_key = accounts[0].access_keys[0].access_key.unwrap();
        const user_a_id = account_info_alice._id.toString();
        const params = {
            RoleArn: `arn:aws:sts::${user_a_id}:role/${role_alice}`,
            RoleSessionName: 'just_a_dummy_session_name'
        };

        const json = await accounts[1].sts.send(new AssumeRoleCommand(params));
        const result_obj = validate_assume_role_response(json, `arn:aws:sts::${user_a_id}:assumed-role/${role_alice}/${params.RoleSessionName}`,
            `${user_a_id}:${params.RoleSessionName}`, user_a_key, defualt_expiry_seconds);

        const temp_s3_with_session_token = generate_s3_client(
            result_obj.access_key, result_obj.secret_key,
            coretest.get_http_address(), result_obj.session_token + 'dummy');

        await assert_throws_async(temp_s3_with_session_token.listBuckets({}),
            errors.invalid_token_s3.code, errors.invalid_token_s3.message);
    });

    mocha.it('user b assume role of user a - default expiry - assume role sts with permanent creds and temp session token- should be allowed', async function() {
        const user_a_key = accounts[0].access_keys[0].access_key.unwrap();
        const user_a_secret = accounts[0].access_keys[0].secret_key.unwrap();
        const user_a_id = account_info_alice._id.toString();
        const params = {
            RoleArn: `arn:aws:sts::${user_a_id}:role/${role_alice}`,
            RoleSessionName: 'just_a_dummy_session_name'
        };

        const json = await accounts[1].sts.send(new AssumeRoleCommand(params));
        const result_obj = validate_assume_role_response(json, `arn:aws:sts::${user_a_id}:assumed-role/${role_alice}/${params.RoleSessionName}`,
            `${user_a_id}:${params.RoleSessionName}`, user_a_key, defualt_expiry_seconds);

        const temp_sts_with_session_token = generate_sts_client(
            user_a_key,
            user_a_secret,
            coretest.get_https_address_sts(),
            result_obj.session_token);

        await assert_throws_async(temp_sts_with_session_token.send(new AssumeRoleCommand(params)),
            errors.access_denied.code, errors.access_denied.message);
    });

    mocha.it('user b assume role of user a - default expiry - assume role sts faulty temp session token- should be allowed', async function() {
        const user_a_key = accounts[0].access_keys[0].access_key.unwrap();
        const user_a_id = account_info_alice._id.toString();
        const params = {
            RoleArn: `arn:aws:sts::${user_a_id}:role/${role_alice}`,
            RoleSessionName: 'just_a_dummy_session_name'
        };

        const json = await accounts[1].sts.send(new AssumeRoleCommand(params));
        const result_obj = validate_assume_role_response(json, `arn:aws:sts::${user_a_id}:assumed-role/${role_alice}/${params.RoleSessionName}`,
            `${user_a_id}:${params.RoleSessionName}`, user_a_key, defualt_expiry_seconds);

        const temp_sts_with_session_token = generate_sts_client(
            result_obj.access_key,
            result_obj.secret_key,
            coretest.get_https_address_sts(),
            result_obj.session_token + 'dummy');

        await assert_throws_async(temp_sts_with_session_token.send(new AssumeRoleCommand(params)),
            errors.invalid_token.code, errors.invalid_token.message);
    });

    // In NC mode the server (nsfs.js) is a separate process - hence expiry not set to 0,token never expires.  Skip these two tests.
    if (!is_nc_coretest) {
        mocha.it('user b assume role of user a - expiry 0 - list s3 - should be rejected', async function() {
            config.STS_DEFAULT_SESSION_TOKEN_EXPIRY_MS = 0;
            const user_a_key = accounts[0].access_keys[0].access_key.unwrap();
            const user_a_id = account_info_alice._id.toString();
            const params = {
                RoleArn: `arn:aws:sts::${user_a_id}:role/${role_alice}`,
                RoleSessionName: 'just_a_dummy_session_name'
            };

            const json = await accounts[1].sts.send(new AssumeRoleCommand(params));
            const result_obj = validate_assume_role_response(json, `arn:aws:sts::${user_a_id}:assumed-role/${role_alice}/${params.RoleSessionName}`,
                `${user_a_id}:${params.RoleSessionName}`, user_a_key, defualt_expiry_seconds);

            const temp_s3_with_session_token = generate_s3_client(
                result_obj.access_key, result_obj.secret_key,
                coretest.get_http_address(), result_obj.session_token);

            await assert_throws_async(temp_s3_with_session_token.listBuckets({}),
                errors.expired_token_s3.code, errors.expired_token_s3.message);
        });

        mocha.it('user b assume role of user a - expiry 0 - assume role sts - should be rejected', async function() {
            config.STS_DEFAULT_SESSION_TOKEN_EXPIRY_MS = 0;

            const user_a_key = accounts[0].access_keys[0].access_key.unwrap();
            const user_a_id = account_info_alice._id.toString();
            const params = {
                RoleArn: `arn:aws:sts::${user_a_id}:role/${role_alice}`,
                RoleSessionName: 'just_a_dummy_session_name'
            };

            const json = await accounts[1].sts.send(new AssumeRoleCommand(params));
            const result_obj = validate_assume_role_response(json, `arn:aws:sts::${user_a_id}:assumed-role/${role_alice}/${params.RoleSessionName}`,
                `${user_a_id}:${params.RoleSessionName}`, user_a_key, defualt_expiry_seconds);

            const temp_sts_with_session_token = generate_sts_client(
                result_obj.access_key,
                result_obj.secret_key,
                coretest.get_https_address_sts(),
                result_obj.session_token);

            await assert_throws_async(temp_sts_with_session_token.send(new AssumeRoleCommand(params)),
                errors.expired_token.code, errors.expired_token.message);
        });
    }
});

mocha.describe('Assume role with web indentity tests', function() {
    const user_a = 'alice1';

    /** @type {import("@aws-sdk/client-sts").STSClient} */
    let anon_sts;
    mocha.before(async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);

        anon_sts = generate_sts_client(
            '', '', coretest.get_https_address_sts());
        if (is_nc_coretest) {
            // nsfs.js is a separate process — inject jwt_secret via the LDAP config file
            // so the server's ldap_client picks it up via fs.watchFile reload.
            await fs.promises.mkdir(path.dirname(config.LDAP_CONFIG_PATH), { recursive: true });
            await fs.promises.writeFile(config.LDAP_CONFIG_PATH, JSON.stringify({ jwt_secret: "TEST_SECRET" }));
        }
        ldap_client.instance().ldap_params = {
            jwt_secret: "TEST_SECRET"
        };
    });

    mocha.after(async function() {
        if (is_nc_coretest) {
            // Clean up the LDAP config file written in before()
            await fs.promises.unlink(config.LDAP_CONFIG_PATH).catch(() => {
                dbg.log1("Failed to unlink LDAP config file");
            });
        }
    });

    mocha.it('anonymous user a with bad jwt - should be rejected', async function() {
        await assert_throws_async(anon_sts.send(new AssumeRoleWithWebIdentityCommand({
            RoleArn: `arn:aws:sts::ldap:role/${user_a}`,
            RoleSessionName: 'just_a_dummy_session_name',
            WebIdentityToken: 'just_a_dummy_wit'
        })), stsErr.AccessDeniedException.code, stsErr.AccessDeniedException.message);
    });

    mocha.it('anonymous user a with invalid signature - should be rejected', async function() {
        const bad_signed_wit = jwt.sign({ user: user_a, password: 'dummy_password' }, 'invalid signature');
        await assert_throws_async(anon_sts.send(new AssumeRoleWithWebIdentityCommand({
            RoleArn: `arn:aws:sts::ldap:role/${user_a}`,
            RoleSessionName: 'just_a_dummy_session_name',
            WebIdentityToken: bad_signed_wit
        })), stsErr.InvalidIdentityToken.code, 'invalid signature');
    });

    mocha.it('anonymous user a with missing password - should be rejected', async function() {
        const missing_pwd_wit = jwt.sign({ user: user_a }, ldap_client.instance().ldap_params.jwt_secret);
        await assert_throws_async(anon_sts.send(new AssumeRoleWithWebIdentityCommand({
            RoleArn: `arn:aws:sts::ldap:role/${user_a}`,
            RoleSessionName: 'just_a_dummy_session_name',
            WebIdentityToken: missing_pwd_wit
        })), stsErr.AccessDeniedException.code, stsErr.AccessDeniedException.message);
    });

    mocha.it('anonymous user a with missing user name - should be rejected', async function() {
        // TODO: Need to update when authorize flow check for user and password based authentication
        const missing_usr_wit = jwt.sign({ password: 'password' }, ldap_client.instance().ldap_params.jwt_secret);
        await assert_throws_async(anon_sts.send(new AssumeRoleWithWebIdentityCommand({
            RoleArn: `arn:aws:sts::ldap:role/${user_a}`,
            RoleSessionName: 'just_a_dummy_session_name',
            WebIdentityToken: missing_usr_wit
        })), stsErr.AccessDeniedException.code, stsErr.AccessDeniedException.message);
    });
});

mocha.describe('STS assumed-role IAM policy authorization tests', function() {
    const { rpc_client } = coretest;
    const owner_email = 'role-authz-owner';
    const assumer_email = 'role-authz-assumer';
    const role_name = 'role_authz_restrictive';
    const policy_name = 'Role_Authz_S3Access';
    const owner = { email: owner_email };
    const assumer = { email: assumer_email };
    const accounts = [owner, assumer];
    let owner_account_info;
    let assumer_account_info;

    mocha.before(async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);

        for (const account of accounts) {
            const create_account_param = {
                has_login: false,
                s3_access: true,
                name: account.email,
                email: account.email,
            };
            if (is_nc_coretest) {
                create_account_param.nsfs_account_config = {
                    uid: process.getuid(),
                    gid: process.getgid(),
                    new_buckets_path: coretest.NC_CORETEST_STORAGE_PATH,
                };
            }
            account.access_keys = (await rpc_client.account.create_account(create_account_param)).access_keys;
            const access_key = account.access_keys[0].access_key.unwrap();
            const secret_key = account.access_keys[0].secret_key.unwrap();
            account.sts_client = generate_sts_client(access_key, secret_key, coretest.get_https_address_sts());
            account.iam_client = generate_iam_client(access_key, secret_key, coretest.get_https_address_iam());
        }

        // emails are only for create_account/read_account RPC
        // trust Principal uses the assumer's account id ARN
        owner_account_info = await rpc_client.account.read_account({ email: owner_email });
        assumer_account_info = await rpc_client.account.read_account({ email: assumer_email });
        const assumer_account_id = assumer_account_info._id.toString();
        await owner.iam_client.send(new CreateRoleCommand({
            RoleName: role_name,
            AssumeRolePolicyDocument: JSON.stringify({
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Principal: { AWS: [`arn:aws:iam::${assumer_account_id}:root`] },
                    Action: ['sts:AssumeRole'],
                }],
            }),
            MaxSessionDuration: config.STS_MAX_DURATION_SECONDS,
        }));
        await owner.iam_client.send(new PutRolePolicyCommand({
            RoleName: role_name,
            PolicyName: policy_name,
            PolicyDocument: JSON.stringify({
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Action: ['s3:GetObject'],
                    Resource: ['arn:aws:s3:::no-such-bucket/*'],
                }],
            }),
        }));
    });

    mocha.after(async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);
        await owner.iam_client.send(new DeleteRolePolicyCommand({
            RoleName: role_name, PolicyName: policy_name,
        }));
        await owner.iam_client.send(new DeleteRoleCommand({ RoleName: role_name }));
        for (const account of accounts) {
            await rpc_client.account.delete_account({ email: account.email });
        }
    });

    mocha.it('assumer listBuckets with GetObject-only role policy - should fail', async function() {
        const owner_id = owner_account_info._id.toString();
        const owner_key = owner.access_keys[0].access_key.unwrap();
        const session = 'restrictive_policy_session';
        const json = await assumer.sts_client.send(new AssumeRoleCommand({
            RoleArn: `arn:aws:sts::${owner_id}:role/${role_name}`,
            RoleSessionName: session,
        }));
        const creds = validate_assume_role_response(json,
            `arn:aws:sts::${owner_id}:assumed-role/${role_name}/${session}`,
            `${owner_id}:${session}`, owner_key, defualt_expiry_seconds);
        const s3_client = generate_s3_client(
            creds.access_key, creds.secret_key, coretest.get_http_address(), creds.session_token);
        try {
            await s3_client.listBuckets({});
            assert.fail('assumer listBuckets with GetObject-only role policy - should throw an error');
        } catch (err) {
            assert.equal(err_code(err), errors.s3_access_denied.code);
        }
    });

    mocha.it('assumer listBuckets with ListAllMyBuckets-only role policy', async function() {
        const input = {
            RoleName: role_name,
            PolicyName: policy_name,
            PolicyDocument: JSON.stringify({
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Action: ['s3:ListAllMyBuckets'],
                    Resource: ['*'],
                }],
            }),
        };
        const command = new PutRolePolicyCommand(input);
        await owner.iam_client.send(command);

        const owner_id = owner_account_info._id.toString();
        const owner_key = owner.access_keys[0].access_key.unwrap();
        const session = 'list_buckets_policy_session';
        const json = await assumer.sts_client.send(new AssumeRoleCommand({
            RoleArn: `arn:aws:sts::${owner_id}:role/${role_name}`,
            RoleSessionName: session,
        }));
        const creds = validate_assume_role_response(json,
            `arn:aws:sts::${owner_id}:assumed-role/${role_name}/${session}`,
            `${owner_id}:${session}`, owner_key, defualt_expiry_seconds);
        const s3_client = generate_s3_client(
            creds.access_key, creds.secret_key, coretest.get_http_address(), creds.session_token);
        const response = await s3_client.listBuckets({});
        assert.equal(response.$metadata.httpStatusCode, 200);
    });
});

mocha.describe('Cloudera RAZ-style S3 role test', function() {
    const { rpc_client } = coretest;

    // account that owns the role and the bucket
    const owner_email = 'raz-role-owner';
    // IAM user (sub-user) under the account that will assume the role
    const iam_username = 'raz-iam-user';
    const role_name = 'RazS3Role';
    const policy_name = 'RazS3InlinePolicy';
    const bucket_name = 'raz-test-bucket';
    const prefix = 'storage/'; //AKA "subfolder" in Cloudera doc
    const object_key = prefix + 'dummy-object.txt';

    const owner = { email: owner_email };
    let owner_account_info;
    let iam_user_arn;
    let iam_user_access_key_id;
    let iam_user_secret_key;

    const inline_policy = {
        Version: '2012-10-17',
        Statement: [
            {
                "Sid": "AccessToBucket",
                Effect: 'Allow',
                Action: [
                    "s3:GetBucketAcl",
                    "s3:GetBucketLocation",
                    "s3:GetBucketVersioning",
                    "s3:GetEncryptionConfiguration",
                    "s3:ListBucket",
                    "s3:ListBucketMultipartUploads"
                ],
                Resource: [`arn:aws:s3:::${bucket_name}`],
            },
            {
                "Sid": "AccessToBucketObjects",
                Effect: 'Allow',
                Action: [
                    "s3:AbortMultipartUpload",
                    "s3:DeleteObject",
                    "s3:DeleteObjectVersion",
                    "s3:GetObject",
                    "s3:GetObjectAcl",
                    "s3:GetObjectVersion",
                    "s3:GetObjectVersionAcl",
                    "s3:PutObject",
                    "s3:ListMultipartUploadParts"
                ],
                Resource: [`arn:aws:s3:::${bucket_name}/*`],
            },
        ],
    };

    mocha.afterEach(async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);

        await owner.s3_client.deleteObject({ Bucket: bucket_name, Key: object_key });
        await owner.s3_client.deleteObject({ Bucket: bucket_name, Key: prefix });
        await owner.s3_client.deleteBucket({ Bucket: bucket_name });
        await owner.iam_client.send(new DeleteAccessKeyCommand({
            UserName: iam_username,
            AccessKeyId: iam_user_access_key_id,
        }));
        await owner.iam_client.send(new DeleteUserCommand({ UserName: iam_username }));
        await rpc_client.account.delete_account({ email: owner_email });
    });

    mocha.beforeEach(async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);

        // 1. Create the owner account (NooBaa account that owns the user, role and bucket)
        const create_account_param = {
            has_login: false,
            s3_access: true,
            name: owner_email,
            email: owner_email,
        };
        if (is_nc_coretest) {
            create_account_param.nsfs_account_config = {
                uid: process.getuid(),
                gid: process.getgid(),
                new_buckets_path: coretest.NC_CORETEST_STORAGE_PATH,
            };
        } else {
            create_account_param.default_resource = coretest.POOL_LIST[1].name;
        }
        owner.access_keys = (await rpc_client.account.create_account(create_account_param)).access_keys;
        owner_account_info = await rpc_client.account.read_account({ email: owner_email });

        const access_key = owner.access_keys[0].access_key.unwrap();
        const secret_key = owner.access_keys[0].secret_key.unwrap();
        owner.iam_client = generate_iam_client(access_key, secret_key, coretest.get_https_address_iam());
        owner.s3_client = generate_s3_client(access_key, secret_key, coretest.get_http_address());

        // 2. Create an IAM user under the owner account
        const create_user_resp = await owner.iam_client.send(new CreateUserCommand({ UserName: iam_username }));
        iam_user_arn = create_user_resp.User.Arn;

        // 3. Create access keys for the IAM user
        const create_key_resp = await owner.iam_client.send(new CreateAccessKeyCommand({ UserName: iam_username }));
        iam_user_access_key_id = create_key_resp.AccessKey.AccessKeyId;
        iam_user_secret_key = create_key_resp.AccessKey.SecretAccessKey;

        // 4. Create the bucket
        await owner.s3_client.createBucket({ Bucket: bucket_name });
        await owner.s3_client.send(new PutPublicAccessBlockCommand({
            Bucket: bucket_name,
            PublicAccessBlockConfiguration: {
                BlockPublicPolicy: true,
                RestrictPublicBuckets: true,
            },
        }));
        await owner.s3_client.putObject({
            Bucket: bucket_name,
            Key: prefix,
        });
    });

    mocha.it('cloudera req with role', async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);
        // 5. Create the role with a trust policy allowing the IAM user to assume it
        const trust_policy = {
            Version: '2012-10-17',
            Statement: [{
                Effect: 'Allow',
                Principal: { AWS: [iam_user_arn] },
                Action: ['sts:AssumeRole'],
            }],
        };
        await owner.iam_client.send(new CreateRoleCommand({
            RoleName: role_name,
            AssumeRolePolicyDocument: JSON.stringify(trust_policy),
        }));

        // 6. Put the inline role policy granting the Cloudera RAZ-required S3 permissions
        //    on the created bucket
        //    Mirrors the "Storage prerequisites" S3 role policy from the Cloudera RAZ document:
        //    GetBucketLocation, ListBucket on the bucket; GetObject, PutObject, DeleteObject on objects.
        await owner.iam_client.send(new PutRolePolicyCommand({
            RoleName: role_name,
            PolicyName: policy_name,
            PolicyDocument: JSON.stringify(inline_policy),
        }));

        // 7. With the IAM user's credentials, assume the role
        const owner_account_id = owner_account_info._id.toString();
        const iam_user_sts = generate_sts_client(
            iam_user_access_key_id,
            iam_user_secret_key,
            coretest.get_https_address_sts()
        );

        const assume_role_params = {
            RoleArn: `arn:aws:sts::${owner_account_id}:role/${role_name}`,
            RoleSessionName: 'raz-test-session',
        };
        const assume_resp = await iam_user_sts.send(new AssumeRoleCommand(assume_role_params));
        const owner_key = owner.access_keys[0].access_key.unwrap();
        const creds = validate_assume_role_response(
            assume_resp,
            `arn:aws:sts::${owner_account_id}:assumed-role/${role_name}/${assume_role_params.RoleSessionName}`,
            `${owner_account_id}:${assume_role_params.RoleSessionName}`,
            owner_key,
            defualt_expiry_seconds
        );

        // 8. With the temporary credentials, put a dummy object in the bucket
        const temp_s3 = generate_s3_client(
            creds.access_key,
            creds.secret_key,
            coretest.get_http_address(),
            creds.session_token
        );
        const put_resp = await temp_s3.putObject({
            Bucket: bucket_name,
            Key: object_key,
            Body: 'dummy content for raz test',
        });
        assert.equal(put_resp.$metadata.httpStatusCode, 200);

        await owner.iam_client.send(new DeleteRolePolicyCommand({ RoleName: role_name, PolicyName: policy_name }));
        await owner.iam_client.send(new DeleteRoleCommand({ RoleName: role_name }));
    });

    mocha.it('cloudera req with inline user policy', async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);
        const user_policy_name = 'RazS3UserInlinePolicy';

        // Put the same Cloudera RAZ-required S3 permissions as an inline user policy
        // directly on the IAM user — no role or assume-role involved.
        await owner.iam_client.send(new PutUserPolicyCommand({
            UserName: iam_username,
            PolicyName: user_policy_name,
            PolicyDocument: JSON.stringify(inline_policy),
        }));

        // Upload a dummy object directly with the IAM user's permanent credentials.
        const iam_user_s3 = generate_s3_client(
            iam_user_access_key_id,
            iam_user_secret_key,
            coretest.get_http_address()
        );
        const put_resp = await iam_user_s3.putObject({
            Bucket: bucket_name,
            Key: object_key,
            Body: 'dummy content for raz user policy test',
        });
        assert.equal(put_resp.$metadata.httpStatusCode, 200);

        await owner.iam_client.send(new DeleteUserPolicyCommand({
            UserName: iam_username,
            PolicyName: user_policy_name,
        }));
    });

});
