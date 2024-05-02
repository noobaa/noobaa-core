/* Copyright (C) 2020 NooBaa */
'use strict';

const dbg = require('../util/debug_module')(__filename);
const _ = require('lodash');
const path = require('path');
const minimist = require('minimist');
const net = require('net');
const config = require('../../config');
const P = require('../util/promise');
const nb_native = require('../util/nb_native');
const cloud_utils = require('../util/cloud_utils');
const string_utils = require('../util/string_utils');
const native_fs_utils = require('../util/native_fs_utils');
const mongo_utils = require('../util/mongo_utils');
const SensitiveString = require('../util/sensitive_string');
const ManageCLIError = require('../manage_nsfs/manage_nsfs_cli_errors').ManageCLIError;
const NSFS_CLI_ERROR_EVENT_MAP = require('../manage_nsfs/manage_nsfs_cli_errors').NSFS_CLI_ERROR_EVENT_MAP;
const ManageCLIResponse = require('../manage_nsfs/manage_nsfs_cli_responses').ManageCLIResponse;
const NSFS_CLI_SUCCESS_EVENT_MAP = require('../manage_nsfs/manage_nsfs_cli_responses').NSFS_CLI_SUCCESS_EVENT_MAP;
const manage_nsfs_glacier = require('../manage_nsfs/manage_nsfs_glacier');
const bucket_policy_utils = require('../endpoint/s3/s3_bucket_policy_utils');
const nsfs_schema_utils = require('../manage_nsfs/nsfs_schema_utils');
const { print_usage } = require('../manage_nsfs/manage_nsfs_help_utils');
const { TYPES, ACTIONS, VALID_OPTIONS, OPTION_TYPE, FROM_FILE, BOOLEAN_STRING_VALUES,
    LIST_ACCOUNT_FILTERS, LIST_BUCKET_FILTERS, GLACIER_ACTIONS } = require('../manage_nsfs/manage_nsfs_constants');
const NoobaaEvent = require('../manage_nsfs/manage_nsfs_events_utils').NoobaaEvent;
const nc_mkm = require('../manage_nsfs/nc_master_key_manager').get_instance();

function throw_cli_error(error_code, detail, event_arg) {
    const error_event = NSFS_CLI_ERROR_EVENT_MAP[error_code.code];
    if (error_event) {
        new NoobaaEvent(error_event).create_event(undefined, event_arg, undefined);
    }
    const err = new ManageCLIError(error_code).to_string(detail);
    process.stdout.write(err + '\n');
    process.exit(1);
}

function write_stdout_response(response_code, detail, event_arg) {
    const response_event = NSFS_CLI_SUCCESS_EVENT_MAP[response_code.code];
    if (response_event) {
        new NoobaaEvent(response_event).create_event(undefined, event_arg, undefined);
    }
    const res = new ManageCLIResponse(response_code).to_string(detail);
    process.stdout.write(res + '\n');
    process.exit(0);
}

const buckets_dir_name = '/buckets';
const accounts_dir_name = '/accounts';
const access_keys_dir_name = '/access_keys';
const acounts_dir_relative_path = '../accounts/';

let config_root;
let accounts_dir_path;
let access_keys_dir_path;
let buckets_dir_path;
let config_root_backend;

async function check_and_create_config_dirs() {
    const pre_req_dirs = [
        config_root,
        buckets_dir_path,
        accounts_dir_path,
        access_keys_dir_path,
    ];

    if (config.NSFS_GLACIER_LOGS_ENABLED) {
        pre_req_dirs.push(config.NSFS_GLACIER_LOGS_DIR);
    }

    for (const dir_path of pre_req_dirs) {
        try {
            const fs_context = native_fs_utils.get_process_fs_context(config_root_backend);
            const dir_exists = await native_fs_utils.is_path_exists(fs_context, dir_path);
            if (dir_exists) {
                dbg.log1('nsfs.check_and_create_config_dirs: config dir exists:', dir_path);
            } else {
                await native_fs_utils._create_path(dir_path, fs_context, config.BASE_MODE_CONFIG_DIR);
                dbg.log1('nsfs.check_and_create_config_dirs: config dir was created:', dir_path);
            }
        } catch (err) {
            dbg.log1('nsfs.check_and_create_config_dirs: could not create pre requisite path', dir_path);
        }
    }
}

