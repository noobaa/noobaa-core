/* Copyright (C) 2020 NooBaa */
'use strict';

const fs_utils = require('../util/fs_utils');
const SensitiveString = require('../util/sensitive_string');
const minimist = require('minimist');
const path = require('path');
const fs = require('fs');
const P = require('../util/promise');
const _ = require('lodash');
const config = require('../../config');
const cloud_utils = require('../util/cloud_utils');
const native_fs_utils = require('../util/native_fs_utils');
const nb_native = require('../util/nb_native');

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

const ACCOUNT_OPTIONS = `
Account Options:

    # Read account details from the JSON file, there is no need to mention all the properties one by one in the CLI
    --from_file <dir>                       (default none)                  Set account schema full path.
                                                                            Get account details from JSON file                
    --config_root_backend <none | GPFS >    (default none)                  Set the config_root FS type to be GPFS

    # required for add, update 
    --name <name>               (default none)                              Set the name for the account.
    --email <email>             (default none)                              Set the email for the account.
    --new_name <name>           (default none)                              Set a new name for the account (update).
    --uid <uid>                 (default none)                              Send requests to the Filesystem with uid.
    --gid <gid>                 (default none)                              Send requests to the Filesystem with gid.
    --secret_key <key>          (default none)                              The secret key pair for the access key.
    --new_buckets_path <dir>    (default none)                              Set the filesystem's root where each subdir is a bucket.
    
    # required for add, update, and delete
    --access_key <key>          (default none)                              Authenticate incoming requests for this access key only (default is no auth).
    --new_access_key <key>      (default none)                              Set a new access key for the account.
    --regenerate                (default none)                              When set and new_access_key is not set, will regenerate the access_key
    --config_root <dir>         (default config.NSFS_NC_DEFAULT_CONF_DIR)   Configuration files path for Noobaa standalon NSFS.

    # Used for list
    --wide                      (default none)                              Will print the list with details (same as status but for all accounts)
`;

const BUCKET_OPTIONS = `
Bucket Options:

    # Read Bucket details from JSON file, no need to mention all the properties one by one in CLI
    --from_file <dir>                       (default none)                  Set bucket schema full path.
                                                                            Get bucket details from the JSON file
    --config_root_backend <none | GPFS >    (default none)                  Set the config_root FS type to be GPFS

    # required for add, update 
    --email <email>             (default none)                              Set the email for the bucket.
    --path <dir>                (default none)                              Set the bucket path.

    # required for add, update, and delete
    --name <name>               (default none)                              Set the name for the bucket.
    --new_name <name>           (default none)                              Set a new name for the bucket.
    --config_root <dir>         (default config.NSFS_NC_DEFAULT_CONF_DIR)   Configuration files path for Noobaa standalon NSFS.
`;


function usage({ print_account = false, print_bucket = false }) {
    console.warn(HELP);
    console.warn(USAGE.trimStart());
    console.warn(ARGUMENTS.trimStart());
    if (print_account) console.warn(ACCOUNT_OPTIONS.trimStart());
    if (print_bucket) console.warn(BUCKET_OPTIONS.trimStart());
    process.exit(1);
}

const buckets_dir_name = '/buckets';
const accounts_dir_name = '/accounts';
const access_keys_dir_name = '/access_keys';

async function check_and_create_config_dirs(config_root) {
    const pre_req_paths = [
        config_root,
        path.join(config_root, buckets_dir_name),
        path.join(config_root, accounts_dir_name),
        path.join(config_root, access_keys_dir_name)
    ];
    for (const p of pre_req_paths) {
        try {
            const dir_exists = await fs_utils.file_exists(p);
            if (dir_exists) {
                console.log('NSFS config root dir exists:', p);
            } else {
                await fs_utils.create_path(p);
                console.log('NSFS config root dir was created:', p);
            }
        } catch (err) {
            console.error('nsfs.check_and_create_config_dirs could not create pre requisite path', p);
        }
    }
}

