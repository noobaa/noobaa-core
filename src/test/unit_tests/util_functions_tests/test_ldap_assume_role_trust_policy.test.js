/* Copyright (C) 2026 NooBaa */
'use strict';

/**
 * LDAP AssumeRoleWithWebIdentity trust-policy unit tests.
 *
 * Asserts intended behavior (Federated LDAP URI + ldap: Conditions on bind attrs).
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

function trust_policy({ principal, action = 'sts:AssumeRoleWithWebIdentity', condition } = {}) {
    const statement = {
        Effect: 'Allow',
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

    describe('Principal.Federated (LDAP URI)', () => {

        it('should ALLOW when Federated URI matches configured LDAP URI (ldaps)', async () => {
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
            expect(result).toBe('ALLOW');
        });

        it('should ALLOW when Federated uses ldap:// and config uses ldaps:// (scheme-stripped match)', async () => {
            const policy = trust_policy({
                principal: { Federated: 'ldap://127.0.0.1:1636' },
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

        it('should ALLOW when Federated uses ldaps:// and config uses ldap:// (scheme-stripped match)', async () => {
            ldap_client.instance.mockReturnValue({
                ldap_params: { uri: 'ldap://127.0.0.1:1636' },
            });
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
            expect(result).toBe('ALLOW');
        });

        it('should IMPLICIT_DENY when Federated URI does not match configured LDAP URI', async () => {
            const policy = trust_policy({
                principal: { Federated: 'ldaps://wrong-host:1636' },
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
                principal: { Federated: LDAP_URI },
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

        it('should ALLOW when Action is sts:* and Federated URI matches', async () => {
            const policy = trust_policy({
                principal: { Federated: LDAP_URI },
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

        it('should ALLOW when Federated is an array and one URI matches', async () => {
            const policy = trust_policy({
                principal: { Federated: ['ldaps://other:636', LDAP_URI] },
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
                principal: { Federated: LDAP_URI },
                condition: { StringEquals: { 'ldap:ou': 'Delivering Crew' } },
            });
            expect(await eval_trust(policy, fry_bind)).toBe('ALLOW');
        });

        it('should IMPLICIT_DENY when StringEquals ldap:ou mismatches bind attr', async () => {
            const policy = trust_policy({
                principal: { Federated: LDAP_URI },
                condition: { StringEquals: { 'ldap:ou': 'Wrong OU' } },
            });
            expect(await eval_trust(policy, fry_bind)).toBe('IMPLICIT_DENY');
        });

        it('should IMPLICIT_DENY when ldap: condition attr is missing from bind result', async () => {
            const policy = trust_policy({
                principal: { Federated: LDAP_URI },
                condition: { StringEquals: { 'ldap:ou': 'Delivering Crew' } },
            });
            expect(await eval_trust(policy, { uid: 'fry', dn: fry_bind.dn })).toBe('IMPLICIT_DENY');
        });

        it('should ALLOW ForAnyValue:StringEquals when multi-valued ldap attr overlaps', async () => {
            const policy = trust_policy({
                principal: { Federated: LDAP_URI },
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
                principal: { Federated: LDAP_URI },
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
                principal: { Federated: LDAP_URI },
            });
            expect(await eval_trust(policy, fry_bind)).toBe('ALLOW');
        });

        it('should IMPLICIT_DENY unsupported condition operator on ldap path', async () => {
            const policy = trust_policy({
                principal: { Federated: LDAP_URI },
                condition: { StringLike: { 'ldap:ou': 'Delivering*' } },
            });
            expect(await eval_trust(policy, fry_bind)).toBe('IMPLICIT_DENY');
        });
    });
});
