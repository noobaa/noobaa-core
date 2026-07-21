/* Copyright (C) 2024 NooBaa */
'use strict';

const { IamError } = require('../../../../endpoint/iam/iam_errors');
const iam_create_user_op = require('../../../../endpoint/iam/ops/iam_create_user');
const iam_get_user_op = require('../../../../endpoint/iam/ops/iam_get_user');
const iam_update_user_op = require('../../../../endpoint/iam/ops/iam_update_user');
const iam_delete_user_op = require('../../../../endpoint/iam/ops/iam_delete_user');
const iam_list_users_op = require('../../../../endpoint/iam/ops/iam_list_users');
const iam_create_access_key_op = require('../../../../endpoint/iam/ops/iam_create_access_key');
const iam_get_access_key_last_used_op = require('../../../../endpoint/iam/ops/iam_get_access_key_last_used');
const iam_update_access_key_op = require('../../../../endpoint/iam/ops/iam_update_access_key');
const iam_delete_access_key_op = require('../../../../endpoint/iam/ops/iam_delete_access_key');
const iam_list_access_keys_op = require('../../../../endpoint/iam/ops/iam_list_access_keys');
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

describe('input validation flow in IAM ops - IAM USERS API', () => {

    describe('iam_create_user', () => {
        let res;
        const username = 'Christopher';
        const iam_path = '/abc/def';

        it('iam_create_user without required parameters (username) should throw error', async () => {
            try {
                const req = {
                    body: {
                        // user_name is required
                        path: iam_path,
                    }
                };
                await iam_create_user_op.handler(req, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err).toHaveProperty('message');
                expect(err.message).toMatch(/required/i);
            }
        });

        it('iam_create_user with invalid username (below min length) should throw error', async () => {
            try {
                const invalid_username = '';
                const req = {
                    body: {
                        user_name: invalid_username,
                    }
                };
                await iam_create_user_op.handler(req, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err).toHaveProperty('message');
                expect(err.message).toMatch(/length/i);
            }
        });

        it('iam_create_user with invalid path (without / at the beginning and the end) should throw error', async () => {
            try {
                const invalid_iam_path = 'abc';
                const req = {
                    body: {
                        user_name: username,
                        path: invalid_iam_path,
                    }
                };
                await iam_create_user_op.handler(req, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err).toHaveProperty('message');
                expect(err.message).toMatch(/path/i);
            }
        });
    });

    describe('iam_get_user', () => {
        let res;

        it('iam_get_user with invalid username (internal invalid name) should throw error', async () => {
            try {
                const invalid_username = '.';
                const req = {
                    body: {
                        user_name: invalid_username,
                    }
                };
                await iam_get_user_op.handler(req, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err).toHaveProperty('message');
                expect(err.message).toMatch(/invalid/i);
            }
        });
    });

    describe('iam_update_user', () => {
        const username = 'Christopher';
        let res;
        it('iam_update_user without required parameters (username) should throw error', async () => {
            try {
                const req = {
                    body: {
                        // user_name is required
                        new_user_name: username,
                    }
                };
                await iam_update_user_op.handler(req, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err).toHaveProperty('message');
                expect(err.message).toMatch(/required/i);
            }
        });

        it('iam_update_user with invalid new username (less than min length) should throw error', async () => {
            try {
                const invalid_username = '';
                const req = {
                    body: {
                        new_user_name: invalid_username,
                        user_name: username
                    }
                };
                await iam_update_user_op.handler(req, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err).toHaveProperty('message');
                expect(err.message).toMatch(/length/i);
            }
        });

        it('iam_update_user with invalid new path (without / at the beginning and the end) should throw error', async () => {
            try {
                const invalid_iam_path = 'abc';
                const req = {
                    body: {
                        user_name: username,
                        new_path: invalid_iam_path,
                    }
                };
                await iam_update_user_op.handler(req, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err).toHaveProperty('message');
                expect(err.message).toMatch(/path/i);
            }
        });
    });

    describe('iam_delete_user', () => {
        const username = 'Christopher';
        let res;
        it('iam_delete_user without required parameters (username) should throw error', async () => {
            try {
                const req = {
                    body: {
                        // user_name is required
                    }
                };
                await iam_delete_user_op.handler(req, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err).toHaveProperty('message');
                expect(err.message).toMatch(/required/i);
            }
        });

        it('iam_delete_user with invalid username (more than max length) should throw error', async () => {
            try {
                const max_length = 64;
                const invalid_username = 'A'.repeat(max_length + 1);
                const req = {
                    body: {
                        new_user_name: invalid_username,
                        user_name: username
                    }
                };
                await iam_update_user_op.handler(req, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err).toHaveProperty('message');
                expect(err.message).toMatch(/length/i);
            }
        });
    });

    describe('iam_list_users_op', () => {
        let res;

        it('iam_list_users with invalid iam_path_prefix (without / at the beginning and the end) should throw error', async () => {
            try {
                const invalid_iam_path_prefix = 'abc/def';
                const req = {
                    body: {
                        path_prefix: invalid_iam_path_prefix
                    }
                };
                await iam_list_users_op.handler(req, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err).toHaveProperty('message');
                expect(err.message).toMatch(/invalid/i);
            }
        });

        it('iam_list_users with invalid max_items (less than min value) should throw error', async () => {
            try {
                const invalid_nax_items = 0;
                const req = {
                    body: {
                        max_items: invalid_nax_items
                    }
                };
                await iam_list_users_op.handler(req, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err).toHaveProperty('message');
                expect(err.message).toMatch(/invalid/i);
            }
        });

        it('iam_list_users with invalid marker (below min length) should throw error', async () => {
            try {
                const invalid_marker = '';
                const req = {
                    body: {
                        marker: invalid_marker
                    }
                };
                await iam_list_users_op.handler(req, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err).toHaveProperty('message');
                expect(err.message).toMatch(/length greater than/i);
            }
        });
    });
});