async function main(argv = minimist(process.argv.slice(2))) {
    try {
        if (process.getuid() !== 0 || process.getgid() !== 0) {
            throw new Error('Root permissions required for Manage NSFS execution.');
        }
        const type = argv._[0] || '';
        const action = argv._[1] || '';
        if (argv.help || argv.h) {
            return print_usage(type, action);
        }
        const user_input_from_file = await validate_input_types(type, action, argv);
        const user_input = user_input_from_file || argv;
        config_root = argv.config_root ? String(argv.config_root) : config.NSFS_NC_CONF_DIR;
        if (!config_root) throw_cli_error(ManageCLIError.MissingConfigDirPath);
        if (argv.config_root) config.NSFS_NC_CONF_DIR = String(argv.config_root);

        accounts_dir_path = path.join(config_root, accounts_dir_name);
        access_keys_dir_path = path.join(config_root, access_keys_dir_name);
        buckets_dir_path = path.join(config_root, buckets_dir_name);
        config_root_backend = argv.config_root_backend ? String(argv.config_root_backend) : config.NSFS_NC_CONFIG_DIR_BACKEND;

        await check_and_create_config_dirs();
        if (type === TYPES.ACCOUNT) {
            await account_management(action, user_input);
        } else if (type === TYPES.BUCKET) {
            await bucket_management(action, user_input);
        } else if (type === TYPES.IP_WHITELIST) {
            await whitelist_ips_management(argv);
        } else if (type === TYPES.GLACIER) {
            await glacier_management(argv);
        } else {
            // we should not get here (we check it before)
            throw_cli_error(ManageCLIError.InvalidType);
        }
    } catch (err) {
        dbg.log1('NSFS Manage command: exit on error', err.stack || err);
        const manage_err = ((err instanceof ManageCLIError) && err) ||
            new ManageCLIError(ManageCLIError.FS_ERRORS_TO_MANAGE[err.code] ||
                ManageCLIError.RPC_ERROR_TO_MANAGE[err.rpc_code] ||
                ManageCLIError.InternalError);
        throw_cli_error(manage_err, err.stack || err);
    }
}

async function bucket_management(action, user_input) {
    const data = await fetch_bucket_data(action, user_input);
    await manage_bucket_operations(action, data, user_input);
}

// in name and new_name we allow type number, hence convert it to string
async function fetch_bucket_data(action, user_input) {
    let data = {
        // added undefined values to keep the order the properties when printing the data object
        _id: undefined,
        name: _.isUndefined(user_input.name) ? undefined : String(user_input.name),
        owner_account: undefined,
        system_owner: user_input.owner, // GAP - needs to be the system_owner (currently it is the account name)
        bucket_owner: user_input.owner,
        wide: _.isUndefined(user_input.wide) ? undefined : get_boolean_or_string_value(user_input.wide),
        tag: undefined, // if we would add the option to tag a bucket using CLI, this should be changed
        versioning: action === ACTIONS.ADD ? 'DISABLED' : undefined,
        creation_date: action === ACTIONS.ADD ? new Date().toISOString() : undefined,
        path: user_input.path,
        should_create_underlying_storage: action === ACTIONS.ADD ? false : undefined,
        new_name: _.isUndefined(user_input.new_name) ? undefined : String(user_input.new_name),
        fs_backend: _.isUndefined(user_input.fs_backend) ? config.NSFS_NC_STORAGE_BACKEND : String(user_input.fs_backend)
        };

    if (user_input.bucket_policy !== undefined) {
        if (typeof user_input.bucket_policy === 'string') {
            // bucket_policy deletion specified with empty string ''
            if (user_input.bucket_policy === '') {
                data.s3_policy = '';
            } else {
                data.s3_policy = JSON.parse(user_input.bucket_policy.toString());
            }
        } else { // it is object type
            data.s3_policy = user_input.bucket_policy;
        }
    }
    if (action === ACTIONS.UPDATE || action === ACTIONS.DELETE) {
        // @ts-ignore
        data = _.omitBy(data, _.isUndefined);
        data = await fetch_existing_bucket_data(data);
    }

    // override values
    // fs_backend deletion specified with empty string '' (but it is not part of the schema)
    data.fs_backend = data.fs_backend || undefined;
    // s3_policy deletion specified with empty string '' (but it is not part of the schema)
    data.s3_policy = data.s3_policy || undefined;

    return data;
}

async function fetch_existing_bucket_data(target) {
    let source;
    try {
        const bucket_config_path = get_config_file_path(buckets_dir_path, target.name);
        source = await get_config_data(bucket_config_path);
    } catch (err) {
        throw_cli_error(ManageCLIError.NoSuchBucket, target.name);
    }
    const data = _.merge({}, source, target);
    return data;
}

function get_config_file_path(config_type_path, file_name) {
    return path.join(config_type_path, file_name + '.json');
}

function get_symlink_config_file_path(config_type_path, file_name) {
    return path.join(config_type_path, file_name + '.symlink');
}

