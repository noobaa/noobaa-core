/* Copyright (C) 2024 NooBaa */
'use strict';

const _ = require('lodash');
const SensitiveString = require('../util/sensitive_string');
const account_util = require('../util/account_util');
const iam_utils = require('../endpoint/iam/iam_utils');
const dbg = require('../util/debug_module')(__filename);
const native_fs_utils = require('../util/native_fs_utils');
const system_store = require('..//server/system_services/system_store').get_instance();
const { IAM_ACTIONS, IAM_DEFAULT_PATH, ACCESS_KEY_STATUS_ENUM,
    IAM_SPLIT_CHARACTERS } = require('../endpoint/iam/iam_constants');


const dummy_region = 'us-west-2';
const dummy_service_name = 's3';
/* 
    TODO: DISCUSS: 
    1. IAM API only for account created using IAM API and OBC accounts not from admin, support, 
       operator and account created using noobaa.
    2. Do we need to have two access keys
    3. get_access_key_last_used() API call could return dummy values?
*/

/**
 * @implements {nb.AccountSpace}
 */
class AccountSpaceNB {
    /**
     * @param {{
     *      rpc_client: nb.APIClient;
     *      internal_rpc_client: nb.APIClient;
     *      stats?: import('./endpoint_stats_collector').EndpointStatsCollector;
     * }} params
     */
    constructor({ rpc_client, internal_rpc_client, stats }) {
        this.rpc_client = rpc_client;
        this.internal_rpc_client = internal_rpc_client;
        this.stats = stats;
    }

    //////////////////////
    // ACCOUNT METHODS  //
    //////////////////////

    async create_user(params, account_sdk) {

        const action = IAM_ACTIONS.CREATE_USER;
        const requesting_account = system_store.get_account_by_email(account_sdk.requesting_account.email);
        account_util._check_if_requesting_account_is_root_account(action, requesting_account,
                { username: params.username, path: params.iam_path });
        account_util._check_username_already_exists(action, params, requesting_account);
        const iam_arn = iam_utils.create_arn_for_user(requesting_account._id.toString(), params.username, params.iam_path);
        const account_name = account_util.populate_username(params.username, requesting_account.name.unwrap());
        const req = {
            rpc_params: {
                name: account_name,
                email: account_name,
                has_login: false,
                s3_access: true,
                allow_bucket_creation: true,
                owner: requesting_account._id.toString(),
                is_iam: true,
                iam_arn: iam_arn,
                iam_path: params.iam_path,
                role: 'iam_user',

                // TODO: default_resource remove
                default_resource: 'noobaa-default-backing-store',
            },
            account: requesting_account,
        };
        // CORE CHANGES PENDING - START
        const iam_account = await account_util.create_account(req);
        // CORE CHANGES PENDING - END

        // TODO : Clean account cache
        // TODO : Send Event
        const requested_account = system_store.get_account_by_email(account_name);
        return {
            iam_path: requested_account.iam_path || IAM_DEFAULT_PATH,
            username: params.username,
            user_id: iam_account.id,
            arn: iam_arn,
            create_date: iam_account.create_date,
        };

    }

    async get_user(params, account_sdk) {
        const action = IAM_ACTIONS.GET_USER;
        const requesting_account = system_store.get_account_by_email(account_sdk.requesting_account.email);
        const account_name = account_util.populate_username(params.username, requesting_account.name.unwrap());
        const requested_account = system_store.get_account_by_email(account_name);
        account_util._check_if_requesting_account_is_root_account(action, requesting_account,
                { username: params.username, iam_path: params.iam_path });
        account_util._check_if_account_exists(action, account_name);
        account_util._check_if_requested_account_is_root_account_or_IAM_user(action, requesting_account, requested_account);
        account_util._check_if_requested_is_owned_by_root_account(action, requesting_account, requested_account);
        const reply = {
            user_id: requested_account._id.toString(),
            // TODO : IAM PATH
            iam_path: requested_account.iam_path || IAM_DEFAULT_PATH,
            username: account_util.get_iam_username(requested_account.name.unwrap()),
            arn: requested_account.iam_arn,
            // TODO: GAP Need to save created date
            create_date: new Date(),
            // TODO: Dates missing : GAP
            password_last_used: new Date(),
        };
        return reply;
    }

