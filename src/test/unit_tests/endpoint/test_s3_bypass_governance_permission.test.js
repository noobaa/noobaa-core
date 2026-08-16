/* Copyright (C) 2016 NooBaa */
'use strict';

const SensitiveString = require('../../../util/sensitive_string');
const s3_rest = require('../../../endpoint/s3/s3_rest');
const access_policy_utils = require('../../../util/access_policy_utils');
const iam_utils = require('../../../endpoint/iam/iam_utils');

const {
    _has_bypass_governance_permission,
    _get_bypass_resource_arns,
} = s3_rest.__testing;

/**
 * Focused coverage for BypassGovernanceRetention authorization edges that are
 * awkward to assert through full S3 integration flows.
 */
describe('s3_rest BypassGovernanceRetention permission', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    function make_req({ account, policy, iam_result } = {}) {
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
            op_name: 'delete_object',
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

    it('denies when IAM explicitly denies even if bucket policy allows', async () => {
        const req = make_req({
            account: iam_user_account(),
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

        await expect(_has_bypass_governance_permission(req)).resolves.toBe(false);
    });

    it('denies when bucket policy explicitly denies even if IAM allows', async () => {
        const req = make_req({
            account: iam_user_account(),
            iam_result: true,
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
    });

    it('on NC ignores IAM stub Allow when non-owner has no bucket-policy Bypass', async () => {
        const req = make_req({
            account: {
                email: new SensitiveString('nc@example.com'),
                name: new SensitiveString('nc-user'),
                _id: 'nc-id',
            },
            iam_result: true,
            policy: null,
        });
        req.object_sdk.nsfs_config_root = '/etc/noobaa.conf.d';

        await expect(_has_bypass_governance_permission(req)).resolves.toBe(false);
        expect(iam_utils.authorize_request_iam_policy_impl).not.toHaveBeenCalled();
    });

    it('evaluates DeleteObjects Bypass against bucket and object-wildcard ARNs', async () => {
        const req = make_req({
            account: iam_user_account(),
            iam_result: { account: {}, resource_arn: 'arn:aws:s3:::bkt', explicit_deny: false },
            policy: {
                Statement: [{
                    Effect: 'Allow',
                    Principal: { AWS: '*' },
                    Action: ['s3:BypassGovernanceRetention'],
                    Resource: ['arn:aws:s3:::bkt/*'],
                }],
            },
        });
        req.params = { bucket: 'bkt' };
        req.op_name = 'post_bucket_delete';
        expect(_get_bypass_resource_arns(req)).toEqual([
            'arn:aws:s3:::bkt',
            'arn:aws:s3:::bkt/*',
        ]);

        jest.spyOn(access_policy_utils, 'get_account_identifier_id').mockReturnValue('iam-user-id');
        jest.spyOn(access_policy_utils, 'get_policy_principal_arn')
            .mockReturnValue('arn:aws:iam::root-id:user/iam-user');
        const policy_spy = jest.spyOn(access_policy_utils, 'has_access_policy_permission')
            .mockResolvedValueOnce('IMPLICIT_DENY')
            .mockResolvedValueOnce('ALLOW');

        await expect(_has_bypass_governance_permission(req)).resolves.toBe(true);
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

        await expect(_has_bypass_governance_permission(req)).resolves.toBe(false);
    });
});
