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

        describe('invalid conditions', () => {
            it('should reject an unsupported condition key', async () => {
                const policy = make_policy({
                    action: 's3:PutObject',
                    resource: `arn:aws:s3:::${BUCKET_NAME}/*`,
                    condition: { StringEquals: { 'aws:SourceIp': '10.0.0.0/8' } },
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
});