    async update_user(params, account_sdk) {
        const action = IAM_ACTIONS.UPDATE_USER;
        const requesting_account = system_store.get_account_by_email(account_sdk.requesting_account.email);
        const username = account_util.populate_username(params.username, requesting_account.name.unwrap());
        account_util._check_if_requesting_account_is_root_account(action, requesting_account,
                { username: params.username, iam_path: params.iam_path });
        account_util._check_if_account_exists(action, username);
        const requested_account = system_store.get_account_by_email(username);
        let iam_path = requested_account.iam_path;
        let user_name = requested_account.name.unwrap();
        account_util._check_username_already_exists(action, { username: params.new_username }, requesting_account);
        account_util._check_if_requested_account_is_root_account_or_IAM_user(action, requesting_account, requested_account);
        account_util._check_if_requested_is_owned_by_root_account(action, requesting_account, requested_account);
        if (params.new_iam_path !== undefined) iam_path = params.new_iam_path;
        if (params.new_username !== undefined) user_name = params.new_username;
        const iam_arn = iam_utils.create_arn_for_user(requested_account._id.toString(), user_name, iam_path);
        const new_account_name = new SensitiveString(`${params.new_username}:${requesting_account.name.unwrap()}`);
        const updates = {
            name: new_account_name,
            email: new_account_name,
            iam_arn: iam_arn,
            iam_path: iam_path,
        };
        // CORE CHANGES PENDING - START
        await system_store.make_changes({
            update: {
                accounts: [{
                    _id: requested_account._id,
                    $set: _.omitBy(updates, _.isUndefined),
                }]
            }
        });
        // CORE CHANGES PENDING - END
        // TODO : Clean account cache
        // TODO : Send Event
        return {
            // TODO: IAM path needs to be saved
            iam_path: iam_path || IAM_DEFAULT_PATH,
            username: user_name,
            user_id: requested_account._id.toString(),
            arn: iam_arn
        };

    }

    async delete_user(params, account_sdk) {
        const action = IAM_ACTIONS.DELETE_USER;
        const requesting_account = system_store.get_account_by_email(account_sdk.requesting_account.email);
        const username = account_util.populate_username(params.username, requesting_account.name.unwrap());
        account_util._check_if_requesting_account_is_root_account(action, requesting_account, { username: params.username });
        account_util._check_if_account_exists(action, username);
        const requested_account = system_store.get_account_by_email(username);
        account_util._check_if_requested_account_is_root_account_or_IAM_user(action, requesting_account, requested_account);
        account_util._check_if_requested_is_owned_by_root_account(action, requesting_account, requested_account);
        // TODO: DELETE INLINE POLICY : Manually
        // TODO: DELETE ACCESS KEY : manually
        const req = {
            system: system_store.data.systems[0],
            account: requested_account,
        };
        // CORE CHANGES PENDING - START
        return account_util.delete_account(req, requested_account);
        // CORE CHANGES PENDING - END
        // TODO : clean account cache

    }

    async list_users(params, account_sdk) {
        const action = IAM_ACTIONS.LIST_USERS;
        const requesting_account = system_store.get_account_by_email(account_sdk.requesting_account.email);
        account_util._check_if_requesting_account_is_root_account(action, requesting_account, { });
        const is_truncated = false; // GAP - no pagination at this point

        const root_name = requesting_account.name.unwrap();
        // CORE CHANGES PENDING - START
        const requesting_account_iam_users = _.filter(system_store.data.accounts, function(acc) {
            if (!acc.name.unwrap().includes(IAM_SPLIT_CHARACTERS)) {
                return false;
            }
            return acc.name.unwrap().split(IAM_SPLIT_CHARACTERS)[1] === root_name;
        });
        let members = _.map(requesting_account_iam_users, function(iam_user) {
            const member = {
                user_id: iam_user._id.toString(),
                iam_path: iam_user.iam_path || IAM_DEFAULT_PATH,
                username: iam_user.name.unwrap().split(IAM_SPLIT_CHARACTERS)[0],
                arn: iam_user.iam_arn,
                // TODO: GAP Need to save created date
                create_date: new Date(),
                // TODO: GAP Miising password_last_used
                password_last_used: Date.now(), // GAP
            };
            return member;
        });
        // CORE CHANGES PENDING - END
        members = members.sort((a, b) => a.username.localeCompare(b.username));
        return { members, is_truncated };
    }

