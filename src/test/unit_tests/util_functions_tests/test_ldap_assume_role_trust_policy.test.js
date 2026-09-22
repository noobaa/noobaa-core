/* Copyright (C) 2026 NooBaa */
'use strict';

/**
 * LDAP AssumeRoleWithWebIdentity trust-policy unit tests.
 *
 * Asserts intended behavior (Federated LDAP-provider ARN + ldap: Conditions on bind attrs).
 * Expectations must NOT be adapted to current bugs — if production wrongly ALLOWs
 * when Condition should deny (or the reverse), these tests should fail.
 * Does not cover Keycloak/OIDC, JWT/bind/STS wiring (those belong in STS suites).
 */

jest.mock('jwks-rsa', () => jest.fn().mockImplementation(() => ({
    getSigningKey: jest.fn((kid, cb) => cb(null, {
        getPublicKey: () => '-----BEGIN PUBLIC KEY-----\nMOCK\n-----END PUBLIC KEY-----'
    })),
})), { virtual: true });

const LDAP_URI = 'ldaps://127.0.0.1:1636';
const LDAP_FEDERATED_ARN = 'arn:aws:iam:::ldap-provider/127.0.0.1:1636';

jest.mock('../../../util/ldap_client', () => ({
    instance: jest.fn(() => ({
        ldap_params: { uri: LDAP_URI },
    })),
    is_ldap_configured: jest.fn(() => true),
}));

const jwt = require('jsonwebtoken');
const access_policy_utils = require('../../../util/access_policy_utils');
const ldap_client = require('../../../util/ldap_client');

function ldap_jwt(claims = { user: 'fry', password: 'fry' }) {
    return jwt.sign(claims, 'test-secret');
}

function trust_policy({ principal, action = 'sts:AssumeRoleWithWebIdentity', condition, effect = 'Allow' } = {}) {
    const statement = {
        Effect: effect,
        Principal: principal,
        Action: action,
    };
    if (condition) statement.Condition = condition;
    return {
        Version: '2012-10-17',
        Statement: [statement],
    };
}

function ldap_req(claims, identity_info) {
    const req = { body: { web_identity_token: ldap_jwt(claims) } };
    if (identity_info) {
        req.sts_sdk = { identity_info };
    }
    return req;
}

