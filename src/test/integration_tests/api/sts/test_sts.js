/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('../../../utils/coretest/coretest');
coretest.setup();
const AWS = require('aws-sdk');
const https = require('https');
const mocha = require('mocha');
const assert = require('assert');
const jwt = require('jsonwebtoken');
const stsErr = require('../../../../endpoint/sts/sts_errors').StsError;
const http_utils = require('../../../../util/http_utils');
const dbg = require('../../../../util/debug_module')(__filename);
const cloud_utils = require('../../../../util/cloud_utils');
const jwt_utils = require('../../../../util/jwt_utils');
const config = require('../../../../../config');
const ldap_client = require('../../../../util/ldap_client');
const { S3Error } = require('../../../../endpoint/s3/s3_errors');

const defualt_expiry_seconds = Math.ceil(config.STS_DEFAULT_SESSION_TOKEN_EXPIRY_MS / 1000);

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
    let sts_creds;
    let accounts = [];
    mocha.before(async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);
        sts_creds = {
            endpoint: coretest.get_https_address_sts(),
            region: 'us-east-1',
            sslEnabled: true,
            computeChecksums: true,
            httpOptions: { agent: new https.Agent({ keepAlive: false, rejectUnauthorized: false }) },
            s3ForcePathStyle: true,
            signatureVersion: 'v4',
            s3DisableBodySigning: false,
        };
        const account = { has_login: false, s3_access: true };
        admin_keys = (await rpc_client.account.read_account({ email: EMAIL })).access_keys;
        sts_admin = new AWS.STS({
            ...sts_creds,
            accessKeyId: admin_keys[0].access_key.unwrap(),
            secretAccessKey: admin_keys[0].secret_key.unwrap()
        });
        account.name = user_a;
        account.email = user_a;
        const policy = {
            version: '2012-10-17',
            statement: [{
                effect: 'allow',
                principal: [user_c],
                action: ['sts:AssumeRole'],
            }]
        };

        const user_a_keys = (await rpc_client.account.create_account(account)).access_keys;
        account_info_a = await rpc_client.account.read_account({ email: user_a });
        const user_c_keys = (await rpc_client.account.create_account({ ...account, email: user_c, name: user_c })).access_keys;
        account_info_c = await rpc_client.account.read_account({ email: user_c });
        user_b_key = (await rpc_client.account.create_account({
            ...account,
            email: user_b,
            name: user_b,
            role_config: {
                role_name: role_b,
                assume_role_policy: policy
            }
        })).access_keys[0].access_key.unwrap();
        account_info_b = await rpc_client.account.read_account({ email: user_b });

        const s3accesspolicy = {
            Version: '2012-10-17',
            Statement: [{
                Effect: 'Allow',
                Principal: { AWS: [`arn:aws:iam::${account_info_a._id.toString()}:root`, `arn:aws:iam::${account_info_b._id.toString()}:root`,
                    `arn:aws:iam::${account_info_c._id.toString()}:root`] },
                Action: ['s3:*'],
                Resource: ['arn:aws:s3:::first.bucket/*', 'arn:aws:s3:::first.bucket'],
            }]
        };

        sts = new AWS.STS({
            ...sts_creds,
            accessKeyId: user_a_keys[0].access_key.unwrap(),
            secretAccessKey: user_a_keys[0].secret_key.unwrap()
        });
        sts_c = new AWS.STS({
            ...sts_creds,
            accessKeyId: user_c_keys[0].access_key.unwrap(),
            secretAccessKey: user_c_keys[0].secret_key.unwrap()
        });
        const random_access_keys = cloud_utils.generate_access_keys();
        anon_sts = new AWS.STS({
            ...sts_creds,
            accessKeyId: random_access_keys.access_key.unwrap(),
            secretAccessKey: random_access_keys.secret_key.unwrap()
        });
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
        for (const email of accounts) {
            await rpc_client.account.delete_account({ email });
        }
    });

    mocha.it('user a assume role of admin - should be rejected', async function() {
        await assert_throws_async(sts.assumeRole({
            RoleArn: `arn:aws:sts::${admin_keys[0].access_key.unwrap()}:role/${'dummy_role'}`,
            RoleSessionName: 'just_a_dummy_session_name'
        }).promise(), errors.access_denied.code, errors.access_denied.message);
    });

    mocha.it('admin assume role of user b - should be allowed', async function() {
        const params = {
            RoleArn: `arn:aws:sts::${user_b_key}:role/${role_b}`,
            RoleSessionName: 'just_a_dummy_session_name'
        };
        const json = await assume_role_and_parse_xml(sts_admin, params);
        validate_assume_role_response(json, `arn:aws:sts::${user_b_key}:assumed-role/${role_b}/${params.RoleSessionName}`,
            `${user_b_key}:${params.RoleSessionName}`, user_b_key, defualt_expiry_seconds);
    });

    mocha.it('admin assume non existing role of user b - should be rejected', async function() {
        await assert_throws_async(sts_admin.assumeRole({
            RoleArn: `arn:aws:sts::${user_b_key}:role/${'dummy_role2'}`,
            RoleSessionName: 'just_a_dummy_session_name1'
        }).promise(), errors.access_denied.code, errors.access_denied.message);
    });

    mocha.it('admin assume non existing role of non existing user - should be rejected', async function() {
        await assert_throws_async(sts_admin.assumeRole({
            RoleArn: `arn:aws:sts::${12345}:role/${'dummy_role3'}`,
            RoleSessionName: 'just_a_dummy_session_name2'
        }).promise(), errors.access_denied.code, errors.access_denied.message);
    });

    mocha.it('anonymous user a assume role of user b - should be rejected', async function() {
        await assert_throws_async(anon_sts.assumeRole({
            RoleArn: `arn:aws:sts::${user_b_key}:role/${role_b}`,
            RoleSessionName: 'just_a_dummy_session_name'
        }).promise(), errors.access_denied.code, errors.access_denied.message);
    });

    mocha.it('user c assume role of user b - should be allowed', async function() {
        const params = {
            RoleArn: `arn:aws:sts::${user_b_key}:role/${role_b}`,
            RoleSessionName: 'just_a_dummy_session_name'
        };
        const json = await assume_role_and_parse_xml(sts_c, params);
        validate_assume_role_response(json, `arn:aws:sts::${user_b_key}:assumed-role/${role_b}/${params.RoleSessionName}`,
            `${user_b_key}:${params.RoleSessionName}`, user_b_key, defualt_expiry_seconds);

        const temp_creds = validate_assume_role_response(json, `arn:aws:sts::${user_b_key}:assumed-role/${role_b}/${params.RoleSessionName}`,
            `${user_b_key}:${params.RoleSessionName}`, user_b_key, defualt_expiry_seconds);
        const s3 = new AWS.S3({
            ...sts_creds,
            accessKeyId: temp_creds.access_key,
            secretAccessKey: temp_creds.secret_key,
            sessionToken: temp_creds.session_token,
            endpoint: coretest.get_https_address(),
        });
        const list_objects_res = await s3.listObjects({ Bucket: 'first.bucket' }).promise();
        assert.ok(list_objects_res);
    });

    mocha.it('user a assume role of user b - should be rejected', async function() {
        await assert_throws_async(sts.assumeRole({
            RoleArn: `arn:aws:sts::${user_b_key}:role/${role_b}`,
            RoleSessionName: 'just_a_dummy_session_name'
        }).promise(), errors.access_denied.code, errors.access_denied.message);
    });

    mocha.it('update assume role policy of user b to allow user a', async function() {
        const policy = {
            version: '2012-10-17',
            statement: [{
                effect: 'allow',
                principal: [user_c, user_a],
                action: ['sts:AssumeRole']
            }]
        };
        await rpc_client.account.update_account({
            email: user_b,
            role_config: {
                role_name: role_b,
                assume_role_policy: policy
            }
        });
    });

    mocha.it('user a assume role of user b - should be allowed', async function() {
        const params = {
            RoleArn: `arn:aws:sts::${user_b_key}:role/${role_b}`,
            RoleSessionName: 'just_a_dummy_session_name'
        };
        const json = await assume_role_and_parse_xml(sts, params);
        validate_assume_role_response(json, `arn:aws:sts::${user_b_key}:assumed-role/${role_b}/${params.RoleSessionName}`,
            `${user_b_key}:${params.RoleSessionName}`, user_b_key, defualt_expiry_seconds);
    });

    mocha.it('update assume role policy of user b to allow user a', async function() {
        const policy = {
            version: '2012-10-17',
            statement: [{
                    effect: 'deny',
                    principal: [user_a],
                    action: ['sts:AssumeRole']
                },
                {
                    effect: 'allow',
                    principal: [user_c],
                    action: ['sts:AssumeRole']
                }
            ]
        };
        await rpc_client.account.update_account({
            email: user_b,
            role_config: {
                role_name: role_b,
                assume_role_policy: policy
            }
        });
    });

    mocha.it('user a assume role of user b - should be rejected', async function() {
        await assert_throws_async(sts.assumeRole({
            RoleArn: `arn:aws:sts::${user_b_key}:role/${role_b}`,
            RoleSessionName: 'just_a_dummy_session_name'
        }).promise(), errors.access_denied.code, errors.access_denied.message);
    });

    mocha.it('user c assume role of user b - should be allowed', async function() {
        const params = {
            RoleArn: `arn:aws:sts::${user_b_key}:role/${role_b}`,
            RoleSessionName: 'just_a_dummy_session_name'
        };
        const json = await assume_role_and_parse_xml(sts_c, params);
        validate_assume_role_response(json, `arn:aws:sts::${user_b_key}:assumed-role/${role_b}/${params.RoleSessionName}`,
            `${user_b_key}:${params.RoleSessionName}`, user_b_key, defualt_expiry_seconds);
    });

    mocha.it('update assume role policy of user b to allow user a sts:*', async function() {
        const policy = {
            version: '2012-10-17',
            statement: [{
                    effect: 'deny',
                    principal: [user_a],
                    action: ['sts:*']
                },
                {
                    effect: 'allow',
                    principal: [user_c],
                    action: ['sts:AssumeRole']
                }
            ]
        };
        await rpc_client.account.update_account({
            email: user_b,
            role_config: {
                role_name: role_b,
                assume_role_policy: policy
            }
        });
    });

    mocha.it('user a assume role of user b - should be rejected sts:*', async function() {
        await assert_throws_async(sts.assumeRole({
            RoleArn: `arn:aws:sts::${user_b_key}:role/${role_b}`,
            RoleSessionName: 'just_a_dummy_session_name'
        }).promise(), errors.access_denied.code, errors.access_denied.message);
    });

    mocha.it('user c assume role of user b - should be allowed sts:*', async function() {
        const params = {
            RoleArn: `arn:aws:sts::${user_b_key}:role/${role_b}`,
            RoleSessionName: 'just_a_dummy_session_name'
        };
        const json = await assume_role_and_parse_xml(sts_c, params);
        validate_assume_role_response(json, `arn:aws:sts::${user_b_key}:assumed-role/${role_b}/${params.RoleSessionName}`,
            `${user_b_key}:${params.RoleSessionName}`, user_b_key, defualt_expiry_seconds);
    });

    mocha.it('update assume role policy of user b to allow user a *', async function() {
        const policy = {
            version: '2012-10-17',
            statement: [{
                effect: 'deny',
                principal: ['*'],
                action: ['sts:AssumeRole']
            }]
        };
        await rpc_client.account.update_account({
            email: user_b,
            role_config: {
                role_name: role_b,
                assume_role_policy: policy
            }
        });
    });

    mocha.it('user a assume role of user b - should be rejected *', async function() {
        await assert_throws_async(sts.assumeRole({
            RoleArn: `arn:aws:sts::${user_b_key}:role/${role_b}`,
            RoleSessionName: 'just_a_dummy_session_name'
        }).promise(), errors.access_denied.code, errors.access_denied.message);
    });

    mocha.it('user c assume role of user b - should be rejected *', async function() {
        await assert_throws_async(sts_c.assumeRole({
            RoleArn: `arn:aws:sts::${user_b_key}:role/${role_b}`,
            RoleSessionName: 'just_a_dummy_session_name'
        }).promise(), errors.access_denied.code, errors.access_denied.message);
    });
});