async function main(argv = minimist(process.argv.slice(2))) {
    try {
        const resources_type = argv._[0] || '';
        if (argv.help || argv.h) {
            if (resources_type === 'account') {
                return usage({ print_account: true });
            } else if (resources_type === 'bucket') {
                return usage({ print_bucket: true });
            }
            return usage({ print_account: true, print_bucket: true });
        }
        if (resources_type === 'account') {
            if (argv.uid && typeof argv.uid !== 'number') {
                console.error('Error: UID must be a number');
                return;
            }
            if (argv.gid && typeof argv.gid !== 'number') {
                console.error('Error: GID must be a number');
                return;
            }
        }
        const config_root = argv.config_root ? String(argv.config_root) : config.NSFS_NC_DEFAULT_CONF_DIR;
        if (!config_root) {
            console.error('Error: Config dir should not be empty');
            usage({ print_account: true });
            return;
        }
        await check_and_create_config_dirs(config_root);
        const from_file = argv.from_file ? String(argv.from_file) : '';
        if (resources_type === 'account') {
            await account_management(argv, config_root, from_file);
        }
        if (resources_type === 'bucket') {
            await bucket_management(argv, config_root, from_file);
        }
    } catch (err) {
        console.error('NSFS Manage command: exit on error', err.stack || err);
        process.exit(2);
    }
}

function get_root_fs_context(config_root_backend) {
    return {
        uid: process.getuid(),
        gid: process.getgid(),
        warn_threshold_ms: config.NSFS_WARN_THRESHOLD_MS,
        backend: config_root_backend
    };
}

async function bucket_management(argv, config_root, from_file) {
    const action = argv._[1] || '';
    const config_root_backend = String(argv.config_root_backend);
    const data = await fetch_bucket_data(argv, config_root, from_file);
    await manage_bucket_operations(action, data, config_root, config_root_backend);
}

async function fetch_bucket_data(argv, config_root, from_file) {
    const action = argv._[1] || '';
    let data;
    if (from_file) {
        const raw_data = await fs.promises.readFile(from_file);
        data = JSON.parse(raw_data.toString());
    }
    if (!data) {
        data = {
            name: argv.name,
            system_owner: argv.email,
            bucket_owner: argv.email,
            tag: '',
            versioning: 'DISABLED',
            path: argv.path,
            should_create_underlying_storage: false,
            new_name: argv.new_name
        };
    }
    if (action === 'update') {
        data = _.omitBy(data, _.isUndefined);
        data = await fetch_existing_bucket_data(config_root, data);
    }

    data = {
        ...data,
        name: new SensitiveString(data.name),
        system_owner: new SensitiveString(data.system_owner),
        bucket_owner: new SensitiveString(data.bucket_owner),
        // update bucket identifier
        new_name: data.new_name && new SensitiveString(String(data.new_name))
    };
    return data;
}