async function add_bucket(data) {
    await validate_bucket_args(data, ACTIONS.ADD);
    const fs_context = native_fs_utils.get_process_fs_context(config_root_backend);
    const bucket_conf_path = get_config_file_path(buckets_dir_path, data.name);
    const exists = await native_fs_utils.is_path_exists(fs_context, bucket_conf_path);
    if (exists) throw_cli_error(ManageCLIError.BucketAlreadyExists, data.name, { bucket: data.name });
    data._id = mongo_utils.mongoObjectId();
    const data_json = JSON.stringify(data);
    // We take an object that was stringify
    // (it unwraps ths sensitive strings, creation_date to string and removes undefined parameters)
    // for validating against the schema we need an object, hence we parse it back to object
    nsfs_schema_utils.validate_bucket_schema(JSON.parse(data_json));
    await native_fs_utils.create_config_file(fs_context, buckets_dir_path, bucket_conf_path, data_json);
    write_stdout_response(ManageCLIResponse.BucketCreated, data_json, { bucket: data.name });
}

/**
 * get_bucket_owner_account will return the account of the bucket_owner
 * otherwise it would throw an error
 * @param {string} bucket_owner
 */
async function get_bucket_owner_account(bucket_owner) {
    const account_config_path = get_config_file_path(accounts_dir_path, bucket_owner);
    try {
        const account = await get_config_data(account_config_path);
        return account;
    } catch (err) {
        if (err.code === 'ENOENT') {
            const detail_msg = `bucket owner ${bucket_owner} does not exists`;
            throw_cli_error(ManageCLIError.BucketSetForbiddenNoBucketOwner, detail_msg, {bucket_owner: bucket_owner});
        }
        throw err;
    }
}

async function get_bucket_status(data) {
    await validate_bucket_args(data, ACTIONS.STATUS);

    try {
        const bucket_path = get_config_file_path(buckets_dir_path, data.name);
        const config_data = await get_config_data(bucket_path);
        write_stdout_response(ManageCLIResponse.BucketStatus, config_data);
    } catch (err) {
        const err_code = err.code === 'EACCES' ? ManageCLIError.AccessDenied : ManageCLIError.NoSuchBucket;
        throw_cli_error(err_code, data.name);
    }
}

async function update_bucket(data) {
    await validate_bucket_args(data, ACTIONS.UPDATE);

    const fs_context = native_fs_utils.get_process_fs_context(config_root_backend);

    const cur_name = data.name;
    const new_name = data.new_name;
    const update_name = new_name && cur_name && new_name !== cur_name;

    if (!update_name) {
        const bucket_config_path = get_config_file_path(buckets_dir_path, data.name);
        data = JSON.stringify(data);
        // We take an object that was stringify
        // (it unwraps ths sensitive strings, creation_date to string and removes undefined parameters)
        // for validating against the schema we need an object, hence we parse it back to object
        nsfs_schema_utils.validate_bucket_schema(JSON.parse(data));
        await native_fs_utils.update_config_file(fs_context, buckets_dir_path, bucket_config_path, data);
        write_stdout_response(ManageCLIResponse.BucketUpdated, data);
        return;
    }

    data.name = new_name;

    const cur_bucket_config_path = get_config_file_path(buckets_dir_path, cur_name);
    const new_bucket_config_path = get_config_file_path(buckets_dir_path, data.name);

    const exists = await native_fs_utils.is_path_exists(fs_context, new_bucket_config_path);
    if (exists) throw_cli_error(ManageCLIError.BucketAlreadyExists, data.name);

    data = JSON.stringify(_.omit(data, ['new_name']));
    // We take an object that was stringify
    // (it unwraps ths sensitive strings, creation_date to string and removes undefined parameters)
    // for validating against the schema we need an object, hence we parse it back to object
    nsfs_schema_utils.validate_bucket_schema(JSON.parse(data));
    await native_fs_utils.create_config_file(fs_context, buckets_dir_path, new_bucket_config_path, data);
    await native_fs_utils.delete_config_file(fs_context, buckets_dir_path, cur_bucket_config_path);
    write_stdout_response(ManageCLIResponse.BucketUpdated, data);
}

