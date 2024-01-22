/* Copyright (C) 2024 NooBaa */
'use strict';

const { TYPES, ACTIONS } = require('./manage_nsfs_constants');

const HELP = `
Help:

    "NSFS" (Namespace FileSystem) is a NooBaa system that runs a local S3 endpoint on top of a filesystem.
    Each subdirectory of the root filesystem represents an S3 bucket.
    "manage_nsfs" will provide a command line interface (CLI) to create new accounts and map existing directories 
    to NooBaa as buckets. For more information refer to the NooBaa docs.
`;

const USAGE = `
Usage:

    execute with root permission or use sudo before each command

    node src/cmd/manage_nsfs <type> <action> [options...]
`;

const ARGUMENTS = `
Arguments:

    <type>    Set the resource type: account, bucket, or whitelist.
    <action>  Action could be: add, update, list, status, and delete for accounts/buckets.
`;

const ARGUMENTS_ACCOUNT = `
Account Arguments
account <action> [options...]

    <action>  Action could be: add, update, list, status, and delete.
`;

const ARGUMENTS_BUCKET = `
Bucket Arguments
bucket <action> [options...]

    <action>  Action could be: add, update, list, status, and delete.
`;

const WHITELIST_OPTIONS = `
Whitelist:
whitelist [options...]:
set the general configuration to allow only incoming requests from a given list of IPs:

    # required
    --ips <ips>                       (default none)          Set whitelist ips in format: '["127.0.0.1", "192.0.10.0", "3002:0bd6:0000:0000:0000:ee00:0033:6778"]'.
`;

const GLOBAL_CONFIG_ROOT_ALL = `
    # global configurations
    --config_root <dir>                             (default config.NSFS_NC_DEFAULT_CONF_DIR)   Use Configuration files path.
`;

const GLOBAL_CONFIG_OPTIONS_ADD_UPDATE = `
    # global configurations
    --from_file <dir>                                         (default none)                                  Use details from the JSON file, there is no need to mention all the properties individually in the CLI.
    --config_root <dir>                                       (default config.NSFS_NC_DEFAULT_CONF_DIR)       Use Configuration files path.
    --config_root_backend <none | GPFS | CEPH_FS | NFSv4>     (default config.NSFS_NC_CONFIG_DIR_BACKEND)     Use the filesystem type in the configuration.
`;

const ACCOUNT_OPTIONS_ADD = `
Account
account add [options...]:
add a new account

    # required
    --name <name>                                                                               Set the name for the account.
    --email <email>                                                                             Set the email for the account (used as the identifier for buckets owner).
    --uid <uid>                                                                                 Set the User Identifier (UID) (UID and GID can be replaced by --user option).
    --gid <gid>                                                                                 Set the Group Identifier (GID) (UID and GID can be replaced by --user option).
    --new_buckets_path <dir>                                                                    Set the filesystem's root where each subdirectory is a bucket.

    # optional
    --user <user-name>                              (default none)                              Set the OS user name (instead of UID and GID)
    --access_key <key>                              (default is generated)                      Set the access key for the account.
    --secret_key <key>                              (default is generated)                      Set the secret key for the account.
    --fs_backend <none | GPFS | CEPH_FS | NFSv4>    (default config.NSFS_NC_STORAGE_BACKEND)    Set filesystem type of new_buckets_path.
`;

const ACCOUNT_OPTIONS_UPDATE = `
Account
account update [options...]:
    update an existing account

    # required
    --name <name>                                                                               The name of the account
                                                                                                (can identify the account by --access_key option)

    # optional
    --new_name <name>                               (default none)                              Update the account name.
    --email <email>                                 (default none)                              Update the email (used as the identifier for buckets owner).
    --uid <uid>                                     (default none)                              Update the User Identifier (UID).
    --gid <gid>                                     (default none)                              Update the Group Identifier (GID).
    --new_buckets_path <dir>                        (default none)                              Update the filesystem's root where each subdirectory is a bucket.
    --user <user-name>                              (default none)                              Update the OS user name (instead of uid and gid).
    --regenerate                                    (default none)                              Update automatically generated access key and secret key.
    --access_key <key>                              (default none)                              Update the access key. Can be used as identifier instead of --name.
    --secret_key <key>                              (default none)                              Update the secret key.
    --fs_backend <none | GPFS | CEPH_FS | NFSv4>    (default config.NSFS_NC_STORAGE_BACKEND)    Update filesystem type of new_buckets_path.
`;

const ACCOUNT_OPTIONS_DELETE = `
Account
account delete [options...]:
    delete an existing account

    # required
    --name <name>                                                                               The name of the account.
                                                                                                (can identify the account by --access_key option)
`;

const ACCOUNT_OPTIONS_STATUS = `
Account
account status [options...]:
    print the account's details, such as name, email, creation date, UID, GID (or user details), etc.
    

    # required
    --name <name>                                                                               The name of the account.
                                                                                                (can identify the account by --access_key option)

    # optional
    --show_secrets                                  (default false)                             Print the access key and secret key of the account.
`;

const ACCOUNT_OPTIONS_LIST = `
Account
account list [options...]:
    list all accounts' names

    # optional
    --wide                                          (default false)                             Print the additional details for each account.
    --show_secrets                                  (default false)                             Print the access key and secret key of each account (only when using option --wide).
    
    # optional filters
    --uid                                                                                       Filters the list based on the provided UID.
    --gid                                                                                       Filters the list based on the provided GID.
    --user                                                                                      Filters the list based on the provided FS user distinguished name.
    --name                                                                                      Filters the list based on the provided account name.
    --access_key                                                                                Filters the list based on the provided account access_key.
`;

