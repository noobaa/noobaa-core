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
const native_fs_utils = require('../util/native_fs_utils');

const HELP = `
Help:

    "nsfs" is a noobaa-core command runs a local S3 endpoint on top of a filesystem.
    Each sub directory of the root filesystem represents an S3 bucket.
    manage nsfs will provide a command line interface to create new accounts and map existing directories 
    to Noobaa as buckets. For more information refer to the noobaa docs.
`;

const USAGE = `
Usage:

    node src/cmd/manage_nsfs <action> <type> [options...]
`;

const ARGUMENTS = `
Arguments:

    <type>    Set the resource type such as accounts and buckets
    <action>  Action could be add, update, list, status and delete for accounts/buckets.
`;

const ACCOUNT_OPTIONS = `
Account Options:

    # Read account details from json file, no need to mention all the propery one by one in CLI
    --from_file <dir>                       (default none)          Set buckt/account schema full path.
                                                                    Get bucket and account details from json file                
    --config_root_backend <none | GPFS >    (default none)          Set the config_root FS type to be GPFS

    # required for add, replace 
    --name <name>               (default none)          Set the name for account/bucket.
    --email <email>             (default none)          Set the email for account/bucket.
    --uid <uid>                 (default as process)    Send requests to the Filesystem with uid.
    --gid <gid>                 (default as process)    Send requests to the Filesystem with gid.
    --user <distinguished_name> (default none)          Send requests to the Filesystem with distinguished_name (overrides uid/gid).
    --secret_key <key>          (default none)          The secret key pair for the access key.
    --new_buckets_path <dir>    (default none)          Set the root of the filesystem where each subdir is a bucket.
    
    # required for add, replace and delete
    --access_key <key>          (default none)                                     Authenticate incoming requests for this access key only (default is no auth).
    --config_root <dir>         (default config.NSFS_NC_DEFAULT_CONF_DIR)          Configuration files path for Noobaa standalon NSFS.
`;

const BUCKET_OPTIONS = `
Bucket Options:

    # Read Bucket details from json file, no need to mention all the propery one by one in CLI
    --from_file <dir>                       (default none)          Set buckt/account schema full path.
                                                                    Get bucket and account details from json file
    --config_root_backend <none | GPFS >    (default none)          Set the config_root FS type to be GPFS

    # required for add, replace 
    --email <email>             (default none)          Set the email for account/bucket.
    --path <dir>                (default none)          Set the bucket path.

    # required for add, replace and delete
    --name <name>               (default none)          Set the name for account/bucket.
    --config_root <dir>         (default config.NSFS_NC_DEFAULT_CONF_DIR)          Configuration files path for Noobaa standalon NSFS.
`;

function print_account_usage() {
    console.warn(HELP);
    console.warn(USAGE.trimStart());
    console.warn(ARGUMENTS.trimStart());
    console.warn(ACCOUNT_OPTIONS.trimStart());
    process.exit(1);
}

function print_bucket_usage() {
    console.warn(HELP);
    console.warn(USAGE.trimStart());
    console.warn(ARGUMENTS.trimStart());
    console.warn(BUCKET_OPTIONS.trimStart());
    process.exit(1);
}

async function check_and_create_config_dirs(config_root) {
    const bucket_dir_stat = await fs_utils.file_exists(config_root);
    if (!bucket_dir_stat) {
        await fs_utils.create_path(config_root);
        await fs_utils.create_path(config_root + '/buckets');
        await fs_utils.create_path(config_root + '/accounts');
        return true;
    }
    return false;
}