    /////////////////////////////////
    // ACCOUNT ACCESS KEY METHODS  //
    /////////////////////////////////

    async create_access_key(params, account_sdk) {
        const action = IAM_ACTIONS.CREATE_ACCESS_KEY;
        const requesting_account = system_store.get_account_by_email(account_sdk.requesting_account.email);
        const account_name = account_util.populate_username(params.username, requesting_account.name.unwrap());
        account_util._check_if_account_exists(action, account_name);
        const requested_account = system_store.get_account_by_email(account_name);
        account_util._check_if_requesting_account_is_root_account(action, requesting_account, { username: params.username });
        account_util._check_if_requested_account_is_root_account_or_IAM_user(action, requesting_account, requested_account);
        account_util._check_if_requested_is_owned_by_root_account(action, requesting_account, requested_account);
        account_util._check_number_of_access_key_array(action, requested_account);
        const req = {
            rpc_params: {
                email: account_name,
                is_iam: true,
            },
            account: requesting_account,
        };
        // CORE CHANGES PENDING - START
        let iam_access_key;
        try {
            iam_access_key = await account_util.generate_account_keys(req);
        } catch (err) {
            dbg.error(`AccountSpaceNB.${action} error: `, err);
            throw native_fs_utils.translate_error_codes(err, native_fs_utils.entity_enum.ACCESS_KEY);
        }

        // CORE CHANGES PENDING - STOP

        return {
            username: requested_account.name.unwrap().split(IAM_SPLIT_CHARACTERS)[0],
            access_key: iam_access_key.access_key.unwrap(),
            create_date: new Date(),
            status: ACCESS_KEY_STATUS_ENUM.ACTIVE,
            secret_key: iam_access_key.secret_key.unwrap(),
        };
    }

    async get_access_key_last_used(params, account_sdk) {
        const action = IAM_ACTIONS.GET_ACCESS_KEY_LAST_USED;
        const requesting_account = system_store.get_account_by_email(account_sdk.requesting_account.email);
        account_util._check_access_key_belongs_to_account(action, requesting_account, params.access_key);
        // TODO: Need to return valid last_used_date date, Low priority.
        const username = account_util._returned_username(requesting_account, requesting_account.name.unwrap(), false);
        return {
            region: dummy_region, // GAP
            last_used_date: new Date(), // GAP
            service_name: dummy_service_name, // GAP
            username: account_util.get_iam_username(username),
        };
    }

