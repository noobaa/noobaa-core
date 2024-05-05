/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../util/debug_module')(__filename);
const _ = require('lodash');
const path = require('path');
const net = require('net');
const P = require('../util/promise');
const nb_native = require('../util/nb_native');
const string_utils = require('../util/string_utils');
const native_fs_utils = require('../util/native_fs_utils');
const ManageCLIError = require('../manage_nsfs/manage_nsfs_cli_errors').ManageCLIError;
const bucket_policy_utils = require('../endpoint/s3/s3_bucket_policy_utils');
const { throw_cli_error, get_config_file_path, get_bucket_owner_account,
    get_config_data, get_options_from_file } = require('../manage_nsfs/manage_nsfs_cli_utils');
const { TYPES, ACTIONS, VALID_OPTIONS, OPTION_TYPE, FROM_FILE, BOOLEAN_STRING_VALUES,
    GLACIER_ACTIONS, LIST_UNSETABLE_OPTIONS } = require('../manage_nsfs/manage_nsfs_constants');

/////////////////////////////
//// GENERAL VALIDATIONS ////
/////////////////////////////

/** 
 * validate_input_types checks if input option are valid.
 * if the the user uses from_file then the validation is on the file (in different iteration)
 * @param {string} type
 * @param {string} action
 * @param {object} argv
 */
async function validate_input_types(type, action, argv) {
    validate_type_and_action(type, action);
    // when we use validate_no_extra_options we don't care about the value, only the flags
    const input_options = Object.keys(argv);
    const input_options_with_data = { ...argv };
    // the first element is _ with the type and action, so we remove it
    input_options.shift();
    delete input_options_with_data._;
    validate_no_extra_options(type, action, input_options, false);
    validate_options_type_by_value(input_options_with_data);
    if (action === ACTIONS.UPDATE) validate_min_flags_for_update(type, input_options_with_data);

    // currently we use from_file only in add action
    const path_to_json_options = argv.from_file ? String(argv.from_file) : '';
    if ((type === TYPES.ACCOUNT || type === TYPES.BUCKET) && action === ACTIONS.ADD && path_to_json_options) {
        const input_options_with_data_from_file = await get_options_from_file(path_to_json_options);
        const input_options_from_file = Object.keys(input_options_with_data_from_file);
        if (input_options_from_file.includes(FROM_FILE)) {
            const details = `${FROM_FILE} should not be passed inside json options`;
            throw_cli_error(ManageCLIError.InvalidArgument, details);
        }
        validate_no_extra_options(type, action, input_options_from_file, true);
        validate_options_type_by_value(input_options_with_data_from_file);
        return input_options_with_data_from_file;
    }
}

/**
 * validate_type_and_action checks that the type and action are supported
 * @param {string} type
 * @param {string} action
 */
function validate_type_and_action(type, action) {
    if (!Object.values(TYPES).includes(type)) throw_cli_error(ManageCLIError.InvalidType);
    if (type === TYPES.ACCOUNT || type === TYPES.BUCKET) {
        if (!Object.values(ACTIONS).includes(action)) throw_cli_error(ManageCLIError.InvalidAction);
    } else if (type === TYPES.IP_WHITELIST) {
        if (action !== '') throw_cli_error(ManageCLIError.InvalidAction);
    } else if (type === TYPES.GLACIER) {
        if (!Object.values(GLACIER_ACTIONS).includes(action)) throw_cli_error(ManageCLIError.InvalidAction);
    }
}

/**
 * validate_no_extra_options will check that input flags are valid options - 
 * only required arguments, optional flags and global configurations
 * @param {string} type
 * @param {string} action
 * @param {string[]} input_options array with the names of the flags
 * @param {boolean} is_options_from_file boolean to indicates that the validation is on values that origin from the file
 */
