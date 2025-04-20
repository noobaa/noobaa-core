/* Copyright (C) 2016 NooBaa */
'use strict';

const cloud_utils = require('../util/cloud_utils');
const dbg = require('../util/debug_module')(__filename);
const { RpcError } = require('../rpc');
const signature_utils = require('../util/signature_utils');
const { account_cache } = require('./object_sdk');
const BucketSpaceNB = require('./bucketspace_nb');
const jwt = require('jsonwebtoken');
const ldap_client = require('../util/ldap_client');

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
            if (error.rpc_code === 'NO_SUCH_ACCOUNT') {
                throw new RpcError('INVALID_ACCESS_KEY_ID', `Account with access_key not found`);
            }
            throw error;
        }
    }

    async _assume_role(role_arn) {
        const role_name_idx = role_arn.lastIndexOf('/') + 1;
        const role_name = role_arn.slice(role_name_idx);
        const access_key = role_arn.split(':')[4];

        const account = await account_cache.get_with_cache({
            bucketspace: this._get_bucketspace(),
            access_key,
        });
        if (!account) {
            throw new RpcError('NO_SUCH_ACCOUNT', 'No such account with access_key: ' + access_key);
        }
        if (!account.role_config || account.role_config.role_name !== role_name) {
            throw new RpcError('NO_SUCH_ROLE', `Role not found`);
        }
        dbg.log0('sts_sdk.get_assumed_role res', account,
            'account.role_config: ', account.role_config);

        return account;
    }

    async get_assumed_role(req) {
        dbg.log1('sts_sdk.get_assumed_role body', req.body);
        // arn:aws:sts::access_key:role/role_name
        const account = await this._assume_role(req.body.role_arn);

        return {
            access_key: req.body.role_arn.split(':')[4],
            role_config: account.role_config
        };
    }

    async get_assumed_ldap_user(req) {
        dbg.log1('sts_sdk.get_assumed_ldap_user body', req.body);
        let web_token;
        const jwt_secret = ldap_client.instance().ldap_params?.jwt_secret;
        if (jwt_secret) {
            try {
                web_token = jwt.verify(req.body.web_identity_token, jwt_secret);
            } catch (err) {
                dbg.error('get_assumed_ldap_user error: JWT token verification failed', err);
                if (err.message.includes('TokenExpiredError')) {
                    throw new RpcError('EXPIRED_WEB_IDENTITY_TOKEN', err.message);
                } else {
                    throw new RpcError('INVALID_WEB_IDENTITY_TOKEN', err.message);
                }
            }
        } else {
            dbg.warn('get_assumed_ldap_user: No LDAP JWT secret found, failing back to decoding');
            web_token = jwt.decode(req.body.web_identity_token);
        }
        if (!web_token.user) {
            throw new RpcError('INVALID_WEB_IDENTITY_TOKEN', 'Missing a required claim: user');
        }
        if (!web_token.password) {
            throw new RpcError('INVALID_WEB_IDENTITY_TOKEN', 'Missing a required claim: password');
        }

        // TODO: we should see if we can move to the authentication phase
        const ldap_user = web_token.user;
        const ldap_password = web_token.password;
        if (!(await ldap_client.is_ldap_configured()) || !ldap_client.instance().is_connected()) {
            throw new RpcError('ACCESS_DENIED', 'LDAP is not configured or not connected');
        }
        let dn;
        try {
            dn = await ldap_client.instance().authenticate(ldap_user, ldap_password);
        } catch (err) {
            dbg.error('get_assumed_ldap_user error:', err);
            throw new RpcError('ACCESS_DENIED', 'issue with LDAP authentication');
        }
        const account = await this._assume_role(req.body.role_arn);
        dbg.log0('sts_sdk.get_assumed_role_with_web_identity res', account,
            'account.role_config: ', account.role_config);
        return {
            access_key: req.body.role_arn.split(':')[4],
            role_config: account.role_config,
            dn,
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
        // assume role with web identity is Anonymous
        if (req.op_name === 'post_assume_role_with_web_identity') {
            return;
        }
        throw new RpcError('UNAUTHORIZED', `No permission to sts ops`);
    }
}

module.exports = StsSDK;
