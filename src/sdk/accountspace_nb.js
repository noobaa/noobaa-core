/* Copyright (C) 2024 NooBaa */
'use strict';

const account_util = require('../util/account_util');
const system_store = require('..//server/system_services/system_store').get_instance();
const { IAM_DEFAULT_PATH} = require('../endpoint/iam/iam_constants');

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

        const requesting_account = system_store.get_account_by_email(account_sdk.requesting_account.email);
        const account_email_wrapped = account_util.get_account_email_from_username(params.username, requesting_account._id.toString());
        const req = {
                name: params.username, // actual username saved
                email: account_email_wrapped, // unique email generated from username lowercase and root account id
                has_login: false,
                s3_access: true,
                allow_bucket_creation: true,
                owner: requesting_account._id.toString(),
                iam_path: params.iam_path,
                roles: ['admin'],
                // TODO: default_resource remove
                default_resource: requesting_account.default_resource.name,
            };
        const iam_account = await account_sdk.rpc_client.account.create_user(req, requesting_account);
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
        const requesting_account = system_store.get_account_by_email(account_sdk.requesting_account.email);
        return await account_sdk.rpc_client.account.get_user(params, requesting_account);
    }

    async update_user(params, account_sdk) {

        const requesting_account = system_store.get_account_by_email(account_sdk.requesting_account.email);
        return await account_sdk.rpc_client.account.update_user(params, requesting_account);
        // TODO : Clean account cache
        // TODO : Send Event
    }

    async delete_user(params, account_sdk) {
        const requesting_account = system_store.get_account_by_email(account_sdk.requesting_account.email);
        return await account_sdk.rpc_client.account.delete_user(params, requesting_account);
        // TODO : clean account cache

    }

    async list_users(params, account_sdk) {
        const requesting_account = system_store.get_account_by_email(account_sdk.requesting_account.email);
        return await account_sdk.rpc_client.account.list_users(params, requesting_account);

    }

    /////////////////////////////////
    // ACCOUNT ACCESS KEY METHODS  //
    /////////////////////////////////

    async create_access_key(params, account_sdk) {

        const requesting_account = system_store.get_account_by_email(account_sdk.requesting_account.email);
        return await account_sdk.rpc_client.account.create_access_key(params, requesting_account);
    }

    async get_access_key_last_used(params, account_sdk) {
        const requesting_account = system_store.get_account_by_email(account_sdk.requesting_account.email);
        return await account_sdk.rpc_client.account.get_access_key_last_used(params, requesting_account);
    }

    async update_access_key(params, account_sdk) {

        const requesting_account = system_store.get_account_by_email(account_sdk.requesting_account.email);
        return await account_sdk.rpc_client.account.update_access_key(params, requesting_account);
        // TODO : clean account cache
    }

    async delete_access_key(params, account_sdk) {

        const requesting_account = system_store.get_account_by_email(account_sdk.requesting_account.email);
        return await account_sdk.rpc_client.account.delete_access_key(params, requesting_account);
        // TODO : clean account cache
    }

    async list_access_keys(params, account_sdk) {

        const requesting_account = system_store.get_account_by_email(account_sdk.requesting_account.email);
        return await account_sdk.rpc_client.account.list_access_keys(params, requesting_account);
    }

    ///////////////////////////
    // ACCOUNT TAGS METHODS  //
    ///////////////////////////

    async tag_user(params, account_sdk) {
        const requesting_account = system_store.get_account_by_email(account_sdk.requesting_account.email);
        return await account_sdk.rpc_client.account.tag_user(params, requesting_account);
    }

    async untag_user(params, account_sdk) {

        const requesting_account = system_store.get_account_by_email(account_sdk.requesting_account.email);
        return await account_sdk.rpc_client.account.untag_user(params, requesting_account);
    }

    async list_user_tags(params, account_sdk) {

        const requesting_account = system_store.get_account_by_email(account_sdk.requesting_account.email);
        return await account_sdk.rpc_client.account.list_user_tags(params, requesting_account);

    }

    ////////////////////
    // POLICY METHODS //
    ////////////////////

    async put_user_policy(params, account_sdk) {
        const requesting_account = system_store.get_account_by_email(account_sdk.requesting_account.email);
        return await account_sdk.rpc_client.account.put_user_policy(params, requesting_account);
    }

    async get_user_policy(params, account_sdk) {
        const requesting_account = system_store.get_account_by_email(account_sdk.requesting_account.email);
        return await account_sdk.rpc_client.account.get_user_policy(params, requesting_account);
    }

    async delete_user_policy(params, account_sdk) {
        const requesting_account = system_store.get_account_by_email(account_sdk.requesting_account.email);
        return await account_sdk.rpc_client.account.delete_user_policy(params, requesting_account);
    }

    async list_user_policies(params, account_sdk) {
        const requesting_account = system_store.get_account_by_email(account_sdk.requesting_account.email);
        return await account_sdk.rpc_client.account.list_user_policies(params, requesting_account);
    }
}

// EXPORTS
module.exports = AccountSpaceNB;
