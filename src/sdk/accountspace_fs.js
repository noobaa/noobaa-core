/* Copyright (C) 2024 NooBaa */
'use strict';

const _ = require('lodash');
const config = require('../../config');
const LRUCache = require('../util/lru_cache');
const dbg = require('../util/debug_module')(__filename);
const P = require('../util/promise');
const { ConfigFS, CONFIG_TYPES } = require('./config_fs');
const native_fs_utils = require('../util/native_fs_utils');
const { create_arn_for_user, create_arn_for_root, get_action_message_title, check_iam_path_was_set } = require('../endpoint/iam/iam_utils');
const { IAM_ACTIONS, MAX_NUMBER_OF_ACCESS_KEYS, IAM_DEFAULT_PATH,
    ACCESS_KEY_STATUS_ENUM, IDENTITY_ENUM } = require('../endpoint/iam/iam_constants');
const IamError = require('../endpoint/iam/iam_errors').IamError;
const cloud_utils = require('../util/cloud_utils');
const SensitiveString = require('../util/sensitive_string');
const { generate_id } = require('../nc/nc_utils');
const nc_mkm = require('../manage_nsfs/nc_master_key_manager').get_instance();
const { account_cache } = require('./object_sdk');


////////////////////
// MOCK VARIABLES //
////////////////////
/* mock variables (until we implement the actual code), based on the example in AWS IAM API docs*/
const dummy_region = 'us-west-2';
const dummy_service_name = 's3';

const account_id_cache = new LRUCache({
    name: 'AccountIDCache',
    expiry_ms: config.ACCOUNTS_ID_CACHE_EXPIRY,
    make_key: ({ _id }) => _id,
    /**
     * Accounts are added to the cache based on id, Default value for show_secrets and decrypt_secret_key will be true, 
     * and show_secrets and decrypt_secret_key `false` only when we load cache from the health script, 
     * health script doesn't need to fetch or decrypt the secret.
     * @param {{
        * _id: string,
        * show_secrets?: boolean,
        * decrypt_secret_key?: boolean,
        * config_fs: ConfigFS
     * }} params
    */
    load: async ({ _id, show_secrets = true, decrypt_secret_key = true, config_fs }) =>
        config_fs.get_identity_by_id_and_stat_file(
            _id, CONFIG_TYPES.ACCOUNT, { show_secrets: show_secrets, decrypt_secret_key: decrypt_secret_key }),
    validate: (params, data) => _validate_account_id(params, data),
});

/** _validate_account_id is an additional layer (to expiry_ms)
 * to checks the stat of the config file
 * @param {object} data
 * @param {object} params
 * @returns Promise<{boolean>}
 */
async function _validate_account_id(params, data) {
    if (config.NC_ENABLE_ACCOUNT_ID_CACHE_STAT_VALIDATION) {
        const same_stat = await check_same_stat_account(params._id, params.name, params.stat, data.config_fs);
        if (!same_stat) { // config file of account was changed
            return false;
        }
    }
    return true;
}

    /**
     * check_same_stat_account will return true the config file was not changed
     * in case we had any issue (for example error during stat) the returned value will be undefined
     * @param {string} id
     * @param {string} account_name
     * @param {nb.NativeFSStats} account_stat
     * @param {ConfigFS} config_fs
     * @returns Promise<{boolean|undefined>}
     */
    async function check_same_stat_account(id, account_name, account_stat, config_fs) {
        if (!config_fs) return;
        try {
            const current_stat = await config_fs.stat_account_config_file_by_identity(id, account_name);
            if (current_stat) {
                return current_stat.ino === account_stat.ino && current_stat.mtimeNsBigint === account_stat.mtimeNsBigint;
            }
        } catch (err) {
            dbg.warn('check_same_stat_account: current_stat got an error', err, 'ignoring...');
        }
    }

/**
 * @param {Object} requested_account
 */