async function delete_bucket(data, force) {
    await validate_bucket_args(data, ACTIONS.DELETE);
    // we have fs_contexts: (1) fs_backend for bucket temp dir (2) config_root_backend for config files
    const fs_context_config_root_backend = native_fs_utils.get_process_fs_context(config_root_backend);
    const fs_context_fs_backend = native_fs_utils.get_process_fs_context(data.fs_backend);
    const bucket_config_path = get_config_file_path(buckets_dir_path, data.name);
    try {
        const temp_dir_name = config.NSFS_TEMP_DIR_NAME + "_" + data._id;
        const bucket_temp_dir_path = path.join(data.path, temp_dir_name);
        const entries = await nb_native().fs.readdir(fs_context_fs_backend, data.path);
        const object_entries = entries.filter(element => !element.name.endsWith(temp_dir_name));
        if (object_entries.length === 0 || force) {
            await native_fs_utils.folder_delete(bucket_temp_dir_path, fs_context_fs_backend, true);
            await native_fs_utils.delete_config_file(fs_context_config_root_backend, buckets_dir_path, bucket_config_path);
            write_stdout_response(ManageCLIResponse.BucketDeleted, '', {bucket: data.name});
        }
        throw_cli_error(ManageCLIError.BucketDeleteForbiddenHasObjects, data.name);
    } catch (err) {
        if (err.code === 'ENOENT') throw_cli_error(ManageCLIError.NoSuchBucket, data.name);
        throw err;
    }
}

async function manage_bucket_operations(action, data, user_input) {
    if (action === ACTIONS.ADD) {
        await add_bucket(data);
    } else if (action === ACTIONS.STATUS) {
        await get_bucket_status(data);
    } else if (action === ACTIONS.UPDATE) {
        await update_bucket(data);
    } else if (action === ACTIONS.DELETE) {
        const force = get_boolean_or_string_value(user_input.force);
        await delete_bucket(data, force);
    } else if (action === ACTIONS.LIST) {
        const bucket_filters = _.pick(user_input, LIST_BUCKET_FILTERS);
        const buckets = await list_config_files(TYPES.BUCKET, buckets_dir_path, data.wide, undefined, bucket_filters);
        write_stdout_response(ManageCLIResponse.BucketList, buckets);
    } else {
        // we should not get here (we check it before)
        throw_cli_error(ManageCLIError.InvalidAction);
    }
}

async function account_management(action, user_input) {
    const show_secrets = get_boolean_or_string_value(user_input.show_secrets);
    const data = await fetch_account_data(action, user_input);
    await manage_account_operations(action, data, show_secrets, user_input);
}

/**
 * set_access_keys will set the access keys either given or generated.
 * @param {string} access_key
 * @param {string} secret_key
 * @param {boolean} generate a flag for generating the access_keys automatically
 */
function set_access_keys(access_key, secret_key, generate) {
    let generated_access_key;
    let generated_secret_key;
    if (generate) {
        ({ access_key: generated_access_key, secret_key: generated_secret_key } = cloud_utils.generate_access_keys());
        generated_access_key = generated_access_key.unwrap();
        generated_secret_key = generated_secret_key.unwrap();
    }

    return [{
        access_key: access_key || generated_access_key,
        secret_key: secret_key || generated_secret_key,
    }];
}

// in name and new_name we allow type number, hence convert it to string
async function fetch_account_data(action, user_input) {
    const { access_keys, new_access_key } = get_access_keys(action, user_input);
    let data = {
        // added undefined values to keep the order the properties when printing the data object
        _id: undefined,
        name: _.isUndefined(user_input.name) ? undefined : String(user_input.name),
        email: _.isUndefined(user_input.name) ? undefined : String(user_input.name), // temp, keep the email internally
        creation_date: action === ACTIONS.ADD ? new Date().toISOString() : undefined,
        wide: _.isUndefined(user_input.wide) ? undefined : get_boolean_or_string_value(user_input.wide),
        new_name: _.isUndefined(user_input.new_name) ? undefined : String(user_input.new_name),
        new_access_key,
        access_keys,
        nsfs_account_config: {
            distinguished_name: user_input.user,
            uid: user_input.user ? undefined : user_input.uid,
            gid: user_input.user ? undefined : user_input.gid,
            new_buckets_path: user_input.new_buckets_path,
            fs_backend: user_input.fs_backend ? String(user_input.fs_backend) : config.NSFS_NC_STORAGE_BACKEND
        }
    };
    if (action === ACTIONS.UPDATE || action === ACTIONS.DELETE) {
        // @ts-ignore
        data = _.omitBy(data, _.isUndefined);
        data = await fetch_existing_account_data(data);
    }

    // override values
    // access_key as SensitiveString
    data.access_keys[0].access_key = _.isUndefined(data.access_keys[0].access_key) ? undefined :
        new SensitiveString(String(data.access_keys[0].access_key));
    // secret_key as SensitiveString
    data.access_keys[0].secret_key = _.isUndefined(data.access_keys[0].secret_key) ? undefined :
        new SensitiveString(String(data.access_keys[0].secret_key));
    // allow_bucket_creation either set by user or infer from new_buckets_path
    if (_.isUndefined(user_input.allow_bucket_creation)) {
        data.allow_bucket_creation = !_.isUndefined(data.nsfs_account_config.new_buckets_path);
    } else if (typeof user_input.allow_bucket_creation === 'boolean') {
        data.allow_bucket_creation = Boolean(user_input.allow_bucket_creation);
    } else { // string of true or false
        data.allow_bucket_creation = user_input.allow_bucket_creation.toLowerCase() === 'true';
    }
    // fs_backend deletion specified with empty string '' (but it is not part of the schema)
    data.nsfs_account_config.fs_backend = data.nsfs_account_config.fs_backend || undefined;

    return data;
}

