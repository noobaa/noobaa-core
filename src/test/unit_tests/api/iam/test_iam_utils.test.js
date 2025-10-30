/* Copyright (C) 2024 NooBaa */
/* eslint-disable max-lines-per-function */
'use strict';
const iam_utils = require('../../../../endpoint/iam/iam_utils');
const iam_constants = require('../../../../endpoint/iam/iam_constants');
const { IamError } = require('../../../../endpoint/iam/iam_errors');

class NoErrorThrownError extends Error {}

describe('create_arn_for_user', () => {
    const dummy_account_id = '12345678012'; // for the example
    const dummy_username = 'Bob';
    const dummy_iam_path = '/division_abc/subdivision_xyz/';
    const arn_prefix = 'arn:aws:iam::';

    it('create_arn_for_user without username should return basic structure', () => {
        const user_details = {};
        const res = iam_utils.create_arn_for_user(dummy_account_id, user_details.username, user_details.iam_path);
        expect(res).toBe(`${arn_prefix}${dummy_account_id}:user/`);
    });

    it('create_arn_for_user with username and no iam_path should return only username in arn', () => {
        const user_details = {
            username: dummy_username,
        };
        const res = iam_utils.create_arn_for_user(dummy_account_id, user_details.username, user_details.iam_path);
        expect(res).toBe(`${arn_prefix}${dummy_account_id}:user/${dummy_username}`);
    });

    it('create_arn_for_user with username and AWS DEFAULT PATH should return only username in arn', () => {
        const user_details = {
            username: dummy_username,
            iam_path: iam_constants.IAM_DEFAULT_PATH
        };
        const res = iam_utils.create_arn_for_user(dummy_account_id, user_details.username, user_details.iam_path);
        expect(res).toBe(`${arn_prefix}${dummy_account_id}:user/${dummy_username}`);
    });

    it('create_arn_for_user with username and iam_path should return them in arn', () => {
        const user_details = {
            username: dummy_username,
            iam_path: dummy_iam_path,
        };
        const res = iam_utils.create_arn_for_user(dummy_account_id, user_details.username, user_details.iam_path);
        expect(res).toBe(`${arn_prefix}${dummy_account_id}:user${dummy_iam_path}${dummy_username}`);
    });
});

describe('create_arn_for_root', () => {
    const dummy_account_id = '12345678012'; // for the example
    const arn_prefix = 'arn:aws:iam::';

    it('create_arn_for_user without username should root arn', () => {
        const res = iam_utils.create_arn_for_root(dummy_account_id);
        expect(res).toBe(`${arn_prefix}${dummy_account_id}:root`);
    });
});

describe('get_action_message_title', () => {
    it('create_user', () => {
        const action = 'create_user';
        const res = iam_utils.get_action_message_title(action);
        expect(res).toBe(`iam:CreateUser`);
    });

    it('get_user', () => {
        const action = 'get_user';
        const res = iam_utils.get_action_message_title(action);
        expect(res).toBe(`iam:GetUser`);
    });

    it('update_user', () => {
        const action = 'update_user';
        const res = iam_utils.get_action_message_title(action);
        expect(res).toBe(`iam:UpdateUser`);
    });

    it('delete_user', () => {
        const action = 'delete_user';
        const res = iam_utils.get_action_message_title(action);
        expect(res).toBe(`iam:DeleteUser`);
    });

    it('list_users', () => {
        const action = 'list_users';
        const res = iam_utils.get_action_message_title(action);
        expect(res).toBe(`iam:ListUsers`);
    });

    it('create_access_key', () => {
        const action = 'create_access_key';
        const res = iam_utils.get_action_message_title(action);
        expect(res).toBe(`iam:CreateAccessKey`);
    });

    it('get_access_key_last_used', () => {
        const action = 'get_access_key_last_used';
        const res = iam_utils.get_action_message_title(action);
        expect(res).toBe(`iam:GetAccessKeyLastUsed`);
    });

    it('update_access_key', () => {
        const action = 'update_access_key';
        const res = iam_utils.get_action_message_title(action);
        expect(res).toBe(`iam:UpdateAccessKey`);
    });

    it('delete_access_key', () => {
        const action = 'delete_access_key';
        const res = iam_utils.get_action_message_title(action);
        expect(res).toBe(`iam:DeleteAccessKey`);
    });

    it('list_access_keys', () => {
        const action = 'list_access_keys';
        const res = iam_utils.get_action_message_title(action);
        expect(res).toBe(`iam:ListAccessKeys`);
    });
});

describe('check_iam_path_was_set', () => {
    it('iam_path is undefined should return false in boolean context', () => {
        let iam_path; // variable is undefined by default
        const res = iam_utils.check_iam_path_was_set(iam_path);
        expect(res).toBeFalsy();
    });

    it('iam_path is IAM_DEFAULT_PATH should return false in boolean context', () => {
        const iam_path = iam_constants.IAM_DEFAULT_PATH;
        const res = iam_utils.check_iam_path_was_set(iam_path);
        expect(res).toBeFalsy();
    });

    it('iam_path is set should return true', () => {
        const iam_path = '/division_abc/subdivision_xyz/';
        const res = iam_utils.check_iam_path_was_set(iam_path);
        expect(res).toBe(true);
    });
});

