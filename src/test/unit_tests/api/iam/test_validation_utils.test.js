/* Copyright (C) 2024 NooBaa */
/* eslint-disable max-lines-per-function */
'use strict';
const validation_utils = require('../../../../util/validation_utils');
const iam_constants = require('../../../../endpoint/iam/iam_constants');
const RpcError = require('../../../../rpc/rpc_error');

class NoErrorThrownError extends Error {}

describe('validate_user_input', () => {
    const RPC_CODE_VALIDATION_ERROR = 'VALIDATION_ERROR';
    describe('validate_username', () => {
        const min_length = 1;
        const max_length = 64;
        it('should return true when username is undefined', () => {
            let dummy_username;
            const res = validation_utils.validate_username(dummy_username, iam_constants.IAM_PARAMETER_NAME.USERNAME);
            expect(res).toBeUndefined();
        });

        it('should return true when username is at the min or max length', () => {
            expect(validation_utils.validate_username('a', iam_constants.IAM_PARAMETER_NAME.USERNAME)).toBe(true);
            expect(validation_utils.validate_username('a'.repeat(max_length), iam_constants.IAM_PARAMETER_NAME.USERNAME)).toBe(true);
        });

        it('should return true when username is within the length constraint', () => {
            expect(validation_utils.validate_username('a'.repeat(min_length + 1), iam_constants.IAM_PARAMETER_NAME.USERNAME)).toBe(true);
            expect(validation_utils.validate_username('a'.repeat(max_length - 1), iam_constants.IAM_PARAMETER_NAME.USERNAME)).toBe(true);
        });

        it('should return true when username is valid', () => {
            const dummy_username = 'Robert';
            const res = validation_utils.validate_username(dummy_username, iam_constants.IAM_PARAMETER_NAME.USERNAME);
            expect(res).toBe(true);
        });

        it('should throw error when username is invalid - contains invalid character', () => {
            try {
                validation_utils.validate_username('{}', iam_constants.IAM_PARAMETER_NAME.USERNAME);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err.rpc_code).toBe(RPC_CODE_VALIDATION_ERROR);
            }
        });

        it('should throw error when username is invalid - internal limitation (anonymous)', () => {
            try {
                validation_utils.validate_username('anonymous', iam_constants.IAM_PARAMETER_NAME.USERNAME);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err.rpc_code).toBe(RPC_CODE_VALIDATION_ERROR);
            }
        });

        it('should throw error when username is invalid - internal limitation (with leading or trailing spaces)', () => {
            try {
                validation_utils.validate_username('    name-with-spaces    ', iam_constants.IAM_PARAMETER_NAME.USERNAME);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err.rpc_code).toBe(RPC_CODE_VALIDATION_ERROR);
            }
        });

        it('should throw error when username is too short', () => {
            try {
                const dummy_username = '';
                validation_utils.validate_username(dummy_username, iam_constants.IAM_PARAMETER_NAME.USERNAME);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err.rpc_code).toBe(RPC_CODE_VALIDATION_ERROR);
            }
        });

        it('should throw error when username is too long', () => {
            try {
                const dummy_username = 'A'.repeat(max_length + 1);
                validation_utils.validate_username(dummy_username, iam_constants.IAM_PARAMETER_NAME.USERNAME);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err.rpc_code).toBe(RPC_CODE_VALIDATION_ERROR);
            }
        });

        it('should throw error for invalid input types (null) in username', () => {
            try {
                // @ts-ignore
                const invalid_username = null;
                validation_utils.validate_username(invalid_username, iam_constants.IAM_PARAMETER_NAME.USERNAME);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err.rpc_code).toBe(RPC_CODE_VALIDATION_ERROR);
            }
        });

        it('should throw error for invalid input types (number) in username', () => {
            try {
                const invalid_username = 1;
                // @ts-ignore
                validation_utils.validate_username(invalid_username, iam_constants.IAM_PARAMETER_NAME.USERNAME);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err.rpc_code).toBe(RPC_CODE_VALIDATION_ERROR);
            }
        });

        it('should throw error for invalid input types (object) in username', () => {
            try {
                const invalid_username = {};
                // @ts-ignore
                validation_utils.validate_username(invalid_username, iam_constants.IAM_PARAMETER_NAME.USERNAME);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err.rpc_code).toBe(RPC_CODE_VALIDATION_ERROR);
            }
        });

        it('should throw error for invalid input types (boolean) in username', () => {
            try {
                const invalid_username = false;
                // @ts-ignore
                validation_utils.validate_username(invalid_username, iam_constants.IAM_PARAMETER_NAME.USERNAME);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err.rpc_code).toBe(RPC_CODE_VALIDATION_ERROR);
            }
        });
    });

    describe('validate_policy_name', () => {
        const min_length = 1;
        const max_length = 128;
        it('should return true when policy_name is undefined', () => {
            let dummy_policy_name;
            const res = validation_utils.validate_policy_name(dummy_policy_name, iam_constants.IAM_PARAMETER_NAME.POLICY_NAME);
            expect(res).toBeUndefined();
        });

        it('should return true when policy_name is at the min or max length', () => {
            expect(validation_utils.validate_policy_name('a', iam_constants.IAM_PARAMETER_NAME.POLICY_NAME)).toBe(true);
            expect(validation_utils.validate_policy_name('a'.repeat(max_length), iam_constants.IAM_PARAMETER_NAME.POLICY_NAME)).toBe(true);
        });

        it('should return true when policy_name is within the length constraint', () => {
            expect(validation_utils.validate_policy_name('a'.repeat(min_length + 1), iam_constants.IAM_PARAMETER_NAME.POLICY_NAME)).toBe(true);
            expect(validation_utils.validate_policy_name('a'.repeat(max_length - 1), iam_constants.IAM_PARAMETER_NAME.POLICY_NAME)).toBe(true);
        });

        it('should return true when policy_name is valid CamelCase', () => {
            const dummy_policy_name = 'CreateBucketPolicy';
            const res = validation_utils.validate_policy_name(dummy_policy_name, iam_constants.IAM_PARAMETER_NAME.POLICY_NAME);
            expect(res).toBe(true);
        });

        it('should return true when policy_name is valid SnakeCase', () => {
            const dummy_policy_name = 'create_bucket_policy';
            const res = validation_utils.validate_policy_name(dummy_policy_name, iam_constants.IAM_PARAMETER_NAME.POLICY_NAME);
            expect(res).toBe(true);
        });

        it('should throw error when policy_name is invalid - contains invalid character', () => {
            try {
                validation_utils.validate_policy_name('{}', iam_constants.IAM_PARAMETER_NAME.POLICY_NAME);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err.rpc_code).toBe(RPC_CODE_VALIDATION_ERROR);
            }
        });

        it('should throw error when policy_name is too short', () => {
            try {
                const dummy_policy_name = '';
                validation_utils.validate_policy_name(dummy_policy_name, iam_constants.IAM_PARAMETER_NAME.POLICY_NAME);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err.rpc_code).toBe(RPC_CODE_VALIDATION_ERROR);
            }
        });

        it('should throw error when dummy_policy_name is too long', () => {
            try {
                const dummy_policy_name = 'A'.repeat(max_length + 1);
                validation_utils.validate_policy_name(dummy_policy_name, iam_constants.IAM_PARAMETER_NAME.POLICY_NAME);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err.rpc_code).toBe(RPC_CODE_VALIDATION_ERROR);
            }
        });

        it('should throw error for invalid input types (null) in policy_name', () => {
            try {
                // @ts-ignore
                const invalid_policy_name = null;
                validation_utils.validate_policy_name(invalid_policy_name, iam_constants.IAM_PARAMETER_NAME.POLICY_NAME);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err.rpc_code).toBe(RPC_CODE_VALIDATION_ERROR);
            }
        });

        it('should throw error for invalid input types (number) in policy_name', () => {
            try {
                const invalid_policy_name = 1;
                // @ts-ignore
                validation_utils.validate_policy_name(invalid_policy_name, iam_constants.IAM_PARAMETER_NAME.POLICY_NAME);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err.rpc_code).toBe(RPC_CODE_VALIDATION_ERROR);
            }
        });

        it('should throw error for invalid input types (object) in policy_name', () => {
            try {
                const invalid_policy_name = {};
                // @ts-ignore
                validation_utils.validate_policy_name(invalid_policy_name, iam_constants.IAM_PARAMETER_NAME.POLICY_NAME);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err.rpc_code).toBe(RPC_CODE_VALIDATION_ERROR);
            }
        });

        it('should throw error for invalid input types (boolean) in policy_name', () => {
            try {
                const invalid_policy_name = false;
                // @ts-ignore
                validation_utils.validate_policy_name(invalid_policy_name, iam_constants.IAM_PARAMETER_NAME.POLICY_NAME);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err.rpc_code).toBe(RPC_CODE_VALIDATION_ERROR);
            }
        });
    });

    describe('validate_policy_document', () => {
        it('should return true when policy_document is undefined', () => {
            let dummy_policy_document;
            const res = validation_utils.validate_policy_document(dummy_policy_document, iam_constants.IAM_PARAMETER_NAME.POLICY_DOCUMENT);
            expect(res).toBeUndefined();
        });

        it('should return true when policy_document is valid JSON string', () => {
            const dummy_policy_document = JSON.stringify({
                Version: '2012-10-17',
                Statement: [
                    {
                        Effect: 'Allow',
                        Action: 's3:GetBucketLocation',
                        Resource: '*'
                    }
                ]
            });
            const res = validation_utils.validate_policy_document(dummy_policy_document, iam_constants.IAM_PARAMETER_NAME.POLICY_DOCUMENT);
            expect(res).toBe(true);
        });

        it('should throw error when policy_document is invalid JSON string', () => {
            try {
                const invalid_policy_document = 'hello';
                validation_utils.validate_policy_document(invalid_policy_document, iam_constants.IAM_PARAMETER_NAME.POLICY_DOCUMENT);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err.rpc_code).toBe('MALFORMED_POLICY_DOCUMENT');
            }
        });

        it('should throw error when policy_document is empty', () => {
            try {
                const invalid_policy_document = '';
                validation_utils.validate_policy_document(invalid_policy_document, iam_constants.IAM_PARAMETER_NAME.POLICY_DOCUMENT);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err.rpc_code).toBe('VALIDATION_ERROR');
            }
        });
    });
});
