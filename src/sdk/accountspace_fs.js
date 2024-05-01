/* Copyright (C) 2024 NooBaa */
'use strict';

const _ = require('lodash');
const path = require('path');
const config = require('../../config');
const dbg = require('../util/debug_module')(__filename);
const P = require('../util/promise');
const nb_native = require('../util/nb_native');
const native_fs_utils = require('../util/native_fs_utils');
const { CONFIG_SUBDIRS } = require('../manage_nsfs/manage_nsfs_constants');
const { create_arn, IAM_DEFAULT_PATH, get_action_message_title,
    check_iam_path_was_set } = require('../endpoint/iam/iam_utils');
const { generate_id } = require('../manage_nsfs/manage_nsfs_cli_utils');
const nsfs_schema_utils = require('../manage_nsfs/nsfs_schema_utils');
const IamError = require('../endpoint/iam/iam_errors').IamError;

const access_key_status_enum = {
    ACTIVE: 'Active',
    INACTIVE: 'Inactive',
};

const entity_enum = {
    USER: 'USER',
    ACCESS_KEY: 'ACCESS_KEY',
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
const dummy_iam_path = '/division_abc/subdivision_xyz/';
const dummy_username1 = 'Bob';
const dummy_username2 = 'Robert';
const dummy_username_requester = 'Alice';
const dummy_user1 = {
    username: dummy_username1,
    user_id: dummy_user_id,
    iam_path: dummy_iam_path,
};
// the requester at current implementation is the root user (this is for the example)
const dummy_requester = {
    username: dummy_username_requester,
    user_id: dummy_account_id,
    iam_path: IAM_DEFAULT_PATH,
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

    // 1 - check that the requesting account is a root user account
    // 2 - check if username already exists
    //     GAP - it should be only under the root account in the future
    // 3 - copy the data from the root account user details to a new config file
    async create_user(params, account_sdk) {
        const action = 'create_user';
        dbg.log1(`AccountSpaceFS.${action}`, params, account_sdk);
        try {
            const requesting_account = account_sdk.requesting_account;
            this._check_if_requesting_account_is_root_account(action, requesting_account,
                { username: params.username, iam_path: params.iam_path });
            await this._check_username_already_exists(action, params.username);
            const created_account = await this._copy_data_from_requesting_account_to_account_config(action, requesting_account, params);
            return {
                iam_path: created_account.iam_path || IAM_DEFAULT_PATH,
                username: created_account.name,
                user_id: created_account._id,
                arn: create_arn(requesting_account._id, created_account.name, created_account.iam_path),
                create_date: created_account.creation_date,
            };
        } catch (err) {
            dbg.error(`AccountSpaceFS.${action} error`, err);
            throw this._translate_error_codes(err, entity_enum.USER);
        }
    }

    // 1 - check that the requesting account is a root user account
    // 2 - check that the user account config file exists
    // 3 - read the account config file
    // 4 - check that the user to get is not a root account
    // 5 - check that the user account to get is owned by the root account
    async get_user(params, account_sdk) {
        const action = 'get_user';
        dbg.log1(`AccountSpaceFS.${action}`, params, account_sdk);
        try {
            const requesting_account = account_sdk.requesting_account;
            // GAP - we do not have the user iam_path at this point (error message)
            this._check_if_requesting_account_is_root_account(action, requesting_account,
                { username: params.username });
            const account_config_path = this._get_account_config_path(params.username);
            await this._check_if_account_config_file_exists(action, params.username, account_config_path);
            const account_to_get = await native_fs_utils.read_file(this.fs_context, account_config_path);
            this._check_if_requested_account_is_root_account(action, requesting_account, account_to_get, params);
            this._check_if_user_is_owned_by_root_account(action, requesting_account, account_to_get);
            return {
                user_id: account_to_get._id,
                iam_path: account_to_get.iam_path || IAM_DEFAULT_PATH,
                username: account_to_get.name,
                arn: create_arn(requesting_account._id, account_to_get.name, account_to_get.iam_path),
                create_date: account_to_get.creation_date,
                password_last_used: account_to_get.creation_date, // GAP
            };
        } catch (err) {
            dbg.error(`AccountSpaceFS.${action} error`, err);
            throw this._translate_error_codes(err, entity_enum.USER);
        }
    }

    // 1 - check that the requesting account is a root user account
    // 2 - check that the user account config file exists
    // 3 - read the account config file
    // 4 - check that the user to update is not a root account
    // 5 - check that the user account to get is owned by the root account
    // 6 - check if username was updated
    //   6.1 - check if username already exists (global scope - all config files names)
    //   6.2 - create the new config file (with the new name same data) and delete the the existing config file
    // 7 - (else not an update of username) update the config file
    async update_user(params, account_sdk) {
        const action = 'update_user';
        try {
            dbg.log1(`AccountSpaceFS.${action}`, params, account_sdk);
            const requesting_account = account_sdk.requesting_account;
            // GAP - we do not have the user iam_path at this point (error message)
            this._check_if_requesting_account_is_root_account(action, requesting_account,
                { username: params.username});
            const account_config_path = this._get_account_config_path(params.username);
            await this._check_if_account_config_file_exists(action, params.username, account_config_path);
            const account_to_update = await native_fs_utils.read_file(this.fs_context, account_config_path);
            this._check_if_requested_account_is_root_account(action, requesting_account, account_to_update, params);
            this._check_if_user_is_owned_by_root_account(action, requesting_account, account_to_update);
            const is_username_update = !_.isUndefined(params.new_username) &&
                params.new_username !== params.username;
            if (!_.isUndefined(params.new_iam_path)) account_to_update.iam_path = params.new_iam_path;
            if (is_username_update) {
                dbg.log1(`AccountSpaceFS.${action} username was updated, is_username_update`,
                    is_username_update);
                await this._update_account_config_new_username(action, params, account_to_update);
            } else {
                const account_to_update_string = JSON.stringify(account_to_update);
                nsfs_schema_utils.validate_account_schema(JSON.parse(account_to_update_string));
                await native_fs_utils.update_config_file(this.fs_context, this.accounts_dir,
                    account_config_path, account_to_update_string);
            }
            return {
                iam_path: account_to_update.iam_path || IAM_DEFAULT_PATH,
                username: account_to_update.name,
                user_id: account_to_update._id,
                arn: create_arn(requesting_account._id, account_to_update.name, account_to_update.iam_path),
            };
        } catch (err) {
            dbg.error(`AccountSpaceFS.${action} error`, err);
            throw this._translate_error_codes(err, entity_enum.USER);
        }
    }

    // 1 - check that the requesting account is a root user account
    // 2 - check that the user account config file exists
    // 3 - read the account config file
    // 4 - check that the deleted user is not a root account
    // 5 - check that the deleted user is owned by the root account
    // 6 - check if the user doesn’t have resources related to it (in IAM users only access keys)
    //     note: buckets are owned by the root account
    // 7 - delete the account config file
    async delete_user(params, account_sdk) {
        const action = 'delete_user';
        dbg.log1(`AccountSpaceFS.${action}`, params, account_sdk);
        try {
            const requesting_account = account_sdk.requesting_account;
            // GAP - we do not have the user iam_path at this point (error message)
            this._check_if_requesting_account_is_root_account(action, requesting_account,
                { username: params.username });
            const account_config_path = this._get_account_config_path(params.username);
            await this._check_if_account_config_file_exists(action, params.username, account_config_path);
            const account_to_delete = await native_fs_utils.read_file(this.fs_context, account_config_path);
            this._check_if_requested_account_is_root_account(action, requesting_account, account_to_delete, params);
            this._check_if_user_is_owned_by_root_account(action, requesting_account, account_to_delete);
            this._check_if_user_does_not_have_access_keys_before_deletion(action, account_to_delete);
            await native_fs_utils.delete_config_file(this.fs_context, this.accounts_dir, account_config_path);
        } catch (err) {
            dbg.error(`AccountSpaceFS.${action} error`, err);
            throw this._translate_error_codes(err, entity_enum.USER);
        }
    }

    // 1 - check that the requesting account is a root user account
    // 2 - list the config files that are owned by the root user account
    //   2.1 - if the request has path_prefix check if the user’s path starts with this path
    // 3- sort the members by username (a to z)
    async list_users(params, account_sdk) {
        const action = 'list_users';
        dbg.log1(`AccountSpaceFS.${action}`, params, account_sdk);
        try {
        const requesting_account = account_sdk.requesting_account;
        this._check_if_requesting_account_is_root_account(action, requesting_account, { });
        const is_truncated = false; // GAP - no pagination at this point
        let members = await this._list_config_files_for_users(requesting_account, params.iam_path_prefix);
        members = members.sort((a, b) => a.username.localeCompare(b.username));
        return { members, is_truncated };
        } catch (err) {
            dbg.error(`AccountSpaceFS.${action} error`, err);
            throw this._translate_error_codes(err, entity_enum.USER);
        }
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
        // iam_path_prefix is not supported in the example
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

    ////////////////////////
    // INTERNAL FUNCTIONS //
    ////////////////////////

     _get_account_config_path(name) {
         return path.join(this.accounts_dir, name + '.json');
     }

     _get_access_keys_config_path(access_key) {
         return path.join(this.access_keys_dir, access_key + '.symlink');
     }

     _new_user_defaults(requesting_account, params) {
        const distinguished_name = requesting_account.nsfs_account_config.distinguished_name;
        return {
            _id: generate_id(),
            name: params.username,
            email: params.username,
            creation_date: new Date().toISOString(),
            owner: requesting_account._id,
            creator: requesting_account._id,
            iam_path: params.iam_path || IAM_DEFAULT_PATH,
            master_key_id: requesting_account.master_key_id, // doesn't have meaning when user has just created (without access keys), TODO: tke from current master key manage and not just copy from the root account
            allow_bucket_creation: requesting_account.allow_bucket_creation,
            force_md5_etag: requesting_account.force_md5_etag,
            access_keys: [],
            nsfs_account_config: {
                distinguished_name: distinguished_name,
                uid: distinguished_name ? undefined : requesting_account.nsfs_account_config.uid,
                gid: distinguished_name ? undefined : requesting_account.nsfs_account_config.gid,
                new_buckets_path: requesting_account.nsfs_account_config.new_buckets_path,
                fs_backend: requesting_account.nsfs_account_config.fs_backend,
            }
        };
    }

    // this function was copied from namespace_fs and bucketspace_fs
    // It is a fallback that we use, but might be not accurate
    _translate_error_codes(err, entity) {
        if (err.rpc_code) return err;
        if (err.code === 'ENOENT') err.rpc_code = `NO_SUCH_${entity}`;
        if (err.code === 'EEXIST') err.rpc_code = `${entity}_ALREADY_EXISTS`;
        if (err.code === 'EPERM' || err.code === 'EACCES') err.rpc_code = 'UNAUTHORIZED';
        if (err.code === 'IO_STREAM_ITEM_TIMEOUT') err.rpc_code = 'IO_STREAM_ITEM_TIMEOUT';
        if (err.code === 'INTERNAL_ERROR') err.rpc_code = 'INTERNAL_ERROR';
        return err;
    }

    _check_root_account(account) {
        if (_.isUndefined(account.owner) ||
            account.owner === account._id) {
            return true;
        }
        return false;
    }

    _check_root_account_owns_user(root_account, user_account) {
        if (_.isUndefined(user_account.owner)) return false;
        return root_account._id === user_account.owner;
    }

    _throw_access_denied_error(action, requesting_account, user_details = {}) {
        const arn_for_requesting_account = create_arn(requesting_account._id,
            requesting_account.name.unwrap(), requesting_account.iam_path);
        const arn_for_user = create_arn(requesting_account._id, user_details.username, user_details.iam_path);
        const full_action_name = get_action_message_title(action);
        const message_with_details = `User: ${arn_for_requesting_account} is not authorized to perform:` +
            `${full_action_name} on resource: ` +
            `${arn_for_user} because no identity-based policy allows the ${full_action_name} action`;
        const { code, http_code, type } = IamError.AccessDenied;
        throw new IamError({ code, message: message_with_details, http_code, type });
    }

    // based on the function from manage_nsfs
    async _list_config_files_for_users(requesting_account, iam_path_prefix) {
        const entries = await nb_native().fs.readdir(this.fs_context, this.accounts_dir);
        const should_filter_by_prefix = check_iam_path_was_set(iam_path_prefix);

        const config_files_list = await P.map_with_concurrency(10, entries, async entry => {
            if (entry.name.endsWith('.json')) {
                const full_path = path.join(this.accounts_dir, entry.name);
                const account_data = await native_fs_utils.read_file(this.fs_context, full_path);
                if (entry.name.includes(config.NSFS_TEMP_CONF_DIR_NAME)) return undefined;
                if (this._check_root_account_owns_user(requesting_account, account_data)) {
                    if (should_filter_by_prefix) {
                        if (_.isUndefined(account_data.iam_path)) return undefined;
                        if (!account_data.iam_path.startsWith(iam_path_prefix)) return undefined;
                    }
                    const user_data = {
                        user_id: account_data._id,
                        iam_path: account_data.iam_path || IAM_DEFAULT_PATH,
                        username: account_data.name,
                        arn: create_arn(requesting_account._id, account_data.name, account_data.iam_path),
                        create_date: account_data.creation_date,
                        password_last_used: Date.now(), // GAP
                    };
                    return user_data;
                }
                return undefined;
            }
        });
        // remove undefined entries
        return config_files_list.filter(item => item);
    }

    _check_if_requesting_account_is_root_account(action, requesting_account, user_details = {}) {
        const is_root_account = this._check_root_account(requesting_account);
        dbg.log1(`AccountSpaceFS.${action} requesting_account`, requesting_account,
            'is_root_account', is_root_account);
        if (!is_root_account) {
            dbg.error(`AccountSpaceFS.${action} requesting account is not a root account`,
                requesting_account);
            this._throw_access_denied_error(action, requesting_account, user_details);
        }
    }

    _check_if_requested_account_is_root_account(action, requesting_account, requested_account, user_details = {}) {
        const is_requested_account_root_account = this._check_root_account(requested_account);
        dbg.log1(`AccountSpaceFS.${action} requested_account`, requested_account,
            'is_requested_account_root_account', is_requested_account_root_account);
        if (is_requested_account_root_account) {
            dbg.error(`AccountSpaceFS.${action} requested account is a root account`,
            requested_account);
            this._throw_access_denied_error(action, requesting_account, user_details);
        }
    }

    async _check_username_already_exists(action, username) {
            const account_config_path = this._get_account_config_path(username);
            const name_exists = await native_fs_utils.is_path_exists(this.fs_context,
                account_config_path);
            if (name_exists) {
                dbg.error(`AccountSpaceFS.${action} username already exists`, username);
                const message_with_details = `User with name ${username} already exists.`;
                const { code, http_code, type } = IamError.EntityAlreadyExists;
                throw new IamError({ code, message: message_with_details, http_code, type });
            }
    }

    async _copy_data_from_requesting_account_to_account_config(action, requesting_account, params) {
        const created_account = this._new_user_defaults(requesting_account, params);
        dbg.log1(`AccountSpaceFS.${action} new_account`, created_account);
        const new_account_string = JSON.stringify(created_account);
        nsfs_schema_utils.validate_account_schema(JSON.parse(new_account_string));
        const account_config_path = this._get_account_config_path(params.username);
        await native_fs_utils.create_config_file(this.fs_context, this.accounts_dir,
            account_config_path, new_account_string);
        return created_account;
    }

    async _check_if_account_config_file_exists(action, username, account_config_path) {
        const is_user_account_exists = await native_fs_utils.is_path_exists(this.fs_context,
            account_config_path);
        if (!is_user_account_exists) {
            dbg.error(`AccountSpaceFS.${action} username does not exist`, username);
            const message_with_details = `The user with name ${username} cannot be found.`;
            const { code, http_code, type } = IamError.NoSuchEntity;
            throw new IamError({ code, message: message_with_details, http_code, type });
        }
    }

    _check_if_user_is_owned_by_root_account(action, requesting_account, requested_account) {
        const is_user_account_to_get_owned_by_root_user = this._check_root_account_owns_user(requesting_account, requested_account);
        if (!is_user_account_to_get_owned_by_root_user) {
            dbg.error(`AccountSpaceFS.${action} requested account is not owned by root account`,
                requested_account);
            const message_with_details = `The user with name ${requested_account.name} cannot be found.`;
            const { code, http_code, type } = IamError.NoSuchEntity;
            throw new IamError({ code, message: message_with_details, http_code, type });
        }
    }


    _check_if_user_does_not_have_access_keys_before_deletion(action, account_to_delete) {
        const is_access_keys_removed = account_to_delete.access_keys.length === 0;
        if (!is_access_keys_removed) {
            dbg.error(`AccountSpaceFS.${action} requested account has access keys`,
                account_to_delete);
            const message_with_details = `Cannot delete entity, must delete access keys first.`;
            const { code, http_code, type } = IamError.DeleteConflict;
            throw new IamError({ code, message: message_with_details, http_code, type });
        }
    }

    async _update_account_config_new_username(action, params, account_to_update) {
        await this._check_username_already_exists(action, params.new_username);
        account_to_update.name = params.new_username;
        account_to_update.email = params.new_username; // internally saved
        const account_to_update_string = JSON.stringify(account_to_update);
        nsfs_schema_utils.validate_account_schema(JSON.parse(account_to_update_string));
        const new_username_account_config_path = this._get_account_config_path(params.new_username);
        await native_fs_utils.create_config_file(this.fs_context, this.accounts_dir,
            new_username_account_config_path, account_to_update_string);
        const account_config_path = this._get_account_config_path(params.username);
        await native_fs_utils.delete_config_file(this.fs_context, this.accounts_dir,
            account_config_path);
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
