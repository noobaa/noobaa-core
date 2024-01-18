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
const SensitiveString = require('../util/sensitive_string');
const ManageCLIError = require('../manage_nsfs/manage_nsfs_cli_errors').ManageCLIError;
const ManageCLIResponse = require('../manage_nsfs/manage_nsfs_cli_responses').ManageCLIResponse;
const bucket_policy_utils = require('../endpoint/s3/s3_bucket_policy_utils');
const nsfs_schema_utils = require('../manage_nsfs/nsfs_schema_utils');

const TYPES = {
    ACCOUNT: 'account',
    BUCKET: 'bucket',
    IPWHITELIST: 'whitelist'
};

const ACTIONS = {
    ADD: 'add',
    UPDATE: 'update',
    DELETE: 'delete',
    LIST: 'list',
    STATUS: 'status'
};

function throw_cli_error(error_code, detail) {
    const err = new ManageCLIError(error_code).to_string(detail);
    process.stdout.write(err + '\n');
    process.exit(1);
}

function write_stdout_response(response_code, detail) {
    const res = new ManageCLIResponse(response_code).to_string(detail);
    process.stdout.write(res + '\n');
    process.exit(0);
}

const buckets_dir_name = '/buckets';
const accounts_dir_name = '/accounts';
const access_keys_dir_name = '/access_keys';

let config_root;
let accounts_dir_path;
let access_keys_dir_path;
let buckets_dir_path;
let config_root_backend;

const HELP = `
Help:

    "nsfs" is a noobaa-core command runs a local S3 endpoint on top of a filesystem.
    Each sub directory of the root filesystem represents an S3 bucket.
    manage nsfs will provide a command line interface to create new accounts and map existing directories 
    to Noobaa as buckets. For more information refer to the noobaa docs.
`;

const USAGE = `
Usage:

    node src/cmd/manage_nsfs <type> <action> [options...]
`;

const ARGUMENTS = `
Arguments:

    <type>    Set the resource type such as accounts and buckets
    <action>  Action could be add, update, list, status and delete for accounts/buckets.
`;

const WHITELIST_OPTIONS = `
Whitelist Options:

    # Read Whitelist IPs and update the configurations.
    --ips <ips>                       (default none)          Set whitelist ips in array format : '["127.0.0.1", "192.000.10.000", "3002:0bd6:0000:0000:0000:ee00:0033:6778"]'
`;

const ACCOUNT_OPTIONS = `
Account Options:

    # Read account details from the JSON file, there is no need to mention all the properties one by one in the CLI
    --from_file <dir>                                         (default none)                                  Set account schema full path. Get account details from JSON file                
    --config_root_backend <none | GPFS | CEPH_FS | NFV_V4>    (default config.NSFS_NC_CONFIG_DIR_BACKEND)     Set the config_root FS type to be GPFS

    # required for add, update 
    --name <name>                                   (default none)                              Set the name for the account.
    --email <email>                                 (default none)                              Set the email for the account.
    --new_name <name>                               (default none)                              Set a new name for the account (update).
    --uid <uid>                                     (default none)                              Send requests to the Filesystem with uid.
    --gid <gid>                                     (default none)                              Send requests to the Filesystem with gid.
    --secret_key <key>                              (default none)                              The secret key pair for the access key.
    --new_buckets_path <dir>                        (default none)                              Set the filesystem's root where each subdir is a bucket.
    --fs_backend <none | GPFS | CEPH_FS | NFV_V4>   (default config.NSFS_NC_STORAGE_BACKEND)    Set fs_backend of new_buckets_path to be GPFS

    # required for add, update, and delete
    --access_key <key>          (default none)                              Authenticate incoming requests for this access key only (default is no auth).
    --regenerate                (default none)                              When set and new_access_key is not set, will regenerate the access_key and secret_key
    --config_root <dir>         (default config.NSFS_NC_DEFAULT_CONF_DIR)   Configuration files path for Noobaa standalon NSFS.

    # Used for list
    --wide                      (default none)                              Will print the list with details (same as status but for all accounts)
    --show_secrets              (default false)                             Will print the access_keys of the account
    --uid <uid>                 (default none)                              filter the list by uid.
    --gid <gid>                 (default none)                              filter the list by gid.
`;

