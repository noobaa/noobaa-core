/* Copyright (C) 2024 NooBaa */
'use strict';

const _ = require('lodash');
const s3_utils = require('../s3/s3_utils');
const { IamError } = require('./iam_errors');
const { AWS_IAM_PATH_REGEXP, AWS_IAM_LIST_MARKER, AWS_IAM_ACCESS_KEY_INPUT_REGEXP } = require('../../util/string_utils');
const iam_constants = require('./iam_constants');
const { RpcError } = require('../../rpc');
const validation_utils = require('../../util/validation_utils');

/**
 * format_iam_xml_date return the date without milliseconds
 * @param {any} input
 */
function format_iam_xml_date(input) {
    const date_iso = s3_utils.format_s3_xml_date(input);
    const date_iso_no_millis = date_iso.replace(/\.\d+/, ""); // remove the milliseconds part
    return date_iso_no_millis;
}

/**
 * create_arn_for_root creates the AWS ARN for root account user
 * see: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_identifiers.html#identifiers-arns
 * @param {string} account_id (the root user account id)
 */
function create_arn_for_root(account_id) {
    return `arn:aws:iam::${account_id}:root`;

}

/**
 * create_arn_for_user creates the AWS ARN for user
 * see: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_identifiers.html#identifiers-arns
 * @param {string} account_id (the root user account id)
 * @param {string} username
 * @param {string} iam_path
 */
function create_arn_for_user(account_id, username, iam_path) {
    const basic_structure = `arn:aws:iam::${account_id}:user`;
    if (username === undefined) return `${basic_structure}/`;
    if (check_iam_path_was_set(iam_path)) {
        return `${basic_structure}${iam_path}${username}`;
    }
    return `${basic_structure}/${username}`;
}

/**
 * get_action_message_title returns the full action name
 * @param {string} action (The action name as it is in AccountSpace)
 */
function get_action_message_title(action) {
    return `${iam_constants.IAM_SERVICE_SMALL_LETTERS}:${iam_constants.ACTION_MESSAGE_TITLE_MAP[action]}`;
}

/**
 * check_iam_path_was_set return true if the iam_path was set
 * @param {string} iam_path
 */
function check_iam_path_was_set(iam_path) {
    return iam_path && iam_path !== iam_constants.IAM_DEFAULT_PATH;
}

/**
 * parse_max_items converts the input to the needed type
 * assuming that we've got only sting type
 * @param {any} input_max_items
 */
function parse_max_items(input_max_items) {
    if (input_max_items === undefined) return;
    const input_type = 'number';
    const parameter_name = 'MaxItems';
    const value_as_number = Number(input_max_items);
    if (Number.isNaN(value_as_number)) {
        const message_with_details = `1 validation error detected: Value ${input_max_items} at ` +
        `'${parameter_name}' failed to satisfy constraint: Member must be ${input_type}`;
        const { code, http_code, type } = IamError.ValidationError;
        throw new IamError({ code, message: message_with_details, http_code, type });
    }
    return value_as_number;
}

/**
 * validate_params will call the aquivalent function in user or access key
 * @param {string} action
 * @param {object} params
 */
function validate_params(action, params) {
        if (action.includes('policy') || action.includes('policies')) {
            validate_policy_params(action, params);
        } else if (action.includes('user')) {
            validate_user_params(action, params);
        } else if (action.includes('access_key')) {
            validate_access_keys_params(action, params);
        } else {
            throw new RpcError('INTERNAL_ERROR', `${action} is not supported`);
        }
}

/**
 * validate_user_params will call the aquivalent function for each action in user API
 * @param {string} action
 * @param {object} params
 */
