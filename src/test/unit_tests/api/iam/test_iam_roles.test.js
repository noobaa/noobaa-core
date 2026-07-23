/* Copyright (C) 2024 NooBaa */
/* eslint-disable max-lines-per-function */
'use strict';

jest.mock('../../../../server/system_services/system_store', () => ({
    get_instance: jest.fn(() => ({ data: {} })),
}));

const system_store = require('../../../../server/system_services/system_store');
const iam_utils = require('../../../../endpoint/iam/iam_utils');
const iam_constants = require('../../../../endpoint/iam/iam_constants');
const { IamError } = require('../../../../endpoint/iam/iam_errors');
const iam_create_role_op = require('../../../../endpoint/iam/ops/iam_create_role');
const iam_get_role_op = require('../../../../endpoint/iam/ops/iam_get_role');
const iam_update_role_op = require('../../../../endpoint/iam/ops/iam_update_role');
const iam_delete_role_op = require('../../../../endpoint/iam/ops/iam_delete_role');
const iam_list_roles_op = require('../../../../endpoint/iam/ops/iam_list_roles');
const iam_put_role_policy_op = require('../../../../endpoint/iam/ops/iam_put_role_policy');
const iam_get_role_policy_op = require('../../../../endpoint/iam/ops/iam_get_role_policy');
const iam_delete_role_policy_op = require('../../../../endpoint/iam/ops/iam_delete_role_policy');
const iam_list_role_policies_op = require('../../../../endpoint/iam/ops/iam_list_role_policies');
const iam_update_assume_role_policy_op = require('../../../../endpoint/iam/ops/iam_update_assume_role_policy');

class NoErrorThrownError extends Error {}

describe('get_action_message_title - roles', () => {
    it('create_role', () => {
        const action = 'create_role';
        const res = iam_utils.get_action_message_title(action);
        expect(res).toBe(`iam:CreateRole`);
    });

    it('put_role_policy', () => {
        const action = 'put_role_policy';
        const res = iam_utils.get_action_message_title(action);
        expect(res).toBe(`iam:PutRolePolicy`);
    });
});

describe('create_arn_for_role', () => {
    const dummy_account_id = '12345678012';
    const dummy_role_name = 'TestRole';
    const dummy_iam_path = '/division_abc/subdivision_xyz/';
    const arn_prefix = 'arn:aws:iam::';

    it('create_arn_for_role without role_name should return basic structure', () => {
        const res = iam_utils.create_arn_for_role(dummy_account_id, undefined, undefined);
        expect(res).toBe(`${arn_prefix}${dummy_account_id}:role/`);
    });

    it('create_arn_for_role with role_name and no iam_path should return only role_name in arn', () => {
        const res = iam_utils.create_arn_for_role(dummy_account_id, dummy_role_name, undefined);
        expect(res).toBe(`${arn_prefix}${dummy_account_id}:role/${dummy_role_name}`);
    });

    it('create_arn_for_role with role_name and IAM_DEFAULT_PATH should return only role_name in arn', () => {
        const res = iam_utils.create_arn_for_role(dummy_account_id, dummy_role_name, iam_constants.IAM_DEFAULT_PATH);
        expect(res).toBe(`${arn_prefix}${dummy_account_id}:role/${dummy_role_name}`);
    });

    it('create_arn_for_role with role_name and iam_path should return them in arn', () => {
        const res = iam_utils.create_arn_for_role(dummy_account_id, dummy_role_name, dummy_iam_path);
        expect(res).toBe(`${arn_prefix}${dummy_account_id}:role${dummy_iam_path}${dummy_role_name}`);
    });
});

describe('parse_role_arn', () => {
    it('should parse account_id and role_name from a valid role ARN', () => {
        const res = iam_utils.parse_role_arn('arn:aws:iam::123456789012:role/TestRole');
        expect(res).toEqual({ account_id: '123456789012', role_name: 'TestRole' });
    });

    it('should return MISSING_ROLE_ARN when role_arn is empty', () => {
        expect(iam_utils.parse_role_arn('')).toEqual({ error: 'MISSING_ROLE_ARN' });
    });

    it('should return INVALID_ROLE_ARN when role_arn is malformed', () => {
        expect(iam_utils.parse_role_arn('not-an-arn')).toEqual({ error: 'INVALID_ROLE_ARN' });
    });
});