async function assume_role_and_parse_xml(sts, params) {
    const req = sts.assumeRole(params);
    let json;
    req.on('complete', async function(resp) {
        json = await http_utils.parse_xml_to_js(resp.httpResponse.body);
    });
    await req.promise();
    return json;
}

function validate_assume_role_response(json, expected_arn, expected_role_id, assumed_access_key, duration_seconds) {
    dbg.log0('test.sts.validate_assume_role_response: ', json);
    assert.ok(json && json.AssumeRoleResponse && json.AssumeRoleResponse.AssumeRoleResult);
    const result = json.AssumeRoleResponse.AssumeRoleResult[0];
    assert.ok(result);

    // validate credentials
    const credentials = result.Credentials[0];
    assert.ok(credentials && credentials.AccessKeyId[0] && credentials.SecretAccessKey[0]);
    const duration_ms = duration_seconds ? duration_seconds * 1000 : config.STS_DEFAULT_SESSION_TOKEN_EXPIRY_MS;
    const creds_generation_time_ms = new Date(credentials.Expiration[0]).getTime() - duration_ms;
    assert(creds_generation_time_ms < Date.now());
    if (config.STS_DEFAULT_SESSION_TOKEN_EXPIRY_MS !== 0) {
        verify_session_token(credentials.SessionToken[0], credentials.AccessKeyId[0],
            credentials.SecretAccessKey[0], assumed_access_key);
    }

    // validate assumed role user
    const assumed_role_user = result.AssumedRoleUser[0];
    assert.equal(assumed_role_user.Arn[0], expected_arn);
    assert.equal(assumed_role_user.AssumedRoleId[0], expected_role_id);

    assert.equal(result.PackedPolicySize[0], '0');
    return {
        access_key: credentials && credentials.AccessKeyId[0],
        secret_key: credentials && credentials.SecretAccessKey[0],
        session_token: credentials.SessionToken[0]
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
        const code_or_rpc_code = err.code || err.rpc_code;
        if (err.message !== expected_message || code_or_rpc_code !== expected_code) throw err;
    }
}