const BUCKET_OPTIONS_ADD = `
Bucket
bucket add [options...]:
add a new bucket (must have an account).

    # required
    --name <name>                                                                               Set the name for the bucket.
    --email <email>                                                                             Set the bucket owner email.
    --path <dir>                                                                                Set the bucket path.

    # optional
    --bucket_policy<string>                         (default none)                              Set bucket policy, type is a string of valid JSON policy.
    --fs_backend <none | GPFS | CEPH_FS | NFSv4>    (default config.NSFS_NC_STORAGE_BACKEND)    Set filesystem type.
`;

const BUCKET_OPTIONS_UPDATE = `
Bucket
bucket update [options...]:
update an existing bucket.

    # required
    --name <name>                                                                               The name of the bucket.

    # optional
    --new_name <name>                               (default none)                              Update the bucket name.
    --email <email>                                 (default none)                              Update the bucket owner email.
    --path <dir>                                    (default none)                              Update the bucket path.
    --bucket_policy<string>                         (default none)                              Update bucket policy, type is a string of valid JSON policy (unset with '').
    --fs_backend <none | GPFS | CEPH_FS | NFSv4>    (default config.NSFS_NC_STORAGE_BACKEND)    Update filesystem type (unset with '').
`;

const BUCKET_OPTIONS_DELETE = `
Bucket
bucket delete [options...]:
    delete an existing bucket

    # required
    --name <name>                                                                               The name of the bucket.
`;

const BUCKET_OPTIONS_STATUS = `
Bucket
bucket status [options...]:
    print the bucket's details, such as name, bucket owner, creation date, versioning, etc.
    

    # required
    --name <name>                                                                               The name of the bucket.
`;

const BUCKET_OPTIONS_LIST = `
Bucket
bucket list [options...]:
    list all buckets' names

    # optional
    --wide                                          (default false)                             Print the additional details for each bucket.

    # optional filters
    --name                                                                                      Filters the list based on the provided account name.
`;

/** print_help_options would print the help options according to the arguments that were passed
 * @param {string} type
 * @param {string} action
 */
function print_help_options(type, action) {
    switch (type) {
        case TYPES.ACCOUNT:
            print_help_account(action);
            break;
        case TYPES.BUCKET:
            print_help_bucket(action);
            break;
        case TYPES.IP_WHITELIST:
            process.stdout.write(WHITELIST_OPTIONS.trimStart());
            break;
        default:
            process.stdout.write(HELP + '\n');
            process.stdout.write(USAGE.trimStart() + '\n');
            process.stdout.write(ARGUMENTS.trimStart() + '\n');
    }
    process.exit(0);
}

/** print_help_account would print the help options for account
 * @param {string} action
 */
function print_help_account(action) {
    switch (action) {
        case ACTIONS.ADD:
            process.stdout.write(ACCOUNT_OPTIONS_ADD.trimStart() +
                GLOBAL_CONFIG_OPTIONS_ADD_UPDATE + '\n');
            break;
        case ACTIONS.UPDATE:
            process.stdout.write(ACCOUNT_OPTIONS_UPDATE.trimStart() +
                GLOBAL_CONFIG_OPTIONS_ADD_UPDATE + '\n');
            break;
        case ACTIONS.DELETE:
            process.stdout.write(ACCOUNT_OPTIONS_DELETE.trimStart() + GLOBAL_CONFIG_ROOT_ALL + '\n');
            break;
        case ACTIONS.STATUS:
            process.stdout.write(ACCOUNT_OPTIONS_STATUS.trimStart() + GLOBAL_CONFIG_ROOT_ALL + '\n');
            break;
        case ACTIONS.LIST:
            process.stdout.write(ACCOUNT_OPTIONS_LIST.trimStart() + GLOBAL_CONFIG_ROOT_ALL + '\n');
            break;
        default:
            process.stdout.write(ARGUMENTS_ACCOUNT.trimStart() + GLOBAL_CONFIG_ROOT_ALL + '\n');
    }
    process.exit(0);
}

/** print_help_bucket would print the help options for bucket
 * @param {string} action
 */
function print_help_bucket(action) {
    switch (action) {
        case ACTIONS.ADD:
            process.stdout.write(BUCKET_OPTIONS_ADD.trimStart() +
                GLOBAL_CONFIG_OPTIONS_ADD_UPDATE + '\n');
            break;
        case ACTIONS.UPDATE:
            process.stdout.write(BUCKET_OPTIONS_UPDATE.trimStart() +
                GLOBAL_CONFIG_OPTIONS_ADD_UPDATE + '\n');
            break;
        case ACTIONS.DELETE:
            process.stdout.write(BUCKET_OPTIONS_DELETE.trimStart() + GLOBAL_CONFIG_ROOT_ALL + '\n');
            break;
        case ACTIONS.STATUS:
            process.stdout.write(BUCKET_OPTIONS_STATUS.trimStart() + GLOBAL_CONFIG_ROOT_ALL + '\n');
            break;
        case ACTIONS.LIST:
            process.stdout.write(BUCKET_OPTIONS_LIST.trimStart() + GLOBAL_CONFIG_ROOT_ALL + '\n');
            break;
        default:
            process.stdout.write(ARGUMENTS_BUCKET.trimStart() + GLOBAL_CONFIG_ROOT_ALL + '\n');
    }
    process.exit(0);
}

// EXPORTS
exports.print_usage = print_help_options;
