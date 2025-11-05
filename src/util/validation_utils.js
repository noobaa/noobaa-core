/* Copyright (C) 2024 NooBaa */
'use strict';

const _ = require('lodash');
const { AWS_USERNAME_REGEXP, AWS_IAM_TAG_KEY_AND_VALUE_REGEXP, AWS_POLICY_NAME_REGEXP, AWS_POLICY_DOCUMENT_REGEXP } = require('../util/string_utils');
const RpcError = require('../rpc/rpc_error');
const iam_constants = require('../endpoint/iam/iam_constants');

// tag validation constants
const MAX_TAG_KEY_LENGTH = 128;
const MAX_TAG_VALUE_LENGTH = 256;
const TAG_KEY_PATTERN = '[\\p{L}\\p{Z}\\p{N}_.:/=+\\-@]+';
const TAG_VALUE_PATTERN = '[\\p{L}\\p{Z}\\p{N}_.:/=+\\-@]*';

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
 * @param {number} min_length - minimum length (optional)
 * @param {number} max_length - maximum length (optional)
 * @param {string|Array} input_value
 * @param {string} parameter_name
 */
function _length_check_input(min_length, max_length, input_value, parameter_name) {
    if (min_length !== undefined) {
        _length_min_check_input(min_length, input_value, parameter_name);
    }
    if (max_length !== undefined) {
        _length_max_check_input(max_length, input_value, parameter_name);
    }
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
        const message_with_details = `1 validation error detected: Value at '${parameter_name}' ` +
            `failed to satisfy constraint: Member must have length greater than or equal to ${min_length}`;
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
 * _validate_json_policy_document will validate that the policy document is valid JSON
 * @param {string} input_policy_document
 */
function _validate_json_policy_document(input_policy_document) {
    try {
        JSON.parse(input_policy_document);
    } catch (error) {
        const message_with_details = `Syntax errors in policy`;
        throw new RpcError('MALFORMED_POLICY_DOCUMENT', message_with_details);
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
    const is_valid_username = AWS_USERNAME_REGEXP.test(input_username);
    if (!is_valid_username) {
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

/**
 * validate_policy_name will validate:
 * 1. type
 * 2. length
 * 3. regex (from AWS docs)
 * @param {string} input_policy_name
 * @param {string} parameter_name
 */
function validate_policy_name(input_policy_name, parameter_name = iam_constants.IAM_PARAMETER_NAME.POLICY_NAME) {
    if (input_policy_name === undefined) return;
    // type check
    _type_check_input('string', input_policy_name, parameter_name);
    // length check
    const min_length = 1;
    const max_length = 128;
    _length_check_input(min_length, max_length, input_policy_name, parameter_name);
    // regex check
    const is_valid_policy_name = AWS_POLICY_NAME_REGEXP.test(input_policy_name);
    if (!is_valid_policy_name) {
            const message_with_details = `The specified value for ${_.lowerFirst(parameter_name)} is invalid. ` +
            `It must contain only alphanumeric characters and/or the following: +=,.@_-`;
            throw new RpcError('VALIDATION_ERROR', message_with_details);
    }
    return true;
}

/**
 * validate_policy_document will validate:
 * 1. type
 * 2. length
 * 3. regex (from AWS docs)
 * 4. valid JSON (like we do in bucket policy)
 * @param {string} input_policy_document
 * @param {string} parameter_name
 */
function validate_policy_document(input_policy_document, parameter_name = iam_constants.IAM_PARAMETER_NAME.POLICY_DOCUMENT) {
    if (input_policy_document === undefined) return;
    // type check
    _type_check_input('string', input_policy_document, parameter_name);
    // length check
    const min_length = 1;
    const max_length = 131072;
    _length_check_input(min_length, max_length, input_policy_document, parameter_name);
    // regex check
    const is_valid_policy_document = AWS_POLICY_DOCUMENT_REGEXP.test(input_policy_document);
    if (!is_valid_policy_document) {
            const message_with_details = `Syntax errors in policy`;
            throw new RpcError('MALFORMED_POLICY_DOCUMENT', message_with_details);
    }
    // valid JSON check
    _validate_json_policy_document(input_policy_document);
    return true;
}

/**
 * _validate_tag_pattern validates tag key or value against AWS pattern
 * @param {string} value - tag key or value to validate
 * @param {string} position - position identifier for error message (e.g., 'tags.1.member.key')
 * @param {boolean} is_value - true if validating value (allows empty), false for key
 */
function _validate_tag_pattern(value, position, is_value = false) {
    if (!AWS_IAM_TAG_KEY_AND_VALUE_REGEXP.test(value)) {
        const pattern = is_value ? TAG_VALUE_PATTERN : TAG_KEY_PATTERN;
        const message_with_details = `1 validation error detected: Value at '${position}' ` +
            `failed to satisfy constraint: Member must satisfy regular expression pattern: ${pattern}`;
        throw new RpcError('VALIDATION_ERROR', message_with_details);
    }
}

/**
 * _has_tag_key_violation checks if tag key violates any constraint
 * @param {string} key - tag key to validate
 */
function _has_tag_key_violation(key) {
    return key === null || key === undefined ||
           key.length > MAX_TAG_KEY_LENGTH || key.length < 1 ||
           !AWS_IAM_TAG_KEY_AND_VALUE_REGEXP.test(key);
}

/**
 * validate_iam_tags will validate tags array for TagUser operation:
 * 1. Must be an array
 * 2. Maximum 50 tags per user (AWS limit)
 * 3. Each tag must have key and value
 * 4. Tag key: 1-128 characters
 * 5. Tag value: 0-256 characters
 * @param {Array} tags
 */
function validate_iam_tags(tags) {
    if (!Array.isArray(tags)) {
        throw new RpcError('VALIDATION_ERROR', 'Invalid type for parameter Tags, value must be an array');
    }

    if (tags.length === 0) {
        throw new RpcError('INVALID_INPUT', 'Error occurred while validating input.');
    }

    if (tags.length > iam_constants.MAX_TAGS) {
        const message_with_details = `1 validation error detected: Value at 'tags' failed to satisfy constraint: ` +
            `Member must have length less than or equal to ${iam_constants.MAX_TAGS}`;
        throw new RpcError('VALIDATION_ERROR', message_with_details);
    }

    for (let i = 0; i < tags.length; i++) {
        const tag = tags[i];
        const tag_position = `tags.${i + 1}.member`;

        _type_check_input('object', tag, tag_position);
        if (tag === null || Array.isArray(tag)) {
            throw new RpcError('VALIDATION_ERROR',
                `1 validation error detected: Value ${tag} at '${tag_position}' failed to satisfy constraint: Member must be object`);
        }

        _type_check_input('string', tag.key, `${tag_position}.key`);
        _length_check_input(1, MAX_TAG_KEY_LENGTH, tag.key, `${tag_position}.key`);
        _validate_tag_pattern(tag.key, `${tag_position}.key`, false);

        _type_check_input('string', tag.value, `${tag_position}.value`);
        _length_check_input(undefined, MAX_TAG_VALUE_LENGTH, tag.value, `${tag_position}.value`);

        if (tag.value.length > 0) {
            _validate_tag_pattern(tag.value, `${tag_position}.value`, true);
        }
    }

    return true;
}

/**
 * validate_iam_tag_keys will validate tag keys array for UntagUser operation:
 * 1. Must be an array
 * 2. Can be empty (AWS accepts empty array)
 * 3. Maximum 50 tag keys per request (AWS limit)
 * 4. Each key must be a string
 * 5. Tag key: 1-128 characters
 * @param {Array} tag_keys
 */
function validate_iam_tag_keys(tag_keys) {
    const TAG_KEY_CONSTRAINTS = [
        `Member must have length less than or equal to ${MAX_TAG_KEY_LENGTH}`,
        'Member must have length greater than or equal to 1',
        `Member must satisfy regular expression pattern: ${TAG_KEY_PATTERN}`,
        'Member must not be null'
    ];

    if (!Array.isArray(tag_keys)) {
        throw new RpcError('VALIDATION_ERROR', 'Invalid type for parameter TagKeys, value must be an array');
    }

    if (tag_keys.length > iam_constants.MAX_TAGS) {
        const message_with_details = `1 validation error detected: Value at 'tagKeys' failed to satisfy constraint: ` +
            `Member must have length less than or equal to ${iam_constants.MAX_TAGS}`;
        throw new RpcError('VALIDATION_ERROR', message_with_details);
    }

    for (let i = 0; i < tag_keys.length; i++) {
        _type_check_input('string', tag_keys[i], 'tagKeys');

        if (_has_tag_key_violation(tag_keys[i])) {
            throw new RpcError('VALIDATION_ERROR',
                `1 validation error detected: Value at 'tagKeys' failed to satisfy constraint: Member must satisfy constraint: [${TAG_KEY_CONSTRAINTS.join(', ')}]`);
        }
    }

    return true;
}

// EXPORTS
exports.validate_username = validate_username;
exports.validate_iam_tags = validate_iam_tags;
exports.validate_iam_tag_keys = validate_iam_tag_keys;
exports._type_check_input = _type_check_input;
exports._length_check_input = _length_check_input;
exports._length_min_check_input = _length_min_check_input;
exports.validate_policy_name = validate_policy_name;
exports.validate_policy_document = validate_policy_document;
