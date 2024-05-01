/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const s3_utils = require('../s3/s3_utils');

const IAM_DEFAULT_PATH = '/';
const AWS_NOT_USED = 'N/A'; // can be used in case the region or the service name were not used
const IAM_SERVICE_SMALL_LETTERS = 'iam';

// key: action - the function name on accountspace_fs (snake case style)
// value: AWS action name (camel case style)
// we use it for error message to match AWS style 
const ACTION_MESSAGE_TITLE_MAP = {
    'create_user': 'CreateUser',
    'get_user': 'GetUser',
    'delete_user': 'DeleteUser',
    'update_user': 'UpdateUser',
    'list_users': 'ListUsers',
    'create_access_key': 'CreateAccessKey',
    'get_access_key_last_used': 'GetAccessKeyLastUsed',
    'update_access_key': 'UpdateAccessKey',
    'delete_access_key': 'DeleteAccessKey',
    'list_access_keys': 'ListAccessKeys',
};

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
 * create_arn creates the AWS ARN for user
 * see: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_identifiers.html#identifiers-arns
 * @param {string} account_id (the root user account id)
 * @param {string} username
 * @param {string} iam_path
 */
function create_arn(account_id, username, iam_path) {
    const basic_structure = `arn:aws:iam::${account_id}:user`;
    if (_.isUndefined(username)) return `${basic_structure}/`;
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
    return `${IAM_SERVICE_SMALL_LETTERS}:${ACTION_MESSAGE_TITLE_MAP[action]}`;
}

/**
 * check_iam_path_was_set return true if the iam_path was set
 * @param {string} iam_path
 */
function check_iam_path_was_set(iam_path) {
    return iam_path && iam_path !== IAM_DEFAULT_PATH;
}

// EXPORTS
exports.format_iam_xml_date = format_iam_xml_date;
exports.create_arn = create_arn;
exports.IAM_DEFAULT_PATH = IAM_DEFAULT_PATH;
exports.AWS_NOT_USED = AWS_NOT_USED;
exports.get_action_message_title = get_action_message_title;
exports.check_iam_path_was_set = check_iam_path_was_set;