describe('input validation flow in IAM ops - IAM ACCESS KEY API', () => {

    describe('iam_create_access_key', () => {
        let res;

        it('iam_create_access_key with invalid username (below min length) should throw error', async () => {
            try {
                const invalid_username = '';
                const req = {
                    body: {
                        user_name: invalid_username,
                    }
                };
                await iam_create_access_key_op.handler(req, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err).toHaveProperty('message');
                expect(err.message).toMatch(/length/i);
            }
        });
    });

    describe('iam_get_access_key_last_used', () => {
        let res;

        it('iam_get_access_key_last_used without required parameters (access key id) should throw error', async () => {
            try {
                const req = {
                    body: {
                        // access_key_id is required
                    }
                };
                await iam_get_access_key_last_used_op.handler(req, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err).toHaveProperty('message');
                expect(err.message).toMatch(/required/i);
            }
        });

        it('iam_get_access_key_last_used with invalid access key (below min length) should throw error', async () => {
            try {
                const invalid_access_key_id = 'abc';
                const req = {
                    body: {
                        access_key_id: invalid_access_key_id,
                    }
                };
                await iam_get_access_key_last_used_op.handler(req, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err).toHaveProperty('message');
                expect(err.message).toMatch(/length greater than/i);
            }
        });
    });

    describe('iam_update_access_key', () => {
        const access_key_id = 'bBwr5eWkxZrLQmMUpzg0';
        const status = 'Active';
        let res;
        it('iam_update_access_key without required parameters (access key id) should throw error', async () => {
            try {
                const req = {
                    body: {
                        // access_key_id is required
                        status: status
                    }
                };
                await iam_update_access_key_op.handler(req, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err).toHaveProperty('message');
                expect(err.message).toMatch(/required/i);
            }
        });

        it('iam_update_access_key without required parameters (status) should throw error', async () => {
            try {
                const req = {
                    body: {
                        access_key_id: access_key_id,
                        // status is required
                    }
                };
                await iam_update_access_key_op.handler(req, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err).toHaveProperty('message');
                expect(err.message).toMatch(/required/i);
            }
        });

        it('iam_update_user with invalid status should throw error', async () => {
            try {
                const invalid_status = 'my-status';
                const req = {
                    body: {
                        access_key_id: access_key_id,
                        status: invalid_status,
                    }
                };
                await iam_update_access_key_op.handler(req, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err).toHaveProperty('message');
                expect(err.message).toMatch(/failed to satisfy/i);
            }
        });

        it('iam_update_user with invalid access key (below min length) should throw error', async () => {
            try {
                const invalid_access_key_id = 'abc';
                const req = {
                    body: {
                        access_key_id: invalid_access_key_id,
                        status: status,
                    }
                };
                await iam_update_access_key_op.handler(req, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err).toHaveProperty('message');
                expect(err.message).toMatch(/length/i);
            }
        });

        it('iam_update_user with invalid username (less than min length) should throw error', async () => {
            try {
                const invalid_username = '';
                const req = {
                    body: {
                        access_key_id: access_key_id,
                        status: status,
                        user_name: invalid_username
                    }
                };
                await iam_update_user_op.handler(req, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err).toHaveProperty('message');
                expect(err.message).toMatch(/length/i);
            }
        });

    });

    describe('iam_delete_access_key', () => {
        const access_key_id = 'bBwr5eWkxZrLQmMUpzg0';
        let res;
        it('iam_delete_access_key without required parameters (access key id) should throw error', async () => {
            try {
                const req = {
                    body: {
                        // access_key_id is required
                    }
                };
                await iam_delete_access_key_op.handler(req, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err).toHaveProperty('message');
                expect(err.message).toMatch(/required/i);
            }
        });

        it('iam_delete_access_key with invalid access key id (less than min length) should throw error', async () => {
            try {
                const invalid_access_key_id = 'abc';
                const req = {
                    body: {
                        access_key_id: invalid_access_key_id,
                    }
                };
                await iam_delete_access_key_op.handler(req, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err).toHaveProperty('message');
                expect(err.message).toMatch(/length/i);
            }
        });

        it('iam_delete_access_key with invalid username (less than min length) should throw error', async () => {
            try {
                const invalid_username = '';
                const req = {
                    body: {
                        access_key_id: access_key_id,
                        user_name: invalid_username
                    }
                };
                await iam_delete_access_key_op.handler(req, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err).toHaveProperty('message');
                expect(err.message).toMatch(/length/i);
            }
        });
    });

    describe('iam_list_access_keys', () => {
        let res;

        it('iam_list_access_keys with invalid max_items (less than min value) should throw error', async () => {
            try {
                const invalid_nax_items = 0;
                const req = {
                    body: {
                        max_items: invalid_nax_items
                    }
                };
                await iam_list_access_keys_op.handler(req, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err).toHaveProperty('message');
                expect(err.message).toMatch(/invalid/i);
            }
        });

        it('iam_list_access_keys with invalid marker (below min length) should throw error', async () => {
            try {
                const invalid_marker = '';
                const req = {
                    body: {
                        marker: invalid_marker
                    }
                };
                await iam_list_access_keys_op.handler(req, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err).toHaveProperty('message');
                expect(err.message).toMatch(/length greater than/i);
            }
        });

        it('iam_list_access_keys with invalid username (below min length) should throw error', async () => {
            try {
                const invalid_username = '';
                const req = {
                    body: {
                        marker: invalid_username
                    }
                };
                await iam_list_access_keys_op.handler(req, res);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
                expect(err).toHaveProperty('message');
                expect(err.message).toMatch(/length greater than/i);
            }
        });

    });
});

