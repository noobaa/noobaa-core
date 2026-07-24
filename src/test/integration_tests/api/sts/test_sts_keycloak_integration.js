/* Copyright (C) 2016 NooBaa */
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
const { require_coretest, is_nc_coretest, generate_iam_client } = require('../../../system_tests/test_utils');
const coretest = require_coretest();
coretest.setup();

const AWS = require('aws-sdk');
const https = require('https');
const mocha = require('mocha');
const assert = require('assert');
const jwt = require('jsonwebtoken');
const sinon = require('sinon');

const stsErr = require('../../../../endpoint/sts/sts_errors').StsError;
const { S3Error } = require('../../../../endpoint/s3/s3_errors');
const http_utils = require('../../../../util/http_utils');
const jwt_utils = require('../../../../util/jwt_utils');
const keycloak_client = require('../../../../util/keycloak_client');
const config = require('../../../../../config');
const { RpcError } = require('../../../../rpc');

const {
    CreateRoleCommand,
    DeleteRoleCommand,
    PutRolePolicyCommand,
} = require('@aws-sdk/client-iam');

// ---------------------------------------------------------------------------
// Constants & helpers shared by all describe blocks
// ---------------------------------------------------------------------------

const KEYCLOAK_ISSUER = 'http://keycloak.noobaa.svc.cluster.local:8080/realms/noobaa';
const KEYCLOAK_CLIENT_ID = 'noobaa-client';
const KEYCLOAK_SUBJECT = '1e59d996-2aa9-4a91-9740-d9cf61ccfd3e';

/** JWT private key used to sign mock Keycloak tokens (RS256-like but via HS256 for simplicity). */
const MOCK_JWT_SECRET = 'mock-keycloak-test-secret';

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
 * Parse the raw STS XML body out of an AWS SDK "complete" event and return
 * the JS object produced by `http_utils.parse_xml_to_js`.
 */
async function assume_role_with_wi_and_parse_xml(anon_sts, params) {
    const req = anon_sts.assumeRoleWithWebIdentity(params);
    let json;
    req.on('complete', async function(resp) {
        json = await http_utils.parse_xml_to_js(resp.httpResponse.body);
    });
    await req.promise();
    return json;
}

/**
 * Validate the AssumeRoleWithWebIdentity response structure and return
 * the temporary credentials.
 */
function validate_web_identity_response(json, expected_arn, expected_role_id, assumed_access_key) {
    assert.ok(json &&
        json.AssumeRoleWithWebIdentityResponse &&
        json.AssumeRoleWithWebIdentityResponse.AssumeRoleWithWebIdentityResult,
        'Response must contain AssumeRoleWithWebIdentityResult');

    const result = json.AssumeRoleWithWebIdentityResponse.AssumeRoleWithWebIdentityResult[0];
    assert.ok(result, 'Result must exist');

    // Credentials
    const credentials = result.Credentials[0];
    assert.ok(credentials.AccessKeyId[0], 'AccessKeyId must be present');
    assert.ok(credentials.SecretAccessKey[0], 'SecretAccessKey must be present');
    assert.ok(credentials.SessionToken[0], 'SessionToken must be present');

    // Verify the session token encodes the correct assumed-role access key
    if (config.STS_DEFAULT_SESSION_TOKEN_EXPIRY_MS !== 0) {
        const session_token_json = jwt_utils.authorize_jwt_token(credentials.SessionToken[0]);
        assert.equal(session_token_json.access_key, credentials.AccessKeyId[0]);
        assert.equal(session_token_json.secret_key, credentials.SecretAccessKey[0]);
        assert.equal(session_token_json.assumed_role_access_key, assumed_access_key);
        assert.ok(session_token_json.assumed_role_arn);
    }

    // AssumedRoleUser
    const assumed_role_user = result.AssumedRoleUser[0];
    assert.equal(assumed_role_user.Arn[0], expected_arn, 'ARN must match');
    assert.equal(assumed_role_user.AssumedRoleId[0], expected_role_id, 'AssumedRoleId must match');

    return {
        access_key: credentials.AccessKeyId[0],
        secret_key: credentials.SecretAccessKey[0],
        session_token: credentials.SessionToken[0],
    };
}

