/* Copyright (C) 2024 NooBaa */
'use strict';

const path = require('path');
const config = require('../../config');
const dbg = require('../util/debug_module')(__filename);
const native_fs_utils = require('../util/native_fs_utils');
const { CONFIG_SUBDIRS } = require('../manage_nsfs/manage_nsfs_constants');
const { create_arn, AWS_DEFAULT_PATH } = require('../endpoint/iam/iam_utils');

const access_key_status_enum = {
    ACTIVE: 'Active',
    INACTIVE: 'Inactive',
};

////////////////////
// MOCK VARIABLES //
////////////////////
/* mock variables (until we implement the actual code), based on the example in AWS IAM API docs*/

// account_id should be taken from the root user (account._id in the config file);
const dummy_account_id = '12345678012'; // for the example
// user_id should be taken from config file of the new created user user (account._id in the config file);
const dummy_user_id = '12345678013'; // for the example
// user should be from the the config file and the details (this for the example)
const dummy_path = '/division_abc/subdivision_xyz/';
const dummy_username1 = 'Bob';
const dummy_username2 = 'Robert';
const dummy_username_requester = 'Alice';
const dummy_user1 = {
    username: dummy_username1,
    user_id: dummy_user_id,
    path: dummy_path,
};
const dummy_user2 = {
    username: dummy_username2,
    user_id: dummy_user_id + 4,
    path: dummy_path,
};
// the requester at current implementation is the root user (this is for the example)
const dummy_requester = {
    username: dummy_username_requester,
    user_id: dummy_account_id,
    path: AWS_DEFAULT_PATH,
};
const MS_PER_MINUTE = 60 * 1000;
const dummy_access_key1 = {
    username: dummy_username1,
    access_key: 'AKIAIOSFODNN7EXAMPLE',
    status: access_key_status_enum.ACTIVE,
    secret_key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYzEXAMPLE',
};
const dummy_access_key2 = {
    username: dummy_username2,
    access_key: 'CMCTDRBIDNN9EXAMPLE',
    status: access_key_status_enum.ACTIVE,
    secret_key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYzEXAMPLE',
};
const dummy_requester_access_key = {
    username: dummy_username_requester,
    access_key: 'BLYDNFMRUCIS8EXAMPLE',
    status: access_key_status_enum.ACTIVE,
    secret_key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYzEXAMPLE',
};
const dummy_region = 'us-west-2';
const dummy_service_name = 's3';

/**
 * @implements {nb.AccountSpace}
 */
class AccountSpaceFS {
    /**
     * @param {{
     *      config_root?: string;
     *      fs_root?: string;
     *      fs_backend?: string;
     *      stats?: import('./endpoint_stats_collector').EndpointStatsCollector;
     * }} params
     */
    constructor({ config_root, fs_root, fs_backend, stats }) {
        this.config_root = config_root;
        this.accounts_dir = path.join(config_root, CONFIG_SUBDIRS.ACCOUNTS);
        this.access_keys_dir = path.join(config_root, CONFIG_SUBDIRS.ACCESS_KEYS);
        this.buckets_dir = path.join(config_root, CONFIG_SUBDIRS.BUCKETS);
        this.fs_context = native_fs_utils.get_process_fs_context();

        // Currently we do not use these properties
        this.fs_root = fs_root ?? '';
        this.fs_backend = fs_backend ?? config.NSFS_NC_CONFIG_DIR_BACKEND;
        this.stats = stats;
    }

    ////////////
    // USER   //
    ////////////

    async create_user(params, account_sdk) {
        dbg.log1('create_user', params);
        return {
            path: params.path || AWS_DEFAULT_PATH,
            username: params.username,
            user_id: dummy_user1.user_id,
            arn: create_arn(dummy_account_id, params.username, params.path),
            create_date: new Date(),
        };
    }

    async get_user(params, account_sdk) {
        dbg.log1('get_user', params);
        const { dummy_user } = get_user_details(params.username);
        return {
            user_id: dummy_user.user_id,
            path: dummy_user.path || AWS_DEFAULT_PATH,
            username: dummy_user.username,
            arn: create_arn(dummy_account_id, dummy_user.username, dummy_user.path),
            create_date: new Date(Date.now() - 30 * MS_PER_MINUTE),
            password_last_used: new Date(Date.now() - MS_PER_MINUTE),
        };
    }