const BUCKET_OPTIONS = `
Bucket Options:

    # Read Bucket details from JSON file, no need to mention all the properties one by one in CLI
    --from_file <dir>                                         (default none)                                  Set bucket schema full path. Get bucket details from the JSON file
    --config_root_backend <none | GPFS | CEPH_FS | NFV_V4>    (default config.NSFS_NC_CONFIG_DIR_BACKEND)     Set the config_root FS type to be GPFS

    # required for add, update 
    --email <email>                                 (default none)                             Set the email for the bucket.
    --path <dir>                                    (default none)                             Set the bucket path.
    --fs_backend <none | GPFS | CEPH_FS | NFV_V4>   (default config.NSFS_NC_STORAGE_BACKEND)   Set fs_backend to be GPFS

    # required for add, update, and delete
    --name <name>               (default none)                              Set the name for the bucket.
    --bucket_policy<string>     (default none)                              Set a bucket policy for the bucket, type is a string of valid JSON policy
    --new_name <name>           (default none)                              Set a new name for the bucket.
    --config_root <dir>         (default config.NSFS_NC_DEFAULT_CONF_DIR)   Configuration files path for Noobaa standalon NSFS.
    --wide                      (default none)                              Will print the list with details (same as status but for all buckets)
    `;

function print_usage(options) {
    process.stdout.write(HELP);
    process.stdout.write(USAGE.trimStart());
    process.stdout.write(ARGUMENTS.trimStart());
    if (!options || options.print_account) process.stdout.write(ACCOUNT_OPTIONS.trimStart());
    if (!options || options.print_bucket) process.stdout.write(BUCKET_OPTIONS.trimStart());
    if (!options || options.print_white_list) process.stdout.write(WHITELIST_OPTIONS.trimStart());
    process.exit(1);
}


