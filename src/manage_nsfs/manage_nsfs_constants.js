/* Copyright (C) 2024 NooBaa */
'use strict';

const TYPES = {
    ACCOUNT: 'account',
    BUCKET: 'bucket',
    IP_WHITELIST: 'whitelist'
};

const ACTIONS = {
    ADD: 'add',
    UPDATE: 'update',
    DELETE: 'delete',
    LIST: 'list',
    STATUS: 'status'
};

const GLOBAL_CONFIG_ROOT = 'config_root';
const GLOBAL_CONFIG_OPTIONS = new Set(['from_file', GLOBAL_CONFIG_ROOT, 'config_root_backend']);

const VALID_OPTIONS_ACCOUNT = {
    'add': new Set(['name', 'email', 'uid', 'gid', 'new_buckets_path', 'user', 'access_key', 'secret_key', 'fs_backend', ...GLOBAL_CONFIG_OPTIONS]),
    'update': new Set(['name', 'email', 'uid', 'gid', 'new_buckets_path', 'user', 'access_key', 'secret_key', 'fs_backend', 'new_name', 'regenerate', ...GLOBAL_CONFIG_OPTIONS]),
    'delete': new Set(['name', 'access_key', GLOBAL_CONFIG_ROOT]),
    'list': new Set(['wide', 'show_secrets', GLOBAL_CONFIG_ROOT, 'gid', 'uid', 'user']),
    'status': new Set(['name', 'access_key', 'show_secrets', GLOBAL_CONFIG_ROOT]),
};

const VALID_OPTIONS_BUCKET = {
    'add': new Set(['name', 'email', 'path', 'bucket_policy', 'fs_backend', ...GLOBAL_CONFIG_OPTIONS]),
    'update': new Set(['name', 'email', 'path', 'bucket_policy', 'fs_backend', 'new_name', ...GLOBAL_CONFIG_OPTIONS]),
    'delete': new Set(['name', GLOBAL_CONFIG_ROOT]),
    'list': new Set(['wide', GLOBAL_CONFIG_ROOT]),
    'status': new Set(['name', GLOBAL_CONFIG_ROOT]),
};

const VALID_OPTIONS_WHITELIST = new Set(['ips', GLOBAL_CONFIG_ROOT]);

const VALID_OPTIONS = {
    account_options: VALID_OPTIONS_ACCOUNT,
    bucket_options: VALID_OPTIONS_BUCKET,
    whitelist_options: VALID_OPTIONS_WHITELIST,
};

// EXPORTS
exports.TYPES = TYPES;
exports.ACTIONS = ACTIONS;
exports.VALID_OPTIONS = VALID_OPTIONS;