describe('LDAP AssumeRoleWithWebIdentity trust policy', () => {

    beforeEach(() => {
        ldap_client.instance.mockReturnValue({
            ldap_params: { uri: LDAP_URI },
        });
    });

    describe('Principal.Federated (LDAP-provider ARN)', () => {

        it('should ALLOW when Federated ldap-provider ARN host:port matches configured LDAP URI', async () => {
            const policy = trust_policy({
                principal: { Federated: LDAP_FEDERATED_ARN },
            });
            const result = await access_policy_utils.has_access_policy_permission(
                policy,
                [],
                'sts:AssumeRoleWithWebIdentity',
                undefined,
                ldap_req({ user: 'fry', password: 'fry' }),
                { is_trust_policy: true }
            );
            expect(result).toBe('ALLOW');
        });

        it('should ALLOW when config uses ldap:// and Federated ARN host:port matches', async () => {
            ldap_client.instance.mockReturnValue({
                ldap_params: { uri: 'ldap://127.0.0.1:1636' },
            });
            const policy = trust_policy({
                principal: { Federated: LDAP_FEDERATED_ARN },
            });
            const result = await access_policy_utils.has_access_policy_permission(
                policy,
                [],
                'sts:AssumeRoleWithWebIdentity',
                undefined,
                ldap_req({ user: 'fry', password: 'fry' }),
                { is_trust_policy: true }
            );
            expect(result).toBe('ALLOW');
        });

        it('should IMPLICIT_DENY when Federated ldap-provider ARN host does not match', async () => {
            const policy = trust_policy({
                principal: { Federated: 'arn:aws:iam:::ldap-provider/ldap.example.com:636' },
            });
            const result = await access_policy_utils.has_access_policy_permission(
                policy,
                [],
                'sts:AssumeRoleWithWebIdentity',
                undefined,
                ldap_req({ user: 'fry', password: 'fry' }),
                { is_trust_policy: true }
            );
            expect(result).toBe('IMPLICIT_DENY');
        });

        it('should IMPLICIT_DENY when Federated is a raw LDAP URI (ARN required)', async () => {
            const policy = trust_policy({
                principal: { Federated: LDAP_URI },
            });
            const result = await access_policy_utils.has_access_policy_permission(
                policy,
                [],
                'sts:AssumeRoleWithWebIdentity',
                undefined,
                ldap_req({ user: 'fry', password: 'fry' }),
                { is_trust_policy: true }
            );
            expect(result).toBe('IMPLICIT_DENY');
        });

        it('should ALLOW anonymous LDAP caller with Principal AWS *', async () => {
            const policy = trust_policy({
                principal: { AWS: '*' },
            });
            const result = await access_policy_utils.has_access_policy_permission(
                policy,
                [],
                'sts:AssumeRoleWithWebIdentity',
                undefined,
                ldap_req({ user: 'fry', password: 'fry' }),
                { is_trust_policy: true }
            );
            expect(result).toBe('ALLOW');
        });

        it('should IMPLICIT_DENY when Action is sts:AssumeRole only (not WebIdentity)', async () => {
            const policy = trust_policy({
                principal: { Federated: LDAP_FEDERATED_ARN },
                action: 'sts:AssumeRole',
            });
            const result = await access_policy_utils.has_access_policy_permission(
                policy,
                [],
                'sts:AssumeRoleWithWebIdentity',
                undefined,
                ldap_req({ user: 'fry', password: 'fry' }),
                { is_trust_policy: true }
            );
            expect(result).toBe('IMPLICIT_DENY');
        });

        it('should ALLOW when Action is sts:* and Federated ARN matches', async () => {
            const policy = trust_policy({
                principal: { Federated: LDAP_FEDERATED_ARN },
                action: 'sts:*',
            });
            const result = await access_policy_utils.has_access_policy_permission(
                policy,
                [],
                'sts:AssumeRoleWithWebIdentity',
                undefined,
                ldap_req({ user: 'fry', password: 'fry' }),
                { is_trust_policy: true }
            );
            expect(result).toBe('ALLOW');
        });

        it('should ALLOW when Federated is an array and one ARN matches', async () => {
            const policy = trust_policy({
                principal: {
                    Federated: [
                        'arn:aws:iam:::ldap-provider/other:636',
                        LDAP_FEDERATED_ARN,
                    ],
                },
            });
            const result = await access_policy_utils.has_access_policy_permission(
                policy,
                [],
                'sts:AssumeRoleWithWebIdentity',
                undefined,
                ldap_req({ user: 'fry', password: 'fry' }),
                { is_trust_policy: true }
            );
            expect(result).toBe('ALLOW');
        });
    });

    describe('ldap: Condition keys (bind attributes)', () => {

        // Intended behavior (not "whatever the code currently returns"):
        // - ldap:* Conditions evaluate against LDAP bind attrs on req.sts_sdk.identity_info
        // - JWT claims alone (user/password) are NOT sufficient for ldap: Conditions
        // These go through has_access_policy_permission so a missing merge fails the suite.

        const fry_bind = {
            dn: 'cn=Philip J. Fry,ou=people,dc=planetexpress,dc=com',
            ou: 'Delivering Crew',
            memberOf: 'cn=ship_crew,ou=people,dc=planetexpress,dc=com',
            uid: 'fry',
            cn: 'Philip J. Fry',
            mail: 'fry@planetexpress.com',
        };

        async function eval_trust(policy, identity_info) {
            return access_policy_utils.has_access_policy_permission(
                policy,
                [],
                'sts:AssumeRoleWithWebIdentity',
                undefined,
                ldap_req({ user: 'fry', password: 'fry' }, identity_info),
                { is_trust_policy: true }
            );
        }

        it('should ALLOW when StringEquals ldap:ou matches bind attr', async () => {
            const policy = trust_policy({
                principal: { Federated: LDAP_FEDERATED_ARN },
                condition: { StringEquals: { 'ldap:ou': 'Delivering Crew' } },
            });
            expect(await eval_trust(policy, fry_bind)).toBe('ALLOW');
        });

        it('should IMPLICIT_DENY when StringEquals ldap:ou mismatches bind attr', async () => {
            const policy = trust_policy({
                principal: { Federated: LDAP_FEDERATED_ARN },
                condition: { StringEquals: { 'ldap:ou': 'Wrong OU' } },
            });
            expect(await eval_trust(policy, fry_bind)).toBe('IMPLICIT_DENY');
        });

        it('should IMPLICIT_DENY when ldap: condition attr is missing from bind result', async () => {
            const policy = trust_policy({
                principal: { Federated: LDAP_FEDERATED_ARN },
                condition: { StringEquals: { 'ldap:ou': 'Delivering Crew' } },
            });
            expect(await eval_trust(policy, { uid: 'fry', dn: fry_bind.dn })).toBe('IMPLICIT_DENY');
        });

        it('should ALLOW ForAnyValue:StringEquals when multi-valued ldap attr overlaps', async () => {
            const policy = trust_policy({
                principal: { Federated: LDAP_FEDERATED_ARN },
                condition: {
                    'ForAnyValue:StringEquals': {
                        'ldap:ou': ['Delivering Crew', 'Service Staff'],
                    },
                },
            });
            expect(await eval_trust(policy, {
                ...fry_bind,
                ou: ['Delivering Crew', 'Ship Crew'],
            })).toBe('ALLOW');
        });

        it('should IMPLICIT_DENY ForAnyValue:StringEquals when no values overlap', async () => {
            const policy = trust_policy({
                principal: { Federated: LDAP_FEDERATED_ARN },
                condition: {
                    'ForAnyValue:StringEquals': {
                        'ldap:ou': ['Service Staff', 'Office'],
                    },
                },
            });
            expect(await eval_trust(policy, {
                ...fry_bind,
                ou: ['Delivering Crew'],
            })).toBe('IMPLICIT_DENY');
        });

        it('should ALLOW Principal AWS * + matching ldap:ou (LDAPRole shape)', async () => {
            const policy = trust_policy({
                principal: { AWS: '*' },
                condition: { StringEquals: { 'ldap:ou': 'Delivering Crew' } },
            });
            expect(await eval_trust(policy, fry_bind)).toBe('ALLOW');
        });

        it('should IMPLICIT_DENY ldap:ou when only JWT is present (bind attrs required)', async () => {
            // Production bug class: Principal fits from JWT, Condition wrongly ignored/used JWT.
            // Correct behavior: deny — ldap:ou is not on the JWT.
            const policy = trust_policy({
                principal: { AWS: '*' },
                condition: { StringEquals: { 'ldap:ou': 'Delivering Crew' } },
            });
            expect(await eval_trust(policy, undefined)).toBe('IMPLICIT_DENY');
        });

        it('should ALLOW when Principal/Action fit and no Condition block', async () => {
            const policy = trust_policy({
                principal: { Federated: LDAP_FEDERATED_ARN },
            });
            expect(await eval_trust(policy, fry_bind)).toBe('ALLOW');
        });

        it('should IMPLICIT_DENY unsupported condition operator on ldap path', async () => {
            const policy = trust_policy({
                principal: { Federated: LDAP_FEDERATED_ARN },
                condition: { StringLike: { 'ldap:ou': 'Delivering*' } },
            });
            expect(await eval_trust(policy, fry_bind)).toBe('IMPLICIT_DENY');
        });
    });

    describe('explicit Deny', () => {

        const fry_bind = {
            dn: 'cn=Philip J. Fry,ou=people,dc=planetexpress,dc=com',
            ou: 'Delivering Crew',
            memberOf: 'cn=ship_crew,ou=people,dc=planetexpress,dc=com',
            uid: 'fry',
        };

        async function eval_trust(policy, identity_info = fry_bind) {
            return access_policy_utils.has_access_policy_permission(
                policy,
                [],
                'sts:AssumeRoleWithWebIdentity',
                undefined,
                ldap_req({ user: 'fry', password: 'fry' }, identity_info),
                { is_trust_policy: true }
            );
        }

        it('should DENY when Effect Deny Federated ARN matches', async () => {
            const policy = trust_policy({
                effect: 'Deny',
                principal: { Federated: LDAP_FEDERATED_ARN },
            });
            expect(await eval_trust(policy)).toBe('DENY');
        });

        it('should DENY when Effect Deny ldap:ou matches bind attr', async () => {
            const policy = trust_policy({
                effect: 'Deny',
                principal: { Federated: LDAP_FEDERATED_ARN },
                condition: { StringEquals: { 'ldap:ou': 'Delivering Crew' } },
            });
            expect(await eval_trust(policy)).toBe('DENY');
        });

        it('should IMPLICIT_DENY when Effect Deny ldap:ou does not match (no Allow)', async () => {
            const policy = trust_policy({
                effect: 'Deny',
                principal: { Federated: LDAP_FEDERATED_ARN },
                condition: { StringEquals: { 'ldap:ou': 'Office' } },
            });
            expect(await eval_trust(policy)).toBe('IMPLICIT_DENY');
        });

        it('should ALLOW when Deny ldap:ou does not match and Allow Federated matches', async () => {
            const policy = {
                Version: '2012-10-17',
                Statement: [
                    trust_policy({ principal: { Federated: LDAP_FEDERATED_ARN } }).Statement[0],
                    trust_policy({
                        effect: 'Deny',
                        principal: { Federated: LDAP_FEDERATED_ARN },
                        condition: { StringEquals: { 'ldap:ou': 'Office' } },
                    }).Statement[0],
                ],
            };
            expect(await eval_trust(policy)).toBe('ALLOW');
        });

        it('should DENY when Allow Federated matches but Deny ldap:ou also matches', async () => {
            const policy = {
                Version: '2012-10-17',
                Statement: [
                    trust_policy({ principal: { Federated: LDAP_FEDERATED_ARN } }).Statement[0],
                    trust_policy({
                        effect: 'Deny',
                        principal: { Federated: LDAP_FEDERATED_ARN },
                        condition: { StringEquals: { 'ldap:ou': 'Delivering Crew' } },
                    }).Statement[0],
                ],
            };
            expect(await eval_trust(policy)).toBe('DENY');
        });
    });
});