function verify_session_token(session_token, access_key, secret_key, assumed_role_access_key) {
    const session_token_json = jwt_utils.authorize_jwt_token(session_token);
    assert.equal(access_key, session_token_json.access_key);
    assert.equal(secret_key, session_token_json.secret_key);
    assert.equal(assumed_role_access_key, session_token_json.assumed_role_access_key);
}

mocha.describe('Session token tests', function() {
    const { rpc_client } = coretest;
    const alice2 = 'alice2';
    const bob2 = 'bob2';
    const charlie2 = 'charlie2';
    const accounts = [{ email: alice2 }, { email: bob2 }, { email: charlie2 }];
    let sts_creds;
    const role_alice = 'role_alice';

    mocha.after(async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);
        for (const account of accounts) {
            await rpc_client.account.delete_account({ email: account.email });
        }
    });

    mocha.before(async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);
        sts_creds = {
            endpoint: coretest.get_https_address_sts(),
            region: 'us-east-1',
            sslEnabled: true,
            computeChecksums: true,
            httpOptions: { agent: new https.Agent({ keepAlive: false, rejectUnauthorized: false }) },
            s3ForcePathStyle: true,
            signatureVersion: 'v4',
            s3DisableBodySigning: false,
        };
        const account_defaults = { has_login: false, s3_access: true };

        for (const account of accounts) {
            account.access_keys = (await rpc_client.account.create_account({
                ...account_defaults,
                name: account.email,
                email: account.email
            })).access_keys;

            account.sts = new AWS.STS({
                ...sts_creds,
                accessKeyId: account.access_keys[0].access_key.unwrap(),
                secretAccessKey: account.access_keys[0].secret_key.unwrap()
            });

            account.s3 = new AWS.S3({
                ...sts_creds,
                endpoint: coretest.get_https_address(),
                accessKeyId: account.access_keys[0].access_key.unwrap(),
                secretAccessKey: account.access_keys[0].secret_key.unwrap()
            });

        }

        const policy = {
            version: '2012-10-17',
            statement: [{
                effect: 'allow',
                principal: [bob2, charlie2],
                action: ['sts:AssumeRole'],
            }]
        };
        (await rpc_client.account.update_account({
            email: alice2,
            role_config: {
                role_name: role_alice,
                assume_role_policy: policy
            }
        }));
        const account_info_alice = await rpc_client.account.read_account({ email: alice2 });
        const s3accesspolicy = {
            Version: '2012-10-17',
            Statement: [{
                Effect: 'Allow',
                Principal: { AWS: `arn:aws:iam::${account_info_alice._id.toString()}:root` },
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
    });

    mocha.it('user b assume role of user a - default expiry - list s3 - should be allowed', async function() {
        const user_a_key = accounts[0].access_keys[0].access_key.unwrap();
        const params = {
            RoleArn: `arn:aws:sts::${user_a_key}:role/${role_alice}`,
            RoleSessionName: 'just_a_dummy_session_name'
        };

        const json = await assume_role_and_parse_xml(accounts[1].sts, params);
        const result_obj = validate_assume_role_response(json, `arn:aws:sts::${user_a_key}:assumed-role/${role_alice}/${params.RoleSessionName}`,
            `${user_a_key}:${params.RoleSessionName}`, user_a_key, defualt_expiry_seconds);

        const temp_s3_with_session_token = new AWS.S3({
            ...sts_creds,
            endpoint: coretest.get_https_address(),
            accessKeyId: result_obj.access_key,
            secretAccessKey: result_obj.secret_key,
            sessionToken: result_obj.session_token
        });

        const buckets1 = await temp_s3_with_session_token.listBuckets().promise();
        assert.ok(buckets1.Buckets.length > 0);
    });

    mocha.it('user b assume role of user a - valid expiry via durationSeconds - list s3 - should be allowed', async function() {
        const user_a_key = accounts[0].access_keys[0].access_key.unwrap();
        const duration_seconds = 25000;
        const params = {
            DurationSeconds: duration_seconds,
            RoleArn: `arn:aws:sts::${user_a_key}:role/${role_alice}`,
            RoleSessionName: 'just_a_dummy_session_name'
        };

        const json = await assume_role_and_parse_xml(accounts[1].sts, params);
        const result_obj = validate_assume_role_response(json, `arn:aws:sts::${user_a_key}:assumed-role/${role_alice}/${params.RoleSessionName}`,
            `${user_a_key}:${params.RoleSessionName}`, user_a_key, duration_seconds);

        const temp_s3_with_session_token = new AWS.S3({
            ...sts_creds,
            endpoint: coretest.get_https_address(),
            accessKeyId: result_obj.access_key,
            secretAccessKey: result_obj.secret_key,
            sessionToken: result_obj.session_token
        });

        const buckets1 = await temp_s3_with_session_token.listBuckets().promise();
        assert.ok(buckets1.Buckets.length > 0);
    });

    mocha.it('user b assume role of user a - invalid expiry via durationSeconds - should be rejected', async function() {
        const user_a_key = accounts[0].access_keys[0].access_key.unwrap();
        const params = {
            DurationSeconds: 43201,
            RoleArn: `arn:aws:sts::${user_a_key}:role/${role_alice}`,
            RoleSessionName: 'just_a_dummy_session_name'
        };

        const expected_error_message = `Value 43201 for durationSeconds failed to satisfy constraint:
            Member must have value less than or equal to 43200`;
        assert_throws_async(
            assume_role_and_parse_xml(accounts[0].sts, params),
            errors.validation_error.code,
            expected_error_message
        );
    });

    mocha.it('user b assume role of user a - default expiry - list s3 without session token - should be rejected', async function() {
        const user_a_key = accounts[0].access_keys[0].access_key.unwrap();
        const params = {
            RoleArn: `arn:aws:sts::${user_a_key}:role/${role_alice}`,
            RoleSessionName: 'just_a_dummy_session_name'
        };

        const json = await assume_role_and_parse_xml(accounts[1].sts, params);
        const result_obj = validate_assume_role_response(json, `arn:aws:sts::${user_a_key}:assumed-role/${role_alice}/${params.RoleSessionName}`,
            `${user_a_key}:${params.RoleSessionName}`, user_a_key, defualt_expiry_seconds);

        const temp_s3 = new AWS.S3({
            ...sts_creds,
            endpoint: coretest.get_https_address(),
            accessKeyId: result_obj.access_key,
            secretAccessKey: result_obj.secret_key,
        });

        await assert_throws_async(temp_s3.listBuckets().promise(),
            errors.invalid_access_key.code, errors.invalid_access_key.message);
    });

    mocha.it('user b, user c assume role of user a - default expiry - user b list s3 with session token of user c- should be rejected', async function() {
        const user_a_key = accounts[0].access_keys[0].access_key.unwrap();
        const params = {
            RoleArn: `arn:aws:sts::${user_a_key}:role/${role_alice}`,
            RoleSessionName: 'just_a_dummy_session_name'
        };

        const json1 = await assume_role_and_parse_xml(accounts[1].sts, params);
        const result_obj1 = validate_assume_role_response(json1, `arn:aws:sts::${user_a_key}:assumed-role/${role_alice}/${params.RoleSessionName}`,
            `${user_a_key}:${params.RoleSessionName}`, user_a_key, defualt_expiry_seconds);

        const json2 = await assume_role_and_parse_xml(accounts[2].sts, params);
        const result_obj2 = validate_assume_role_response(json2, `arn:aws:sts::${user_a_key}:assumed-role/${role_alice}/${params.RoleSessionName}`,
            `${user_a_key}:${params.RoleSessionName}`, user_a_key, defualt_expiry_seconds);

        const temp_s3 = new AWS.S3({
            ...sts_creds,
            endpoint: coretest.get_https_address(),
            accessKeyId: result_obj1.access_key,
            secretAccessKey: result_obj1.secret_key,
            sessionToken: result_obj2.session_token
        });

        await assert_throws_async(temp_s3.listBuckets().promise(),
            errors.signature_doesnt_match.code, errors.signature_doesnt_match.message);
    });

    mocha.it('user b assume role of user a - default expiry - list s3 with permanent creds and temp session token- should be allowed', async function() {
        const user_a_key = accounts[0].access_keys[0].access_key.unwrap();
        const user_a_secret = accounts[0].access_keys[0].secret_key.unwrap();
        const params = {
            RoleArn: `arn:aws:sts::${user_a_key}:role/${role_alice}`,
            RoleSessionName: 'just_a_dummy_session_name'
        };

        const json = await assume_role_and_parse_xml(accounts[1].sts, params);
        const result_obj = validate_assume_role_response(json, `arn:aws:sts::${user_a_key}:assumed-role/${role_alice}/${params.RoleSessionName}`,
            `${user_a_key}:${params.RoleSessionName}`, user_a_key, defualt_expiry_seconds);

        const temp_s3_with_session_token = new AWS.S3({
            ...sts_creds,
            endpoint: coretest.get_https_address(),
            accessKeyId: user_a_key,
            secretAccessKey: user_a_secret,
            sessionToken: result_obj.session_token
        });

        await assert_throws_async(temp_s3_with_session_token.listBuckets().promise(),
            errors.signature_doesnt_match.code, errors.signature_doesnt_match.message);
    });

    mocha.it('user b assume role of user a - default expiry - list s3 with faulty temp session token- should be allowed', async function() {
        const user_a_key = accounts[0].access_keys[0].access_key.unwrap();
        const params = {
            RoleArn: `arn:aws:sts::${user_a_key}:role/${role_alice}`,
            RoleSessionName: 'just_a_dummy_session_name'
        };

        const json = await assume_role_and_parse_xml(accounts[1].sts, params);
        const result_obj = validate_assume_role_response(json, `arn:aws:sts::${user_a_key}:assumed-role/${role_alice}/${params.RoleSessionName}`,
            `${user_a_key}:${params.RoleSessionName}`, user_a_key, defualt_expiry_seconds);

        const temp_s3_with_session_token = new AWS.S3({
            ...sts_creds,
            endpoint: coretest.get_https_address(),
            accessKeyId: result_obj.access_key,
            secretAccessKey: result_obj.secret_key,
            sessionToken: result_obj.session_token + 'dummy'
        });

        await assert_throws_async(temp_s3_with_session_token.listBuckets().promise(),
            errors.invalid_token_s3.code, errors.invalid_token_s3.message);
    });

    mocha.it('user b assume role of user a - default expiry - assume role sts with permanent creds and temp session token- should be allowed', async function() {
        const user_a_key = accounts[0].access_keys[0].access_key.unwrap();
        const user_a_secret = accounts[0].access_keys[0].secret_key.unwrap();
        const params = {
            RoleArn: `arn:aws:sts::${user_a_key}:role/${role_alice}`,
            RoleSessionName: 'just_a_dummy_session_name'
        };

        const json = await assume_role_and_parse_xml(accounts[1].sts, params);
        const result_obj = validate_assume_role_response(json, `arn:aws:sts::${user_a_key}:assumed-role/${role_alice}/${params.RoleSessionName}`,
            `${user_a_key}:${params.RoleSessionName}`, user_a_key, defualt_expiry_seconds);

        const temp_sts_with_session_token = new AWS.STS({
            ...sts_creds,
            endpoint: coretest.get_https_address_sts(),
            accessKeyId: user_a_key,
            secretAccessKey: user_a_secret,
            sessionToken: result_obj.session_token
        });

        await assert_throws_async(temp_sts_with_session_token.assumeRole(params).promise(),
            errors.access_denied.code, errors.access_denied.message);
    });

    mocha.it('user b assume role of user a - default expiry - assume role sts faulty temp session token- should be allowed', async function() {
        const user_a_key = accounts[0].access_keys[0].access_key.unwrap();
        const params = {
            RoleArn: `arn:aws:sts::${user_a_key}:role/${role_alice}`,
            RoleSessionName: 'just_a_dummy_session_name'
        };

        const json = await assume_role_and_parse_xml(accounts[1].sts, params);
        const result_obj = validate_assume_role_response(json, `arn:aws:sts::${user_a_key}:assumed-role/${role_alice}/${params.RoleSessionName}`,
            `${user_a_key}:${params.RoleSessionName}`, user_a_key, defualt_expiry_seconds);

        const temp_sts_with_session_token = new AWS.STS({
            ...sts_creds,
            endpoint: coretest.get_https_address_sts(),
            accessKeyId: result_obj.access_key,
            secretAccessKey: result_obj.secret_key,
            sessionToken: result_obj.session_token + 'dummy'
        });

        await assert_throws_async(temp_sts_with_session_token.assumeRole(params).promise(),
            errors.invalid_token.code, errors.invalid_token.message);
    });

    mocha.it('user b assume role of user a - expiry 0 - list s3 - should be rejected', async function() {
        config.STS_DEFAULT_SESSION_TOKEN_EXPIRY_MS = 0;
        const user_a_key = accounts[0].access_keys[0].access_key.unwrap();
        const params = {
            RoleArn: `arn:aws:sts::${user_a_key}:role/${role_alice}`,
            RoleSessionName: 'just_a_dummy_session_name'
        };

        const json = await assume_role_and_parse_xml(accounts[1].sts, params);
        const result_obj = validate_assume_role_response(json, `arn:aws:sts::${user_a_key}:assumed-role/${role_alice}/${params.RoleSessionName}`,
            `${user_a_key}:${params.RoleSessionName}`, user_a_key, defualt_expiry_seconds);

        const temp_s3_with_session_token = new AWS.S3({
            ...sts_creds,
            endpoint: coretest.get_https_address(),
            accessKeyId: result_obj.access_key,
            secretAccessKey: result_obj.secret_key,
            sessionToken: result_obj.session_token
        });

        await assert_throws_async(temp_s3_with_session_token.listBuckets().promise(),
            errors.expired_token_s3.code, errors.expired_token_s3.message);
    });

    mocha.it('user b assume role of user a - expiry 0 - assume role sts - should be rejected', async function() {
        config.STS_DEFAULT_SESSION_TOKEN_EXPIRY_MS = 0;

        const user_a_key = accounts[0].access_keys[0].access_key.unwrap();
        const params = {
            RoleArn: `arn:aws:sts::${user_a_key}:role/${role_alice}`,
            RoleSessionName: 'just_a_dummy_session_name'
        };

        const json = await assume_role_and_parse_xml(accounts[1].sts, params);
        const result_obj = validate_assume_role_response(json, `arn:aws:sts::${user_a_key}:assumed-role/${role_alice}/${params.RoleSessionName}`,
            `${user_a_key}:${params.RoleSessionName}`, user_a_key, defualt_expiry_seconds);

        const temp_sts_with_session_token = new AWS.STS({
            ...sts_creds,
            endpoint: coretest.get_https_address_sts(),
            accessKeyId: result_obj.access_key,
            secretAccessKey: result_obj.secret_key,
            sessionToken: result_obj.session_token
        });

        await assert_throws_async(temp_sts_with_session_token.assumeRole(params).promise(),
            errors.expired_token.code, errors.expired_token.message);
    });
});