function validate_user_params(action, params) {
    switch (action) {
        case iam_constants.IAM_ACTIONS.CREATE_USER:
            validate_create_user(params);
          break;
        case iam_constants.IAM_ACTIONS.GET_USER:
            validate_get_user(params);
          break;
        case iam_constants.IAM_ACTIONS.UPDATE_USER:
            validate_update_user(params);
          break;
        case iam_constants.IAM_ACTIONS.DELETE_USER:
            validate_delete_user(params);
          break;
        case iam_constants.IAM_ACTIONS.LIST_USERS:
            validate_list_users(params);
          break;
        default:
          throw new RpcError('INTERNAL_ERROR', `${action} is not supported`);
      }
}

/**
 *  validate_access_keys_params will call the aquivalent function for each action in access key API
 * @param {string} action
 * @param {object} params
 */
function validate_access_keys_params(action, params) {
    switch (action) {
        case iam_constants.IAM_ACTIONS.CREATE_ACCESS_KEY:
            validate_create_access_key(params);
          break;
        case iam_constants.IAM_ACTIONS.GET_ACCESS_KEY_LAST_USED:
            validate_get_access_key_last_used(params);
          break;
        case iam_constants.IAM_ACTIONS.UPDATE_ACCESS_KEY:
            validate_update_access_key(params);
          break;
        case iam_constants.IAM_ACTIONS.DELETE_ACCESS_KEY:
            validate_delete_access_key(params);
          break;
        case iam_constants.IAM_ACTIONS.LIST_ACCESS_KEYS:
            validate_list_access_keys(params);
          break;
        default:
          throw new RpcError('INTERNAL_ERROR', `${action} is not supported`);
      }
}

/**
 * validate_policy_params will call the aquivalent function for each action in user policy API
 * @param {string} action
 * @param {object} params
 */
function validate_policy_params(action, params) {
    switch (action) {
        case iam_constants.IAM_ACTIONS.PUT_USER_POLICY:
            validate_put_user_policy(params);
            break;
        case iam_constants.IAM_ACTIONS.GET_USER_POLICY:
            validate_get_user_policy(params);
            break;
        case iam_constants.IAM_ACTIONS.DELETE_USER_POLICY:
            validate_delete_user_policy(params);
            break;
        case iam_constants.IAM_ACTIONS.LIST_USER_POLICIES:
            validate_list_user_policies(params);
            break;
        default:
          throw new RpcError('INTERNAL_ERROR', `${action} is not supported`);
      }
}

/**
 * check_required_username checks if the username was set
 * @param {object} params
 */
function check_required_username(params) {
    check_required_key(params.username, 'user-name');
}

/**
 * check_required_access_key_id checks if the access key id was set
 * @param {object} params
 */
function check_required_access_key_id(params) {
    check_required_key(params.access_key, 'access-key-id');
}

/**
 * check_required_status checks if the status was set
 * @param {object} params
 */
function check_required_status(params) {
    check_required_key(params.status, 'status');
}

/**
 * check_required_policy_name checks if the policy name was set
 * @param {object} params
 */
function check_required_policy_name(params) {
    check_required_key(params.policy_name, 'policy-name');
}

/**
 * check_required_policy_document checks if the policy document was set
 * @param {object} params
 */
function check_required_policy_document(params) {
    check_required_key(params.policy_document, 'policy-document');
}

/**
 * check_required_key checks if a required key was set
 * @param {any} value
 * @param {string} flag_name
 */
function check_required_key(value, flag_name) {
    if (value === undefined) {
        const message_with_details = `the following arguments are required: --${flag_name}`; // copied from AWS CLI
        const { code, http_code, type } = IamError.ValidationError;
        throw new IamError({ code, message: message_with_details, http_code, type });
    }
}

/**
 * validate_create_user checks the params for create_user action
 * @param {object} params
 */
function validate_create_user(params) {
    try {
        check_required_username(params);
        validation_utils.validate_username(params.username, iam_constants.IAM_PARAMETER_NAME.USERNAME);
        validate_iam_path(params.iam_path, iam_constants.IAM_PARAMETER_NAME.IAM_PATH);
    } catch (err) {
        translate_rpc_error(err);
    }
}

/**
 * validate_get_user checks the params for get_user action
 * @param {object} params
 */
