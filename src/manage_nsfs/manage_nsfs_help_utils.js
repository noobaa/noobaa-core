/* Copyright (C) 2024 NooBaa */
'use strict';

const { TYPES, ACTIONS, GLACIER_ACTIONS, DIAGNOSE_ACTIONS, UPGRADE_ACTIONS } = require('./manage_nsfs_constants');

const HELP = `
Help:

    "NSFS" (Namespace FileSystem) is a NooBaa system that runs a local S3 endpoint on top of a filesystem.
    Each subdirectory of the root filesystem represents an S3 bucket.
    "noobaa-cli" will provide a command line interface (CLI) to create new accounts and map existing directories
    to NooBaa as buckets. For more information refer to the NooBaa docs.

`;

const USAGE = `
Usage:

    execute with root permission or use sudo before each command

    noobaa-cli <type> <action> [flags]

`;

const ARGUMENTS = `
Arguments:

    <type>    Set the resource type: account, bucket, whitelist, diagnose, logging or upgrade.
    <action>  Actions are dependent on the selected type.

`;

const ACCOUNT_ACTIONS = `
Help:

    Use this CLI to execute all the account related actions.

Usage:

    account <action> [flags]

List of actions supported:

    add
    update
    list
    status
    delete

`;

const BUCKET_ACTIONS = `
Help:

    Use this CLI to execute all the bucket related actions.

Usage:

    bucket <action> [flags]

List of actions supported:

    add
    update
    list
    status
    delete

`;

const CONNECTION_ACTIONS = `
Help:

    Use this CLI to execute all the connection related actions.

Usage:

    connection <action> [flags]

List of actions supported:

    add
    update
    list
    status
    delete

`;

const WHITELIST_FLAGS = `
Help:

    Use this to set the general configuration to allow only incoming requests from a given list of IP addresses

Usage:

    whitelist [flags]

Flags:

    --ips <string>                                          Set configuring for allowed IP addresses; format: '["127.0.0.1", "192.0.10.0", "3002:0bd6:0000:0000:0000:ee00:0033:6778"]', unset using '[]'

`;

const LOGGING_FLAGS = `
Help:

    Use this to upload all the bucket logging collected in the system to their target buckets

Usage:

    logging [flags]

`;

const CLI_MUTUAL_FLAGS = `
    --config_root <string>                                (optional)        Use configuration files path (default config.NSFS_NC_DEFAULT_CONF_DIR)
    --config_root_backend <none | GPFS | CEPH_FS | NFSv4> (optional)        Use the filesystem type in the configuration (default config.NSFS_NC_CONFIG_DIR_BACKEND)
    --debug <number>                                      (optional)        Use for increasing the log verbosity of cli commands

`;

const ACCOUNT_FLAGS_ADD = `
Help:

    Use this CLI to add account.

Usage:

    account add [flags]

Flags:
    --name <string>                                                         Set the name for the account
    --uid <number>                                                          Set the User Identifier (UID) (UID and GID can be replaced by --user option)
    --gid <number>                                                          Set the Group Identifier (GID) (UID and GID can be replaced by --user option)
    --supplemental_groups <string>                        (optional)        Set the supplemental group list (List of GIDs) separated by commas (,) example: '212,211,202'
    --new_buckets_path <string>                           (optional)        Set the filesystem's root path where each subdirectory is a bucket
    --user <string>                                       (optional)        Set the OS user name (instead of UID and GID)
    --access_key <string>                                 (optional)        Set the access key for the account (default is generated)
    --secret_key <string>                                 (optional)        Set the secret key for the account (default is generated)
    --fs_backend <none | GPFS | CEPH_FS | NFSv4>          (optional)        Set the filesystem type of new_buckets_path (default config.NSFS_NC_STORAGE_BACKEND)
    --allow_bucket_creation <true | false>                (optional)        Set the account to explicitly allow or block bucket creation
    --force_md5_etag <true | false>                       (optional)        Set the account to force md5 etag calculation. (unset with '') (will override default config.NSFS_NC_STORAGE_BACKEND)
    --iam_operate_on_root_account <true | false>          (optional)        Set the account to create root accounts instead of IAM users in IAM API requests.
    --from_file <string>                                  (optional)        Use details from the JSON file, there is no need to mention all the properties individually in the CLI
`;

