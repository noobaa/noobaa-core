/* Copyright (C) 2016 NooBaa */
/* eslint-disable max-lines-per-function */
'use strict';

const SensitiveString = require('../../../util/sensitive_string');
const s3_rest = require('../../../endpoint/s3/s3_rest');
const access_policy_utils = require('../../../util/access_policy_utils');
const iam_utils = require('../../../endpoint/iam/iam_utils');
const { S3Error } = require('../../../endpoint/s3/s3_errors');

const {
    _has_bypass_governance_permission,
    authorize_bypass_governance_if_requested,
    _get_method_from_req,
} = s3_rest.__testing;

describe('s3_rest bypass governance authorization', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('_get_method_from_req', () => {
        it('does not append BypassGovernanceRetention to the API action', () => {
            const method = _get_method_from_req({
                op_name: 'delete_object',
                query: { versionId: 'v1' },
                headers: { 'x-amz-bypass-governance-retention': 'true' },
            });
            expect(method).toBe('s3:DeleteObjectVersion');
            expect(method).not.toEqual(
                expect.arrayContaining([access_policy_utils.BYPASS_GOVERNANCE_RETENTION_ACTION])
            );
        });
    });

    describe('_has_bypass_governance_permission', () => {
        function make_req({ account, policy, iam_result, stash_policy = true } = {}) {
            jest.spyOn(iam_utils, 'authorize_request_iam_policy_impl')
                .mockResolvedValue(iam_result);

            const policy_info = {
                s3_policy: policy,
                system_owner: new SensitiveString('system@example.com'),
                bucket_owner: new SensitiveString('owner@example.com'),
                owner_account: { id: 'owner-id' },
                public_access_block: undefined,
            };
            const read_bucket_sdk_policy_info = jest.fn().mockResolvedValue(policy_info);
            const req = {
                params: { bucket: 'bkt', key: 'obj' },
                object_sdk: {
                    requesting_account: account,
                    nsfs_config_root: undefined,
                    read_bucket_sdk_policy_info,
                },
            };
            // Prefer stashed info from authorize_request_policy (production path).
            if (stash_policy) req._bucket_sdk_policy_info = policy_info;
            return req;
        }

        it('allows hosted root account without Bypass in policy', async () => {
            const req = make_req({
                account: {
                    email: new SensitiveString('root@example.com'),
                    // root: no owner field
                },
                iam_result: undefined,
                policy: null,
            });
            await expect(_has_bypass_governance_permission(req)).resolves.toBe(true);
        });

        it('allows when IAM grants Bypass even if bucket policy does not', async () => {
            const req = make_req({
                account: {
                    email: new SensitiveString('user@example.com'),
                    owner: 'root-id',
                    _id: 'iam-user-id',
                    name: new SensitiveString('iam-user'),
                },
                iam_result: true,
                policy: {
                    Statement: [{
                        Effect: 'Allow',
                        Principal: { AWS: '*' },
                        Action: ['s3:DeleteObjectVersion'],
                        Resource: ['arn:aws:s3:::bkt/*'],
                    }],
                },
            });
            await expect(_has_bypass_governance_permission(req)).resolves.toBe(true);
            expect(iam_utils.authorize_request_iam_policy_impl).toHaveBeenCalledWith(
                req,
                access_policy_utils.BYPASS_GOVERNANCE_RETENTION_ACTION,
                'bkt',
                's3'
            );
            // IAM allow short-circuits before reading/using bucket policy again
            expect(req.object_sdk.read_bucket_sdk_policy_info).not.toHaveBeenCalled();
        });

        it('reuses stashed bucket policy info and does not re-read', async () => {
            const req = make_req({
                account: {
                    email: new SensitiveString('user@example.com'),
                    owner: 'root-id',
                    _id: 'iam-user-id',
                    name: new SensitiveString('iam-user'),
                },
                iam_result: { account: {}, resource_arn: 'arn:aws:s3:::bkt/obj' },
                policy: {
                    Statement: [{
                        Effect: 'Allow',
                        Principal: { AWS: '*' },
                        Action: ['s3:BypassGovernanceRetention'],
                        Resource: ['arn:aws:s3:::bkt/*'],
                    }],
                },
            });
            jest.spyOn(access_policy_utils, 'get_account_identifier_id').mockReturnValue('iam-user-id');
            jest.spyOn(access_policy_utils, 'get_policy_principal_arn')
                .mockReturnValue('arn:aws:iam::root-id:user/iam-user');
            jest.spyOn(access_policy_utils, 'has_access_policy_permission')
                .mockResolvedValue('ALLOW');

            await expect(_has_bypass_governance_permission(req)).resolves.toBe(true);
            expect(req.object_sdk.read_bucket_sdk_policy_info).not.toHaveBeenCalled();
        });

        it('allows when bucket policy grants Bypass and IAM only implicitly denies', async () => {
            const req = make_req({
                account: {
                    email: new SensitiveString('user@example.com'),
                    owner: 'root-id',
                    _id: 'iam-user-id',
                    name: new SensitiveString('iam-user'),
                },
                iam_result: {
                    account: {},
                    resource_arn: 'arn:aws:s3:::bkt/obj',
                    explicit_deny: false,
                },
                policy: {
                    Statement: [{
                        Effect: 'Allow',
                        Principal: { AWS: ['arn:aws:iam::root-id:user/iam-user', 'iam-user-id'] },
                        Action: ['s3:BypassGovernanceRetention'],
                        Resource: ['arn:aws:s3:::bkt/*'],
                    }],
                },
            });
            // Principal ARN helpers depend on account shape; stub policy eval instead.
            jest.spyOn(access_policy_utils, 'get_account_identifier_id').mockReturnValue('iam-user-id');
            jest.spyOn(access_policy_utils, 'get_policy_principal_arn')
                .mockReturnValue('arn:aws:iam::root-id:user/iam-user');
            jest.spyOn(access_policy_utils, 'has_access_policy_permission')
                .mockResolvedValue('ALLOW');

            await expect(_has_bypass_governance_permission(req)).resolves.toBe(true);
            expect(access_policy_utils.has_access_policy_permission).toHaveBeenCalledWith(
                expect.anything(),
                expect.anything(),
                access_policy_utils.BYPASS_GOVERNANCE_RETENTION_ACTION,
                expect.anything(),
                req,
                expect.anything()
            );
        });

        it('denies when IAM explicitly denies Bypass even if bucket policy allows', async () => {
            const req = make_req({
                account: {
                    email: new SensitiveString('user@example.com'),
                    owner: 'root-id',
                    _id: 'iam-user-id',
                    name: new SensitiveString('iam-user'),
                },
                iam_result: {
                    account: {},
                    resource_arn: 'arn:aws:s3:::bkt/obj',
                    explicit_deny: true,
                },
                policy: {
                    Statement: [{
                        Effect: 'Allow',
                        Principal: { AWS: '*' },
                        Action: ['s3:BypassGovernanceRetention'],
                        Resource: ['arn:aws:s3:::bkt/*'],
                    }],
                },
            });
            const has_policy = jest.spyOn(access_policy_utils, 'has_access_policy_permission');

            await expect(_has_bypass_governance_permission(req)).resolves.toBe(false);
            expect(has_policy).not.toHaveBeenCalled();
            expect(req.object_sdk.read_bucket_sdk_policy_info).not.toHaveBeenCalled();
        });

        it('denies non-owner IAM user when neither IAM nor bucket policy grants Bypass', async () => {
            const req = make_req({
                account: {
                    email: new SensitiveString('user@example.com'),
                    owner: 'root-id',
                    _id: 'iam-user-id',
                    name: new SensitiveString('iam-user'),
                },
                iam_result: { account: {}, resource_arn: 'arn:aws:s3:::bkt/obj' },
                policy: {
                    Statement: [{
                        Effect: 'Allow',
                        Principal: { AWS: '*' },
                        Action: ['s3:DeleteObjectVersion'],
                        Resource: ['arn:aws:s3:::bkt/*'],
                    }],
                },
            });
            jest.spyOn(access_policy_utils, 'get_account_identifier_id').mockReturnValue('iam-user-id');
            jest.spyOn(access_policy_utils, 'get_policy_principal_arn')
                .mockReturnValue('arn:aws:iam::root-id:user/iam-user');
            jest.spyOn(access_policy_utils, 'has_access_policy_permission')
                .mockResolvedValue('IMPLICIT_DENY');
            jest.spyOn(iam_utils, 'get_owner_account_id').mockReturnValue('root-id');
            jest.spyOn(access_policy_utils, 'create_arn_for_root')
                .mockReturnValue('arn:aws:iam::root-id:root');

            await expect(_has_bypass_governance_permission(req)).resolves.toBe(false);
        });

        it('denies non-owner IAM user when bucket has no policy and IAM lacks Bypass', async () => {
            const req = make_req({
                account: {
                    email: new SensitiveString('user@example.com'),
                    owner: 'root-id',
                    _id: 'iam-user-id',
                    name: new SensitiveString('iam-user'),
                },
                iam_result: { account: {}, resource_arn: 'arn:aws:s3:::bkt/obj' },
                policy: null,
            });
            await expect(_has_bypass_governance_permission(req)).resolves.toBe(false);
        });

        it('denies when bucket policy explicitly DENYs BypassGovernanceRetention', async () => {
            const req = make_req({
                account: {
                    email: new SensitiveString('user@example.com'),
                    owner: 'root-id',
                    _id: 'iam-user-id',
                    name: new SensitiveString('iam-user'),
                },
                iam_result: { account: {}, resource_arn: 'arn:aws:s3:::bkt/obj' },
                policy: {
                    Statement: [{
                        Effect: 'Deny',
                        Principal: { AWS: '*' },
                        Action: ['s3:BypassGovernanceRetention'],
                        Resource: ['arn:aws:s3:::bkt/*'],
                    }],
                },
            });
            jest.spyOn(access_policy_utils, 'get_account_identifier_id').mockReturnValue('iam-user-id');
            jest.spyOn(access_policy_utils, 'get_policy_principal_arn')
                .mockReturnValue('arn:aws:iam::root-id:user/iam-user');
            jest.spyOn(access_policy_utils, 'has_access_policy_permission')
                .mockResolvedValue('DENY');

            await expect(_has_bypass_governance_permission(req)).resolves.toBe(false);
            // Explicit DENY must not fall through to owner-principal ALLOW evaluation
            expect(access_policy_utils.has_access_policy_permission).toHaveBeenCalledTimes(1);
        });

        it('allows NC account with allow_bypass_governance', async () => {
            const req = make_req({
                account: {
                    email: new SensitiveString('nc@example.com'),
                    name: new SensitiveString('nc-user'),
                    nsfs_account_config: { allow_bypass_governance: true },
                },
                iam_result: undefined,
                policy: null,
            });
            req.object_sdk.nsfs_config_root = '/etc/noobaa.conf.d';
            await expect(_has_bypass_governance_permission(req)).resolves.toBe(true);
            expect(iam_utils.authorize_request_iam_policy_impl).not.toHaveBeenCalled();
        });

        it('denies NC account when allow_bypass_governance is false', async () => {
            const req = make_req({
                account: {
                    email: new SensitiveString('nc@example.com'),
                    name: new SensitiveString('nc-user'),
                    _id: 'owner-id',
                    nsfs_account_config: { allow_bypass_governance: false },
                },
                // Must not be treated as Bypass Allow for NC.
                iam_result: true,
                policy: {
                    Statement: [{
                        Effect: 'Allow',
                        Principal: { AWS: '*' },
                        Action: ['s3:BypassGovernanceRetention'],
                        Resource: ['arn:aws:s3:::bkt/*'],
                    }],
                },
            });
            req.object_sdk.nsfs_config_root = '/etc/noobaa.conf.d';
            await expect(_has_bypass_governance_permission(req)).resolves.toBe(false);
            expect(iam_utils.authorize_request_iam_policy_impl).not.toHaveBeenCalled();
        });
    });

    describe('authorize_bypass_governance_if_requested', () => {
        function make_iam_user_req({ policy, iam_result }) {
            jest.spyOn(iam_utils, 'authorize_request_iam_policy_impl')
                .mockResolvedValue(iam_result);
            jest.spyOn(access_policy_utils, 'get_account_identifier_id').mockReturnValue('iam-user-id');
            jest.spyOn(access_policy_utils, 'get_policy_principal_arn')
                .mockReturnValue('arn:aws:iam::root-id:user/iam-user');

            const policy_info = {
                s3_policy: policy,
                system_owner: new SensitiveString('system@example.com'),
                bucket_owner: new SensitiveString('owner@example.com'),
                owner_account: { id: 'owner-id' },
                public_access_block: undefined,
            };
            return {
                headers: { 'x-amz-bypass-governance-retention': 'true' },
                params: { bucket: 'bkt', key: 'obj' },
                op_name: 'delete_object',
                _bucket_sdk_policy_info: policy_info,
                object_sdk: {
                    requesting_account: {
                        email: new SensitiveString('user@example.com'),
                        owner: 'root-id',
                        _id: 'iam-user-id',
                        name: new SensitiveString('iam-user'),
                    },
                    nsfs_config_root: undefined,
                    read_bucket_sdk_policy_info: jest.fn().mockResolvedValue(policy_info),
                },
            };
        }

        it('no-ops when bypass header is absent', async () => {
            const req = {
                headers: {},
                params: { bucket: 'bkt' },
            };
            await expect(authorize_bypass_governance_if_requested(req)).resolves.toBeUndefined();
        });

        it('no-ops on NC so NamespaceFS can enforce allow_bypass_governance', async () => {
            const req = make_iam_user_req({
                policy: null,
                iam_result: {
                    account: {},
                    resource_arn: 'arn:aws:s3:::bkt/obj',
                    explicit_deny: false,
                },
            });
            req.object_sdk.nsfs_config_root = '/etc/noobaa.conf.d';
            req.object_sdk.requesting_account.nsfs_account_config = {
                allow_bypass_governance: false,
            };

            await expect(authorize_bypass_governance_if_requested(req)).resolves.toBeUndefined();
            expect(iam_utils.authorize_request_iam_policy_impl).not.toHaveBeenCalled();
        });

        it('throws AccessDenied when header is set and bucket has no policy (IAM lacks Bypass)', async () => {
            const req = make_iam_user_req({
                policy: null,
                iam_result: {
                    account: {},
                    resource_arn: 'arn:aws:s3:::bkt/obj',
                    explicit_deny: false,
                },
            });

            await expect(authorize_bypass_governance_if_requested(req)).rejects.toMatchObject({
                code: S3Error.AccessDenied.code,
                http_code: S3Error.AccessDenied.http_code,
            });
        });

        it('throws AccessDenied when IAM explicitly denies Bypass despite bucket Allow', async () => {
            const req = make_iam_user_req({
                policy: {
                    Statement: [{
                        Effect: 'Allow',
                        Principal: { AWS: '*' },
                        Action: ['s3:BypassGovernanceRetention'],
                        Resource: ['arn:aws:s3:::bkt/*'],
                    }],
                },
                iam_result: {
                    account: {},
                    resource_arn: 'arn:aws:s3:::bkt/obj',
                    explicit_deny: true,
                },
            });

            await expect(authorize_bypass_governance_if_requested(req)).rejects.toMatchObject({
                code: S3Error.AccessDenied.code,
                http_code: S3Error.AccessDenied.http_code,
            });
        });

        it('throws AccessDenied when bucket policy explicitly DENYs Bypass', async () => {
            const req = make_iam_user_req({
                policy: {
                    Statement: [{
                        Effect: 'Deny',
                        Principal: { AWS: '*' },
                        Action: ['s3:BypassGovernanceRetention'],
                        Resource: ['arn:aws:s3:::bkt/*'],
                    }],
                },
                iam_result: { account: {}, resource_arn: 'arn:aws:s3:::bkt/obj' },
            });
            jest.spyOn(access_policy_utils, 'has_access_policy_permission')
                .mockResolvedValue('DENY');

            await expect(authorize_bypass_governance_if_requested(req)).rejects.toMatchObject({
                code: S3Error.AccessDenied.code,
                http_code: S3Error.AccessDenied.http_code,
            });
        });

        it('throws AccessDenied when policy allows Delete but not Bypass', async () => {
            const req = make_iam_user_req({
                policy: {
                    Statement: [{
                        Effect: 'Allow',
                        Principal: { AWS: '*' },
                        Action: ['s3:DeleteObjectVersion'],
                        Resource: ['arn:aws:s3:::bkt/*'],
                    }],
                },
                iam_result: { account: {}, resource_arn: 'arn:aws:s3:::bkt/obj' },
            });
            jest.spyOn(access_policy_utils, 'has_access_policy_permission')
                .mockResolvedValue('IMPLICIT_DENY');
            jest.spyOn(iam_utils, 'get_owner_account_id').mockReturnValue('root-id');
            jest.spyOn(access_policy_utils, 'create_arn_for_root')
                .mockReturnValue('arn:aws:iam::root-id:root');

            await expect(authorize_bypass_governance_if_requested(req)).rejects.toMatchObject({
                code: S3Error.AccessDenied.code,
                http_code: S3Error.AccessDenied.http_code,
            });
        });
    });
});