function validate_no_extra_options(type, action, input_options, is_options_from_file) {
    let valid_options; // for performance, we use Set as data structure
    const from_file_condition = (type === TYPES.ACCOUNT || type === TYPES.BUCKET) &&
        action === ACTIONS.ADD && input_options.includes(FROM_FILE);
    if (from_file_condition) {
        valid_options = VALID_OPTIONS.from_file_options;
    } else if (type === TYPES.BUCKET) {
        valid_options = VALID_OPTIONS.bucket_options[action];
    } else if (type === TYPES.ACCOUNT) {
        valid_options = VALID_OPTIONS.account_options[action];
    } else if (type === TYPES.GLACIER) {
        valid_options = VALID_OPTIONS.glacier_options[action];
    } else {
        valid_options = VALID_OPTIONS.whitelist_options;
    }

    if (is_options_from_file) {
        valid_options.delete('from_file');
        valid_options.delete('config_root');
        valid_options.delete('config_root_backend');
    }

    const invalid_input_options = input_options.filter(element => !valid_options.has(element));
    if (invalid_input_options.length > 0) {
        const type_and_action = type === TYPES.IP_WHITELIST ? type : `${type} ${action}`;
        const invalid_option_msg = invalid_input_options.length === 1 ?
        `${invalid_input_options[0]} is an invalid option` :
        `${invalid_input_options.join(', ')} are invalid options`;
        const supported_option_msg = `Supported options are: ${[...valid_options].join(', ')}`;
        let details = `${invalid_option_msg} for ${type_and_action}. ${supported_option_msg}`;
        if (from_file_condition) details += ` (when using ${FROM_FILE} flag only partial list of flags are supported)`;
        throw_cli_error(ManageCLIError.InvalidArgument, details);
    }
}

/**
 * validate_options_type_by_value check the type of the value that match what we expect.
 * @param {object} input_options_with_data object with flag (key) and value
 */
function validate_options_type_by_value(input_options_with_data) {
    for (const [option, value] of Object.entries(input_options_with_data)) {
        const type_of_option = OPTION_TYPE[option];
        const type_of_value = typeof value;
        if (type_of_value !== type_of_option) {
            // special case for unset value (specified by '').
            if (LIST_UNSETABLE_OPTIONS.includes(option) && value === '') {
                continue;
            }
            // special case for names, although the type is string we want to allow numbers as well
            if ((option === 'name' || option === 'new_name') && (type_of_value === 'number')) {
                continue;
            }
            // special case for boolean values
            if (['allow_bucket_creation', 'regenerate', 'wide', 'show_secrets', 'force', 'force_md5_etag'].includes(option) && validate_boolean_string_value(value)) {
                continue;
            }
            // special case for bucket_policy (from_file)
            if (option === 'bucket_policy' && type_of_value === 'object') {
                continue;
            }
            const details = `type of flag ${option} should be ${type_of_option}`;
            throw_cli_error(ManageCLIError.InvalidArgumentType, details);
        }
    }
}

/**
 * validate_boolean_string_value is used when the option type is boolean
 * and we wish to allow the command also to to accept 'true' and 'false' values.
 * @param {boolean|string} value
 */
function validate_boolean_string_value(value) {
    if (value && typeof value === 'string') {
        const check_allowed_boolean_value = BOOLEAN_STRING_VALUES.includes(value.toLowerCase());
        if (!check_allowed_boolean_value) {
            throw_cli_error(ManageCLIError.InvalidBooleanValue);
        }
        return true;
    }
    return false;
}

/**
 * validate_min_flags_for_update validates that we have at least one flag of a property to update
 * @param {string} type
 * @param {object} input_options_with_data
 */
function validate_min_flags_for_update(type, input_options_with_data) {
    const input_options = Object.keys(input_options_with_data);
    const config_and_identifier_options = ['config_root', 'config_root_backend', 'name'];

    // GAP - mandatory flags check should be earlier in the calls in general
    if (_.isUndefined(input_options_with_data.name)) {
        if (type === TYPES.ACCOUNT) throw_cli_error(ManageCLIError.MissingAccountNameFlag);
        if (type === TYPES.BUCKET) throw_cli_error(ManageCLIError.MissingBucketNameFlag);
    }

    const flags_for_update = input_options.filter(option => !config_and_identifier_options.includes(option));
    if (flags_for_update.length === 0 ||
        (flags_for_update.length === 1 && input_options_with_data.regenerate === 'false')) {
            throw_cli_error(ManageCLIError.MissingUpdateProperty);
        }
}

/////////////////////////////
//// BUCKET VALIDATIONS /////
/////////////////////////////

/**
 * validate_bucket_args will validate the cli args of the bucket command
 * @param {object} data
 * @param {string} action
 */