function validate_get_user(params) {
    try {
        validation_utils.validate_username(params.username, iam_constants.IAM_PARAMETER_NAME.USERNAME);
    } catch (err) {
        translate_rpc_error(err);
    }
}

/**
 * validate_update_user checks the params for update_user action
 * @param {object} params
 */
function validate_update_user(params) {
    try {
        check_required_username(params);
        validation_utils.validate_username(params.username, iam_constants.IAM_PARAMETER_NAME.USERNAME);
        validation_utils.validate_username(params.new_username, iam_constants.IAM_PARAMETER_NAME.NEW_USERNAME);
        validate_iam_path(params.new_iam_path, iam_constants.IAM_PARAMETER_NAME.NEW_IAM_PATH);
    } catch (err) {
        translate_rpc_error(err);
    }
}

/**
 * validate_delete_user checks the params for delete_user action
 * @param {object} params
 */
function validate_delete_user(params) {
    try {
        check_required_username(params);
        validation_utils.validate_username(params.username, iam_constants.IAM_PARAMETER_NAME.USERNAME);
    } catch (err) {
        translate_rpc_error(err);
    }
}

/**
 * validate_list_users checks the params for list_users action
 * @param {object} params
 */
function validate_list_users(params) {
    try {
        validate_marker(params.marker);
        validate_max_items(params.max_items);
        validate_iam_path(params.iam_path_prefix, iam_constants.IAM_PARAMETER_NAME.IAM_PATH_PREFIX);
    } catch (err) {
        translate_rpc_error(err);
    }
}

/**
 * validate_create_access_key checks the params for create_access_key action
 * @param {object} params
 */
function validate_create_access_key(params) {
    try {
        validation_utils.validate_username(params.username, iam_constants.IAM_PARAMETER_NAME.USERNAME);
    } catch (err) {
        translate_rpc_error(err);
    }
}

/**
 * validate_get_access_key_last_used checks the params for get_access_key_last_used action
 * @param {object} params
 */
function validate_get_access_key_last_used(params) {
    try {
        check_required_access_key_id(params);
        validate_access_key_id(params.access_key);
    } catch (err) {
        translate_rpc_error(err);
    }
}

/**
 * validate_update_access_key checks the params for update_access_key action
 * @param {object} params
 */
function validate_update_access_key(params) {
    try {
        check_required_access_key_id(params);
        check_required_status(params);
        validate_access_key_id(params.access_key);
        validate_status(params.status);
        validation_utils.validate_username(params.username, iam_constants.IAM_PARAMETER_NAME.USERNAME);
    } catch (err) {
        translate_rpc_error(err);
    }
}

/**
 * validate_delete_access_key checks the params for delete_access_key action
 * @param {object} params
 */
function validate_delete_access_key(params) {
    try {
        check_required_access_key_id(params);
        validate_access_key_id(params.access_key);
        validation_utils.validate_username(params.username, iam_constants.IAM_PARAMETER_NAME.USERNAME);
    } catch (err) {
        translate_rpc_error(err);
    }
}

/**
 * validate_list_access_keys checks the params for list_access_keys action
 * @param {object} params
 */
function validate_list_access_keys(params) {
    try {
        validate_marker(params.marker);
        validate_max_items(params.max_items);
        validation_utils.validate_username(params.username, iam_constants.IAM_PARAMETER_NAME.USERNAME);
    } catch (err) {
        translate_rpc_error(err);
    }
}

/**
 * validate_put_user_policy checks the params for put_user_policy action
 * @param {object} params
 */
function validate_put_user_policy(params) {
    try {
        check_required_username(params);
        validation_utils.validate_username(params.username, iam_constants.IAM_PARAMETER_NAME.USERNAME);
        check_required_policy_name(params);
        validation_utils.validate_policy_name(params.policy_name, iam_constants.IAM_PARAMETER_NAME.POLICY_NAME);
        check_required_policy_document(params);
        validation_utils.validate_policy_document(params.policy_document, iam_constants.IAM_PARAMETER_NAME.POLICY_DOCUMENT);
    } catch (err) {
        translate_rpc_error(err);
    }
}