/**
 * Assert that a promise rejects with the expected AWS error code and message.
 */
async function assert_throws_async(promise, expected_code, expected_message) {
    try {
        await promise;
        assert.fail(`Expected rejection with code=${expected_code} but promise resolved`);
    } catch (err) {
        const code = err.code || err.rpc_code;
        if (code !== expected_code) throw err;
        if (expected_message !== undefined && err.message !== expected_message) throw err;
    }
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
    let sts_creds;
    const test_role_name = 'KeycloakTestRoleA';

    /** Keycloak stubs; replaced per-test where needed */
    let kc_stubs;

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

        await rpc_client.account.create_account({ ...account_defaults, name: role_owner_email, email: role_owner_email });
        role_owner_account = await rpc_client.account.read_account({ email: role_owner_email });

        const role_owner_keys = role_owner_account.access_keys;
        iam_client_role_owner = generate_iam_client(
            role_owner_keys[0].access_key.unwrap(),
            role_owner_keys[0].secret_key.unwrap(),
            coretest.get_https_address_iam()
        );

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

        anon_sts = new AWS.STS(sts_creds);

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
        if (kc_stubs) kc_stubs.restore();
        try {
            await iam_client_role_owner.send(new DeleteRoleCommand({ RoleName: test_role_name }));
        } catch (_) { /* ignore */ }
        await rpc_client.account.delete_account({ email: role_owner_email });
    });

    mocha.afterEach(function() {
        if (kc_stubs) {
            kc_stubs.restore();
            kc_stubs = null;
        }
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

        const json = await assume_role_with_wi_and_parse_xml(anon_sts, params);
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
            anon_sts.assumeRoleWithWebIdentity({
                RoleArn: `arn:aws:sts::${account_id}:role/${test_role_name}`,
                RoleSessionName: 'expired-session',
                WebIdentityToken: web_identity_token,
            }).promise(),
            stsErr.ExpiredToken.code,
            'Token expired: current date/time must be before the expiration date/time'
        );
    });

    mocha.it('should be rejected when the web identity token is malformed (not a JWT)', async function() {
        const account_id = role_owner_account._id.toString();

        kc_stubs = stub_keycloak(async () => make_introspect_response());

        await assert_throws_async(
            anon_sts.assumeRoleWithWebIdentity({
                RoleArn: `arn:aws:sts::${account_id}:role/${test_role_name}`,
                RoleSessionName: 'bad-token-session',
                WebIdentityToken: 'not.a.jwt',
            }).promise(),
            stsErr.AccessDeniedException.code,
            stsErr.AccessDeniedException.message
        );
    });

    mocha.it('should be rejected when the role does not exist', async function() {
        const account_id = role_owner_account._id.toString();

        kc_stubs = stub_keycloak(async () => make_introspect_response());

        const web_identity_token = make_keycloak_jwt();
        await assert_throws_async(
            anon_sts.assumeRoleWithWebIdentity({
                RoleArn: `arn:aws:sts::${account_id}:role/NonExistentRole`,
                RoleSessionName: 'no-role-session',
                WebIdentityToken: web_identity_token,
            }).promise(),
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
            anon_sts.assumeRoleWithWebIdentity({
                RoleArn: `arn:aws:sts::${account_id}:role/${test_role_name}`,
                RoleSessionName: 'foreign-issuer-session',
                WebIdentityToken: foreign_token,
            }).promise(),
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
    let sts_creds;

    const ROLE_WITH_DEPT_CONDITION = 'KcRoleDeptCondition';
    const ROLE_WITH_AUD_CONDITION = 'KcRoleAudCondition';
    const ROLE_WITH_FOR_ANY_VALUE = 'KcRoleForAnyValue';
    const ROLE_WITH_SESSION_TAG_ALLOW = 'KcRoleWithTagSession';
    const ROLE_WITH_MIXED_CONDITIONS = 'KcRoleMixedConditions';

    let kc_stubs;

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

        await rpc_client.account.create_account({ ...account_defaults, name: role_owner_email, email: role_owner_email });
        role_owner_account = await rpc_client.account.read_account({ email: role_owner_email });

        const role_owner_keys = role_owner_account.access_keys;
        iam_client_role_owner = generate_iam_client(
            role_owner_keys[0].access_key.unwrap(),
            role_owner_keys[0].secret_key.unwrap(),
            coretest.get_https_address_iam()
        );

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

        anon_sts = new AWS.STS(sts_creds);

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
        for (const role of [ROLE_WITH_DEPT_CONDITION, ROLE_WITH_AUD_CONDITION,
                             ROLE_WITH_FOR_ANY_VALUE, ROLE_WITH_SESSION_TAG_ALLOW,
                             ROLE_WITH_MIXED_CONDITIONS]) {
            try { await iam_client_role_owner.send(new DeleteRoleCommand({ RoleName: role })); } catch (_) { /* ignore */ }
        }
        await rpc_client.account.delete_account({ email: role_owner_email });
    });

    mocha.afterEach(function() {
        if (kc_stubs) { kc_stubs.restore(); kc_stubs = null; }
    });

    // ── B.1 aws:RequestTag / StringEquals ───────────────────────────────────

    mocha.it('B.1a - StringEquals on aws:RequestTag/Department matches → should be allowed', async function() {
        const account_id = role_owner_account._id.toString();
        const role_owner_access_key = role_owner_account.access_keys[0].access_key.unwrap();

        const token = make_keycloak_jwt({
            'https://aws.amazon.com/tags': { principal_tags: { Department: 'Engineering' } },
        });
        kc_stubs = stub_keycloak(async () => make_introspect_response());

        const json = await assume_role_with_wi_and_parse_xml(anon_sts, {
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
            anon_sts.assumeRoleWithWebIdentity({
                RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_WITH_DEPT_CONDITION}`,
                RoleSessionName: 'dept-no-match-session',
                WebIdentityToken: token,
            }).promise(),
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
            anon_sts.assumeRoleWithWebIdentity({
                RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_WITH_DEPT_CONDITION}`,
                RoleSessionName: 'dept-absent-session',
                WebIdentityToken: token,
            }).promise(),
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

        const json = await assume_role_with_wi_and_parse_xml(anon_sts, {
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
            anon_sts.assumeRoleWithWebIdentity({
                RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_WITH_AUD_CONDITION}`,
                RoleSessionName: 'aud-no-match-session',
                WebIdentityToken: token,
            }).promise(),
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

        const json = await assume_role_with_wi_and_parse_xml(anon_sts, {
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
            anon_sts.assumeRoleWithWebIdentity({
                RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_WITH_FOR_ANY_VALUE}`,
                RoleSessionName: 'forany-no-match-session',
                WebIdentityToken: token,
            }).promise(),
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

        const json = await assume_role_with_wi_and_parse_xml(anon_sts, {
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

        const json = await assume_role_with_wi_and_parse_xml(anon_sts, {
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
            anon_sts.assumeRoleWithWebIdentity({
                RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_WITH_MIXED_CONDITIONS}`,
                RoleSessionName: 'mixed-fail-session',
                WebIdentityToken: token,
            }).promise(),
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
            anon_sts.assumeRoleWithWebIdentity({
                RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_WITH_MIXED_CONDITIONS}`,
                RoleSessionName: 'mixed-env-fail-session',
                WebIdentityToken: token,
            }).promise(),
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
    const test_bucket = 'first.bucket'; // pre-existing bucket created by coretest

    let role_owner_account;
    let iam_client_role_owner;
    let anon_sts;
    let sts_creds;
    const ROLE_S3_ACCESS = 'KcRoleS3Access';

    let kc_stubs;

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

        await rpc_client.account.create_account({ ...account_defaults, name: role_owner_email, email: role_owner_email });
        role_owner_account = await rpc_client.account.read_account({ email: role_owner_email });

        const role_owner_keys = role_owner_account.access_keys;
        iam_client_role_owner = generate_iam_client(
            role_owner_keys[0].access_key.unwrap(),
            role_owner_keys[0].secret_key.unwrap(),
            coretest.get_https_address_iam()
        );

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

        anon_sts = new AWS.STS(sts_creds);

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
        await rpc_client.bucket.put_bucket_policy({
            name: test_bucket,
            policy: {
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Principal: {
                        AWS: is_nc_coretest ?
                            role_owner_email :
                            `arn:aws:iam::${account_id}:root`,
                    },
                    Action: ['s3:*'],
                    Resource: [
                        `arn:aws:s3:::${test_bucket}`,
                        `arn:aws:s3:::${test_bucket}/*`,
                    ],
                }],
            },
        });
    });

    mocha.after(async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);
        try { await iam_client_role_owner.send(new DeleteRoleCommand({ RoleName: ROLE_S3_ACCESS })); } catch (_) { /* ignore */ }
        await rpc_client.account.delete_account({ email: role_owner_email });
    });

    mocha.afterEach(function() {
        if (kc_stubs) { kc_stubs.restore(); kc_stubs = null; }
    });

    mocha.it('C.1 - S3 listObjects succeeds with valid temporary credentials', async function() {
        const account_id = role_owner_account._id.toString();

        kc_stubs = stub_keycloak(async () => make_introspect_response());
        const token = make_keycloak_jwt();

        const json = await assume_role_with_wi_and_parse_xml(anon_sts, {
            RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_S3_ACCESS}`,
            RoleSessionName: 'c1-list-session',
            WebIdentityToken: token,
        });

        const creds = json.AssumeRoleWithWebIdentityResponse.AssumeRoleWithWebIdentityResult[0].Credentials[0];
        const s3 = new AWS.S3({
            ...sts_creds,
            endpoint: coretest.get_https_address(),
            accessKeyId: creds.AccessKeyId[0],
            secretAccessKey: creds.SecretAccessKey[0],
            sessionToken: creds.SessionToken[0],
        });

        const result = await s3.listObjects({ Bucket: test_bucket }).promise();
        assert.ok(result, 'listObjects should succeed');
    });

    mocha.it('C.2 - S3 listObjects fails without session token (temp key alone is invalid)', async function() {
        const account_id = role_owner_account._id.toString();

        kc_stubs = stub_keycloak(async () => make_introspect_response());
        const token = make_keycloak_jwt();

        const json = await assume_role_with_wi_and_parse_xml(anon_sts, {
            RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_S3_ACCESS}`,
            RoleSessionName: 'c2-no-token-session',
            WebIdentityToken: token,
        });

        const creds = json.AssumeRoleWithWebIdentityResponse.AssumeRoleWithWebIdentityResult[0].Credentials[0];
        const s3 = new AWS.S3({
            ...sts_creds,
            endpoint: coretest.get_https_address(),
            accessKeyId: creds.AccessKeyId[0],
            secretAccessKey: creds.SecretAccessKey[0],
            // intentionally no sessionToken
        });

        await assert_throws_async(
            s3.listObjects({ Bucket: test_bucket }).promise(),
            S3Error.InvalidAccessKeyId.code,
            S3Error.InvalidAccessKeyId.message
        );
    });

    mocha.it('C.3 - S3 listObjects fails with a tampered session token', async function() {
        const account_id = role_owner_account._id.toString();

        kc_stubs = stub_keycloak(async () => make_introspect_response());
        const token = make_keycloak_jwt();

        const json = await assume_role_with_wi_and_parse_xml(anon_sts, {
            RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_S3_ACCESS}`,
            RoleSessionName: 'c3-tampered-session',
            WebIdentityToken: token,
        });

        const creds = json.AssumeRoleWithWebIdentityResponse.AssumeRoleWithWebIdentityResult[0].Credentials[0];
        const s3 = new AWS.S3({
            ...sts_creds,
            endpoint: coretest.get_https_address(),
            accessKeyId: creds.AccessKeyId[0],
            secretAccessKey: creds.SecretAccessKey[0],
            sessionToken: creds.SessionToken[0] + 'tampered',
        });

        await assert_throws_async(
            s3.listObjects({ Bucket: test_bucket }).promise(),
            S3Error.InvalidToken.code,
            S3Error.InvalidToken.message
        );
    });

    mocha.it('C.4 - S3 listObjects fails when using temp access-key with wrong session token', async function() {
        const account_id = role_owner_account._id.toString();

        kc_stubs = stub_keycloak(async () => make_introspect_response());
        const token = make_keycloak_jwt();

        // Obtain two independent sets of temp creds
        const json1 = await assume_role_with_wi_and_parse_xml(anon_sts, {
            RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_S3_ACCESS}`,
            RoleSessionName: 'c4-session-one',
            WebIdentityToken: token,
        });
        const json2 = await assume_role_with_wi_and_parse_xml(anon_sts, {
            RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_S3_ACCESS}`,
            RoleSessionName: 'c4-session-two',
            WebIdentityToken: token,
        });

        const creds1 = json1.AssumeRoleWithWebIdentityResponse.AssumeRoleWithWebIdentityResult[0].Credentials[0];
        const creds2 = json2.AssumeRoleWithWebIdentityResponse.AssumeRoleWithWebIdentityResult[0].Credentials[0];

        // Mix: access-key from session-1 with session-token from session-2
        const s3 = new AWS.S3({
            ...sts_creds,
            endpoint: coretest.get_https_address(),
            accessKeyId: creds1.AccessKeyId[0],
            secretAccessKey: creds1.SecretAccessKey[0],
            sessionToken: creds2.SessionToken[0],
        });

        await assert_throws_async(
            s3.listObjects({ Bucket: test_bucket }).promise(),
            S3Error.SignatureDoesNotMatch.code,
            S3Error.SignatureDoesNotMatch.message
        );
    });

    mocha.it('C.5 - S3 listObjects fails with an expired session token', async function() {
        const account_id = role_owner_account._id.toString();

        kc_stubs = stub_keycloak(async () => make_introspect_response());
        const token = make_keycloak_jwt();

        // Assume the role to get a real set of temp credentials
        const json = await assume_role_with_wi_and_parse_xml(anon_sts, {
            RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_S3_ACCESS}`,
            RoleSessionName: 'c5-expired-token-session',
            WebIdentityToken: token,
        });
        const creds = json.AssumeRoleWithWebIdentityResponse.AssumeRoleWithWebIdentityResult[0].Credentials[0];

        // Re-sign the session token payload with a 1-second TTL so it expires immediately.
        // This bypasses the STS minimum-duration validation (15 min) while keeping the
        // payload intact (access_key, secret_key, assumed_role_access_key, assumed_role_arn).
        const token_payload = jwt.decode(creds.SessionToken[0]);
        // Remove JWT reserved claims so make_auth_token can set a fresh expiry
        delete token_payload.iat;
        delete token_payload.exp;
        const expired_session_token = jwt_utils.make_auth_token(token_payload, { expiresIn: 1 });

        // Wait for the token to expire
        await new Promise(resolve => setTimeout(resolve, 1500));

        const s3 = new AWS.S3({
            ...sts_creds,
            endpoint: coretest.get_https_address(),
            accessKeyId: creds.AccessKeyId[0],
            secretAccessKey: creds.SecretAccessKey[0],
            sessionToken: expired_session_token,
        });

        await assert_throws_async(
            s3.listObjects({ Bucket: test_bucket }).promise(),
            S3Error.ExpiredToken.code,
            S3Error.ExpiredToken.message
        );
    }, 4000);
});