    async update_user(params, account_sdk) {
        dbg.log1('update_user', params);
        const path_friendly = params.new_path ? params.new_path : dummy_user1.path;
        const username = params.new_username ? params.new_username : params.username;
        return {
            path: path_friendly || AWS_DEFAULT_PATH,
            username: username,
            user_id: dummy_user1.user_id,
            arn: create_arn(dummy_account_id, username, path_friendly),
        };
    }

    async delete_user(params, account_sdk) {
        dbg.log1('delete_user', params);
        // nothing to do at this point
    }

    async list_users(params, account_sdk) {
        dbg.log1('list_users', params);
        const is_truncated = false;
        // path_prefix is not supported in the example
        const members = [{
                user_id: dummy_user1.user_id,
                path: dummy_user1.path || AWS_DEFAULT_PATH,
                username: dummy_user1.username,
                arn: create_arn(dummy_account_id, dummy_user1.username, dummy_user1.path),
                create_date: new Date(Date.now() - 30 * MS_PER_MINUTE),
                password_last_used: new Date(Date.now() - MS_PER_MINUTE),
            },
            {
                user_id: dummy_user2.user_id,
                path: dummy_user2.path || AWS_DEFAULT_PATH,
                username: dummy_user2.username,
                arn: create_arn(dummy_account_id, dummy_user2.username, dummy_user1.path),
                create_date: new Date(Date.now() - 30 * MS_PER_MINUTE),
                password_last_used: new Date(Date.now() - MS_PER_MINUTE),
            }
        ];
        // members should be sorted by username (a to z)
        return { members, is_truncated };
    }

    ////////////////
    // ACCESS KEY //
    ////////////////

    async create_access_key(params, account_sdk) {
        const { dummy_access_key } = get_user_details(params.username);
        dbg.log1('create_access_key', params);
        return {
            username: dummy_access_key.username,
            access_key: dummy_access_key.access_key,
            status: dummy_access_key.status,
            secret_key: dummy_access_key.secret_key,
            create_date: new Date(),
        };
    }

    async get_access_key_last_used(params, account_sdk) {
        dbg.log1('get_access_key_last_used', params);
        return {
            region: dummy_region,
            last_used_date: new Date(Date.now() - 30 * MS_PER_MINUTE),
            service_name: dummy_service_name,
            username: dummy_user1.username,
        };
    }

    async update_access_key(params, account_sdk) {
        dbg.log1('update_access_key', params);
        // nothing to do at this point
    }

    async delete_access_key(params, account_sdk) {
        dbg.log1('delete_access_key', params);
        // nothing to do at this point
    }

    async list_access_keys(params, account_sdk) {
        dbg.log1('list_access_keys', params);
        const is_truncated = false;
        const { dummy_user } = get_user_details(params.username);
        const username = dummy_user.username;
        // path_prefix is not supported in the example
        const members = [{
                username: dummy_access_key1.username,
                access_key: dummy_access_key1.access_key,
                status: dummy_access_key1.status,
                create_date: new Date(Date.now() - 30 * MS_PER_MINUTE),
            },
            {
                username: dummy_access_key2.username,
                access_key: dummy_access_key2.access_key,
                status: dummy_access_key2.status,
                create_date: new Date(Date.now() - 30 * MS_PER_MINUTE),
            },
        ];
        return { members, is_truncated, username };
    }
}

//////////////////////
// HELPER FUNCTIONS //
//////////////////////

/**
 * get_user_details will return the relevant details of the user since username is not required in some requests
 * (If it is not included, it defaults to the user making the request).
 * If the username is passed in the request than it is this user
 * else (undefined) is is the requester
 * @param {string|undefined} username
 */
function get_user_details(username) {
    const res = {
        dummy_user: dummy_requester,
        dummy_access_key: dummy_requester_access_key,
    };
    const is_user_request = Boolean(username); // can be user request or root user request
    if (is_user_request) {
        res.dummy_user = dummy_user1;
        res.dummy_access_key = dummy_access_key1;
    }
    return res;
}

// EXPORTS
module.exports = AccountSpaceFS;