/**
 * validate_get_user_policy checks the params for get_user_policy action
 * @param {object} params
 */
function validate_get_user_policy(params) {
    try {
        check_required_username(params);
        validation_utils.validate_username(params.username, iam_constants.IAM_PARAMETER_NAME.USERNAME);
        check_required_policy_name(params);
        validation_utils.validate_policy_name(params.policy_name, iam_constants.IAM_PARAMETER_NAME.POLICY_NAME);
    } catch (err) {
        translate_rpc_error(err);
    }
}

/**
 * validate_delete_user_policy checks the params for delete_user_policy action
 * @param {object} params
 */
function validate_delete_user_policy(params) {
    try {
        check_required_username(params);
        validation_utils.validate_username(params.username, iam_constants.IAM_PARAMETER_NAME.USERNAME);
        check_required_policy_name(params);
        validation_utils.validate_policy_name(params.policy_name, iam_constants.IAM_PARAMETER_NAME.POLICY_NAME);
    } catch (err) {
        translate_rpc_error(err);
    }
}

/**
 * validate_list_user_policies checks the params for list_user_policies action
 * @param {object} params
 */
function validate_list_user_policies(params) {
    try {
        validate_marker(params.marker);
        validate_max_items(params.max_items);
        check_required_username(params);
        validation_utils.validate_username(params.username, iam_constants.IAM_PARAMETER_NAME.USERNAME);
    } catch (err) {
        translate_rpc_error(err);
    }
}

/**
 * validate_iam_path will validate:
 * 1. type
 * 2. length
 * 3. regex (from AWS docs)
 * @param {string} input_path
 * @param {string} parameter_name
 */
function validate_iam_path(input_path, parameter_name = iam_constants.IAM_PARAMETER_NAME.IAM_PATH) {
    try {
        if (input_path === undefined) return;
        // type check
        validation_utils._type_check_input('string', input_path, parameter_name);
        // length check
        const min_length = 1;
        const max_length = 512;
        validation_utils._length_check_input(min_length, max_length, input_path, parameter_name);
        // regex check
        const valid_aws_path = input_path.startsWith('/') && input_path.endsWith('/') && AWS_IAM_PATH_REGEXP.test(input_path);
        if (!valid_aws_path) {
                const message_with_details = `The specified value for ${_.lowerFirst(parameter_name)} is invalid. ` +
                `It must begin and end with / and contain only alphanumeric characters and/or / characters.`;
                const { code, http_code, type } = IamError.ValidationError;
                throw new IamError({ code, message: message_with_details, http_code, type });
        }
        return true;
    } catch (err) {
        translate_rpc_error(err);
    }
}

/**
 * validate_marker will validate:
 * 1. type
 * 2. length
 * 3. regex (from AWS docs)
 * @param {string} input_marker
 */
function validate_marker(input_marker) {
    try {
        const parameter_name = 'Marker';
        if (input_marker === undefined) return;
        // type check
        validation_utils._type_check_input('string', input_marker, parameter_name);
        // length check
        const min_length = 1;
        validation_utils._length_min_check_input(min_length, input_marker, parameter_name);
        // regex check
        const valid_marker = AWS_IAM_LIST_MARKER.test(input_marker);
        if (!valid_marker) {
                const message_with_details = `The specified value for ${_.lowerFirst(parameter_name)} is invalid. `;
                const { code, http_code, type } = IamError.ValidationError;
                throw new IamError({ code, message: message_with_details, http_code, type });
        }
        return true;
    } catch (err) {
        translate_rpc_error(err);
    }
}

/**
 * validate_max_items will validate:
 * 1. type
 *    (note: in the flow the type is validated when parse the value)
 * 2. length
 * @param {number} input_max_items
 */