describe('resolve_iam_role_by_arn', () => {
    const account_id = '123456789012';
    const role_name = 'TestRole';
    const role_arn = `arn:aws:iam::${account_id}:role/${role_name}`;

    afterEach(() => {
        system_store.get_instance.mockReset();
        system_store.get_instance.mockReturnValue({ data: {} });
    });

    it('should return NO_SUCH_ROLE when role is not found', async () => {
        system_store.get_instance.mockReturnValue({ data: { iam_roles_by_owner: {} } });
        const res = await iam_utils.resolve_iam_role_by_arn(role_arn);
        expect(res).toEqual({ error: 'NO_SUCH_ROLE', account_id, role_name });
    });

    it('should return iam_role when role exists', async () => {
        const iam_role = { name: role_name };
        system_store.get_instance.mockReturnValue({
            data: { iam_roles_by_owner: { [account_id]: [iam_role] } },
        });
        const res = await iam_utils.resolve_iam_role_by_arn(role_arn);
        expect(res).toEqual({ iam_role, account_id, role_name });
    });
});

describe('input validation flow in IAM ops - IAM ROLES API', () => {
    const assume_role_policy = '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":"*"},"Action":"sts:AssumeRole"}]}';
    const role_name = 'TestRole';
    const policy_name = 's3-access';

    describe('iam_create_role', () => {
        let res;

        it('iam_create_role without required parameters (role_name) should throw error', async () => {
            try {
                await iam_create_role_op.handler({
                    body: { assume_role_policy_document: assume_role_policy },
                }, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err.message).toMatch(/required/i);
            }
        });

        it('iam_create_role with invalid role_name should throw error', async () => {
            try {
                await iam_create_role_op.handler({
                    body: {
                        role_name: 'bad/name',
                        assume_role_policy_document: assume_role_policy,
                    },
                }, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err.message).toMatch(/invalid/i);
            }
        });

        it('iam_create_role with invalid path should throw error', async () => {
            try {
                await iam_create_role_op.handler({
                    body: {
                        role_name,
                        path: 'abc',
                        assume_role_policy_document: assume_role_policy,
                    },
                }, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err.message).toMatch(/path/i);
            }
        });

        it('iam_create_role with malformed assume_role_policy_document should throw error', async () => {
            try {
                await iam_create_role_op.handler({
                    body: {
                        role_name,
                        assume_role_policy_document: '{bad-json',
                    },
                }, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.MalformedPolicyDocument.code);
            }
        });
    });

    describe('iam_get_role', () => {
        let res;

        it('iam_get_role with invalid role_name should throw error', async () => {
            try {
                await iam_get_role_op.handler({ body: { role_name: '' } }, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
            }
        });
    });

    describe('iam_update_role', () => {
        let res;

        it('iam_update_role with invalid max_session_duration should throw error', async () => {
            try {
                await iam_update_role_op.handler({
                    body: { role_name, max_session_duration: '100' },
                }, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err.message).toMatch(/3600|43200|constraint/i);
            }
        });
    });

    describe('iam_delete_role', () => {
        let res;

        it('iam_delete_role with invalid role_name should throw error', async () => {
            try {
                await iam_delete_role_op.handler({ body: { role_name: '' } }, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
            }
        });
    });

    describe('iam_list_roles', () => {
        let res;

        it('iam_list_roles with invalid path_prefix should throw error', async () => {
            try {
                await iam_list_roles_op.handler({ body: { path_prefix: 'abc/def' } }, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err.message).toMatch(/invalid/i);
            }
        });

        it('iam_list_roles with invalid max_items should throw error', async () => {
            try {
                await iam_list_roles_op.handler({ body: { max_items: 0 } }, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err.message).toMatch(/invalid/i);
            }
        });

        it('iam_list_roles with invalid marker should throw error', async () => {
            try {
                await iam_list_roles_op.handler({ body: { marker: '' } }, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err.message).toMatch(/length greater than/i);
            }
        });
    });

    describe('iam_put_role_policy', () => {
        let res;

        it('iam_put_role_policy without required parameters should throw error', async () => {
            try {
                await iam_put_role_policy_op.handler({
                    body: { role_name, policy_name },
                }, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err.message).toMatch(/required/i);
            }
        });

        it('iam_put_role_policy with Principal in policy_document should throw error', async () => {
            try {
                await iam_put_role_policy_op.handler({
                    body: {
                        role_name,
                        policy_name,
                        policy_document: assume_role_policy,
                    },
                }, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.MalformedPolicyDocument.code);
            }
        });
    });

    describe('iam_get_role_policy', () => {
        let res;

        it('iam_get_role_policy without required parameters should throw error', async () => {
            try {
                await iam_get_role_policy_op.handler({ body: { role_name } }, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err.message).toMatch(/required/i);
            }
        });
    });

    describe('iam_delete_role_policy', () => {
        let res;

        it('iam_delete_role_policy without required parameters should throw error', async () => {
            try {
                await iam_delete_role_policy_op.handler({ body: { role_name } }, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err.message).toMatch(/required/i);
            }
        });
    });

    describe('iam_list_role_policies', () => {
        let res;

        it('iam_list_role_policies without role_name should throw error', async () => {
            try {
                await iam_list_role_policies_op.handler({ body: {} }, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err.message).toMatch(/required/i);
            }
        });

        it('iam_list_role_policies with invalid max_items should throw error', async () => {
            try {
                await iam_list_role_policies_op.handler({
                    body: { role_name, max_items: 0 },
                }, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err.message).toMatch(/invalid/i);
            }
        });
    });

    describe('iam_update_assume_role_policy', () => {
        let res;

        it('iam_update_assume_role_policy without policy_document should throw error', async () => {
            try {
                await iam_update_assume_role_policy_op.handler({ body: { role_name } }, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err.message).toMatch(/required/i);
            }
        });

        it('iam_update_assume_role_policy with malformed policy_document should throw error', async () => {
            try {
                await iam_update_assume_role_policy_op.handler({
                    body: { role_name, policy_document: '{bad-json' },
                }, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.MalformedPolicyDocument.code);
            }
        });
    });
});

describe('success path in IAM ops - IAM ROLES API', () => {
    const role_name = 'SuccessRole';
    const policy_name = 'SuccessPolicy';
    const assume_role_policy = '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":"*"},"Action":"sts:AssumeRole"}]}';
    const identity_policy = '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"s3:*","Resource":"*"}]}';
    const role_reply = {
        role_id: 'role-id-1', role_name, arn: `arn:aws:iam::123:role/${role_name}`,
        iam_path: '/', create_date: 1, assume_role_policy_document: {}, max_session_duration: 3600,
    };
    const account_sdk = {
        create_role: jest.fn(async () => role_reply),
        get_role: jest.fn(async () => role_reply),
        update_role: jest.fn(),
        delete_role: jest.fn(),
        list_roles: jest.fn(async () => ({ members: [role_reply], is_truncated: false })),
        put_role_policy: jest.fn(),
        get_role_policy: jest.fn(async () => ({ role_name, policy_name, policy_document: identity_policy })),
        delete_role_policy: jest.fn(),
        list_role_policies: jest.fn(async () => ({ members: [policy_name], is_truncated: false })),
        update_assume_role_policy: jest.fn(),
    };
    const req = body => ({ account_sdk, request_id: 'r1', body });

    it('role ops call account_sdk and return reply', async () => {
        await iam_create_role_op.handler(req({ role_name, assume_role_policy_document: assume_role_policy }), {});
        await iam_get_role_op.handler(req({ role_name }), {});
        await iam_update_role_op.handler(req({ role_name, description: 'd', max_session_duration: '3600' }), {});
        await iam_list_roles_op.handler(req({}), {});
        await iam_put_role_policy_op.handler(req({ role_name, policy_name, policy_document: identity_policy }), {});
        await iam_get_role_policy_op.handler(req({ role_name, policy_name }), {});
        await iam_list_role_policies_op.handler(req({ role_name }), {});
        await iam_update_assume_role_policy_op.handler(req({ role_name, policy_document: assume_role_policy }), {});
        await iam_delete_role_policy_op.handler(req({ role_name, policy_name }), {});
        await iam_delete_role_op.handler(req({ role_name }), {});

        for (const fn of Object.values(account_sdk)) {
            expect(fn).toHaveBeenCalled();
        }
    });
});
