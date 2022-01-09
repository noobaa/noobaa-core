/* Copyright (C) 2016 NooBaa */
'use strict';

const cloud_utils = require('../util/cloud_utils');
const dbg = require('../util/debug_module')(__filename);
const { RpcError } = require('../rpc');
const signature_utils = require('../util/signature_utils');
const { account_cache } = require('./object_sdk');

class StsSDK {

    constructor(rpc_client, internal_rpc_client) {
        this.rpc_client = rpc_client;
        this.internal_rpc_client = internal_rpc_client;
        this.requesting_account = undefined;
    }

    set_auth_token(auth_token) {
        this.rpc_client.options.auth_token = auth_token;
    }

    get_auth_token() {
        return this.rpc_client.options.auth_token;
    }

    async get_assumed_role(req) {
        dbg.log1('sts_sdk.get_assumed_role body', req.body);
        // arn:aws:sts::access_key:role/role_name
        const role_name_idx = req.body.role_arn.lastIndexOf('/') + 1;
        const role_name = req.body.role_arn.slice(role_name_idx);
        const access_key = req.body.role_arn.split(':')[4];

        const account = await account_cache.get_with_cache({
            rpc_client: this.internal_rpc_client,
            access_key
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

    // similar function to object_sdk - should we merge them?
    // where should we put the account_cache
    async authorize_request_account(req) {
        const token = this.get_auth_token();
        // If the request is signed (authenticated)
        if (token) {
            try {
                this.requesting_account = await account_cache.get_with_cache({
                    rpc_client: this.internal_rpc_client,
                    access_key: token.access_key
                });
            } catch (error) {
                dbg.error('authorize_request_account error:', error);
                if (error.rpc_code && error.rpc_code === 'NO_SUCH_ACCOUNT') {
                    throw new RpcError('INVALID_ACCESS_KEY_ID', `Account with access_key not found`);
                } else {
                    throw error;
                }
            }
            const signature_secret = token.temp_secret_key || this.requesting_account.access_keys[0].secret_key.unwrap();
            const signature = signature_utils.get_signature_from_auth_token(token, signature_secret);
            if (token.signature !== signature) throw new RpcError('SIGNATURE_DOES_NOT_MATCH', `Signature that was calculated did not match`);
            return;
        }
        throw new RpcError('UNAUTHORIZED', `No permission to access bucket`);
    }
}

module.exports = StsSDK;
