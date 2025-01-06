/* Copyright (C) 2024 NooBaa */
'use strict';

const _ = require('lodash');
const { AWS_USERNAME_REGEXP } = require('../util/string_utils');
const RpcError = require('../rpc/rpc_error');
const iam_constants = require('../endpoint/iam/iam_constants');

/**
 * _type_check_input checks that the input is the same as needed
 * @param {string} input_type
 * @param {string | number} input_value
 * @param {string} parameter_name
 */
function _type_check_input(input_type, input_value, parameter_name) {
    if (typeof input_value !== input_type) {
        const message_with_details = `1 validation error detected: Value ${input_value} at ` +
            `'${parameter_name}'  failed to satisfy constraint: Member must be ${input_type}`;
        throw new RpcError('VALIDATION_ERROR', message_with_details);
    }
}

/**
 * _length_check_input checks that the input length is between the min and the max value
 * @param {number} min_length
 * @param {number} max_length
 * @param {string} input_value
 * @param {string} parameter_name
 */
function _length_check_input(min_length, max_length, input_value, parameter_name) {
    _length_min_check_input(min_length, input_value, parameter_name);
    _length_max_check_input(max_length, input_value, parameter_name);
}

/**
 * _length_min_check_input checks if the input is lower than the min length
 * @param {number} min_length
 * @param {any} input_value
 * @param {string} parameter_name
 */
function _length_min_check_input(min_length, input_value, parameter_name) {
    const input_length = input_value.length;
    if (input_length < min_length) {
        const message_with_details = `Invalid length for parameter ${parameter_name}, ` +
            `value: ${input_length}, valid min length: ${min_length}`;
            throw new RpcError('VALIDATION_ERROR', message_with_details);
    }
}

/**
 * _length_max_check_input checks if the input is higher than the max length
 * @param {number} max_length
 * @param {any} input_value
 * @param {string} parameter_name
 */
function _length_max_check_input(max_length, input_value, parameter_name) {
    const input_length = input_value.length;
    if (input_length > max_length) {
        const message_with_details = `1 validation error detected: Value ${input_value} at ` +
            `'${parameter_name}' failed to satisfy constraint:` +
            `Member must have length less than or equal to ${max_length}`;
        throw new RpcError('VALIDATION_ERROR', message_with_details);
    }
}

/**
 * validate_username will validate:
 * 1. type
 * 2. length
 * 3. regex (from AWS docs)
 * 4. additional internal restrictions
 * @param {string} input_username
 * @param {string} parameter_name
 */
function validate_username(input_username, parameter_name = iam_constants.IAM_PARAMETER_NAME.USERNAME) {
    if (input_username === undefined) return;
    // type check
    _type_check_input('string', input_username, parameter_name);
    // length check
    const min_length = 1;
    const max_length = 64;
    _length_check_input(min_length, max_length, input_username, parameter_name);
    // regex check
    const valid_username = AWS_USERNAME_REGEXP.test(input_username);
    if (!valid_username) {
            const message_with_details = `The specified value for ${_.lowerFirst(parameter_name)} is invalid. ` +
            `It must contain only alphanumeric characters and/or the following: +=,.@_-`;
            throw new RpcError('VALIDATION_ERROR', message_with_details);
    }
    // internal limitations
    const invalid_internal_names = new Set(['anonymous', '/', '.']);
    if (invalid_internal_names.has(input_username)) {
        const message_with_details = `The specified value for ${_.lowerFirst(parameter_name)} is invalid. ` +
        `Should not be one of: ${[...invalid_internal_names].join(' ').toString()}`;
        throw new RpcError('VALIDATION_ERROR', message_with_details);
    }
    if (input_username !== input_username.trim()) {
        const message_with_details = `The specified value for ${_.lowerFirst(parameter_name)} is invalid. ` +
        `Must not contain leading or trailing spaces`;
        throw new RpcError('VALIDATION_ERROR', message_with_details);
    }
    return true;
}

// EXPORTS
exports.validate_username = validate_username;
exports._type_check_input = _type_check_input;
exports._length_check_input = _length_check_input;
exports._length_min_check_input = _length_min_check_input;