async function fetch_existing_account_data(target) {
    let source;
    try {
        const account_path = target.name ?
            get_config_file_path(accounts_dir_path, target.name) :
            get_symlink_config_file_path(access_keys_dir_path, target.access_keys[0].access_key);
        source = await get_config_data(account_path, true);
        source.access_keys = await nc_mkm.decrypt_access_keys(source);
    } catch (err) {
        dbg.log1('NSFS Manage command: Could not find account', target, err);
        if (err.code === 'ENOENT') {
            if (_.isUndefined(target.name)) {
                throw_cli_error(ManageCLIError.NoSuchAccountAccessKey, target.access_keys[0].access_key);
            } else {
                throw_cli_error(ManageCLIError.NoSuchAccountName, target.name);
            }
        }
        throw err;
    }
    const data = _.merge({}, source, target);
    return data;
}

async function add_account(data) {
    await validate_account_args(data, ACTIONS.ADD);

    const fs_context = native_fs_utils.get_process_fs_context(config_root_backend);
    const access_key = data.access_keys[0].access_key;
    const account_config_path = get_config_file_path(accounts_dir_path, data.name);
    const account_config_relative_path = get_config_file_path(acounts_dir_relative_path, data.name);
    const account_config_access_key_path = get_symlink_config_file_path(access_keys_dir_path, access_key);

    const name_exists = await native_fs_utils.is_path_exists(fs_context, account_config_path);
    const access_key_exists = await native_fs_utils.is_path_exists(fs_context, account_config_access_key_path, true);

    const event_arg = data.name ? data.name : access_key;
    if (name_exists || access_key_exists) {
        const err_code = name_exists ? ManageCLIError.AccountNameAlreadyExists : ManageCLIError.AccountAccessKeyAlreadyExists;
        throw_cli_error(err_code, event_arg, {account: event_arg});
    }
    data._id = mongo_utils.mongoObjectId();
    const encrypted_account = await nc_mkm.encrypt_access_keys(data);
    data.master_key_id = encrypted_account.master_key_id;
    const encrypted_data = JSON.stringify(encrypted_account);
    // We take an object that was stringify
    // (it unwraps ths sensitive strings, creation_date to string and removes undefined parameters)
    // for validating against the schema we need an object, hence we parse it back to object
    nsfs_schema_utils.validate_account_schema(JSON.parse(encrypted_data));
    await native_fs_utils.create_config_file(fs_context, accounts_dir_path, account_config_path, encrypted_data);
    await native_fs_utils._create_path(access_keys_dir_path, fs_context, config.BASE_MODE_CONFIG_DIR);
    await nb_native().fs.symlink(fs_context, account_config_relative_path, account_config_access_key_path);
    write_stdout_response(ManageCLIResponse.AccountCreated, data, { account: event_arg });
}


