/* Copyright (C) 2016 NooBaa */
'use strict';

const cloud_utils = require('../util/cloud_utils');
const dbg = require('../util/debug_module')(__filename);
const { RpcError } = require('../rpc');
const signature_utils = require('../util/signature_utils');
const { account_cache, dn_cache } = require('./object_sdk');
const BucketSpaceNB = require('./bucketspace_nb');
const jwt = require('jsonwebtoken');
const ldap_client = require('../util/ldap_client');
const keycloak_client = require('../util/keycloak_client');
const { extract_session_tags } = require('../util/keycloak_utils');

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
            if (error.rpc_code === 'NO_SUCH_ACCOUNT') {
                throw new RpcError('INVALID_ACCESS_KEY_ID', `Account with access_key not found`);
            }
            if (error.rpc_code === 'NO_SUCH_USER') {
                throw new RpcError('UNAUTHORIZED', `Distinguished name associated with access_key not found`);
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

    extract_ldap_host(uri) {
        // example uri: ldaps://ldap.example.com:636 then return ldap.example.com
        const match = uri.match(/^ldaps?:\/\/([^:/]+)/);
        return match ? match[1] : uri;
    }

    async authenticate_web_identity(req) {
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
            if (!web_token) throw new RpcError('INVALID_WEB_IDENTITY_TOKEN', 'jwt malformed');
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
        let ldap_auth_result = {};
        try {
            ldap_auth_result = await ldap_client.instance().authenticate(ldap_user, ldap_password);
        } catch (err) {
            dbg.error('get_assumed_ldap_user error:', err);
            throw new RpcError('ACCESS_DENIED', 'issue with LDAP authentication');
        }
        const ldap_uri = ldap_client.instance().ldap_params?.uri || '';

        return {
            ...ldap_auth_result,
            provider_type: 'ldap-provider',
            ldap_server: this.extract_ldap_host(ldap_uri),
        };
    }

    /**
     * Get assumed LDAP user
     * @param {Object} req - Request object
     */
    async get_assumed_ldap_user(req) {
        const ldap_auth_result = await this.authenticate_web_identity(req);
        const account = await this._assume_role(req.body.role_arn);
        dbg.log0('sts_sdk.get_assumed_role_with_web_identity res', account,
            'account.role_config: ', account.role_config);
        return {
            access_key: req.body.role_arn.split(':')[4],
            role_config: account.role_config,
            dn: ldap_auth_result.dn,
        };
    }

    /**
     * Get assumed role for OIDC/Keycloak user
     * Validates JWT token using introspection with client_id, client_secret, and access_token
     * @param {Object} req - Request object
     * @returns {Promise<Object>} - Assumed role info with session tags
     */
    async get_assumed_oidc_user(req) {
        dbg.log1('sts_sdk.get_assumed_oidc_user body', req.body.role_arn);

        try {
            // Initialize OIDC client if not already done
            const keycloak_instance = keycloak_client.get_instance();
            if (!keycloak_instance.initialized) {
                await keycloak_instance.initialize();
            }
            // Also verify the JWT signature for additional security
            const verified_token = await keycloak_instance.verify_token(
                req.body.web_identity_token
            );

            // Introspect token with Keycloak using client_id, client_secret, and access_token
            // This is the key implementation for Keycloak - validates token is active and not revoked
            const introspection_resp = await keycloak_instance.introspect_token(
                req.body.web_identity_token
            );

            // Extract session tags from verified token (not from introspection)
            const session_tags = extract_session_tags(verified_token);
            // Assume role
            const account = await this._assume_role(req.body.role_arn);
            dbg.log1('sts_sdk.get_assumed_oidc_user _assume_role res', account,
                'account.role_config:', account.role_config,
                'session_tags:', session_tags);

            return {
                access_key: req.body.role_arn.split(':')[4],
                role_config: account.role_config,
                sub: introspection_resp.sub,
                aud: introspection_resp.client_id || introspection_resp.aud,
                iss: introspection_resp.iss,
                session_tags,
                // Store additional claims for audit
                email: introspection_resp.email || verified_token.email,
                name: introspection_resp.name || verified_token.name || verified_token.preferred_username,
            };
        } catch (err) {
            dbg.error('get_assumed_oidc_user error:', err);
            if (err.name === 'TokenExpiredError') {
                throw new RpcError('EXPIRED_WEB_IDENTITY_TOKEN', err.message);
            }
            if (err.name === 'JsonWebTokenError') {
                throw new RpcError('INVALID_WEB_IDENTITY_TOKEN', err.message);
            }
            if (err.message && err.message.includes('No KeyCloak provider')) {
                throw new RpcError('INVALID_WEB_IDENTITY_TOKEN', err.message);
            }
            if (err.message && err.message.includes('Token is not active')) {
                throw new RpcError('EXPIRED_WEB_IDENTITY_TOKEN', 'Token has been revoked or is inactive');
            }
            throw new RpcError('ACCESS_DENIED', 'Issue with KeyCloak authentication');
        }
    }

    /**
     * Unified method to get assumed user (LDAP or OIDC/Keycloak)
     * Detects token type and routes to appropriate handler
     * @param {Object} req - Request object
     * @returns {Promise<Object>} - Assumed role info
     */
    async get_assumed_web_identity_role(req) {
        const decoded = jwt.decode(req.body.web_identity_token, { json: true });
        if (!decoded) {
            throw new RpcError('INVALID_WEB_IDENTITY_TOKEN', 'jwt malformed');
        }
        // Check if OIDC is configured and token is from OIDC provider
        if (await keycloak_client.is_keycloak_configured()) {
            const keycloak_instance = keycloak_client.get_instance();
            const provider = keycloak_instance.get_provider(decoded.iss);
            if (provider) {
                dbg.log1('Routing to KeyCloak handler for issuer:', decoded.iss);
                return await this.get_assumed_oidc_user(req);
            } else {
                dbg.log0('Routing to Web Identity handler missing', decoded.iss);
            }
        }

        // Fall back to LDAP Web Identity handler
        dbg.log0('Routing to LDAP handler');
        return await this.get_assumed_ldap_user(req);
    }

    /**
     * Generates a temporary access key for the requesting account
     * @returns {Object} - Access token and secret object
     */
    generate_temp_access_keys() {
        return cloud_utils.generate_access_keys();
    }

    /**
     * Authorizes request account
     * @param {Object} req - Request object
     * @throws {RpcError} - If the request is not signed or the requesting account is not authorized
     */
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