async function check_and_create_config_dirs() {
    const pre_req_dirs = [
        config_root,
        buckets_dir_path,
        accounts_dir_path,
        access_keys_dir_path
    ];
    for (const dir_path of pre_req_dirs) {
        try {
            const fs_context = native_fs_utils.get_process_fs_context();
            const dir_exists = await native_fs_utils.config_file_exists(fs_context, dir_path);
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
        if (argv.help || argv.h) {
            return print_usage({
                print_bucket: type === TYPES.BUCKET,
                print_account: type === TYPES.ACCOUNT,
                print_white_list: type === TYPES.IPWHITELIST
            });
        }
        config_root = argv.config_root ? String(argv.config_root) : config.NSFS_NC_CONF_DIR;
        if (!config_root) throw_cli_error(ManageCLIError.MissingConfigDirPath);

        accounts_dir_path = path.join(config_root, accounts_dir_name);
        access_keys_dir_path = path.join(config_root, access_keys_dir_name);
        buckets_dir_path = path.join(config_root, buckets_dir_name);
        config_root_backend = argv.config_root_backend ? String(argv.config_root_backend) : config.NSFS_NC_CONFIG_DIR_BACKEND;

        await check_and_create_config_dirs();
        const from_file = argv.from_file ? String(argv.from_file) : '';
        if (type === TYPES.ACCOUNT) {
            await account_management(argv, from_file);
        } else if (type === TYPES.BUCKET) {
            await bucket_management(argv, from_file);
        } else if (type === TYPES.IPWHITELIST) {
            await whitelist_ips_management(argv);
        } else {
            throw_cli_error(ManageCLIError.InvalidConfigType);
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

async function bucket_management(argv, from_file) {
    const action = argv._[1] || '';
    const data = await fetch_bucket_data(argv, from_file);
    await manage_bucket_operations(action, data);
}

async function fetch_bucket_data(argv, from_file) {
    const action = argv._[1] || '';
    let data;
    if (from_file) {
        const fs_context = native_fs_utils.get_process_fs_context();
        const raw_data = (await nb_native().fs.readFile(fs_context, from_file)).data;
        data = JSON.parse(raw_data.toString());
    }
    if (!data) {
        data = {
            name: argv.name,
            system_owner: argv.email,
            bucket_owner: argv.email,
            wide: argv.wide,
            creation_date: action === ACTIONS.ADD ? new Date().toISOString() : undefined,
            tag: undefined, // if we would add the option to tag a bucket using CLI, this should be changed
            versioning: action === ACTIONS.ADD ? 'DISABLED' : undefined,
            path: argv.path,
            should_create_underlying_storage: action === ACTIONS.ADD ? false : undefined,
            new_name: argv.new_name,
            fs_backend: argv.fs_backend ? String(argv.fs_backend) : config.NSFS_NC_STORAGE_BACKEND
        };
    }

    if (argv.bucket_policy !== undefined) {
        // bucket_policy deletion speficied with empty string ''
        if (argv.bucket_policy === '') {
            data.s3_policy = '';
        } else {
            data.s3_policy = JSON.parse(argv.bucket_policy.toString());
        }
    }
    if (action === ACTIONS.UPDATE) {
        data = _.omitBy(data, _.isUndefined);
        data = await fetch_existing_bucket_data(data);
    }

    data = {
        ...data,
        name: new SensitiveString(String(data.name)),
        system_owner: new SensitiveString(String(data.system_owner)),
        bucket_owner: new SensitiveString(String(data.bucket_owner)),
        // update bucket identifier
        new_name: data.new_name && new SensitiveString(String(data.new_name)),
        // fs_backend deletion specified with empty string '' (but it is not part of the schema)
        fs_backend: data.fs_backend || undefined,
        // s3_policy deletion specified with empty string '' (but it is not part of the schema)
        s3_policy: data.s3_policy || undefined,
    };

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
    const exists = await native_fs_utils.config_file_exists(fs_context, bucket_conf_path);
    if (exists) throw_cli_error(ManageCLIError.BucketAlreadyExists, data.name.unwrap());

    const data_json = JSON.stringify(data);
    // We take an object that was stringify
    // (it unwraps ths sensitive strings, creation_date to string and removes undefined parameters)
    // for validating against the schema we need an object, hence we parse it back to object
    nsfs_schema_utils.validate_bucket_schema(JSON.parse(data_json));
    await native_fs_utils.create_config_file(fs_context, buckets_dir_path, bucket_conf_path, data_json);
    write_stdout_response(ManageCLIResponse.BucketCreated, data_json);
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
    const update_name = data.new_name && cur_name && data.new_name.unwrap() !== cur_name.unwrap();

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

    data.name = data.new_name;

    const cur_bucket_config_path = get_config_file_path(buckets_dir_path, cur_name.unwrap());
    const new_bucket_config_path = get_config_file_path(buckets_dir_path, data.name.unwrap());

    const exists = await native_fs_utils.config_file_exists(fs_context, new_bucket_config_path);
    if (exists) throw_cli_error(ManageCLIError.BucketAlreadyExists, data.name.unwrap());

    data = JSON.stringify(_.omit(data, ['new_name']));
    // We take an object that was stringify
    // (it unwraps ths sensitive strings, creation_date to string and removes undefined parameters)
    // for validating against the schema we need an object, hence we parse it back to object
    nsfs_schema_utils.validate_bucket_schema(JSON.parse(data));
    await native_fs_utils.create_config_file(fs_context, buckets_dir_path, new_bucket_config_path, data);
    await native_fs_utils.delete_config_file(fs_context, buckets_dir_path, cur_bucket_config_path);
    write_stdout_response(ManageCLIResponse.BucketUpdated, data);
}


async function delete_bucket(data) {
    await validate_bucket_args(data, ACTIONS.DELETE);

    const fs_context = native_fs_utils.get_process_fs_context(config_root_backend);
    const bucket_config_path = get_config_file_path(buckets_dir_path, data.name);
    try {
        await native_fs_utils.delete_config_file(fs_context, buckets_dir_path, bucket_config_path);
    } catch (err) {
        if (err.code === 'ENOENT') throw_cli_error(ManageCLIError.NoSuchBucket, data.name);
    }
    write_stdout_response(ManageCLIResponse.BucketDeleted);
}

async function manage_bucket_operations(action, data) {
    if (action === ACTIONS.ADD) {
        await add_bucket(data);
    } else if (action === ACTIONS.STATUS) {
        await get_bucket_status(data);
    } else if (action === ACTIONS.UPDATE) {
        await update_bucket(data);
    } else if (action === ACTIONS.DELETE) {
        await delete_bucket(data);
    } else if (action === ACTIONS.LIST) {
        let buckets = await list_config_files(buckets_dir_path);
        if (!data.wide) buckets = buckets.map(item => ({ name: item.name }));
        write_stdout_response(ManageCLIResponse.BucketList, buckets);
    } else {
        throw_cli_error(ManageCLIError.InvalidAction, undefined);
    }
}

async function account_management(argv, from_file) {
    const action = argv._[1] || '';
    const show_secrets = Boolean(argv.show_secrets) || false;
    const data = await fetch_account_data(argv, from_file);
    await manage_account_operations(action, data, show_secrets, argv);
}

/**
 * set_access_keys will set the access keys either given as args or generated.
 * @param {{ access_key: any; secret_key: any; }} argv
 * @param {boolean} generate a flag for generating the access_keys automatically
 */
function set_access_keys(argv, generate) {
    const { access_key, secret_key } = argv;
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

async function fetch_account_data(argv, from_file) {
    let data;
    let access_keys = [{
        access_key: undefined,
        secret_key: undefined,
    }];
    let new_access_key;
    const action = argv._[1] || '';
    if (from_file) {
        const fs_context = native_fs_utils.get_process_fs_context();
        const raw_data = (await nb_native().fs.readFile(fs_context, from_file)).data;
        data = JSON.parse(raw_data.toString());
    }
    if (action !== ACTIONS.LIST && action !== ACTIONS.STATUS) _validate_access_keys(argv);
    if (action === ACTIONS.ADD || action === ACTIONS.STATUS) {
        const regenerate = action === ACTIONS.ADD;
        access_keys = set_access_keys(argv, regenerate);
    } else if (action === ACTIONS.UPDATE) {
        access_keys = set_access_keys(argv, Boolean(argv.regenerate));
        new_access_key = access_keys[0].access_key;
        access_keys[0].access_key = undefined; //Setting it as undefined so we can replace the symlink
    }

    if (!data) {
        data = _.omitBy({
            name: argv.name,
            email: argv.email,
            creation_date: action === ACTIONS.ADD ? new Date().toISOString() : undefined,
            wide: argv.wide,
            new_name: argv.new_name,
            new_access_key,
            access_keys,
            nsfs_account_config: {
                distinguished_name: argv.user,
                uid: argv.user ? undefined : argv.uid,
                gid: argv.user ? undefined : argv.gid,
                new_buckets_path: argv.new_buckets_path,
                fs_backend: argv.fs_backend ? String(argv.fs_backend) : config.NSFS_NC_STORAGE_BACKEND
            }
        }, _.isUndefined);
    }
    if (action === ACTIONS.UPDATE || action === ACTIONS.DELETE) {
        data = _.omitBy(data, _.isUndefined);
        data = await fetch_existing_account_data(data);
    }

    data = {
        ...data,
        name: new SensitiveString(String(data.name)),
        email: new SensitiveString(String(data.email)),
        access_keys: [{
            access_key: new SensitiveString(String(data.access_keys[0].access_key)),
            secret_key: new SensitiveString(String(data.access_keys[0].secret_key)),
        }],
        nsfs_account_config: data.nsfs_account_config && {
            distinguished_name: data.nsfs_account_config.distinguished_name &&
                new SensitiveString(String(data.nsfs_account_config.distinguished_name)),
            uid: data.nsfs_account_config.uid && Number(data.nsfs_account_config.uid),
            gid: data.nsfs_account_config.gid && Number(data.nsfs_account_config.gid),
            new_buckets_path: data.nsfs_account_config.new_buckets_path,
            // fs_backend deletion specified with empty string '' (but it is not part of the schema)
            fs_backend: data.nsfs_account_config.fs_backend || undefined
        },
        allow_bucket_creation: !is_undefined(data.nsfs_account_config.new_buckets_path),
        // updates of account identifiers
        new_name: data.new_name && new SensitiveString(String(data.new_name)),
        new_access_key: data.new_access_key && new SensitiveString(String(data.new_access_key))
    };
    return data;
}

async function fetch_existing_account_data(target) {
    let source;
    try {
        const account_path = target.name ?
            get_config_file_path(accounts_dir_path, target.name) :
            get_symlink_config_file_path(access_keys_dir_path, target.access_keys[0].access_key);
        source = await get_config_data(account_path, true);
    } catch (err) {
        dbg.log1('NSFS Manage command: Could not find account', target, err);
        if (err.code === 'ENOENT') {
            if (is_undefined(target.name)) {
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
    const account_config_access_key_path = get_symlink_config_file_path(access_keys_dir_path, access_key);

    const name_exists = await native_fs_utils.config_file_exists(fs_context, account_config_path);
    const access_key_exists = await native_fs_utils.config_file_exists(fs_context, account_config_access_key_path, true);

    if (name_exists || access_key_exists) {
        const err_code = name_exists ? ManageCLIError.AccountNameAlreadyExists : ManageCLIError.AccountAccessKeyAlreadyExists;
        throw_cli_error(err_code);
    }

    data = JSON.stringify(data);
    // We take an object that was stringify
    // (it unwraps ths sensitive strings, creation_date to string and removes undefined parameters)
    // for validating against the schema we need an object, hence we parse it back to object
    nsfs_schema_utils.validate_account_schema(JSON.parse(data));
    await native_fs_utils.create_config_file(fs_context, accounts_dir_path, account_config_path, data);
    await native_fs_utils._create_path(access_keys_dir_path, fs_context, config.BASE_MODE_CONFIG_DIR);
    await nb_native().fs.symlink(fs_context, account_config_path, account_config_access_key_path);

    write_stdout_response(ManageCLIResponse.AccountCreated, data);
}

async function update_account(data) {
    await validate_account_args(data, ACTIONS.UPDATE);

    const fs_context = native_fs_utils.get_process_fs_context(config_root_backend);
    const cur_name = data.name;
    const cur_access_key = data.access_keys[0].access_key;
    const update_name = data.new_name && cur_name && data.new_name.unwrap() !== cur_name.unwrap();
    const update_access_key = data.new_access_key && cur_access_key && data.new_access_key.unwrap() !== cur_access_key.unwrap();

    if (!update_name && !update_access_key) {
        const account_config_path = get_config_file_path(accounts_dir_path, data.name);
        data = JSON.stringify(data);
        // We take an object that was stringify
        // (it unwraps ths sensitive strings, creation_date to string and removes undefined parameters)
        // for validating against the schema we need an object, hence we parse it back to object
        nsfs_schema_utils.validate_account_schema(JSON.parse(data));
        await native_fs_utils.update_config_file(fs_context, accounts_dir_path, account_config_path, data);
        write_stdout_response(ManageCLIResponse.AccountUpdated, data);
        return;
    }
    const data_name = data.new_name || cur_name;
    data.name = data_name;
    data.access_keys[0].access_key = data.new_access_key || cur_access_key;
    const cur_account_config_path = get_config_file_path(accounts_dir_path, cur_name.unwrap());
    const new_account_config_path = get_config_file_path(accounts_dir_path, data.name.unwrap());
    const cur_access_key_config_path = get_symlink_config_file_path(access_keys_dir_path, cur_access_key.unwrap());
    const new_access_key_config_path = get_symlink_config_file_path(access_keys_dir_path, data.access_keys[0].access_key.unwrap());
    const name_exists = update_name && await native_fs_utils.config_file_exists(fs_context, new_account_config_path);
    const access_key_exists = update_access_key && await native_fs_utils.config_file_exists(fs_context, new_access_key_config_path, true);
    if (name_exists || access_key_exists) {
        const err_code = name_exists ? ManageCLIError.AccountNameAlreadyExists : ManageCLIError.AccountAccessKeyAlreadyExists;
        throw_cli_error(err_code);
    }
    data = JSON.stringify(_.omit(data, ['new_name', 'new_access_key']));
    // We take an object that was stringify
    // (it unwraps ths sensitive strings, creation_date to string and removes undefined parameters)
    // for validating against the schema we need an object, hence we parse it back to object
    nsfs_schema_utils.validate_account_schema(JSON.parse(data));
    if (update_name) {
        await native_fs_utils.create_config_file(fs_context, accounts_dir_path, new_account_config_path, data);
        await native_fs_utils.delete_config_file(fs_context, accounts_dir_path, cur_account_config_path);
    } else if (update_access_key) {
        await native_fs_utils.update_config_file(fs_context, accounts_dir_path, cur_account_config_path, data);
    }
    // TODO: safe_unlink can be better but the current impl causing ELOOP - Too many levels of symbolic links
    // need to find a better way for atomic unlinking of symbolic links
    // handle atomicity for symlinks
    await nb_native().fs.unlink(fs_context, cur_access_key_config_path);
    await nb_native().fs.symlink(fs_context, new_account_config_path, new_access_key_config_path);
    write_stdout_response(ManageCLIResponse.AccountUpdated, data);
}

async function delete_account(data) {
    await validate_account_args(data, ACTIONS.DELETE);
    await verify_delete_account(data.name.unwrap(), data.email.unwrap());

    const fs_context = native_fs_utils.get_process_fs_context(config_root_backend);
    const account_config_path = get_config_file_path(accounts_dir_path, data.name);
    const access_key_config_path = get_symlink_config_file_path(access_keys_dir_path, data.access_keys[0].access_key.unwrap());

    await native_fs_utils.delete_config_file(fs_context, accounts_dir_path, account_config_path);
    await nb_native().fs.unlink(fs_context, access_key_config_path);

    write_stdout_response(ManageCLIResponse.AccountDeleted);
}

/**
 * verify_delete_account will check if the account has at least one bucket
 * in case it finds one, it would throw an error
 * @param {string} account_name
 * @param {string} account_email
 */
async function verify_delete_account(account_name, account_email) {
    const show_secrets = false; // in buckets we don't save secrets in coofig file
    const fs_context = native_fs_utils.get_process_fs_context();
    const entries = await nb_native().fs.readdir(fs_context, buckets_dir_path);
    await P.map_with_concurrency(10, entries, async entry => {
        if (entry.name.endsWith('.json')) {
            const full_path = path.join(buckets_dir_path, entry.name);
            const data = await get_config_data(full_path, show_secrets);
            if (data.bucket_owner === account_email) {
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
        const account_path = is_undefined(data.name) ?
            get_symlink_config_file_path(access_keys_dir_path, data.access_keys[0].access_key) :
            get_config_file_path(accounts_dir_path, data.name);
        const config_data = await get_config_data(account_path, show_secrets);
        write_stdout_response(ManageCLIResponse.AccountStatus, config_data);
    } catch (err) {
        if (is_undefined(data.name)) {
            throw_cli_error(ManageCLIError.NoSuchAccountAccessKey, data.access_keys[0].access_key.unwrap());
        } else {
            throw_cli_error(ManageCLIError.NoSuchAccountName, data.name.unwrap());
        }
    }
}

async function manage_account_operations(action, data, show_secrets, argv) {
    if (action === ACTIONS.ADD) {
        await add_account(data);
    } else if (action === ACTIONS.STATUS) {
        await get_account_status(data, show_secrets);
    } else if (action === ACTIONS.UPDATE) {
        await update_account(data);
    } else if (action === ACTIONS.DELETE) {
        await delete_account(data);
    } else if (action === ACTIONS.LIST) {
        let accounts = await list_config_files(accounts_dir_path, show_secrets);
        accounts = filter_account_results(accounts, argv);
        if (!data.wide) accounts = accounts.map(item => ({ name: item.name }));
        write_stdout_response(ManageCLIResponse.AccountList, accounts);
    } else {
        throw_cli_error(ManageCLIError.InvalidAction);
    }
}

/**
 * filter_account_results will filter the results based on supported given flags
 * @param {any[]} accounts
 * @param {{}} argv
 */
function filter_account_results(accounts, argv) {
    //supported filters for list
    const filters = _.pick(argv, ['uid', 'gid']); //if we add filters we should remove this comment and the comment 4 lines below (else)
    return accounts.filter(item => {
        for (const [key, val] of Object.entries(filters)) {
            if (key === 'uid' || key === 'gid') {
                if (item.nsfs_account_config && item.nsfs_account_config[key] !== val) {
                    return false;
                }
            } else if (item[key] !== val) { // We will never reach here if we will not add an appropriate field to the filter 
                return false;
            }
        }
        return true;
    });
}

/**
 * list_config_files will list all the config files (json) in a given config directory
 * @param {string} config_path
 */
async function list_config_files(config_path, show_secrets) {
    const fs_context = native_fs_utils.get_process_fs_context();
    const entries = await nb_native().fs.readdir(fs_context, config_path);

    let config_files_list = await P.map_with_concurrency(10, entries, async entry => {
        if (entry.name.endsWith('.json')) {
            const full_path = path.join(config_path, entry.name);
            const data = await get_config_data(full_path, show_secrets);
            return data;
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
async function get_config_data(config_file_path, show_secrets) {
    const fs_context = native_fs_utils.get_process_fs_context();
    const { data } = await nb_native().fs.readFile(fs_context, config_file_path);
    const config_data = _.omit(JSON.parse(data.toString()), show_secrets ? [] : ['access_keys']);
    return config_data;
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
        if (is_undefined(data.name)) throw_cli_error(ManageCLIError.MissingBucketNameFlag);
    } else {
        if (is_undefined(data.name)) throw_cli_error(ManageCLIError.MissingBucketNameFlag);
        try {
            native_fs_utils.validate_bucket_creation({ name: data.name.unwrap() });
        } catch (err) {
            throw_cli_error(ManageCLIError.InvalidBucketName, data.name.unwrap());
        }
        if (!is_undefined(data.new_name)) {
            if (action !== ACTIONS.UPDATE) throw_cli_error(ManageCLIError.InvalidNewNameBucketIdentifier);
            try {
                native_fs_utils.validate_bucket_creation({ name: data.new_name.unwrap() });
            } catch (err) {
                throw_cli_error(ManageCLIError.InvalidBucketName, data.new_name.unwrap());
            }
        }
        if (is_undefined(data.system_owner)) throw_cli_error(ManageCLIError.MissingBucketEmailFlag);
        if (!data.path) throw_cli_error(ManageCLIError.MissingBucketPathFlag);
        const fs_context = native_fs_utils.get_process_fs_context();
        const exists = await native_fs_utils.config_file_exists(fs_context, data.path);
        if (!exists) {
            throw_cli_error(ManageCLIError.InvalidStoragePath, data.path);
        }
        // fs_backend='' used for deletion of the fs_backend property
        if (data.fs_backend !== undefined && !['GPFS', 'CEPH_FS', 'NFSv4'].includes(data.fs_backend)) {
            throw_cli_error(ManageCLIError.InvalidFSBackend);
        }
        if (data.s3_policy) {
            try {
                await bucket_policy_utils.validate_s3_policy(data.s3_policy, data.name.unwrap(),
                    async principal => {
                        const account_config_path = get_config_file_path(accounts_dir_path, principal);
                        try {
                            await nb_native().fs.stat(native_fs_utils.get_process_fs_context(), account_config_path);
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
        if (is_undefined(data.access_keys[0].access_key) && is_undefined(data.name)) {
            throw_cli_error(ManageCLIError.MissingIdentifier);
        }
    } else {
        if ((action !== ACTIONS.UPDATE && data.new_name)) throw_cli_error(ManageCLIError.InvalidNewNameAccountIdentifier);
        if ((action !== ACTIONS.UPDATE && data.new_access_key)) throw_cli_error(ManageCLIError.InvalidNewAccessKeyIdentifier);
        if (is_undefined(data.name)) throw_cli_error(ManageCLIError.MissingAccountNameFlag);
        if (is_undefined(data.email)) throw_cli_error(ManageCLIError.MissingAccountEmailFlag);

        if (is_undefined(data.access_keys[0].secret_key)) throw_cli_error(ManageCLIError.MissingAccountSecretKeyFlag);
        if (is_undefined(data.access_keys[0].access_key)) throw_cli_error(ManageCLIError.MissingAccountAccessKeyFlag);
        if ((is_undefined(data.nsfs_account_config.distinguished_name) &&
                (data.nsfs_account_config.uid === undefined || data.nsfs_account_config.gid === undefined))) {
            throw_cli_error(ManageCLIError.InvalidAccountNSFSConfig, data.nsfs_account_config);
        }
        // fs_backend='' used for deletion of the fs_backend property
        if (data.nsfs_account_config.fs_backend !== undefined && !['GPFS', 'CEPH_FS', 'NFSv4'].includes(data.nsfs_account_config.fs_backend)) {
            throw_cli_error(ManageCLIError.InvalidFSBackend);
        }

        if (data.nsfs_account_config.uid && typeof data.nsfs_account_config.uid !== 'number') throw_cli_error(ManageCLIError.InvalidAccountUID);
        if (data.nsfs_account_config.gid && typeof data.nsfs_account_config.gid !== 'number') throw_cli_error(ManageCLIError.InvalidAccountGID);

        if (is_undefined(data.nsfs_account_config.new_buckets_path)) {
            return;
        }
        const fs_context = native_fs_utils.get_process_fs_context();
        const exists = await native_fs_utils.config_file_exists(fs_context, data.nsfs_account_config.new_buckets_path);
        if (!exists) {
            throw_cli_error(ManageCLIError.InvalidAccountNewBucketsPath, data.nsfs_account_config.new_buckets_path);
        }
    }
}


///////////////////////////////
///         UTILS           ///
///////////////////////////////

function is_undefined(value) {
    if (!value) return true;
    if ((value instanceof SensitiveString) && value.unwrap() === 'undefined') return true;
    return false;
}

async function whitelist_ips_management(args) {
    const ips = args.ips;
    validate_whitelist_arg(ips);

    const whitelist_ips = JSON.parse(ips);
    verify_whitelist_ips(whitelist_ips);
    const config_path = path.join(config_root, 'config.json');
    try {
        const config_data = require(config_path);
        config_data.NSFS_WHITELIST = whitelist_ips;
        const fs_context = native_fs_utils.get_process_fs_context();
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

function _validate_access_keys(argv) {
    // using the access_key flag requires also using the secret_key flag
    if (!is_undefined(argv.access_key) && is_undefined(argv.secret_key)) throw_cli_error(ManageCLIError.MissingAccountSecretKeyFlag);
    if (!is_undefined(argv.secret_key) && is_undefined(argv.access_key)) throw_cli_error(ManageCLIError.MissingAccountAccessKeyFlag);
    // checking the complexity of access_key
    if (!is_undefined(argv.access_key) && !string_utils.validate_complexity(argv.access_key, {
            require_length: 20,
            check_uppercase: true,
            check_lowercase: false,
            check_numbers: true,
            check_symbols: false,
        })) throw_cli_error(ManageCLIError.AccountAccessKeyFlagComplexity);
    // checking the complexity of secret_key
    if (!is_undefined(argv.secret_key) && !string_utils.validate_complexity(argv.secret_key, {
            require_length: 40,
            check_uppercase: true,
            check_lowercase: true,
            check_numbers: true,
            check_symbols: true,
        })) throw_cli_error(ManageCLIError.AccountSecretKeyFlagComplexity);

}

exports.main = main;
if (require.main === module) main();