const ACCOUNT_FLAGS_UPDATE = `
Help:

    Use this CLI to update account.

Usage:

    account update [flags]

Flags:

    --name <string>                                                         The name of the account
    --new_name <string>                                   (optional)        Update the account name
    --uid <number>                                        (optional)        Update the User Identifier (UID)
    --gid <number>                                        (optional)        Update the Group Identifier (GID)
    --supplemental_groups <string>                        (optional)        Update the list of supplemental groups (List of GID) seperated by comma(,) example: 211,202,23 - it will override existing list (unset with '')
    --new_buckets_path <string>                           (optional)        Update the filesystem's root path where each subdirectory is a bucket (unset with '')
    --user <string>                                       (optional)        Update the OS user name (instead of uid and gid)
    --regenerate                                          (optional)        Update automatically generated access key and secret key
    --access_key <string>                                 (optional)        Update the access key
    --secret_key <string>                                 (optional)        Update the secret key
    --fs_backend <none | GPFS | CEPH_FS | NFSv4>          (optional)        Update the filesystem type of new_buckets_path (default config.NSFS_NC_STORAGE_BACKEND), (unset with '')
    --allow_bucket_creation <true | false>                (optional)        Update the account to explicitly allow or block bucket creation
    --force_md5_etag <true | false>                       (optional)        Update the account to force md5 etag calculation (unset with '') (will override default config.NSFS_NC_STORAGE_BACKEND)
    --iam_operate_on_root_account <true | false>          (optional)        Update the account to create root accounts instead of IAM users in IAM API requests.
`;

const ACCOUNT_FLAGS_DELETE = `
Help:

    Use this CLI to delete account.

Usage:

    account delete [flags]

Flags:

    --name <string>                                                         The name of the account

`;

const ACCOUNT_FLAGS_STATUS = `
Help:

    Use this CLI to get account status.

Usage:

    account status [flags]

Flags:

    --name <string>                                                         The name of the account
    --access_key <string>                                 (optional)        The access key of the account (identify the account instead of name)
    --show_secrets                                        (optional)        Print the access key and secret key of the account

`;

const ACCOUNT_FLAGS_LIST = `
Help:

    Use this CLI to list accounts.

Usage:

    account list [flags]

Flags:

    --wide                                                (optional)        Print the additional details for each account
    --show_secrets                                        (optional)        Print the access key and secret key of each account (only when using flag --wide)
    --uid <number>                                        (optional)        Filter the list based on the provided account UID
    --gid <number>                                        (optional)        Filter the list based on the provided account GID
    --user <string>                                       (optional)        Filter the list based on the provided account user
    --name <string>                                       (optional)        Filter the list based on the provided account name
    --access_key <string>                                 (optional)        Filter the list based on the provided account access key

`;

const BUCKET_FLAGS_ADD = `
Help:

    Use this CLI to add bucket.

Usage:

    bucket add [flags]

Flags:

    --name <string>                                                         Set the name for the bucket
    --owner <string>                                                        Set the bucket owner name
    --path <string>                                                         Set the bucket path
    --bucket_policy <string>                              (optional)        Set the bucket policy, type is a string of valid JSON policy
    --fs_backend <none | GPFS | CEPH_FS | NFSv4>          (optional)        Set the filesystem type (default config.NSFS_NC_STORAGE_BACKEND)
    --force_md5_etag <true | false>                       (optional)        Set the bucket to force md5 etag calculation (unset with '') (will override default config.NSFS_NC_STORAGE_BACKEND)
    --from_file <string>                                  (optional)        Use details from the JSON file, there is no need to mention all the properties individually in the CLI

`;

const BUCKET_FLAGS_UPDATE = `
Help:

    Use this CLI to update bucket.

Usage:

    bucket update [flags]

Flags:

    --name <string>                                                         The name of the bucket
    --new_name <string>                                   (optional)        Update the bucket name
    --owner <string>                                      (optional)        Update the bucket owner name
    --path <string>                                       (optional)        Update the bucket path
    --bucket_policy <string>                              (optional)        Update the bucket policy, type is a string of valid JSON policy (unset with '')
    --fs_backend <none | GPFS | CEPH_FS | NFSv4>          (optional)        Update the filesystem type (unset with '') (default config.NSFS_NC_STORAGE_BACKEND)
    --force_md5_etag <true | false>                       (optional)        Update the bucket to force md5 etag calculation (unset with '') (will override default config.NSFS_NC_STORAGE_BACKEND)

`;

const BUCKET_FLAGS_DELETE = `
Help:

    Use this CLI to delete bucket.

Usage:

    bucket delete [flags]

Flags:

    --name <string>                                                         The name of the bucket
    --force                                               (optional)        Forcefully delete bucket if the bucket is not empty

`;