describe('input validation flow in IAM ops - IAM ROLES API', () => {
    const trust_policy = '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":"*"},"Action":"sts:AssumeRole"}]}';
    const role_name = 'TestRole';
    const policy_name = 's3-access';

    describe('iam_create_role', () => {
        let res;

        it('iam_create_role without required parameters (role_name) should throw error', async () => {
            try {
                await iam_create_role_op.handler({
                    body: { assume_role_policy_document: trust_policy },
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
                        assume_role_policy_document: trust_policy,
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
                        assume_role_policy_document: trust_policy,
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
                        policy_document: trust_policy,
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
    const trust = '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":"*"},"Action":"sts:AssumeRole"}]}';
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
        await iam_create_role_op.handler(req({ role_name, assume_role_policy_document: trust }), {});
        await iam_get_role_op.handler(req({ role_name }), {});
        await iam_update_role_op.handler(req({ role_name, description: 'd', max_session_duration: '3600' }), {});
        await iam_list_roles_op.handler(req({}), {});
        await iam_put_role_policy_op.handler(req({ role_name, policy_name, policy_document: identity_policy }), {});
        await iam_get_role_policy_op.handler(req({ role_name, policy_name }), {});
        await iam_list_role_policies_op.handler(req({ role_name }), {});
        await iam_update_assume_role_policy_op.handler(req({ role_name, policy_document: trust }), {});
        await iam_delete_role_policy_op.handler(req({ role_name, policy_name }), {});
        await iam_delete_role_op.handler(req({ role_name }), {});

        for (const fn of Object.values(account_sdk)) {
            expect(fn).toHaveBeenCalled();
        }
    });
});

