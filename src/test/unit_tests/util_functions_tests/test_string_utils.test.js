/* Copyright (C) 2025 NooBaa */
'use strict';
const string_utils = require('../../../util/string_utils');

describe('test regex', () => {
    describe('test regex - iam path', () => {

        it('iam path of /', () => {
            const valid_path = '/';
            const res = string_utils.AWS_IAM_PATH_REGEXP.test(valid_path);
            expect(res).toBe(true);
        });

        it('iam path with / at the beginning and / at the end', () => {
            const valid_path = '/division_abc/subdivision_xyz/';
            const res = string_utils.AWS_IAM_PATH_REGEXP.test(valid_path);
            expect(res).toBe(true);
        });

        it('iam path of //', () => {
            const invalid_path = '//';
            const res = string_utils.AWS_IAM_PATH_REGEXP.test(invalid_path);
            expect(res).toBe(false);
        });

        it('iam path of ///', () => {
            const valid_path = '///';
            const res = string_utils.AWS_IAM_PATH_REGEXP.test(valid_path);
            expect(res).toBe(true);
        });

        it('iam path without / at the end', () => {
            const invalid_path = '/division_abc/subdivision_xyz';
            const res = string_utils.AWS_IAM_PATH_REGEXP.test(invalid_path);
            expect(res).toBe(false);
        });

        it('iam path without / at the beginning', () => {
            const invalid_path = 'division_abc/subdivision_xyz/';
            const res = string_utils.AWS_IAM_PATH_REGEXP.test(invalid_path);
            expect(res).toBe(false);
        });

        it('iam path without / at the beginning and / at the end', () => {
            const invalid_path = 'division_abc';
            const res = string_utils.AWS_IAM_PATH_REGEXP.test(invalid_path);
            expect(res).toBe(false);
        });
    });

    describe('test regex - username', () => {

        it('username of alphanumeric characters', () => {
            const valid_username = 'myuser123';
            const res = string_utils.AWS_USERNAME_REGEXP.test(valid_username);
            expect(res).toBe(true);
        });

        it('username of with chars out of scope at the beginning', () => {
            const invalid_username = ':myuser123';
            const res = string_utils.AWS_USERNAME_REGEXP.test(invalid_username);
            expect(res).toBe(false);
        });

        it('username of with chars out of scope at the end', () => {
            const invalid_username = 'myuser123:';
            const res = string_utils.AWS_USERNAME_REGEXP.test(invalid_username);
            expect(res).toBe(false);
        });

        it('username of with chars out of scope at the middle', () => {
            const invalid_username = 'myuser:123';
            const res = string_utils.AWS_USERNAME_REGEXP.test(invalid_username);
            expect(res).toBe(false);
        });

    });

    describe('test regex - policy name', () => {

        it('document name of alphanumeric characters', () => {
            const valid_document_name = 'mydocument123';
            const res = string_utils.AWS_POLICY_NAME_REGEXP.test(valid_document_name);
            expect(res).toBe(true);
        });

        it('document name of with chars out of scope at the beginning', () => {
            const invalid_document_name = '#mydocument123';
            const res = string_utils.AWS_POLICY_NAME_REGEXP.test(invalid_document_name);
            expect(res).toBe(false);
        });

        it('document name of with chars out of scope at the end', () => {
            const invalid_document_name = 'mydocument123#';
            const res = string_utils.AWS_POLICY_NAME_REGEXP.test(invalid_document_name);
            expect(res).toBe(false);
        });

        it('document name of with chars out of scope at the middle', () => {
            const invalid_document_name = 'mydocument#123';
            const res = string_utils.AWS_POLICY_NAME_REGEXP.test(invalid_document_name);
            expect(res).toBe(false);
        });

    });

    describe('test regex - policy sid', () => {

        it('sid of alphanumeric characters', () => {
            const valid_sid = '123abcABC';
            const res = string_utils.AWS_POLICY_SID_REGEXP.test(valid_sid);
            expect(res).toBe(true);
        });

        it('sid of empty string', () => {
            const valid_sid = '';
            const res = string_utils.AWS_POLICY_SID_REGEXP.test(valid_sid);
            expect(res).toBe(true);
        });

        it('sid of with chars out of scope at the beginning', () => {
            const invalid_sid = '%123abcABC';
            const res = string_utils.AWS_POLICY_SID_REGEXP.test(invalid_sid);
            expect(res).toBe(false);
        });

        it('sid of with chars out of scope at the end', () => {
            const invalid_sid = '123abcABC_';
            const res = string_utils.AWS_POLICY_SID_REGEXP.test(invalid_sid);
            expect(res).toBe(false);
        });

        it('sid of with chars out of scope at the middle', () => {
            const invalid_sid = '123-abcABC';
            const res = string_utils.AWS_POLICY_SID_REGEXP.test(invalid_sid);
            expect(res).toBe(false);
        });
    });
});