async function validate_bucket_args(config_root_backend, accounts_dir_path, data, action) {
    if (action === ACTIONS.DELETE || action === ACTIONS.STATUS) {
        if (_.isUndefined(data.name)) throw_cli_error(ManageCLIError.MissingBucketNameFlag);
    } else { // action === ACTIONS.ADD || action === ACTIONS.UPDATE
        if (_.isUndefined(data.name)) throw_cli_error(ManageCLIError.MissingBucketNameFlag);
        try {
            native_fs_utils.validate_bucket_creation({ name: data.name });
        } catch (err) {
            throw_cli_error(ManageCLIError.InvalidBucketName, data.name);
        }
        if (!_.isUndefined(data.new_name)) {
            if (action !== ACTIONS.UPDATE) throw_cli_error(ManageCLIError.InvalidNewNameBucketIdentifier);
            try {
                native_fs_utils.validate_bucket_creation({ name: data.new_name });
            } catch (err) {
                throw_cli_error(ManageCLIError.InvalidBucketName, data.new_name);
            }
        }
        if (_.isUndefined(data.system_owner)) throw_cli_error(ManageCLIError.MissingBucketOwnerFlag);
        if (!data.path) throw_cli_error(ManageCLIError.MissingBucketPathFlag);
        // fs_backend='' used for deletion of the fs_backend property
        if (data.fs_backend !== undefined && !['GPFS', 'CEPH_FS', 'NFSv4'].includes(data.fs_backend)) {
            throw_cli_error(ManageCLIError.InvalidFSBackend);
        }
        // in case we have the fs_backend it changes the fs_context that we use for the path
        const fs_context_fs_backend = native_fs_utils.get_process_fs_context(data.fs_backend);
        const exists = await native_fs_utils.is_path_exists(fs_context_fs_backend, data.path);
        if (!exists) {
            throw_cli_error(ManageCLIError.InvalidStoragePath, data.path);
        }
        const account = await get_bucket_owner_account(config_root_backend, accounts_dir_path, data.bucket_owner);
        const account_fs_context = await native_fs_utils.get_fs_context(account.nsfs_account_config, data.fs_backend);
        const accessible = await native_fs_utils.is_dir_rw_accessible(account_fs_context, data.path);
        if (!accessible) {
            throw_cli_error(ManageCLIError.InaccessibleStoragePath, data.path);
        }
        if (action === ACTIONS.ADD) {
            if (!account.allow_bucket_creation) {
                const detail_msg = `${data.bucket_owner} account not allowed to create new buckets. ` +
                `Please make sure to have a valid new_buckets_path and enable the flag allow_bucket_creation`;
                throw_cli_error(ManageCLIError.BucketCreationNotAllowed, detail_msg);
        }
            data.owner_account = account._id; // TODO move this assignment to better place
        }
        if (data.s3_policy) {
            try {
                await bucket_policy_utils.validate_s3_policy(data.s3_policy, data.name,
                    async principal => {
                        const account_config_path = get_config_file_path(accounts_dir_path, principal);
                        try {
                            const fs_context_config_root_backend = native_fs_utils.get_process_fs_context(config_root_backend);
                            await nb_native().fs.stat(fs_context_config_root_backend, account_config_path);
                            return true;
                        } catch (err) {
                            return false;
                        }
                    });
            } catch (err) {
                dbg.error('validate_bucket_args invalid bucket policy err:', err);
                throw_cli_error(ManageCLIError.MalformedPolicy, data.s3_policy);
            }
        }
    }
}

/////////////////////////////
//// ACCOUNT VALIDATIONS ////
/////////////////////////////

/**
 * validate_account_args will validate the args of the account command
 * @param {object} data
 * @param {string} action
 */
