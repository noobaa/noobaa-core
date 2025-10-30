/* Copyright (C) 2024 NooBaa */
'use strict';

const _ = require('lodash');
const { AWS_USERNAME_REGEXP, AWS_IAM_TAG_KEY_AND_VALUE_REGEXP } = require('../util/string_utils');
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
        const message_with_details = `Invalid type for parameter Tags, value must be an array`;
        throw new RpcError('VALIDATION_ERROR', message_with_details);
    }
    _length_max_check_input(50, tags, 'Tags');

    for (let i = 0; i < tags.length; i++) {
        const tag = tags[i];
        const tag_position = `Tags.member.${i + 1}`;

        _type_check_input('object', tag, tag_position);
        // reject null and arrays
        if (tag === null || Array.isArray(tag)) {
            const message_with_details = `1 validation error detected: Value ${tag} at ` +
                `'${tag_position}'  failed to satisfy constraint: Member must be object`;
            throw new RpcError('VALIDATION_ERROR', message_with_details);
        }
        _type_check_input('string', tag.key, `${tag_position}.Key`);
        _length_check_input(1, 128, tag.key, `${tag_position}.Key`);

        const valid_tag_key = AWS_IAM_TAG_KEY_AND_VALUE_REGEXP.test(tag.key);
        if (!valid_tag_key) {
            const message_with_details = `1 validation error detected: Value at '${tag_position}.Key' ` +
                `failed to satisfy constraint: Tag key can only contain letters, numbers, spaces, and the following characters: _.:/=+\\-@`;
            throw new RpcError('VALIDATION_ERROR', message_with_details);
        }

        _type_check_input('string', tag.value, `${tag_position}.Value`);
        _length_max_check_input(256, tag.value, `${tag_position}.Value`);

        // empty value is valid, only validate pattern if value is not empty
        if (tag.value.length > 0) {
            const valid_tag_value = AWS_IAM_TAG_KEY_AND_VALUE_REGEXP.test(tag.value);
            if (!valid_tag_value) {
                const message_with_details = `1 validation error detected: Value at '${tag_position}.Value' ` +
                    `failed to satisfy constraint: Tag value can only contain letters, numbers, spaces, and the following characters: _.:/=+\\-@`;
                throw new RpcError('VALIDATION_ERROR', message_with_details);
            }
        }
    }

    return true;
}

/**
 * validate_iam_tag_keys will validate tag keys array for UntagUser operation:
 * 1. Must be an array
 * 2. At least 1 tag key required
 * 3. Maximum 50 tag keys per request (AWS limit)
 * 4. Each key must be a string
 * 5. Tag key: 1-128 characters
 * @param {Array} tag_keys
 */
function validate_iam_tag_keys(tag_keys) {
    if (!Array.isArray(tag_keys)) {
        const message_with_details = `Invalid type for parameter TagKeys, value must be an array`;
        throw new RpcError('VALIDATION_ERROR', message_with_details);
    }
    _length_min_check_input(1, tag_keys, 'TagKeys');
    _length_max_check_input(50, tag_keys, 'TagKeys');

    for (let i = 0; i < tag_keys.length; i++) {
        const key = tag_keys[i];
        const key_position = `TagKeys.member.${i + 1}`;

        _type_check_input('string', key, key_position);
        _length_check_input(1, 128, key, key_position);
        const valid_tag_key = AWS_IAM_TAG_KEY_AND_VALUE_REGEXP.test(key);
        if (!valid_tag_key) {
            const message_with_details = `1 validation error detected: Value at '${key_position}' ` +
                `failed to satisfy constraint: Tag key can only contain letters, numbers, spaces, and the following characters: _.:/=+\\-@`;
            throw new RpcError('VALIDATION_ERROR', message_with_details);
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

