/* Copyright (C) 2024 NooBaa */
'use strict';

const config = require('../../config');
const dbg = require('../util/debug_module')(__filename);
const net = require('net');
const P = require('../util/promise');
const string_utils = require('../util/string_utils');
const native_fs_utils = require('../util/native_fs_utils');
const ManageCLIError = require('../manage_nsfs/manage_nsfs_cli_errors').ManageCLIError;
const bucket_policy_utils = require('../endpoint/s3/s3_bucket_policy_utils');
const { throw_cli_error, get_bucket_owner_account, get_options_from_file, get_boolean_or_string_value,
    check_root_account_owns_user, is_name_update, is_access_key_update } = require('../manage_nsfs/manage_nsfs_cli_utils');
const { TYPES, ACTIONS, VALID_OPTIONS, OPTION_TYPE, FROM_FILE, BOOLEAN_STRING_VALUES, BOOLEAN_STRING_OPTIONS,
    GLACIER_ACTIONS, LIST_UNSETABLE_OPTIONS, ANONYMOUS, DIAGNOSE_ACTIONS, UPGRADE_ACTIONS } = require('../manage_nsfs/manage_nsfs_constants');
const iam_utils = require('../endpoint/iam/iam_utils');

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
    validate_identifier(type, action, input_options_with_data, false);
    validate_flags_combination(type, action, input_options);
    validate_flags_value_combination(type, action, input_options_with_data);
    validate_account_name(type, action, input_options_with_data);
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
        validate_identifier(type, action, input_options_with_data_from_file, true);
        validate_flags_combination(type, action, input_options_from_file);
        validate_flags_value_combination(type, action, input_options_with_data_from_file);
        validate_account_name(type, action, input_options_with_data_from_file);
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
    } else if (type === TYPES.DIAGNOSE) {
        if (!Object.values(DIAGNOSE_ACTIONS).includes(action)) throw_cli_error(ManageCLIError.InvalidDiagnoseAction);
    } else if (type === TYPES.UPGRADE) {
        if (!Object.values(UPGRADE_ACTIONS).includes(action)) throw_cli_error(ManageCLIError.InvalidUpgradeAction);
    }
}

/**
 * validate_identifier will validate that we have the needed identifier for the command
 * @param {string} type
 * @param {string} action
 * @param {object} input_options
 * @param {boolean} is_options_from_file boolean to indicates that the validation is on values that origin from the file
 */