    async update_access_key(params, account_sdk) {
        const action = IAM_ACTIONS.UPDATE_ACCESS_KEY;
        // TODO: try catch
        const access_key_id = params.access_key;
        const requesting_account = system_store.get_account_by_email(account_sdk.requesting_account.email);
        const iam_username = account_util.populate_username(params.username, requesting_account.name.unwrap());
        account_util._check_if_account_exists(action, iam_username);
        const requested_account = system_store.get_account_by_email(iam_username);
        account_util._check_if_requesting_account_is_root_account(action, requesting_account, { username: params.username });
        account_util._check_if_requested_account_is_root_account_or_IAM_user(action, requesting_account, requested_account);
        account_util._check_if_requested_is_owned_by_root_account(action, requesting_account, requested_account);
        account_util._check_access_key_belongs_to_account(action, requested_account, access_key_id);

        const updating_access_key_obj = _.find(requested_account.access_keys,
            access_key => access_key.access_key.unwrap() === access_key_id);
        if (account_util._get_access_key_status(updating_access_key_obj.deactivated) === params.status) {
            // note: master key might be changed and we do not update it since we do not updating the database
            // we can change this behavior - a matter of decision
            dbg.log0(`AccountSpaceNB.${action} status was not change, not updating the database`);
            return;
        }
        const filtered_access_keys = requested_account.access_keys.filter(access_key => access_key.access_key.unwrap() !== access_key_id);
        if (filtered_access_keys.length > 0) {
            filtered_access_keys[0].secret_key = system_store.master_key_manager.encrypt_sensitive_string_with_master_key_id(
                        filtered_access_keys[0].secret_key, requested_account.master_key_id._id);
        }
        updating_access_key_obj.deactivated = account_util._check_access_key_is_deactivated(params.status);
        updating_access_key_obj.secret_key = system_store.master_key_manager
            .encrypt_sensitive_string_with_master_key_id(updating_access_key_obj.secret_key, requested_account.master_key_id._id);
        filtered_access_keys.push(updating_access_key_obj);

        await system_store.make_changes({
            update: {
                accounts: [{
                    _id: requested_account._id,
                    $set: { access_keys: filtered_access_keys }
                }]
            }
        });
        // TODO : clean account cache
    }

    async delete_access_key(params, account_sdk) {
        const action = IAM_ACTIONS.DELETE_ACCESS_KEY;
        const access_key_id = params.access_key;
        const requesting_account = system_store.get_account_by_email(account_sdk.requesting_account.email);
        const iam_username = account_util.populate_username(params.username, requesting_account.name.unwrap());
        account_util._check_if_account_exists(action, iam_username);
        const requested_account = system_store.get_account_by_email(iam_username);
        account_util._check_if_requesting_account_is_root_account(action, requesting_account, { username: params.username });
        account_util._check_if_requested_account_is_root_account_or_IAM_user(action, requesting_account, requested_account);
        account_util._check_if_requested_is_owned_by_root_account(action, requesting_account, requested_account);
        account_util._check_access_key_belongs_to_account(action, requested_account, access_key_id);
        account_util._check_specific_access_key_inactive(action, access_key_id, requested_account);

        const filtered_access_keys = requested_account.access_keys.filter(access_key =>
                                        access_key.access_key.unwrap() !== access_key_id) || undefined;
        // TODO: Check undefined or []
        if (filtered_access_keys && filtered_access_keys.length > 0) {
            filtered_access_keys[0].secret_key = system_store.master_key_manager
                .encrypt_sensitive_string_with_master_key_id(filtered_access_keys[0].secret_key,
                    requested_account.master_key_id._id);
        }
        const updates = {
            access_keys: filtered_access_keys,
        };
        await system_store.make_changes({
            update: {
                accounts: [{
                    _id: requested_account._id,
                    $set: _.omitBy(updates, _.isUndefined),
                }]
            }
        });
        // TODO : clean account cache
    }

    async list_access_keys(params, account_sdk) {
        const action = IAM_ACTIONS.LIST_ACCESS_KEYS;
        const requesting_account = system_store.get_account_by_email(account_sdk.requesting_account.email);
        const iam_username = account_util.populate_username(params.username, requesting_account.name.unwrap());
        account_util._check_if_account_exists(action, iam_username);
        const requested_account = system_store.get_account_by_email(iam_username);
        account_util._check_if_requesting_account_is_root_account(action, requesting_account, { username: params.username });
        account_util._check_if_requested_account_is_root_account_or_IAM_user(action, requesting_account, requested_account);
        account_util._check_if_requested_is_owned_by_root_account(action, requesting_account, requested_account);

        const is_truncated = false; // // GAP - no pagination at this point
        let members = account_util._list_access_keys_from_account(requesting_account, requested_account, false);
            members = members.sort((a, b) => a.access_key.localeCompare(b.access_key));
            return { members, is_truncated,
                username: account_util._returned_username(requesting_account, requested_account.name.unwrap(), false) };
    }
}

// EXPORTS
module.exports = AccountSpaceNB;
