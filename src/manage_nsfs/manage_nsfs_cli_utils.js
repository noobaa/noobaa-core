/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../util/debug_module')(__filename);
const os_util = require('../util/os_utils');
const nb_native = require('../util/nb_native');
const native_fs_utils = require('../util/native_fs_utils');
const ManageCLIError = require('../manage_nsfs/manage_nsfs_cli_errors').ManageCLIError;
const NSFS_CLI_ERROR_EVENT_MAP = require('../manage_nsfs/manage_nsfs_cli_errors').NSFS_CLI_ERROR_EVENT_MAP;
const ManageCLIResponse = require('../manage_nsfs/manage_nsfs_cli_responses').ManageCLIResponse;
const NSFS_CLI_SUCCESS_EVENT_MAP = require('../manage_nsfs/manage_nsfs_cli_responses').NSFS_CLI_SUCCESS_EVENT_MAP;
const { BOOLEAN_STRING_VALUES } = require('../manage_nsfs/manage_nsfs_constants');
const NoobaaEvent = require('../manage_nsfs/manage_nsfs_events_utils').NoobaaEvent;
const { account_id_cache } = require('../sdk/accountspace_fs');

const NOOBAA_SERVICE_NAME = 'noobaa';

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

/**
 * get_bucket_owner_account_by_name will return the account of the bucket_owner
 * otherwise it would throw an error
 * @param {import('../sdk/config_fs').ConfigFS} config_fs
 * @param {string} bucket_owner
 */
async function get_bucket_owner_account_by_name(config_fs, bucket_owner) {
    try {
        const account = await config_fs.get_account_by_name(bucket_owner);
        return account;
    } catch (err) {
        if (err.code === 'ENOENT') {
            const detail_msg = `bucket owner name ${bucket_owner} does not exist`;
            throw_cli_error(ManageCLIError.BucketSetForbiddenBucketOwnerNotExists, detail_msg, {bucket_owner: bucket_owner});
        }
        throw err;
    }
}

/**
 * get_bucket_owner_account_by_id will return the account of the owner_account id
 * otherwise it would throw an error
 * @param {import('../sdk/config_fs').ConfigFS} config_fs
 * @param {string} owner_account
 * @param {boolean} show_secrets
 * @param {boolean} decrypt_secret_key
 */