const BUCKET_FLAGS_STATUS = `
Help:

    Use this CLI to get bucket status.

Usage:

    bucket status [flags]

Flags:

    --name <string>                                                         The name of the bucket

`;

const BUCKET_FLAGS_LIST = `
Help:

    Use this CLI to list buckets.

Usage:

    bucket list [flags]

Flags:

    --wide                                                (optional)        Print the additional details for each bucket
    --name <string>                                       (optional)        Filter the list based on the provided bucket name

`;

const GLACIER_OPTIONS = `
Help:

    Use this CLI to execute all the glacier related actions.

Usage:

    glacier <action> [flags]

List of actions supported:

    migrate
    restore
    expiry

`;

const GLACIER_MIGRATE_OPTIONS = ``;

const GLACIER_RESTORE_OPTIONS = ``;

const GLACIER_EXPIRY_OPTIONS = ``;


const DIAGNOSE_OPTIONS = `
Help:

    Use this CLI to execute different Noobaa system diagnosis tools.

Usage:

    noobaa-cli diagnose <action> [flags]

List of actions supported:

    health
    gather-logs
    metrics

`;

const DIAGNOSE_HEALTH_OPTIONS = `
Help:

    'health' is a noobaa-core command that will return the health status of deployed noobaa system.

Usage:

    noobaa-cli diagnose health [flags]

Flags:

    --deployment_type        <string>        (optional)          Set the nsfs type for heath check.(default nc; Non Containerized)
    --https_port             <number>        (optional)          Set the S3 endpoint listening HTTPS port to serve. (default config.ENDPOINT_SSL_PORT)
    --all_account_details    <boolean>       (optional)          Set a flag for returning all account details.
    --all_bucket_details     <boolean>       (optional)          Set a flag for returning all bucket details.
    --all_connection_details <boolean>       (optional)          Set a flag for returning all connection details.
    --debug                  <number>        (optional)          Use for increasing the log verbosity of health cli commands.
    --config_root            <string>        (optional)          Set Configuration files path for Noobaa standalon NSFS. (default config.NSFS_NC_DEFAULT_CONF_DIR)

`;

const DIAGNOSE_GATHER_LOGS_OPTIONS = `
Help:

    'gather-logs' is a noobaa-core command that will collect NooBaa diagnostics logs tar file

Usage:

    noobaa-cli diagnose gather-logs [flags]

Flags:

    --dir_path              <string>         (optional)          collect noobaa diagnostics tar file into destination directory
    --config_dir_dump       <boolean>        (optional)          collect config directory in addition to diagnostics
    --metrics_dump          <boolean>        (optional)          collect metrics in addition to diagnostics

`;

const DIAGNOSE_METRICS_OPTIONS = `
Help:

    'metrics' is a noobaa-core command that will return the exported metrics of the deployed NooBaa system.

Usage:

    noobaa-cli diagnose metrics

`;


const UPGRADE_OPTIONS = `
Help:

    'upgrade' noobaa-core command will initiate version upgrade and also return the upgrade status or history.

Usage:

    noobaa-cli upgrade <action> [flags]

List of actions supported:

    start
    status
    history

`;

const UPGRADE_START_OPTIONS = `
Help:

    'upgrade start' is a noobaa-cli command that will start config directory upgrade run.
    Run 'upgrade start' after upgrading NooBaa RPMs on all the cluster nodes, after starting an upgrade of the config directory,
    S3 I/O, S3 Buckets getters and NooBaa CLI Account/Buckets/Whitelist getters operations will still be working
    But updates of the config directory will be blocked during the upgrade of the config directory.
    'upgrade start' should be executed on one node, the config directory changes will be available for all the nodes of the cluster.

Usage:

    noobaa-cli upgrade start [flags]

Flags:

    --expected_version              <string>                            The expected target version of the upgrade
    --expected_hosts                <string>         (optional)         The expected hosts running NooBaa NC, a string of hosts separated by ,
    --skip_verification             <boolean>        (optional)         skip upgrade verification
                                                                        WARNING: can cause corrupted config dir files created by hosts running old code.
                                                                        this should generally not be used and is intended exclusively for NooBaa team support. 
    --custom_upgrade_scripts_dir    <string>         (optional)         a custom upgrade scripts dir, use for running custom config dir upgrade scripts.
                                                                        WARNING: can cause corrupted config directory. specifying a custom upgrade scripts directory
                                                                        will initiate a non NooBaa official config directory upgrade.
                                                                        this should generally not be used and is intended exclusively for NooBaa team support.
                                                                        requires a special code fix provided by NooBaa dev team and stored in the
                                                                        custom_upgrade_scripts_dir directory.

`;