describe('format_iam_xml_date', () => {
    it('should not return milliseconds in date', () => {
        const date_as_string = '2018-11-07T00:25:00.073876Z';
        const res = iam_utils.format_iam_xml_date(date_as_string);
        expect(res).not.toMatch(/073876/);
        expect(res).toMatch(/2018-11-07/);
        expect(res).toMatch(/00:25:00/);
    });
});

describe('parse_max_items', () => {
    it('max_items is undefined should not be changed', () => {
        let max_items; // variable is undefined by default
        const res = iam_utils.parse_max_items(max_items);
        expect(res).toBeUndefined();
    });

    it('max_items is number should not be changed', () => {
        const max_items = 7;
        const res = iam_utils.parse_max_items(max_items);
        expect(res).toBe(max_items);
    });

    it('max_items is string of number should be changed', () => {
        const max_items = '7';
        const res = iam_utils.parse_max_items(max_items);
        expect(res).toBe(7);
    });

    it('max_items is string cannot be converted to number should throw an error', () => {
        try {
            const max_items = 'blabla';
            iam_utils.parse_max_items(max_items);
            throw new NoErrorThrownError();
        } catch (err) {
            expect(err).toBeInstanceOf(IamError);
            expect(err).toHaveProperty('code', IamError.ValidationError.code);
        }
    });
});