mocha.describe('Assume role policy tests', function() {
    const { rpc_client, EMAIL } = coretest;
    const valid_assume_policy = {
        version: '2012-10-17',
        statement: [{
            effect: 'allow',
            principal: [EMAIL],
            action: ['sts:AssumeRole'],
        }]
    };
    const account_defaults = { has_login: false, s3_access: true };

    mocha.it('create account with role policy - missing role_config', async function() {
        const empty_role_config = {};
        const email = 'assume_email1';
        await assert_throws_async(rpc_client.account.create_account({
            ...account_defaults,
            email,
            name: email,
            role_config: empty_role_config
        }), errors.invalid_schema_params.code, errors.invalid_schema_params.message);
    });

    mocha.it('create account with role policy - missing assume role policy', async function() {
        const empty_assume_role_policy = { role_name: 'role_name2' };
        const email = 'assume_email2';
        await assert_throws_async(rpc_client.account.create_account({
            ...account_defaults,
            email,
            name: email,
            role_config: empty_assume_role_policy
        }), errors.invalid_schema_params.code, errors.invalid_schema_params.message);
    });

    mocha.it('create account with role policy- invalid principal', async function() {
        const invalid_action = { principal: ['non_existing_email'] };
        const email = 'assume_email3';
        const assume_role_policy = {
            ...valid_assume_policy,
            statement: [{
                ...valid_assume_policy.statement[0],
                ...invalid_action
            }]
        };
        await assert_throws_async(rpc_client.account.create_account({
            ...account_defaults,
            email,
            name: email,
            role_config: {
                role_name: 'role_name3',
                assume_role_policy
            }
        }), errors.malformed_policy.rpc_code, errors.malformed_policy.message_principal);
    });

    mocha.it('create account with role policy- invalid effect', async function() {
        const invalid_action = { effect: 'non_existing_effect' };
        const email = 'assume_email3';
        const assume_role_policy = {
            ...valid_assume_policy,
            statement: [{
                ...valid_assume_policy.statement[0],
                ...invalid_action
            }]
        };
        await assert_throws_async(rpc_client.account.create_account({
            ...account_defaults,
            email,
            name: email,
            role_config: {
                role_name: 'role_name3',
                assume_role_policy
            }
        }), errors.invalid_schema_params.code, errors.invalid_schema_params.message);
    });

    mocha.it('create account with role policy - invalid action', async function() {
        const invalid_action = { action: ['sts:InvalidAssumeRole'] };
        const email = 'assume_email3';
        const assume_role_policy = {
            ...valid_assume_policy,
            statement: [{
                ...valid_assume_policy.statement[0],
                ...invalid_action
            }]
        };
        await assert_throws_async(rpc_client.account.create_account({
            ...account_defaults,
            email,
            name: email,
            role_config: {
                role_name: 'role_name3',
                assume_role_policy
            }
        }), errors.malformed_policy.rpc_code, errors.malformed_policy.message_action);
    });
});

