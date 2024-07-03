/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../util/debug_module')(__filename);
const _ = require('lodash');
const path = require('path');
const nb_native = require('../util/nb_native');
const native_fs_utils = require('../util/native_fs_utils');
const ManageCLIError = require('../manage_nsfs/manage_nsfs_cli_errors').ManageCLIError;
const NSFS_CLI_ERROR_EVENT_MAP = require('../manage_nsfs/manage_nsfs_cli_errors').NSFS_CLI_ERROR_EVENT_MAP;
const ManageCLIResponse = require('../manage_nsfs/manage_nsfs_cli_responses').ManageCLIResponse;
const NSFS_CLI_SUCCESS_EVENT_MAP = require('../manage_nsfs/manage_nsfs_cli_responses').NSFS_CLI_SUCCESS_EVENT_MAP;
const { BOOLEAN_STRING_VALUES } = require('../manage_nsfs/manage_nsfs_constants');
const NoobaaEvent = require('../manage_nsfs/manage_nsfs_events_utils').NoobaaEvent;
const mongo_utils = require('../util/mongo_utils');

function throw_cli_error(error, detail, event_arg) {
    const error_event = NSFS_CLI_ERROR_EVENT_MAP[error.code];
    if (error_event) {
        new NoobaaEvent(error_event).create_event(undefined, event_arg, undefined);
    }
    const err = new ManageCLIError({ ...error, detail });
    throw err;
}

function write_stdout_response(response_code, detail, event_arg) {
    const response_event = NSFS_CLI_SUCCESS_EVENT_MAP[response_code.code];
    if (response_event) {
        new NoobaaEvent(response_event).create_event(undefined, event_arg, undefined);
    }
    const res = new ManageCLIResponse(response_code).to_string(detail);
    process.stdout.write(res + '\n', () => {
        process.exit(0);
    });
}

function get_config_file_path(config_type_path, file_name) {
    return path.join(config_type_path, file_name + '.json');
}

function get_symlink_config_file_path(config_type_path, file_name) {
    return path.join(config_type_path, file_name + '.symlink');
}

/**
 * get_config_data will read a config file and return its content 
 * while omitting secrets if show_secrets flag was not provided
 * @param {string} config_file_path
 * @param {boolean} [show_secrets]
 */
async function get_config_data(config_root_backend, config_file_path, show_secrets = false) {
    const fs_context = native_fs_utils.get_process_fs_context(config_root_backend);
    const { data } = await nb_native().fs.readFile(fs_context, config_file_path);
    const config_data = _.omit(JSON.parse(data.toString()), show_secrets ? [] : ['access_keys']);
    return config_data;
}

/**
 * get_config_data_if_exists will read a config file and return its content 
 * while omitting secrets if show_secrets flag was not provided
 * if the config file was deleted (encounter ENOENT error) - continue (returns undefined)
 * @param {string} config_file_path
 * @param {boolean} [show_secrets]
 */
async function get_config_data_if_exists(config_root_backend, config_file_path, show_secrets = false) {
    try {
        const config_data = await get_config_data(config_root_backend, config_file_path, show_secrets);
        return config_data;
    } catch (err) {
        dbg.warn('get_config_data_if_exists: with config_file_path', config_file_path, 'got an error', err);
        if (err.code !== 'ENOENT') throw err;
    }
}

/**
 * get_bucket_owner_account will return the account of the bucket_owner
 * otherwise it would throw an error
 * @param {string} config_root_backend
 * @param {string} accounts_dir_path
 * @param {string} bucket_owner
 */
async function get_bucket_owner_account(config_root_backend, accounts_dir_path, bucket_owner) {
    const account_config_path = get_config_file_path(accounts_dir_path, bucket_owner);
    try {
        const account = await get_config_data(config_root_backend, account_config_path);
        return account;
    } catch (err) {
        if (err.code === 'ENOENT') {
            const detail_msg = `bucket owner ${bucket_owner} does not exists`;
            throw_cli_error(ManageCLIError.BucketSetForbiddenNoBucketOwner, detail_msg, {bucket_owner: bucket_owner});
        }
        throw err;
    }
}

/**
 * get_boolean_or_string_value will check if the value
 * 1. if the value is undefined - it returns false.
 * 2. (the value is defined) if it a string 'true' or 'false' = then we set boolean respectively.
 * 3. (the value is defined) then we set true (Boolean convert of this case will be true).
 * @param {boolean|string} value
 */
function get_boolean_or_string_value(value) {
    if (_.isUndefined(value)) {
        return false;
    } else if (typeof value === 'string' && BOOLEAN_STRING_VALUES.includes(value.toLowerCase())) {
        return value.toLowerCase() === 'true';
    } else { // boolean type
        return Boolean(value);
    }
}

/**
 * get_options_from_file will read a JSON file that include key-value of the options 
 * (instead of flags) and return its content
 * @param {string} file_path
 */
async function get_options_from_file(file_path) {
    // we don't pass neither config_root_backend nor fs_backend
    const fs_context = native_fs_utils.get_process_fs_context();
    try {
        const input_options_with_data = await native_fs_utils.read_file(fs_context, file_path);
        return input_options_with_data;
    } catch (err) {
        if (err.code === 'ENOENT') throw_cli_error(ManageCLIError.InvalidFilePath, file_path);
        if (err instanceof SyntaxError) throw_cli_error(ManageCLIError.InvalidJSONFile, file_path);
        throw err;
    }
}

/**
 * has_access_keys will return if the array has at least one object of access keys
 * (depending on the access key length)
 * Note: when there is no access key array it might indicate that it is anonymous account
 * @param {object[]} access_keys
 */
function has_access_keys(access_keys) {
    return access_keys.length > 0;
}

/**
 * set_debug_level will set the debug log level
 * @param {string} debug
 */
function set_debug_level(debug) {
    const debug_level = Number(debug) || 5;
    dbg.set_module_level(debug_level, 'core');
    nb_native().fs.set_debug_level(debug_level);
}

/**
 * generate_id will generate an id that we use to identify entities (such as account, bucket, etc.). 
 */
// TODO: 
// - reuse this function in NC NSFS where we used the mongo_utils module
// - this function implantation should be db_client.new_object_id(), 
//   but to align with manage nsfs we won't change it now
function generate_id() {
    return mongo_utils.mongoObjectId();
}

/**
 * check_root_account_owns_user checks if an account is owned by root account
 * @param {object} root_account
 * @param {object} account
 */
function check_root_account_owns_user(root_account, account) {
    if (account.owner === undefined) return false;
    return root_account._id === account.owner;
}


// EXPORTS
exports.throw_cli_error = throw_cli_error;
exports.write_stdout_response = write_stdout_response;
exports.get_config_file_path = get_config_file_path;
exports.get_symlink_config_file_path = get_symlink_config_file_path;
exports.get_boolean_or_string_value = get_boolean_or_string_value;
exports.get_config_data = get_config_data;
exports.get_bucket_owner_account = get_bucket_owner_account;
exports.get_options_from_file = get_options_from_file;
exports.has_access_keys = has_access_keys;
exports.generate_id = generate_id;
exports.set_debug_level = set_debug_level;
exports.check_root_account_owns_user = check_root_account_owns_user;
exports.get_config_data_if_exists = get_config_data_if_exists;
