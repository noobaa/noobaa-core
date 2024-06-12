/* Copyright (C) 2020 NooBaa */
'use strict';

const dbg = require('../util/debug_module')(__filename);
const _ = require('lodash');
const path = require('path');
const minimist = require('minimist');
const config = require('../../config');
const P = require('../util/promise');
const nb_native = require('../util/nb_native');
const cloud_utils = require('../util/cloud_utils');
const native_fs_utils = require('../util/native_fs_utils');
const mongo_utils = require('../util/mongo_utils');
const SensitiveString = require('../util/sensitive_string');
const ManageCLIError = require('../manage_nsfs/manage_nsfs_cli_errors').ManageCLIError;
const ManageCLIResponse = require('../manage_nsfs/manage_nsfs_cli_responses').ManageCLIResponse;
const manage_nsfs_glacier = require('../manage_nsfs/manage_nsfs_glacier');
const manage_nsfs_logging = require('../manage_nsfs/manage_nsfs_logging');
const noobaa_cli_diagnose = require('../manage_nsfs/diagnose');
const nsfs_schema_utils = require('../manage_nsfs/nsfs_schema_utils');
const { print_usage } = require('../manage_nsfs/manage_nsfs_help_utils');
const { TYPES, ACTIONS, CONFIG_SUBDIRS,
    LIST_ACCOUNT_FILTERS, LIST_BUCKET_FILTERS,
    GLACIER_ACTIONS } = require('../manage_nsfs/manage_nsfs_constants');
const { throw_cli_error, write_stdout_response, get_config_file_path, get_symlink_config_file_path,
    get_config_data, get_boolean_or_string_value, has_access_keys, set_debug_level, get_config_data_if_exists,
    check_and_create_config_dirs, get_bucket_owner_account} = require('../manage_nsfs/manage_nsfs_cli_utils');
const manage_nsfs_validations = require('../manage_nsfs/manage_nsfs_validations');
const nc_mkm = require('../manage_nsfs/nc_master_key_manager').get_instance();

const global_config = Object.seal({
    buckets_dir_name: '/' + CONFIG_SUBDIRS.BUCKETS,
    access_keys_dir_name: '/' + CONFIG_SUBDIRS.ACCESS_KEYS,
    accounts_dir_name: '/' + CONFIG_SUBDIRS.ACCOUNTS,
    accounts_dir_relative_path: '../' + CONFIG_SUBDIRS.ACCOUNTS + '/',
    accounts_dir_relative_path_double: '../../' + CONFIG_SUBDIRS.ACCOUNTS + '/',
    root_accounts_dir_name: '/' + CONFIG_SUBDIRS.ROOT_ACCOUNTS,
    // will be defined during runtime (type is string)
    config_root: '',
    config_root_backend: '',
    buckets_dir_path: '',
    access_keys_dir_path: '',
    accounts_dir_path: '',
    root_accounts_dir_path: ''
});

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
        const user_input_from_file = await manage_nsfs_validations.validate_input_types(type, action, argv);
        const user_input = user_input_from_file || argv;
        if (argv.debug) set_debug_level(argv.debug);
        global_config.config_root = argv.config_root ? String(argv.config_root) : config.NSFS_NC_CONF_DIR;
        if (!global_config.config_root) throw_cli_error(ManageCLIError.MissingConfigDirPath);
        if (argv.config_root) {
            config.NSFS_NC_CONF_DIR = String(argv.config_root);
            config.load_nsfs_nc_config();
            config.reload_nsfs_nc_config();
        }

        global_config.accounts_dir_path = path.join(global_config.config_root, global_config.accounts_dir_name);
        global_config.root_accounts_dir_path = path.join(global_config.config_root, global_config.root_accounts_dir_name);
        global_config.access_keys_dir_path = path.join(global_config.config_root, global_config.access_keys_dir_name);
        global_config.buckets_dir_path = path.join(global_config.config_root, global_config.buckets_dir_name);
        global_config.config_root_backend = argv.config_root_backend ? String(argv.config_root_backend) : config.NSFS_NC_CONFIG_DIR_BACKEND;

        await check_and_create_config_dirs(global_config);
        if (type === TYPES.ACCOUNT) {
            await account_management(action, user_input);
        } else if (type === TYPES.BUCKET) {
            await bucket_management(action, user_input);
        } else if (type === TYPES.IP_WHITELIST) {
            await whitelist_ips_management(argv);
        } else if (type === TYPES.GLACIER) {
            await glacier_management(argv);
        } else if (type === TYPES.LOGGING) {
            await logging_management(user_input);
        } else if (type === TYPES.DIAGNOSE) {
            await noobaa_cli_diagnose.manage_diagnose_operations(action, user_input, global_config);
        } else {
            // we should not get here (we check it before)
            throw_cli_error(ManageCLIError.InvalidType);
        }
    } catch (err) {
        dbg.log1('NSFS Manage command: exit on error', err.stack || err);
        const manage_err = ((err instanceof ManageCLIError) && err) ||
            new ManageCLIError({
                ...(ManageCLIError.FS_ERRORS_TO_MANAGE[err.code] ||
                ManageCLIError.RPC_ERROR_TO_MANAGE[err.rpc_code] ||
                ManageCLIError.InternalError), cause: err });
        process.stdout.write(manage_err.to_string() + '\n', () => {
            process.exit(1);
        });
    }
}

