/* Copyright (C) 2024 NooBaa */
'use strict';

const TYPES = Object.freeze({
    ACCOUNT: 'account',
    BUCKET: 'bucket',
    IP_WHITELIST: 'whitelist',
    GLACIER: 'glacier',
    LOGGING: 'logging',
    DIAGNOSE: 'diagnose',
    UPGRADE: 'upgrade',
    NOTIFICATION: 'notification'
});

const ACTIONS = Object.freeze({
    ADD: 'add',
    UPDATE: 'update',
    DELETE: 'delete',
    LIST: 'list',
    STATUS: 'status'
});

const GLACIER_ACTIONS = Object.freeze({
    MIGRATE: 'migrate',
    RESTORE: 'restore',
    EXPIRY: 'expiry',
});

const DIAGNOSE_ACTIONS = Object.freeze({
    HEALTH: 'health',
    GATHER_LOGS: 'gather-logs',
    METRICS: 'metrics'
});

const UPGRADE_ACTIONS = Object.freeze({
    START: 'start',
    STATUS: 'status',
    HISTORY: 'history'
});

const CONFIG_ROOT_FLAG = 'config_root';
const CLI_MUTUAL_OPTIONS = new Set([CONFIG_ROOT_FLAG, 'config_root_backend', 'debug']);
const FROM_FILE = 'from_file';
const ANONYMOUS = 'anonymous';

const VALID_OPTIONS_ACCOUNT = {
    'add': new Set(['name', 'uid', 'gid', 'new_buckets_path', 'user', 'access_key', 'secret_key', 'fs_backend', 'allow_bucket_creation', 'force_md5_etag', 'iam_operate_on_root_account', FROM_FILE, ...CLI_MUTUAL_OPTIONS]),
    'update': new Set(['name', 'uid', 'gid', 'new_buckets_path', 'user', 'access_key', 'secret_key', 'fs_backend', 'allow_bucket_creation', 'force_md5_etag', 'iam_operate_on_root_account', 'new_name', 'regenerate', ...CLI_MUTUAL_OPTIONS]),
    'delete': new Set(['name', ...CLI_MUTUAL_OPTIONS]),
    'list': new Set(['wide', 'show_secrets', 'gid', 'uid', 'user', 'name', 'access_key', ...CLI_MUTUAL_OPTIONS]),
    'status': new Set(['name', 'access_key', 'show_secrets', ...CLI_MUTUAL_OPTIONS]),
};

const VALID_OPTIONS_ANONYMOUS_ACCOUNT = {
    'add': new Set(['uid', 'gid', 'user', 'anonymous', ...CLI_MUTUAL_OPTIONS]),
    'update': new Set(['uid', 'gid', 'user', 'anonymous', ...CLI_MUTUAL_OPTIONS]),
    'delete': new Set(['anonymous', ...CLI_MUTUAL_OPTIONS]),
    'status': new Set(['anonymous', ...CLI_MUTUAL_OPTIONS]),
};

const VALID_OPTIONS_BUCKET = {
    'add': new Set(['name', 'owner', 'path', 'bucket_policy', 'fs_backend', 'force_md5_etag', 'notifications', FROM_FILE, ...CLI_MUTUAL_OPTIONS]),
    'update': new Set(['name', 'owner', 'path', 'bucket_policy', 'fs_backend', 'new_name', 'force_md5_etag', 'notifications', ...CLI_MUTUAL_OPTIONS]),
    'delete': new Set(['name', 'force', ...CLI_MUTUAL_OPTIONS]),
    'list': new Set(['wide', 'name', ...CLI_MUTUAL_OPTIONS]),
    'status': new Set(['name', ...CLI_MUTUAL_OPTIONS]),
};

const VALID_OPTIONS_GLACIER = {
    'migrate': new Set([ CONFIG_ROOT_FLAG]),
    'restore': new Set([ CONFIG_ROOT_FLAG]),
    'expiry': new Set([ CONFIG_ROOT_FLAG]),
};