function _clean_account_id_cache(requested_account) {
    account_id_cache.invalidate_key(requested_account._id);
}

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
        this.config_root_backend = config_root_backend ?? config.NSFS_NC_CONFIG_DIR_BACKEND;
        this.stats = stats;
        this.fs_context = native_fs_utils.get_process_fs_context(
            this.config_root_backend,
            config.NSFS_WARN_THRESHOLD_MS,
            this.stats?.update_fs_stats
        );
        this.config_fs = new ConfigFS(config_root, this.config_root_backend, this.fs_context);
    }

    ////////////
    // USER   //
    ////////////

    // 1 - check that the requesting account is a root user account
    // 2 - check if username already exists:
    //   for users - only under the requesting account
    //   for accounts (by root accounts manager) - no other account with this name
    // 3 - copy the data from the root account user details to a new config file
    // note: when it is root account manager account name is returned in the username field,
    //       and the arn is arn root
    async create_user(params, account_sdk) {
        const action = IAM_ACTIONS.CREATE_USER;
        dbg.log1(`AccountSpaceFS.${action}`, params);
        try {
            const requesting_account = account_sdk.requesting_account;
            this._check_if_requesting_account_is_root_account(action, requesting_account,
                { username: params.username, iam_path: params.iam_path });
            await this._check_username_already_exists(action, params, requesting_account);
            const created_account = await this._copy_data_from_requesting_account_to_account_config(action, requesting_account, params);
            await this.config_fs.create_account_config_file(created_account);
            const account_id_for_arn = this._get_account_owner_id_for_arn(requesting_account, created_account);
            return {
                iam_path: created_account.iam_path || IAM_DEFAULT_PATH,
                username: created_account.name,
                user_id: created_account._id,
                arn: this._create_arn_for_account_or_user(account_id_for_arn, created_account, requesting_account),
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
    // if the requesting account is root account that gets IAM user:
    //    5 - check that the user to get is not a root account
    //    6 - check that the user account to get is owned by the root account
    // if the requesting account is root accounts manager that gets root account user:
    //    5 - check that the user to get is not an IAM user
    // note: when it is root account manager account name is returned in the username field,
    //       and the arn is arn root
    async get_user(params, account_sdk) {
        const action = IAM_ACTIONS.GET_USER;
        dbg.log1(`AccountSpaceFS.${action}`, params);
        try {
            const requesting_account = account_sdk.requesting_account;
            const { requester } = this._check_root_account_or_user(requesting_account, params.username);
            const username = params.username ?? requester.name; // username is not required
            // GAP - we do not have the user iam_path at this point (error message)
            this._check_if_requesting_account_is_root_account(action, requesting_account, { username: username });
            await this._check_if_account_config_file_exists(action, username, params, requesting_account);
            const owner_account_id = this._get_owner_account_argument(requesting_account);
            const account_to_get = await this.config_fs.get_account_or_user_by_name(username, owner_account_id);
            this._check_if_requested_account_is_root_account_or_IAM_user(action, requesting_account, account_to_get);
            this._check_if_requested_is_owned_by_root_account(action, requesting_account, account_to_get);
            const account_id_for_arn = this._get_account_owner_id_for_arn(requesting_account, account_to_get);
            return {
                user_id: account_to_get._id,
                iam_path: account_to_get.iam_path || IAM_DEFAULT_PATH,
                username: account_to_get.name,
                arn: this._create_arn_for_account_or_user(account_id_for_arn, account_to_get, requesting_account),
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
            const username = params.username;
            // GAP - we do not have the user iam_path at this point (error message)
            this._check_if_requesting_account_is_root_account(action, requesting_account,
                { username: username});
            await this._check_if_account_config_file_exists(action, username, params, requesting_account);
            const owner_account_id = this._get_owner_account_argument(requesting_account);
            const requested_account = await this.config_fs.get_account_or_user_by_name(username, owner_account_id,
                { show_secrets: true, decrypt_secret_key: true });
            this._check_if_requested_account_is_root_account_or_IAM_user(action, requesting_account, requested_account);
            this._check_if_requested_is_owned_by_root_account(action, requesting_account, requested_account);
            const is_username_update = params.new_username !== undefined &&
                params.new_username !== username;
            if (params.new_iam_path !== undefined) requested_account.iam_path = params.new_iam_path;
            if (is_username_update) {
                dbg.log1(`AccountSpaceFS.${action} username was updated, is_username_update`,
                    is_username_update);
                await this._update_account_config_new_username(action, params, requested_account, requesting_account);
            } else {
                await this.config_fs.update_account_config_file(requested_account);
            }
            this._clean_account_cache(requested_account);
            const account_id_for_arn = this._get_account_owner_id_for_arn(requesting_account, requested_account);
            return {
                iam_path: requested_account.iam_path || IAM_DEFAULT_PATH,
                username: requested_account.name,
                user_id: requested_account._id,
                arn: this._create_arn_for_account_or_user(account_id_for_arn, requested_account, requesting_account),
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
            const username = params.username;
            // GAP - we do not have the user iam_path at this point (error message)
            this._check_if_requesting_account_is_root_account(action, requesting_account, { username: params.username });
            await this._check_if_account_config_file_exists(action, username, params, requesting_account);
            const owner_account_id = this._get_owner_account_argument(requesting_account);
            const account_to_delete = await this.config_fs.get_account_or_user_by_name(
                username, owner_account_id, { show_secrets: true });
            this._check_if_requested_account_is_root_account_or_IAM_user(action, requesting_account, account_to_delete);
            this._check_if_requested_is_owned_by_root_account(action, requesting_account, account_to_delete);
            await this._check_if_user_does_not_have_resources_before_deletion(action, account_to_delete);
            await this.config_fs.delete_account_config_file(account_to_delete);
            _clean_account_id_cache(account_to_delete);
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
            const username = params.username ?? requester.name;
            const on_itself = !params.username;
            await this._check_if_account_config_file_exists(action, username, params, requesting_account);
            const owner_account_id = this._get_owner_account_argument(requesting_account);
            const requested_account = await this.config_fs.get_account_or_user_by_name(username,
                owner_account_id, { show_secrets: true, decrypt_secret_key: true });
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
            await this.config_fs.update_account_config_file(
                requested_account,
                { new_access_keys_to_link: [created_access_key_obj] }
            );
            return {
                username: this._returned_username(requesting_account, requested_account.name, on_itself),
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
            await this._check_if_account_exists_by_access_key_symlink(action, access_key_id);
            const requested_account = await this.config_fs.get_account_by_access_key(access_key_id, { show_secrets: true });
            this._check_if_requested_account_same_root_account_as_requesting_account(action,
                requesting_account, requested_account);
            if (requesting_account.iam_operate_on_root_account) {
                this._check_if_requested_account_is_root_account_or_IAM_user(action, requesting_account, requested_account);
            }
            const on_itself = requested_account._id === requesting_account._id;
            return {
                region: dummy_region, // GAP
                last_used_date: new Date(), // GAP
                service_name: dummy_service_name, // GAP
                username: this._returned_username(requesting_account, requested_account.name, on_itself),
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
            const requester = this._check_if_requesting_account_is_root_account_or_user_om_himself(action,
                requesting_account, params.username);
            const username = params.username ?? requester.name; // username is not required
            await this._check_if_account_exists_by_access_key_symlink(action, access_key_id);
            const requested_account = await this.config_fs.get_account_by_access_key(params.access_key,
                { show_secrets: true, decrypt_secret_key: true });
            this._check_username_match_to_requested_account(action, username, requested_account, params, access_key_id);
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
            await this.config_fs.update_account_config_file(requested_account);
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
            const requester = this._check_if_requesting_account_is_root_account_or_user_om_himself(action,
                requesting_account, params.username);
            const username = params.username ?? requester.name; // username is not required
            await this._check_if_account_exists_by_access_key_symlink(action, access_key_id);
            const requested_account = await this.config_fs.get_account_by_access_key(access_key_id, { show_secrets: true});
            this._check_username_match_to_requested_account(action, username, requested_account, params, access_key_id);
            this._check_access_key_belongs_to_account(action, requested_account, access_key_id);
            this._check_if_requested_account_same_root_account_as_requesting_account(action,
                requesting_account, requested_account);
            if (requesting_account.iam_operate_on_root_account) {
                this._check_if_requested_account_is_root_account_or_IAM_user(action, requesting_account, requested_account);
            }
            requested_account.access_keys = requested_account.access_keys.filter(access_key_obj =>
                access_key_obj.access_key !== access_key_id);
            await this.config_fs.update_account_config_file(
                requested_account,
                { access_keys_to_delete: [{ access_key: access_key_id }] }
            );
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
            const username = params.username ?? requester.name;
            const on_itself = !params.username;
            await this._check_if_account_config_file_exists(action, username, params, requesting_account);
            const owner_account_id = this._get_owner_account_argument(requesting_account);
            const requested_account = await this.config_fs.get_account_or_user_by_name(username,
                owner_account_id, { show_secrets: true });
            this._check_if_requested_account_same_root_account_as_requesting_account(action,
                requesting_account, requested_account);
            if (requesting_account.iam_operate_on_root_account) {
                this._check_if_requested_account_is_root_account_or_IAM_user(action, requesting_account, requested_account);
            }
            const is_truncated = false; // // GAP - no pagination at this point
            let members = this._list_access_keys_from_account(requesting_account, requested_account, on_itself);
            members = members.sort((a, b) => a.access_key.localeCompare(b.access_key));
            return { members, is_truncated, username: this._returned_username(requesting_account, requested_account.name, on_itself) };
        } catch (err) {
            dbg.error(`AccountSpaceFS.${action} error`, err);
            throw native_fs_utils.translate_error_codes(err, native_fs_utils.entity_enum.ACCESS_KEY);
        }
    }

    /////////////////////
    // OTHER FUNCTIONS //
    /////////////////////
    // The function here are implemented in AccountSpaceNB, but not in AccountSpaceFS
    // and will throw NotImplemented error, except for the function with list which will return an empty list

    async put_user_policy(params, account_sdk) {
        const action = IAM_ACTIONS.PUT_USER_POLICY;
        dbg.log1(`AccountSpaceFS.${action}`, params);
        const { code, http_code, type } = IamError.NotImplemented;
        throw new IamError({ code, message: 'NotImplemented', http_code, type });
    }

    async get_user_policy(params, account_sdk) {
        const action = IAM_ACTIONS.GET_USER_POLICY;
        dbg.log1(`AccountSpaceFS.${action}`, params);
        const { code, http_code, type } = IamError.NotImplemented;
        throw new IamError({ code, message: 'NotImplemented', http_code, type });
    }

    async delete_user_policy(params, account_sdk) {
        const action = IAM_ACTIONS.DELETE_USER_POLICY;
        dbg.log1(`AccountSpaceFS.${action}`, params);
        const { code, http_code, type } = IamError.NotImplemented;
        throw new IamError({ code, message: 'NotImplemented', http_code, type });
    }

    async list_user_policies(params, account_sdk) {
        const action = IAM_ACTIONS.LIST_USER_POLICIES;
        dbg.log1(`AccountSpaceFS.${action}`, params);
        dbg.log1('To check that we have the user we will run the IAM GET USER', params);
        await account_sdk.get_user(params);
        dbg.log1('IAM LIST USER POLICIES (returns empty list on every request)', params);
        const is_truncated = false;
        const members = [];
        return { members, is_truncated };
    }

    async tag_user(params, account_sdk) {
        const action = IAM_ACTIONS.TAG_USER;
        dbg.log1(`AccountSpaceFS.${action}`, params);
        const { code, http_code, type } = IamError.NotImplemented;
        throw new IamError({ code, message: 'NotImplemented', http_code, type });
    }

    async untag_user(params, account_sdk) {
        const action = IAM_ACTIONS.UNTAG_USER;
        dbg.log1(`AccountSpaceFS.${action}`, params);
        const { code, http_code, type } = IamError.NotImplemented;
        throw new IamError({ code, message: 'NotImplemented', http_code, type });
    }

    async list_user_tags(params, account_sdk) {
        const action = IAM_ACTIONS.LIST_USER_TAGS;
        dbg.log1(`AccountSpaceFS.${action}`, params);
        dbg.log1('To check that we have the user we will run the IAM GET USER', params);
        await account_sdk.get_user(params);
        dbg.log1('IAM LIST USER TAGS (returns empty list on every request)', params);
        const is_truncated = false;
        const tags = [];
        return { tags, is_truncated };
    }

    ////////////////////////
    // INTERNAL FUNCTIONS //
    ////////////////////////

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
                supplemental_groups: requesting_account.nsfs_account_config.supplemental_groups,
                new_buckets_path: requesting_account.nsfs_account_config.new_buckets_path,
                fs_backend: requesting_account.nsfs_account_config.fs_backend,
                custom_bucket_path_allowed_list: requesting_account.nsfs_account_config.custom_bucket_path_allowed_list,
                allow_bypass_governance: requesting_account.nsfs_account_config.allow_bypass_governance,
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
        return account.owner === undefined;
    }

    _check_root_account_owns_user(root_account, user_account) {
        if (user_account.owner === undefined) return false;
        return root_account._id === user_account.owner;
    }


    /**
     * _get_account_owner_id_for_arn will return the account ID
     * that we need for creating the ARN, the cases:
     *   1. iam user - it's owner property
     *   2. root account - it's account ID
     *   3. root accounts manager - the account ID of the account that it operates on
     * @param {object} requesting_account
     * @param {object} [requested_account]
     * @returns {string|undefined}
     */
    _get_account_owner_id_for_arn(requesting_account, requested_account) {
        if (!requesting_account.iam_operate_on_root_account) {
            if (requesting_account.owner !== undefined) {
                return requesting_account.owner;
            }
            return requesting_account._id;
        }
        return requested_account?._id;
    }

    /**
     * _get_owner_account_argument returns the account ID which is the owner account, the cases:
     *   1. root accounts manager - undefined (will not owned the root account)
     *   2. root account on iam user - his account ID
     *   3. iam user - it's owner property
     * @param {object} requesting_account
     */
    _get_owner_account_argument(requesting_account) {
        const is_root_account = this._check_root_account(requesting_account);
        if (is_root_account) {
            if (requesting_account.iam_operate_on_root_account) {
                return undefined;
            }
            return requesting_account._id;
        }
        return requesting_account.owner;
    }

    // TODO: move to IamError class with a template
    _throw_access_denied_error(action, requesting_account, details, entity) {
        const full_action_name = get_action_message_title(action);
        const account_id_for_arn = this._get_account_owner_id_for_arn(requesting_account);
        const arn_for_requesting_account = create_arn_for_user(account_id_for_arn,
            requesting_account.name.unwrap(), requesting_account.iam_path);
        const basic_message = `User: ${arn_for_requesting_account} is not authorized to perform: ` +
        `${full_action_name} on resource: `;
        let message_with_details;
        if (entity === native_fs_utils.entity_enum.USER) {
            let user_message;
            if (action === IAM_ACTIONS.LIST_ACCESS_KEYS) {
                user_message = `user ${details.username}`;
            } else {
                user_message = create_arn_for_user(account_id_for_arn, details.username, details.path);
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
        const message_with_details = `The Access Key with id ${access_key_id} cannot be found.`;
        const { code, http_code, type } = IamError.NoSuchEntity;
        throw new IamError({ code, message: message_with_details, http_code, type });
    }

    async _list_config_files_for_users(requesting_account, iam_path_prefix) {
        let names;
        let owner_account_id;
        if (requesting_account.iam_operate_on_root_account) {
            const accounts_names = await this.config_fs.list_accounts();
            names = accounts_names;
            owner_account_id = undefined;
        } else {
            const usernames = await this.config_fs.list_users_under_account(requesting_account._id);
            names = usernames;
            owner_account_id = requesting_account._id;
        }
        const should_filter_by_prefix = check_iam_path_was_set(iam_path_prefix);

        const config_files_list = await P.map_with_concurrency(10, names, async name => {
            const account_data = await this.config_fs.get_account_or_user_by_name(name, owner_account_id);
            if (!account_data) return undefined;
            const account_id_for_arn = this._get_account_owner_id_for_arn(requesting_account, account_data);
            if (should_filter_by_prefix) {
                if (account_data.iam_path === undefined) return undefined;
                if (!account_data.iam_path.startsWith(iam_path_prefix)) return undefined;
            }
            const user_data = {
                user_id: account_data._id,
                iam_path: account_data.iam_path || IAM_DEFAULT_PATH,
                username: account_data.name,
                arn: this._create_arn_for_account_or_user(account_id_for_arn, account_data, requesting_account),
                create_date: account_data.creation_date,
                password_last_used: Date.now(), // GAP
            };
            return user_data;
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

    async _check_username_already_exists(action, params, requesting_account) {
        const owner_account_id = this._get_owner_account_argument(requesting_account);
        const username = params.username;
        const file_name_exists = await this.config_fs.is_account_exists_by_name(username, owner_account_id);
        if (file_name_exists) {
            this._throw_error_if_account_already_exists(action, username);
        }
        const is_username_lowercase_exists_under_owner = await this._check_if_account_exists_under_the_owner(
            requesting_account, username);
        if (is_username_lowercase_exists_under_owner) {
            this._throw_error_if_account_already_exists(action, username);
        }
    }

    _throw_error_if_account_already_exists(action, username) {
        dbg.error(`AccountSpaceFS.${action} username already exists`, username);
        const message_with_details = `User with name ${username} already exists.`;
        const { code, http_code, type } = IamError.EntityAlreadyExists;
        throw new IamError({ code, message: message_with_details, http_code, type });
    }

    async _check_if_account_exists_under_the_owner(requesting_account, username) {
        const members = await this._list_config_files_for_users(requesting_account, undefined);
        for (const member of members) {
            if (member.username.toLowerCase() === username.toLowerCase()) {
                return true;
            }
        }
        return false;
    }

    async _copy_data_from_requesting_account_to_account_config(action, requesting_account, params) {
        const master_key_id = await nc_mkm.get_active_master_key_id();
        const created_account = this._new_user_defaults(requesting_account, params, master_key_id);
        dbg.log1(`AccountSpaceFS.${action} new_account`, created_account);
        return created_account;
    }

    async _check_if_account_config_file_exists(action, username, params, requesting_account) {
        const owner_account_id = this._get_owner_account_argument(requesting_account);
        const is_user_account_exists = await this.config_fs.is_account_exists_by_name(username, owner_account_id);
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

    async _check_if_root_account_does_not_have_buckets_before_deletion(action, account_to_delete) {
        const resource_name = 'buckets';
        const bucket_names = await this.config_fs.list_buckets();
        await P.map_with_concurrency(10, bucket_names, async bucket_name => {
            const bucket_data = await this.config_fs.get_bucket_by_name(bucket_name, { silent_if_missing: true});
            if (bucket_data && bucket_data.owner_account === account_to_delete._id) {
                this._throw_error_delete_conflict(action, account_to_delete, resource_name);
            }
            return bucket_data;
        });
    }

    async _check_if_root_account_does_not_have_IAM_users_before_deletion(action, account_to_delete) {
        const resource_name = 'IAM users';
        const usernames = await this.config_fs.list_users_under_account(account_to_delete._id);
        if (usernames.length > 0) {
            this._throw_error_delete_conflict(action, account_to_delete, resource_name);
        }
    }

    _check_if_user_does_not_have_access_keys_before_deletion(action, account_to_delete) {
        const resource_name = 'access keys';
        const access_keys = account_to_delete.access_keys || [];
        const is_access_keys_empty = access_keys.length === 0;
        if (!is_access_keys_empty) {
            this._throw_error_delete_conflict(action, account_to_delete, resource_name);
        }
    }

    async _update_account_config_new_username(action, params, requested_account, requesting_account) {
        await this._check_username_already_exists(action, { username: params.new_username },
            requesting_account);
        // prepare
        requested_account.name = params.new_username;
        requested_account.email = params.new_username; // internally saved
        // handle account config creation
        await this.config_fs.update_account_config_file(requested_account, { old_name: params.username });
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

    /**
     * _create_arn_for_account_or_user would create 2 types of arn:
     * 1. arn root - would be created for root accounts manager on root account
     * 2. arn user - would be created for IAM user
     * @param {string} account_id_for_arn
     * @param {object} requested_account
     * @param {object} requesting_account
     */
    _create_arn_for_account_or_user(account_id_for_arn, requested_account, requesting_account) {
        if (requesting_account.iam_operate_on_root_account) {
            return create_arn_for_root(account_id_for_arn);
        }
        return create_arn_for_user(account_id_for_arn, requested_account.name, requested_account.iam_path);
    }

    /**
    * _returned_username would return the username of IAM Access key API:
     * 1. undefined - for root accounts manager on root account (no username, only account name)
     *                for root account on itself 
     * 2. username - for IAM user
     * @param {object} requesting_account
     * @param {string} username
     * @param {boolean} on_itself
     */
    _returned_username(requesting_account, username, on_itself) {
        if ((requesting_account.iam_operate_on_root_account) ||
            (this._check_root_account(requesting_account) && on_itself)) {
                return undefined;
        }
        return username;
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

    _list_access_keys_from_account(requesting_account, account, on_itself) {
        const members = [];
        for (const access_key of account.access_keys) {
            const member = {
                username: this._returned_username(requesting_account, account.name, on_itself),
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
            dbg.error(`AccountSpaceFS.${action} number of access keys exceeded for requested_account ID`,
            requested_account._id, requested_account.access_keys.length, 'max allowed', MAX_NUMBER_OF_ACCESS_KEYS);
            const message_with_details = `Cannot exceed quota for AccessKeysPerUser: ${MAX_NUMBER_OF_ACCESS_KEYS}.`;
            const { code, http_code, type } = IamError.LimitExceeded;
            throw new IamError({ code, message: message_with_details, http_code, type });
        }
    }

    async _check_if_account_exists_by_access_key_symlink(action, access_key_id) {
        const is_user_account_exists = await this.config_fs.is_account_exists_by_access_key(access_key_id);
        if (!is_user_account_exists) {
            this._throw_error_no_such_entity_access_key(action, access_key_id);
        }
    }

    _check_username_match_to_requested_account(action, username, requested_account, params, access_key_id) {
        // --user-name flag was passed
        if (params.username && username !== requested_account.name) {
            dbg.error(`AccountSpaceFS.${action} user with name ${username} cannot be found`);
            const message_with_details = `The user with name ${username} cannot be found.`;
            const { code, http_code, type } = IamError.NoSuchEntity;
            throw new IamError({ code, message: message_with_details, http_code, type });
        }
        // --user-name flag was not passed
        if (username !== requested_account.name) {
            dbg.error(`AccountSpaceFS.${action} user with name ${username} cannot be found`);
            const message_with_details = `The Access Key with id ${access_key_id} cannot be found.`;
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
        _clean_account_id_cache(requested_account);
    }
}

// EXPORTS
module.exports = AccountSpaceFS;
module.exports.account_id_cache = account_id_cache;