async function bucket_management(action, user_input) {
    manage_nsfs_validations.validate_bucket_args_pre(action, user_input);
    const data = await fetch_bucket_data(action, user_input);
    await manage_bucket_operations(action, data, user_input);
}

// in name and new_name we allow type number, hence convert it to string
async function fetch_bucket_data(action, user_input) {
    let data = {
        // added undefined values to keep the order the properties when printing the data object
        _id: undefined,
        name: _.isUndefined(user_input.name) ? undefined : String(user_input.name),
        tag: undefined, // if we would add the option to tag a bucket using CLI, this should be changed
        versioning: action === ACTIONS.ADD ? 'DISABLED' : undefined,
        creation_date: action === ACTIONS.ADD ? new Date().toISOString() : undefined,
        path: user_input.path,
        should_create_underlying_storage: action === ACTIONS.ADD ? false : undefined,
        new_name: _.isUndefined(user_input.new_name) ? undefined : String(user_input.new_name),
        fs_backend: _.isUndefined(user_input.fs_backend) ? config.NSFS_NC_STORAGE_BACKEND : String(user_input.fs_backend),
        force_md5_etag: _.isUndefined(user_input.force_md5_etag) || user_input.force_md5_etag === '' ? user_input.force_md5_etag : get_boolean_or_string_value(user_input.force_md5_etag)
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

    //if we're updating the owner, needs to override owner in file with the owner from user input.
    //if we're adding a bucket, need to set its owner id field
    if ((action === ACTIONS.UPDATE && user_input.owner) || (action === ACTIONS.ADD)) {
        const account = await get_bucket_owner_account(global_config,
            global_config.root_accounts_dir_path, user_input.owner, true);
        data.owner_account = account._id;
        data.system_owner = account._id; // GAP - needs to be the system_owner (currently it is the account id)
    }

    // override values
    // fs_backend deletion specified with empty string '' (but it is not part of the schema)
    data.fs_backend = data.fs_backend || undefined;
    // s3_policy deletion specified with empty string '' (but it is not part of the schema)
    data.s3_policy = data.s3_policy || undefined;
    // force_md5_etag deletion specified with empty string '' checked against user_input because data.force_md5_etag is boolean
    data.force_md5_etag = data.force_md5_etag === '' ? undefined : data.force_md5_etag;

    return data;
}

async function fetch_existing_bucket_data(target) {
    let source;
    try {
        const bucket_config_path = get_config_file_path(global_config.buckets_dir_path, target.name);
        source = await get_config_data(global_config.config_root_backend, bucket_config_path);
    } catch (err) {
        throw_cli_error(ManageCLIError.NoSuchBucket, target.name);
    }
    const data = _.merge({}, source, target);
    return data;
}

async function add_bucket(data) {
    await manage_nsfs_validations.validate_bucket_args(global_config, data, ACTIONS.ADD);
    const fs_context = native_fs_utils.get_process_fs_context(global_config.config_root_backend);
    const bucket_conf_path = get_config_file_path(global_config.buckets_dir_path, data.name);
    const exists = await native_fs_utils.is_path_exists(fs_context, bucket_conf_path);
    if (exists) throw_cli_error(ManageCLIError.BucketAlreadyExists, data.name, { bucket: data.name });
    data._id = mongo_utils.mongoObjectId();
    const data_json = JSON.stringify(data);
    // We take an object that was stringify
    // (it unwraps ths sensitive strings, creation_date to string and removes undefined parameters)
    // for validating against the schema we need an object, hence we parse it back to object
    nsfs_schema_utils.validate_bucket_schema(JSON.parse(data_json));
    await native_fs_utils.create_config_file(fs_context, global_config.buckets_dir_path, bucket_conf_path, data_json);
    write_stdout_response(ManageCLIResponse.BucketCreated, data_json, { bucket: data.name });
}

async function get_bucket_status(data) {
    await manage_nsfs_validations.validate_bucket_args(global_config, data, ACTIONS.STATUS);
    try {
        const bucket_path = get_config_file_path(global_config.buckets_dir_path, data.name);
        const config_data = await get_config_data(global_config.config_root_backend, bucket_path);
        const account_path = get_config_file_path(global_config.accounts_dir_path, config_data.owner_account);
        const account_data = await get_config_data(global_config.config_root_backend, account_path);
        config_data.owner_account = account_data._id;
        config_data.bucket_owner = account_data.name;

        write_stdout_response(ManageCLIResponse.BucketStatus, config_data);
    } catch (err) {
        const err_code = err.code === 'EACCES' ? ManageCLIError.AccessDenied : ManageCLIError.NoSuchBucket;
        throw_cli_error(err_code, data.name);
    }
}

async function update_bucket(data) {
    await manage_nsfs_validations.validate_bucket_args(global_config, data, ACTIONS.UPDATE);

    const fs_context = native_fs_utils.get_process_fs_context(global_config.config_root_backend);

    const cur_name = data.name;
    const new_name = data.new_name;
    const update_name = new_name && cur_name && new_name !== cur_name;

    if (!update_name) {
        const bucket_config_path = get_config_file_path(global_config.buckets_dir_path, data.name);
        data = JSON.stringify(data);
        // We take an object that was stringify
        // (it unwraps ths sensitive strings, creation_date to string and removes undefined parameters)
        // for validating against the schema we need an object, hence we parse it back to object
        nsfs_schema_utils.validate_bucket_schema(JSON.parse(data));
        await native_fs_utils.update_config_file(fs_context, global_config.buckets_dir_path, bucket_config_path, data);
        write_stdout_response(ManageCLIResponse.BucketUpdated, data);
        return;
    }

    data.name = new_name;

    const cur_bucket_config_path = get_config_file_path(global_config.buckets_dir_path, cur_name);
    const new_bucket_config_path = get_config_file_path(global_config.buckets_dir_path, data.name);

    const exists = await native_fs_utils.is_path_exists(fs_context, new_bucket_config_path);
    if (exists) throw_cli_error(ManageCLIError.BucketAlreadyExists, data.name);

    data = JSON.stringify(_.omit(data, ['new_name']));
    // We take an object that was stringify
    // (it unwraps ths sensitive strings, creation_date to string and removes undefined parameters)
    // for validating against the schema we need an object, hence we parse it back to object
    nsfs_schema_utils.validate_bucket_schema(JSON.parse(data));
    await native_fs_utils.create_config_file(fs_context, global_config.buckets_dir_path, new_bucket_config_path, data);
    await native_fs_utils.delete_config_file(fs_context, global_config.buckets_dir_path, cur_bucket_config_path);
    write_stdout_response(ManageCLIResponse.BucketUpdated, data);
}

async function delete_bucket(data, force) {
    await manage_nsfs_validations.validate_bucket_args(global_config, data, ACTIONS.DELETE);
    // we have fs_contexts: (1) fs_backend for bucket temp dir (2) config_root_backend for config files
    const fs_context_config_root_backend = native_fs_utils.get_process_fs_context(global_config.config_root_backend);
    const fs_context_fs_backend = native_fs_utils.get_process_fs_context(data.fs_backend);
    const bucket_config_path = get_config_file_path(global_config.buckets_dir_path, data.name);
    try {
        const temp_dir_name = native_fs_utils.get_bucket_tmpdir_name(data._id);
        const bucket_temp_dir_path = native_fs_utils.get_bucket_tmpdir_full_path(data.path, data._id);
        let entries;
        try {
            entries = await nb_native().fs.readdir(fs_context_fs_backend, data.path);
        } catch (err) {
            dbg.warn(`delete_bucket: bucket name ${data.name},` +
                `got an error on readdir with path: ${data.path}`, err);
            // if the bucket's path was deleted first (encounter ENOENT error) - continue deletion
            if (err.code !== 'ENOENT') throw err;
        }
        if (entries) {
            const object_entries = entries.filter(element => !element.name.endsWith(temp_dir_name));
            if (object_entries.length > 0 && !force) {
                throw_cli_error(ManageCLIError.BucketDeleteForbiddenHasObjects, data.name);
            }
        }
        await native_fs_utils.folder_delete(bucket_temp_dir_path, fs_context_fs_backend, true);
        await native_fs_utils.delete_config_file(fs_context_config_root_backend, global_config.buckets_dir_path, bucket_config_path);
        write_stdout_response(ManageCLIResponse.BucketDeleted, '', { bucket: data.name });
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
        const wide = get_boolean_or_string_value(user_input.wide);
        const buckets = await list_config_files(TYPES.BUCKET, global_config.buckets_dir_path, wide, undefined, bucket_filters);
        write_stdout_response(ManageCLIResponse.BucketList, buckets);
    } else {
        // we should not get here (we check it before)
        throw_cli_error(ManageCLIError.InvalidAction);
    }
}

async function account_management(action, user_input) {
    const show_secrets = get_boolean_or_string_value(user_input.show_secrets);
    if (get_boolean_or_string_value(user_input.anonymous)) {
        user_input.name = config.ANONYMOUS_ACCOUNT_NAME;
        user_input.email = config.ANONYMOUS_ACCOUNT_NAME;
    }
    // init nc_mkm here to avoid concurrent initializations
    // init if actions is add/update (require encryption) or show_secrets = true (require decryption)
    if ([ACTIONS.ADD, ACTIONS.UPDATE].includes(action) || show_secrets) await nc_mkm.init();

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
    const { access_keys = [], new_access_key = undefined } = user_input.anonymous ? {} : get_access_keys(action, user_input);
    //if we're fetching an iam account, take the name from the specified parameter ("iam_name").
    //otherwise we're fetching a root account, so just use the "name" parameter.
    const name = user_input.iam_name ?? user_input.name;
    let data = {
        // added undefined values to keep the order the properties when printing the data object
        _id: undefined,
        name: _.isUndefined(name) ? undefined : String(name),
        email: _.isUndefined(name) ? undefined : String(name), // temp, keep the email internally
        creation_date: action === ACTIONS.ADD ? new Date().toISOString() : undefined,
        new_name: _.isUndefined(user_input.new_name) ? undefined : String(user_input.new_name),
        new_access_key,
        access_keys,
        force_md5_etag: _.isUndefined(user_input.force_md5_etag) || user_input.force_md5_etag === '' ? user_input.force_md5_etag : get_boolean_or_string_value(user_input.force_md5_etag),
        iam_operate_on_root_account: _.isUndefined(user_input.iam_operate_on_root_account) ?
                undefined : get_boolean_or_string_value(user_input.iam_operate_on_root_account),
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
        const decrypt_secret_key = action === ACTIONS.UPDATE;
        ///note data.name is the same as user_input.name for root users
        data = await fetch_existing_account_data(action, data, user_input.name, decrypt_secret_key);
    }

    //set owner for iam account
    if (action === ACTIONS.ADD && user_input.iam_name) {
        const root_account = await fetch_existing_account_data(action, {name: user_input.name}, user_input.name, false);
        data.owner = root_account._id;
    }

    // override values
    if (has_access_keys(data.access_keys)) {
        // access_key as SensitiveString
        data.access_keys[0].access_key = _.isUndefined(data.access_keys[0].access_key) ? undefined :
            new SensitiveString(String(data.access_keys[0].access_key));
        // secret_key as SensitiveString
        data.access_keys[0].secret_key = _.isUndefined(data.access_keys[0].secret_key) ? undefined :
            new SensitiveString(String(data.access_keys[0].secret_key));
    }
    if (data.new_access_key) data.new_access_key = new SensitiveString(data.new_access_key);
    // fs_backend deletion specified with empty string '' (but it is not part of the schema)
    data.nsfs_account_config.fs_backend = data.nsfs_account_config.fs_backend || undefined;
    // new_buckets_path deletion specified with empty string ''
    data.nsfs_account_config.new_buckets_path = data.nsfs_account_config.new_buckets_path || undefined;
    // force_md5_etag deletion specified with empty string '' checked against user_input.force_md5_etag because data.force_md5_etag is boolean
    data.force_md5_etag = data.force_md5_etag === '' ? undefined : data.force_md5_etag;
    if (_.isUndefined(user_input.allow_bucket_creation)) {
        data.allow_bucket_creation = !_.isUndefined(data.nsfs_account_config.new_buckets_path);
    } else if (typeof user_input.allow_bucket_creation === 'boolean') {
        data.allow_bucket_creation = Boolean(user_input.allow_bucket_creation);
    } else { // string of true or false
        data.allow_bucket_creation = user_input.allow_bucket_creation.toLowerCase() === 'true';
    }

    return data;
}

async function fetch_existing_account_data(action, target, root_name, decrypt_secret_key) {
    let source;
    try {
        const account_path = target.name ?
            get_symlink_config_file_path(global_config.root_accounts_dir_path, target.name, root_name) :
            get_symlink_config_file_path(global_config.access_keys_dir_path, target.access_keys[0].access_key);
        source = await get_config_data(global_config.config_root_backend, account_path, true);
        if (decrypt_secret_key) source.access_keys = await nc_mkm.decrypt_access_keys(source);
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
    if (action === ACTIONS.UPDATE) {
        const uid_update = !_.isUndefined(target.nsfs_account_config.uid);
        const gid_update = !_.isUndefined(target.nsfs_account_config.gid);
        const dn_update = !_.isUndefined(target.nsfs_account_config.distinguished_name);
        const user_fs_permissions_change = uid_update || gid_update || dn_update;
        if (user_fs_permissions_change) {
            if (dn_update) {
                delete data.nsfs_account_config.uid;
                delete data.nsfs_account_config.gid;
            } else {
                delete data.nsfs_account_config.distinguished_name;
            }
        }
    }
    return data;
}

async function add_account(data, user_input) {
    await manage_nsfs_validations.validate_account_args(global_config, data, ACTIONS.ADD, undefined);

    const fs_context = native_fs_utils.get_process_fs_context(global_config.config_root_backend);
    const access_key = has_access_keys(data.access_keys) ? data.access_keys[0].access_key : undefined;
    const account_config_access_key_path = get_symlink_config_file_path(global_config.access_keys_dir_path, access_key);
    //user_input.name is root account name. data.name is iam account name
    const root_account_config_path = get_symlink_config_file_path(global_config.root_accounts_dir_path, data.name, user_input.name);

    const name_exists = await native_fs_utils.is_path_exists(fs_context, root_account_config_path);
    const access_key_exists = await native_fs_utils.is_path_exists(fs_context, account_config_access_key_path, true);

    const event_arg = data.name ? data.name : access_key;
    if (name_exists || access_key_exists) {
        const err_code = name_exists ? ManageCLIError.AccountNameAlreadyExists : ManageCLIError.AccountAccessKeyAlreadyExists;
        throw_cli_error(err_code, event_arg, {account: event_arg});
    }

    data._id = mongo_utils.mongoObjectId();
    const account_config_path = get_config_file_path(global_config.accounts_dir_path, data._id);
    const account_config_relative_path = get_config_file_path(global_config.accounts_dir_relative_path, data._id);
    const account_config_relative_path_double = get_config_file_path(global_config.accounts_dir_relative_path_double, data._id);
    const encrypted_account = await nc_mkm.encrypt_access_keys(data);
    data.master_key_id = encrypted_account.master_key_id;
    const encrypted_data = JSON.stringify(encrypted_account);
    data = _.omitBy(data, _.isUndefined);
    // We take an object that was stringify
    // (it unwraps ths sensitive strings, creation_date to string and removes undefined parameters)
    // for validating against the schema we need an object, hence we parse it back to object
    const account = encrypted_data ? JSON.parse(encrypted_data) : data;
    nsfs_schema_utils.validate_account_schema(account);
    await native_fs_utils.create_config_file(fs_context, global_config.accounts_dir_path, account_config_path, JSON.stringify(account));
    //are we adding a root account?
    if (data.name === user_input.name) {
        //yes. create its account-by-name dir
        await native_fs_utils._create_path(path.join(global_config.root_accounts_dir_path, data.name),
            fs_context, config.BASE_MODE_CONFIG_DIR);
    }
    await nb_native().fs.symlink(fs_context, account_config_relative_path_double, root_account_config_path);
    if (has_access_keys(data.access_keys)) {
        await native_fs_utils._create_path(global_config.access_keys_dir_path, fs_context, config.BASE_MODE_CONFIG_DIR);
        await nb_native().fs.symlink(fs_context, account_config_relative_path, account_config_access_key_path);
    }
    write_stdout_response(ManageCLIResponse.AccountCreated, data, { account: event_arg });
}


async function update_account(data, user_input, is_flag_iam_operate_on_root_account) {
    await manage_nsfs_validations.validate_account_args(global_config, data, ACTIONS.UPDATE, is_flag_iam_operate_on_root_account);

    const fs_context = native_fs_utils.get_process_fs_context(global_config.config_root_backend);
    const cur_name = data.name;
    const new_name = data.new_name;
    const cur_access_key = has_access_keys(data.access_keys) ? data.access_keys[0].access_key : undefined;
    const update_name = new_name && cur_name && data.new_name !== cur_name;
    const update_access_key = data.new_access_key && cur_access_key && data.new_access_key.unwrap() !== cur_access_key.unwrap();
    const is_root_account = data.owner === undefined;

    if (!update_name && !update_access_key) {
        if (data.new_access_key) {
            // the user set the same access-key as was before
            data.access_keys[0] = _.pick(data.access_keys[0], ['access_key', 'secret_key']);
            data = _.omit(data, ['new_access_key']);
        }
        const account_config_path = get_config_file_path(global_config.accounts_dir_path, data._id);
        const encrypted_account = await nc_mkm.encrypt_access_keys(data);
        data.master_key_id = encrypted_account.master_key_id;
        const encrypted_data = JSON.stringify(encrypted_account);
        data = _.omitBy(data, _.isUndefined);
        // We take an object that was stringify
        // (it unwraps ths sensitive strings, creation_date to string and removes undefined parameters)
        // for validating against the schema we need an object, hence we parse it back to object
        const account = encrypted_data ? JSON.parse(encrypted_data) : data;
        nsfs_schema_utils.validate_account_schema(account);
        await native_fs_utils.update_config_file(fs_context, global_config.accounts_dir_path, account_config_path, JSON.stringify(account));
        write_stdout_response(ManageCLIResponse.AccountUpdated, data);
        return;
    }
    const data_name = new_name || cur_name;
    data.name = data_name;
    data.email = data_name; // saved internally
    data.access_keys[0] = {
        access_key: data.new_access_key || cur_access_key,
        secret_key: data.access_keys[0].secret_key,
    };
    data.access_keys[0].access_key = data.new_access_key || cur_access_key;
    const cur_root_account_config_path = get_symlink_config_file_path(global_config.root_accounts_dir_path, cur_name, user_input.name);
    const new_root_account_config_path = get_symlink_config_file_path(global_config.root_accounts_dir_path, new_name,
        is_root_account ? new_name : user_input.name);
    const new_account_config_path = get_config_file_path(global_config.accounts_dir_path, data._id);
    const new_account_relative_config_path = get_config_file_path(global_config.accounts_dir_relative_path, data._id);
    const new_account_relative_config_path_double = get_config_file_path(global_config.accounts_dir_relative_path_double, data._id);
    const cur_access_key_config_path = get_symlink_config_file_path(global_config.access_keys_dir_path, cur_access_key);
    const new_access_key_config_path = get_symlink_config_file_path(global_config.access_keys_dir_path, data.access_keys[0].access_key);
    const name_exists = update_name && await native_fs_utils.is_path_exists(fs_context, new_root_account_config_path);
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
        //remove the current by-name symlink in root_account dir
        await nb_native().fs.unlink(fs_context, cur_root_account_config_path);
        //are we changing name of a root account?
        if (is_root_account) {
            //yes. change the name of the root account dir.
            await nb_native().fs.rename(fs_context,
                path.join(global_config.root_accounts_dir_path, cur_name),
                path.join(global_config.root_accounts_dir_path, new_name));
        }
        //re-create the by-name symlink the the updated root account dir
        await nb_native().fs.symlink(fs_context, new_account_relative_config_path_double, new_root_account_config_path);
    }
    await native_fs_utils.update_config_file(fs_context, global_config.accounts_dir_path, new_account_config_path, encrypted_data);
    //}
    // TODO: safe_unlink can be better but the current impl causing ELOOP - Too many levels of symbolic links
    // need to find a better way for atomic unlinking of symbolic links
    // handle atomicity for symlinks
    await nb_native().fs.unlink(fs_context, cur_access_key_config_path);
    await nb_native().fs.symlink(fs_context, new_account_relative_config_path, new_access_key_config_path);
    write_stdout_response(ManageCLIResponse.AccountUpdated, data);
}

async function delete_account(data, user_input) {
    await manage_nsfs_validations.validate_account_args(global_config, data, ACTIONS.DELETE, undefined);

    const fs_context = native_fs_utils.get_process_fs_context(global_config.config_root_backend);
    const account_config_path = get_config_file_path(global_config.accounts_dir_path, data._id);
    await native_fs_utils.delete_config_file(fs_context, global_config.accounts_dir_path, account_config_path);
    if (has_access_keys(data.access_keys)) {
        for (const access_key_object of data.access_keys) {
            const access_key_config_path = get_symlink_config_file_path(global_config.access_keys_dir_path, access_key_object.access_key);
            await nb_native().fs.unlink(fs_context, access_key_config_path);
        }
    }
    //are we deleting a root account?
    if (data.name === user_input.name) {
        //yes. delete entire dir.
        const root_account_config_path = path.join(global_config.root_accounts_dir_path, data.name);
        await native_fs_utils.folder_delete(root_account_config_path, fs_context);
    } else {
        //no. delete just the iam account symlink
        const iam_account_config_path = get_symlink_config_file_path(global_config.root_accounts_dir_path, data.name, user_input.name);
        await nb_native().fs.unlink(fs_context, iam_account_config_path);
    }
    write_stdout_response(ManageCLIResponse.AccountDeleted, '', {account: data.name});
}

async function get_account_status(data, user_input, show_secrets) {
    await manage_nsfs_validations.validate_account_args(global_config, data, ACTIONS.STATUS, undefined);
    try {
        const account_path = _.isUndefined(user_input.name) ?
            get_symlink_config_file_path(global_config.access_keys_dir_path, data.access_keys[0].access_key) :
            //user_input.name is root account name. data.name is iam account name
            get_symlink_config_file_path(global_config.root_accounts_dir_path, data.name, user_input.name);
        const config_data = await get_config_data(global_config.config_root_backend, account_path, show_secrets);
        if (config_data.access_keys) config_data.access_keys = await nc_mkm.decrypt_access_keys(config_data);
        write_stdout_response(ManageCLIResponse.AccountStatus, config_data);
    } catch (err) {
        if (err.code !== 'ENOENT') throw err;
        if (_.isUndefined(data.name)) {
            throw_cli_error(ManageCLIError.NoSuchAccountAccessKey, data.access_keys[0].access_key.unwrap());
        } else {
            throw_cli_error(ManageCLIError.NoSuchAccountName, data.name);
        }
    }
}

async function manage_account_operations(action, data, show_secrets, user_input) {
    if (action === ACTIONS.ADD) {
        await add_account(data, user_input);
    } else if (action === ACTIONS.STATUS) {
        await get_account_status(data, user_input, show_secrets);
    } else if (action === ACTIONS.UPDATE) {
        const is_flag_iam_operate_on_root_account = get_boolean_or_string_value(user_input.iam_operate_on_root_account);
        await update_account(data, user_input, is_flag_iam_operate_on_root_account);
    } else if (action === ACTIONS.DELETE) {
        await delete_account(data, user_input);
    } else if (action === ACTIONS.LIST) {
        const account_filters = _.pick(user_input, LIST_ACCOUNT_FILTERS);
        const wide = get_boolean_or_string_value(user_input.wide);
        const accounts = await list_config_files(TYPES.ACCOUNT, global_config.root_accounts_dir_path, wide,
            show_secrets, account_filters);
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
    const fs_context = native_fs_utils.get_process_fs_context(global_config.config_root_backend);
    const entries = await nb_native().fs.readdir(fs_context, config_path);
    const should_filter = Object.keys(filters).length > 0;
    const suffix = type === TYPES.ACCOUNT ? '' : '.json';

    let config_files_list = await P.map_with_concurrency(10, entries, async entry => {
        if (entry.name.endsWith(suffix)) {
            if (wide || should_filter) {
                const full_path = type === TYPES.ACCOUNT ?
                    path.join(config_path, entry.name, entry.name + ".symlink") :
                    path.join(config_path, entry.name);
                const data = await get_config_data_if_exists(global_config.config_root_backend, full_path, show_secrets || should_filter);
                if (!data) return undefined;
                // decryption causing mkm initalization
                // decrypt only if data has access_keys and show_secrets = true (no need to decrypt if show_secrets = false but should_filter = true)
                if (data.access_keys && show_secrets) data.access_keys = await nc_mkm.decrypt_access_keys(data);
                if (should_filter && !filter_list_item(type, data, filters)) return undefined;
                // remove secrets on !show_secrets && should filter
                return wide ? _.omit(data, show_secrets ? [] : ['access_keys']) : { name: data.name };
            } else {
                return { name: suffix.length > 0 ? entry.name.slice(0, entry.name.indexOf(suffix)) : entry.name };
            }
        }
    });
    // it inserts undefined for the entry '.noobaa-config-nsfs' and we wish to remove it
    // in case the entry was deleted during the list it also inserts undefined
    config_files_list = config_files_list.filter(item => item);

    return config_files_list;
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
        manage_nsfs_validations._validate_access_keys(user_input.access_key, user_input.secret_key);
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

async function whitelist_ips_management(args) {
    const ips = args.ips;
    manage_nsfs_validations.validate_whitelist_arg(ips);

    const whitelist_ips = JSON.parse(ips);
    manage_nsfs_validations.validate_whitelist_ips(whitelist_ips);
    const config_path = path.join(global_config.config_root, 'config.json');
    try {
        const config_data = require(config_path);
        config_data.S3_SERVER_IP_WHITELIST = whitelist_ips;
        const fs_context = native_fs_utils.get_process_fs_context(global_config.config_root_backend);
        const data = JSON.stringify(config_data);
        await native_fs_utils.update_config_file(fs_context, global_config.config_root, config_path, data);
    } catch (err) {
        dbg.error('manage_nsfs.whitelist_ips_management: Error while updation config.json,  path ' + config_path, err);
        throw_cli_error(ManageCLIError.WhiteListIPUpdateFailed, config_path);
    }
    write_stdout_response(ManageCLIResponse.WhiteListIPUpdated, ips);
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

async function logging_management(user_input) {
    await manage_nsfs_logging.export_bucket_logging(user_input);
}

exports.main = main;
if (require.main === module) main();