async function update_account(data) {
    await validate_account_args(data, ACTIONS.UPDATE);

    const fs_context = native_fs_utils.get_process_fs_context(config_root_backend);
    const cur_name = data.name;
    const new_name = data.new_name;
    const cur_access_key = data.access_keys[0].access_key;
    const update_name = new_name && cur_name && data.new_name !== cur_name;
    const update_access_key = data.new_access_key && cur_access_key && data.new_access_key !== cur_access_key;

    if (!update_name && !update_access_key) {
        const account_config_path = get_config_file_path(accounts_dir_path, data.name);
        const encrypted_account = await nc_mkm.encrypt_access_keys(data);
        data.master_key_id = encrypted_account.master_key_id;
        const encrypted_data = JSON.stringify(encrypted_account);
        // We take an object that was stringify
        // (it unwraps ths sensitive strings, creation_date to string and removes undefined parameters)
        // for validating against the schema we need an object, hence we parse it back to object
        nsfs_schema_utils.validate_account_schema(JSON.parse(encrypted_data));
        await native_fs_utils.update_config_file(fs_context, accounts_dir_path, account_config_path, encrypted_data);
        write_stdout_response(ManageCLIResponse.AccountUpdated, data);
        return;
    }
    const data_name = new_name || cur_name;
    data.name = data_name;
    data.email = data_name; // saved internally
    data.access_keys[0].access_key = data.new_access_key || cur_access_key;
    const cur_account_config_path = get_config_file_path(accounts_dir_path, cur_name);
    const new_account_config_path = get_config_file_path(accounts_dir_path, data.name);
    const new_account_relative_config_path = get_config_file_path(acounts_dir_relative_path, data.name);
    const cur_access_key_config_path = get_symlink_config_file_path(access_keys_dir_path, cur_access_key);
    const new_access_key_config_path = get_symlink_config_file_path(access_keys_dir_path, data.access_keys[0].access_key);
    const name_exists = update_name && await native_fs_utils.is_path_exists(fs_context, new_account_config_path);
    const access_key_exists = update_access_key && await native_fs_utils.is_path_exists(fs_context, new_access_key_config_path, true);
    if (name_exists || access_key_exists) {
        const err_code = name_exists ? ManageCLIError.AccountNameAlreadyExists : ManageCLIError.AccountAccessKeyAlreadyExists;
        throw_cli_error(err_code);
    }
    data = _.omit(data, ['new_name', 'new_access_key']);
    const encrypted_account = await nc_mkm.encrypt_access_keys(data);
    data.master_key_id = encrypted_account.master_key_id;
    const encrypted_data = JSON.stringify(encrypted_account);
    data = JSON.stringify(data);

    // We take an object that was stringify
    // (it unwraps ths sensitive strings, creation_date to string and removes undefined parameters)
    // for validating against the schema we need an object, hence we parse it back to object
    nsfs_schema_utils.validate_account_schema(JSON.parse(encrypted_data));
    if (update_name) {
        await native_fs_utils.create_config_file(fs_context, accounts_dir_path, new_account_config_path, encrypted_data);
        await native_fs_utils.delete_config_file(fs_context, accounts_dir_path, cur_account_config_path);
    } else if (update_access_key) {
        await native_fs_utils.update_config_file(fs_context, accounts_dir_path, cur_account_config_path, encrypted_data);
    }
    // TODO: safe_unlink can be better but the current impl causing ELOOP - Too many levels of symbolic links
    // need to find a better way for atomic unlinking of symbolic links
    // handle atomicity for symlinks
    await nb_native().fs.unlink(fs_context, cur_access_key_config_path);
    await nb_native().fs.symlink(fs_context, new_account_relative_config_path, new_access_key_config_path);
    write_stdout_response(ManageCLIResponse.AccountUpdated, data);
}

async function delete_account(data) {
    await validate_account_args(data, ACTIONS.DELETE);
    await verify_delete_account(data.name);

    const fs_context = native_fs_utils.get_process_fs_context(config_root_backend);
    const account_config_path = get_config_file_path(accounts_dir_path, data.name);
    const access_key_config_path = get_symlink_config_file_path(access_keys_dir_path, data.access_keys[0].access_key);

    await native_fs_utils.delete_config_file(fs_context, accounts_dir_path, account_config_path);
    await nb_native().fs.unlink(fs_context, access_key_config_path);
    write_stdout_response(ManageCLIResponse.AccountDeleted, '', {account: data.name});
}

/**
 * verify_delete_account will check if the account has at least one bucket
 * in case it finds one, it would throw an error
 * @param {string} account_name
 */
async function verify_delete_account(account_name) {
    const show_secrets = false; // in buckets we don't save secrets in coofig file
    const fs_context = native_fs_utils.get_process_fs_context(config_root_backend);
    const entries = await nb_native().fs.readdir(fs_context, buckets_dir_path);
    await P.map_with_concurrency(10, entries, async entry => {
        if (entry.name.endsWith('.json')) {
            const full_path = path.join(buckets_dir_path, entry.name);
            const data = await get_config_data(full_path, show_secrets);
            if (data.bucket_owner === account_name) {
                const detail_msg = `Account ${account_name} has bucket ${data.name}`;
                throw_cli_error(ManageCLIError.AccountDeleteForbiddenHasBuckets, detail_msg);
            }
            return data;
        }
    });
}

async function get_account_status(data, show_secrets) {
    await validate_account_args(data, ACTIONS.STATUS);
    try {
        const account_path = _.isUndefined(data.name) ?
            get_symlink_config_file_path(access_keys_dir_path, data.access_keys[0].access_key) :
            get_config_file_path(accounts_dir_path, data.name);
        const config_data = await get_config_data(account_path, show_secrets);
        if (config_data.access_keys) config_data.access_keys = await nc_mkm.decrypt_access_keys(config_data);
        write_stdout_response(ManageCLIResponse.AccountStatus, config_data);
    } catch (err) {
        if (_.isUndefined(data.name)) {
            throw_cli_error(ManageCLIError.NoSuchAccountAccessKey, data.access_keys[0].access_key.unwrap());
        } else {
            throw_cli_error(ManageCLIError.NoSuchAccountName, data.name);
        }
    }
}