describe('validate_user_input_iam', () => {
    describe('validate_iam_path', () => {
        const max_length = 512;
        it('should return true when path is undefined', () => {
            let dummy_path;
            const res = iam_utils.validate_iam_path(dummy_path);
            expect(res).toBeUndefined();
        });

        it('should return true when path is AWS_DEFAULT_PATH', () => {
            const dummy_path = iam_constants.IAM_DEFAULT_PATH;
            const res = iam_utils.validate_iam_path(dummy_path);
            expect(res).toBe(true);
        });

        it('should return true when path is at the min or max length', () => {
            expect(iam_utils.validate_iam_path('/')).toBe(true);
            expect(iam_utils.validate_iam_path('/'.repeat(max_length))).toBe(true);
        });

        it('should return true when path is within the length constraint', () => {
            expect(iam_utils.validate_iam_path('/a/')).toBe(true);
            expect(iam_utils.validate_iam_path('/' + 'a'.repeat(max_length - 3) + '/')).toBe(true);
        });

        it('should return true when path is valid', () => {
            const dummy_path = '/division_abc/subdivision_xyz/';
            const res = iam_utils.validate_iam_path(dummy_path);
            expect(res).toBe(true);
        });

        it('should throw error when path is invalid - not begins with /', () => {
            try {
                iam_utils.validate_iam_path('a/b/', iam_constants.IAM_PARAMETER_NAME.IAM_PATH);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
            }
        });

        it('should throw error when path is invalid - not ends with /', () => {
            try {
                iam_utils.validate_iam_path('/a/b', iam_constants.IAM_PARAMETER_NAME.IAM_PATH);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
            }
        });

        it('should throw error when path is invalid - not begins with / and not ends with /', () => {
            try {
                iam_utils.validate_iam_path('a/b', iam_constants.IAM_PARAMETER_NAME.IAM_PATH);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
            }
        });

        it('should throw error when path is too short', () => {
            try {
                const dummy_path = '';
                iam_utils.validate_iam_path(dummy_path, iam_constants.IAM_PARAMETER_NAME.IAM_PATH);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
            }
        });

        it('should throw error when path is too long', () => {
            try {
                const dummy_path = 'A'.repeat(max_length + 1);
                iam_utils.validate_iam_path(dummy_path, iam_constants.IAM_PARAMETER_NAME.IAM_PATH);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
            }
        });

        it('should throw error for invalid input types (null)', () => {
            try {
                // @ts-ignore
                const invalid_path = null;
                iam_utils.validate_iam_path(invalid_path, iam_constants.IAM_PARAMETER_NAME.IAM_PATH);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
            }
        });

        it('should throw error for invalid input types (number)', () => {
            try {
                const invalid_path = 1;
                // @ts-ignore
                iam_utils.validate_iam_path(invalid_path, iam_constants.IAM_PARAMETER_NAME.IAM_PATH);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
            }
        });

        it('should throw error for invalid input types (object)', () => {
            try {
                const invalid_path = {};
                // @ts-ignore
                iam_utils.validate_iam_path(invalid_path, iam_constants.IAM_PARAMETER_NAME.IAM_PATH);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
            }
        });

        it('should throw error for invalid input types (boolean)', () => {
            try {
                const invalid_path = false;
                // @ts-ignore
                iam_utils.validate_iam_path(invalid_path, iam_constants.IAM_PARAMETER_NAME.IAM_PATH);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
            }
        });
    });

    describe('validate_marker', () => {
        const min_length = 1;
        it('should return true when marker is undefined', () => {
            let dummy_marker;
            const res = iam_utils.validate_marker(dummy_marker);
            expect(res).toBeUndefined();
        });

        it('should return true when marker is at the min', () => {
            expect(iam_utils.validate_marker('a')).toBe(true);
        });

        it('should return true when marker is within the length constraint', () => {
            expect(iam_utils.validate_marker('a'.repeat(min_length + 1))).toBe(true);
        });

        it('should return true when marker is valid', () => {
            const dummy_marker = 'my-marker';
            const res = iam_utils.validate_marker(dummy_marker);
            expect(res).toBe(true);
        });

        it('should throw error when marker is invalid - contains invalid character', () => {
            try {
                const invalid_characters = '\uD83D\uDE0A'; //emoji is not part of the pattern
                iam_utils.validate_marker(invalid_characters);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
            }
        });

        it('should throw error when marker is too short', () => {
            try {
                const dummy_marker = '';
                iam_utils.validate_marker(dummy_marker);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
            }
        });

        it('should throw error for invalid input types (null)', () => {
            try {
                // @ts-ignore
                const invalid_marker = null;
                iam_utils.validate_marker(invalid_marker);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
            }
        });

        it('should throw error for invalid input types (number)', () => {
            try {
                const invalid_marker = 1;
                // @ts-ignore
                iam_utils.validate_marker(invalid_marker);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
            }
        });

        it('should throw error for invalid input types (object)', () => {
            try {
                const invalid_marker = {};
                // @ts-ignore
                iam_utils.validate_marker(invalid_marker);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
            }
        });

        it('should throw error for invalid input types (boolean)', () => {
            try {
                const invalid_marker = false;
                // @ts-ignore
                iam_utils.validate_marker(invalid_marker);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
            }
        });
    });

    describe('validate_access_key_id', () => {
        const min_length = 16;
        const max_length = 128;
        it('should return true when access_key is undefined', () => {
            let dummy_access_key;
            const res = iam_utils.validate_access_key_id(dummy_access_key);
            expect(res).toBeUndefined();
        });

        it('should return true when access_key is at the min or max length', () => {
            expect(iam_utils.validate_access_key_id('a'.repeat(min_length))).toBe(true);
            expect(iam_utils.validate_access_key_id('a'.repeat(max_length))).toBe(true);
        });

        it('should return true when access_key is within the length constraint', () => {
            expect(iam_utils.validate_access_key_id('a'.repeat(min_length + 1))).toBe(true);
            expect(iam_utils.validate_access_key_id('a'.repeat(max_length - 1))).toBe(true);
        });

        it('should return true when access_key is valid', () => {
            const dummy_access_key_id = 'bBwr5eWkxZrLQmMUpzg0';
            const res = iam_utils.validate_access_key_id(dummy_access_key_id);
            expect(res).toBe(true);
        });

        it('should throw error when access_key is invalid - contains invalid character', () => {
            try {
                iam_utils.validate_access_key_id('{}');
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
            }
        });

        it('should throw error when access_key is too short', () => {
            try {
                const dummy_access_key_id = '';
                iam_utils.validate_access_key_id(dummy_access_key_id);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
            }
        });

        it('should throw error when access_key is too long', () => {
            try {
                const dummy_access_key_id = 'A'.repeat(max_length + 1);
                iam_utils.validate_access_key_id(dummy_access_key_id);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
            }
        });

        it('should throw error for invalid input types (null)', () => {
            try {
                // @ts-ignore
                const invalid_username = null;
                iam_utils.validate_access_key_id(invalid_username);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
            }
        });

        it('should throw error for invalid input types (number)', () => {
            try {
                const invalid_username = 1;
                // @ts-ignore
                iam_utils.validate_access_key_id(invalid_username);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
            }
        });

        it('should throw error for invalid input types (object)', () => {
            try {
                const invalid_username = {};
                // @ts-ignore
                iam_utils.validate_access_key_id(invalid_username);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
            }
        });

        it('should throw error for invalid input types (boolean)', () => {
            try {
                const invalid_username = false;
                // @ts-ignore
                iam_utils.validate_access_key_id(invalid_username);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
            }
        });
    });

    describe('validate_status', () => {
        it('should return true when status is undefined', () => {
            let dummy_status;
            const res = iam_utils.validate_status(dummy_status);
            expect(res).toBeUndefined();
        });

        it('should return true when status is valid', () => {
            expect(iam_utils.validate_status('Active')).toBe(true);
            expect(iam_utils.validate_status('Inactive')).toBe(true);
        });

        it('should throw error when status is invalid - capital letters', () => {
            try {
                const invalid_status = 'ACTIVE';
                // @ts-ignore
                iam_utils.validate_status(invalid_status);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
            }
        });

        it('should throw error when status is invalid - small letters', () => {
            try {
                const invalid_status = 'inactive';
                // @ts-ignore
                iam_utils.validate_status(invalid_status);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.ValidationError.code);
            }
        });

    });
});
