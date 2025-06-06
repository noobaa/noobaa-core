/* Copyright (C) 2020 NooBaa */
'use strict';

// DO NOT PUT NEW REQUIREMENTS BEFORE SETTING process.env.NC_NSFS_NO_DB_ENV = 'true' 
// NC nsfs deployments specifying process.env.LOCAL_MD_SERVER=true deployed together with a db
// when a system_store object is initialized VaccumAnalyzer is being called once a day.
// when NC nsfs deployed without db we would like to avoid running VaccumAnalyzer in any flow there is
// because running it will cause a panic.
if (process.env.LOCAL_MD_SERVER !== 'true') {
    process.env.NC_NSFS_NO_DB_ENV = 'true';
}

const dbg = require('../util/debug_module')(__filename);
if (!dbg.get_process_name()) dbg.set_process_name('noobaa-cli');

const _ = require('lodash');
const minimist = require('minimist');
const config = require('../../config');
const P = require('../util/promise');
const nb_native = require('../util/nb_native');
const { ConfigFS } = require('../sdk/config_fs');
const cloud_utils = require('../util/cloud_utils');
const native_fs_utils = require('../util/native_fs_utils');
const mongo_utils = require('../util/mongo_utils');
const SensitiveString = require('../util/sensitive_string');
const { account_id_cache } = require('../sdk/accountspace_fs');
const ManageCLIError = require('../manage_nsfs/manage_nsfs_cli_errors').ManageCLIError;
const ManageCLIResponse = require('../manage_nsfs/manage_nsfs_cli_responses').ManageCLIResponse;
const manage_nsfs_glacier = require('../manage_nsfs/manage_nsfs_glacier');
const { NCLifecycle } = require('../manage_nsfs/nc_lifecycle');
const manage_nsfs_logging = require('../manage_nsfs/manage_nsfs_logging');
const noobaa_cli_diagnose = require('../manage_nsfs/diagnose');
const noobaa_cli_upgrade = require('../manage_nsfs/upgrade');
const { print_usage } = require('../manage_nsfs/manage_nsfs_help_utils');
const { TYPES, ACTIONS, LIST_ACCOUNT_FILTERS, LIST_BUCKET_FILTERS, GLACIER_ACTIONS } = require('../manage_nsfs/manage_nsfs_constants');
const { throw_cli_error, get_bucket_owner_account_by_name,
    write_stdout_response, get_boolean_or_string_value, has_access_keys, set_debug_level,
    is_name_update, is_access_key_update, parse_comma_delimited_string } = require('../manage_nsfs/manage_nsfs_cli_utils');
const manage_nsfs_validations = require('../manage_nsfs/manage_nsfs_validations');
const nc_mkm = require('../manage_nsfs/nc_master_key_manager').get_instance();
const notifications_util = require('../util/notifications_util');
const BucketSpaceFS = require('../sdk/bucketspace_fs');
const NoobaaEvent = require('../manage_nsfs/manage_nsfs_events_utils').NoobaaEvent;

///////////////
//// GENERAL //
///////////////

let config_fs;

async function main(argv = minimist(process.argv.slice(2))) {
    try {
        config.EVENT_LOGGING_ENABLED = true;
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
        const config_root = argv.config_root ? String(argv.config_root) : config.NSFS_NC_CONF_DIR;
        if (!config_root) throw_cli_error(ManageCLIError.MissingConfigDirPath);
        if (argv.config_root) {
            config.NSFS_NC_CONF_DIR = String(argv.config_root);
            config.load_nsfs_nc_config();
            config.reload_nsfs_nc_config();
        }
        const config_root_backend = argv.config_root_backend ? String(argv.config_root_backend) : config.NSFS_NC_CONFIG_DIR_BACKEND;
        const fs_context = native_fs_utils.get_process_fs_context(config_root_backend);

        config_fs = new ConfigFS(config_root, config_root_backend, fs_context);

        await config_fs.create_config_dirs_if_missing();
        if (type === TYPES.ACCOUNT) {
            await account_management(action, user_input);
        } else if (type === TYPES.BUCKET) {
            await bucket_management(action, user_input);
        } else if (type === TYPES.IP_WHITELIST) {
            await whitelist_ips_management(argv);
        } else if (type === TYPES.GLACIER) {
            await glacier_management(argv);
        } else if (type === TYPES.LOGGING) {
            await logging_management();
        } else if (type === TYPES.DIAGNOSE) {
            await noobaa_cli_diagnose.manage_diagnose_operations(action, user_input, config_fs);
        } else if (type === TYPES.UPGRADE) {
            await noobaa_cli_upgrade.manage_upgrade_operations(action, user_input, config_fs);
        } else if (type === TYPES.NOTIFICATION) {
            await notification_management();
        } else if (type === TYPES.CONNECTION) {
            await connection_management(action, user_input);
        } else if (type === TYPES.LIFECYCLE) {
            await lifecycle_management(argv);
        } else {
            throw_cli_error(ManageCLIError.InvalidType);
        }
    } catch (err) {
        dbg.log1('NSFS Manage command: exit on error', err.stack || err);
        const manage_err = ((err instanceof ManageCLIError) && err) || (() => {
            try {
                throw_cli_error({
                    ...(ManageCLIError.FS_ERRORS_TO_MANAGE[err.code] ||
                    ManageCLIError.RPC_ERROR_TO_MANAGE[err.rpc_code] ||
                    ManageCLIError.InternalError), // fallback to InternalError and record the event
                    cause: err
                });
            } catch (e) { return e; }
        })();
        process.stdout.write(manage_err.to_string() + '\n', () => {
            process.exit(1);
        });
    }
}