async function manage_account_operations(action, data, show_secrets, user_input) {
    if (action === ACTIONS.ADD) {
        await add_account(data);
    } else if (action === ACTIONS.STATUS) {
        await get_account_status(data, show_secrets);
    } else if (action === ACTIONS.UPDATE) {
        await update_account(data);
    } else if (action === ACTIONS.DELETE) {
        await delete_account(data);
    } else if (action === ACTIONS.LIST) {
        const account_filters = _.pick(user_input, LIST_ACCOUNT_FILTERS);
        const accounts = await list_config_files(TYPES.ACCOUNT, accounts_dir_path, data.wide, show_secrets, account_filters);
        write_stdout_response(ManageCLIResponse.AccountList, accounts);
    } else {
        // we should not get here (we check it before)
        throw_cli_error(ManageCLIError.InvalidAction);
    }
}

/**
 * filter_list_item will return an answer of filter_account() or filter_bucket() based on the entity type
 * @param {string} type
 * @param {object} entity
 * @param {string[]} [filters]
 */
function filter_list_item(type, entity, filters) {
    return type === TYPES.ACCOUNT ? filter_account(entity, filters) : filter_bucket(entity, filters);
}

/**
 * filter_account will return true or false based on whether an account meets the criteria defined by the supported flags.
 * @param {object} account
 * @param {string[]} [filters]
 */
function filter_account(account, filters) {
    for (const [key, val] of Object.entries(filters)) {
        if (key === 'uid' || key === 'gid') {
            if (account.nsfs_account_config && account.nsfs_account_config[key] !== val) {
                return false;
            }
        } else if (key === 'user') {
            if (account.nsfs_account_config && account.nsfs_account_config.distinguished_name !== val) {
                return false;
            }
        } else if (key === 'access_key') {
            if (account.access_keys && account.access_keys[0][key] !== val) {
                return false;
            }
        } else if (account[key] !== val) { // We will never reach here if we will not add an appropriate field to the filter 
            return false;
        }
    }
    return true;
}

/**
 * filter_bucket will return true or false based on whether a bucket meets the criteria defined by the supported flags.
 * currently not implemented
 * @param {object} bucket
 * @param {string[]} [filters]
 */
function filter_bucket(bucket, filters) {
    for (const [key, val] of Object.entries(filters)) {
        if (bucket[key] !== val) { // We will never reach here if we will not add an appropriate field to the filter 
            return false;
        }
    }
    return true;
}
/**
 * list_config_files will list all the config files (json) in a given config directory
 * @param {string} config_path
 * @param {boolean} [wide]
 * @param {boolean} [show_secrets]
 * @param {object} [filters]
 */
async function list_config_files(type, config_path, wide, show_secrets, filters) {
    const fs_context = native_fs_utils.get_process_fs_context(config_root_backend);
    const entries = await nb_native().fs.readdir(fs_context, config_path);
    const should_filter = Object.keys(filters).length > 0;

    let config_files_list = await P.map_with_concurrency(10, entries, async entry => {
        if (entry.name.endsWith('.json')) {
            if (wide || should_filter) {
                const full_path = path.join(config_path, entry.name);
                const data = await get_config_data(full_path, show_secrets || should_filter);
                if (data.access_keys) data.access_keys = await nc_mkm.decrypt_access_keys(data);
                if (should_filter && !filter_list_item(type, data, filters)) return undefined;
                // remove secrets on !show_secrets && should filter
                return wide ? _.omit(data, show_secrets ? [] : ['access_keys']) : { name: entry.name.slice(0, entry.name.indexOf('.json')) };
            } else {
                return { name: entry.name.slice(0, entry.name.indexOf('.json')) };
            }
        }
    });
    // it inserts undefined for the entry '.noobaa-config-nsfs' and we wish to remove it
    config_files_list = config_files_list.filter(item => item);

    return config_files_list;
}

/**
 * get_config_data will read a config file and return its content 
 * while omitting secrets if show_secrets flag was not provided
 * @param {string} config_file_path
 * @param {boolean} [show_secrets]
 */