function validate_identifier(type, action, input_options, is_options_from_file) {
    // do not check identifier in the command of from_file (only in the file itself).
    if (input_options.from_file !== undefined && !is_options_from_file) return;

    if (type === TYPES.ACCOUNT) {
        validate_account_identifier(action, input_options);
    } else if (type === TYPES.BUCKET) {
        validate_bucket_identifier(action, input_options);
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
        if (input_options.includes(ANONYMOUS)) {
            valid_options = VALID_OPTIONS.anonymous_account_options[action];
        } else {
            valid_options = VALID_OPTIONS.account_options[action];
        }
    } else if (type === TYPES.GLACIER) {
        valid_options = VALID_OPTIONS.glacier_options[action];
    } else if (type === TYPES.DIAGNOSE) {
        valid_options = VALID_OPTIONS.diagnose_options[action];
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
            if (BOOLEAN_STRING_OPTIONS.has(option) && validate_boolean_string_value(value)) {
                continue;
            }
            // special case for bucket_policy and notifications(from_file)
            if ((option === 'bucket_policy' || option === 'notifications') && type_of_value === 'object') {
                continue;
            }
            const details = `type of flag ${option} should be ${type_of_option}`;
            console.log("option = ", option, " typepof option = ", typeof value, " should be ", type_of_option);
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
    if (input_options_with_data.name === undefined) {
        if (type === TYPES.ACCOUNT && !input_options_with_data.anonymous) throw_cli_error(ManageCLIError.MissingAccountNameFlag);
        if (type === TYPES.BUCKET) throw_cli_error(ManageCLIError.MissingBucketNameFlag);
    }

    const flags_for_update = input_options.filter(option => !config_and_identifier_options.includes(option));
    if (flags_for_update.length === 0 ||
        (flags_for_update.length === 1 && input_options_with_data.regenerate === 'false')) {
            throw_cli_error(ManageCLIError.MissingUpdateProperty);
        }
}


/**
 * validate_flags_combination checks invalid flags combination, for example:
 * 1. account add or update - user and gid/uid is an invalid flags combination  
 * 2. account list - show_secrets without wide is an invalid flags combination 
 * @param {string} type
 * @param {string} action
 * @param {object} input_options
 */
function validate_flags_combination(type, action, input_options) {
    const input_options_set = new Set(input_options);
    if (type === TYPES.ACCOUNT) {
        if (action === ACTIONS.ADD || action === ACTIONS.UPDATE) {
            if (input_options_set.has('user') &&
                (input_options_set.has('uid') || input_options_set.has('gid'))) {
                const detail = 'Please use --uid and --gid flags (or only --user flag)';
                throw_cli_error(ManageCLIError.InvalidFlagsCombination, detail);
            }
        }
        if (action === ACTIONS.LIST) {
            if (input_options_set.has('show_secrets') && !input_options_set.has('wide')) {
                const detail = 'Please use --show_secrets and --wide flags together (or only --wide flag)';
                throw_cli_error(ManageCLIError.InvalidFlagsCombination, detail);
            }
        }
    }
}

/**
 * validate_flags_value_combination checks flags and value combination.
 * 1. account add or update - name should not be anonymous
 * @param {string} type
 * @param {string} action
 * @param {object} input_options_with_data
 */
function validate_flags_value_combination(type, action, input_options_with_data) {
    if (type === TYPES.ACCOUNT) {
        if (action === ACTIONS.ADD || action === ACTIONS.UPDATE) {
            if (input_options_with_data.name === ANONYMOUS || input_options_with_data.new_name === ANONYMOUS) {
                const detail = 'Account name \'anonymous\' is not valid';
                throw_cli_error(ManageCLIError.InvalidAccountName, detail);
            }
        }
    }
}

/**
 * validate_account_name
 * We check the name only on new accounts (account add) or accounts' rename (account update) - 
 * in name and new_name we allow type number, hence convert it to string (it is saved converted in fetch_account_data)
 * In case, we had already an account with invalid name, it can be changed to a valid name
 * (current name is not validated)
 * @param {string} type
 * @param {string} action
 * @param {object} input_options_with_data
 */
function validate_account_name(type, action, input_options_with_data) {
    if (type !== TYPES.ACCOUNT) return;
    let account_name;
    try {
        if (action === ACTIONS.ADD) {
            account_name = String(input_options_with_data.name);
            iam_utils.validate_username(account_name, 'name');
        } else if (action === ACTIONS.UPDATE && input_options_with_data.new_name !== undefined) {
            account_name = String(input_options_with_data.new_name);
            iam_utils.validate_username(account_name, 'new_name');
        }
    } catch (err) {
        if (err instanceof ManageCLIError) throw err;
        // we receive IAMError and replace it to ManageCLIError
        // we do not use the mapping errors because it is a general error ValidationError
        const detail = err.message;
        throw_cli_error(ManageCLIError.InvalidAccountName, detail);
    }
}

/////////////////////////////
//// BUCKET VALIDATIONS /////
/////////////////////////////

/**
 * validate_bucket_identifier will validate that we have the needed identifier for the command
 * @param {string} action
 * @param {object} input_options
 */
function validate_bucket_identifier(action, input_options) {
    if (action === ACTIONS.STATUS || action === ACTIONS.ADD || action === ACTIONS.UPDATE || action === ACTIONS.DELETE) {
        if (input_options.name === undefined) throw_cli_error(ManageCLIError.MissingBucketNameFlag);
    }
    // in list there is no identifier
}

/**
 * check_new_name_exists will validate that a new account/bucket name does not exist
 * @param {import('../sdk/config_fs').ConfigFS} config_fs
 * @param {string} action
 * @param {object} data
 */
async function check_new_name_exists(type, config_fs, action, data) {
    const new_name = action === ACTIONS.ADD ? data.name : data.new_name;
    if (action === ACTIONS.UPDATE && !is_name_update(data)) return;
    if (type === TYPES.BUCKET) {
        const exists = await config_fs.is_bucket_exists(new_name);
        if (exists) throw_cli_error(ManageCLIError.BucketAlreadyExists, new_name, { bucket: new_name });
    } else if (type === TYPES.ACCOUNT) {
        const exists = await config_fs.is_account_exists_by_name(new_name);
        if (exists) throw_cli_error(ManageCLIError.AccountNameAlreadyExists, new_name, { account: new_name });
    }
}

/**
 * check_new_access_key_exists will validate that a new access_key does not exist
 * @param {import('../sdk/config_fs').ConfigFS} config_fs
 * @param {string} action
 * @param {object} data
 */
async function check_new_access_key_exists(config_fs, action, data) {
    const new_access_key = action === ACTIONS.ADD ? data.access_keys?.[0]?.access_key : data.new_access_key;
    if (action === ACTIONS.UPDATE && !is_access_key_update(data)) return;
    if (!new_access_key) return; // for anonymous account and users without access keys
    const exists = await config_fs.is_account_exists_by_access_key(new_access_key);
    if (exists) throw_cli_error(ManageCLIError.AccountAccessKeyAlreadyExists, new_access_key, { account: new_access_key });
}

/**
 * validate_bucket_args will validate the cli args of the bucket command
 * @param {import('../sdk/config_fs').ConfigFS} config_fs
 * @param {object} data
 * @param {string} action
 */
async function validate_bucket_args(config_fs, data, action) {
    if (action === ACTIONS.ADD || action === ACTIONS.UPDATE) {
        if (action === ACTIONS.ADD) native_fs_utils.validate_bucket_creation({ name: data.name });
        if ((action === ACTIONS.UPDATE) && (data.new_name !== undefined)) native_fs_utils.validate_bucket_creation({ name: data.new_name });
        if ((action === ACTIONS.ADD) && (data.owner_account === undefined)) throw_cli_error(ManageCLIError.MissingBucketOwnerFlag);
        if (!data.path) throw_cli_error(ManageCLIError.MissingBucketPathFlag);
        // fs_backend='' used for deletion of the fs_backend property
        if (data.fs_backend !== undefined && !['GPFS', 'CEPH_FS', 'NFSv4'].includes(data.fs_backend)) {
            throw_cli_error(ManageCLIError.InvalidFSBackend);
        }
        await check_new_name_exists(TYPES.BUCKET, config_fs, action, data);
        // in case we have the fs_backend it changes the fs_context that we use for the path
        const fs_context_fs_backend = native_fs_utils.get_process_fs_context(data.fs_backend);
        if (!config.NC_DISABLE_ACCESS_CHECK) {
            const exists = await native_fs_utils.is_path_exists(fs_context_fs_backend, data.path);
            if (!exists) {
                throw_cli_error(ManageCLIError.InvalidStoragePath, data.path);
            }
        }

        // bucket owner account validations 
        const owner_account_data = await get_bucket_owner_account(config_fs, undefined, data.owner_account);
        const account_fs_context = await native_fs_utils.get_fs_context(owner_account_data.nsfs_account_config,
            owner_account_data.nsfs_account_config.fs_backend);
        if (!config.NC_DISABLE_ACCESS_CHECK) {
            const accessible = await native_fs_utils.is_dir_accessible(account_fs_context, data.path);
            if (!accessible) {
                throw_cli_error(ManageCLIError.InaccessibleStoragePath, data.path);
            }
        }
        if (action === ACTIONS.ADD) {
            if (!owner_account_data.allow_bucket_creation) {
                const detail_msg = `${owner_account_data.name} account not allowed to create new buckets. ` +
                `Please make sure to have a valid new_buckets_path and enable the flag allow_bucket_creation`;
                throw_cli_error(ManageCLIError.BucketCreationNotAllowed, detail_msg);
            }
        }
        if (owner_account_data.owner) {
            const detail_msg = `account ${owner_account_data.name} is IAM account`;
            throw_cli_error(ManageCLIError.BucketSetForbiddenBucketOwnerIsIAMAccount, detail_msg,
                { bucket_owner: owner_account_data.name });
        }
        if (data.s3_policy) {
            try {
                await bucket_policy_utils.validate_s3_policy(data.s3_policy, data.name,
                    async principal => config_fs.is_account_exists_by_principal(principal, { silent_if_missing: true })
                );
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
 * validate_account_identifier will validate that we have the needed identifier for the command
 * @param {string} action
 * @param {object} input_options
 */
function validate_account_identifier(action, input_options) {
    if (get_boolean_or_string_value(input_options[ANONYMOUS])) return;
    if (action === ACTIONS.STATUS) {
        // in status we allow identifier as name or access_key
        if ((input_options.access_key === undefined) && (input_options.name === undefined)) {
            throw_cli_error(ManageCLIError.MissingIdentifier);
        }
    } else if (action === ACTIONS.ADD || action === ACTIONS.UPDATE || action === ACTIONS.DELETE) {
        // in add, update and delete only name is an identifier
        if (input_options.name === undefined) throw_cli_error(ManageCLIError.MissingAccountNameFlag);
    }
    // in list there is no identifier
}

/**
 * validate_account_args will validate the args of the account command
 * @param {import('../sdk/config_fs').ConfigFS} config_fs
 * @param {object} data
 * @param {string} action
 * @param {boolean|undefined} is_flag_iam_operate_on_root_account_update_action
 */
async function validate_account_args(config_fs, data, action, is_flag_iam_operate_on_root_account_update_action) {
    if (action === ACTIONS.ADD || action === ACTIONS.UPDATE) {

        await check_new_name_exists(TYPES.ACCOUNT, config_fs, action, data);
        await check_new_access_key_exists(config_fs, action, data);

        if (data.nsfs_account_config.gid && data.nsfs_account_config.uid === undefined) {
            throw_cli_error(ManageCLIError.MissingAccountNSFSConfigUID, data.nsfs_account_config);
        }
        if (data.nsfs_account_config.uid && data.nsfs_account_config.gid === undefined) {
            throw_cli_error(ManageCLIError.MissingAccountNSFSConfigGID, data.nsfs_account_config);
        }
        if ((data.nsfs_account_config.distinguished_name === undefined) &&
                ((data.nsfs_account_config.uid === undefined) || (data.nsfs_account_config.gid === undefined))) {
            throw_cli_error(ManageCLIError.InvalidAccountNSFSConfig, data.nsfs_account_config);
        }
        if ((data.nsfs_account_config.fs_backend !== undefined) && !['GPFS', 'CEPH_FS', 'NFSv4'].includes(data.nsfs_account_config.fs_backend)) {
            throw_cli_error(ManageCLIError.InvalidFSBackend);
        }

        if (data.nsfs_account_config.new_buckets_path === undefined) {
            return;
        }
        // in case we have the fs_backend it changes the fs_context that we use for the new_buckets_path
        const fs_context_fs_backend = native_fs_utils.get_process_fs_context(data.fs_backend);
        if (!config.NC_DISABLE_ACCESS_CHECK) {
            const exists = await native_fs_utils.is_path_exists(fs_context_fs_backend, data.nsfs_account_config.new_buckets_path);
            if (!exists) {
                throw_cli_error(ManageCLIError.InvalidAccountNewBucketsPath, data.nsfs_account_config.new_buckets_path);
            }
        }
        if (!config.NC_DISABLE_ACCESS_CHECK) {
            const account_fs_context = await native_fs_utils.get_fs_context(data.nsfs_account_config, data.fs_backend);
            const accessible = await native_fs_utils.is_dir_accessible(account_fs_context, data.nsfs_account_config.new_buckets_path);
            if (!accessible) {
                throw_cli_error(ManageCLIError.InaccessibleAccountNewBucketsPath, data.nsfs_account_config.new_buckets_path);
            }
        }
        if (action === ACTIONS.UPDATE && is_flag_iam_operate_on_root_account_update_action) {
            await validate_root_accounts_manager_update(config_fs, data);
        }
    }
    if (action === ACTIONS.DELETE) {
        await validate_account_resources_before_deletion(config_fs, data);
    }
}

/**
 * validate_account_resources_before_deletion will validate that the account to be deleted
 * doesn't have resources related to it
 * 1 - buckets that it owns
 * 2 - accounts that it owns
 * @param {import('../sdk/config_fs').ConfigFS} config_fs
 * @param {object} data
 */
async function validate_account_resources_before_deletion(config_fs, data) {
    await validate_account_not_owns_buckets(config_fs, data);
    // If it is root account (not owned by other account) then we check that it doesn't owns IAM accounts
    if (data.owner === undefined) {
        await check_if_root_account_does_not_have_IAM_users(config_fs, data, ACTIONS.DELETE);
    }
}

/**
 * _validate_access_keys will check if both flags for access_key and secret_key passed
 * and will validate each one of them
 * @param {string} access_key
 * @param {string} secret_key
 */
function _validate_access_keys(access_key, secret_key) {
    // using the access_key flag requires also using the secret_key flag
    if ((access_key !== undefined) && (secret_key === undefined)) {
        throw_cli_error(ManageCLIError.MissingAccountSecretKeyFlag);
    }
    if ((secret_key !== undefined) && (access_key === undefined)) {
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
 * validate_delete_account will check if the account has at least one bucket
 * in case it finds one, it would throw an error
 * @param {import('../sdk/config_fs').ConfigFS} config_fs
 * @param {Object} account_data
 */
async function validate_account_not_owns_buckets(config_fs, account_data) {
    const bucket_names = await config_fs.list_buckets();
    await P.map_with_concurrency(10, bucket_names, async bucket_name => {
        const data = await config_fs.get_bucket_by_name(bucket_name, { silent_if_missing: true });
        if (data && data.owner_account === account_data._id) {
            const detail_msg = `Account ${account_data.name} has bucket ${data.name}`;
            throw_cli_error(ManageCLIError.AccountDeleteForbiddenHasBuckets, detail_msg);
        }
        return data;
    });
}

// TODO - when we have the structure of config we can check easily which IAM users are owned by the root account
// currently, partial copy from _list_config_files_for_users
/**
 * @param {import('../sdk/config_fs').ConfigFS} config_fs
 * @param {object} account_to_check
 * @param {string} action
 */
async function check_if_root_account_does_not_have_IAM_users(config_fs, account_to_check, action) {
    // TODO - For supporting IAM, we need to check if {config_dir}/identities/{account_id}/users/ has anything inside
    const account_names = await config_fs.list_accounts();
    await P.map_with_concurrency(10, account_names, async account_name => {
        const account_data = await config_fs.get_account_by_name(account_name);
        const is_root_account_owns_user = check_root_account_owns_user(account_to_check, account_data);
        if (is_root_account_owns_user) {
            const detail_msg = `Account ${account_to_check.name} has IAM account ${account_data.name}`;
            if (action === ACTIONS.DELETE) {
                throw_cli_error(ManageCLIError.AccountDeleteForbiddenHasIAMAccounts, detail_msg);
            }
            // else it is called with action ACTIONS.UPDATE
            throw_cli_error(ManageCLIError.AccountCannotBeRootAccountsManager, detail_msg);
        }
        return account_data;
    });
}

/**
 * validate_root_accounts_manager_update checks that an updated account that was set with iam_operate_on_root_account true:
 * 1 - is not an IAM user
 * 2 - the account does not owns IAM users
 * @param {import('../sdk/config_fs').ConfigFS} config_fs
 * @param {object} account
 */
async function validate_root_accounts_manager_update(config_fs, account) {
    if (account.owner) {
        throw_cli_error(ManageCLIError.AccountCannotCreateRootAccountsRequesterIAMUser);
    }
    await check_if_root_account_does_not_have_IAM_users(config_fs, account, ACTIONS.UPDATE);
}

///////////////////////////////////
//// IP WhITE LIST VALIDATIONS ////
///////////////////////////////////

function validate_whitelist_arg(ips) {
    try {
        JSON.parse(ips);
    } catch (err) {
        throw_cli_error(ManageCLIError.InvalidWhiteListIPFormat);
    }
}

function validate_whitelist_ips(ips_to_validate) {
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
exports.validate_root_accounts_manager_update = validate_root_accounts_manager_update;
exports.validate_whitelist_arg = validate_whitelist_arg;
exports.validate_whitelist_ips = validate_whitelist_ips;
exports.validate_flags_combination = validate_flags_combination;