///////////////
//// BUCKETS //
///////////////

// in name and new_name we allow type number, hence convert it to string
async function fetch_bucket_data(action, user_input) {
    let data = {
        // added undefined values to keep the order the properties when printing the data object
        _id: undefined,
        name: user_input.name === undefined ? undefined : String(user_input.name),
        owner_account: undefined,
        tag: undefined, // if we would add the option to tag a bucket using CLI, this should be changed
        versioning: action === ACTIONS.ADD ? 'DISABLED' : undefined,
        creation_date: action === ACTIONS.ADD ? new Date().toISOString() : undefined,
        path: user_input.path,
        should_create_underlying_storage: action === ACTIONS.ADD ? false : undefined,
        new_name: user_input.new_name === undefined ? undefined : String(user_input.new_name),
        fs_backend: user_input.fs_backend === undefined ? config.NSFS_NC_STORAGE_BACKEND : String(user_input.fs_backend),
        force_md5_etag: user_input.force_md5_etag === undefined || user_input.force_md5_etag === '' ? user_input.force_md5_etag : get_boolean_or_string_value(user_input.force_md5_etag),
        notifications: user_input.notifications
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
    if (action === ACTIONS.ADD || action === ACTIONS.UPDATE) {
        if (user_input.should_create_underlying_storage !== undefined) {
            data.should_create_underlying_storage = Boolean(user_input.should_create_underlying_storage);
        }
    }
    if (action === ACTIONS.UPDATE || action === ACTIONS.DELETE) {
        // @ts-ignore
        data = _.omitBy(data, _.isUndefined);
        data = await merge_new_and_existing_config_data(data);
    }

    if ((action === ACTIONS.UPDATE && user_input.tag) || (action === ACTIONS.ADD)) {
        const tags = JSON.parse(user_input.tag || '[]');
        data.tag = BucketSpaceFS._merge_reserved_tags(
            data.tag || BucketSpaceFS._default_bucket_tags(),
            tags,
            action === ACTIONS.ADD ? true : await _is_bucket_empty(data),
        );
    }

    if ((action === ACTIONS.UPDATE && user_input.merge_tag) || (action === ACTIONS.ADD)) {
        const merge_tags = JSON.parse(user_input.merge_tag || '[]');
        data.tag = _.merge(
            data.tag,
            BucketSpaceFS._merge_reserved_tags(
                data.tag || BucketSpaceFS._default_bucket_tags(),
                merge_tags,
                action === ACTIONS.ADD ? true : await _is_bucket_empty(data),
            )
        );
    }

    //if we're updating the owner, needs to override owner in file with the owner from user input.
    //if we're adding a bucket, need to set its owner id field
    if ((action === ACTIONS.UPDATE && user_input.owner) || (action === ACTIONS.ADD)) {
        const account = await get_bucket_owner_account_by_name(config_fs, String(user_input.owner));
        data.owner_account = account._id;
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

/**
 * merge_new_and_existing_config_data returns the merged object of the existing bucket data and the user data
 * @param {Object} user_input_bucket_data 
 * @returns {Promise<Object>} 
 */
async function merge_new_and_existing_config_data(user_input_bucket_data) {
    let existing_bucket_data;
    try {
        existing_bucket_data = await config_fs.get_bucket_by_name(user_input_bucket_data.name);
    } catch (err) {
        throw_cli_error(ManageCLIError.NoSuchBucket, user_input_bucket_data.name);
    }
    const data = _.merge({}, existing_bucket_data, user_input_bucket_data);
    return data;
}

/**
 * add_bucket does the following - 
 * 1. attaches an ID to the new bucket
 * 2. creates a bucket config file based on the user input
 * 3. set the bucket owner name on the response
 * @param {Object} data 
 * @returns { Promise<{ code: ManageCLIResponse.BucketCreated, detail: Object, event_arg: Object }>} 
 */
async function add_bucket(data) {
    data._id = mongo_utils.mongoObjectId();
    const parsed_bucket_data = await config_fs.create_bucket_config_file(data);

    const account = await account_id_cache.get_with_cache({ _id: parsed_bucket_data.owner_account, config_fs });
    await set_bucker_owner(parsed_bucket_data, account);

    const [reserved_tag_event_args] = BucketSpaceFS._generate_reserved_tag_event_args({}, data.tag);
    if (parsed_bucket_data.should_create_underlying_storage) {
        await BucketSpaceFS._create_uls(
            config_fs.fs_context,
            await native_fs_utils.get_fs_context(account.nsfs_account_config, parsed_bucket_data.fs_backend),
            data.name,
            data.path,
            config_fs.get_bucket_path_by_name(data.name)
        );
    }

    return {
        code: ManageCLIResponse.BucketCreated,
        detail: parsed_bucket_data,
        event_arg: { ...(reserved_tag_event_args || {}), bucket: data.name, account: parsed_bucket_data.bucket_owner },
    };
}

/**
 * get_bucket_status returns the bucket data by the provided bucket name
 * @param {Object} data 
 * @returns { Promise<{ code: typeof ManageCLIResponse.BucketStatus, detail: Object }>} 
 */
async function get_bucket_status(data) {
    try {
        const bucket_data = await config_fs.get_bucket_by_name(data.name);
        await set_bucker_owner(bucket_data);
        return { code: ManageCLIResponse.BucketStatus, detail: bucket_data };
    } catch (err) {
        const err_code = err.code === 'EACCES' ? ManageCLIError.AccessDenied : ManageCLIError.NoSuchBucket;
        throw_cli_error(err_code, data.name);
    }
}

/**
 * update_bucket does the following - 
 * 1. checks if the update includes bucket name update
 *    1.1. if yes - a new config file should be created and the old one should be removed
 *    1.2. else - update the config file
 * 2. set the bucket owner name on the response
 * @param {Object} data
 * @returns { Promise<{ code: typeof ManageCLIResponse.BucketUpdated, detail: Object }>} 
 */
async function update_bucket(data) {
    const cur_name = data.name;
    const new_name = data.new_name;
    const name_update = is_name_update(data);
    const cli_bucket_flags_to_remove = ['new_name'];
    data = _.omit(data, cli_bucket_flags_to_remove);

    let parsed_bucket_data;

    if (name_update) {
        parsed_bucket_data = await config_fs.create_bucket_config_file({ ...data, name: new_name });
        await config_fs.delete_bucket_config_file(cur_name);
    } else {
        parsed_bucket_data = await config_fs.update_bucket_config_file(data);
    }
    await set_bucker_owner(parsed_bucket_data);
    return { code: ManageCLIResponse.BucketUpdated, detail: parsed_bucket_data };
}

/**
 * delete_bucket deletes a bucket -
 * 1. if there are existing objects in the bucket and force flag was not provided the deletion will be blocked
 * @param {Object} data 
 * @param {Boolean} force
 * @returns { Promise<{ code: typeof ManageCLIResponse.BucketDeleted, detail: Object, event_arg: Object }>} 
 */
async function delete_bucket(data, force) {
    try {
        const bucket_empty = await _is_bucket_empty(data);
        if (!bucket_empty && !force) {
            throw_cli_error(ManageCLIError.BucketDeleteForbiddenHasObjects, data.name);
        }

        const bucket_temp_dir_path = native_fs_utils.get_bucket_tmpdir_full_path(data.path, data._id);
        const fs_context_fs_backend = native_fs_utils.get_process_fs_context(data.fs_backend);

        await native_fs_utils.folder_delete(bucket_temp_dir_path, fs_context_fs_backend, true);
        await config_fs.delete_bucket_config_file(data.name);
        if (data.should_create_underlying_storage) {
            try {
                await nb_native().fs.rmdir(config_fs.fs_context, data.path);
            } catch (error) {
                dbg.warn('failed to delete underlying storage directory:', error);
            }
        }
        return { code: ManageCLIResponse.BucketDeleted, detail: { name: data.name }, event_arg: { bucket: data.name } };
    } catch (err) {
        if (err.code === 'ENOENT') throw_cli_error(ManageCLIError.NoSuchBucket, data.name);
        throw err;
    }
}


/**
 * filter_bucket will return true or false based on whether a bucket meets the criteria defined by the supported flags.
 * @param {object} bucket
 * @param {object} [filters]
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
 * list_bucket_config_files will list all the bucket config files (json) in a given config directory
 * @param {boolean} [wide]
 * @param {object} [filters]
 */
async function list_bucket_config_files(wide, filters = {}) {
    let entry_names = [];
    const should_filter = Object.keys(filters).length > 0;
    const is_filter_by_name = filters.name !== undefined;

    const options = {
        silent_if_missing: true
    };

    // in case we have a filter by name, we don't need to read all the entries and iterate them
    // instead we "mock" the entries array to have one entry and it is the name by the filter (we add it for performance)
    if (is_filter_by_name) {
        entry_names = [filters.name];
    } else {
        entry_names = await config_fs.list_buckets();
    }

    let config_files_list = await P.map_with_concurrency(10, entry_names, async entry_name => {
        if (wide || should_filter) {
            const data = await config_fs.get_bucket_by_name(entry_name, options);
            if (!data) return undefined;
            if (should_filter && !filter_bucket(data, filters)) return undefined;
            if (!wide) return { name: entry_name };
            await set_bucker_owner(data);
            return data;
        } else {
            return { name: entry_name };
        }
    });
    // it inserts undefined for the entry '.noobaa-config-nsfs' and we wish to remove it
    // in case the entry was deleted during the list it also inserts undefined
    config_files_list = config_files_list.filter(item => item);

    return config_files_list;
}

/**
 * _is_bucket_empty returns true if the given bucket is empty
 *
 * @param {*} data 
 * @returns {Promise<boolean>}
 */
async function _is_bucket_empty(data) {
    const temp_dir_name = native_fs_utils.get_bucket_tmpdir_name(data._id);
    // fs_contexts for bucket temp dir (storage path)
    const fs_context_fs_backend = native_fs_utils.get_process_fs_context(data.fs_backend);
    let entries;
    try {
        entries = await nb_native().fs.readdir(fs_context_fs_backend, data.path);
    } catch (err) {
        dbg.warn(`_is_bucket_empty: bucket name ${data.name},` +
            `got an error on readdir with path: ${data.path}`, err);
        // if the bucket's path was deleted first (encounter ENOENT error) - continue deletion
        if (err.code !== 'ENOENT') throw err;
    }
    if (entries) {
        const object_entries = entries.filter(element => !element.name.endsWith(temp_dir_name));
        return object_entries.length === 0;
    }

    return true;
}

/**
 * bucket_management does the following - 
 * 1. fetches the bucket data if this is not a list operation
 * 2. validates bucket args - TODO - we should split it to validate_bucket_args 
 * and validations of the merged (user_input + existing bucket config) bucket
 * 3. call bucket operation based on the action argument
 * 4. write output to stdout
 * @param {'add'|'update'|'delete'|'status'|'list'} action 
 * @param {Object} user_input 
 */
async function bucket_management(action, user_input) {
    const data = action === ACTIONS.LIST ? undefined : await fetch_bucket_data(action, user_input);
    await manage_nsfs_validations.validate_bucket_args(config_fs, data, action);
    await manage_nsfs_validations.validate_bucket_notifications(config_fs, user_input);

    let response = {};
    if (action === ACTIONS.ADD) {
        response = await add_bucket(data);
    } else if (action === ACTIONS.STATUS) {
        response = await get_bucket_status(data);
    } else if (action === ACTIONS.UPDATE) {
        const bucket_path = config_fs.get_bucket_path_by_name(user_input.name);
        const bucket_lock_file = `${bucket_path}.lock`;
        await native_fs_utils.lock_and_run(config_fs.fs_context, bucket_lock_file, async () => {
            const prev_bucket_info = await fetch_bucket_data(action, _.omit(user_input, ['tag', 'merge_tag']));
            const bucket_info = await fetch_bucket_data(action, user_input);

            const tagging_object = BucketSpaceFS._objectify_tagging_arr(prev_bucket_info.tag);
            const [
                reserved_tag_event_args,
                reserved_tag_modified,
            ] = BucketSpaceFS._generate_reserved_tag_event_args(tagging_object, bucket_info.tag);

            response = await update_bucket(bucket_info);
            if (reserved_tag_modified) {
                new NoobaaEvent(NoobaaEvent.BUCKET_RESERVED_TAG_MODIFIED)
                    .create_event(undefined, { ...reserved_tag_event_args, bucket_name: user_input.name });
            }
        });
    } else if (action === ACTIONS.DELETE) {
        const force = get_boolean_or_string_value(user_input.force);
        response = await delete_bucket(data, force);
    } else if (action === ACTIONS.LIST) {
        const bucket_filters = _.pick(user_input, LIST_BUCKET_FILTERS);
        const wide = get_boolean_or_string_value(user_input.wide);
        const buckets = await list_bucket_config_files(wide, bucket_filters);
        response = { code: ManageCLIResponse.BucketList, detail: buckets };
    } else {
        throw_cli_error(ManageCLIError.InvalidAction);
    }
    write_stdout_response(response.code, response.detail, response.event_arg);
}

////////////////
//// ACCOUNTS //
////////////////

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
    let data = {
        // added undefined values to keep the order the properties when printing the data object
        _id: undefined,
        name: user_input.name === undefined ? undefined : String(user_input.name),
        email: user_input.name === undefined ? undefined : String(user_input.name), // temp, keep the email internally
        creation_date: action === ACTIONS.ADD ? new Date().toISOString() : undefined,
        new_name: user_input.new_name === undefined ? undefined : String(user_input.new_name),
        new_access_key,
        access_keys,
        force_md5_etag: user_input.force_md5_etag === undefined || user_input.force_md5_etag === '' ? user_input.force_md5_etag : get_boolean_or_string_value(user_input.force_md5_etag),
        iam_operate_on_root_account: user_input.iam_operate_on_root_account === undefined ?
                undefined : get_boolean_or_string_value(user_input.iam_operate_on_root_account),
        nsfs_account_config: {
            distinguished_name: user_input.user,
            uid: user_input.user ? undefined : user_input.uid,
            gid: user_input.user ? undefined : user_input.gid,
            new_buckets_path: user_input.new_buckets_path,
            fs_backend: user_input.fs_backend ? String(user_input.fs_backend) : config.NSFS_NC_STORAGE_BACKEND
        },
        default_connection: user_input.default_connection === undefined ? undefined : String(user_input.default_connection)
    };
    if (action === ACTIONS.UPDATE || action === ACTIONS.DELETE) {
        // @ts-ignore
        data = _.omitBy(data, _.isUndefined);
        const decrypt_secret_key = action === ACTIONS.UPDATE;
        data = await fetch_existing_account_data(action, data, decrypt_secret_key);
    }

    // override values
    if (has_access_keys(data.access_keys)) {
        // access_key as SensitiveString
        data.access_keys[0].access_key = data.access_keys[0].access_key === undefined ? undefined :
            new SensitiveString(String(data.access_keys[0].access_key));
        // secret_key as SensitiveString
        data.access_keys[0].secret_key = data.access_keys[0].secret_key === undefined ? undefined :
            new SensitiveString(String(data.access_keys[0].secret_key));
    }
    //since supplemental_groups is an array, new list will merge with the old one instead of replacing it in fetch_existing_account_data
    //so we need to replace this value after merging the data
    data.nsfs_account_config.supplemental_groups = user_input.supplemental_groups === undefined ?
        data.nsfs_account_config.supplemental_groups : parse_comma_delimited_string(user_input.supplemental_groups);

    if (data.new_access_key) data.new_access_key = new SensitiveString(data.new_access_key);
    // fs_backend deletion specified with empty string '' (but it is not part of the schema)
    data.nsfs_account_config.fs_backend = data.nsfs_account_config.fs_backend || undefined;
    // new_buckets_path deletion specified with empty string ''
    data.nsfs_account_config.new_buckets_path = data.nsfs_account_config.new_buckets_path || undefined;
    // force_md5_etag deletion specified with empty string '' checked against user_input.force_md5_etag because data.force_md5_etag is boolean
    data.force_md5_etag = data.force_md5_etag === '' ? undefined : data.force_md5_etag;
    if (user_input.allow_bucket_creation === undefined) {
        data.allow_bucket_creation = data.nsfs_account_config.new_buckets_path !== undefined;
    } else if (typeof user_input.allow_bucket_creation === 'boolean') {
        data.allow_bucket_creation = Boolean(user_input.allow_bucket_creation);
    } else { // string of true or false
        data.allow_bucket_creation = user_input.allow_bucket_creation.toLowerCase() === 'true';
    }

    return data;
}

async function fetch_existing_account_data(action, target, decrypt_secret_key) {
    const options = { show_secrets: true, decrypt_secret_key };
    let source;
    try {
        source = await config_fs.get_account_by_name(target.name, options);
    } catch (err) {
        dbg.warn(`fetch_existing_account_data: account with name ${target.name} got an error:`, err);
        if (err.code === 'ENOENT') {
            throw_cli_error(ManageCLIError.NoSuchAccountName, target.name);
        }
        throw err;
    }
    const data = _.merge({}, source, target);
    if (action === ACTIONS.UPDATE) {
        const uid_update = target.nsfs_account_config.uid !== undefined;
        const gid_update = target.nsfs_account_config.gid !== undefined;
        const dn_update = target.nsfs_account_config.distinguished_name !== undefined;
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

/**
 * add_account creates a new account config file and return the decrypted data 
 * we do not return the parsed data because the parsed access keys are encrypted 
 * @param {Object} data
 * @returns { Promise<{ code: typeof ManageCLIResponse.AccountCreated, detail: Object, event_arg: Object  }>} 
 */
async function add_account(data) {
    data._id = mongo_utils.mongoObjectId();
    await config_fs.create_account_config_file(data);
    return { code: ManageCLIResponse.AccountCreated, detail: data, event_arg: { account: data.name } };
}

/**
 * update_account does the following updates an existing config file, 
 * if a new_name provided it will pass old_name to the update function for unlinking the index (symlink inside accounts_by_name/ dir)
 * if a new_access_key provided it will pass the cur_access_key for unlinking the index (symlink inside access_keys/ dir)
 * @param {Object} data
 * @returns { Promise<{ code: typeof ManageCLIResponse.AccountUpdated, detail: Object }>} 
 */
async function update_account(data) {
    const cur_name = data.name;
    const new_name = data.new_name;
    const cur_access_key = has_access_keys(data.access_keys) ? data.access_keys[0].access_key : undefined;
    const update_name = is_name_update(data);
    const update_access_key = is_access_key_update(data);

    const account_name = new_name || cur_name;
    data.name = account_name;
    data.email = account_name; // saved internally
    if (data.new_access_key) {
        data.access_keys[0] = {
            access_key: data.new_access_key,
            secret_key: data.access_keys[0].secret_key,
        };
    }
    const cli_account_flags_to_remove = ['new_name', 'new_access_key'];
    data = _.omit(data, cli_account_flags_to_remove);

    await config_fs.update_account_config_file(data, {
        old_name: update_name && cur_name,
        new_access_keys_to_link: update_access_key && data.access_keys,
        access_keys_to_delete: update_access_key && [{ access_key: cur_access_key }]
    });
    return { code: ManageCLIResponse.AccountUpdated, detail: data };
}

/**
 * delete_account deletes an account 
 * @param {Object} data 
 * @returns { Promise<{ code: typeof ManageCLIResponse.AccountDeleted, detail: Object, event_arg: Object }>} 
 */
async function delete_account(data) {
    await config_fs.delete_account_config_file(data);
    return { code: ManageCLIResponse.AccountDeleted, detail: { name: data.name }, event_arg: { account: data.name } };
}

/**
 * get_account_status returns the account data by the provided account name/access key
 * @param {Object} data 
 * @param {Boolean} [show_secrets]
 * @returns { Promise<{ code: typeof ManageCLIResponse.AccountStatus, detail: Object }>} 
 */
async function get_account_status(data, show_secrets) {
    const options = { show_secrets, decrypt_secret_key: show_secrets };

    try {
        const account_data = data.name === undefined ?
            await config_fs.get_account_by_access_key(data.access_keys[0].access_key, options) :
            await config_fs.get_account_by_name(data.name, options);
        return { code: ManageCLIResponse.AccountStatus, detail: account_data };
    } catch (err) {
        if (err.code !== 'ENOENT') throw err;
        if (data.name === undefined) {
            throw_cli_error(ManageCLIError.NoSuchAccountAccessKey, data.access_keys[0].access_key.unwrap());
        } else {
            throw_cli_error(ManageCLIError.NoSuchAccountName, data.name);
        }
    }
}

/**
 * filter_account will return true or false based on whether an account meets the criteria defined by the supported flags.
 * @param {object} account
 * @param {object} [filters]
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
 * list_account_config_files will list all the account config files (json) in a given config directory
 * @param {boolean} [wide]
 * @param {boolean} [show_secrets]
 * @param {object} [filters]
 */
async function list_account_config_files(wide, show_secrets, filters = {}) {
    let entry_names = [];
    const should_filter = Object.keys(filters).length > 0;
    const is_filter_by_name = filters.name !== undefined;

    // decryption causing mkm initialization
    // decrypt only if data has access_keys and show_secrets = true (no need to decrypt if show_secrets = false but should_filter = true)
    const options = {
        show_secrets: show_secrets || should_filter,
        decrypt_secret_key: show_secrets,
        // in case we have an error on secret_key decryption 
        // we will neither return the secret_key nor the encrypted_secret_key
        // and add the property of decryption_err with the error we had
        return_on_decryption_error: true,
        silent_if_missing: true
    };

    // in case we have a filter by name, we don't need to read all the entries and iterate them
    // instead we "mock" the entries array to have one entry and it is the name by the filter (we add it for performance)
    if (is_filter_by_name) {
        entry_names = [filters.name];
    } else {
        entry_names = await config_fs.list_accounts();
    }

    let config_files_list = await P.map_with_concurrency(10, entry_names, async entry_name => {
        if (wide || should_filter) {
            const data = await config_fs.get_account_by_name(entry_name, options);
            if (!data) return undefined;
            if (should_filter && !filter_account(data, filters)) return undefined;
            // remove secrets on !show_secrets && should filter
            if (!wide) return { name: entry_name };
            return _.omit(data, show_secrets ? [] : ['access_keys']);
        } else {
            return { name: entry_name };
        }
    });
    // it inserts undefined for the entry '.noobaa-config-nsfs' and we wish to remove it
    // in case the entry was deleted during the list it also inserts undefined
    config_files_list = config_files_list.filter(item => item);

    return config_files_list;
}

/**
 * account_management does the following - 
 * 1. sets variables by the user input options
 * 2. iniates nc_master_key_manager on UPDATE/ADD/show_secrets
 * 2. validates account args - TODO - we should split it to validate_account_args 
 * and validations of the merged account (user_input + existing account config)
 * 3. call account operation based on the action argument
 * 4. write output to stdout
 * @param {'add'|'update'|'delete'|'status'|'list'} action 
 * @param {Object} user_input 
 */
async function account_management(action, user_input) {
    const show_secrets = get_boolean_or_string_value(user_input.show_secrets);
    const is_flag_iam_operate_on_root_account = get_boolean_or_string_value(user_input.iam_operate_on_root_account);
    const account_filters = _.pick(user_input, LIST_ACCOUNT_FILTERS);
    const wide = get_boolean_or_string_value(user_input.wide);
    if (get_boolean_or_string_value(user_input.anonymous)) {
        user_input.name = config.ANONYMOUS_ACCOUNT_NAME;
        user_input.email = config.ANONYMOUS_ACCOUNT_NAME;
    }
    // init nc_mkm here to avoid concurrent initializations
    // init if actions is add/update (require encryption) or show_secrets = true (require decryption)
    if ([ACTIONS.ADD, ACTIONS.UPDATE].includes(action) || show_secrets) await nc_mkm.init();
    const data = action === ACTIONS.LIST ? undefined : await fetch_account_data(action, user_input);
    await manage_nsfs_validations.validate_account_args(config_fs, data, action, is_flag_iam_operate_on_root_account);

    let response = {};
    if (action === ACTIONS.ADD) {
        response = await add_account(data);
    } else if (action === ACTIONS.STATUS) {
        response = await get_account_status(data, show_secrets);
    } else if (action === ACTIONS.UPDATE) {
        response = await update_account(data);
    } else if (action === ACTIONS.DELETE) {
        response = await delete_account(data);
    } else if (action === ACTIONS.LIST) {
        const accounts = await list_account_config_files(wide, show_secrets, account_filters);
        response = { code: ManageCLIResponse.AccountList, detail: accounts };
    } else {
        throw_cli_error(ManageCLIError.InvalidAction);
    }
    write_stdout_response(response.code, response.detail, response.event_arg);

}

/**
 * get_access_keys will return the access_keys and new_access_key according to the user input
 * and action
 * @param {string} action
 * @param {object} user_input
 */
function get_access_keys(action, user_input) {
    let access_keys = [];
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

/**
 * set_bucker_owner gets bucket owner from cache by its id and sets bucket_owner name on the bucket data
 * @param {object} bucket_data 
 * @param {*} [account_data]
 */
async function set_bucker_owner(bucket_data, account_data) {
    try {
        if (!account_data) {
            account_data = await account_id_cache.get_with_cache({ _id: bucket_data.owner_account, config_fs });
        }
    } catch (err) {
        dbg.warn(`set_bucker_owner.couldn't find bucket owner data by id ${bucket_data.owner_account}`);
    }
    bucket_data.bucket_owner = account_data?.name;
}

////////////////////
//// IP WHITELIST //
////////////////////
/**
 * @returns {Promise<[boolean, object]>} - [config_exists, config_data] - config_exists is a boolean that indicates if the config.json exists
 * and config_data is the parsed data from the config.json file. returns empty object for config_data if config.json does not exist.
 */
async function _get_config_json_if_exist() {
    try {
        const config_json = await config_fs.get_config_json();
        return [true, config_json];
    } catch (err) {
        if (err.code !== 'ENOENT') throw err;
        return [false, {}];
    }
}

async function whitelist_ips_management(args) {
    const ips = args.ips;
    manage_nsfs_validations.validate_whitelist_arg(ips);

    const whitelist_ips = JSON.parse(ips);
    manage_nsfs_validations.validate_whitelist_ips(whitelist_ips);
    try {
        const [config_exists, config_data] = await _get_config_json_if_exist();
        config_data.S3_SERVER_IP_WHITELIST = whitelist_ips;
        const data = JSON.stringify(config_data);
        if (config_exists) {
            await config_fs.update_config_json_file(data);
        } else {
            await config_fs.create_config_json_file(data);
        }
    } catch (err) {
        dbg.error('manage_nsfs.whitelist_ips_management: Error while updation config.json, path:', config_fs.config_json_path, err);
        throw_cli_error(ManageCLIError.WhiteListIPUpdateFailed);
    }
    write_stdout_response(ManageCLIResponse.WhiteListIPUpdated, ips);
}

///////////////
//// GLACIER //
///////////////

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

//////////////////////
//// BUCKET LOGGING //
//////////////////////

async function logging_management() {
    await manage_nsfs_logging.export_bucket_logging(config_fs);
}

/////////////////////
//// NOTIFICATIONS //
////////////////////

async function notification_management() {
    await new notifications_util.Notificator({
        fs_context: config_fs.fs_context,
        connect_files_dir: config_fs.connections_dir_path,
        nc_config_fs: config_fs,
    }).process_notification_files();
}

async function connection_management(action, user_input) {
    manage_nsfs_validations.validate_connection_args(user_input, action);

    //don't reply the internal '_' field.
    delete user_input._;

    let response = {};
    let data;

    try {
        switch (action) {
            case ACTIONS.ADD:
                data = await notifications_util.add_connect_file(user_input, config_fs);
                response = { code: ManageCLIResponse.ConnectionCreated, detail: data };
                break;
            case ACTIONS.DELETE:
                await config_fs.delete_connection_config_file(user_input.name);
                response = { code: ManageCLIResponse.ConnectionDeleted, detail: {name: user_input.name} };
                break;
            case ACTIONS.UPDATE:
                await notifications_util.update_connect_file(user_input.name, user_input.key,
                    user_input.value, user_input.remove_key, config_fs);
                response = { code: ManageCLIResponse.ConnectionUpdated, detail: {name: user_input.name} };
                break;
            case ACTIONS.STATUS:
                data = await new notifications_util.Notificator({
                    fs_context: config_fs.fs_context,
                    connect_files_dir: config_fs.connections_dir_path,
                    nc_config_fs: config_fs,
                }).parse_connect_file(user_input.name, user_input.decrypt);
                response = { code: ManageCLIResponse.ConnectionStatus, detail: data };
                break;
            case ACTIONS.LIST:
                data = await list_connections();
                response = { code: ManageCLIResponse.ConnectionList, detail: data };
                break;
            default:
                throw_cli_error(ManageCLIError.InvalidAction);
        }

        write_stdout_response(response.code, response.detail, response.event_arg);
    } catch (err) {
        if (err.code === 'EEXIST') throw_cli_error(ManageCLIError.ConnectionAlreadyExists, user_input.name);
        if (err.code === 'ENOENT') throw_cli_error(ManageCLIError.NoSuchConnection, user_input.name);
        throw err;
    }
}

/**
 * list_connections
 * @returns An array with names of all connection files.
 */
async function list_connections() {
    let conns = await config_fs.list_connections();
    // it inserts undefined for the entry '.noobaa-config-nsfs' and we wish to remove it
    // in case the entry was deleted during the list it also inserts undefined
    conns = conns.filter(item => item);

    return conns;
}

////////////////////
///// LIFECYCLE ////
////////////////////

/**
 * lifecycle_management runs the nc lifecycle management
 * @returns {Promise<void>}
 */
async function lifecycle_management(args) {
    const disable_service_validation = get_boolean_or_string_value(args.disable_service_validation);
    const disable_runtime_validation = get_boolean_or_string_value(args.disable_runtime_validation);
    const short_status = get_boolean_or_string_value(args.short_status);
    const should_continue_last_run = get_boolean_or_string_value(args.continue);
    try {
        const options = { disable_service_validation, disable_runtime_validation, short_status, should_continue_last_run };
        const nc_lifecycle = new NCLifecycle(config_fs, options);
        const { should_run, lifecycle_run_status } = await nc_lifecycle.run_lifecycle_under_lock();
        if (should_run) {
            write_stdout_response(ManageCLIResponse.LifecycleSuccessful, lifecycle_run_status);
        } else {
            write_stdout_response(ManageCLIResponse.LifecycleWorkerNotRunning);
        }
    } catch (err) {
        dbg.error('manage_nsfs.lifecycle_management: Error while running run_lifecycle_under_lock', config_fs.config_json_path, err);
        throw_cli_error(err);
    }
}

exports.main = main;
if (require.main === module) main();