async function get_config_data(config_file_path, show_secrets = false) {
    const fs_context = native_fs_utils.get_process_fs_context(config_root_backend);
    const { data } = await nb_native().fs.readFile(fs_context, config_file_path);
    const config_data = _.omit(JSON.parse(data.toString()), show_secrets ? [] : ['access_keys']);
    return config_data;
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
 * get_access_keys will return the access_keys and new_access_key according to the user input
 * and action
 * @param {string} action
 * @param {object} user_input
 */
function get_access_keys(action, user_input) {
    let access_keys = [{
        access_key: undefined,
        secret_key: undefined,
    }];
    let new_access_key;
    if (action === ACTIONS.ADD || action === ACTIONS.UPDATE || action === ACTIONS.DELETE) {
        _validate_access_keys(user_input.access_key, user_input.secret_key);
    }
    if (action === ACTIONS.ADD || action === ACTIONS.STATUS) {
        const regenerate = action === ACTIONS.ADD;
        access_keys = set_access_keys(user_input.access_key, user_input.secret_key, regenerate);
    } else if (action === ACTIONS.UPDATE) {
        const regenerate = get_boolean_or_string_value(user_input.regenerate);
        access_keys = set_access_keys(user_input.access_key, user_input.secret_key, regenerate);
        new_access_key = access_keys[0].access_key;
        access_keys[0].access_key = undefined; //Setting it as undefined so we can replace the symlink
    }
    return { access_keys, new_access_key };
}

///////////////////////////
///     VALIDATIONS     ///
///////////////////////////

/**
 * validate_bucket_args will validate the cli args of the bucket command
 * @param {object} data
 * @param {string} action
 */
async function validate_bucket_args(data, action) {
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
        const account = await get_bucket_owner_account(data.bucket_owner);
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
            // special case for names, although the type is string we want to allow numbers as well
            if ((option === 'name' || option === 'new_name') && (type_of_value === 'number')) {
                continue;
            }
            // special case for boolean values
            if (['allow_bucket_creation', 'regenerate', 'wide', 'show_secrets', 'force'].includes(option) && validate_boolean_string_value(value)) {
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

///////////////////////////////
///         UTILS           ///
///////////////////////////////

async function whitelist_ips_management(args) {
    const ips = args.ips;
    validate_whitelist_arg(ips);

    const whitelist_ips = JSON.parse(ips);
    verify_whitelist_ips(whitelist_ips);
    const config_path = path.join(config_root, 'config.json');
    try {
        const config_data = require(config_path);
        config_data.S3_SERVER_IP_WHITELIST = whitelist_ips;
        const fs_context = native_fs_utils.get_process_fs_context(config_root_backend);
        const data = JSON.stringify(config_data);
        await native_fs_utils.update_config_file(fs_context, config_root, config_path, data);
    } catch (err) {
        dbg.error('manage_nsfs.whitelist_ips_management: Error while updation config.json,  path ' + config_path, err);
        throw_cli_error(ManageCLIError.WhiteListIPUpdateFailed, config_path);
    }
    write_stdout_response(ManageCLIResponse.WhiteListIPUpdated, ips);
}

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

function _validate_access_keys(access_key, secret_key) {
    // using the access_key flag requires also using the secret_key flag
    if (!_.isUndefined(access_key) && _.isUndefined(secret_key)) {
        throw_cli_error(ManageCLIError.MissingAccountSecretKeyFlag);
    }
    if (!_.isUndefined(secret_key) && _.isUndefined(access_key)) {
        throw_cli_error(ManageCLIError.MissingAccountAccessKeyFlag);
    }
    // checking the complexity of access_key
    if (!_.isUndefined(access_key) && !string_utils.validate_complexity(access_key, {
            require_length: 20,
            check_uppercase: true,
            check_lowercase: false,
            check_numbers: true,
            check_symbols: false,
        })) throw_cli_error(ManageCLIError.AccountAccessKeyFlagComplexity);
    // checking the complexity of secret_key
    if (!_.isUndefined(secret_key) && !string_utils.validate_complexity(secret_key, {
            require_length: 40,
            check_uppercase: true,
            check_lowercase: true,
            check_numbers: true,
            check_symbols: true,
        })) throw_cli_error(ManageCLIError.AccountSecretKeyFlagComplexity);

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

async function glacier_management(argv) {
    const action = argv._[1] || '';
    await manage_glacier_operations(action, argv);
}

async function manage_glacier_operations(action, argv) {
    switch (action) {
        case GLACIER_ACTIONS.MIGRATE:
            await manage_nsfs_glacier.process_migrations();
            break;
        case GLACIER_ACTIONS.RESTORE:
            await manage_nsfs_glacier.process_restores();
            break;
        case GLACIER_ACTIONS.EXPIRY:
            await manage_nsfs_glacier.process_expiry();
            break;
        default:
            throw_cli_error(ManageCLIError.InvalidGlacierOperation);
    }
}

exports.main = main;
if (require.main === module) main();
