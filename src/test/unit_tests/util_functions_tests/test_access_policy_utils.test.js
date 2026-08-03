/* Copyright (C) 2026 NooBaa */
/* eslint-disable max-lines-per-function */
'use strict';

const access_policy_utils = require('../../../util/access_policy_utils');
const RpcError = require('../../../rpc/rpc_error');

const BUCKET_NAME = 'test-bucket';
const VECTOR_BUCKET_NAME = 'test-vector-bucket';

const account_handler_allow_all = async () => ({ _id: '123' });
const account_handler_deny_all = async () => null;

/**
 * @param {Object} [params]
 * @param {'Allow'|'Deny'} [params.effect='Allow']
 * @param {string|{AWS: string|string[]}} [params.principal='*']
 * @param {string|string[]} [params.action]
 * @param {string|string[]} [params.resource]
 * @param {Object} [params.condition]
 * @returns {{ Statement: Object[] }}
 */
function make_policy({ effect = 'Allow', principal = '*', action, resource, condition } = {}) {
    const statement = { Effect: effect };
    statement.Principal = principal;
    if (action) statement.Action = action;
    if (resource) statement.Resource = resource;
    if (condition) statement.Condition = condition;
    return { Statement: [statement] };
}

async function expect_malformed_policy(fn) {
    try {
        await fn();
        throw new Error('Expected MALFORMED_POLICY error but none was thrown');
    } catch (err) {
        expect(err).toBeInstanceOf(RpcError);
        expect(err.rpc_code).toBe('MALFORMED_POLICY');
    }
}

