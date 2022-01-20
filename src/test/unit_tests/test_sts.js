/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup({ pools_to_create: coretest.POOL_LIST });
const AWS = require('aws-sdk');
const https = require('https');
const mocha = require('mocha');
const assert = require('assert');
const stsErr = require('../../endpoint/sts/sts_errors').StsError;
const http_utils = require('../../util/http_utils');
const dbg = require('../../util/debug_module')(__filename);
const cloud_utils = require('../../util/cloud_utils');

const errors = {
    access_denied: {
        code: stsErr.AccessDeniedException.code,
        message: stsErr.AccessDeniedException.message
    },
    invalid_action: {
        code: stsErr.InvalidAction.code,
        message: stsErr.InvalidAction.message
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

    let sts_admin;
    let sts;
    let sts_c;
    let anon_sts;
    let admin_keys;
    let user_b_key;
    const role_b = 'RoleB';
    mocha.before(async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);
        const sts_creds = {
            endpoint: coretest.get_https_address_sts(),
            region: 'us-east-1',
            sslEnabled: true,
            computeChecksums: true,
            httpOptions: { agent: new https.Agent({ keepAlive: false, rejectUnauthorized: false }) },
            s3ForcePathStyle: true,
            signatureVersion: 'v4',
            s3DisableBodySigning: false,
        };
        const account = { has_login: false, s3_access: true, allowed_buckets: { full_permission: true } };
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
        const user_c_keys = (await rpc_client.account.create_account({ ...account, email: user_c, name: user_c })).access_keys;
        user_b_key = (await rpc_client.account.create_account({
            ...account,
            email: user_b,
            name: user_b,
            role_config: {
                role_name: role_b,
                assume_role_policy: policy
            }
        })).access_keys[0].access_key.unwrap();

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
            `${user_b_key}:${params.RoleSessionName}`, '');
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
            `${user_b_key}:${params.RoleSessionName}`, '');
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
            `${user_b_key}:${params.RoleSessionName}`, '');
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
            `${user_b_key}:${params.RoleSessionName}`, '');
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
            `${user_b_key}:${params.RoleSessionName}`, '');
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

function validate_assume_role_response(json, expected_arn, expected_role_id, expected_session_token) {
    dbg.log0('test.sts.validate_assume_role_response: ', json);
    assert.ok(json && json.AssumeRoleResponse && json.AssumeRoleResponse.AssumeRoleResult);
    let result = json.AssumeRoleResponse.AssumeRoleResult[0];
    assert.ok(result);

    // validate credentials
    let credentials = result.Credentials[0];
    assert.ok(credentials && credentials.AccessKeyId[0] && credentials.SecretAccessKey[0]);
    assert.equal(credentials.Expiration[0], '');
    assert.equal(credentials.SessionToken[0], expected_session_token);

    // validate assumed role user
    let assumed_role_user = result.AssumedRoleUser[0];
    assert.equal(assumed_role_user.Arn[0], expected_arn);
    assert.equal(assumed_role_user.AssumedRoleId[0], expected_role_id);

    assert.equal(result.PackedPolicySize[0], '0');
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
    const account_defaults = { has_login: false, s3_access: true, allowed_buckets: { full_permission: true } };

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
        let assume_role_policy = {
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
        let assume_role_policy = {
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
        let assume_role_policy = {
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