async function main(argv = minimist(process.argv.slice(2))) {
    try {
        const resources_type = argv._[0] || '';
        if ((argv.help || argv.h) && resources_type === 'account') return print_account_usage();
        if ((argv.help || argv.h) && resources_type === 'bucket') return print_bucket_usage();
        const config_root = argv.config_root ? String(argv.config_root) : config.NSFS_NC_DEFAULT_CONF_DIR;
        if (!config_root) {
            console.error('Error: Config dir should not be empty');
            print_account_usage();
            return;
        }
        const state = await check_and_create_config_dirs(config_root);
        if (state) {
            console.log('NSFS config root dirs are created in :' + config_root);
        }
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
    const name = argv.name && new SensitiveString(String(argv.name));
    const email = argv.email && new SensitiveString(String(argv.email));
    let data;
    if (from_file) {
        const raw_data = await fs.promises.readFile(from_file);
        data = JSON.parse(raw_data.toString());
        data.name = new SensitiveString(data.name);
    }
    if (!data) {
        const bucket_path = argv.path ? String(argv.path) : '';
        data = {
            name: name,
            system_owner: email,
            bucket_owner: email,
            tag: '',
            versioning: 'DISABLED',
            path: bucket_path,
            should_create_underlying_storage: false,
        };
    }
    data.creation_date = new Date().toISOString();
    if (action === 'update') {
        data = _.omitBy(data, _.isUndefined);
        data = await update_bucket_object(config_root, data);
    }
    return data;
}

async function update_bucket_object(config_root, target) {
    const account_path = config_root + '/buckets';
    let source;
    try {
        const source_raw = await fs.promises.readFile(path.join(account_path, target.name + '.json'));
        source = JSON.parse(source_raw.toString());
    } catch (err) {
        console.error('NSFS Manage command: Could not find bucket ' + target.name + ' to update');
        print_bucket_usage();
    }
    const data = _.merge({}, source, target);
    return data;
}

function get_config_file_path(config_type_path, file_name) {
    return path.join(config_type_path, file_name + '.json');
}

async function add_bucket_config_file(data, buckets_config_path, config_root_backend) {
    const is_valid = await validate_bucket_add_args(data);
    if (!is_valid) {
        print_bucket_usage();
        return;
    }
    // TODO: support non root fs context
    const fs_context = get_root_fs_context(config_root_backend);
    const full_bucket_config_path = get_config_file_path(buckets_config_path, data.name);
    data = JSON.stringify(data);
    await native_fs_utils.create_config_file(fs_context, buckets_config_path, full_bucket_config_path, data);
}

async function get_bucket_config_file_status(data, bucket_config_path, config_root_backend) {
    const is_valid = await validate_minimum_bucket_args(data);
    if (!is_valid) {
        print_bucket_usage();
        return;
    }
    try {
        const raw_data = await fs.promises.readFile(path.join(bucket_config_path, data.name + '.json'));
        const config_data = JSON.parse(raw_data.toString());
        if (config_data) {
            console.log(config_data);
        } else {
            console.log('Bucket do not exists with name : ' + data.name);
        }
    } catch (err) {
        console.log('Bucket do not exists with name: ' + data.name);
    }
}

async function update_bucket_config_file(data, bucket_config_path, config_root_backend) {
    const is_valid = await validate_bucket_add_args(data);
    if (!is_valid) {
        print_bucket_usage();
        return;
    }
    // TODO: support non root fs context
    const fs_context = get_root_fs_context(config_root_backend);
    const full_bucket_config_path = get_config_file_path(bucket_config_path, data.name);
    data = JSON.stringify(data);
    await native_fs_utils.update_config_file(fs_context, bucket_config_path, full_bucket_config_path, data);
}


async function delete_bucket_config_file(data, buckets_config_path, config_root_backend) {
    const is_valid = await validate_minimum_bucket_args(data);
        if (!is_valid) {
            print_bucket_usage();
            return;
        }
        // TODO: support non root fs context
        const fs_context = get_root_fs_context(config_root_backend);
        const full_bucket_config_path = get_config_file_path(buckets_config_path, data.name);
        await native_fs_utils.delete_config_file(fs_context, buckets_config_path, full_bucket_config_path);
}

async function manage_bucket_operations(action, data, config_root, config_root_backend) {
    const bucket_config_path = config_root + '/buckets';
    if (action === 'add') {
        await add_bucket_config_file(data, bucket_config_path, config_root_backend);
    } else if (action === 'status') {
        await get_bucket_config_file_status(data, bucket_config_path, config_root_backend);
    } else if (action === 'update') {
        await update_bucket_config_file(data, bucket_config_path, config_root_backend);
    } else if (action === 'delete') {
        await delete_bucket_config_file(data, bucket_config_path, config_root_backend);
    } else if (action === 'list') {
        const buckets = await list_config_file(bucket_config_path);
        console.log(buckets);
    } else {
        print_bucket_usage();
    }
}

async function account_management(argv, config_root, from_file) {
    const action = argv._[1] || '';
    const config_root_backend = String(argv.config_root_backend);
    const data = await fetch_account_data(argv, config_root, from_file);
    await manage_account_operations(action, data, config_root, config_root_backend);
}

async function fetch_account_data(argv, config_root, from_file) {
    let data;
    const action = argv._[1] || '';
    if (from_file) {
        const raw_data = await fs.promises.readFile(from_file);
        data = JSON.parse(raw_data.toString());
        data.name = new SensitiveString(data.name);
        data.email = new SensitiveString(data.email);
        data.access_keys[0].access_key = new SensitiveString(data.access_keys[0].access_key);
        data.access_keys[0].secret_key = new SensitiveString(data.access_keys[0].secret_key);
    }
    if (!data) {
        const name = argv.name && new SensitiveString(String(argv.name));
        const email = argv.email && new SensitiveString(String(argv.email));
        const distinguished_name = argv.user && new SensitiveString(String(argv.user));
        const uid = argv.user ? undefined : Number(argv.uid) || process.getuid();
        const gid = argv.user ? undefined : Number(argv.gid) || process.getgid();
        const access_key = argv.access_key && new SensitiveString(String(argv.access_key));
        const secret_key = argv.secret_key && new SensitiveString(String(argv.secret_key));
        const new_buckets_path = argv.new_buckets_path ? String(argv.new_buckets_path) : '';
        data = _.omitBy({
            name: name,
            email: email,
            access_keys: [{
                access_key: access_key,
                secret_key: secret_key
            }],
            nsfs_account_config: {
                distinguished_name,
                uid: uid,
                gid: gid,
                new_buckets_path: new_buckets_path
            }}, _.isUndefined);
    }
    data.creation_date = new Date().toISOString();
    if (action === 'update') {
        data = _.omitBy(data, _.isUndefined);
        data = update_account_object(config_root, data);
    }
    return data;
}

async function update_account_object(config_root, target) {
    const account_path = config_root + '/accounts';
    let source;
    try {
        const source_raw = await fs.promises.readFile(path.join(account_path, target.access_keys[0].access_key + '.json'));
        source = JSON.parse(source_raw.toString());
        target.nsfs_account_config.new_buckets_path = target.nsfs_account_config.new_buckets_path ||
                                                        source.nsfs_account_config.new_buckets_path;
    } catch (err) {
        console.error('NSFS Manage command: Could not find account to update');
        print_account_usage();
    }
    const data = _.merge({}, source, target);
    return data;
}

async function add_account_config_file(data, accounts_config_path, config_root_backend) {
    const is_valid = await validate_account_add_args(data);
    if (!is_valid) {
        print_account_usage();
        return;
    }
    // TODO: support non root fs context
    const fs_context = get_root_fs_context(config_root_backend);
    const full_account_config_path = get_config_file_path(accounts_config_path, data.access_keys[0].access_key);
    data = JSON.stringify(data);
    await native_fs_utils.create_config_file(fs_context, accounts_config_path, full_account_config_path, data);
}

async function update_account_config_file(data, accounts_config_path, config_root_backend) {
    const is_valid = await validate_account_add_args(data);
    if (!is_valid) {
        print_account_usage();
        return;
    }
    // TODO: support non root fs context
    const fs_context = get_root_fs_context(config_root_backend);
    const full_account_config_path = get_config_file_path(accounts_config_path, data.access_keys[0].access_key);
    data = JSON.stringify(data);
    await native_fs_utils.update_config_file(fs_context, accounts_config_path, full_account_config_path, data);
}

async function delete_account_config_file(data, accounts_config_path, config_root_backend) {
    const is_valid = await validate_minimum_account_args(data);
    if (!is_valid) {
        print_account_usage();
        return;
    }
    // TODO: support non root fs context
    const fs_context = get_root_fs_context(config_root_backend);
    const full_account_config_path = get_config_file_path(accounts_config_path, data.access_keys[0].access_key);
    await native_fs_utils.delete_config_file(fs_context, accounts_config_path, full_account_config_path);
}

async function get_account_config_file_status(data, account_path, config_root_backend) {
    const is_valid = await validate_minimum_account_args(data);
    if (!is_valid) {
        print_account_usage();
        return;
    }
    try {
        const raw_data = await fs.promises.readFile(path.join(account_path, data.access_keys[0].access_key + '.json'));
        const config_data = JSON.parse(raw_data.toString());
        if (config_data) {
            console.log(config_data);
        } else {
            console.log('Account do not exists with access key : ' + data.access_keys[0].access_key);
        }
    } catch (err) {
        console.log('Account do not exists with access key : ' + data.access_keys[0].access_key);
    }
}

async function manage_account_operations(action, data, config_root, config_root_backend) {
    const account_path = config_root + '/accounts';
    if (action === 'add') {
        await add_account_config_file(data, account_path, config_root_backend);
    } else if (action === 'status') {
        await get_account_config_file_status(data, account_path, config_root_backend);
    } else if (action === 'update') {
        await update_account_config_file(data, account_path, config_root_backend);
    } else if (action === 'delete') {
        await delete_account_config_file(data, account_path, config_root_backend);
    } else if (action === 'list') {
        const accounts = await list_config_file(account_path);
        console.log(accounts);
    } else {
        console.log('Account action not found.');
        print_account_usage();
    }
}


async function list_config_file(full_path) {
    const entries = await fs.promises.readdir(full_path);
    const bucket_config_files = entries.filter(entree => entree.endsWith('.json'));
    const resources = await P.map(bucket_config_files, bucket_config_file => get_create_config_file(full_path, bucket_config_file));
    return resources;
}

async function get_create_config_file(resources_path, bucket_config_file_name) {
    const full_path = path.join(resources_path, bucket_config_file_name);
    const data = await fs.promises.readFile(full_path);
    const resources = JSON.parse(data.toString());
    return { name: resources.name };
}

async function validate_minimum_bucket_args(data) {
    if (!data.name) {
        console.error('Error: bucket name should not be empty');
        return false;
    }
    return true;
}

async function validate_bucket_add_args(data) {
    if (!data.name || !data.system_owner || !data.path) {
        console.error('Error: User data and bucket path should not be empty');
        return false;
    }
    const bucket_dir_stat = await fs_utils.file_exists(data.path);
    if (!bucket_dir_stat) {
        console.error('Error: Path should be a valid dir path', data.path);
        return false;
    }
    return true;

}

async function validate_account_add_args(data) {
    if (!data.access_keys[0].secret_key || !data.access_keys[0].access_key) {
        console.error('Error: Access key should not be empty');
        return false;
    }
    if ((data.nsfs_account_config.distinguished_name === undefined &&
        (data.nsfs_account_config.uid === undefined ||
        data.nsfs_account_config.gid === undefined)) ||
        !data.nsfs_account_config.new_buckets_path) {
        console.error('Error: Account config should not be empty');
        return false;
    }
    if (!data.name || !data.email) {
        console.error('Error: Account data should not be empty.');
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
    if (!data.access_keys[0].access_key) {
        console.error('Error: Access key should not be empty');
        return false;
    }
    return true;
}

exports.main = main;
if (require.main === module) main();
