/* Copyright (C) 2016 NooBaa */
'use strict';

const cloud_utils = require('../util/cloud_utils');
const dbg = require('../util/debug_module')(__filename);
const { RpcError } = require('../rpc');
const signature_utils = require('../util/signature_utils');
const { account_cache } = require('./object_sdk');
const BucketSpaceNB = require('./bucketspace_nb');

class StsSDK {

    constructor(rpc_client, internal_rpc_client, bucketspace) {
        this.rpc_client = rpc_client;
        this.internal_rpc_client = internal_rpc_client;
        this.requesting_account = undefined;
        this.auth_token = undefined;
        this.bucketspace = bucketspace || new BucketSpaceNB({ rpc_client, internal_rpc_client });
    }

    set_auth_token(auth_token) {
        this.auth_token = auth_token;
        this.rpc_client.options.auth_token = auth_token;
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
        } catch (error) {
            dbg.error('authorize_request_account error:', error);
            if (error.rpc_code && error.rpc_code === 'NO_SUCH_ACCOUNT') {
                throw new RpcError('INVALID_ACCESS_KEY_ID', `Account with access_key not found`);
            } else {
                throw error;
            }
        }
    }

    async get_assumed_role(req) {
        dbg.log1('sts_sdk.get_assumed_role body', req.body);
        // arn:aws:sts::access_key:role/role_name
        const role_name_idx = req.body.role_arn.lastIndexOf('/') + 1;
        const role_name = req.body.role_arn.slice(role_name_idx);
        const access_key = req.body.role_arn.split(':')[4];

        const account = await account_cache.get_with_cache({
            bucketspace: this._get_bucketspace(),
            access_key: access_key,
        });
        if (!account) {
            throw new RpcError('NO_SUCH_ACCOUNT', 'No such account with access_key: ' + access_key);
        }
        if (!account.role_config || account.role_config.role_name !== role_name) {
            throw new RpcError('NO_SUCH_ROLE', `Role not found`);
        }
        dbg.log0('sts_sdk.get_assumed_role res', account,
            'account.role_config: ', account.role_config);

        return {
            access_key,
            role_config: account.role_config
        };
    }

    generate_temp_access_keys() {
        return cloud_utils.generate_access_keys();
    }

    authorize_request_account(req) {
        const token = this.get_auth_token();
        // If the request is signed (authenticated)
        if (token) {
            signature_utils.authorize_request_account_by_token(token, this.requesting_account);
            return;
        }
        throw new RpcError('UNAUTHORIZED', `No permission to access bucket`);
    }
}

module.exports = StsSDK;
