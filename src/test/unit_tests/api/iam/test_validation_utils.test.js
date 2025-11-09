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
});