mocha.describe('Assume role with web indentity tests', function() {
    const user_a = 'alice1';

    /** @type {AWS.STS} */
    let anon_sts;
    mocha.before(async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);

        // const random_access_keys = cloud_utils.generate_access_keys();
        anon_sts = new AWS.STS({
            endpoint: coretest.get_https_address_sts(),
            region: 'us-east-1',
            sslEnabled: true,
            computeChecksums: true,
            httpOptions: { agent: new https.Agent({ keepAlive: false, rejectUnauthorized: false }) },
            s3ForcePathStyle: true,
            signatureVersion: 'v4',
            s3DisableBodySigning: false,
        });
        ldap_client.instance().ldap_params = {
            jwt_secret: "TEST_SECRET"
        };
    });

    mocha.it('anonymous user a with bad jwt - should be rejected', async function() {
        await assert_throws_async(anon_sts.assumeRoleWithWebIdentity({
            RoleArn: `arn:aws:sts::ldap:role/${user_a}`,
            RoleSessionName: 'just_a_dummy_session_name',
            WebIdentityToken: 'just_a_dummy_wit'
        }).promise(), stsErr.InvalidIdentityToken.code, "jwt malformed");
    });

    mocha.it('anonymous user a with invalid signature - should be rejected', async function() {
        const bad_signed_wit = jwt.sign({ user: user_a, password: 'dummy_password' }, 'invalid signature');
        await assert_throws_async(anon_sts.assumeRoleWithWebIdentity({
            RoleArn: `arn:aws:sts::ldap:role/${user_a}`,
            RoleSessionName: 'just_a_dummy_session_name',
            WebIdentityToken: bad_signed_wit
        }).promise(), stsErr.InvalidIdentityToken.code, "invalid signature");
    });

    mocha.it('anonymous user a with missing password - should be rejected', async function() {
        const missing_pwd_wit = jwt.sign({ user: user_a }, ldap_client.instance().ldap_params.jwt_secret);
        await assert_throws_async(anon_sts.assumeRoleWithWebIdentity({
            RoleArn: `arn:aws:sts::ldap:role/${user_a}`,
            RoleSessionName: 'just_a_dummy_session_name',
            WebIdentityToken: missing_pwd_wit
        }).promise(), stsErr.InvalidIdentityToken.code, "Missing a required claim: password");
    });

    mocha.it('anonymous user a with missing user name - should be rejected', async function() {
        const missing_usr_wit = jwt.sign({ password: 'password' }, ldap_client.instance().ldap_params.jwt_secret);
        await assert_throws_async(anon_sts.assumeRoleWithWebIdentity({
            RoleArn: `arn:aws:sts::ldap:role/${user_a}`,
            RoleSessionName: 'just_a_dummy_session_name',
            WebIdentityToken: missing_usr_wit
        }).promise(), stsErr.InvalidIdentityToken.code, "Missing a required claim: user");
    });
});
