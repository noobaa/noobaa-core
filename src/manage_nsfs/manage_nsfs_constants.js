/* Copyright (C) 2024 NooBaa */
'use strict';

const TYPES = {
    ACCOUNT: 'account',
    BUCKET: 'bucket',
    IP_WHITELIST: 'whitelist',
    GLACIER: 'glacier',
    LOGGING: 'logging',
    DIAGNOSE: 'diagnose'
};

const ACTIONS = {
    ADD: 'add',
    UPDATE: 'update',
    DELETE: 'delete',
    LIST: 'list',
    STATUS: 'status'
};

const GLACIER_ACTIONS = {
    MIGRATE: 'migrate',
    RESTORE: 'restore',
    EXPIRY: 'expiry',
};

const DIAGNOSE_ACTIONS = {
    HEALTH: 'health',
    GATHER_LOGS: 'gather-logs',
    METRICS: 'metrics'
};

const CONFIG_SUBDIRS = {
    ACCOUNTS: 'accounts',
    ROOT_ACCOUNTS: 'root_accounts',
    BUCKETS: 'buckets',
    ACCESS_KEYS: 'access_keys'
};

const GLOBAL_CONFIG_ROOT = 'config_root';
const GLOBAL_CONFIG_OPTIONS = new Set([GLOBAL_CONFIG_ROOT, 'config_root_backend', 'debug']);
const FROM_FILE = 'from_file';
const ANONYMOUS = 'anonymous';

const VALID_OPTIONS_ACCOUNT = {
    'add': new Set(['name', 'iam_name', 'uid', 'gid', 'new_buckets_path', 'user', 'access_key', 'secret_key', 'fs_backend', 'allow_bucket_creation', 'force_md5_etag', 'iam_operate_on_root_account', FROM_FILE, ...GLOBAL_CONFIG_OPTIONS]),
    'update': new Set(['name', 'iam_name', 'uid', 'gid', 'new_buckets_path', 'user', 'access_key', 'secret_key', 'fs_backend', 'allow_bucket_creation', 'force_md5_etag', 'iam_operate_on_root_account', 'new_name', 'regenerate', ...GLOBAL_CONFIG_OPTIONS]),
    'delete': new Set(['name', 'iam_name', ...GLOBAL_CONFIG_OPTIONS]),
    'list': new Set(['wide', 'show_secrets', 'gid', 'uid', 'user', 'name', 'access_key', ...GLOBAL_CONFIG_OPTIONS]),
    'status': new Set(['name', 'iam_name', 'access_key', 'show_secrets', ...GLOBAL_CONFIG_OPTIONS]),
};

const VALID_OPTIONS_ANONYMOUS_ACCOUNT = {
    'add': new Set(['uid', 'gid', 'user', 'anonymous', GLOBAL_CONFIG_ROOT]),
    'update': new Set(['uid', 'gid', 'user', 'anonymous', GLOBAL_CONFIG_ROOT]),
    'delete': new Set(['anonymous', GLOBAL_CONFIG_ROOT]),
    'status': new Set(['anonymous', GLOBAL_CONFIG_ROOT]),
};

const VALID_OPTIONS_BUCKET = {
    'add': new Set(['name', 'owner', 'path', 'bucket_policy', 'fs_backend', 'force_md5_etag', FROM_FILE, ...GLOBAL_CONFIG_OPTIONS]),
    'update': new Set(['name', 'owner', 'path', 'bucket_policy', 'fs_backend', 'new_name', 'force_md5_etag', ...GLOBAL_CONFIG_OPTIONS]),
    'delete': new Set(['name', 'force', ...GLOBAL_CONFIG_OPTIONS]),
    'list': new Set(['wide', 'name', ...GLOBAL_CONFIG_OPTIONS]),
    'status': new Set(['name', ...GLOBAL_CONFIG_OPTIONS]),
};

const VALID_OPTIONS_GLACIER = {
    'migrate': new Set([ GLOBAL_CONFIG_ROOT]),
    'restore': new Set([ GLOBAL_CONFIG_ROOT]),
    'expiry': new Set([ GLOBAL_CONFIG_ROOT]),
};

const VALID_OPTIONS_DIAGNOSE = {
    'health': new Set([ 'https_port', 'deployment_type', 'all_account_details', 'all_bucket_details', ...GLOBAL_CONFIG_OPTIONS]),
    'gather-logs': new Set([ GLOBAL_CONFIG_ROOT]),
    'metrics': new Set([GLOBAL_CONFIG_ROOT])
};


const VALID_OPTIONS_WHITELIST = new Set(['ips', ...GLOBAL_CONFIG_OPTIONS]);

const VALID_OPTIONS_FROM_FILE = new Set(['from_file', ...GLOBAL_CONFIG_OPTIONS]);

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
    iam_name: 'string',
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
exports.CONFIG_SUBDIRS = CONFIG_SUBDIRS;
exports.VALID_OPTIONS = VALID_OPTIONS;
exports.OPTION_TYPE = OPTION_TYPE;
exports.FROM_FILE = FROM_FILE;
exports.BOOLEAN_STRING_VALUES = BOOLEAN_STRING_VALUES;
exports.BOOLEAN_STRING_OPTIONS = BOOLEAN_STRING_OPTIONS;
exports.LIST_UNSETABLE_OPTIONS = LIST_UNSETABLE_OPTIONS;

exports.LIST_ACCOUNT_FILTERS = LIST_ACCOUNT_FILTERS;
exports.LIST_BUCKET_FILTERS = LIST_BUCKET_FILTERS;
exports.ANONYMOUS = ANONYMOUS;
