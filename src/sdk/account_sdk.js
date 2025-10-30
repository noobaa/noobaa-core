/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../util/debug_module')(__filename);
const config = require('../../config');
const { RpcError } = require('../rpc');
const signature_utils = require('../util/signature_utils');
const { account_cache, dn_cache } = require('./object_sdk');
const BucketSpaceNB = require('./bucketspace_nb');
const AccountSpaceFS = require('./accountspace_fs');

class AccountSDK {
    /**
     * @param {{
     *      rpc_client: nb.APIClient;
     *      internal_rpc_client: nb.APIClient;
     *      bucketspace?: nb.BucketSpace;
     *      accountspace?: nb.AccountSpace;
     * }} args
     */
    constructor({ rpc_client, internal_rpc_client, bucketspace, accountspace }) {
        this.rpc_client = rpc_client;
        this.internal_rpc_client = internal_rpc_client;
        this.requesting_account = undefined;
        this.auth_token = undefined;
        // Using bucketspace in load_requesting_account
        this.bucketspace = bucketspace || new BucketSpaceNB({ rpc_client, internal_rpc_client });
        const config_root = config.NSFS_NC_DEFAULT_CONF_DIR;
        this.accountspace = accountspace || new AccountSpaceFS({ config_root });
    }

    set_auth_token(auth_token) {
        this.auth_token = auth_token;
        if (this.rpc_client) this.rpc_client.options.auth_token = auth_token;
    }

    get_auth_token() {
        return this.auth_token;
    }

     /**
     * @returns {nb.BucketSpace}
     */
    _get_bucketspace() {
        return this.bucketspace;
    }

    async load_requesting_account(req) {
        try {
            const token = this.get_auth_token();
            if (!token) return;
            this.requesting_account = await account_cache.get_with_cache({
                bucketspace: this._get_bucketspace(),
                access_key: token.access_key,
            });
            if (this.requesting_account?.nsfs_account_config?.distinguished_name) {
                const distinguished_name = this.requesting_account.nsfs_account_config.distinguished_name.unwrap();
                const user = await dn_cache.get_with_cache({
                    bucketspace: this._get_bucketspace(),
                    distinguished_name,
                });
                this.requesting_account.nsfs_account_config.uid = user.uid;
                this.requesting_account.nsfs_account_config.gid = user.gid;
            }
        } catch (error) {
            dbg.error('load_requesting_account error:', error);
            if (error.rpc_code === 'NO_SUCH_ACCOUNT') throw new RpcError('INVALID_ACCESS_KEY_ID', `Account with access_key not found`);
            if (error.rpc_code === 'NO_SUCH_USER') throw new RpcError('UNAUTHORIZED', `Distinguished name associated with access_key not found`);
            throw error;
        }
    }

    // copied from function in sts_sdk
    authorize_request_account(req) {
        const token = this.get_auth_token();
        // If the request is signed (authenticated)
        if (token) {
            signature_utils.authorize_request_account_by_token(token, this.requesting_account);
            return;
        }
        throw new RpcError('UNAUTHORIZED', `No permission to access`);
    }

    /**
     * @returns {nb.AccountSpace}
     */
    _get_accountspace() {
        return this.accountspace;
    }

    ////////////
    // USER   //
    ////////////

    async create_user(params) {
        const accountspace = this._get_accountspace();
        return accountspace.create_user(params, this);
    }

    async get_user(params) {
        const accountspace = this._get_accountspace();
        return accountspace.get_user(params, this);
    }

    async update_user(params) {
        const accountspace = this._get_accountspace();
        return accountspace.update_user(params, this);
    }

    async delete_user(params) {
        const accountspace = this._get_accountspace();
        return accountspace.delete_user(params, this);
    }

    async list_users(params) {
        const accountspace = this._get_accountspace();
        return accountspace.list_users(params, this);
    }

    ////////////
    // TAGS   //
    ////////////

    async tag_user(params) {
        const accountspace = this._get_accountspace();
        return accountspace.tag_user(params, this);
    }

    async untag_user(params) {
        const accountspace = this._get_accountspace();
        return accountspace.untag_user(params, this);
    }

    async list_user_tags(params) {
        const accountspace = this._get_accountspace();
        return accountspace.list_user_tags(params, this);
    }

    ////////////////
    // ACCESS KEY //
    ////////////////

    async create_access_key(params) {
        const accountspace = this._get_accountspace();
        return accountspace.create_access_key(params, this);
    }

    async get_access_key_last_used(params) {
        const accountspace = this._get_accountspace();
        return accountspace.get_access_key_last_used(params, this);
    }

    async update_access_key(params) {
        const accountspace = this._get_accountspace();
        return accountspace.update_access_key(params, this);
    }

    async delete_access_key(params) {
        const accountspace = this._get_accountspace();
        return accountspace.delete_access_key(params, this);
    }

    async list_access_keys(params) {
        const accountspace = this._get_accountspace();
        return accountspace.list_access_keys(params, this);
    }
}

// EXPORTS
module.exports = AccountSDK;
