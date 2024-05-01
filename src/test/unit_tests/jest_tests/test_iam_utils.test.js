/* Copyright (C) 2024 NooBaa */
'use strict';
const iam_utils = require('../../../endpoint/iam/iam_utils');

describe('create_arn', () => {
    const dummy_account_id = '12345678012'; // for the example
    const dummy_username = 'Bob';
    const dummy_iam_path = '/division_abc/subdivision_xyz/';
    const arn_prefix = 'arn:aws:iam::';

    it('create_arn without username should return basic structure', () => {
        const user_details = {};
        const res = iam_utils.create_arn(dummy_account_id, user_details.username, user_details.iam_path);
        expect(res).toBe(`${arn_prefix}${dummy_account_id}:user/`);
    });

    it('create_arn with username and no iam_path should return only username in arn', () => {
        const user_details = {
            username: dummy_username,
        };
        const res = iam_utils.create_arn(dummy_account_id, user_details.username, user_details.iam_path);
        expect(res).toBe(`${arn_prefix}${dummy_account_id}:user/${dummy_username}`);
    });

    it('create_arn with username and AWS DEFAULT PATH should return only username in arn', () => {
        const user_details = {
            username: dummy_username,
            iam_path: iam_utils.IAM_DEFAULT_PATH
        };
        const res = iam_utils.create_arn(dummy_account_id, user_details.username, user_details.iam_path);
        expect(res).toBe(`${arn_prefix}${dummy_account_id}:user/${dummy_username}`);
    });

    it('create_arn with username and iam_path should return them in arn', () => {
        const user_details = {
            username: dummy_username,
            iam_path: dummy_iam_path,
        };
        const res = iam_utils.create_arn(dummy_account_id, user_details.username, user_details.iam_path);
        expect(res).toBe(`${arn_prefix}${dummy_account_id}:user${dummy_iam_path}${dummy_username}`);
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
        const iam_path = iam_utils.IAM_DEFAULT_PATH;
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
