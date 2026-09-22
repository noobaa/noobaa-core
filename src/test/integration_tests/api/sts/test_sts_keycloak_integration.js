/* Copyright (C) 2026 NooBaa */
/* eslint max-lines-per-function: ['error', 700] */
'use strict';

/**
 * Integration tests for AssumeRoleWithWebIdentity with Keycloak (OIDC) mock.
 *
 * Strategy
 * --------
 * Keycloak is never actually started.  We mock two integration points so that
 * the NooBaa server-side code believes Keycloak is fully configured and that a
 * supplied access token is valid:
 *
 *   1. `keycloak_client.is_keycloak_configured()` - stubbed to return `true`.
 *   2. `keycloak_client.get_instance()` - returns a fake KeyCloakClientManager
 *      whose `get_provider()` returns a mock provider with a controllable
 *      `introspect_token()` implementation.
 *
 * Test groups
 * -----------
 * A. Role creation and basic AssumeRoleWithWebIdentity flow
 * B. Trust-policy condition validation (aws:RequestTag, aud, sub, ForAnyValue)
 * C. S3 request flow using the AWS_SESSION_TOKEN returned by AssumeRoleWithWebIdentity
 * D. IAM role policy enforcement with temporary credentials + aws:PrincipalTag
 */

// setup coretest first to prepare the env
const { require_coretest, is_nc_coretest, generate_iam_client,
    generate_s3_client, generate_sts_client } = require('../../../system_tests/test_utils');
const coretest = require_coretest();
coretest.setup();

const mocha = require('mocha');
const assert = require('assert');
const jwt = require('jsonwebtoken');
const sinon = require('sinon');

const stsErr = require('../../../../endpoint/sts/sts_errors').StsError;
const { S3Error } = require('../../../../endpoint/s3/s3_errors');
const jwt_utils = require('../../../../util/jwt_utils');
const keycloak_client = require('../../../../util/keycloak_client');
const config = require('../../../../../config');
const { RpcError } = require('../../../../rpc');
const dbg = require('../../../../util/debug_module')(__filename);

const {
    CreateRoleCommand,
    DeleteRoleCommand,
    PutRolePolicyCommand,
} = require('@aws-sdk/client-iam');

const { AssumeRoleWithWebIdentityCommand } = require('@aws-sdk/client-sts');

// ---------------------------------------------------------------------------
// Constants & helpers shared by all describe blocks
// ---------------------------------------------------------------------------

const KEYCLOAK_ISSUER = 'http://keycloak.noobaa.svc.cluster.local:8080/realms/noobaa';
const KEYCLOAK_CLIENT_ID = 'noobaa-client';
const KEYCLOAK_SUBJECT = '1e59d996-2aa9-4a91-9740-d9cf61ccfd3e';

/** JWT private key used to sign mock Keycloak tokens (RS256-like but via HS256 for simplicity). */
const MOCK_JWT_SECRET = 'mock-keycloak-test-secret';

/**
 * Admin-owned bucket shared by S3 temporary-credential suites (C, D, G).
 * Created once via the coretest admin account (same ownership model as first.bucket).
 */
const KC_STS_TEST_BUCKET = 'kc-sts-test-bucket';

/** @type {import('@aws-sdk/client-s3').S3 | undefined} */
let admin_s3_for_kc_sts;

mocha.before('create admin-owned Keycloak STS test bucket', async function() {
    const self = this; // eslint-disable-line no-invalid-this
    self.timeout(60000);
    const { rpc_client, EMAIL } = coretest;
    const admin_keys = (await rpc_client.account.read_account({ email: EMAIL })).access_keys;
    admin_s3_for_kc_sts = generate_s3_client(
        admin_keys[0].access_key.unwrap(),
        admin_keys[0].secret_key.unwrap(),
        coretest.get_http_address()
    );
    await admin_s3_for_kc_sts.createBucket({ Bucket: KC_STS_TEST_BUCKET });
});

mocha.after('delete admin-owned Keycloak STS test bucket', async function() {
    const self = this; // eslint-disable-line no-invalid-this
    self.timeout(60000);
    if (!admin_s3_for_kc_sts) return;
    try {
        await admin_s3_for_kc_sts.deleteBucket({ Bucket: KC_STS_TEST_BUCKET });
    } catch (_) { /* ignore */ }
});

/**
 * Build the OIDC-provider ARN used as Principal.Federated in trust policies.
 * Format: arn:aws:iam::<account_id>:oidc-provider/<issuer-host-and-path>
 *
 * @param {string} account_id - NooBaa account _id (used as the account-id segment)
 * @returns {string}
 */