async function validate_account_args(data, action) {
    if (action === ACTIONS.STATUS || action === ACTIONS.DELETE) {
        if (_.isUndefined(data.access_keys[0].access_key) && _.isUndefined(data.name)) {
            throw_cli_error(ManageCLIError.MissingIdentifier);
        }
    } else {
        if ((action !== ACTIONS.UPDATE && data.new_name)) throw_cli_error(ManageCLIError.InvalidNewNameAccountIdentifier);
        if ((action !== ACTIONS.UPDATE && data.new_access_key)) throw_cli_error(ManageCLIError.InvalidNewAccessKeyIdentifier);
        if (_.isUndefined(data.name)) throw_cli_error(ManageCLIError.MissingAccountNameFlag);

        if (_.isUndefined(data.access_keys[0].secret_key)) throw_cli_error(ManageCLIError.MissingAccountSecretKeyFlag);
        if (_.isUndefined(data.access_keys[0].access_key)) throw_cli_error(ManageCLIError.MissingAccountAccessKeyFlag);
        if (data.nsfs_account_config.gid && data.nsfs_account_config.uid === undefined) {
            throw_cli_error(ManageCLIError.MissingAccountNSFSConfigUID, data.nsfs_account_config);
        }
        if (data.nsfs_account_config.uid && data.nsfs_account_config.gid === undefined) {
            throw_cli_error(ManageCLIError.MissingAccountNSFSConfigGID, data.nsfs_account_config);
        }
        if ((_.isUndefined(data.nsfs_account_config.distinguished_name) &&
                (data.nsfs_account_config.uid === undefined || data.nsfs_account_config.gid === undefined))) {
            throw_cli_error(ManageCLIError.InvalidAccountNSFSConfig, data.nsfs_account_config);
        }
        if (!_.isUndefined(data.nsfs_account_config.fs_backend) && !['GPFS', 'CEPH_FS', 'NFSv4'].includes(data.nsfs_account_config.fs_backend)) {
            throw_cli_error(ManageCLIError.InvalidFSBackend);
        }

        if (_.isUndefined(data.nsfs_account_config.new_buckets_path)) {
            return;
        }
        // in case we have the fs_backend it changes the fs_context that we use for the new_buckets_path
        const fs_context_fs_backend = native_fs_utils.get_process_fs_context(data.fs_backend);
        const exists = await native_fs_utils.is_path_exists(fs_context_fs_backend, data.nsfs_account_config.new_buckets_path);
        if (!exists) {
            throw_cli_error(ManageCLIError.InvalidAccountNewBucketsPath, data.nsfs_account_config.new_buckets_path);
        }
        const account_fs_context = await native_fs_utils.get_fs_context(data.nsfs_account_config, data.fs_backend);
        const accessible = await native_fs_utils.is_dir_rw_accessible(account_fs_context, data.nsfs_account_config.new_buckets_path);
        if (!accessible) {
            throw_cli_error(ManageCLIError.InaccessibleAccountNewBucketsPath, data.nsfs_account_config.new_buckets_path);
        }
    }
}

function _validate_access_keys(access_key, secret_key) {
    // using the access_key flag requires also using the secret_key flag
    if (!_.isUndefined(access_key) && _.isUndefined(secret_key)) {
        throw_cli_error(ManageCLIError.MissingAccountSecretKeyFlag);
    }
    if (!_.isUndefined(secret_key) && _.isUndefined(access_key)) {
        throw_cli_error(ManageCLIError.MissingAccountAccessKeyFlag);
    }

    // checking access_key length=20 and contains only alphanumeric chars
    if (access_key && !string_utils.access_key_regexp.test(access_key)) {
        throw_cli_error(ManageCLIError.InvalidAccountAccessKeyFlag);
    }
    // checking secret_key length=40 and contains only alphanumeric chars and +/
    if (secret_key && !string_utils.secret_key_regexp.test(secret_key)) {
        throw_cli_error(ManageCLIError.InvalidAccountSecretKeyFlag);
    }
}

/**
 * verify_delete_account will check if the account has at least one bucket
 * in case it finds one, it would throw an error
 * @param {string} account_name
 */
async function verify_delete_account(config_root_backend, buckets_dir_path, account_name) {
    const fs_context = native_fs_utils.get_process_fs_context(config_root_backend);
    const entries = await nb_native().fs.readdir(fs_context, buckets_dir_path);
    await P.map_with_concurrency(10, entries, async entry => {
        if (entry.name.endsWith('.json')) {
            const full_path = path.join(buckets_dir_path, entry.name);
            const data = await get_config_data(config_root_backend, full_path);
            if (data.bucket_owner === account_name) {
                const detail_msg = `Account ${account_name} has bucket ${data.name}`;
                throw_cli_error(ManageCLIError.AccountDeleteForbiddenHasBuckets, detail_msg);
            }
            return data;
        }
    });
}

///////////////////////////////////
//// IP WhITE LIST VALIDATIONS ////
///////////////////////////////////

function validate_whitelist_arg(ips) {
    if (!ips || ips === true) {
        throw_cli_error(ManageCLIError.MissingWhiteListIPFlag);
    }
    try {
        JSON.parse(ips);
    } catch (err) {
        throw_cli_error(ManageCLIError.InvalidWhiteListIPFormat);
    }
}

function verify_whitelist_ips(ips_to_validate) {
    for (const ip_to_validate of ips_to_validate) {
        if (net.isIP(ip_to_validate) === 0) {
            const detail_msg = `IP address list has an invalid IP address ${ip_to_validate}`;
            throw_cli_error(ManageCLIError.InvalidWhiteListIPFormat, detail_msg);
        }
    }
}

// EXPORTS
exports.validate_input_types = validate_input_types;
exports.validate_bucket_args = validate_bucket_args;
exports.validate_account_args = validate_account_args;
exports._validate_access_keys = _validate_access_keys;
exports.verify_delete_account = verify_delete_account;
exports.validate_whitelist_arg = validate_whitelist_arg;
exports.verify_whitelist_ips = verify_whitelist_ips;
