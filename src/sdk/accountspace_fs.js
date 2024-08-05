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
const { create_arn, get_action_message_title,
    check_iam_path_was_set } = require('../endpoint/iam/iam_utils');
const { IAM_ACTIONS, MAX_NUMBER_OF_ACCESS_KEYS, IAM_DEFAULT_PATH,
    ACCESS_KEY_STATUS_ENUM, IDENTITY_ENUM } = require('../endpoint/iam/iam_constants');
const nsfs_schema_utils = require('../manage_nsfs/nsfs_schema_utils');
const IamError = require('../endpoint/iam/iam_errors').IamError;
const cloud_utils = require('../util/cloud_utils');
const SensitiveString = require('../util/sensitive_string');
const { get_symlink_config_file_path, get_config_file_path, get_config_data,
    get_config_data_if_exists, generate_id } = require('../manage_nsfs/manage_nsfs_cli_utils');
const nc_mkm = require('../manage_nsfs/nc_master_key_manager').get_instance();
const { account_cache } = require('./object_sdk');

// TODO - rename (the typo), move and reuse in manage_nsfs
const acounts_dir_relative_path = '../accounts/';
const acounts_dir_relative_path_double = '../../accounts/';

////////////////////
// MOCK VARIABLES //
////////////////////
/* mock variables (until we implement the actual code), based on the example in AWS IAM API docs*/
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
     *      config_root_backend?: string;
     *      stats?: import('./endpoint_stats_collector').EndpointStatsCollector;
     * }} params
     */
    constructor({ config_root, fs_root, config_root_backend, stats }) {
        this.config_root = config_root;
        this.accounts_dir = path.join(config_root, CONFIG_SUBDIRS.ACCOUNTS);
        this.root_accounts_dir = path.join(config_root, CONFIG_SUBDIRS.ROOT_ACCOUNTS);
        this.access_keys_dir = path.join(config_root, CONFIG_SUBDIRS.ACCESS_KEYS);
        this.buckets_dir = path.join(config_root, CONFIG_SUBDIRS.BUCKETS);
        this.fs_context = native_fs_utils.get_process_fs_context();

        // Currently we do not use these properties
        this.fs_root = fs_root ?? '';
        this.config_root_backend = config_root_backend ?? config.NSFS_NC_CONFIG_DIR_BACKEND;
        this.stats = stats;
    }

    ////////////
    // USER   //
    ////////////

    // 1 - check that the requesting account is a root user account
    // 2 - check if username already exists
    // 3 - copy the data from the root account user details to a new config file
    async create_user(params, account_sdk) {
        const action = IAM_ACTIONS.CREATE_USER;
        dbg.log1(`AccountSpaceFS.${action}`, params);
        try {
            const requesting_account = account_sdk.requesting_account;
            this._check_if_requesting_account_is_root_account(action, requesting_account,
                { username: params.username, iam_path: params.iam_path });
            //if iam_operate_on_root_account, the requested account is root_account
            //otherwise, requested account is iam_account, and requesting account is the root account.
            const root_name = requesting_account.iam_operate_on_root_account ? params.username : requesting_account.name.unwrap();
            await this._check_username_already_exists(action, params.username, root_name);
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
            throw native_fs_utils.translate_error_codes(err, native_fs_utils.entity_enum.USER);
        }
    }

    // 1 - check that the requesting account is a root user account
    // 2 - find the username (flag username is not required)
    // 3 - check that the user account config file exists
    // 4 - read the account config file (no decryption)
    // if the requesting account is root account that creates IAM user:
    //    5 - check that the user to get is not a root account
    //    6 - check that the user account to get is owned by the root account
    // if the requesting account is root accounts manager that creates root account user:
    //    5 - check that the user to get is not an IAM user
    async get_user(params, account_sdk) {
        const action = IAM_ACTIONS.GET_USER;
        dbg.log1(`AccountSpaceFS.${action}`, params);
        try {
            const requesting_account = account_sdk.requesting_account;
            const { requester } = this._check_root_account_or_user(requesting_account, params.username);
            const username = params.username ?? requester.name; // username is not required
            // GAP - we do not have the user iam_path at this point (error message)
            this._check_if_requesting_account_is_root_account(action, requesting_account,
                { username: username });
            const account_config_path = await this._get_account_config_path_by_requesting_account(requesting_account, username);
            await this._check_if_account_config_file_exists(action, username, account_config_path);
            const account_to_get = await this._get_account_decrypted_data_optional(account_config_path, false);
            this._check_if_requested_account_is_root_account_or_IAM_user(action, requesting_account, account_to_get);
            this._check_if_requested_is_owned_by_root_account(action, requesting_account, account_to_get);
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
            throw native_fs_utils.translate_error_codes(err, native_fs_utils.entity_enum.USER);
        }
    }

    // 1 - check that the requesting account is a root user account
    // 2 - check that the user account config file exists
    // 3 - read the account config file (and decrypt its existing encrypted secret keys and then encrypted secret keys)
    // if the requesting account is root account that creates IAM user:
    //    4 - check that the user to get is not a root account
    //    5 - check that the user account to get is owned by the root account
    // if the requesting account is root accounts manager that creates root account user:
    //    4, 5 - check that the user to get is not an IAM user
    // 6 - check if username was updated
    //   6.1 - check if username already exists (global scope - all config files names)
    //   6.2 - create the new config file (with the new name same data) and delete the the existing config file
    // 7 - (else not an update of username) update the config file
    // 8 - remove the access_keys from the account_cache
    async update_user(params, account_sdk) {
        const action = IAM_ACTIONS.UPDATE_USER;
        try {
            dbg.log1(`AccountSpaceFS.${action}`, params);
            const requesting_account = account_sdk.requesting_account;
            // GAP - we do not have the user iam_path at this point (error message)
            this._check_if_requesting_account_is_root_account(action, requesting_account,
                { username: params.username});
            const account_config_path = await this._get_account_config_path_by_requesting_account(requesting_account, params.username);
            await this._check_if_account_config_file_exists(action, params.username, account_config_path);
            const requested_account = await this._get_account_decrypted_data_optional(account_config_path, false);
            this._check_if_requested_account_is_root_account_or_IAM_user(action, requesting_account, requested_account);
            this._check_if_requested_is_owned_by_root_account(action, requesting_account, requested_account);
            requested_account.access_keys = await nc_mkm.decrypt_access_keys(requested_account);
            const is_username_update = !_.isUndefined(params.new_username) &&
                params.new_username !== params.username;
            if (!_.isUndefined(params.new_iam_path)) requested_account.iam_path = params.new_iam_path;
            if (is_username_update) {
                dbg.log1(`AccountSpaceFS.${action} username was updated, is_username_update`,
                    is_username_update);
                await this._update_account_config_new_username(action, requested_account,
                    params.username, params.new_username, requesting_account);
                requested_account.name = params.new_username;
            }
            const requested_account_encrypted = await nc_mkm.encrypt_access_keys(requested_account);
            const account_string = JSON.stringify(requested_account_encrypted);
            nsfs_schema_utils.validate_account_schema(JSON.parse(account_string));
            await native_fs_utils.update_config_file(this.fs_context, this.accounts_dir,
                this._get_account_config_path(requested_account._id), account_string);
            this._clean_account_cache(requested_account);
            return {
                iam_path: requested_account.iam_path || IAM_DEFAULT_PATH,
                username: requested_account.name,
                user_id: requested_account._id,
                arn: create_arn(requesting_account._id, requested_account.name, requested_account.iam_path),
            };
        } catch (err) {
            dbg.error(`AccountSpaceFS.${action} error`, err);
            throw native_fs_utils.translate_error_codes(err, native_fs_utils.entity_enum.USER);
        }
    }

    // 1 - check that the requesting account is a root user account
    // 2 - check that the user account config file exists
    // 3 - read the account config file (no decryption)
    // if the requesting account is root account that creates IAM user:
    //    4 - check that the user to get is not a root account
    //    5 - check that the user account to get is owned by the root account
    // if the requesting account is root accounts manager that creates root account user:
    //    4, 5 - check that the user to get is not an IAM user
    // 6 - check if the user doesn’t have resources related to it:
    //     in IAM users only access keys
    //     in root accounts it can be: IAM users, buckets and access keys
    //     note: buckets are owned by the root account
    // 7 - delete the account config file
    async delete_user(params, account_sdk) {
        const action = IAM_ACTIONS.DELETE_USER;
        dbg.log1(`AccountSpaceFS.${action}`, params);
        try {
            const requesting_account = account_sdk.requesting_account;
            // GAP - we do not have the user iam_path at this point (error message)
            this._check_if_requesting_account_is_root_account(action, requesting_account,
                { username: params.username });
            //path to the config file of the root account owning the requested account
            //in case requesting account is root manager, this is the requeted account.
            //otherwise, it is the requesting account.
            const root_account_config_path = await
                this._get_account_config_path_by_requesting_account(requesting_account, params.username);
            await this._check_if_account_config_file_exists(action, params.username, root_account_config_path);
            const account_to_delete = await this._get_account_decrypted_data_optional(root_account_config_path, false);
            this._check_if_requested_account_is_root_account_or_IAM_user(action, requesting_account, account_to_delete);
            this._check_if_requested_is_owned_by_root_account(action, requesting_account, account_to_delete);
            await this._check_if_user_does_not_have_resources_before_deletion(action, account_to_delete);
            await native_fs_utils.delete_config_file(this.fs_context, this.accounts_dir,
                this._get_account_config_path(account_to_delete._id));
            await nb_native().fs.unlink(this.fs_context, root_account_config_path);
            if (this._check_root_account(account_to_delete)) {
                //delete directory of root account (it's empty now)
                await native_fs_utils.folder_delete(path.join(this.root_accounts_dir, account_to_delete.name), this.fs_context);
            }
        } catch (err) {
            dbg.error(`AccountSpaceFS.${action} error`, err);
            throw native_fs_utils.translate_error_codes(err, native_fs_utils.entity_enum.USER);
        }
    }

    // 1 - check that the requesting account is a root user account
    // if the requesting account is root account that creates IAM user:
    //    2 - list the config files that are owned by the root user account
    // if the requesting account is root accounts manager that creates root account user:
    //    2 - list the config files of the root accounts
    //        Note: will always have at least 1 account (himself)
    //   2.1 - if the request has path_prefix check if the user’s path starts with this path
    // 3- sort the members by username (a to z)
    async list_users(params, account_sdk) {
        const action = IAM_ACTIONS.LIST_USERS;
        dbg.log1(`AccountSpaceFS.${action}`, params);
        try {
        const requesting_account = account_sdk.requesting_account;
        this._check_if_requesting_account_is_root_account(action, requesting_account, { });
        const is_truncated = false; // GAP - no pagination at this point
        let members = await this._list_config_files_for_users(requesting_account, params.iam_path_prefix);
        members = members.sort((a, b) => a.username.localeCompare(b.username));
        return { members, is_truncated };
        } catch (err) {
            dbg.error(`AccountSpaceFS.${action} error`, err);
            throw native_fs_utils.translate_error_codes(err, native_fs_utils.entity_enum.USER);
        }
    }

    ////////////////
    // ACCESS KEY //
    ////////////////

    // 1 - check that the requesting account is a root user account or that the username is same as the requester
    // 2 - check that the requested account config file exists
    // 3 - read the account config file (and decrypt its existing encrypted secret keys and then encrypted secret keys)
    // 4 - if the requesting account is root account - check that the access key to create is on a user is owned by the the root account
    //     if the requesting account is root accounts manager - check that it performs on root account and not IAM user
    // 5 - check that the number of access key array
    // 6 - generate access keys
    // 7 - encryption
    // 8 - validate account
    // 9 - update account config file
    // 10 - link new access key file to config file
    async create_access_key(params, account_sdk) {
        const action = IAM_ACTIONS.CREATE_ACCESS_KEY;
        dbg.log1(`AccountSpaceFS.${action}`, params);
        try {
            const requesting_account = account_sdk.requesting_account;
            const requester = this._check_if_requesting_account_is_root_account_or_user_om_himself(action,
                requesting_account, params.username);
            const name_for_access_key = params.username ?? requester.name;
            const requested_account_config_path = await this._get_account_config_path_by_requesting_account(
                requesting_account, name_for_access_key);
            await this._check_if_account_config_file_exists(action, name_for_access_key, requested_account_config_path);
            const requested_account = await this._get_account_decrypted_data_optional(requested_account_config_path, true);
            if (requester.identity === IDENTITY_ENUM.ROOT_ACCOUNT) {
                this._check_if_requested_is_owned_by_root_account(action, requesting_account, requested_account);
                if (requesting_account.iam_operate_on_root_account) {
                    this._check_if_requested_account_is_root_account_or_IAM_user(action, requesting_account, requested_account);
                }
            }
            this._check_number_of_access_key_array(action, requested_account);
            const { generated_access_key, generated_secret_key } = this._generate_access_key();
            const created_access_key_obj = {
                access_key: generated_access_key,
                secret_key: generated_secret_key,
                creation_date: new Date().toISOString(),
                deactivated: false,
            };
            requested_account.access_keys.push(created_access_key_obj);
            const requested_account_encrypted = await nc_mkm.encrypt_access_keys(requested_account);
            const account_to_create_access_keys_string = JSON.stringify(requested_account_encrypted);
            nsfs_schema_utils.validate_account_schema(JSON.parse(account_to_create_access_keys_string));
            await native_fs_utils.update_config_file(this.fs_context, this.accounts_dir,
                this._get_account_config_path(requested_account._id), account_to_create_access_keys_string);
            await this._symlink_to_account(requested_account._id, this.access_keys_dir, generated_access_key);
            return {
                username: requested_account.name,
                access_key: created_access_key_obj.access_key,
                create_date: created_access_key_obj.creation_date,
                status: this._get_access_key_status(created_access_key_obj.deactivated),
                secret_key: generated_secret_key,
            };
        } catch (err) {
            dbg.error(`AccountSpaceFS.${action} error`, err);
            throw native_fs_utils.translate_error_codes(err, native_fs_utils.entity_enum.ACCESS_KEY);
        }
    }

    // 1 - read the symlink file that we get in params (access key id)
    // 2 - check if the access key that was received in param exists
    // 3 - read the config file
    // 4 - if the requesting account is root account - check that config file is on the same root account
    //     if the requesting account is root accounts manager - check that it performs on root account and not IAM user
    // General note: only serves the requester (no flag --user-name is passed)
    async get_access_key_last_used(params, account_sdk) {
        const action = IAM_ACTIONS.GET_ACCESS_KEY_LAST_USED;
        dbg.log1(`AccountSpaceFS.${action}`, params);
        try {
            const requesting_account = account_sdk.requesting_account;
            const access_key_id = params.access_key;
            const requested_account_path = get_symlink_config_file_path(this.access_keys_dir, access_key_id);
            await this._check_if_account_exists_by_access_key_symlink(action, requested_account_path, access_key_id);
            const requested_account = await get_config_data(this.config_root_backend, requested_account_path, true);
            this._check_if_requested_account_same_root_account_as_requesting_account(action,
                requesting_account, requested_account);
            if (requesting_account.iam_operate_on_root_account) {
                this._check_if_requested_account_is_root_account_or_IAM_user(action, requesting_account, requested_account);
            }
            return {
                region: dummy_region, // GAP
                last_used_date: new Date(), // GAP
                service_name: dummy_service_name, // GAP
                username: requested_account.name,
            };
        } catch (err) {
            dbg.error('AccountSpaceFS.get_access_key_last_used error', err);
            throw native_fs_utils.translate_error_codes(err, native_fs_utils.entity_enum.ACCESS_KEY);
        }
    }

    // 1 - check that the requesting account is a root user account or that the username is same as the requester
    // 2 - check if the access key that was received in param exists
    // 3 - read the config file (and decrypt the encrypted secret keys)
    // 4 - check if the access key id belongs to the account
    // 5 - if the requesting account is root account - check that the access key to update is on a user is owned by the the root account
    //     if the requesting account is root accounts manager - check that it performs on root account and not IAM user
    // 6 - check if we need to change the status (if not - return)
    // 7 - update the access key status (Active/Inactive)
    // 8 - encryption
    // 9 - validate account
    // 10 - update account config file
    // 11 - remove the access_key from the account_cache
    async update_access_key(params, account_sdk) {
        const action = IAM_ACTIONS.UPDATE_ACCESS_KEY;
        dbg.log1(`AccountSpaceFS.${action}`, params);
        try {
            const requesting_account = account_sdk.requesting_account;
            const access_key_id = params.access_key;
            this._check_if_requesting_account_is_root_account_or_user_om_himself(action,
                requesting_account, params.username);
            let username = params.username ?? requesting_account.name; // username is not required
            username = username instanceof SensitiveString ? username.unwrap() : username;
            const requested_account_path = get_symlink_config_file_path(this.access_keys_dir, params.access_key);
            await this._check_if_account_exists_by_access_key_symlink(action, requested_account_path, access_key_id);
            const requested_account = await this._get_account_decrypted_data_optional(requested_account_path, true);
            this._check_username_match_to_requested_account(action, username, requested_account);
            this._check_access_key_belongs_to_account(action, requested_account, access_key_id);
            this._check_if_requested_account_same_root_account_as_requesting_account(action,
                requesting_account, requested_account);
            if (requesting_account.iam_operate_on_root_account) {
                this._check_if_requested_account_is_root_account_or_IAM_user(action, requesting_account, requested_account);
            }
            const access_key_obj = _.find(requested_account.access_keys, access_key => access_key.access_key === access_key_id);
            if (this._get_access_key_status(access_key_obj.deactivated) === params.status) {
                // note: master key might be changed and we do not update it since we do not update the config file
                // we can change this behavior - a matter of decision
                dbg.log1(`AccountSpaceFS.${action} status was not change, not updating the account config file`);
                return;
            }
            access_key_obj.deactivated = this._check_access_key_is_deactivated(params.status);
            const requested_account_encrypted = await nc_mkm.encrypt_access_keys(requested_account);
            const account_string = JSON.stringify(requested_account_encrypted);
            nsfs_schema_utils.validate_account_schema(JSON.parse(account_string));
            const requested_account_config_path = this._get_account_config_path(requested_account._id);
            await native_fs_utils.update_config_file(this.fs_context, this.accounts_dir,
                requested_account_config_path, account_string);
            this._clean_account_cache(requested_account);
        } catch (err) {
            dbg.error(`AccountSpaceFS.${action} error`, err);
            throw native_fs_utils.translate_error_codes(err, native_fs_utils.entity_enum.ACCESS_KEY);
        }
    }

    // 1 - check that the requesting account is a root user account or that the username is same as the requester
    // 2 - check if the access key that was received in param exists
    // 3 - read the config file (and decrypt the encrypted secret keys)
    // 4 - check if the access key id belongs to the account
    // 5 - if the requesting account is root account - check that the access key to delete is on a user is owned by the the root account
    //     if the requesting account is root accounts manager - check that it performs on root account and not IAM user
    // 6 - delete the access key object (access key, secret key, status, etc.) from the array
    // 7 - encryption (of existing access keys)
    // 8 - validate account
    // 9 - update account config file
    // 10 -  unlink the symbolic link
    // 11 - remove the access_key from the account_cache
    async delete_access_key(params, account_sdk) {
        const action = IAM_ACTIONS.DELETE_ACCESS_KEY;
        dbg.log1(`AccountSpaceFS.${action}`, params);
        try {
            const requesting_account = account_sdk.requesting_account;
            const access_key_id = params.access_key;
            this._check_if_requesting_account_is_root_account_or_user_om_himself(action,
                requesting_account, params.username);
            let username = params.username ?? requesting_account.name; // username is not required
            username = username instanceof SensitiveString ? username.unwrap() : username;
            const requested_account_path = get_symlink_config_file_path(this.access_keys_dir, access_key_id);
            await this._check_if_account_exists_by_access_key_symlink(action, requested_account_path, access_key_id);
            const requested_account = await this._get_account_decrypted_data_optional(requested_account_path, true);
            this._check_username_match_to_requested_account(action, username, requested_account);
            this._check_access_key_belongs_to_account(action, requested_account, access_key_id);
            this._check_if_requested_account_same_root_account_as_requesting_account(action,
                requesting_account, requested_account);
            if (requesting_account.iam_operate_on_root_account) {
                this._check_if_requested_account_is_root_account_or_IAM_user(action, requesting_account, requested_account);
            }
            requested_account.access_keys = requested_account.access_keys.filter(access_key_obj =>
                access_key_obj.access_key !== access_key_id);
            const requested_account_encrypted = await nc_mkm.encrypt_access_keys(requested_account);
            const account_string = JSON.stringify(requested_account_encrypted);
            nsfs_schema_utils.validate_account_schema(JSON.parse(account_string));
            const account_config_path = this._get_account_config_path(requested_account._id);
            await native_fs_utils.update_config_file(this.fs_context, this.accounts_dir,
                account_config_path, account_string);
            await nb_native().fs.unlink(this.fs_context, requested_account_path);
            this._clean_account_cache(requested_account);
        } catch (err) {
            dbg.error(`AccountSpaceFS.${action} error`, err);
            throw native_fs_utils.translate_error_codes(err, native_fs_utils.entity_enum.ACCESS_KEY);
        }
    }

    // 1 - check that the requesting account is a root user account or that the username is same as the requester
    // 2 - check that the user account config file exists
    // 3 - read the account config file (no decryption)
    // 4 - if the requesting account is root account - check that the access key to delete is on a user is owned by the the root account
    //     if the requesting account is root accounts manager - check that it performs on root account and not IAM user
    // 5 - list the access-keys
    // 6 - members should be sorted by access_key (a to z)
    //     GAP - this is not written in the docs, only inferred (maybe it sorted is by create_date?)
    async list_access_keys(params, account_sdk) {
        const action = IAM_ACTIONS.LIST_ACCESS_KEYS;
        dbg.log1(`AccountSpaceFS.${action}`, params);
        try {
            const requesting_account = account_sdk.requesting_account;
            const requester = this._check_if_requesting_account_is_root_account_or_user_om_himself(action,
                requesting_account, params.username);
            const name_for_access_key = params.username ?? requester.name;
            const requested_account_config_path = await this._get_account_config_path_by_requesting_account(
                requesting_account, name_for_access_key);
            await this._check_if_account_config_file_exists(action, name_for_access_key, requested_account_config_path);
            const requested_account = await this._get_account_decrypted_data_optional(requested_account_config_path, false);
            this._check_if_requested_account_same_root_account_as_requesting_account(action,
                requesting_account, requested_account);
            if (requesting_account.iam_operate_on_root_account) {
                this._check_if_requested_account_is_root_account_or_IAM_user(action, requesting_account, requested_account);
            }
            const is_truncated = false; // path_prefix is not supported
            let members = this._list_access_keys_from_account(requested_account);
            members = members.sort((a, b) => a.access_key.localeCompare(b.access_key));
            return { members, is_truncated, username: name_for_access_key };
        } catch (err) {
            dbg.error(`AccountSpaceFS.${action} error`, err);
            throw native_fs_utils.translate_error_codes(err, native_fs_utils.entity_enum.ACCESS_KEY);
        }
    }

    ////////////////////////
    // INTERNAL FUNCTIONS //
    ////////////////////////

     _get_account_config_path(account_id) {
        return get_config_file_path(this.accounts_dir, account_id);
     }

     async _get_account_config_path_by_root_name(account_name, root_name) {
        const iam_account_path = get_symlink_config_file_path(this.root_accounts_dir, account_name, root_name);
        if (await native_fs_utils.is_path_exists(this.fs_context, iam_account_path)) {
            return iam_account_path;
        }
        return this._get_account_config_path(account_name);
     }

     async _get_root_account_name(account) {
        const root_id = account.owner || account._id;
        const root_account_path = this._get_account_config_path(root_id);
        const root_account = await this._get_account_decrypted_data_optional(root_account_path, false);
        return root_account.name;
     }

     /**
      * Returns the path of the requested account according to whether requesting account is
      * iam_operate_on_root_account or not.
      * If it is, then requested account is the root account whose name is the requested account.
      * In this case, both root_account_name and iam_account_name is the requested account name.
      * Otherwise, the requesting account is the root account, and the requested account
      * is the iam account name.
      * @param {Object} requesting_account 
      * @param {string} requested_account_name 
      * @returns 
      */
     async _get_account_config_path_by_requesting_account(requesting_account, requested_account_name) {
        let root_account_name;
        if (requesting_account.iam_operate_on_root_account) {
            //root account manager only operates on the root account that was requested.
            root_account_name = requested_account_name;
        } else {
            root_account_name = await this._get_root_account_name(requesting_account);
        }

        const account_path = await this._get_account_config_path_by_root_name(requested_account_name, root_account_name);
        return account_path;
     }

     _get_access_keys_config_path(access_key) {
        return get_symlink_config_file_path(this.access_keys_dir, access_key, undefined);
     }

     async _get_account_decrypted_data_optional(account_path, should_decrypt_secret_key) {
        const data = await get_config_data(this.config_root_backend, account_path, true);
        if (should_decrypt_secret_key) data.access_keys = await nc_mkm.decrypt_access_keys(data);
        return data;
     }

     /**
     * _get_account_decrypted_data_optional_if_exists will read a config file and return its content
     * if the config file was deleted (encounter ENOENT error) - continue (returns undefined)
     *
     * Notes: this function is important when dealing with concurrency.
     * When we iterate files (for example for listing them) between the time we read the entries
     * from the directory and the time we we are trying to read the config file,
     * a file might be deleted (by another process), and we would not want to throw this error
     * as a part of iterating the file, therefore we continue
     * (not throwing this error and return undefined)
     *
     * @param {string} account_path
     * @param {boolean} should_decrypt_secret_key
     */
     async _get_account_decrypted_data_optional_if_exists(account_path, should_decrypt_secret_key) {
        try {
            const data = await this._get_account_decrypted_data_optional(account_path, should_decrypt_secret_key);
            return data;
        } catch (err) {
            dbg.warn('_get_account_decrypted_data_optional_if_exists: with config_file_path', account_path, 'got an error', err);
            if (err.code !== 'ENOENT') throw err;
        }
     }

     _new_user_defaults(requesting_account, params, master_key_id) {
        const distinguished_name = requesting_account.nsfs_account_config.distinguished_name;
        const user_defaults = {
            _id: generate_id(),
            name: params.username,
            email: params.username,
            creation_date: new Date().toISOString(),
            owner: requesting_account._id,
            creator: requesting_account._id,
            iam_path: params.iam_path || IAM_DEFAULT_PATH,
            master_key_id: master_key_id,
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
        if (requesting_account.iam_operate_on_root_account) {
            dbg.log2('_new_user_defaults creates root account user');
            delete user_defaults.owner;
            // set the allow bucket creation to true if we have new_buckets_path
            if (!user_defaults.allow_bucket_creation && user_defaults.nsfs_account_config.new_buckets_path) {
                user_defaults.allow_bucket_creation = true;
            }
        }
        return user_defaults;
    }

    _check_root_account(account) {
        if (account.owner === undefined ||
            account.owner === account._id) {
            return true;
        }
        return false;
    }

    _check_root_account_owns_user(root_account, user_account) {
        if (user_account.owner === undefined) return false;
        return root_account._id === user_account.owner;
    }

    // TODO: move to IamError class with a template
    _throw_access_denied_error(action, requesting_account, details, entity) {
        const full_action_name = get_action_message_title(action);
        const arn_for_requesting_account = create_arn(requesting_account._id,
            requesting_account.name.unwrap(), requesting_account.path);
        const basic_message = `User: ${arn_for_requesting_account} is not authorized to perform:` +
        `${full_action_name} on resource: `;
        let message_with_details;
        if (entity === native_fs_utils.entity_enum.USER) {
            let user_message;
            if (action === IAM_ACTIONS.LIST_ACCESS_KEYS) {
                user_message = `user ${requesting_account.name.unwrap()}`;
            } else {
                user_message = create_arn(requesting_account._id, details.username, details.path);
            }
            message_with_details = basic_message +
            `${user_message} because no identity-based policy allows the ${full_action_name} action`;
        } else { // native_fs_utils.entity_enum.ACCESS_KEY
            message_with_details = basic_message + `access key ${details.access_key}`;
        }
        const { code, http_code, type } = IamError.AccessDeniedException;
        throw new IamError({ code, message: message_with_details, http_code, type });
    }

    // TODO: move to IamError class with a template
    _throw_error_perform_action_on_another_root_account(action, requesting_account, requested_account) {
        const username = requested_account.name instanceof SensitiveString ?
        requested_account.name.unwrap() : requested_account.name;
        // we do not want to to reveal that the root account exists (or usernames under it)
        // (cannot perform action on users from another root accounts)
        dbg.error(`AccountSpaceFS.${action} root account of requested account is different than requesting root account`,
            requesting_account, requested_account);
        const message_with_details = `The user with name ${username} cannot be found.`;
        const { code, http_code, type } = IamError.NoSuchEntity;
        throw new IamError({ code, message: message_with_details, http_code, type });
    }

    // TODO: move to IamError class with a template
    _throw_error_delete_conflict(action, account_to_delete, resource_name) {
        dbg.error(`AccountSpaceFS.${action} requested account ` +
            `${account_to_delete.name} ${account_to_delete._id} has ${resource_name}`);
        const message_with_details = `Cannot delete entity, must delete ${resource_name} first.`;
        const { code, http_code, type } = IamError.DeleteConflict;
        throw new IamError({ code, message: message_with_details, http_code, type });
    }

    _throw_error_perform_action_from_root_accounts_manager_on_iam_user(action, requesting_account, requested_account) {
        dbg.error(`AccountSpaceFS.${action} root accounts manager cannot perform actions on IAM users`,
            requesting_account, requested_account);
        throw new IamError(IamError.NotAuthorized);
    }

    // TODO: move to IamError class with a template
    _throw_error_no_such_entity_access_key(action, access_key_id) {
        dbg.error(`AccountSpaceFS.${action} access key does not exist`, access_key_id);
        const message_with_details = `The Access Key with id ${access_key_id} cannot be found`;
        const { code, http_code, type } = IamError.NoSuchEntity;
        throw new IamError({ code, message: message_with_details, http_code, type });
    }

    // based on the function from manage_nsfs
    async _list_config_files_for_users(requesting_account, iam_path_prefix) {
        const entries = await nb_native().fs.readdir(this.fs_context, this.accounts_dir);
        const should_filter_by_prefix = check_iam_path_was_set(iam_path_prefix);

        const config_files_list = await P.map_with_concurrency(10, entries, async entry => {
            if (entry.name.endsWith('.json')) {
                const full_path = path.join(this.accounts_dir, entry.name);
                const account_data = await this._get_account_decrypted_data_optional_if_exists(full_path, false);
                if (!account_data) return undefined;
                if (entry.name.includes(config.NSFS_TEMP_CONF_DIR_NAME)) return undefined;
                const is_root_account_owns_user = this._check_root_account_owns_user(requesting_account, account_data);
                if ((!requesting_account.iam_operate_on_root_account && is_root_account_owns_user) ||
                    (requesting_account.iam_operate_on_root_account && this._check_root_account(account_data))) {
                    if (should_filter_by_prefix) {
                        if (account_data.iam_path === undefined) return undefined;
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
        dbg.log1(`AccountSpaceFS.${action} requesting_account ID: ${requesting_account._id}` +
            `name: ${requesting_account.name.unwrap()}`, 'is_root_account', is_root_account);
        if (!is_root_account) {
            dbg.error(`AccountSpaceFS.${action} requesting account is not a root account`,
                requesting_account);
            this._throw_access_denied_error(action, requesting_account, user_details, native_fs_utils.entity_enum.USER);
        }
    }

    _check_if_requested_account_is_root_account_or_IAM_user(action, requesting_account, requested_account) {
        const is_requested_account_root_account = this._check_root_account(requested_account);
        dbg.log1(`AccountSpaceFS.${action} requested_account ID: ${requested_account._id} name: ${requested_account.name}`,
            'is_requested_account_root_account', is_requested_account_root_account);
        // access to root account is allowed to root account that has iam_operate_on_root_account true
        if (is_requested_account_root_account && !requesting_account.iam_operate_on_root_account) {
            this._throw_error_perform_action_on_another_root_account(action,
                requesting_account, requested_account);
        }
        // access to IAM user is allowed to root account that either iam_operate_on_root_account undefined or false
        if (requesting_account.iam_operate_on_root_account && !is_requested_account_root_account) {
            this._throw_error_perform_action_from_root_accounts_manager_on_iam_user(action,
                requesting_account, requested_account);
        }
    }

    async _check_username_already_exists(action, username, root_name) {
        const account_config_path = await this._get_account_config_path_by_root_name(username, root_name);
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
        const master_key_id = await nc_mkm.get_active_master_key_id();
        const created_account = this._new_user_defaults(requesting_account, params, master_key_id);
        dbg.log1(`AccountSpaceFS.${action} new_account`, created_account);
        const new_account_string = JSON.stringify(created_account);
        nsfs_schema_utils.validate_account_schema(JSON.parse(new_account_string));
        const account_config_path = this._get_account_config_path(created_account._id);
        await native_fs_utils.create_config_file(this.fs_context, this.accounts_dir,
            account_config_path, new_account_string);
        //for account manager, create a new root user. Otherwise, root is the requesting account. 
        const root_account_dir = requesting_account.iam_operate_on_root_account ? params.username : requesting_account.name.unwrap();
        //make sure root directory exists
        await native_fs_utils._create_path(path.join(this.root_accounts_dir, root_account_dir), this.fs_context);
        //symlink from by-name account to by-id account json
        await this._symlink_to_account(created_account._id, this.root_accounts_dir, params.username, root_account_dir);
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

    _check_if_requested_is_owned_by_root_account(action, requesting_account, requested_account) {
        if (requesting_account.iam_operate_on_root_account) return;
        const is_user_account_to_get_owned_by_root_user = this._check_root_account_owns_user(requesting_account, requested_account);
        if (!is_user_account_to_get_owned_by_root_user) {
            dbg.error(`AccountSpaceFS.${action} requested account is not owned by root account`,
                requested_account);
            const message_with_details = `The user with name ${requested_account.name} cannot be found.`;
            const { code, http_code, type } = IamError.NoSuchEntity;
            throw new IamError({ code, message: message_with_details, http_code, type });
        }
    }

    async _check_if_user_does_not_have_resources_before_deletion(action, account_to_delete) {
        const is_account_to_delete_root_account = this._check_root_account(account_to_delete);
        if (is_account_to_delete_root_account) {
            await this._check_if_root_account_does_not_have_buckets_before_deletion(action, account_to_delete);
            await this._check_if_root_account_does_not_have_IAM_users_before_deletion(action, account_to_delete);
        }
        this._check_if_user_does_not_have_access_keys_before_deletion(action, account_to_delete);
    }

    // TODO - when we have the structure of config we can check easily which buckets are owned by the root account
    // currently, partial copy from verify_account_not_owns_bucket
    async _check_if_root_account_does_not_have_buckets_before_deletion(action, account_to_delete) {
        const resource_name = 'buckets';
        const entries = await nb_native().fs.readdir(this.fs_context, this.buckets_dir);
        await P.map_with_concurrency(10, entries, async entry => {
            if (entry.name.endsWith('.json')) {
                const full_path = path.join(this.buckets_dir, entry.name);
                const bucket_data = await get_config_data_if_exists(this.config_root_backend, full_path, false);
                if (bucket_data && bucket_data.owner_account === account_to_delete._id) {
                    this._throw_error_delete_conflict(action, account_to_delete, resource_name);
                }
                return bucket_data;
            }
        });
    }

    // TODO - when we have the structure of config we can check easily which IAM users are owned by the root account
    // currently, partial copy from _list_config_files_for_users
    async _check_if_root_account_does_not_have_IAM_users_before_deletion(action, account_to_delete) {
        const resource_name = 'IAM users';
        const entries = await nb_native().fs.readdir(this.fs_context, this.accounts_dir);
        await P.map_with_concurrency(10, entries, async entry => {
            if (entry.name.endsWith('.json')) {
                const full_path = path.join(this.accounts_dir, entry.name);
                const account_data = await this._get_account_decrypted_data_optional_if_exists(full_path, false);
                if (!account_data) return undefined;
                if (entry.name.includes(config.NSFS_TEMP_CONF_DIR_NAME)) return undefined;
                const is_root_account_owns_user = this._check_root_account_owns_user(account_to_delete, account_data);
                if ((!account_to_delete.iam_operate_on_root_account && is_root_account_owns_user) ||
                    (account_to_delete.iam_operate_on_root_account && this._check_root_account(account_data))) {
                        this._throw_error_delete_conflict(action, account_to_delete, resource_name);
                }
                return account_data;
            }
        });
    }

    _check_if_user_does_not_have_access_keys_before_deletion(action, account_to_delete) {
        const resource_name = 'access keys';
        const is_access_keys_removed = account_to_delete.access_keys.length === 0;
        if (!is_access_keys_removed) {
            this._throw_error_delete_conflict(action, account_to_delete, resource_name);
        }
    }

    async _symlink_to_account(account_id, symlink_dir, symlink_filename, root_name) {
        const account_config_relative_path = get_config_file_path(
            //if root_name, then we need account_name->account, which is two dirs above.
            //otherwise, only one dir above
            root_name ? acounts_dir_relative_path_double : acounts_dir_relative_path,
            account_id);
        const symlink_path = get_symlink_config_file_path(symlink_dir, symlink_filename, root_name);
        await nb_native().fs.symlink(this.fs_context, account_config_relative_path, symlink_path);
    }

    async _update_account_config_new_username(action, requested_acocunt, old_username, new_username, requesting_account) {
        let root_account_name;
        if (requesting_account.iam_operate_on_root_account) {
            //if root manager requested to change the name, the requested account is the
            //root account being updated.
            root_account_name = old_username;
        } else {
            root_account_name = await this._get_root_account_name(requesting_account);
        }
        await this._check_username_already_exists(action, new_username, root_account_name);
        const root_account_old_name = get_symlink_config_file_path(this.root_accounts_dir, old_username, root_account_name);
        await nb_native().fs.unlink(this.fs_context, root_account_old_name);
        await this._symlink_to_account(requested_acocunt._id, this.root_accounts_dir, new_username, root_account_name);
        //root accounts need to change their root_accounts/ directory name
        if (this._check_root_account(requested_acocunt)) {
            await nb_native().fs.rename(this.fs_context,
                path.join(this.root_accounts_dir, root_account_name),
                path.join(this.root_accounts_dir, new_username));
        }
    }

    _check_root_account_or_user(requesting_account, username) {
        let is_root_account_or_user_on_itself = false;
        let requester = {};
        const requesting_account_name = requesting_account.name instanceof SensitiveString ?
            requesting_account.name.unwrap() : requesting_account.name;
        // root account (on user or himself)
        if (this._check_root_account(requesting_account)) {
            requester = {
                name: requesting_account_name,
                identity: IDENTITY_ENUM.ROOT_ACCOUNT
            };
            is_root_account_or_user_on_itself = true;
            return { is_root_account_or_user_on_itself, requester};
        }
        // user (on himself) - username can be undefined
        if (username === undefined || requesting_account_name === username) {
            const username_to_use = username ?? requesting_account_name;
            requester = {
                name: username_to_use,
                identity: IDENTITY_ENUM.USER
            };
            is_root_account_or_user_on_itself = true;
            return { is_root_account_or_user_on_itself, requester };
        }
        return { is_root_account_or_user_on_itself, requester };
    }

    // TODO reuse set_access_keys from manage_nsfs
    _generate_access_key() {
        let generated_access_key;
        let generated_secret_key;
        ({ access_key: generated_access_key, secret_key: generated_secret_key } = cloud_utils.generate_access_keys());
        generated_access_key = generated_access_key.unwrap();
        generated_secret_key = generated_secret_key.unwrap();
        return { generated_access_key, generated_secret_key};
    }

    _check_specific_access_key_exists(access_keys, access_key_to_find) {
        for (const access_key_obj of access_keys) {
            if (access_key_to_find === access_key_obj.access_key) {
                return true;
            }
        }
        return false;
    }

    _get_access_key_status(deactivated) {
        // we would like the default to be Active (so when it is undefined it would be Active)
        const status = deactivated ? ACCESS_KEY_STATUS_ENUM.INACTIVE : ACCESS_KEY_STATUS_ENUM.ACTIVE;
        return status;
    }

    _check_access_key_is_deactivated(status) {
        return status === ACCESS_KEY_STATUS_ENUM.INACTIVE;
    }

    _list_access_keys_from_account(account) {
        const members = [];
        for (const access_key of account.access_keys) {
            const member = {
                username: account.name,
                access_key: access_key.access_key,
                status: this._get_access_key_status(access_key.deactivated),
                create_date: access_key.creation_date ?? account.creation_date,
            };
            members.push(member);
        }
        return members;
    }

    _check_if_requesting_account_is_root_account_or_user_om_himself(action, requesting_account, username) {
        const { is_root_account_or_user_on_itself, requester } = this._check_root_account_or_user(
            requesting_account,
            username
        );
        dbg.log1(`AccountSpaceFS.${action} requesting_account ID: ${requesting_account._id}, name: ${requesting_account.name.unwrap()}`,
        'is_root_account_or_user_on_itself', is_root_account_or_user_on_itself);
        if (!is_root_account_or_user_on_itself) {
            dbg.error(`AccountSpaceFS.${action} requesting account is neither a root account ` +
            `nor user requester on himself`,
            requesting_account);
            this._throw_access_denied_error(action, requesting_account, { username }, native_fs_utils.entity_enum.USER);
        }
        return requester;
    }

    _check_number_of_access_key_array(action, requested_account) {
        if (requested_account.access_keys.length >= MAX_NUMBER_OF_ACCESS_KEYS) {
            dbg.error(`AccountSpaceFS.${action} requested account is not owned by root account `,
            requested_account);
            const message_with_details = `Cannot exceed quota for AccessKeysPerUser: ${MAX_NUMBER_OF_ACCESS_KEYS}.`;
            const { code, http_code, type } = IamError.LimitExceeded;
            throw new IamError({ code, message: message_with_details, http_code, type });
        }
    }

    async _check_if_account_exists_by_access_key_symlink(action, account_path, access_key_id) {
        const is_user_account_exists = await native_fs_utils.is_path_exists(this.fs_context, account_path);
        if (!is_user_account_exists) {
            this._throw_error_no_such_entity_access_key(action, access_key_id);
        }
    }

    _check_username_match_to_requested_account(action, username, requested_account) {
        if (username !== requested_account.name) {
            dbg.error(`AccountSpaceFS.${action} user with name ${username} cannot be found`);
            const message_with_details = `The user with name ${username} cannot be found.`;
            const { code, http_code, type } = IamError.NoSuchEntity;
            throw new IamError({ code, message: message_with_details, http_code, type });
        }
    }

    _check_if_requested_account_same_root_account_as_requesting_account(action, requesting_account, requested_account) {
        if (requesting_account.iam_operate_on_root_account) return;
        const root_account_id_requesting_account = requesting_account.owner || requesting_account._id; // if it is root account then there is no owner
        const root_account_id_requested = requested_account.owner || requested_account._id;
        if (root_account_id_requesting_account !== root_account_id_requested) {
            this._throw_error_perform_action_on_another_root_account(action, requesting_account, requested_account);
        }
    }

    _check_access_key_belongs_to_account(action, requested_account, access_key_id) {
        const is_access_key_belongs_to_account = this._check_specific_access_key_exists(requested_account.access_keys, access_key_id);
        if (!is_access_key_belongs_to_account) {
            this._throw_error_no_such_entity_access_key(action, access_key_id);
        }
    }

    // we will see it after changes in the account (user or access keys)
    // this change is limited to the specific endpoint that uses
    _clean_account_cache(requested_account) {
        for (const access_keys of requested_account.access_keys) {
            const access_key_id = access_keys.access_key;
            account_cache.invalidate_key(access_key_id);
        }
    }
}

// EXPORTS
module.exports = AccountSpaceFS;