async function get_bucket_owner_account_by_id(config_fs, owner_account, show_secrets = true, decrypt_secret_key = true) {
    try {
        const account = await account_id_cache.get_with_cache({ _id: owner_account, show_secrets, decrypt_secret_key, config_fs });
        return account;
    } catch (err) {
        if (err.code === 'ENOENT') {
            const detail_msg = `bucket owner account id ${owner_account} does not exist`;
            throw_cli_error(ManageCLIError.BucketSetForbiddenBucketOwnerNotExists, detail_msg, { owner_account: owner_account });
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
    if (value === undefined) {
        return false;
    } else if (typeof value === 'string' && BOOLEAN_STRING_VALUES.includes(value.toLowerCase())) {
        return value.toLowerCase() === 'true';
    } else { // boolean type
        return Boolean(value);
    }
}

/**
 * This function parse a comma delimited string of numbers ('0,212,111') to an array of numbers.
 * This function assumes string format was validated before calling the function, wrong string format can
 * lead to unexpected output (usually array of NaN)
 * 1. if the value is a number return array with this number (3 => [3])
 * 2. if the value is a string:
 *   2.1 if value is an empty string (""). unset the value
 *   2.2 else return an array of numbers ('0,212,111' => [0,212,111])
 * 3. for all other types (including object and undefined) return the value itself
 */
function parse_comma_delimited_string(value) {
    if (typeof value === 'number') {
        return [value];
    }
    if (typeof value === 'string') {
        if (value === '') {
            return undefined;
        }
        return value.split(',').map(val => Number(val));
    }
    return value;
}

/**_
 * get_options_fromfile will read a JSON file that include key-value of the options
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
 * is_name_update returns true if a new_name flag was provided and it's not equal to 
 * the current name
 * @param {Object} data
 * @returns {Boolean} 
 */
function is_name_update(data) {
    const cur_name = data.name;
    const new_name = data.new_name;
    return new_name && cur_name && new_name !== cur_name;
}

/**
 * is_access_key_update returns true if a new_access_key flag was provided and it's not equal to 
 * the current access_key at index 0
 * @param {Object} data
 * @returns {Boolean} 
 */
function is_access_key_update(data) {
    const cur_access_key = has_access_keys(data.access_keys) ? data.access_keys[0].access_key.unwrap() : undefined;
    const new_access_key = data.new_access_key;
    return new_access_key && cur_access_key && new_access_key !== cur_access_key;
}

/**
 * get_service_status returns the active state of a service
 * TODO: probablt better to return boolean but requires refactoring in Health script
 * @param {String} service_name 
 * @returns {Promise<String>}
 */
async function get_service_status(service_name) {
    let service_status;
    try {
        service_status = await os_util.exec('systemctl show -p ActiveState --value ' + service_name, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true,
        });
    } catch (err) {
        dbg.warn('could not receive service active state', service_name, err);
        service_status = 'missing service status info';
    }
    return service_status;
}

/**
 * is_desired_time returns true if the given time matches with
 * the desired time or if 
 * @param {nb.NativeFSContext} fs_context 
 * @param {Date} current
 * @param {string} desire time in format 'hh:mm'
 * @param {number} delay_limit_mins
 * @param {string} timestamp_file_path 
 * @param {"UTC" | "LOCAL"} timezone
 * @returns {Promise<boolean>}
 */
async function is_desired_time(fs_context, current, desire, delay_limit_mins, timestamp_file_path, timezone) {
    const [desired_hour, desired_min] = desire.split(':').map(Number);
    if (
        isNaN(desired_hour) ||
        isNaN(desired_min) ||
        (desired_hour < 0 || desired_hour >= 24) ||
        (desired_min < 0 || desired_min >= 60)
    ) {
        throw new Error('invalid desired_time - must be hh:mm');
    }

    const min_time = get_tz_date(desired_hour, desired_min, 0, timezone);
    const max_time = get_tz_date(desired_hour, desired_min + delay_limit_mins, 0, timezone);

    if (current >= min_time && current <= max_time) {
        try {
            const { data } = await nb_native().fs.readFile(fs_context, timestamp_file_path);
            const lastrun = new Date(data.toString());

            // Last run should NOT be in this window
            if (lastrun >= min_time && lastrun <= max_time) return false;
        } catch (error) {
            if (error.code === 'ENOENT') return true;
            console.error('failed to read last run timestamp:', error, 'timestamp_file_path:', timestamp_file_path);

            throw error;
        }

        return true;
    }

    return false;
}


/**
 * record_current_time stores the current timestamp in ISO format into
 * the given timestamp file
 * @param {nb.NativeFSContext} fs_context 
 * @param {string} timestamp_file_path 
 */
async function record_current_time(fs_context, timestamp_file_path) {
    await nb_native().fs.writeFile(
        fs_context,
        timestamp_file_path,
        Buffer.from(new Date().toISOString()),
    );
}

/**
 * @param {number} hours
 * @param {number} mins
 * @param {number} secs
 * @param {'UTC' | 'LOCAL'} tz
 * @returns {Date}
 */
function get_tz_date(hours, mins, secs, tz) {
    const date = new Date();

    if (tz === 'UTC') {
        date.setUTCHours(hours);
        date.setUTCMinutes(hours);
        date.setUTCSeconds(secs);
        date.setUTCMilliseconds(0);
    } else {
        date.setHours(hours);
        date.setMinutes(mins);
        date.setSeconds(secs);
        date.setMilliseconds(0);
    }

    return date;
}

// EXPORTS
exports.throw_cli_error = throw_cli_error;
exports.write_stdout_response = write_stdout_response;
exports.get_boolean_or_string_value = get_boolean_or_string_value;
exports.parse_comma_delimited_string = parse_comma_delimited_string;
exports.get_bucket_owner_account_by_name = get_bucket_owner_account_by_name;
exports.get_bucket_owner_account_by_id = get_bucket_owner_account_by_id;
exports.get_options_from_file = get_options_from_file;
exports.has_access_keys = has_access_keys;
exports.set_debug_level = set_debug_level;
exports.is_name_update = is_name_update;
exports.is_access_key_update = is_access_key_update;
exports.get_service_status = get_service_status;
exports.NOOBAA_SERVICE_NAME = NOOBAA_SERVICE_NAME;
exports.is_desired_time = is_desired_time;
exports.record_current_time = record_current_time;
exports.get_tz_date = get_tz_date;
