/* Copyright (C) 2016 NooBaa */
'use strict';

const SensitiveString = require('../../../util/sensitive_string');
const s3_rest = require('../../../endpoint/s3/s3_rest');
const s3_utils = require('../../../endpoint/s3/s3_utils');
const access_policy_utils = require('../../../util/access_policy_utils');
const iam_utils = require('../../../endpoint/iam/iam_utils');
const { S3Error } = require('../../../endpoint/s3/s3_errors');

const {
    authorize_extra_s3_actions_if_requested,
    _has_additional_s3_action_permission,
    _get_extra_action_resource_arns,
} = s3_rest.__testing;

const BYPASS = access_policy_utils.BYPASS_GOVERNANCE_RETENTION_ACTION;
const LEGAL_HOLD = access_policy_utils.OP_NAME_TO_ACTION.put_object_legal_hold.regular;
const RETENTION = access_policy_utils.OP_NAME_TO_ACTION.put_object_retention.regular;

/**
 * Focused coverage for extra S3 action authorization (header/flag → permission).
 * Bypass, PutObjectLegalHold, and PutObjectRetention share the same evaluator.
 */
describe('s3_rest extra S3 action permission', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    function make_req({ account, policy, iam_result, op_name, headers } = {}) {
        jest.spyOn(iam_utils, 'authorize_request_iam_policy_impl')
            .mockResolvedValue(iam_result);

        const policy_info = {
            s3_policy: policy,
            system_owner: new SensitiveString('system@example.com'),
            bucket_owner: new SensitiveString('owner@example.com'),
            owner_account: { id: 'owner-id' },
            public_access_block: undefined,
        };
        return {
            params: { bucket: 'bkt', key: 'obj' },
            op_name: op_name || 'delete_object',
            headers: headers || {},
            _bucket_sdk_policy_info: policy_info,
            object_sdk: {
                requesting_account: account,
                nsfs_config_root: undefined,
                read_bucket_sdk_policy_info: jest.fn().mockResolvedValue(policy_info),
            },
        };
    }

    function iam_user_account() {
        return {
            email: new SensitiveString('user@example.com'),
            owner: 'root-id',
            _id: 'iam-user-id',
            name: new SensitiveString('iam-user'),
        };
    }

    function allow_policy(action) {
        return {
            Statement: [{
                Effect: 'Allow',
                Principal: { AWS: '*' },
                Action: [action],
                Resource: ['arn:aws:s3:::bkt/*'],
            }],
        };
    }

    it('maps Bypass, LegalHold, and Retention headers to extra actions', () => {
        const actions = access_policy_utils.EXTRA_S3_ACTION_TRIGGERS.map(trigger => trigger.action);
        expect(actions).toEqual([BYPASS, LEGAL_HOLD, RETENTION]);
        expect(s3_utils.is_bypass_governance_requested({
            headers: { 'x-amz-bypass-governance-retention': 'TRUE' },
        })).toBe(true);
        expect(s3_utils.is_object_lock_legal_hold_requested({
            headers: { 'x-amz-object-lock-legal-hold': 'ON' },
        })).toBe(true);
        expect(s3_utils.is_object_lock_retention_requested({
            headers: { 'x-amz-object-lock-mode': 'GOVERNANCE' },
        })).toBe(true);
    });

    it('denies when IAM explicitly denies even if bucket policy allows', async () => {
        const req = make_req({
            account: iam_user_account(),
            iam_result: {
                account: {},
                resource_arn: 'arn:aws:s3:::bkt/obj',
                explicit_deny: true,
            },
            policy: allow_policy(BYPASS),
        });

        await expect(_has_additional_s3_action_permission(req, BYPASS)).resolves.toBe(false);
    });

    it('denies when bucket policy explicitly denies even if IAM allows', async () => {
        const req = make_req({
            account: iam_user_account(),
            iam_result: true,
            policy: {
                Statement: [{
                    Effect: 'Deny',
                    Principal: { AWS: '*' },
                    Action: [BYPASS],
                    Resource: ['arn:aws:s3:::bkt/*'],
                }],
            },
        });
        jest.spyOn(access_policy_utils, 'get_account_identifier_id').mockReturnValue('iam-user-id');
        jest.spyOn(access_policy_utils, 'get_policy_principal_arn')
            .mockReturnValue('arn:aws:iam::root-id:user/iam-user');
        jest.spyOn(access_policy_utils, 'has_access_policy_permission')
            .mockResolvedValue('DENY');

        await expect(_has_additional_s3_action_permission(req, BYPASS)).resolves.toBe(false);
    });

    it('on NC allows extras for bucket owner without an IAM grant', async () => {
        const req = make_req({
            account: {
                email: new SensitiveString('nc-owner'),
                name: new SensitiveString('nc-owner'),
                _id: 'owner-id',
            },
            iam_result: {
                account: {},
                resource_arn: 'arn:aws:s3:::bkt/obj',
                explicit_deny: false,
            },
            policy: null,
        });
        req.object_sdk.nsfs_config_root = '/etc/noobaa.conf.d';

        await expect(_has_additional_s3_action_permission(req, BYPASS)).resolves.toBe(true);
        expect(iam_utils.authorize_request_iam_policy_impl).toHaveBeenCalled();
    });

    it('on NC allows extras from assumed-role IAM when there is no bucket policy', async () => {
        const req = make_req({
            account: {
                email: new SensitiveString('role-owner@example.com'),
                name: new SensitiveString('role-owner'),
                _id: 'role-owner-id',
            },
            iam_result: true,
            policy: null,
        });
        req.object_sdk.nsfs_config_root = '/etc/noobaa.conf.d';
        req.session_token = {
            assumed_role_access_key: 'AKIAASSUMED',
            assumed_role_arn: 'arn:aws:iam::root-id:role/lock-role',
        };

        await expect(_has_additional_s3_action_permission(req, BYPASS)).resolves.toBe(true);
        expect(iam_utils.authorize_request_iam_policy_impl).toHaveBeenCalledWith(
            req, BYPASS, 'bkt', 's3');
    });

    it('on NC allows extras from IAM when there is no bucket policy', async () => {
        const req = make_req({
            account: iam_user_account(),
            iam_result: true,
            policy: null,
        });
        req.object_sdk.nsfs_config_root = '/etc/noobaa.conf.d';

        await expect(_has_additional_s3_action_permission(req, BYPASS)).resolves.toBe(true);
        expect(iam_utils.authorize_request_iam_policy_impl).toHaveBeenCalledWith(
            req, BYPASS, 'bkt', 's3');
    });

    it('on NC denies extras when IAM does not Allow and there is no bucket policy', async () => {
        const req = make_req({
            account: iam_user_account(),
            iam_result: {
                account: {},
                resource_arn: 'arn:aws:s3:::bkt/obj',
                explicit_deny: false,
            },
            policy: null,
        });
        req.object_sdk.nsfs_config_root = '/etc/noobaa.conf.d';

        await expect(_has_additional_s3_action_permission(req, BYPASS)).resolves.toBe(false);
        expect(iam_utils.authorize_request_iam_policy_impl).toHaveBeenCalled();
    });

    it('on NC allows extras from bucket policy when IAM has no matching Allow', async () => {
        const req = make_req({
            account: iam_user_account(),
            iam_result: {
                account: {},
                resource_arn: 'arn:aws:s3:::bkt/obj',
                explicit_deny: false,
            },
            policy: allow_policy(BYPASS),
        });
        req.object_sdk.nsfs_config_root = '/etc/noobaa.conf.d';
        jest.spyOn(access_policy_utils, 'get_account_identifier_id').mockReturnValue('iam-user-id');
        jest.spyOn(access_policy_utils, 'has_access_policy_permission')
            .mockResolvedValue('ALLOW');

        await expect(_has_additional_s3_action_permission(req, BYPASS)).resolves.toBe(true);
    });

    it('on NC denies extras when IAM explicitly denies even if bucket policy allows', async () => {
        const req = make_req({
            account: iam_user_account(),
            iam_result: {
                account: {},
                resource_arn: 'arn:aws:s3:::bkt/obj',
                explicit_deny: true,
            },
            policy: allow_policy(BYPASS),
        });
        req.object_sdk.nsfs_config_root = '/etc/noobaa.conf.d';

        await expect(_has_additional_s3_action_permission(req, BYPASS)).resolves.toBe(false);
        expect(iam_utils.authorize_request_iam_policy_impl).toHaveBeenCalled();
    });

    it('evaluates DeleteObjects extra actions against bucket and object-wildcard ARNs', async () => {
        const req = make_req({
            account: iam_user_account(),
            iam_result: { account: {}, resource_arn: 'arn:aws:s3:::bkt', explicit_deny: false },
            policy: allow_policy(BYPASS),
        });
        req.params = { bucket: 'bkt' };
        req.op_name = 'post_bucket_delete';
        expect(_get_extra_action_resource_arns(req)).toEqual([
            'arn:aws:s3:::bkt',
            'arn:aws:s3:::bkt/*',
        ]);

        jest.spyOn(access_policy_utils, 'get_account_identifier_id').mockReturnValue('iam-user-id');
        jest.spyOn(access_policy_utils, 'get_policy_principal_arn')
            .mockReturnValue('arn:aws:iam::root-id:user/iam-user');
        const policy_spy = jest.spyOn(access_policy_utils, 'has_access_policy_permission')
            .mockResolvedValueOnce('IMPLICIT_DENY')
            .mockResolvedValueOnce('ALLOW');

        await expect(_has_additional_s3_action_permission(req, BYPASS)).resolves.toBe(true);
        expect(policy_spy.mock.calls.map(call => call[3])).toEqual([
            'arn:aws:s3:::bkt',
            'arn:aws:s3:::bkt/*',
        ]);
    });

    it('does not throw when bucket_owner is missing for a non-owner account', async () => {
        const req = make_req({
            account: {
                email: new SensitiveString('secondary@example.com'),
                _id: 'secondary-id',
            },
            iam_result: undefined,
            policy: null,
        });
        req._bucket_sdk_policy_info.bucket_owner = undefined;
        req._bucket_sdk_policy_info.owner_account = undefined;

        await expect(_has_additional_s3_action_permission(req, BYPASS)).resolves.toBe(false);
    });

    it('denies PutObject with legal-hold header without s3:PutObjectLegalHold', async () => {
        const req = make_req({
            account: iam_user_account(),
            iam_result: { account: {}, resource_arn: 'arn:aws:s3:::bkt/obj', explicit_deny: false },
            policy: null,
            op_name: 'put_object',
            headers: { 'x-amz-object-lock-legal-hold': 'ON' },
        });

        await expect(authorize_extra_s3_actions_if_requested(req))
            .rejects.toMatchObject({ code: S3Error.AccessDenied.code });
        expect(iam_utils.authorize_request_iam_policy_impl).toHaveBeenCalledWith(
            req, LEGAL_HOLD, 'bkt', 's3');
    });

    it('allows PutObject with legal-hold header when IAM grants PutObjectLegalHold', async () => {
        const req = make_req({
            account: iam_user_account(),
            iam_result: true,
            policy: null,
            op_name: 'put_object',
            headers: { 'x-amz-object-lock-legal-hold': 'ON' },
        });

        await expect(authorize_extra_s3_actions_if_requested(req)).resolves.toBeUndefined();
    });

    it('does not re-check PutObjectLegalHold when that action is already primary', async () => {
        const req = make_req({
            account: iam_user_account(),
            iam_result: { account: {}, resource_arn: 'arn:aws:s3:::bkt/obj', explicit_deny: false },
            policy: null,
            op_name: 'put_object_legal_hold',
            headers: { 'x-amz-object-lock-legal-hold': 'ON' },
        });

        await expect(authorize_extra_s3_actions_if_requested(req)).resolves.toBeUndefined();
        expect(iam_utils.authorize_request_iam_policy_impl).not.toHaveBeenCalled();
    });

    it('denies PutObject with retention headers without s3:PutObjectRetention', async () => {
        const req = make_req({
            account: iam_user_account(),
            iam_result: { account: {}, resource_arn: 'arn:aws:s3:::bkt/obj', explicit_deny: false },
            policy: null,
            op_name: 'put_object',
            headers: {
                'x-amz-object-lock-mode': 'GOVERNANCE',
                'x-amz-object-lock-retain-until-date': '2026-08-07T00:00:00Z',
            },
        });

        await expect(authorize_extra_s3_actions_if_requested(req))
            .rejects.toMatchObject({ code: S3Error.AccessDenied.code });
        expect(iam_utils.authorize_request_iam_policy_impl).toHaveBeenCalledWith(
            req, RETENTION, 'bkt', 's3');
    });

    it('does not extra-check PutObject when no lock headers are sent', async () => {
        const req = make_req({
            account: iam_user_account(),
            iam_result: { account: {}, resource_arn: 'arn:aws:s3:::bkt/obj', explicit_deny: false },
            policy: null,
            op_name: 'put_object',
        });

        await expect(authorize_extra_s3_actions_if_requested(req)).resolves.toBeUndefined();
        expect(iam_utils.authorize_request_iam_policy_impl).not.toHaveBeenCalled();
    });

    it('does not extra-check delete when the Bypass header is absent', async () => {
        const req = make_req({
            account: iam_user_account(),
            iam_result: { account: {}, resource_arn: 'arn:aws:s3:::bkt/obj', explicit_deny: false },
            policy: null,
            op_name: 'delete_object',
        });

        await expect(authorize_extra_s3_actions_if_requested(req)).resolves.toBeUndefined();
        expect(iam_utils.authorize_request_iam_policy_impl).not.toHaveBeenCalled();
    });
});
