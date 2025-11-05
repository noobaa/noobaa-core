/* Copyright (C) 2024 NooBaa */
'use strict';

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
    LIST_ACCESS_KEYS: 'list_access_keys',
    TAG_USER: 'tag_user',
    UNTAG_USER: 'untag_user',
    LIST_USER_TAGS: 'list_user_tags',
    PUT_USER_POLICY: 'put_user_policy',
    GET_USER_POLICY: 'get_user_policy',
    DELETE_USER_POLICY: 'delete_user_policy',
    LIST_USER_POLICIES: 'list_user_policies',
});

// key: action - the function name on accountspace_fs (snake case style)
// value: AWS action name (camel case style)
// we use it for error message to match AWS style 
const ACTION_MESSAGE_TITLE_MAP = Object.freeze({
    'create_user': 'CreateUser',
    'get_user': 'GetUser',
    'delete_user': 'DeleteUser',
    'update_user': 'UpdateUser',
    'list_users': 'ListUsers',
    'create_access_key': 'CreateAccessKey',
    'get_access_key_last_used': 'GetAccessKeyLastUsed',
    'update_access_key': 'UpdateAccessKey',
    'delete_access_key': 'DeleteAccessKey',
    'list_access_keys': 'ListAccessKeys',
    'tag_user': 'TagUser',
    'untag_user': 'UntagUser',
    'list_user_tags': 'ListUserTags',
    'put_user_policy': 'PutUserPolicy',
    'get_user_policy': 'GetUserPolicy',
    'delete_user_policy': 'DeleteUserPolicy',
    'list_user_policies': 'ListUserPolicies',
});

const ACCESS_KEY_STATUS_ENUM = Object.freeze({
    ACTIVE: 'Active',
    INACTIVE: 'Inactive',
});

const IDENTITY_ENUM = Object.freeze({
    ROOT_ACCOUNT: 'ROOT_ACCOUNT',
    USER: 'USER',
});

// miscellaneous
const DEFAULT_MAX_ITEMS = 100;
const MAX_TAGS = 50;
const MAX_NUMBER_OF_ACCESS_KEYS = 2;
const IAM_DEFAULT_PATH = '/';
const AWS_NOT_USED = 'N/A'; // can be used in case the region or the service name were not used
const IAM_SERVICE_SMALL_LETTERS = 'iam';

// parameter names in camel case style
// we will use in the error messages
const IAM_PARAMETER_NAME = Object.freeze({
    IAM_PATH: 'Path',
    NEW_IAM_PATH: 'NewPath',
    IAM_PATH_PREFIX: 'PathPrefix',
    USERNAME: 'UserName',
    NEW_USERNAME: 'NewUserName',
    POLICY_NAME: 'PolicyName',
    POLICY_DOCUMENT: 'PolicyDocument',
});

const IAM_SPLIT_CHARACTERS = ':';

// EXPORTS
exports.IAM_ACTIONS = IAM_ACTIONS;
exports.ACTION_MESSAGE_TITLE_MAP = ACTION_MESSAGE_TITLE_MAP;
exports.ACCESS_KEY_STATUS_ENUM = ACCESS_KEY_STATUS_ENUM;
exports.IDENTITY_ENUM = IDENTITY_ENUM;
exports.DEFAULT_MAX_ITEMS = DEFAULT_MAX_ITEMS;
exports.MAX_TAGS = MAX_TAGS;
exports.MAX_NUMBER_OF_ACCESS_KEYS = MAX_NUMBER_OF_ACCESS_KEYS;
exports.IAM_DEFAULT_PATH = IAM_DEFAULT_PATH;
exports.AWS_NOT_USED = AWS_NOT_USED;
exports.IAM_SERVICE_SMALL_LETTERS = IAM_SERVICE_SMALL_LETTERS;
exports.IAM_PARAMETER_NAME = IAM_PARAMETER_NAME;
exports.IAM_SPLIT_CHARACTERS = IAM_SPLIT_CHARACTERS;