async function fetch_existing_bucket_data(config_root, target) {
    const bucket_path = path.join(config_root, buckets_dir_name);
    let source;
    try {
        const full_bucket_config_path = get_config_file_path(bucket_path, target.name);
        source = await get_config_data(full_bucket_config_path);
    } catch (err) {
        console.error('NSFS Manage command: Could not find bucket ' + target.name + ' to update');
        usage({ print_bucket: true });
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

async function add_bucket_config_file(data, buckets_config_path, config_root_backend) {
    const is_valid = await validate_bucket_add_args(data);
    if (!is_valid) {
        usage({ print_bucket: true });
        return;
    }
    // TODO: support non root fs context
    const fs_context = get_root_fs_context(config_root_backend);
    const full_bucket_config_path = get_config_file_path(buckets_config_path, data.name);
    const exists = await config_file_exists(fs_context, full_bucket_config_path);
    if (exists) {
        console.error('Error: Bucket already exists');
        usage({ print_bucket: true });
        return;
    }
    data = JSON.stringify(data);
    await native_fs_utils.create_config_file(fs_context, buckets_config_path, full_bucket_config_path, data);
}

async function get_bucket_config_file_status(data, bucket_config_path, config_root_backend) {
    const is_valid = await validate_minimum_bucket_args(data);
    if (!is_valid) {
        usage({ print_bucket: true });
        return;
    }
    try {
        const bucket_path = get_config_file_path(bucket_config_path, data.name);
        const config_data = await get_view_config_data(bucket_path);
        console.log(config_data);
    } catch (err) {
        console.log('Bucket does not exist with name: ' + data.name);
    }
}

async function update_bucket_config_file(data, bucket_config_path, config_root_backend) {
    const is_valid = await validate_bucket_add_args(data, true);
    if (!is_valid) {
        usage({ print_bucket: true });
        return;
    }
    // TODO: support non root fs context
    const fs_context = get_root_fs_context(config_root_backend);

    const cur_name = data.name;
    const update_name = data.new_name && cur_name && data.new_name.unwrap() !== cur_name.unwrap();

    if (!update_name) {
        const full_bucket_config_path = get_config_file_path(bucket_config_path, data.name);
        data = JSON.stringify(data);
        await native_fs_utils.update_config_file(fs_context, bucket_config_path, full_bucket_config_path, data);
        return;
    }

    data.name = data.new_name;

    const cur_bucket_config_path = get_config_file_path(bucket_config_path, cur_name.unwrap());
    const new_bucket_config_path = get_config_file_path(bucket_config_path, data.name.unwrap());

    const exists = await config_file_exists(fs_context, new_bucket_config_path);
    if (exists) {
        console.error('Error: Bucket already exists');
        usage({ print_bucket: true });
        return;
    }

    data = JSON.stringify(_.omit(data, ['new_name']));

    await native_fs_utils.create_config_file(fs_context, bucket_config_path, new_bucket_config_path, data);
    await native_fs_utils.delete_config_file(fs_context, bucket_config_path, cur_bucket_config_path);
}


async function delete_bucket_config_file(data, buckets_config_path, config_root_backend) {
    const is_valid = await validate_minimum_bucket_args(data);
    if (!is_valid) {
        usage({ print_bucket: true });
        return;
    }
    // TODO: support non root fs context
    const fs_context = get_root_fs_context(config_root_backend);
    const full_bucket_config_path = get_config_file_path(buckets_config_path, data.name);
    await native_fs_utils.delete_config_file(fs_context, buckets_config_path, full_bucket_config_path);
}

async function manage_bucket_operations(action, data, config_root, config_root_backend) {
    const bucket_config_path = path.join(config_root, buckets_dir_name);
    if (action === 'add') {
        await add_bucket_config_file(data, bucket_config_path, config_root_backend);
    } else if (action === 'status') {
        await get_bucket_config_file_status(data, bucket_config_path, config_root_backend);
    } else if (action === 'update') {
        await update_bucket_config_file(data, bucket_config_path, config_root_backend);
    } else if (action === 'delete') {
        await delete_bucket_config_file(data, bucket_config_path, config_root_backend);
    } else if (action === 'list') {
        const buckets = await list_config_files(bucket_config_path);
        const bucket_names = buckets.map(item => (item.name));
        console.log('Bucket list', bucket_names);
    } else {
        usage({ print_bucket: true });
    }
}

async function account_management(argv, config_root, from_file) {
    const action = argv._[1] || '';
    const config_root_backend = String(argv.config_root_backend);
    const data = await fetch_account_data(argv, config_root, from_file);
    await manage_account_operations(action, data, config_root, config_root_backend);
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

/**
 * Will print the access_keys
 * @param {{ access_keys: any[]; }} data
 */
function print_access_keys(data) {
    const access_keys = data.access_keys[0];
    console.log(`\n\n`);
    console.log('access_key:', access_keys.access_key.unwrap());
    console.log('secret_key:', access_keys.secret_key.unwrap());
}

async function fetch_account_data(argv, config_root, from_file) {
    let data;
    let generate_access_keys = true;
    const action = argv._[1] || '';
    if (from_file) {
        const raw_data = await fs.promises.readFile(from_file);
        data = JSON.parse(raw_data.toString());
    }
    let new_access_key = argv.new_access_key;
    if (action === 'update') {
        generate_access_keys = false;
        if (argv.regenerate) {
            const keys = set_access_keys(argv, true);
            new_access_key = keys[0].access_key;
        }
    }
    if (action === 'delete') generate_access_keys = false;
    if (!data) {
        data = _.omitBy({
            name: argv.name,
            email: argv.email,
            creation_date: new Date().toISOString(),
            wide: argv.wide,
            new_name: argv.new_name,
            new_access_key,
            access_keys: set_access_keys(argv, generate_access_keys),
            nsfs_account_config: {
                distinguished_name: argv.user,
                uid: !argv.user && argv.uid,
                gid: !argv.user && argv.gid,
                new_buckets_path: argv.new_buckets_path
            }
        }, _.isUndefined);
    }
    if (action === 'update' || action === 'delete') {
        data = _.omitBy(data, _.isUndefined);
        data = await fetch_existing_account_data(config_root, data);
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
            new_buckets_path: data.nsfs_account_config.new_buckets_path
        },
        // updates of account identifiers
        new_name: data.new_name && new SensitiveString(String(data.new_name)),
        new_access_key: data.new_access_key && new SensitiveString(String(data.new_access_key))
    };
    return data;
}

async function fetch_existing_account_data(config_root, target) {
    let source;
    try {
        const account_path = target.name ?
            get_config_file_path(path.join(config_root, accounts_dir_name), target.name) :
            get_symlink_config_file_path(path.join(config_root, access_keys_dir_name), target.access_keys[0].access_key);
        source = await get_config_data(account_path);
    } catch (err) {
        console.error('NSFS Manage command: Could not find account to update', target, err);
        usage({ print_account: true });
    }
    const data = _.merge({}, source, target);
    return data;
}

async function config_file_exists(fs_context, config_path) {
    try {
        await nb_native().fs.stat(fs_context, config_path);
    } catch (err) {
        if (err.code === 'ENOENT') return false;
    }
    return true;
}

async function add_account_config_file(data, accounts_path, access_keys_path, config_root_backend) {
    const is_valid = await validate_account_add_args(data);
    if (!is_valid) {
        usage({ print_account: true });
        return;
    }
    // TODO: support non root fs context
    const fs_context = get_root_fs_context(config_root_backend);
    const access_key = data.access_keys[0].access_key;
    const full_account_config_path = get_config_file_path(accounts_path, data.name);
    const full_account_config_access_key_path = get_symlink_config_file_path(access_keys_path, access_key);

    const name_exists = await config_file_exists(fs_context, full_account_config_path);
    const access_key_exists = await config_file_exists(fs_context, full_account_config_access_key_path);

    if (name_exists || access_key_exists) {
        if (name_exists) console.error('Error: Account having the same name already exists');
        if (access_key_exists) console.error('Error: Account having the same access key already exists');
        usage({ print_account: true });
        return;
    }

    data = JSON.stringify(data);
    await native_fs_utils.create_config_file(fs_context, accounts_path, full_account_config_path, data);
    await native_fs_utils._create_path(access_keys_path, fs_context);
    await nb_native().fs.symlink(fs_context, full_account_config_path, full_account_config_access_key_path);
}

async function update_account_config_file(data, accounts_path, access_keys_path, config_root_backend) {
    const is_valid = await validate_account_add_args(data, true);
    if (!is_valid) {
        usage({ print_account: true });
        return;
    }
    // TODO: support non root fs context
    const fs_context = get_root_fs_context(config_root_backend);
    const cur_name = data.name;
    const cur_access_key = data.access_keys[0].access_key;
    const update_name = data.new_name && cur_name && data.new_name.unwrap() !== cur_name.unwrap();
    const update_access_key = data.new_access_key && cur_access_key && data.new_access_key.unwrap() !== cur_access_key.unwrap();

    if (!update_name && !update_access_key) {
        const full_account_config_path = get_config_file_path(accounts_path, data.name);
        data = JSON.stringify(data);
        await native_fs_utils.update_config_file(fs_context, accounts_path, full_account_config_path, data);
        return;
    }

    data.name = data.new_name || cur_name;
    data.access_keys[0].access_key = data.new_access_key || cur_access_key;

    const cur_account_config_path = get_config_file_path(accounts_path, cur_name.unwrap());
    const new_account_config_path = get_config_file_path(accounts_path, data.name.unwrap());
    const cur_access_key_config_path = get_symlink_config_file_path(access_keys_path, cur_access_key.unwrap());
    const new_access_key_config_path = get_symlink_config_file_path(access_keys_path, data.access_keys[0].access_key.unwrap());

    const name_exists = update_name && await config_file_exists(fs_context, new_account_config_path);
    const access_key_exists = update_access_key && await config_file_exists(fs_context, new_access_key_config_path);

    if (name_exists || access_key_exists) {
        if (name_exists) console.error('Error: Account having the same name already exists');
        if (access_key_exists) console.error('Error: Account having the same access key already exists');
        usage({ print_account: true });
        return;
    }

    data = JSON.stringify(_.omit(data, ['new_name', 'new_access_key']));

    if (update_name) {
        await native_fs_utils.create_config_file(fs_context, accounts_path, new_account_config_path, data);
        await native_fs_utils.delete_config_file(fs_context, accounts_path, cur_account_config_path);
    } else if (update_access_key) {
        await native_fs_utils.update_config_file(fs_context, accounts_path, cur_account_config_path, data);
    }
    // TODO: safe_unlink can be better but the current impl causing ELOOP - Too many levels of symbolic links
    // need to find a better way for atomic unlinking of symbolic links
    // handle atomicity for symlinks
    await nb_native().fs.unlink(fs_context, cur_access_key_config_path);
    await nb_native().fs.symlink(fs_context, new_account_config_path, new_access_key_config_path);

}

async function delete_account_config_file(data, accounts_path, access_keys_path, config_root_backend) {
    const is_valid = await validate_minimum_account_args(data);
    if (!is_valid) {
        usage({ print_account: true });
        return;
    }
    // TODO: support non root fs context
    const fs_context = get_root_fs_context(config_root_backend);
    const account_config_path = get_config_file_path(accounts_path, data.name);
    const access_key_config_path = get_symlink_config_file_path(access_keys_path, data.access_keys[0].access_key.unwrap());
    await native_fs_utils.delete_config_file(fs_context, accounts_path, account_config_path);
    await nb_native().fs.unlink(fs_context, access_key_config_path);
}

async function get_account_config_file_status(data, accounts_path, access_keys_path) {
    const is_valid = await validate_minimum_account_args(data);
    if (!is_valid) {
        usage({ print_account: true });
        return;
    }
    try {
        const account_path = data.name ?
            get_config_file_path(accounts_path, data.name) :
            get_symlink_config_file_path(access_keys_path, data.access_keys[0].access_key);
        const config_data = await get_view_config_data(account_path);
        console.log(config_data);
    } catch (err) {
        console.log('Account do not exists with access key : ' + data.access_keys[0].access_key);
    }
}

async function manage_account_operations(action, data, config_root, config_root_backend) {
    const accounts_path = path.join(config_root, accounts_dir_name);
    const access_keys_path = path.join(config_root, access_keys_dir_name);
    if (action === 'add') {
        await add_account_config_file(data, accounts_path, access_keys_path, config_root_backend);
        print_access_keys(data);
    } else if (action === 'status') {
        await get_account_config_file_status(data, accounts_path, access_keys_path);
    } else if (action === 'update') {
        await update_account_config_file(data, accounts_path, access_keys_path, config_root_backend);
        print_access_keys(data);
    } else if (action === 'delete') {
        await delete_account_config_file(data, accounts_path, access_keys_path, config_root_backend);
    } else if (action === 'list') {
        let accounts = await list_config_files(accounts_path);
        if (!data.wide) accounts = accounts.map(item => (item.name));
        console.log('Account list:', accounts);
    } else {
        console.error('Account action not found.');
        console.warn(ARGUMENTS.trimStart());
    }
}


/**
 * list_config_files will list all the config files (json) in a given config directory
 * @param {string} config_path
 */
async function list_config_files(config_path) {
    const entries = await fs.promises.readdir(config_path);
    const config_files = entries.filter(entree => entree.endsWith('.json'));
    const resources = await P.map(config_files, config_file_name => {
        const full_path = path.join(config_path, config_file_name);
        return get_view_config_data(full_path);
    });
    return resources;
}


/**
 * get_config_data will read a config file and return its content from it
 * @param {fs.PathLike} config_file_path
 */
async function get_config_data(config_file_path) {
    const data = await fs.promises.readFile(config_file_path);
    const resources = JSON.parse(data.toString());
    return resources;
}

/**
 * get_view_config_data will read a config file and return its content ready to be printed
 * @param {fs.PathLike} config_file_path
 */
async function get_view_config_data(config_file_path) {
    const data = await fs.promises.readFile(config_file_path);
    const resources = _.omit(JSON.parse(data.toString()), ['access_keys']);
    if (resources.nsfs_account_config) {
        resources.new_buckets_path = resources.nsfs_account_config.new_buckets_path;
        delete resources.nsfs_account_config;
    }
    return resources;
}

async function validate_minimum_bucket_args(data) {
    if (!data.name) {
        console.error('Error: bucket name should not be empty');
        return false;
    }
    return true;
}

async function validate_bucket_add_args(data, update) {
    if (!data.name) {
        console.error('Error: bucket name is mandatory, please use the --name flag');
        return false;
    } else if (!data.system_owner) {
        console.error('Error: The email for the bucket is mandatory, please use the --email flag');
        return false;
    } else if (!data.path) {
        console.error('Error: bucket path is mandatory, please use the --path flag');
        return false;
    }
    if (!update && data.new_name) {
        console.error('Error: Bucket new_name can not be used on add command, please remove the --new_name flag');
        return false;
    }
    const bucket_dir_stat = await fs_utils.file_exists(data.path);
    if (!bucket_dir_stat) {
        console.error('Error: Path should be a valid dir path', data.path);
        return false;
    }
    return true;

}

async function validate_account_add_args(data, update) {
    if (!data.access_keys[0].secret_key) {
        console.error('Error: Secret key is mandatory, please use the --secret_key flag');
        return false;
    } else if (!data.access_keys[0].access_key) {
        console.error('Error: Access key is mandatory, please use the --access_key flag');
        return false;
    }
    if ((data.nsfs_account_config.distinguished_name === undefined &&
            (data.nsfs_account_config.uid === undefined ||
                data.nsfs_account_config.gid === undefined)) ||
        !data.nsfs_account_config.new_buckets_path) {
        console.error('Error: Account config should not be empty');
        return false;
    }
    if (!data.name) {
        console.error('Error: Account name is mandatory, please use the --name flag');
        return false;
    } else if (!data.email) {
        console.error('Error: The email for the account  is mandatory, please use the --email flag');
        return false;
    }
    if (!update && data.new_name) {
        console.error('Error: Account new_name can not be used on add command, please remove the --new_name flag');
        return false;
    }
    if (!update && data.new_access_key) {
        console.error('Error: Account new_access_key can not be used on add command, please remove the --new_access_key flag');
        return false;
    }
    const bucket_dir_stat = await fs_utils.file_exists(data.nsfs_account_config.new_buckets_path);
    if (!bucket_dir_stat) {
        console.error('Error: new_buckets_path should be a valid dir path');
        return false;
    }
    return true;
}

async function validate_minimum_account_args(data) {
    if (!data.access_keys[0].access_key && !data.name) {
        console.error('Error: Access key or account name should not be empty');
        return false;
    }
    return true;
}

exports.main = main;
if (require.main === module) main();
