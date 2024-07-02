/* Copyright (C) 2024 NooBaa */
'use strict';
// TODO - move more constants here (mainly from iam_utils)
const DEFAULT_MAX_ITEMS = 100;

// TODO - reuse
// function name in snake case style
const IAM_ACTIONS = Object.freeze({
    CREATE_USER: 'create_user',
    GET_USER: 'get_user',
    DELETE_USER: 'delete_user',
    UPDATE_USER: 'update_user',
    LIST_USERS: 'list_users',
    CREATE_ACCESS_KEY: 'create_access_key',
    GET_ACCESS_KEY_LAST_USED: 'get_access_key_last_used',
    UPDATE_ACCESS_KEY: 'update_access_key',
    DELETE_ACCESS_KEY: 'delete_access_key',
    LIST_ACCESS_KEYS: 'list_access_keys'
});


// parameter names
const IAM_PATH = 'Path';
const NEW_IAM_PATH = 'NewPath';
const IAM_PATH_PREFIX = 'PathPrefix';
const USERNAME = 'UserName';
const NEW_USERNAME = 'NewUserName';


// EXPORTS
exports.IAM_ACTIONS = IAM_ACTIONS;
exports.DEFAULT_MAX_ITEMS = DEFAULT_MAX_ITEMS;
exports.IAM_PATH = IAM_PATH;
exports.NEW_IAM_PATH = NEW_IAM_PATH;
exports.IAM_PATH_PREFIX = IAM_PATH_PREFIX;
exports.USERNAME = USERNAME;
exports.NEW_USERNAME = NEW_USERNAME;
