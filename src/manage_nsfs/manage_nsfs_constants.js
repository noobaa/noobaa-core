/* Copyright (C) 2024 NooBaa */
'use strict';

const TYPES = {
    ACCOUNT: 'account',
    BUCKET: 'bucket',
    IP_WHITELIST: 'whitelist',
    GLACIER: 'glacier',
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

const GLOBAL_CONFIG_ROOT = 'config_root';
const GLOBAL_CONFIG_OPTIONS = new Set(['from_file', GLOBAL_CONFIG_ROOT, 'config_root_backend']);

const VALID_OPTIONS_ACCOUNT = {
    'add': new Set(['name', 'uid', 'gid', 'new_buckets_path', 'user', 'access_key', 'secret_key', 'fs_backend', ...GLOBAL_CONFIG_OPTIONS]),
    'update': new Set(['name', 'uid', 'gid', 'new_buckets_path', 'user', 'access_key', 'secret_key', 'fs_backend', 'new_name', 'regenerate', ...GLOBAL_CONFIG_OPTIONS]),
    'delete': new Set(['name', GLOBAL_CONFIG_ROOT]),
    'list': new Set(['wide', 'show_secrets', GLOBAL_CONFIG_ROOT, 'gid', 'uid', 'user', 'name', 'access_key']),
    'status': new Set(['name', 'access_key', 'show_secrets', GLOBAL_CONFIG_ROOT]),
};

const VALID_OPTIONS_BUCKET = {
    'add': new Set(['name', 'owner', 'path', 'bucket_policy', 'fs_backend', ...GLOBAL_CONFIG_OPTIONS]),
    'update': new Set(['name', 'owner', 'path', 'bucket_policy', 'fs_backend', 'new_name', ...GLOBAL_CONFIG_OPTIONS]),
    'delete': new Set(['name', GLOBAL_CONFIG_ROOT]),
    'list': new Set(['wide', 'name', GLOBAL_CONFIG_ROOT]),
    'status': new Set(['name', GLOBAL_CONFIG_ROOT]),
};

const VALID_OPTIONS_GLACIER = {
    'migrate': new Set([ GLOBAL_CONFIG_ROOT]),
    'restore': new Set([ GLOBAL_CONFIG_ROOT]),
    'expiry': new Set([ GLOBAL_CONFIG_ROOT]),
};

const VALID_OPTIONS_WHITELIST = new Set(['ips', GLOBAL_CONFIG_ROOT]);

const VALID_OPTIONS = {
    account_options: VALID_OPTIONS_ACCOUNT,
    bucket_options: VALID_OPTIONS_BUCKET,
    glacier_options: VALID_OPTIONS_GLACIER,
    whitelist_options: VALID_OPTIONS_WHITELIST,
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
};

const LIST_ACCOUNT_FILTERS = ['uid', 'gid', 'user', 'name', 'access_key'];
const LIST_BUCKET_FILTERS = ['name'];

// EXPORTS
exports.TYPES = TYPES;
exports.ACTIONS = ACTIONS;
exports.GLACIER_ACTIONS = GLACIER_ACTIONS;
exports.VALID_OPTIONS = VALID_OPTIONS;
exports.OPTION_TYPE = OPTION_TYPE;

exports.LIST_ACCOUNT_FILTERS = LIST_ACCOUNT_FILTERS;
exports.LIST_BUCKET_FILTERS = LIST_BUCKET_FILTERS;