const VALID_OPTIONS_DIAGNOSE = {
    'health': new Set([ 'https_port', 'deployment_type', 'all_account_details', 'all_bucket_details', ...CLI_MUTUAL_OPTIONS]),
    'gather-logs': new Set([ CONFIG_ROOT_FLAG]),
    'metrics': new Set([CONFIG_ROOT_FLAG])
};


const VALID_OPTIONS_WHITELIST = new Set(['ips', ...CLI_MUTUAL_OPTIONS]);

const VALID_OPTIONS_FROM_FILE = new Set(['from_file', ...CLI_MUTUAL_OPTIONS]);

const VALID_OPTIONS = {
    account_options: VALID_OPTIONS_ACCOUNT,
    bucket_options: VALID_OPTIONS_BUCKET,
    glacier_options: VALID_OPTIONS_GLACIER,
    whitelist_options: VALID_OPTIONS_WHITELIST,
    from_file_options: VALID_OPTIONS_FROM_FILE,
    anonymous_account_options: VALID_OPTIONS_ANONYMOUS_ACCOUNT,
    diagnose_options: VALID_OPTIONS_DIAGNOSE
};

const OPTION_TYPE = {
    name: 'string',
    owner: 'string',
    uid: 'number',
    gid: 'number',
    new_buckets_path: 'string',
    user: 'string',
    access_key: 'string',
    secret_key: 'string',
    fs_backend: 'string',
    allow_bucket_creation: 'boolean',
    force_md5_etag: 'boolean',
    iam_operate_on_root_account: 'boolean',
    config_root: 'string',
    from_file: 'string',
    config_root_backend: 'string',
    path: 'string',
    bucket_policy: 'string',
    new_name: 'string',
    regenerate: 'boolean',
    wide: 'boolean',
    show_secrets: 'boolean',
    ips: 'string',
    force: 'boolean',
    anonymous: 'boolean',
    // health options
    deployment_type: 'string',
    all_account_details: 'boolean',
    all_bucket_details: 'boolean',
    https_port: 'number',
    debug: 'number',
    notifications: 'string'
};

const BOOLEAN_STRING_VALUES = ['true', 'false'];
const BOOLEAN_STRING_OPTIONS = new Set(['allow_bucket_creation', 'regenerate', 'wide', 'show_secrets', 'force',
    'force_md5_etag', 'iam_operate_on_root_account', 'all_account_details', 'all_bucket_details', 'anonymous']);

//options that can be unset using ''
const LIST_UNSETABLE_OPTIONS = ['fs_backend', 's3_policy', 'force_md5_etag'];

const LIST_ACCOUNT_FILTERS = ['uid', 'gid', 'user', 'name', 'access_key'];
const LIST_BUCKET_FILTERS = ['name'];

// EXPORTS
exports.TYPES = TYPES;
exports.ACTIONS = ACTIONS;
exports.GLACIER_ACTIONS = GLACIER_ACTIONS;
exports.DIAGNOSE_ACTIONS = DIAGNOSE_ACTIONS;
exports.UPGRADE_ACTIONS = UPGRADE_ACTIONS;
exports.VALID_OPTIONS = VALID_OPTIONS;
exports.OPTION_TYPE = OPTION_TYPE;
exports.FROM_FILE = FROM_FILE;
exports.BOOLEAN_STRING_VALUES = BOOLEAN_STRING_VALUES;
exports.BOOLEAN_STRING_OPTIONS = BOOLEAN_STRING_OPTIONS;
exports.LIST_UNSETABLE_OPTIONS = LIST_UNSETABLE_OPTIONS;

exports.LIST_ACCOUNT_FILTERS = LIST_ACCOUNT_FILTERS;
exports.LIST_BUCKET_FILTERS = LIST_BUCKET_FILTERS;
exports.ANONYMOUS = ANONYMOUS;