describe('access_policy_utils', () => {

    describe('validate_bucket_policy', () => {

        describe('valid policies', () => {
            it('should accept a policy with wildcard principal and s3:* action', async () => {
                const policy = make_policy({
                    action: 's3:*',
                    resource: `arn:aws:s3:::${BUCKET_NAME}`,
                });
                await expect(
                    access_policy_utils.validate_bucket_policy(policy, BUCKET_NAME, account_handler_allow_all)
                ).resolves.toBeUndefined();
            });

            it('should accept a policy with a specific valid s3 action', async () => {
                const policy = make_policy({
                    action: 's3:GetObject',
                    resource: `arn:aws:s3:::${BUCKET_NAME}/*`,
                });
                await expect(
                    access_policy_utils.validate_bucket_policy(policy, BUCKET_NAME, account_handler_allow_all)
                ).resolves.toBeUndefined();
            });

            it('should accept a policy with multiple valid actions', async () => {
                const policy = make_policy({
                    action: ['s3:GetObject', 's3:PutObject'],
                    resource: `arn:aws:s3:::${BUCKET_NAME}/*`,
                });
                await expect(
                    access_policy_utils.validate_bucket_policy(policy, BUCKET_NAME, account_handler_allow_all)
                ).resolves.toBeUndefined();
            });

            it('should accept s3:PutObjectLegalHold', async () => {
                const policy = make_policy({
                    action: [
                        's3:PutObjectLegalHold',
                        's3:GetObjectLegalHold',
                    ],
                    resource: [
                        `arn:aws:s3:::${BUCKET_NAME}`,
                        `arn:aws:s3:::${BUCKET_NAME}/*`,
                    ],
                });
                await expect(
                    access_policy_utils.validate_bucket_policy(policy, BUCKET_NAME, account_handler_allow_all)
                ).resolves.toBeUndefined();
            });

            it('should accept a Deny statement with NotPrincipal', async () => {
                const policy = make_policy({
                    effect: 'Deny',
                    action: 's3:GetObject',
                    resource: `arn:aws:s3:::${BUCKET_NAME}/*`,
                });
                policy.Statement[0].NotPrincipal = { AWS: '*' };
                delete policy.Statement[0].Principal;
                await expect(
                    access_policy_utils.validate_bucket_policy(policy, BUCKET_NAME, account_handler_allow_all)
                ).resolves.toBeUndefined();
            });

            it('should accept a valid s3 condition key', async () => {
                const policy = make_policy({
                    action: 's3:PutObject',
                    resource: `arn:aws:s3:::${BUCKET_NAME}/*`,
                    condition: { StringEquals: { 's3:x-amz-server-side-encryption': 'AES256' } },
                });
                await expect(
                    access_policy_utils.validate_bucket_policy(policy, BUCKET_NAME, account_handler_allow_all)
                ).resolves.toBeUndefined();
            });

            it('should accept a condition key with sub-key (split on /)', async () => {
                const policy = make_policy({
                    action: 's3:GetObject',
                    resource: `arn:aws:s3:::${BUCKET_NAME}/*`,
                    condition: { StringEquals: { 's3:ExistingObjectTag/environment': 'production' } },
                });
                await expect(
                    access_policy_utils.validate_bucket_policy(policy, BUCKET_NAME, account_handler_allow_all)
                ).resolves.toBeUndefined();
            });

            it('should accept a resource with wildcard matching the bucket', async () => {
                const policy = make_policy({
                    action: 's3:GetObject',
                    resource: `arn:aws:s3:::test-*`,
                });
                await expect(
                    access_policy_utils.validate_bucket_policy(policy, BUCKET_NAME, account_handler_allow_all)
                ).resolves.toBeUndefined();
            });
        });

        describe('invalid actions', () => {
            it('should reject an s3vectors action in an s3 bucket policy', async () => {
                const policy = make_policy({
                    action: 's3vectors:PutVectors',
                    resource: `arn:aws:s3:::${BUCKET_NAME}`,
                });
                await expect_malformed_policy(() =>
                    access_policy_utils.validate_bucket_policy(policy, BUCKET_NAME, account_handler_allow_all)
                );
            });

            it('should reject a completely invalid action', async () => {
                const policy = make_policy({
                    action: 'ec2:RunInstances',
                    resource: `arn:aws:s3:::${BUCKET_NAME}`,
                });
                await expect_malformed_policy(() =>
                    access_policy_utils.validate_bucket_policy(policy, BUCKET_NAME, account_handler_allow_all)
                );
            });

            it('should reject s3vectors:* wildcard in an s3 bucket policy', async () => {
                const policy = make_policy({
                    action: 's3vectors:*',
                    resource: `arn:aws:s3:::${BUCKET_NAME}`,
                });
                await expect_malformed_policy(() =>
                    access_policy_utils.validate_bucket_policy(policy, BUCKET_NAME, account_handler_allow_all)
                );
            });
        });

        describe('invalid resources', () => {
            it('should reject a resource that does not match the bucket name', async () => {
                const policy = make_policy({
                    action: 's3:GetObject',
                    resource: 'arn:aws:s3:::other-bucket/*',
                });
                await expect_malformed_policy(() =>
                    access_policy_utils.validate_bucket_policy(policy, BUCKET_NAME, account_handler_allow_all)
                );
            });

            it('should reject a malformed resource with brackets', async () => {
                const policy = make_policy({
                    action: 's3:GetObject',
                    resource: `arn:aws:s3:::${BUCKET_NAME}[bad]`,
                });
                await expect_malformed_policy(() =>
                    access_policy_utils.validate_bucket_policy(policy, BUCKET_NAME, account_handler_allow_all)
                );
            });
        });

        describe('invalid principals', () => {
            it('should reject an Allow statement with NotPrincipal', async () => {
                const policy = make_policy({
                    effect: 'Allow',
                    action: 's3:GetObject',
                    resource: `arn:aws:s3:::${BUCKET_NAME}/*`,
                });
                policy.Statement[0].NotPrincipal = { AWS: '*' };
                delete policy.Statement[0].Principal;
                await expect_malformed_policy(() =>
                    access_policy_utils.validate_bucket_policy(policy, BUCKET_NAME, account_handler_allow_all)
                );
            });

            it('should reject a non-wildcard principal that does not exist', async () => {
                const policy = make_policy({
                    principal: { AWS: 'arn:aws:iam::123456789:root' },
                    action: 's3:GetObject',
                    resource: `arn:aws:s3:::${BUCKET_NAME}/*`,
                });
                await expect_malformed_policy(() =>
                    access_policy_utils.validate_bucket_policy(policy, BUCKET_NAME, account_handler_deny_all)
                );
            });

            it('should reject a non-wildcard bare string principal', async () => {
                const policy = make_policy({
                    principal: 'arn:aws:iam::123456789:root',
                    action: 's3:GetObject',
                    resource: `arn:aws:s3:::${BUCKET_NAME}/*`,
                });
                await expect_malformed_policy(() =>
                    access_policy_utils.validate_bucket_policy(policy, BUCKET_NAME, account_handler_allow_all)
                );
            });
        });

        describe('valid aws:SourceIp conditions', () => {
            it('should accept aws:SourceIp with IpAddress operator', async () => {
                const policy = make_policy({
                    action: 's3:GetObject',
                    resource: `arn:aws:s3:::${BUCKET_NAME}/*`,
                    condition: { IpAddress: { 'aws:SourceIp': '192.0.2.0/24' } },
                });
                await expect(
                    access_policy_utils.validate_bucket_policy(policy, BUCKET_NAME, account_handler_allow_all)
                ).resolves.toBeUndefined();
            });

            it('should accept aws:SourceIp with NotIpAddress operator', async () => {
                const policy = make_policy({
                    action: 's3:GetObject',
                    resource: `arn:aws:s3:::${BUCKET_NAME}/*`,
                    condition: { NotIpAddress: { 'aws:SourceIp': '192.0.2.0/24' } },
                });
                await expect(
                    access_policy_utils.validate_bucket_policy(policy, BUCKET_NAME, account_handler_allow_all)
                ).resolves.toBeUndefined();
            });

            it('should accept aws:SourceIp with an array of CIDR ranges', async () => {
                const policy = make_policy({
                    action: 's3:PutObject',
                    resource: `arn:aws:s3:::${BUCKET_NAME}/*`,
                    condition: { IpAddress: { 'aws:SourceIp': ['192.0.2.0/24', '10.0.0.0/8'] } },
                });
                await expect(
                    access_policy_utils.validate_bucket_policy(policy, BUCKET_NAME, account_handler_allow_all)
                ).resolves.toBeUndefined();
            });

            it('should accept aws:SourceIp with an exact IPv4 address', async () => {
                const policy = make_policy({
                    action: 's3:GetObject',
                    resource: `arn:aws:s3:::${BUCKET_NAME}/*`,
                    condition: { IpAddress: { 'aws:SourceIp': '203.0.113.5' } },
                });
                await expect(
                    access_policy_utils.validate_bucket_policy(policy, BUCKET_NAME, account_handler_allow_all)
                ).resolves.toBeUndefined();
            });

            it('should accept aws:SourceIp with an IPv6 CIDR', async () => {
                const policy = make_policy({
                    action: 's3:GetObject',
                    resource: `arn:aws:s3:::${BUCKET_NAME}/*`,
                    condition: { IpAddress: { 'aws:SourceIp': '2001:db8::/32' } },
                });
                await expect(
                    access_policy_utils.validate_bucket_policy(policy, BUCKET_NAME, account_handler_allow_all)
                ).resolves.toBeUndefined();
            });
        });

        describe('invalid conditions', () => {
            it('should reject an unsupported condition key', async () => {
                const policy = make_policy({
                    action: 's3:PutObject',
                    resource: `arn:aws:s3:::${BUCKET_NAME}/*`,
                    condition: { StringEquals: { 'aws:UnknownKey': 'value' } },
                });
                await expect_malformed_policy(() =>
                    access_policy_utils.validate_bucket_policy(policy, BUCKET_NAME, account_handler_allow_all)
                );
            });

            it('should reject a non-IP string as aws:SourceIp value', async () => {
                const policy = make_policy({
                    action: 's3:GetObject',
                    resource: `arn:aws:s3:::${BUCKET_NAME}/*`,
                    condition: { IpAddress: { 'aws:SourceIp': 'not-an-ip' } },
                });
                await expect_malformed_policy(() =>
                    access_policy_utils.validate_bucket_policy(policy, BUCKET_NAME, account_handler_allow_all)
                );
            });

            it('should reject an invalid CIDR in an array value', async () => {
                const policy = make_policy({
                    action: 's3:GetObject',
                    resource: `arn:aws:s3:::${BUCKET_NAME}/*`,
                    condition: { IpAddress: { 'aws:SourceIp': ['192.0.2.0/24', 'bad-entry'] } },
                });
                await expect_malformed_policy(() =>
                    access_policy_utils.validate_bucket_policy(policy, BUCKET_NAME, account_handler_allow_all)
                );
            });

            it('should reject a vector condition key in an s3 bucket policy', async () => {
                const policy = make_policy({
                    action: 's3:PutObject',
                    resource: `arn:aws:s3:::${BUCKET_NAME}/*`,
                    condition: { StringEquals: { 's3vectors:sseType': 'AES256' } },
                });
                await expect_malformed_policy(() =>
                    access_policy_utils.validate_bucket_policy(policy, BUCKET_NAME, account_handler_allow_all)
                );
            });
        });
    });

    describe('validate_vector_bucket_policy', () => {

        describe('valid policies', () => {
            it('should accept a policy with wildcard principal and s3vectors:* action', async () => {
                const policy = make_policy({
                    action: 's3vectors:*',
                    resource: `arn:aws:s3vectors:::${VECTOR_BUCKET_NAME}`,
                });
                await expect(
                    access_policy_utils.validate_vector_bucket_policy(policy, VECTOR_BUCKET_NAME, account_handler_allow_all)
                ).resolves.toBeUndefined();
            });

            it('should accept a policy with a specific valid vector action', async () => {
                const policy = make_policy({
                    action: 's3vectors:PutVectors',
                    resource: `arn:aws:s3vectors:::${VECTOR_BUCKET_NAME}`,
                });
                await expect(
                    access_policy_utils.validate_vector_bucket_policy(policy, VECTOR_BUCKET_NAME, account_handler_allow_all)
                ).resolves.toBeUndefined();
            });

            it('should accept a policy with multiple valid vector actions', async () => {
                const policy = make_policy({
                    action: ['s3vectors:PutVectors', 's3vectors:QueryVectors', 's3vectors:GetVectors'],
                    resource: `arn:aws:s3vectors:::${VECTOR_BUCKET_NAME}`,
                });
                await expect(
                    access_policy_utils.validate_vector_bucket_policy(policy, VECTOR_BUCKET_NAME, account_handler_allow_all)
                ).resolves.toBeUndefined();
            });

            it('should accept all individual vector actions', async () => {
                const all_actions = [
                    's3vectors:CreateVectorBucket', 's3vectors:GetVectorBucket',
                    's3vectors:DeleteVectorBucket', 's3vectors:ListVectorBuckets',
                    's3vectors:ListIndexes', 's3vectors:PutVectorBucketPolicy',
                    's3vectors:GetVectorBucketPolicy', 's3vectors:DeleteVectorBucketPolicy',
                    's3vectors:CreateIndex', 's3vectors:GetIndex',
                    's3vectors:DeleteIndex', 's3vectors:QueryVectors',
                    's3vectors:PutVectors', 's3vectors:GetVectors',
                    's3vectors:ListVectors', 's3vectors:DeleteVectors',
                ];
                for (const action of all_actions) {
                    const policy = make_policy({
                        action,
                        resource: `arn:aws:s3vectors:::${VECTOR_BUCKET_NAME}`,
                    });
                    await expect(
                        access_policy_utils.validate_vector_bucket_policy(policy, VECTOR_BUCKET_NAME, account_handler_allow_all)
                    ).resolves.toBeUndefined();
                }
            });

            it('should accept a Deny statement with NotPrincipal', async () => {
                const policy = make_policy({
                    effect: 'Deny',
                    action: 's3vectors:PutVectors',
                    resource: `arn:aws:s3vectors:::${VECTOR_BUCKET_NAME}`,
                });
                policy.Statement[0].NotPrincipal = { AWS: '*' };
                delete policy.Statement[0].Principal;
                await expect(
                    access_policy_utils.validate_vector_bucket_policy(policy, VECTOR_BUCKET_NAME, account_handler_allow_all)
                ).resolves.toBeUndefined();
            });

            it('should accept a valid vector condition key', async () => {
                const policy = make_policy({
                    action: 's3vectors:CreateVectorBucket',
                    resource: `arn:aws:s3vectors:::${VECTOR_BUCKET_NAME}`,
                    condition: { StringEquals: { 's3vectors:sseType': 'AES256' } },
                });
                await expect(
                    access_policy_utils.validate_vector_bucket_policy(policy, VECTOR_BUCKET_NAME, account_handler_allow_all)
                ).resolves.toBeUndefined();
            });

            it('should accept the kmsKeyArn condition key', async () => {
                const policy = make_policy({
                    action: 's3vectors:CreateVectorBucket',
                    resource: `arn:aws:s3vectors:::${VECTOR_BUCKET_NAME}`,
                    condition: { StringEquals: { 's3vectors:kmsKeyArn': 'arn:aws:kms:us-east-1:123456789:key/abc' } },
                });
                await expect(
                    access_policy_utils.validate_vector_bucket_policy(policy, VECTOR_BUCKET_NAME, account_handler_allow_all)
                ).resolves.toBeUndefined();
            });

            it('should accept a resource with wildcard matching the vector bucket', async () => {
                const policy = make_policy({
                    action: 's3vectors:PutVectors',
                    resource: 'arn:aws:s3vectors:::test-*',
                });
                await expect(
                    access_policy_utils.validate_vector_bucket_policy(policy, VECTOR_BUCKET_NAME, account_handler_allow_all)
                ).resolves.toBeUndefined();
            });
        });

        describe('invalid actions', () => {
            it('should reject an s3 action in a vector bucket policy', async () => {
                const policy = make_policy({
                    action: 's3:GetObject',
                    resource: `arn:aws:s3vectors:::${VECTOR_BUCKET_NAME}`,
                });
                await expect_malformed_policy(() =>
                    access_policy_utils.validate_vector_bucket_policy(policy, VECTOR_BUCKET_NAME, account_handler_allow_all)
                );
            });

            it('should reject s3:* wildcard in a vector bucket policy', async () => {
                const policy = make_policy({
                    action: 's3:*',
                    resource: `arn:aws:s3vectors:::${VECTOR_BUCKET_NAME}`,
                });
                await expect_malformed_policy(() =>
                    access_policy_utils.validate_vector_bucket_policy(policy, VECTOR_BUCKET_NAME, account_handler_allow_all)
                );
            });

            it('should reject a completely invalid action', async () => {
                const policy = make_policy({
                    action: 'ec2:RunInstances',
                    resource: `arn:aws:s3vectors:::${VECTOR_BUCKET_NAME}`,
                });
                await expect_malformed_policy(() =>
                    access_policy_utils.validate_vector_bucket_policy(policy, VECTOR_BUCKET_NAME, account_handler_allow_all)
                );
            });

            it('should reject a made-up s3vectors action', async () => {
                const policy = make_policy({
                    action: 's3vectors:FooBar',
                    resource: `arn:aws:s3vectors:::${VECTOR_BUCKET_NAME}`,
                });
                await expect_malformed_policy(() =>
                    access_policy_utils.validate_vector_bucket_policy(policy, VECTOR_BUCKET_NAME, account_handler_allow_all)
                );
            });
        });

        describe('invalid resources', () => {
            it('should reject a resource that does not match the vector bucket name', async () => {
                const policy = make_policy({
                    action: 's3vectors:PutVectors',
                    resource: 'arn:aws:s3vectors:::other-bucket',
                });
                await expect_malformed_policy(() =>
                    access_policy_utils.validate_vector_bucket_policy(policy, VECTOR_BUCKET_NAME, account_handler_allow_all)
                );
            });

            it('should reject an s3 ARN resource in a vector bucket policy', async () => {
                const policy = make_policy({
                    action: 's3vectors:PutVectors',
                    resource: `arn:aws:s3:::${VECTOR_BUCKET_NAME}`,
                });
                await expect_malformed_policy(() =>
                    access_policy_utils.validate_vector_bucket_policy(policy, VECTOR_BUCKET_NAME, account_handler_allow_all)
                );
            });

            it('should reject a malformed resource with brackets', async () => {
                const policy = make_policy({
                    action: 's3vectors:PutVectors',
                    resource: `arn:aws:s3vectors:::${VECTOR_BUCKET_NAME}[bad]`,
                });
                await expect_malformed_policy(() =>
                    access_policy_utils.validate_vector_bucket_policy(policy, VECTOR_BUCKET_NAME, account_handler_allow_all)
                );
            });
        });

        describe('invalid principals', () => {
            it('should reject an Allow statement with NotPrincipal', async () => {
                const policy = make_policy({
                    effect: 'Allow',
                    action: 's3vectors:PutVectors',
                    resource: `arn:aws:s3vectors:::${VECTOR_BUCKET_NAME}`,
                });
                policy.Statement[0].NotPrincipal = { AWS: '*' };
                delete policy.Statement[0].Principal;
                await expect_malformed_policy(() =>
                    access_policy_utils.validate_vector_bucket_policy(policy, VECTOR_BUCKET_NAME, account_handler_allow_all)
                );
            });

            it('should reject a non-wildcard principal that does not exist', async () => {
                const policy = make_policy({
                    principal: { AWS: 'arn:aws:iam::123456789:root' },
                    action: 's3vectors:PutVectors',
                    resource: `arn:aws:s3vectors:::${VECTOR_BUCKET_NAME}`,
                });
                await expect_malformed_policy(() =>
                    access_policy_utils.validate_vector_bucket_policy(policy, VECTOR_BUCKET_NAME, account_handler_deny_all)
                );
            });
        });

        describe('invalid conditions', () => {
            it('should reject an s3 condition key in a vector bucket policy', async () => {
                const policy = make_policy({
                    action: 's3vectors:CreateVectorBucket',
                    resource: `arn:aws:s3vectors:::${VECTOR_BUCKET_NAME}`,
                    condition: { StringEquals: { 's3:x-amz-server-side-encryption': 'AES256' } },
                });
                await expect_malformed_policy(() =>
                    access_policy_utils.validate_vector_bucket_policy(policy, VECTOR_BUCKET_NAME, account_handler_allow_all)
                );
            });

            it('should reject an unsupported condition key', async () => {
                const policy = make_policy({
                    action: 's3vectors:CreateVectorBucket',
                    resource: `arn:aws:s3vectors:::${VECTOR_BUCKET_NAME}`,
                    condition: { StringEquals: { 'aws:SourceIp': '10.0.0.0/8' } },
                });
                await expect_malformed_policy(() =>
                    access_policy_utils.validate_vector_bucket_policy(policy, VECTOR_BUCKET_NAME, account_handler_allow_all)
                );
            });
        });
    });

    describe('cross-validation (s3 vs s3vectors boundaries)', () => {
        it('should not accept s3vectors actions in s3 bucket policy', async () => {
            const policy = make_policy({
                action: ['s3:GetObject', 's3vectors:PutVectors'],
                resource: `arn:aws:s3:::${BUCKET_NAME}/*`,
            });
            await expect_malformed_policy(() =>
                access_policy_utils.validate_bucket_policy(policy, BUCKET_NAME, account_handler_allow_all)
            );
        });

        it('should not accept s3 actions in vector bucket policy', async () => {
            const policy = make_policy({
                action: ['s3vectors:PutVectors', 's3:GetObject'],
                resource: `arn:aws:s3vectors:::${VECTOR_BUCKET_NAME}`,
            });
            await expect_malformed_policy(() =>
                access_policy_utils.validate_vector_bucket_policy(policy, VECTOR_BUCKET_NAME, account_handler_allow_all)
            );
        });

        it('s3 resource ARN should not be valid for vector policy', async () => {
            const policy = make_policy({
                action: 's3vectors:PutVectors',
                resource: `arn:aws:s3:::${VECTOR_BUCKET_NAME}`,
            });
            await expect_malformed_policy(() =>
                access_policy_utils.validate_vector_bucket_policy(policy, VECTOR_BUCKET_NAME, account_handler_allow_all)
            );
        });

        it('s3vectors resource ARN should not be valid for s3 policy', async () => {
            const policy = make_policy({
                action: 's3:GetObject',
                resource: `arn:aws:s3vectors:::${BUCKET_NAME}`,
            });
            await expect_malformed_policy(() =>
                access_policy_utils.validate_bucket_policy(policy, BUCKET_NAME, account_handler_allow_all)
            );
        });
    });

    describe('aws:SourceIp condition evaluation', () => {
        /**
         * Build a minimal fake req object with the given IP address.
         * _is_source_ip_fit reads req.socket.remoteAddress directly — X-Forwarded-For
         * is intentionally ignored as it is client-controlled.
         */
        function make_req(ip) {
            return {
                headers: {},
                socket: { remoteAddress: ip },
                query: {},
                params: {},
            };
        }

        /** Build a minimal policy statement for has_access_policy_permission */
        function make_ip_statement({ effect = 'Allow', operator, ips }) {
            return {
                Version: '2012-10-17',
                Statement: [{
                    Effect: effect,
                    Principal: '*',
                    Action: 's3:GetObject',
                    Resource: `arn:aws:s3:::${BUCKET_NAME}/*`,
                    Condition: { [operator]: { 'aws:SourceIp': ips } },
                }],
            };
        }

        describe('IpAddress operator — CIDR matching', () => {
            it('should ALLOW when client IP is in the allowed CIDR', async () => {
                const policy = make_ip_statement({ operator: 'IpAddress', ips: '192.0.2.0/24' });
                const result = await access_policy_utils.has_access_policy_permission(
                    policy, '*', 's3:GetObject',
                    `arn:aws:s3:::${BUCKET_NAME}/obj`, make_req('192.0.2.100')
                );
                expect(result).toBe('ALLOW');
            });

            it('should IMPLICIT_DENY when client IP is outside the allowed CIDR', async () => {
                const policy = make_ip_statement({ operator: 'IpAddress', ips: '192.0.2.0/24' });
                const result = await access_policy_utils.has_access_policy_permission(
                    policy, '*', 's3:GetObject',
                    `arn:aws:s3:::${BUCKET_NAME}/obj`, make_req('10.0.0.1')
                );
                expect(result).toBe('IMPLICIT_DENY');
            });

            it('should ALLOW when client IP matches one of multiple CIDRs', async () => {
                const policy = make_ip_statement({ operator: 'IpAddress', ips: ['10.0.0.0/8', '192.0.2.0/24'] });
                const result = await access_policy_utils.has_access_policy_permission(
                    policy, '*', 's3:GetObject',
                    `arn:aws:s3:::${BUCKET_NAME}/obj`, make_req('10.1.2.3')
                );
                expect(result).toBe('ALLOW');
            });

            it('should IMPLICIT_DENY when client IP matches none of the CIDRs', async () => {
                const policy = make_ip_statement({ operator: 'IpAddress', ips: ['10.0.0.0/8', '192.0.2.0/24'] });
                const result = await access_policy_utils.has_access_policy_permission(
                    policy, '*', 's3:GetObject',
                    `arn:aws:s3:::${BUCKET_NAME}/obj`, make_req('172.16.0.1')
                );
                expect(result).toBe('IMPLICIT_DENY');
            });

            it('should ALLOW when client IP matches an exact IP entry', async () => {
                const policy = make_ip_statement({ operator: 'IpAddress', ips: '203.0.113.5' });
                const result = await access_policy_utils.has_access_policy_permission(
                    policy, '*', 's3:GetObject',
                    `arn:aws:s3:::${BUCKET_NAME}/obj`, make_req('203.0.113.5')
                );
                expect(result).toBe('ALLOW');
            });
        });

        describe('NotIpAddress operator', () => {
            it('should ALLOW when client IP is outside the excluded CIDR', async () => {
                const policy = make_ip_statement({ operator: 'NotIpAddress', ips: '192.0.2.0/24' });
                const result = await access_policy_utils.has_access_policy_permission(
                    policy, '*', 's3:GetObject',
                    `arn:aws:s3:::${BUCKET_NAME}/obj`, make_req('10.0.0.1')
                );
                expect(result).toBe('ALLOW');
            });

            it('should IMPLICIT_DENY when client IP is inside the excluded CIDR', async () => {
                const policy = make_ip_statement({ operator: 'NotIpAddress', ips: '192.0.2.0/24' });
                const result = await access_policy_utils.has_access_policy_permission(
                    policy, '*', 's3:GetObject',
                    `arn:aws:s3:::${BUCKET_NAME}/obj`, make_req('192.0.2.50')
                );
                expect(result).toBe('IMPLICIT_DENY');
            });
        });

        describe('Deny + IpAddress (block unless in range)', () => {
            it('should DENY when client IP is outside the allowed range', async () => {
                const policy = {
                    Version: '2012-10-17',
                    Statement: [
                        {
                            Effect: 'Allow',
                            Principal: '*',
                            Action: 's3:GetObject',
                            Resource: `arn:aws:s3:::${BUCKET_NAME}/*`,
                        },
                        {
                            Effect: 'Deny',
                            Principal: '*',
                            Action: 's3:GetObject',
                            Resource: `arn:aws:s3:::${BUCKET_NAME}/*`,
                            Condition: { NotIpAddress: { 'aws:SourceIp': '192.0.2.0/24' } },
                        },
                    ],
                };
                const result = await access_policy_utils.has_access_policy_permission(
                    policy, '*', 's3:GetObject',
                    `arn:aws:s3:::${BUCKET_NAME}/obj`, make_req('10.0.0.1')
                );
                expect(result).toBe('DENY');
            });

            it('should ALLOW when client IP is inside the allowed range', async () => {
                const policy = {
                    Version: '2012-10-17',
                    Statement: [
                        {
                            Effect: 'Allow',
                            Principal: '*',
                            Action: 's3:GetObject',
                            Resource: `arn:aws:s3:::${BUCKET_NAME}/*`,
                        },
                        {
                            Effect: 'Deny',
                            Principal: '*',
                            Action: 's3:GetObject',
                            Resource: `arn:aws:s3:::${BUCKET_NAME}/*`,
                            Condition: { NotIpAddress: { 'aws:SourceIp': '192.0.2.0/24' } },
                        },
                    ],
                };
                const result = await access_policy_utils.has_access_policy_permission(
                    policy, '*', 's3:GetObject',
                    `arn:aws:s3:::${BUCKET_NAME}/obj`, make_req('192.0.2.77')
                );
                expect(result).toBe('ALLOW');
            });
        });

        describe('IPv6-mapped IPv4 normalisation', () => {
            it('should ALLOW when client uses IPv6-mapped IPv4 address inside the CIDR', async () => {
                const policy = make_ip_statement({ operator: 'IpAddress', ips: '192.0.2.0/24' });
                const result = await access_policy_utils.has_access_policy_permission(
                    policy, '*', 's3:GetObject',
                    `arn:aws:s3:::${BUCKET_NAME}/obj`, make_req('::ffff:192.0.2.100')
                );
                expect(result).toBe('ALLOW');
            });

            it('should IMPLICIT_DENY when client uses IPv6-mapped IPv4 address outside the CIDR', async () => {
                const policy = make_ip_statement({ operator: 'IpAddress', ips: '192.0.2.0/24' });
                const result = await access_policy_utils.has_access_policy_permission(
                    policy, '*', 's3:GetObject',
                    `arn:aws:s3:::${BUCKET_NAME}/obj`, make_req('::ffff:10.0.0.1')
                );
                expect(result).toBe('IMPLICIT_DENY');
            });
        });

        describe('native IPv6', () => {
            it('should ALLOW when client IPv6 address is inside an IPv6 CIDR', async () => {
                const policy = make_ip_statement({ operator: 'IpAddress', ips: '2001:db8::/32' });
                const result = await access_policy_utils.has_access_policy_permission(
                    policy, '*', 's3:GetObject',
                    `arn:aws:s3:::${BUCKET_NAME}/obj`, make_req('2001:db8::1')
                );
                expect(result).toBe('ALLOW');
            });

            it('should IMPLICIT_DENY when client IPv6 address is outside the IPv6 CIDR', async () => {
                const policy = make_ip_statement({ operator: 'IpAddress', ips: '2001:db8::/32' });
                const result = await access_policy_utils.has_access_policy_permission(
                    policy, '*', 's3:GetObject',
                    `arn:aws:s3:::${BUCKET_NAME}/obj`, make_req('2001:db9::1')
                );
                expect(result).toBe('IMPLICIT_DENY');
            });

            it('should ALLOW exact IPv6 address match', async () => {
                const policy = make_ip_statement({ operator: 'IpAddress', ips: '2001:db8::1' });
                const result = await access_policy_utils.has_access_policy_permission(
                    policy, '*', 's3:GetObject',
                    `arn:aws:s3:::${BUCKET_NAME}/obj`, make_req('2001:db8::1')
                );
                expect(result).toBe('ALLOW');
            });

            it('should IMPLICIT_DENY when IPv6 client is tested against an IPv4 CIDR', async () => {
                // Different address families never match — an IPv6 client is not inside an IPv4 range.
                const policy = make_ip_statement({ operator: 'IpAddress', ips: '192.0.2.0/24' });
                const result = await access_policy_utils.has_access_policy_permission(
                    policy, '*', 's3:GetObject',
                    `arn:aws:s3:::${BUCKET_NAME}/obj`, make_req('2001:db8::1')
                );
                expect(result).toBe('IMPLICIT_DENY');
            });

            it('should IMPLICIT_DENY when IPv4 client is tested against an IPv6 CIDR', async () => {
                // Inverse of above — IPv4 client is not inside an IPv6 range.
                const policy = make_ip_statement({ operator: 'IpAddress', ips: '2001:db8::/32' });
                const result = await access_policy_utils.has_access_policy_permission(
                    policy, '*', 's3:GetObject',
                    `arn:aws:s3:::${BUCKET_NAME}/obj`, make_req('192.0.2.1')
                );
                expect(result).toBe('IMPLICIT_DENY');
            });

            it('should ALLOW for NotIpAddress when IPv6 client is outside the excluded range', async () => {
                const policy = make_ip_statement({ operator: 'NotIpAddress', ips: '2001:db8::/32' });
                const result = await access_policy_utils.has_access_policy_permission(
                    policy, '*', 's3:GetObject',
                    `arn:aws:s3:::${BUCKET_NAME}/obj`, make_req('2001:db9::1')
                );
                expect(result).toBe('ALLOW');
            });

            it('should IMPLICIT_DENY for NotIpAddress when IPv6 client is inside the excluded range', async () => {
                const policy = make_ip_statement({ operator: 'NotIpAddress', ips: '2001:db8::/32' });
                const result = await access_policy_utils.has_access_policy_permission(
                    policy, '*', 's3:GetObject',
                    `arn:aws:s3:::${BUCKET_NAME}/obj`, make_req('2001:db8::ff')
                );
                expect(result).toBe('IMPLICIT_DENY');
            });
        });

        describe('X-Forwarded-For spoofing resistance', () => {
            it('should IMPLICIT_DENY when client forges X-Forwarded-For to appear inside the CIDR but real TCP IP is outside', async () => {
                const policy = make_ip_statement({ operator: 'IpAddress', ips: '192.0.2.0/24' });
                // Client is actually at 10.0.0.1 but sends a spoofed header claiming 192.0.2.1
                const req = {
                    headers: { 'x-forwarded-for': '192.0.2.1' },
                    socket: { remoteAddress: '10.0.0.1' },
                    query: {},
                    params: {},
                };
                const result = await access_policy_utils.has_access_policy_permission(
                    policy, '*', 's3:GetObject',
                    `arn:aws:s3:::${BUCKET_NAME}/obj`, req
                );
                expect(result).toBe('IMPLICIT_DENY');
            });

            it('should ALLOW when real TCP IP is inside the CIDR regardless of X-Forwarded-For', async () => {
                const policy = make_ip_statement({ operator: 'IpAddress', ips: '192.0.2.0/24' });
                // Client is legitimately at 192.0.2.50 but also sends a forwarded header
                const req = {
                    headers: { 'x-forwarded-for': '10.0.0.1' },
                    socket: { remoteAddress: '192.0.2.50' },
                    query: {},
                    params: {},
                };
                const result = await access_policy_utils.has_access_policy_permission(
                    policy, '*', 's3:GetObject',
                    `arn:aws:s3:::${BUCKET_NAME}/obj`, req
                );
                expect(result).toBe('ALLOW');
            });
        });

        describe('missing client IP', () => {
            // An absent remoteAddress is treated as '' which matches no range.
            // Behaviour per Effect+operator:
            //   Allow  + IpAddress    → condition false → Allow skipped  → IMPLICIT_DENY
            //   Deny   + IpAddress    → condition false → Deny skipped   → (Allow elsewhere decides)
            //   Allow  + NotIpAddress → condition true  → Allow fires    → ALLOW
            //   Deny   + NotIpAddress → condition true  → Deny fires     → DENY
            it('should IMPLICIT_DENY for Allow+IpAddress when socket has no remoteAddress', async () => {
                const policy = make_ip_statement({ operator: 'IpAddress', ips: '192.0.2.0/24' });
                const req = { headers: {}, socket: {}, query: {}, params: {} };
                const result = await access_policy_utils.has_access_policy_permission(
                    policy, '*', 's3:GetObject',
                    `arn:aws:s3:::${BUCKET_NAME}/obj`, req
                );
                expect(result).toBe('IMPLICIT_DENY');
            });

            it('should ALLOW for Allow+NotIpAddress when socket has no remoteAddress', async () => {
                const policy = make_ip_statement({ operator: 'NotIpAddress', ips: '192.0.2.0/24' });
                const req = { headers: {}, socket: {}, query: {}, params: {} };
                const result = await access_policy_utils.has_access_policy_permission(
                    policy, '*', 's3:GetObject',
                    `arn:aws:s3:::${BUCKET_NAME}/obj`, req
                );
                expect(result).toBe('ALLOW');
            });

            it('should DENY for Deny+NotIpAddress when socket has no remoteAddress', async () => {
                const policy = {
                    Version: '2012-10-17',
                    Statement: [
                        {
                            Effect: 'Allow',
                            Principal: '*',
                            Action: 's3:GetObject',
                            Resource: `arn:aws:s3:::${BUCKET_NAME}/*`,
                        },
                        {
                            Effect: 'Deny',
                            Principal: '*',
                            Action: 's3:GetObject',
                            Resource: `arn:aws:s3:::${BUCKET_NAME}/*`,
                            Condition: { NotIpAddress: { 'aws:SourceIp': '192.0.2.0/24' } },
                        },
                    ],
                };
                const req = { headers: {}, socket: {}, query: {}, params: {} };
                const result = await access_policy_utils.has_access_policy_permission(
                    policy, '*', 's3:GetObject',
                    `arn:aws:s3:::${BUCKET_NAME}/obj`, req
                );
                expect(result).toBe('DENY');
            });
        });
    });
});