function validate_max_items(input_max_items) {
    const parameter_name = 'MaxItems';
    if (input_max_items === undefined) return;
    // type check
    validation_utils._type_check_input('number', input_max_items, parameter_name);
    // value check
    const min_value = 1;
    const max_value = 1000;
    if (input_max_items < min_value) {
        // using AWS CLI there is not actual validation for this (can even send zero and negative value)
        const message_with_details = `Invalid value for parameter ${_.lowerFirst(parameter_name)}, ` +
            `value: ${input_max_items}, valid min: ${min_value}`;
        const { code, http_code, type } = IamError.ValidationError;
        throw new IamError({ code, message: message_with_details, http_code, type });
    }
    if (input_max_items > max_value) {
        // using AWS CLI there is not actual validation for this (can send 2000 value)
        const message_with_details = `Invalid value for parameter ${parameter_name}, ` +
            `value: ${input_max_items}, valid max: ${min_value}`;
        const { code, http_code, type } = IamError.ValidationError;
        throw new IamError({ code, message: message_with_details, http_code, type });
    }
    return true;
}

/**
 * validate_access_key_id will validate:
 * 1. type
 * 2. length
 * 3. regex (from AWS docs)
 * @param {string} input_access_key_id
 */
function validate_access_key_id(input_access_key_id) {
    try {
        const parameter_name = 'AccessKeyId';
        if (input_access_key_id === undefined) return;
        // type check
        validation_utils._type_check_input('string', input_access_key_id, parameter_name);
        // length check
        const min_length = 16;
        const max_length = 128;
        validation_utils._length_check_input(min_length, max_length, input_access_key_id, parameter_name);
        // regex check
        const valid_access_key_id = AWS_IAM_ACCESS_KEY_INPUT_REGEXP.test(input_access_key_id);
        if (!valid_access_key_id) {
                const message_with_details = `The specified value for ${_.lowerFirst(parameter_name)} is invalid. ` +
                `It must contain only alphanumeric characters`;
                const { code, http_code, type } = IamError.ValidationError;
                throw new IamError({ code, message: message_with_details, http_code, type });
        }
        return true;
    } catch (err) {
        translate_rpc_error(err);
    }
}

/**
 * validate_status will validate:
 * the the input is only from the defined enum
 * @param {string} input_status
 */
function validate_status(input_status) {
    const parameter_name = 'Status';
    if (input_status === undefined) return;
    if (input_status !== iam_constants.ACCESS_KEY_STATUS_ENUM.ACTIVE &&
        input_status !== iam_constants.ACCESS_KEY_STATUS_ENUM.INACTIVE) {
        const message_with_details = `Value ${input_status} at '${parameter_name}' ` +
            `failed to satisfy constraint: Member must satisfy enum value set: ` +
            `[${iam_constants.ACCESS_KEY_STATUS_ENUM.ACTIVE}, ${iam_constants.ACCESS_KEY_STATUS_ENUM.INACTIVE}]`;
        const { code, http_code, type } = IamError.ValidationError;
        throw new IamError({ code, message: message_with_details, http_code, type });
    }
    return true;
}

/**
 * translate_rpc_error is used to translate the RPC error in-place
 * @param {{ rpc_code: string; message: string; }} err
 */
function translate_rpc_error(err) {
    if (err.rpc_code === 'VALIDATION_ERROR') {
        const { code, http_code, type } = IamError.ValidationError;
        throw new IamError({ code, message: err.message, http_code, type });
    }
    throw err;
}

// EXPORTS
exports.format_iam_xml_date = format_iam_xml_date;
exports.create_arn_for_user = create_arn_for_user;
exports.create_arn_for_root = create_arn_for_root;
exports.get_action_message_title = get_action_message_title;
exports.check_iam_path_was_set = check_iam_path_was_set;
exports.parse_max_items = parse_max_items;
exports.validate_params = validate_params;
exports.validate_iam_path = validate_iam_path;
exports.validate_marker = validate_marker;
exports.validate_access_key_id = validate_access_key_id;
exports.validate_status = validate_status;

