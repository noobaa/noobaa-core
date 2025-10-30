/* Copyright (C) 2024 NooBaa */
'use strict';

const _ = require('lodash');
const SensitiveString = require('../util/sensitive_string');
const account_util = require('../util/account_util');
const iam_utils = require('../endpoint/iam/iam_utils');
const dbg = require('../util/debug_module')(__filename);
const system_store = require('..//server/system_services/system_store').get_instance();
// const { account_cache } = require('./object_sdk');
const IamError = require('../endpoint/iam/iam_errors').IamError;
const { IAM_ACTIONS, IAM_DEFAULT_PATH, IAM_SPLIT_CHARACTERS, DEFAULT_MAX_TAGS } = require('../endpoint/iam/iam_constants');


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
        // GAP - we do not have the user iam_path at this point (error message)
        //const requesting_account = account_sdk.requesting_account;
        const requesting_account = system_store.get_account_by_email(account_sdk.requesting_account.email);
        const username = account_util.populate_username(params.username, requesting_account.name.unwrap());
        account_util._check_if_requesting_account_is_root_account(action, requesting_account, { username: params.username });
        account_util._check_if_account_exists(action, username);
        const requested_account = system_store.get_account_by_email(username);
        account_util._check_if_requested_account_is_root_account_or_IAM_user(action, requesting_account, requested_account);
        //const root_account = system_store.get_account_by_email(requesting_account.email);
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
        //const requesting_account = account_sdk.requesting_account;
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
        // TODO
        dbg.log0('AccountSpaceNB.create_access_key:', params);
        const { code, http_code, type } = IamError.NotImplemented;
        throw new IamError({ code, message: 'NotImplemented', http_code, type });
    }

    async get_access_key_last_used(params, account_sdk) {
        dbg.log0('AccountSpaceNB.get_access_key_last_used:', params);
        const { code, http_code, type } = IamError.NotImplemented;
        throw new IamError({ code, message: 'NotImplemented', http_code, type });
    }

    async update_access_key(params, account_sdk) {
        dbg.log0('AccountSpaceNB.update_access_key:', params);
        const { code, http_code, type } = IamError.NotImplemented;
        throw new IamError({ code, message: 'NotImplemented', http_code, type });
    }

    async delete_access_key(params, account_sdk) {
        dbg.log0('AccountSpaceNB.delete_access_key:', params);
        const { code, http_code, type } = IamError.NotImplemented;
        throw new IamError({ code, message: 'NotImplemented', http_code, type });
    }

    async list_access_keys(params, account_sdk) {
        dbg.log0('AccountSpaceNB.list_access_keys:', params);
        const { code, http_code, type } = IamError.NotImplemented;
        throw new IamError({ code, message: 'NotImplemented', http_code, type });
    }

    ///////////////////////////
    // ACCOUNT TAGS METHODS  //
    ///////////////////////////

    async tag_user(params, account_sdk) {
        const action = IAM_ACTIONS.TAG_USER;
        const requesting_account = system_store.get_account_by_email(account_sdk.requesting_account.email);
        const username = account_util.populate_username(params.username, requesting_account.name.unwrap());

        account_util._check_if_requesting_account_is_root_account(action, requesting_account, { username: params.username });
        account_util._check_if_account_exists(action, username);

        const requested_account = system_store.get_account_by_email(username);
        account_util._check_if_requested_account_is_root_account_or_IAM_user(action, requesting_account, requested_account);
        account_util._check_if_requested_is_owned_by_root_account(action, requesting_account, requested_account);

        const existing_tags = requested_account.tagging || [];

        const tags_map = new Map();
        for (const tag of existing_tags) {
            tags_map.set(tag.key, tag.value);
        }
        for (const tag of params.tags) {
            tags_map.set(tag.key, tag.value);
        }

        // enforce AWS 50-tag limit after merging
        if (tags_map.size > DEFAULT_MAX_TAGS) {
            const message_with_details = `Failed to tag user. User cannot have more than ${DEFAULT_MAX_TAGS} tags.`;
            const { code, http_code, type } = IamError.LimitExceeded;
            throw new IamError({ code, message: message_with_details, http_code, type });
        }

        const updated_tags = Array.from(tags_map.entries()).map(([key, value]) => ({ key, value }));

        await system_store.make_changes({
            update: {
                accounts: [{
                    _id: requested_account._id,
                    $set: { tagging: updated_tags }
                }]
            }
        });

        dbg.log1('AccountSpaceNB.tag_user: successfully tagged user', params.username, 'with', params.tags.length, 'tags');
    }

    async untag_user(params, account_sdk) {
        const action = IAM_ACTIONS.UNTAG_USER;
        const requesting_account = system_store.get_account_by_email(account_sdk.requesting_account.email);
        const username = account_util.populate_username(params.username, requesting_account.name.unwrap());

        account_util._check_if_requesting_account_is_root_account(action, requesting_account, { username: params.username });
        account_util._check_if_account_exists(action, username);

        const requested_account = system_store.get_account_by_email(username);
        account_util._check_if_requested_account_is_root_account_or_IAM_user(action, requesting_account, requested_account);
        account_util._check_if_requested_is_owned_by_root_account(action, requesting_account, requested_account);

        const existing_tags = requested_account.tagging || [];

        const tag_keys_set = new Set(params.tag_keys);
        const updated_tags = existing_tags.filter(tag => !tag_keys_set.has(tag.key));

        await system_store.make_changes({
            update: {
                accounts: [{
                    _id: requested_account._id,
                    $set: { tagging: updated_tags }
                }]
            }
        });

        dbg.log1('AccountSpaceNB.untag_user: successfully removed', params.tag_keys.length, 'tags from user', params.username);
    }

    async list_user_tags(params, account_sdk) {
        const action = IAM_ACTIONS.LIST_USER_TAGS;
        const requesting_account = system_store.get_account_by_email(account_sdk.requesting_account.email);
        const username = account_util.populate_username(params.username, requesting_account.name.unwrap());

        account_util._check_if_requesting_account_is_root_account(action, requesting_account, { username: params.username });
        account_util._check_if_account_exists(action, username);

        const requested_account = system_store.get_account_by_email(username);
        account_util._check_if_requested_account_is_root_account_or_IAM_user(action, requesting_account, requested_account);
        account_util._check_if_requested_is_owned_by_root_account(action, requesting_account, requested_account);

        const all_tags = requested_account.tagging || [];

        const sorted_tags = all_tags.sort((a, b) => a.key.localeCompare(b.key));

        let start_index = 0;
        if (params.marker) {
            start_index = sorted_tags.findIndex(tag => tag.key === params.marker);
            if (start_index === -1) {
                start_index = 0;
            } else {
                start_index += 1;
            }
        }

        const max_items = params.max_items;
        const end_index = start_index + max_items;
        const paginated_tags = sorted_tags.slice(start_index, end_index);

        const tags = paginated_tags.map(tag => ({
            member: {
                Key: tag.key,
                Value: tag.value
            }
        }));

        const is_truncated = end_index < sorted_tags.length;
        const marker = is_truncated && paginated_tags.length > 0 ? paginated_tags[paginated_tags.length - 1].key : undefined;

        dbg.log1('AccountSpaceNB.list_user_tags: returning', tags.length, 'tags for user', params.username);

        const response = {
            tags,
            is_truncated
        };

        if (is_truncated && marker) {
            response.marker = marker;
        }

        return response;
    }

    ////////////////////
    // POLICY METHODS //
    ////////////////////
}

// EXPORTS
module.exports = AccountSpaceNB;