const UPGRADE_STATUS_OPTIONS = `
Help:

    'upgrade status' is a noobaa-cli command that will return the status of an ongoing upgrade run,
    the available status information is upgrade start timestamp, from_version, to_version, config_dir_from_version,
    config_dir_to_version, running_host etc.

Usage:

    noobaa-cli upgrade status

`;

const UPGRADE_HISTORY_OPTIONS = `
Help:

    'upgrade history' is a noobaa-cli command that will return the history of past upgrades,
    the available history information is an array of upgrade information - upgrade start timestamp, from_version, to_version, config_dir_from_version,
    config_dir_to_version, running_host etc.

Usage:

    noobaa-cli upgrade history

`;


const CONNECTION_FLAGS_ADD = `
Help:

    Use this CLI to add a connection.

Usage:

    connection add [flags]

Flags:

    --name <string>                                                         Set the name for the connection
    --agent_request_object <object>                                         Value of agent request objects, used for http(s) connection, as defined by nodejs http(s) agent options
    --request_options_object <object>                                       Value of http(s) request option, as defined by nodejs http(s) request option. "auth" field would be encrypted.
    --notification_protocol <string>                                        One of http, https, kafka.
    --from_file <string>                                  (optional)        Use details from the JSON file, there is no need to mention all the properties individually in the CLI

`;

const CONNECTION_FLAGS_UPDATE = `
Help:

    Use this CLI to update a connection.

Usage:

    connection update [flags]

Flags:

    --name <string>                                                         The name of the connection to update.
    --key <string>                                                          Name of field to update
    --value <string>                                                        Value of the field to update
    --remove_key <string>                                                   Removes a key from the connection.
`;

const CONNECTION_FLAGS_DELETE = `
Help:

    Use this CLI to delete a connection.

Usage:

    connection delete [flags]

Flags:

    --name <string>                                                         The name of the connection to delete.

`;

const CONNECTION_FLAGS_STATUS = `
Help:

    Use this CLI to get connection status.

Usage:

    connection status [flags]

Flags:

    --name <string>                                                         The name of the connection.
    --decrypt <boolean>                                                     Wether to decrypt the auth field of the request.

`;

const CONNECTION_FLAGS_LIST = `
Help:

    Use this CLI to list connections.

Usage:

    connection list [flags]

Flags:

`;

/**
 * print_usage would print the help according to the arguments that were passed
 * @param {string} type
 * @param {string} action
 */
function print_usage(type, action) {
    switch (type) {
        case TYPES.ACCOUNT:
            print_help_account(action);
            break;
        case TYPES.BUCKET:
            print_help_bucket(action);
            break;
        case TYPES.IP_WHITELIST:
            process.stdout.write(WHITELIST_FLAGS.trimStart());
            break;
        case TYPES.LOGGING:
            process.stdout.write(LOGGING_FLAGS.trimStart() + CLI_MUTUAL_FLAGS);
            break;
        case TYPES.GLACIER:
            print_help_glacier(action);
            break;
        case TYPES.DIAGNOSE:
            print_help_diagnose(action);
            break;
        case TYPES.UPGRADE:
            print_help_upgrade(action);
            break;
        case TYPES.CONNECTION:
            print_help_connection(action);
            break;
        default:
            process.stdout.write(HELP + '\n');
            process.stdout.write(USAGE.trimStart() + '\n');
            process.stdout.write(ARGUMENTS.trimStart() + '\n');
    }
    process.exit(0);
}

/**
 * print_help_account would print the help options for account
 * @param {string} action
 */
function print_help_account(action) {
    switch (action) {
        case ACTIONS.ADD:
            process.stdout.write(ACCOUNT_FLAGS_ADD.trimStart() + CLI_MUTUAL_FLAGS);
            break;
        case ACTIONS.UPDATE:
            process.stdout.write(ACCOUNT_FLAGS_UPDATE.trimStart() + CLI_MUTUAL_FLAGS);
            break;
        case ACTIONS.DELETE:
            process.stdout.write(ACCOUNT_FLAGS_DELETE.trimStart() + CLI_MUTUAL_FLAGS);
            break;
        case ACTIONS.STATUS:
            process.stdout.write(ACCOUNT_FLAGS_STATUS.trimStart() + CLI_MUTUAL_FLAGS);
            break;
        case ACTIONS.LIST:
            process.stdout.write(ACCOUNT_FLAGS_LIST.trimStart() + CLI_MUTUAL_FLAGS);
            break;
        default:
            process.stdout.write(ACCOUNT_ACTIONS.trimStart());
    }
    process.exit(0);
}

