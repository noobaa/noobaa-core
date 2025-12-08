/* Copyright (C) 2025 NooBaa */
'use strict';

const account_util = require('../util/account_util');
const { IAM_DEFAULT_PATH} = require('../endpoint/iam/iam_constants');

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

    ////////////////////
    // USER METHODS  //
    ///////////////////

    async create_user(params, account_sdk) {
        const requesting_account = account_sdk.requesting_account;
        const account_email_wrapped = account_util.get_account_email_from_username(params.username, requesting_account._id);
        const req = {
                name: params.username, // actual username saved
                email: account_email_wrapped, // unique email generated from username lowercase and root account id
                has_login: false,
                s3_access: true,
                allow_bucket_creation: true,
                owner: requesting_account._id,
                iam_path: params.iam_path,
                roles: ['admin'],
            };
        const iam_account = await account_sdk.rpc_client.account.create_user(req);
        // TODO : Clean account cache
        // TODO : Send Event
        return {
            iam_path: params.iam_path || IAM_DEFAULT_PATH,
            username: params.username,
            user_id: iam_account.id,
            arn: iam_account.arn,
            create_date: iam_account.create_date,
        };
    }

    async get_user(params, account_sdk) {
        return account_sdk.rpc_client.account.get_user(params);
    }

    async update_user(params, account_sdk) {
        return account_sdk.rpc_client.account.update_user(params);
        // TODO : Clean account cache
        // TODO : Send Event
    }

    async delete_user(params, account_sdk) {
        return account_sdk.rpc_client.account.delete_user(params);
        // TODO : clean account cache

    }

    async list_users(params, account_sdk) {
        return account_sdk.rpc_client.account.list_users(params);

    }

    ///////////////////////////////
    // USER ACCESS KEY METHODS  //
    //////////////////////////////

    async create_access_key(params, account_sdk) {
        return account_sdk.rpc_client.account.create_access_key(params);
    }

    async get_access_key_last_used(params, account_sdk) {
        return account_sdk.rpc_client.account.get_access_key_last_used(params);
    }

    async update_access_key(params, account_sdk) {
        return account_sdk.rpc_client.account.update_access_key(params);
        // TODO : clean account cache
    }

    async delete_access_key(params, account_sdk) {
        return account_sdk.rpc_client.account.delete_access_key(params);
        // TODO : clean account cache
    }

    async list_access_keys(params, account_sdk) {
        return account_sdk.rpc_client.account.list_access_keys(params);
    }

    ////////////////////////
    // USER TAGS METHODS  //
    ////////////////////////

    async tag_user(params, account_sdk) {
        return account_sdk.rpc_client.account.tag_user(params);
    }

    async untag_user(params, account_sdk) {
        return account_sdk.rpc_client.account.untag_user(params);
    }

    async list_user_tags(params, account_sdk) {
        return account_sdk.rpc_client.account.list_user_tags(params);
    }

    /////////////////////
    // POLICY METHODS  //
    /////////////////////

    async put_user_policy(params, account_sdk) {
        return account_sdk.rpc_client.account.put_user_policy(params);
    }

    async get_user_policy(params, account_sdk) {
        return account_sdk.rpc_client.account.get_user_policy(params);
    }

    async delete_user_policy(params, account_sdk) {
        return account_sdk.rpc_client.account.delete_user_policy(params);
    }

    async list_user_policies(params, account_sdk) {
        return account_sdk.rpc_client.account.list_user_policies(params);
    }
}

// EXPORTS
module.exports = AccountSpaceNB;