function make_keycloak_federated_arn(account_id) {
    const issuer_without_scheme = KEYCLOAK_ISSUER.replace(/^https?:\/\//, '');
    return `arn:aws:iam::${account_id}:oidc-provider/${issuer_without_scheme}`;
}

/**
 * Build the expected IAM-policy access-denied message that NooBaa produces via
 * create_detailed_message_for_iam_user_access() for an assumed-role session.
 *
 * Format:
 *   User: <role_arn> is not authorized to perform: <action>
 *   on resource: <resource_arn> because no identity-based policy allows the <action> action
 *
 * @param {string} role_arn   - e.g. 'arn:aws:sts::<id>:role/MyRole'
 * @param {string} action     - e.g. 's3:ListBucket'
 * @param {string} resource   - e.g. 'arn:aws:s3:::my-bucket'
 * @returns {string}
 */
function make_iam_access_denied_message(role_arn, action, resource) {
    return `User: ${role_arn} is not authorized to perform: ${action} ` +
           `on resource: ${resource} ` +
           `because no identity-based policy allows the ${action} action`;
}

/**
 * Build a JWT that looks like a Keycloak access-token.
 * Pass `extra_claims` to embed session tags, aud, sub, etc.
 *
 * @param {Object} extra_claims
 * @param {Object} sign_opts - jsonwebtoken sign options (e.g. expiresIn, algorithm)
 */
function make_keycloak_jwt(extra_claims = {}, sign_opts = { expiresIn: '1h' }) {
    return jwt.sign({
        iss: KEYCLOAK_ISSUER,
        sub: KEYCLOAK_SUBJECT,
        aud: [KEYCLOAK_CLIENT_ID, 'account'],
        azp: KEYCLOAK_CLIENT_ID,
        ...extra_claims,
    }, MOCK_JWT_SECRET, sign_opts);
}

/**
 * Build a mock introspection response that mirrors what Keycloak would return.
 *
 * @param {Object} overrides - any field to override in the default response
 */
function make_introspect_response(overrides = {}) {
    return {
        active: true,
        sub: KEYCLOAK_SUBJECT,
        client_id: KEYCLOAK_CLIENT_ID,
        aud: KEYCLOAK_CLIENT_ID,
        iss: KEYCLOAK_ISSUER,
        ...overrides,
    };
}

/**
 * Build a mock KeyCloakClientManager that `keycloak_client.get_instance()` will return.
 * `introspect_fn` controls what `introspect_token()` does.
 *
 * @param {Function} introspect_fn async (token) => introspection_response | throws
 */
function make_mock_keycloak_instance(introspect_fn) {
    return {
        initialized: true,
        initialize: async () => { /* no-op */ },
        get_provider: issuer => (issuer === KEYCLOAK_ISSUER ? { configured: true } : null),
        verify_token: async token => jwt.decode(token),
        introspect_token: introspect_fn,
    };
}

/**
 * Install sinon stubs that make the server-side Keycloak path active.
 * Returns a restore function; call it in `afterEach` / `after`.
 *
 * @param {Function} introspect_fn - async (token) => ...
 * @returns {{ restore: Function }}
 */
function stub_keycloak(introspect_fn) {
    const mock_instance = make_mock_keycloak_instance(introspect_fn);
    const get_instance_stub = sinon.stub(keycloak_client, 'get_instance').returns(mock_instance);
    const is_configured_stub = sinon.stub(keycloak_client, 'is_keycloak_configured').resolves(true);
    return {
        restore() {
            get_instance_stub.restore();
            is_configured_stub.restore();
        },
    };
}

/**
 * Send AssumeRoleWithWebIdentity via the SDK v3 client and return the response.
 */
async function assume_role_with_web_identity(anon_sts, params) {
    return anon_sts.send(new AssumeRoleWithWebIdentityCommand(params));
}

/**
 * Validate the AssumeRoleWithWebIdentity response structure and return
 * the temporary credentials.
 */
function validate_web_identity_response(response, expected_arn, expected_role_id, assumed_access_key) {
    assert.ok(response && response.Credentials && response.AssumedRoleUser,
        'Response must contain Credentials and AssumedRoleUser');

    const credentials = response.Credentials;
    assert.ok(credentials.AccessKeyId, 'AccessKeyId must be present');
    assert.ok(credentials.SecretAccessKey, 'SecretAccessKey must be present');
    assert.ok(credentials.SessionToken, 'SessionToken must be present');

    // Verify the session token encodes the correct assumed-role access key
    if (config.STS_DEFAULT_SESSION_TOKEN_EXPIRY_MS !== 0) {
        const session_token_json = jwt_utils.authorize_jwt_token(credentials.SessionToken);
        assert.equal(session_token_json.access_key, credentials.AccessKeyId);
        assert.equal(session_token_json.secret_key, credentials.SecretAccessKey);
        assert.equal(session_token_json.assumed_role_access_key, assumed_access_key);
        assert.ok(session_token_json.assumed_role_arn);
    }

    // AssumedRoleUser
    assert.equal(response.AssumedRoleUser.Arn, expected_arn, 'ARN must match');
    assert.equal(response.AssumedRoleUser.AssumedRoleId, expected_role_id, 'AssumedRoleId must match');

    return {
        access_key: credentials.AccessKeyId,
        secret_key: credentials.SecretAccessKey,
        session_token: credentials.SessionToken,
    };
}

/**
 * Assert that a promise rejects with the expected AWS error code and message.
 */
async function assert_throws_async(promise, expected_code, expected_message) {
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

/**
 * Create a test account with S3 access and return the read account object.
 */
async function create_test_account(rpc_client, email) {
    const account_defaults = { has_login: false, s3_access: true };
    await rpc_client.account.create_account({ ...account_defaults, name: email, email });
    return rpc_client.account.read_account({ email });
}

/**
 * Build IAM + anonymous STS clients for a role-owner account.
 */
function setup_role_owner_clients(account) {
    const keys = account.access_keys;
    return {
        iam_client: generate_iam_client(
            keys[0].access_key.unwrap(),
            keys[0].secret_key.unwrap(),
            coretest.get_https_address_iam()
        ),
        anon_sts: generate_sts_client('', '', coretest.get_https_address_sts()),
    };
}

/**
 * Delete the given IAM roles (ignoring missing roles) then delete the account.
 */
async function cleanup_roles_and_account(rpc_client, iam_client, role_names, email) {
    for (const role of role_names) {
        try {
            await iam_client.send(new DeleteRoleCommand({ RoleName: role }));
        } catch (_) { /* ignore */ }
    }
    await rpc_client.account.delete_account({ email });
}

/**
 * Grant the account full s3:* access on the bucket via an open bucket policy.
 */
async function put_account_open_bucket_policy(rpc_client, bucket, account_id, email) {
    await rpc_client.bucket.put_bucket_policy({
        name: bucket,
        policy: {
            Version: '2012-10-17',
            Statement: [{
                Effect: 'Allow',
                Principal: {
                    AWS: is_nc_coretest ? email : `arn:aws:iam::${account_id}:root`,
                },
                Action: ['s3:*'],
                Resource: [
                    `arn:aws:s3:::${bucket}`,
                    `arn:aws:s3:::${bucket}/*`,
                ],
            }],
        },
    });
}

/**
 * Build an S3 client from AssumeRoleWithWebIdentity temporary credentials.
 * Pass session_token to override (e.g. omit, tamper, or swap tokens).
 */
function s3_client_from_temp_creds(creds, session_token = creds.SessionToken) {
    return generate_s3_client(
        creds.AccessKeyId,
        creds.SecretAccessKey,
        coretest.get_http_address(),
        session_token
    );
}

/**
 * Assert that listObjects is denied by an IAM identity-based policy for the role.
 */
async function assert_s3_list_access_denied(s3, bucket, role_arn) {
    await assert_throws_async(
        s3.listObjects({ Bucket: bucket }),
        S3Error.AccessDenied.code,
        make_iam_access_denied_message(role_arn, 's3:ListBucket', `arn:aws:s3:::${bucket}`)
    );
}

/**
 * Restore Keycloak stubs if present; returns null for easy reassignment.
 */
function restore_kc_stubs(kc_stubs) {
    if (kc_stubs) kc_stubs.restore();
    return null;
}


// ---------------------------------------------------------------------------
// A. Role creation and basic AssumeRoleWithWebIdentity flow
// ---------------------------------------------------------------------------

mocha.describe('Keycloak AssumeRoleWithWebIdentity - basic flow', function() {
    const { rpc_client } = coretest;

    // Accounts
    const role_owner_email = 'kc-role-owner-a1';

    let role_owner_account;
    let iam_client_role_owner;
    let anon_sts;
    const test_role_name = 'KeycloakTestRoleA';

    /** Keycloak stubs; replaced per-test where needed */
    let kc_stubs;

    mocha.before(async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);

        role_owner_account = await create_test_account(rpc_client, role_owner_email);

        ({ iam_client: iam_client_role_owner, anon_sts } = setup_role_owner_clients(role_owner_account));

        // Create a role with a trust policy that accepts any Federated principal (web identity)
        const trust_policy = {
            Version: '2012-10-17',
            Statement: [{
                Effect: 'Allow',
                Principal: { Federated: make_keycloak_federated_arn(role_owner_account._id.toString()) },
                Action: ['sts:AssumeRoleWithWebIdentity'],
            }],
        };
        await iam_client_role_owner.send(new CreateRoleCommand({
            RoleName: test_role_name,
            AssumeRolePolicyDocument: JSON.stringify(trust_policy),
        }));
    });

    mocha.after(async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);
        kc_stubs = restore_kc_stubs(kc_stubs);
        await cleanup_roles_and_account(rpc_client, iam_client_role_owner, [test_role_name], role_owner_email);
    });

    mocha.afterEach(function() {
        kc_stubs = restore_kc_stubs(kc_stubs);
    });

    mocha.it('should successfully assume role with a valid Keycloak token', async function() {
        const role_owner_access_key = role_owner_account.access_keys[0].access_key.unwrap();
        const account_id = role_owner_account._id.toString();
        const role_session = 'my-kc-session';

        kc_stubs = stub_keycloak(async () => make_introspect_response());

        const web_identity_token = make_keycloak_jwt();
        const params = {
            RoleArn: `arn:aws:sts::${account_id}:role/${test_role_name}`,
            RoleSessionName: role_session,
            WebIdentityToken: web_identity_token,
        };

        const json = await assume_role_with_web_identity(anon_sts, params);
        validate_web_identity_response(
            json,
            `arn:aws:sts::${account_id}:assumed-role/${test_role_name}/${role_session}`,
            `${account_id}:${role_session}`,
            role_owner_access_key
        );
    });

    mocha.it('should be rejected when Keycloak token is expired (introspect returns active:false)', async function() {
        const account_id = role_owner_account._id.toString();

        kc_stubs = stub_keycloak(async () => {
            throw new RpcError('EXPIRED_WEB_IDENTITY_TOKEN',
                'Token expired: current date/time must be before the expiration date/time');
        });

        const web_identity_token = make_keycloak_jwt();
        await assert_throws_async(
            assume_role_with_web_identity(anon_sts, {
                RoleArn: `arn:aws:sts::${account_id}:role/${test_role_name}`,
                RoleSessionName: 'expired-session',
                WebIdentityToken: web_identity_token,
            }),
            stsErr.ExpiredToken.code,
            'Token expired: current date/time must be before the expiration date/time'
        );
    });

    mocha.it('should be rejected when the web identity token is malformed (not a JWT)', async function() {
        const account_id = role_owner_account._id.toString();

        kc_stubs = stub_keycloak(async () => make_introspect_response());

        await assert_throws_async(
            assume_role_with_web_identity(anon_sts, {
                RoleArn: `arn:aws:sts::${account_id}:role/${test_role_name}`,
                RoleSessionName: 'bad-token-session',
                WebIdentityToken: 'not.a.jwt',
            }),
            stsErr.AccessDeniedException.code,
            stsErr.AccessDeniedException.message
        );
    });

    mocha.it('should be rejected when the role does not exist', async function() {
        const account_id = role_owner_account._id.toString();

        kc_stubs = stub_keycloak(async () => make_introspect_response());

        const web_identity_token = make_keycloak_jwt();
        await assert_throws_async(
            assume_role_with_web_identity(anon_sts, {
                RoleArn: `arn:aws:sts::${account_id}:role/NonExistentRole`,
                RoleSessionName: 'no-role-session',
                WebIdentityToken: web_identity_token,
            }),
            stsErr.AccessDeniedException.code,
            stsErr.AccessDeniedException.message
        );
    });

    mocha.it('should be rejected when the token issuer is not a configured Keycloak provider', async function() {
        const account_id = role_owner_account._id.toString();

        // Stub: Keycloak is configured BUT there is no provider for the token's issuer
        const mock_instance = {
            initialized: true,
            initialize: async () => { /* no-op */ },
            get_provider: () => null, // issuer not found
            verify_token: async token => jwt.decode(token),
            introspect_token: async () => make_introspect_response(),
        };
        const get_stub = sinon.stub(keycloak_client, 'get_instance').returns(mock_instance);
        const cfg_stub = sinon.stub(keycloak_client, 'is_keycloak_configured').resolves(true);
        kc_stubs = { restore() { get_stub.restore(); cfg_stub.restore(); } };

        // Token whose issuer is *not* in our provider map
        const foreign_token = jwt.sign(
            { iss: 'https://foreign-idp.example.com', sub: 'user1' },
            MOCK_JWT_SECRET,
            { expiresIn: '1h' }
        );

        await assert_throws_async(
            assume_role_with_web_identity(anon_sts, {
                RoleArn: `arn:aws:sts::${account_id}:role/${test_role_name}`,
                RoleSessionName: 'foreign-issuer-session',
                WebIdentityToken: foreign_token,
            }),
            stsErr.AccessDeniedException.code,
            stsErr.AccessDeniedException.message
        );
    });
});