/**
 * print_help_bucket would print the help options for bucket
 * @param {string} action
 */
function print_help_bucket(action) {
    switch (action) {
        case ACTIONS.ADD:
            process.stdout.write(BUCKET_FLAGS_ADD.trimStart() + CLI_MUTUAL_FLAGS);
            break;
        case ACTIONS.UPDATE:
            process.stdout.write(BUCKET_FLAGS_UPDATE.trimStart() + CLI_MUTUAL_FLAGS);
            break;
        case ACTIONS.DELETE:
            process.stdout.write(BUCKET_FLAGS_DELETE.trimStart() + CLI_MUTUAL_FLAGS);
            break;
        case ACTIONS.STATUS:
            process.stdout.write(BUCKET_FLAGS_STATUS.trimStart() + CLI_MUTUAL_FLAGS);
            break;
        case ACTIONS.LIST:
            process.stdout.write(BUCKET_FLAGS_LIST.trimStart() + CLI_MUTUAL_FLAGS);
            break;
        default:
            process.stdout.write(BUCKET_ACTIONS.trimStart());
    }
    process.exit(0);
}

/**
 * @param {string} action
 */
function print_help_glacier(action) {
    switch (action) {
        case GLACIER_ACTIONS.MIGRATE:
            process.stdout.write(GLACIER_MIGRATE_OPTIONS.trimStart());
            break;
        case GLACIER_ACTIONS.RESTORE:
            process.stdout.write(GLACIER_RESTORE_OPTIONS.trimStart());
            break;
        case GLACIER_ACTIONS.EXPIRY:
            process.stdout.write(GLACIER_EXPIRY_OPTIONS.trimStart());
            break;
        default:
            process.stdout.write(GLACIER_OPTIONS.trimStart());
    }
}

/**
 * @param {string} action
 */
function print_help_diagnose(action) {
    switch (action) {
        case DIAGNOSE_ACTIONS.HEALTH:
            process.stdout.write(DIAGNOSE_HEALTH_OPTIONS.trimStart());
            break;
        case DIAGNOSE_ACTIONS.GATHER_LOGS:
            process.stdout.write(DIAGNOSE_GATHER_LOGS_OPTIONS.trimStart());
            break;
        case DIAGNOSE_ACTIONS.METRICS:
            process.stdout.write(DIAGNOSE_METRICS_OPTIONS.trimStart());
            break;
        default:
            process.stdout.write(DIAGNOSE_OPTIONS.trimStart());
    }
}

/**
 * @param {string} action
 */
function print_help_upgrade(action) {
    switch (action) {
        case UPGRADE_ACTIONS.START:
            process.stdout.write(UPGRADE_START_OPTIONS.trimStart());
            break;
        case UPGRADE_ACTIONS.STATUS:
            process.stdout.write(UPGRADE_STATUS_OPTIONS.trimStart());
            break;
        case UPGRADE_ACTIONS.HISTORY:
            process.stdout.write(UPGRADE_HISTORY_OPTIONS.trimStart());
            break;
        default:
            process.stdout.write(UPGRADE_OPTIONS.trimStart());
    }
}

/**
 * print_help_connection would print the help options for connection
 * @param {string} action
 */
function print_help_connection(action) {
    switch (action) {
        case ACTIONS.ADD:
            process.stdout.write(CONNECTION_FLAGS_ADD.trimStart() + CLI_MUTUAL_FLAGS);
            break;
        case ACTIONS.UPDATE:
            process.stdout.write(CONNECTION_FLAGS_UPDATE.trimStart() + CLI_MUTUAL_FLAGS);
            break;
        case ACTIONS.DELETE:
            process.stdout.write(CONNECTION_FLAGS_DELETE.trimStart() + CLI_MUTUAL_FLAGS);
            break;
        case ACTIONS.STATUS:
            process.stdout.write(CONNECTION_FLAGS_STATUS.trimStart() + CLI_MUTUAL_FLAGS);
            break;
        case ACTIONS.LIST:
            process.stdout.write(CONNECTION_FLAGS_LIST.trimStart() + CLI_MUTUAL_FLAGS);
            break;
        default:
            process.stdout.write(CONNECTION_ACTIONS.trimStart());
    }
    process.exit(0);
}


// EXPORTS
exports.print_usage = print_usage;