// ---------------------------------------------------------------------------
// D. IAM role policy enforcement + aws:PrincipalTag validation
// ---------------------------------------------------------------------------

mocha.describe('Keycloak AssumeRoleWithWebIdentity - IAM role policy + aws:PrincipalTag', function() {
    const { rpc_client } = coretest;

    const role_owner_email = 'kc-role-owner-d1';
    const test_bucket = 'first.bucket';

    let role_owner_account;
    let iam_client_role_owner;
    let anon_sts;
    let sts_creds;

    const ROLE_PRINCIPAL_TAG = 'KcRolePrincipalTag';
    const ROLE_DENY_POLICY = 'KcRoleDenyPolicy';
    const ROLE_LIMITED_S3 = 'KcRoleLimitedS3';

    let kc_stubs;

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

        await rpc_client.account.create_account({ ...account_defaults, name: role_owner_email, email: role_owner_email });
        role_owner_account = await rpc_client.account.read_account({ email: role_owner_email });

        const role_owner_keys = role_owner_account.access_keys;
        iam_client_role_owner = generate_iam_client(
            role_owner_keys[0].access_key.unwrap(),
            role_owner_keys[0].secret_key.unwrap(),
            coretest.get_https_address_iam()
        );

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

        anon_sts = new AWS.STS(sts_creds);

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
        await rpc_client.bucket.put_bucket_policy({
            name: test_bucket,
            policy: {
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Principal: {
                        AWS: is_nc_coretest ?
                            role_owner_email :
                            `arn:aws:iam::${account_id}:root`,
                    },
                    Action: ['s3:*'],
                    Resource: [
                        `arn:aws:s3:::${test_bucket}`,
                        `arn:aws:s3:::${test_bucket}/*`,
                    ],
                }],
            },
        });
    });

    mocha.after(async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);
        for (const role of [ROLE_PRINCIPAL_TAG, ROLE_DENY_POLICY, ROLE_LIMITED_S3]) {
            try { await iam_client_role_owner.send(new DeleteRoleCommand({ RoleName: role })); } catch (_) { /* ignore */ }
        }
        await rpc_client.account.delete_account({ email: role_owner_email });
    });

    mocha.afterEach(function() {
        if (kc_stubs) { kc_stubs.restore(); kc_stubs = null; }
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

        const json = await assume_role_with_wi_and_parse_xml(anon_sts, {
            RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_PRINCIPAL_TAG}`,
            RoleSessionName: 'd1-principal-tag-session',
            WebIdentityToken: token,
        });
        const creds = json.AssumeRoleWithWebIdentityResponse.AssumeRoleWithWebIdentityResult[0].Credentials[0];

        const s3 = new AWS.S3({
            ...sts_creds,
            endpoint: coretest.get_https_address(),
            accessKeyId: creds.AccessKeyId[0],
            secretAccessKey: creds.SecretAccessKey[0],
            sessionToken: creds.SessionToken[0],
        });

        const result = await s3.listObjects({ Bucket: test_bucket }).promise();
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

        const json = await assume_role_with_wi_and_parse_xml(anon_sts, {
            RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_PRINCIPAL_TAG}`,
            RoleSessionName: 'd2-principal-mismatch-session',
            WebIdentityToken: token,
        });
        const creds = json.AssumeRoleWithWebIdentityResponse.AssumeRoleWithWebIdentityResult[0].Credentials[0];

        const s3 = new AWS.S3({
            ...sts_creds,
            endpoint: coretest.get_https_address(),
            accessKeyId: creds.AccessKeyId[0],
            secretAccessKey: creds.SecretAccessKey[0],
            sessionToken: creds.SessionToken[0],
        });

        const role_arn = `arn:aws:sts::${account_id}:role/${ROLE_PRINCIPAL_TAG}`;
        await assert_throws_async(
            s3.listObjects({ Bucket: test_bucket }).promise(),
            S3Error.AccessDenied.code,
            make_iam_access_denied_message(role_arn, 's3:ListBucket', `arn:aws:s3:::${test_bucket}`)
        );
    });

    mocha.it('D.3 - IAM role policy with explicit Deny on s3:ListBucket → should be rejected', async function() {
        const account_id = role_owner_account._id.toString();

        // Open bucket policy (no principal-tag condition)
        await rpc_client.bucket.put_bucket_policy({
            name: test_bucket,
            policy: {
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Principal: {
                        AWS: is_nc_coretest ?
                            role_owner_email :
                            `arn:aws:iam::${account_id}:root`,
                    },
                    Action: ['s3:*'],
                    Resource: [
                        `arn:aws:s3:::${test_bucket}`,
                        `arn:aws:s3:::${test_bucket}/*`,
                    ],
                }],
            },
        });

        kc_stubs = stub_keycloak(async () => make_introspect_response());
        const token = make_keycloak_jwt();

        const json = await assume_role_with_wi_and_parse_xml(anon_sts, {
            RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_DENY_POLICY}`,
            RoleSessionName: 'd3-deny-policy-session',
            WebIdentityToken: token,
        });
        const creds = json.AssumeRoleWithWebIdentityResponse.AssumeRoleWithWebIdentityResult[0].Credentials[0];

        const s3 = new AWS.S3({
            ...sts_creds,
            endpoint: coretest.get_https_address(),
            accessKeyId: creds.AccessKeyId[0],
            secretAccessKey: creds.SecretAccessKey[0],
            sessionToken: creds.SessionToken[0],
        });

        // ListBucket is explicitly denied by the role policy
        const role_arn = `arn:aws:sts::${account_id}:role/${ROLE_DENY_POLICY}`;
        await assert_throws_async(
            s3.listObjects({ Bucket: test_bucket }).promise(),
            S3Error.AccessDenied.code,
            make_iam_access_denied_message(role_arn, 's3:ListBucket', `arn:aws:s3:::${test_bucket}`)
        );
    });

    mocha.it('D.4 - IAM role policy update: remove s3 access → subsequent S3 call denied', async function() {
        const account_id = role_owner_account._id.toString();

        // Open bucket policy
        await rpc_client.bucket.put_bucket_policy({
            name: test_bucket,
            policy: {
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Principal: {
                        AWS: is_nc_coretest ?
                            role_owner_email :
                            `arn:aws:iam::${account_id}:root`,
                    },
                    Action: ['s3:*'],
                    Resource: [
                        `arn:aws:s3:::${test_bucket}`,
                        `arn:aws:s3:::${test_bucket}/*`,
                    ],
                }],
            },
        });

        kc_stubs = stub_keycloak(async () => make_introspect_response());
        const token = make_keycloak_jwt();

        // First assume-role gives us working creds
        const json = await assume_role_with_wi_and_parse_xml(anon_sts, {
            RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_PRINCIPAL_TAG}`,
            RoleSessionName: 'd4-role-update-session',
            WebIdentityToken: token,
        });
        const creds = json.AssumeRoleWithWebIdentityResponse.AssumeRoleWithWebIdentityResult[0].Credentials[0];

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

        const s3 = new AWS.S3({
            ...sts_creds,
            endpoint: coretest.get_https_address(),
            accessKeyId: creds.AccessKeyId[0],
            secretAccessKey: creds.SecretAccessKey[0],
            sessionToken: creds.SessionToken[0],
        });

        const role_arn = `arn:aws:sts::${account_id}:role/${ROLE_PRINCIPAL_TAG}`;
        await assert_throws_async(
            s3.listObjects({ Bucket: test_bucket }).promise(),
            S3Error.AccessDenied.code,
            make_iam_access_denied_message(role_arn, 's3:ListBucket', `arn:aws:s3:::${test_bucket}`)
        );

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
        await rpc_client.bucket.put_bucket_policy({
            name: test_bucket,
            policy: {
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Principal: {
                        AWS: is_nc_coretest ?
                            role_owner_email :
                            `arn:aws:iam::${account_id}:root`,
                    },
                    Action: ['s3:*'],
                    Resource: [
                        `arn:aws:s3:::${test_bucket}`,
                        `arn:aws:s3:::${test_bucket}/*`,
                    ],
                }],
            },
        });

        kc_stubs = stub_keycloak(async () => make_introspect_response());
        const token = make_keycloak_jwt();

        const json = await assume_role_with_wi_and_parse_xml(anon_sts, {
            RoleArn: `arn:aws:sts::${account_id}:role/${ROLE_LIMITED_S3}`,
            RoleSessionName: 'd5-limited-s3-session',
            WebIdentityToken: token,
        });
        const creds = json.AssumeRoleWithWebIdentityResponse.AssumeRoleWithWebIdentityResult[0].Credentials[0];

        const s3 = new AWS.S3({
            ...sts_creds,
            endpoint: coretest.get_https_address(),
            accessKeyId: creds.AccessKeyId[0],
            secretAccessKey: creds.SecretAccessKey[0],
            sessionToken: creds.SessionToken[0],
        });

        // ListBucket is not granted by the role policy → implicitly denied
        const role_arn = `arn:aws:sts::${account_id}:role/${ROLE_LIMITED_S3}`;
        await assert_throws_async(
            s3.listObjects({ Bucket: test_bucket }).promise(),
            S3Error.AccessDenied.code,
            make_iam_access_denied_message(role_arn, 's3:ListBucket', `arn:aws:s3:::${test_bucket}`)
        );
    });
});