// ---------------------------------------------------------------------------
// B. Trust-policy condition validation
// ---------------------------------------------------------------------------

mocha.describe('Keycloak AssumeRoleWithWebIdentity - trust-policy condition validation', function() {
    const { rpc_client } = coretest;

    const role_owner_email = 'kc-role-owner-b1';
    let role_owner_account;
    let iam_client_role_owner;
    let anon_sts;

    const ROLE_WITH_DEPT_CONDITION = 'KcRoleDeptCondition';
    const ROLE_WITH_AUD_CONDITION = 'KcRoleAudCondition';
    const ROLE_WITH_FOR_ANY_VALUE = 'KcRoleForAnyValue';
    const ROLE_WITH_SESSION_TAG_ALLOW = 'KcRoleWithTagSession';
    const ROLE_WITH_MIXED_CONDITIONS = 'KcRoleMixedConditions';

    let kc_stubs;

    mocha.before(async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);

        role_owner_account = await create_test_account(rpc_client, role_owner_email);

        ({ iam_client: iam_client_role_owner, anon_sts } = setup_role_owner_clients(role_owner_account));

        // ── Role: Require Department = Engineering (StringEquals on aws:RequestTag)
        await iam_client_role_owner.send(new CreateRoleCommand({
            RoleName: ROLE_WITH_DEPT_CONDITION,
            AssumeRolePolicyDocument: JSON.stringify({
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Principal: { Federated: make_keycloak_federated_arn(role_owner_account._id.toString()) },
                    Action: ['sts:AssumeRoleWithWebIdentity', 'sts:TagSession'],
                    Condition: {
                        StringEquals: { 'aws:RequestTag/Department': 'Engineering' },
                    },
                }],
            }),
        }));

        // ── Role: Require specific `aud` claim (StringEquals on aud)
        await iam_client_role_owner.send(new CreateRoleCommand({
            RoleName: ROLE_WITH_AUD_CONDITION,
            AssumeRolePolicyDocument: JSON.stringify({
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Principal: { Federated: make_keycloak_federated_arn(role_owner_account._id.toString()) },
                    Action: ['sts:AssumeRoleWithWebIdentity'],
                    Condition: {
                        StringEquals: {
                            [`${KEYCLOAK_ISSUER.replace('http://', '').replace('https://', '')}:aud`]: KEYCLOAK_CLIENT_ID,
                        },
                    },
                }],
            }),
        }));

        // ── Role: ForAnyValue:StringEquals on Team tag
        await iam_client_role_owner.send(new CreateRoleCommand({
            RoleName: ROLE_WITH_FOR_ANY_VALUE,
            AssumeRolePolicyDocument: JSON.stringify({
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Principal: { Federated: make_keycloak_federated_arn(role_owner_account._id.toString()) },
                    Action: ['sts:AssumeRoleWithWebIdentity', 'sts:TagSession'],
                    Condition: {
                        'ForAnyValue:StringEquals': {
                            'aws:RequestTag/Team': ['Engineering', 'DevOps'],
                        },
                    },
                }],
            }),
        }));

        // ── Role: session tags + sts:TagSession required
        await iam_client_role_owner.send(new CreateRoleCommand({
            RoleName: ROLE_WITH_SESSION_TAG_ALLOW,
            AssumeRolePolicyDocument: JSON.stringify({
                Version: '2012-10-17',
                Statement: [
                    {
                        Effect: 'Allow',
                        Principal: { Federated: make_keycloak_federated_arn(role_owner_account._id.toString()) },
                        Action: ['sts:AssumeRoleWithWebIdentity'],
                    },
                    {
                        Effect: 'Allow',
                        Principal: { Federated: make_keycloak_federated_arn(role_owner_account._id.toString()) },
                        Action: ['sts:TagSession'],
                    },
                ],
            }),
        }));

        // ── Role: Mixed StringEquals + ForAnyValue conditions
        await iam_client_role_owner.send(new CreateRoleCommand({
            RoleName: ROLE_WITH_MIXED_CONDITIONS,
            AssumeRolePolicyDocument: JSON.stringify({
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Principal: { Federated: make_keycloak_federated_arn(role_owner_account._id.toString()) },
                    Action: ['sts:AssumeRoleWithWebIdentity', 'sts:TagSession'],
                    Condition: {
                        StringEquals: { 'aws:RequestTag/Environment': 'Production' },
                        'ForAnyValue:StringEquals': {
                            'aws:RequestTag/Team': ['DevOps', 'SRE'],
                        },
                    },
                }],
            }),
        }));
    });

    mocha.after(async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);
        await cleanup_roles_and_account(rpc_client, iam_client_role_owner, [
            ROLE_WITH_DEPT_CONDITION, ROLE_WITH_AUD_CONDITION, ROLE_WITH_FOR_ANY_VALUE,
            ROLE_WITH_SESSION_TAG_ALLOW, ROLE_WITH_MIXED_CONDITIONS,
        ], role_owner_email);
    });

    mocha.afterEach(function() {
        kc_stubs = restore_kc_stubs(kc_stubs);
    });

    // ── B.1 aws:RequestTag / StringEquals ───────────────────────────────────

    mocha.it('B.1a - StringEquals on aws:RequestTag/Department matches → should be allowed', async function() {
        const account_id = role_owner_account._id.toString();
        const role_owner_access_key = role_owner_account.access_keys[0].access_key.unwrap();

        const token = make_keycloak_jwt({
            'https://aws.amazon.com/tags': { principal_tags: { Department: 'Engineering' } },
        });
        kc_stubs = stub_keycloak(async () => make_introspect_response());

        const json = await assume_role_with_web_identity(anon_sts, {
            RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_WITH_DEPT_CONDITION}`,
            RoleSessionName: 'dept-match-session',
            WebIdentityToken: token,
        });
        validate_web_identity_response(
            json,
            `arn:aws:sts::${account_id}:assumed-role/${ROLE_WITH_DEPT_CONDITION}/dept-match-session`,
            `${account_id}:dept-match-session`,
            role_owner_access_key
        );
    });

    mocha.it('B.1b - StringEquals on aws:RequestTag/Department does not match → should be rejected', async function() {
        const account_id = role_owner_account._id.toString();

        const token = make_keycloak_jwt({
            'https://aws.amazon.com/tags': { principal_tags: { Department: 'Finance' } },
        });
        kc_stubs = stub_keycloak(async () => make_introspect_response());

        await assert_throws_async(
            assume_role_with_web_identity(anon_sts, {
                RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_WITH_DEPT_CONDITION}`,
                RoleSessionName: 'dept-no-match-session',
                WebIdentityToken: token,
            }),
            stsErr.AccessDeniedException.code,
            stsErr.AccessDeniedException.message
        );
    });

    mocha.it('B.1c - StringEquals on aws:RequestTag/Department - tag absent in token → should be rejected', async function() {
        const account_id = role_owner_account._id.toString();

        // Token has no principal_tags at all
        const token = make_keycloak_jwt();
        kc_stubs = stub_keycloak(async () => make_introspect_response());

        await assert_throws_async(
            assume_role_with_web_identity(anon_sts, {
                RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_WITH_DEPT_CONDITION}`,
                RoleSessionName: 'dept-absent-session',
                WebIdentityToken: token,
            }),
            stsErr.AccessDeniedException.code,
            stsErr.AccessDeniedException.message
        );
    });

    // ── B.2 aud claim condition ─────────────────────────────────────────────

    mocha.it('B.2a - StringEquals on aud claim matches → should be allowed', async function() {
        const account_id = role_owner_account._id.toString();
        const role_owner_access_key = role_owner_account.access_keys[0].access_key.unwrap();

        // aud in token matches KEYCLOAK_CLIENT_ID
        const token = make_keycloak_jwt({ aud: [KEYCLOAK_CLIENT_ID, 'account'] });
        kc_stubs = stub_keycloak(async () => make_introspect_response({ aud: KEYCLOAK_CLIENT_ID }));

        const json = await assume_role_with_web_identity(anon_sts, {
            RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_WITH_AUD_CONDITION}`,
            RoleSessionName: 'aud-match-session',
            WebIdentityToken: token,
        });
        validate_web_identity_response(
            json,
            `arn:aws:sts::${account_id}:assumed-role/${ROLE_WITH_AUD_CONDITION}/aud-match-session`,
            `${account_id}:aud-match-session`,
            role_owner_access_key
        );
    });

    mocha.it('B.2b - StringEquals on aud claim does not match → should be rejected', async function() {
        const account_id = role_owner_account._id.toString();

        // Token claims a different aud
        const token = make_keycloak_jwt({ aud: ['wrong-client', 'account'] });
        kc_stubs = stub_keycloak(async () => make_introspect_response({ aud: 'wrong-client' }));

        await assert_throws_async(
            assume_role_with_web_identity(anon_sts, {
                RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_WITH_AUD_CONDITION}`,
                RoleSessionName: 'aud-no-match-session',
                WebIdentityToken: token,
            }),
            stsErr.AccessDeniedException.code,
            stsErr.AccessDeniedException.message
        );
    });

    // ── B.3 ForAnyValue:StringEquals ────────────────────────────────────────

    mocha.it('B.3a - ForAnyValue:StringEquals on Team tag - one of multiple values matches → should be allowed', async function() {
        const account_id = role_owner_account._id.toString();
        const role_owner_access_key = role_owner_account.access_keys[0].access_key.unwrap();

        const token = make_keycloak_jwt({
            'https://aws.amazon.com/tags': { principal_tags: { Team: ['QA', 'DevOps'] } },
        });
        kc_stubs = stub_keycloak(async () => make_introspect_response());

        const json = await assume_role_with_web_identity(anon_sts, {
            RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_WITH_FOR_ANY_VALUE}`,
            RoleSessionName: 'forany-match-session',
            WebIdentityToken: token,
        });
        validate_web_identity_response(
            json,
            `arn:aws:sts::${account_id}:assumed-role/${ROLE_WITH_FOR_ANY_VALUE}/forany-match-session`,
            `${account_id}:forany-match-session`,
            role_owner_access_key
        );
    });

    mocha.it('B.3b - ForAnyValue:StringEquals on Team tag - no value matches → should be rejected', async function() {
        const account_id = role_owner_account._id.toString();

        const token = make_keycloak_jwt({
            'https://aws.amazon.com/tags': { principal_tags: { Team: ['Support', 'Sales'] } },
        });
        kc_stubs = stub_keycloak(async () => make_introspect_response());

        await assert_throws_async(
            assume_role_with_web_identity(anon_sts, {
                RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_WITH_FOR_ANY_VALUE}`,
                RoleSessionName: 'forany-no-match-session',
                WebIdentityToken: token,
            }),
            stsErr.AccessDeniedException.code,
            stsErr.AccessDeniedException.message
        );
    });

    // ── B.4 Session tag forwarding (sts:TagSession) ─────────────────────────

    mocha.it('B.4 - Token with session tags and sts:TagSession in policy → should be allowed', async function() {
        const account_id = role_owner_account._id.toString();
        const role_owner_access_key = role_owner_account.access_keys[0].access_key.unwrap();

        const token = make_keycloak_jwt({
            'https://aws.amazon.com/tags': { principal_tags: { Department: 'Engineering', Env: 'staging' } },
        });
        kc_stubs = stub_keycloak(async () => make_introspect_response());

        const json = await assume_role_with_web_identity(anon_sts, {
            RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_WITH_SESSION_TAG_ALLOW}`,
            RoleSessionName: 'tag-session-allowed',
            WebIdentityToken: token,
        });
        validate_web_identity_response(
            json,
            `arn:aws:sts::${account_id}:assumed-role/${ROLE_WITH_SESSION_TAG_ALLOW}/tag-session-allowed`,
            `${account_id}:tag-session-allowed`,
            role_owner_access_key
        );
    });

    // ── B.5 Mixed StringEquals + ForAnyValue ────────────────────────────────

    mocha.it('B.5a - Mixed conditions: all conditions satisfied → should be allowed', async function() {
        const account_id = role_owner_account._id.toString();
        const role_owner_access_key = role_owner_account.access_keys[0].access_key.unwrap();

        const token = make_keycloak_jwt({
            'https://aws.amazon.com/tags': { principal_tags: { Environment: 'Production', Team: ['DevOps', 'SRE'] } },
        });
        kc_stubs = stub_keycloak(async () => make_introspect_response());

        const json = await assume_role_with_web_identity(anon_sts, {
            RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_WITH_MIXED_CONDITIONS}`,
            RoleSessionName: 'mixed-ok-session',
            WebIdentityToken: token,
        });
        validate_web_identity_response(
            json,
            `arn:aws:sts::${account_id}:assumed-role/${ROLE_WITH_MIXED_CONDITIONS}/mixed-ok-session`,
            `${account_id}:mixed-ok-session`,
            role_owner_access_key
        );
    });

    mocha.it('B.5b - Mixed conditions: StringEquals passes but ForAnyValue fails → should be rejected', async function() {
        const account_id = role_owner_account._id.toString();

        const token = make_keycloak_jwt({
            // Environment matches, but Team does NOT include DevOps or SRE
            'https://aws.amazon.com/tags': { principal_tags: { Environment: 'Production', Team: ['QA'] } },
        });
        kc_stubs = stub_keycloak(async () => make_introspect_response());

        await assert_throws_async(
            assume_role_with_web_identity(anon_sts, {
                RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_WITH_MIXED_CONDITIONS}`,
                RoleSessionName: 'mixed-fail-session',
                WebIdentityToken: token,
            }),
            stsErr.AccessDeniedException.code,
            stsErr.AccessDeniedException.message
        );
    });

    mocha.it('B.5c - Mixed conditions: ForAnyValue passes but StringEquals fails → should be rejected', async function() {
        const account_id = role_owner_account._id.toString();

        const token = make_keycloak_jwt({
            // Team matches, but Environment does NOT equal Production
            'https://aws.amazon.com/tags': { principal_tags: { Environment: 'Staging', Team: ['DevOps'] } },
        });
        kc_stubs = stub_keycloak(async () => make_introspect_response());

        await assert_throws_async(
            assume_role_with_web_identity(anon_sts, {
                RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_WITH_MIXED_CONDITIONS}`,
                RoleSessionName: 'mixed-env-fail-session',
                WebIdentityToken: token,
            }),
            stsErr.AccessDeniedException.code,
            stsErr.AccessDeniedException.message
        );
    });
});

// ---------------------------------------------------------------------------
// C. S3 request flow using AWS_SESSION_TOKEN
// ---------------------------------------------------------------------------

mocha.describe('Keycloak AssumeRoleWithWebIdentity - S3 with temporary credentials', function() {
    const { rpc_client } = coretest;

    const role_owner_email = 'kc-role-owner-c1';
    const test_bucket = KC_STS_TEST_BUCKET;

    let role_owner_account;
    let iam_client_role_owner;
    let anon_sts;
    const ROLE_S3_ACCESS = 'KcRoleS3Access';

    let kc_stubs;

    mocha.before(async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);

        role_owner_account = await create_test_account(rpc_client, role_owner_email);

        ({ iam_client: iam_client_role_owner, anon_sts } = setup_role_owner_clients(role_owner_account));

        // Create a role that allows full S3 access to `test_bucket`
        const trust_policy = {
            Version: '2012-10-17',
            Statement: [{
                Effect: 'Allow',
                Principal: { Federated: make_keycloak_federated_arn(role_owner_account._id.toString()) },
                Action: ['sts:AssumeRoleWithWebIdentity'],
            }],
        };
        await iam_client_role_owner.send(new CreateRoleCommand({
            RoleName: ROLE_S3_ACCESS,
            AssumeRolePolicyDocument: JSON.stringify(trust_policy),
        }));

        await iam_client_role_owner.send(new PutRolePolicyCommand({
            RoleName: ROLE_S3_ACCESS,
            PolicyName: 'KcRoleS3Policy',
            PolicyDocument: JSON.stringify({
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Action: ['s3:*'],
                    Resource: [
                        `arn:aws:s3:::${test_bucket}`,
                        `arn:aws:s3:::${test_bucket}/*`,
                    ],
                }],
            }),
        }));

        // Grant the role owner's account access over test_bucket
        const account_id = role_owner_account._id.toString();
        await put_account_open_bucket_policy(rpc_client, test_bucket, account_id, role_owner_email);
    });

    mocha.after(async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);
        await cleanup_roles_and_account(rpc_client, iam_client_role_owner, [ROLE_S3_ACCESS], role_owner_email);
    });

    mocha.afterEach(function() {
        kc_stubs = restore_kc_stubs(kc_stubs);
    });

    mocha.it('C.1 - S3 listObjects succeeds with valid temporary credentials', async function() {
        const account_id = role_owner_account._id.toString();

        kc_stubs = stub_keycloak(async () => make_introspect_response());
        const token = make_keycloak_jwt();

        const json = await assume_role_with_web_identity(anon_sts, {
            RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_S3_ACCESS}`,
            RoleSessionName: 'c1-list-session',
            WebIdentityToken: token,
        });

        const creds = json.Credentials;
        const s3 = s3_client_from_temp_creds(creds);

        const result = await s3.listObjects({ Bucket: test_bucket });
        assert.ok(result, 'listObjects should succeed');
    });
});

// ---------------------------------------------------------------------------
// D. IAM role policy enforcement + aws:PrincipalTag validation
// ---------------------------------------------------------------------------

mocha.describe('Keycloak AssumeRoleWithWebIdentity - IAM role policy + aws:PrincipalTag', function() {
    const { rpc_client } = coretest;

    const role_owner_email = 'kc-role-owner-d1';
    const test_bucket = KC_STS_TEST_BUCKET;

    let role_owner_account;
    let iam_client_role_owner;
    let anon_sts;

    const ROLE_PRINCIPAL_TAG = 'KcRolePrincipalTag';
    const ROLE_DENY_POLICY = 'KcRoleDenyPolicy';
    const ROLE_LIMITED_S3 = 'KcRoleLimitedS3';

    let kc_stubs;

    mocha.before(async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);

        role_owner_account = await create_test_account(rpc_client, role_owner_email);

        ({ iam_client: iam_client_role_owner, anon_sts } = setup_role_owner_clients(role_owner_account));

        const base_trust_policy = {
            Version: '2012-10-17',
            Statement: [
                {
                    Effect: 'Allow',
                    Principal: { Federated: make_keycloak_federated_arn(role_owner_account._id.toString()) },
                    Action: ['sts:AssumeRoleWithWebIdentity'],
                },
                {
                    Effect: 'Allow',
                    Principal: { Federated: make_keycloak_federated_arn(role_owner_account._id.toString()) },
                    Action: ['sts:TagSession'],
                },
            ],
        };

        // ── Role: role policy uses aws:PrincipalTag to gate access ───────────
        // The bucket policy is open for the account; access is gated by the
        // IAM role policy condition on aws:PrincipalTag/Department.
        await iam_client_role_owner.send(new CreateRoleCommand({
            RoleName: ROLE_PRINCIPAL_TAG,
            AssumeRolePolicyDocument: JSON.stringify(base_trust_policy),
        }));
        await iam_client_role_owner.send(new PutRolePolicyCommand({
            RoleName: ROLE_PRINCIPAL_TAG,
            PolicyName: 'PrincipalTagPolicy',
            PolicyDocument: JSON.stringify({
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Action: ['s3:*'],
                    Resource: [
                        `arn:aws:s3:::${test_bucket}`,
                        `arn:aws:s3:::${test_bucket}/*`,
                    ],
                    Condition: {
                        StringEquals: { 'aws:PrincipalTag/Department': 'Engineering' },
                    },
                }],
            }),
        }));

        // ── Role: explicit Deny in IAM role policy ───────────────────────────
        await iam_client_role_owner.send(new CreateRoleCommand({
            RoleName: ROLE_DENY_POLICY,
            AssumeRolePolicyDocument: JSON.stringify(base_trust_policy),
        }));
        await iam_client_role_owner.send(new PutRolePolicyCommand({
            RoleName: ROLE_DENY_POLICY,
            PolicyName: 'DenyS3Policy',
            PolicyDocument: JSON.stringify({
                Version: '2012-10-17',
                Statement: [
                    {
                        Effect: 'Allow',
                        Action: ['s3:*'],
                        Resource: [`arn:aws:s3:::${test_bucket}`, `arn:aws:s3:::${test_bucket}/*`],
                    },
                    {
                        Effect: 'Deny',
                        Action: ['s3:ListBucket'],
                        Resource: [`arn:aws:s3:::${test_bucket}`],
                    },
                ],
            }),
        }));

        // ── Role: limited S3 access (no ListBucket) ──────────────────────────
        await iam_client_role_owner.send(new CreateRoleCommand({
            RoleName: ROLE_LIMITED_S3,
            AssumeRolePolicyDocument: JSON.stringify(base_trust_policy),
        }));
        await iam_client_role_owner.send(new PutRolePolicyCommand({
            RoleName: ROLE_LIMITED_S3,
            PolicyName: 'LimitedS3Policy',
            PolicyDocument: JSON.stringify({
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Action: ['s3:GetObject'],
                    Resource: [`arn:aws:s3:::${test_bucket}/*`],
                }],
            }),
        }));

        // Bucket policy: allow role owner's account
        const account_id = role_owner_account._id.toString();
        await put_account_open_bucket_policy(rpc_client, test_bucket, account_id, role_owner_email);
    });

    mocha.after(async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);
        await cleanup_roles_and_account(rpc_client, iam_client_role_owner,
            [ROLE_PRINCIPAL_TAG, ROLE_DENY_POLICY, ROLE_LIMITED_S3], role_owner_email);
    });

    mocha.afterEach(function() {
        kc_stubs = restore_kc_stubs(kc_stubs);
    });

    mocha.it('D.1 - aws:PrincipalTag in role policy: matching session tag → s3:ListObjects allowed', async function() {
        const account_id = role_owner_account._id.toString();

        // Bucket policy is open for the account (set in before()).
        // Access is gated by the IAM role policy condition on aws:PrincipalTag/Department.
        // Token embeds a session tag: Department = Engineering → role policy condition satisfied.
        const token = make_keycloak_jwt({
            'https://aws.amazon.com/tags': { principal_tags: { Department: 'Engineering' } },
        });
        kc_stubs = stub_keycloak(async () => make_introspect_response());

        const json = await assume_role_with_web_identity(anon_sts, {
            RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_PRINCIPAL_TAG}`,
            RoleSessionName: 'd1-principal-tag-session',
            WebIdentityToken: token,
        });
        const creds = json.Credentials;

        const s3 = s3_client_from_temp_creds(creds);

        const result = await s3.listObjects({ Bucket: test_bucket });
        assert.ok(result, 'listObjects should succeed when session tag matches role policy condition');
    });

    mocha.it('D.2 - aws:PrincipalTag in role policy: non-matching session tag → s3:ListObjects denied', async function() {
        const account_id = role_owner_account._id.toString();

        // Bucket policy is open for the account (set in before()).
        // Token embeds Department = Finance - role policy condition requires Engineering → denied.
        const token = make_keycloak_jwt({
            'https://aws.amazon.com/tags': { principal_tags: { Department: 'Finance' } },
        });
        kc_stubs = stub_keycloak(async () => make_introspect_response());

        const json = await assume_role_with_web_identity(anon_sts, {
            RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_PRINCIPAL_TAG}`,
            RoleSessionName: 'd2-principal-mismatch-session',
            WebIdentityToken: token,
        });
        const creds = json.Credentials;

        const s3 = s3_client_from_temp_creds(creds);

        const role_arn = `arn:aws:sts::${account_id}:role/${ROLE_PRINCIPAL_TAG}`;
        await assert_s3_list_access_denied(s3, test_bucket, role_arn);
    });

    mocha.it('D.3 - IAM role policy with explicit Deny on s3:ListBucket → should be rejected', async function() {
        const account_id = role_owner_account._id.toString();

        // Open bucket policy (no principal-tag condition)
        await put_account_open_bucket_policy(rpc_client, test_bucket, account_id, role_owner_email);

        kc_stubs = stub_keycloak(async () => make_introspect_response());
        const token = make_keycloak_jwt();

        const json = await assume_role_with_web_identity(anon_sts, {
            RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_DENY_POLICY}`,
            RoleSessionName: 'd3-deny-policy-session',
            WebIdentityToken: token,
        });
        const creds = json.Credentials;

        const s3 = s3_client_from_temp_creds(creds);

        // ListBucket is explicitly denied by the role policy
        const role_arn = `arn:aws:sts::${account_id}:role/${ROLE_DENY_POLICY}`;
        await assert_s3_list_access_denied(s3, test_bucket, role_arn);
    });

    mocha.it('D.4 - IAM role policy update: remove s3 access → subsequent S3 call denied', async function() {
        const account_id = role_owner_account._id.toString();

        // Open bucket policy
        await put_account_open_bucket_policy(rpc_client, test_bucket, account_id, role_owner_email);

        kc_stubs = stub_keycloak(async () => make_introspect_response());
        const token = make_keycloak_jwt();

        // First assume-role gives us working creds
        const json = await assume_role_with_web_identity(anon_sts, {
            RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_PRINCIPAL_TAG}`,
            RoleSessionName: 'd4-role-update-session',
            WebIdentityToken: token,
        });
        const creds = json.Credentials;

        // Now revoke S3 access via role policy update (deny all)
        await iam_client_role_owner.send(new PutRolePolicyCommand({
            RoleName: ROLE_PRINCIPAL_TAG,
            PolicyName: 'PrincipalTagPolicy',
            PolicyDocument: JSON.stringify({
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Deny',
                    Action: ['s3:*'],
                    Resource: ['*'],
                }],
            }),
        }));

        const s3 = s3_client_from_temp_creds(creds);

        const role_arn = `arn:aws:sts::${account_id}:role/${ROLE_PRINCIPAL_TAG}`;
        await assert_s3_list_access_denied(s3, test_bucket, role_arn);

        // Restore original policy so other tests are not affected
        await iam_client_role_owner.send(new PutRolePolicyCommand({
            RoleName: ROLE_PRINCIPAL_TAG,
            PolicyName: 'PrincipalTagPolicy',
            PolicyDocument: JSON.stringify({
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Action: ['s3:*'],
                    Resource: [
                        `arn:aws:s3:::${test_bucket}`,
                        `arn:aws:s3:::${test_bucket}/*`,
                    ],
                }],
            }),
        }));
    });

    mocha.it('D.5 - IAM role policy grants only s3:GetObject; s3:ListBucket is implicitly denied', async function() {
        const account_id = role_owner_account._id.toString();

        // Open bucket policy
        await put_account_open_bucket_policy(rpc_client, test_bucket, account_id, role_owner_email);

        kc_stubs = stub_keycloak(async () => make_introspect_response());
        const token = make_keycloak_jwt();

        const json = await assume_role_with_web_identity(anon_sts, {
            RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_LIMITED_S3}`,
            RoleSessionName: 'd5-limited-s3-session',
            WebIdentityToken: token,
        });
        const creds = json.Credentials;

        const s3 = s3_client_from_temp_creds(creds);

        // ListBucket is not granted by the role policy → implicitly denied
        const role_arn = `arn:aws:sts::${account_id}:role/${ROLE_LIMITED_S3}`;
        await assert_s3_list_access_denied(s3, test_bucket, role_arn);
    });
});

// ---------------------------------------------------------------------------
// E. Token / claims edge cases
// ---------------------------------------------------------------------------

mocha.describe('Keycloak AssumeRoleWithWebIdentity – token & claims edge cases', function() {
    const { rpc_client } = coretest;

    const role_owner_email = 'kc-role-owner-e1';
    const ROLE_E = 'KcRoleTokenEdge';

    let role_owner_account;
    let iam_client_role_owner;
    let anon_sts;
    let kc_stubs;

    mocha.before(async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);

        role_owner_account = await create_test_account(rpc_client, role_owner_email);

        ({ iam_client: iam_client_role_owner, anon_sts } = setup_role_owner_clients(role_owner_account));

        await iam_client_role_owner.send(new CreateRoleCommand({
            RoleName: ROLE_E,
            AssumeRolePolicyDocument: JSON.stringify({
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Principal: { Federated: make_keycloak_federated_arn(role_owner_account._id.toString()) },
                    Action: ['sts:AssumeRoleWithWebIdentity'],
                }],
            }),
        }));
    });

    mocha.after(async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);
        await cleanup_roles_and_account(rpc_client, iam_client_role_owner, [ROLE_E], role_owner_email);
    });

    mocha.afterEach(function() {
        kc_stubs = restore_kc_stubs(kc_stubs);
    });

    // ── E.1 ─────────────────────────────────────────────────────────────────
    // AWS behaviour: any error from the identity provider (network, timeout, etc.)
    // during token validation surfaces as AccessDenied to the caller.
    // Reference: https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRoleWithWebIdentity.html

    mocha.it('E.1 - introspection endpoint throws a network/timeout error → should be rejected with AccessDenied', async function() {
        const account_id = role_owner_account._id.toString();

        // Simulate a transient network/timeout error from the introspection endpoint.
        // The SDK's get_assumed_oidc_user() catches any non-RpcError and re-throws it as
        // ACCESS_DENIED, which sts_post_assume_role_with_web_identity maps to AccessDeniedException.
        kc_stubs = stub_keycloak(async () => {
            const network_err = new Error('connect ECONNREFUSED 127.0.0.1:8080');
            network_err.code = 'ECONNREFUSED';
            throw network_err;
        });

        const token = make_keycloak_jwt();
        await assert_throws_async(
            assume_role_with_web_identity(anon_sts, {
                RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_E}`,
                RoleSessionName: 'e1-network-error-session',
                WebIdentityToken: token,
            }),
            stsErr.AccessDeniedException.code,
            'Not authorized to perform sts:AssumeRoleWithWebIdentity'
        );
    });

    // ── E.2 ─────────────────────────────────────────────────────────────────
    // AWS behaviour: a valid token whose issuer is served by one of multiple configured
    // Keycloak providers is routed correctly.  A token from a provider that is NOT
    // configured falls through to LDAP (no OIDC provider match) → ACCESS_DENIED.
    // Reference: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_oidc.html

    mocha.it('E.2a - multiple providers configured: token routed to the correct provider → should be allowed', async function() {
        const account_id = role_owner_account._id.toString();
        const role_owner_access_key = role_owner_account.access_keys[0].access_key.unwrap();

        // Two providers: our known issuer and a second one.  Token carries our issuer.
        const SECOND_ISSUER = 'https://other-idp.example.com/realms/test';
        const mock_instance = {
            initialized: true,
            initialize: async () => { /* no-op */ },
            get_provider: issuer => {
                if (issuer === KEYCLOAK_ISSUER) return { configured: true };
                if (issuer === SECOND_ISSUER) return { configured: true };
                return null;
            },
            verify_token: async token => jwt.decode(token),
            introspect_token: async () => make_introspect_response(),
        };
        const get_stub = sinon.stub(keycloak_client, 'get_instance').returns(mock_instance);
        const cfg_stub = sinon.stub(keycloak_client, 'is_keycloak_configured').resolves(true);
        kc_stubs = { restore() { get_stub.restore(); cfg_stub.restore(); } };

        const token = make_keycloak_jwt(); // iss = KEYCLOAK_ISSUER
        const json = await assume_role_with_web_identity(anon_sts, {
            RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_E}`,
            RoleSessionName: 'e2a-multi-provider-match',
            WebIdentityToken: token,
        });
        validate_web_identity_response(
            json,
            `arn:aws:sts::${account_id}:assumed-role/${ROLE_E}/e2a-multi-provider-match`,
            `${account_id}:e2a-multi-provider-match`,
            role_owner_access_key
        );
    });

    mocha.it('E.2b - multiple providers configured: token from an unknown issuer → should be rejected', async function() {
        const account_id = role_owner_account._id.toString();

        const SECOND_ISSUER = 'https://other-idp.example.com/realms/test';
        const UNKNOWN_ISSUER = 'https://unknown-idp.example.com/realms/unknown';
        const mock_instance = {
            initialized: true,
            initialize: async () => { /* no-op */ },
            get_provider: issuer => {
                if (issuer === KEYCLOAK_ISSUER) return { configured: true };
                if (issuer === SECOND_ISSUER) return { configured: true };
                return null; // UNKNOWN_ISSUER not found
            },
            verify_token: async token => jwt.decode(token),
            introspect_token: async () => make_introspect_response(),
        };
        const get_stub = sinon.stub(keycloak_client, 'get_instance').returns(mock_instance);
        const cfg_stub = sinon.stub(keycloak_client, 'is_keycloak_configured').resolves(true);
        kc_stubs = { restore() { get_stub.restore(); cfg_stub.restore(); } };

        // Token from an issuer that is NOT in any provider
        const unknown_token = jwt.sign(
            { iss: UNKNOWN_ISSUER, sub: 'user1', aud: 'client' },
            MOCK_JWT_SECRET,
            { expiresIn: '1h' }
        );
        await assert_throws_async(
            assume_role_with_web_identity(anon_sts, {
                RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_E}`,
                RoleSessionName: 'e2b-multi-provider-unknown',
                WebIdentityToken: unknown_token,
            }),
            stsErr.AccessDeniedException.code,
            stsErr.AccessDeniedException.message
        );
    });

    // ── E.9 ─────────────────────────────────────────────────────────────────
    // AWS behaviour: when no OIDC provider is configured the request falls through
    // to LDAP.  With LDAP also unconfigured the result is InvalidIdentityToken.
    // Reference: https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRoleWithWebIdentity.html

    mocha.it('E.9 - is_keycloak_configured() returns false → falls through to LDAP → InvalidIdentityToken', async function() {
        const account_id = role_owner_account._id.toString();

        // Stub Keycloak as NOT configured.  The SDK falls through to the LDAP handler
        // which will fail with ACCESS_DENIED because LDAP is not configured either.
        const cfg_stub = sinon.stub(keycloak_client, 'is_keycloak_configured').resolves(false);
        kc_stubs = { restore() { cfg_stub.restore(); } };

        const token = make_keycloak_jwt();
        await assert_throws_async(
            assume_role_with_web_identity(anon_sts, {
                RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_E}`,
                RoleSessionName: 'e9-keycloak-not-configured',
                WebIdentityToken: token,
            }),
            stsErr.InvalidIdentityToken.code,
            'Missing a required claim: user'
        );
    });
});

// ---------------------------------------------------------------------------
// F. Trust-policy / _validate_assume_role_policy_document_iam_structure
// ---------------------------------------------------------------------------

mocha.describe('Keycloak AssumeRoleWithWebIdentity – trust-policy structure validation', function() {
    const { rpc_client } = coretest;

    const role_owner_email = 'kc-role-owner-f1';
    const ROLE_F_NOTPRINCIPAL = 'KcRoleNotPrincipalFederated';
    const ROLE_F_NO_TAGSESSION = 'KcRoleNoTagSession';

    let role_owner_account;
    let iam_client_role_owner;
    let anon_sts;
    let kc_stubs;

    mocha.before(async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);

        role_owner_account = await create_test_account(rpc_client, role_owner_email);

        ({ iam_client: iam_client_role_owner, anon_sts } = setup_role_owner_clients(role_owner_account));

        // Role F3: trust policy only allows AssumeRoleWithWebIdentity, no sts:TagSession statement.
        // Tokens that carry session tags will have the tags silently dropped on AWS but the
        // AssumeRole itself still succeeds (sts:TagSession is only needed if the caller
        // explicitly requests tag propagation through the API DurationSeconds path).
        // NooBaa extracts tags from the JWT directly, so sts:TagSession in the trust policy
        // is honoured during trust-policy evaluation.  When the policy has NO sts:TagSession
        // statement the assume-role call is still expected to succeed — only tag-propagation
        // checks for the missing statement.
        await iam_client_role_owner.send(new CreateRoleCommand({
            RoleName: ROLE_F_NO_TAGSESSION,
            AssumeRolePolicyDocument: JSON.stringify({
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Principal: { Federated: make_keycloak_federated_arn(role_owner_account._id.toString()) },
                    Action: ['sts:AssumeRoleWithWebIdentity'],
                    // Intentionally no sts:TagSession
                }],
            }),
        }));
    });

    mocha.after(async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);
        await cleanup_roles_and_account(rpc_client, iam_client_role_owner, [ROLE_F_NOTPRINCIPAL, ROLE_F_NO_TAGSESSION], role_owner_email);
    });

    mocha.afterEach(function() {
        kc_stubs = restore_kc_stubs(kc_stubs);
    });

    // ── F.3 ─────────────────────────────────────────────────────────────────
    // AWS behaviour: NotPrincipal is not supported with AWS AssumeRoleWithWebIdentity
    // Reference: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_notprincipal.html

    mocha.it('F.3 - Federated in trust policy: creating role is Deny ', async function() {
        const account_id = role_owner_account._id.toString();

        // Create the role with NotPrincipal.Federated – the server must accept the document.
        await iam_client_role_owner.send(new CreateRoleCommand({
            RoleName: ROLE_F_NOTPRINCIPAL,
            AssumeRolePolicyDocument: JSON.stringify({
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Deny',
                    Principal: { Federated: make_keycloak_federated_arn(account_id) },
                    Action: ['sts:AssumeRoleWithWebIdentity'],
                }],
            }),
        }));

        // At evaluation time, NotPrincipal in a trust policy always denies.
        kc_stubs = stub_keycloak(async () => make_introspect_response());
        const token = make_keycloak_jwt();
        await assert_throws_async(
            assume_role_with_web_identity(anon_sts, {
                RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_F_NOTPRINCIPAL}`,
                RoleSessionName: 'f3-notprincipal-session',
                WebIdentityToken: token,
            }),
            stsErr.AccessDeniedException.code,
            stsErr.AccessDeniedException.message
        );
    });

    // ── F.4 ─────────────────────────────────────────────────────────────────
    // AWS behaviour: a token that carries session tags when sts:TagSession is NOT
    // present in the trust policy means the AssumeRoleWithWebIdentity call fail.
    // Reference: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_session-tags.html#id_session-tags_adding-assume-role-idp

    mocha.it('F.4 - token with session tags but trust policy has no sts:TagSession → assume role to fail', async function() {
        const account_id = role_owner_account._id.toString();

        // Token carries session tags but the role's trust policy only allows
        // sts:AssumeRoleWithWebIdentity (no sts:TagSession).
        const token = make_keycloak_jwt({
            'https://aws.amazon.com/tags': { principal_tags: { Department: 'Engineering' } },
        });
        kc_stubs = stub_keycloak(async () => make_introspect_response());

        await assert_throws_async(
            assume_role_with_web_identity(anon_sts, {
                RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_F_NO_TAGSESSION}`,
                RoleSessionName: 'f4-no-tagsession-session',
                WebIdentityToken: token,
            }),
            stsErr.AccessDeniedException.code,
            stsErr.AccessDeniedException.message
        );
    });

    // ── F (validation) ───────────────────────────────────────────────────────
    // AWS behaviour: an invalid Federated ARN (wrong format) in the trust policy
    // must be rejected at CreateRole time with MalformedPolicyDocument.
    // Reference: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_principal.html

    mocha.it('F.v - CreateRole with invalid Federated ARN format → MalformedPolicyDocument', async function() {
        const ROLE_INVALID_FEDERATED = 'KcRoleInvalidFederated';

        let caught_err;
        try {
            await iam_client_role_owner.send(new CreateRoleCommand({
                RoleName: ROLE_INVALID_FEDERATED,
                AssumeRolePolicyDocument: JSON.stringify({
                    Version: '2012-10-17',
                    Statement: [{
                        Effect: 'Allow',
                        // Raw issuer URL instead of oidc-provider ARN — must be rejected
                        Principal: { Federated: KEYCLOAK_ISSUER },
                        Action: ['sts:AssumeRoleWithWebIdentity'],
                    }],
                }),
            }));
        } catch (err) {
            caught_err = err;
        } finally {
            // Clean up if the role was somehow created
            try {
                await iam_client_role_owner.send(new DeleteRoleCommand({ RoleName: ROLE_INVALID_FEDERATED }));
            } catch (_) { /* ignore */ }
        }

        assert.ok(caught_err, 'CreateRole should have thrown');
        assert.equal(caught_err.Code || caught_err.code, 'MalformedPolicyDocument',
            `Expected MalformedPolicyDocument but got: ${caught_err.Code || caught_err.code}`);
    });
});

// ---------------------------------------------------------------------------
// G. PrincipalTag / ABAC edge cases
// ---------------------------------------------------------------------------

mocha.describe('Keycloak AssumeRoleWithWebIdentity – PrincipalTag ABAC edge cases', function() {
    const { rpc_client } = coretest;

    const role_owner_email = 'kc-role-owner-g1';
    const test_bucket = KC_STS_TEST_BUCKET;

    const ROLE_CASE_SENSITIVE = 'KcRoleCaseSensitive';
    const ROLE_EMPTY_TAG = 'KcRoleEmptyTag';
    const ROLE_MULTI_CONDITION = 'KcRoleMultiCondition';
    const ROLE_DENY_CONFLICTS = 'KcRoleDenyConflicts';

    let role_owner_account;
    let iam_client_role_owner;
    let anon_sts;
    let kc_stubs;

    mocha.before(async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);

        role_owner_account = await create_test_account(rpc_client, role_owner_email);

        ({ iam_client: iam_client_role_owner, anon_sts } = setup_role_owner_clients(role_owner_account));
        const federated_arn = make_keycloak_federated_arn(role_owner_account._id.toString());
        const base_trust = {
            Version: '2012-10-17',
            Statement: [
                {
                    Effect: 'Allow',
                    Principal: { Federated: federated_arn },
                    Action: ['sts:AssumeRoleWithWebIdentity'],
                },
                {
                    Effect: 'Allow',
                    Principal: { Federated: federated_arn },
                    Action: ['sts:TagSession'],
                },
            ],
        };

        // ── Role: StringEquals on Department (case-sensitive by default in AWS)
        await iam_client_role_owner.send(new CreateRoleCommand({
            RoleName: ROLE_CASE_SENSITIVE,
            AssumeRolePolicyDocument: JSON.stringify(base_trust),
        }));
        await iam_client_role_owner.send(new PutRolePolicyCommand({
            RoleName: ROLE_CASE_SENSITIVE,
            PolicyName: 'CaseSensitivePolicy',
            PolicyDocument: JSON.stringify({
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Action: ['s3:*'],
                    Resource: [`arn:aws:s3:::${test_bucket}`, `arn:aws:s3:::${test_bucket}/*`],
                    Condition: { StringEquals: { 'aws:PrincipalTag/Department': 'Engineering' } },
                }],
            }),
        }));

        // ── Role: empty string tag value
        await iam_client_role_owner.send(new CreateRoleCommand({
            RoleName: ROLE_EMPTY_TAG,
            AssumeRolePolicyDocument: JSON.stringify(base_trust),
        }));
        await iam_client_role_owner.send(new PutRolePolicyCommand({
            RoleName: ROLE_EMPTY_TAG,
            PolicyName: 'EmptyTagPolicy',
            PolicyDocument: JSON.stringify({
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Action: ['s3:*'],
                    Resource: [`arn:aws:s3:::${test_bucket}`, `arn:aws:s3:::${test_bucket}/*`],
                    Condition: { StringEquals: { 'aws:PrincipalTag/Department': 'Engineering' } },
                }],
            }),
        }));

        // ── Role: multiple PrincipalTag conditions (AND logic)
        await iam_client_role_owner.send(new CreateRoleCommand({
            RoleName: ROLE_MULTI_CONDITION,
            AssumeRolePolicyDocument: JSON.stringify(base_trust),
        }));
        await iam_client_role_owner.send(new PutRolePolicyCommand({
            RoleName: ROLE_MULTI_CONDITION,
            PolicyName: 'MultiConditionPolicy',
            PolicyDocument: JSON.stringify({
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Action: ['s3:*'],
                    Resource: [`arn:aws:s3:::${test_bucket}`, `arn:aws:s3:::${test_bucket}/*`, `arn:aws:s3:::test11`],
                    Condition: {
                        StringEquals: {
                            'aws:PrincipalTag/Department': 'Engineering',
                            'aws:PrincipalTag/Env': 'prod',
                        },
                    },
                }],
            }),
        }));

        // ── Role: Allow in role policy + explicit Deny in bucket policy (Deny wins)
        await iam_client_role_owner.send(new CreateRoleCommand({
            RoleName: ROLE_DENY_CONFLICTS,
            AssumeRolePolicyDocument: JSON.stringify(base_trust),
        }));
        await iam_client_role_owner.send(new PutRolePolicyCommand({
            RoleName: ROLE_DENY_CONFLICTS,
            PolicyName: 'AllowAllPolicy',
            PolicyDocument: JSON.stringify({
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Deny',
                    Action: ['s3:*'],
                    Resource: [`arn:aws:s3:::${test_bucket}`, `arn:aws:s3:::${test_bucket}/*`],
                }],
            }),
        }));

        // Open bucket policy for the account
        const account_id = role_owner_account._id.toString();
        await put_account_open_bucket_policy(rpc_client, test_bucket, account_id, role_owner_email);
    });

    mocha.after(async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);
        await cleanup_roles_and_account(rpc_client, iam_client_role_owner,
            [ROLE_CASE_SENSITIVE, ROLE_EMPTY_TAG, ROLE_MULTI_CONDITION, ROLE_DENY_CONFLICTS], role_owner_email);
    });

    mocha.afterEach(function() {
        kc_stubs = restore_kc_stubs(kc_stubs);
    });

    // ── G.5a ─────────────────────────────────────────────────────────────────
    // AWS behaviour: StringEquals is case-sensitive.  Tag value 'engineering'
    // must NOT match the condition 'Engineering'.
    // Reference: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_condition_operators.html

    mocha.it('G.5a - tag value case mismatch (engineering vs Engineering) → s3:ListBucket denied', async function() {
        const account_id = role_owner_account._id.toString();

        // Session tag: lowercase 'engineering' — policy requires 'Engineering'
        const token = make_keycloak_jwt({
            'https://aws.amazon.com/tags': { principal_tags: { Department: 'engineering' } },
        });
        kc_stubs = stub_keycloak(async () => make_introspect_response());

        const json = await assume_role_with_web_identity(anon_sts, {
            RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_CASE_SENSITIVE}`,
            RoleSessionName: 'g5a-case-mismatch-session',
            WebIdentityToken: token,
        });
        const creds = json.Credentials;

        const s3 = s3_client_from_temp_creds(creds);

        const role_arn = `arn:aws:sts::${account_id}:role/${ROLE_CASE_SENSITIVE}`;
        await assert_s3_list_access_denied(s3, test_bucket, role_arn);
    });

    mocha.it('G.5b - tag value case matches exactly (Engineering) → s3:ListBucket allowed', async function() {
        const account_id = role_owner_account._id.toString();

        const token = make_keycloak_jwt({
            'https://aws.amazon.com/tags': { principal_tags: { Department: 'Engineering' } },
        });
        kc_stubs = stub_keycloak(async () => make_introspect_response());

        const json = await assume_role_with_web_identity(anon_sts, {
            RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_CASE_SENSITIVE}`,
            RoleSessionName: 'g5b-case-match-session',
            WebIdentityToken: token,
        });
        const creds = json.Credentials;

        const s3 = s3_client_from_temp_creds(creds);

        const result = await s3.listObjects({ Bucket: test_bucket });
        assert.ok(result, 'listObjects should succeed when tag value matches exactly');
    });

    // ── G.6 ──────────────────────────────────────────────────────────────────
    // AWS behaviour: an empty-string tag value does NOT satisfy a StringEquals
    // condition that expects a non-empty value.
    // Reference: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_condition-single-vs-multi-valued-context-keys.html

    mocha.it('G.6 - tag key present but value is empty string → s3:ListBucket denied', async function() {
        const account_id = role_owner_account._id.toString();

        // Tag key is present but value is '' — policy requires 'Engineering'
        const token = make_keycloak_jwt({
            'https://aws.amazon.com/tags': { principal_tags: { Department: '' } },
        });
        kc_stubs = stub_keycloak(async () => make_introspect_response());

        const json = await assume_role_with_web_identity(anon_sts, {
            RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_EMPTY_TAG}`,
            RoleSessionName: 'g6-empty-tag-session',
            WebIdentityToken: token,
        });
        const creds = json.Credentials;

        const s3 = s3_client_from_temp_creds(creds);

        const role_arn = `arn:aws:sts::${account_id}:role/${ROLE_EMPTY_TAG}`;
        await assert_s3_list_access_denied(s3, test_bucket, role_arn);
    });

    // ── G.7 ──────────────────────────────────────────────────────────────────
    // AWS behaviour: multiple keys inside a single Condition block are AND-ed.
    // Both Department=Engineering AND Env=prod must be satisfied simultaneously.
    // Reference: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_multi-value-conditions.html

    mocha.it('G.7a - both PrincipalTag conditions satisfied → s3:ListBucket allowed', async function() {
        const account_id = role_owner_account._id.toString();

        const token = make_keycloak_jwt({
            'https://aws.amazon.com/tags': { principal_tags: { Department: 'Engineering', Env: 'prod' } },
        });
        kc_stubs = stub_keycloak(async () => make_introspect_response());

        const json = await assume_role_with_web_identity(anon_sts, {
            RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_MULTI_CONDITION}`,
            RoleSessionName: 'g7a-both-tags-match',
            WebIdentityToken: token,
        });
        const creds = json.Credentials;

        const s3 = s3_client_from_temp_creds(creds);

        const result = await s3.listObjects({ Bucket: test_bucket });
        assert.ok(result, 'listObjects should succeed when all PrincipalTag conditions are satisfied');
    });

    mocha.it('G.7b - only one of two PrincipalTag conditions satisfied → s3:ListBucket denied', async function() {
        const account_id = role_owner_account._id.toString();

        // Department matches but Env does not
        const token = make_keycloak_jwt({
            'https://aws.amazon.com/tags': { principal_tags: { Department: 'Engineering', Env: 'staging' } },
        });
        kc_stubs = stub_keycloak(async () => make_introspect_response());

        const json = await assume_role_with_web_identity(anon_sts, {
            RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_MULTI_CONDITION}`,
            RoleSessionName: 'g7b-one-tag-fails',
            WebIdentityToken: token,
        });
        const creds = json.Credentials;

        const s3 = s3_client_from_temp_creds(creds);

        const role_arn = `arn:aws:sts::${account_id}:role/${ROLE_MULTI_CONDITION}`;
        await assert_s3_list_access_denied(s3, test_bucket, role_arn);
    });

    // ── G.8 ──────────────────────────────────────────────────────────────────
    // AWS behaviour: an explicit Deny in a bucket policy overrides an Allow in the
    // role's identity policy.  Deny always wins (AWS evaluation logic order 5→4→3→2→1).
    // Reference: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html

    mocha.it('G.8 - explicit Deny in bucket policy overrides Allow in role policy → s3:ListBucket denied', async function() {
        const account_id = role_owner_account._id.toString();

        // Put a bucket policy that explicitly Denies listObjects for the assumed-role ARN
        // while the role's identity policy allows s3:*.
        await rpc_client.bucket.put_bucket_policy({
            name: test_bucket,
            policy: {
                Version: '2012-10-17',
                Statement: [
                    {
                        // Allow the account root so other tests are not affected
                        Effect: 'Allow',
                        Principal: {
                            AWS: is_nc_coretest ? role_owner_email : `arn:aws:iam::${account_id}:root`,
                        },
                        Action: ['s3:*'],
                        Resource: [`arn:aws:s3:::${test_bucket}`, `arn:aws:s3:::${test_bucket}/*`],
                    },
                    {
                        // Explicitly Deny the assumed-role principal
                        Effect: 'Deny',
                        Principal: {
                            AWS: is_nc_coretest ? role_owner_email : `arn:aws:iam::${account_id}:root`,
                        },
                        Action: ['s3:ListBucket'],
                        Resource: [`arn:aws:s3:::${test_bucket}`],
                    },
                ],
            },
        });

        kc_stubs = stub_keycloak(async () => make_introspect_response());
        const token = make_keycloak_jwt();

        const json = await assume_role_with_web_identity(anon_sts, {
            RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_DENY_CONFLICTS}`,
            RoleSessionName: 'g8-deny-wins-session',
            WebIdentityToken: token,
        });
        const creds = json.Credentials;

        const s3 = s3_client_from_temp_creds(creds);
        const role_arn = `arn:aws:sts::${account_id}:role/${ROLE_DENY_CONFLICTS}`;
        await assert_s3_list_access_denied(s3, test_bucket, role_arn);

        // Restore open bucket policy
        await put_account_open_bucket_policy(rpc_client, test_bucket, account_id, role_owner_email);
    });
});
