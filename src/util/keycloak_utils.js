/* Copyright (C) 2016 NooBaa */
'use strict';

const querystring = require('querystring');
const { make_http_request, make_https_request } = require('./http_utils');
const { read_stream_join } = require('./buffer_utils');
const { RpcError } = require('../rpc');
const dbg = require('./debug_module')(__filename);


/**
 * KeyCloak Provider Configuration
 * Handles JWT verification and token introspection for Keycloak/OIDC providers
 */
class KeyCloakProvider {
    constructor(config) {
        this.issuer = config.issuer;
        this.client_id = config.client_id;
        this.client_secret = config.client_secret;
        this.token_introspection_endpoint = config.token_introspection_endpoint;
    }


    /**
     * Introspect token with OIDC provider (Keycloak)
     * This is the key method for Keycloak integration - validates token with the authorization server
     * @param {string} token - The access token to introspect
     * @returns {Promise<Object>} - Introspection response with token details
     */
    async introspect_token(token) {
        if (!this.token_introspection_endpoint || !this.client_id || !this.client_secret) {
            throw new Error('KeyCloak introspection endpoint or credentials not configured');
        }

        const endpoint_url = new URL(this.token_introspection_endpoint);
        const basic_auth = Buffer.from(`${this.client_id}:${this.client_secret}`).toString('base64');
        const request_options = {
            method: 'POST',
            hostname: endpoint_url.hostname,
            port: endpoint_url.port || (endpoint_url.protocol === 'https:' ? '443' : '80'),
            path: endpoint_url.pathname,
            rejectUnauthorized: true,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${basic_auth}`,
            }
        };
        const body = querystring.stringify({ token, token_type_hint: 'access_token' });

        const make_request = endpoint_url.protocol === 'https:' ? make_https_request : make_http_request;
        const response = await make_request(request_options, body, 'utf8');

        const buffer = await read_stream_join(response);
        const body_str = buffer.toString('utf8');

        if (response.statusCode !== 200) {
            dbg.error('KeyCloak token introspection failed with status:', response.statusCode, 'body:', body_str);
            throw new RpcError('INVALID_WEB_IDENTITY_TOKEN', `Couldn't retrieve verification key from your identity provider, please reference AssumeRoleWithWebIdentity documentation for requirements`);
        }

        const result = JSON.parse(body_str);

        if (!result.active) {
            throw new RpcError('EXPIRED_WEB_IDENTITY_TOKEN', 'Token expired: current date/time must be before the expiration date/time');
        }

        return result;
    }

    /**
     * Discover KeyCloak configuration from well-known endpoint
     * @param {string} issuer_url - The access token to introspect
     * @returns {Promise<Object>} - .well-known OIDC provider configuration object
     */
    static async discover(issuer_url) {
        const base_url = issuer_url.endsWith('/') ? issuer_url : issuer_url + '/';
        const well_known_url = new URL('.well-known/openid-configuration', base_url);
        try {
            const make_request = well_known_url.protocol === 'https:' ? make_https_request : make_http_request;
            const response = await make_request(
                {
                    method: 'GET',
                    hostname: well_known_url.hostname,
                    port: well_known_url.port || (well_known_url.protocol === 'https:' ? '443' : '80'),
                    path: well_known_url.pathname,
                    rejectUnauthorized: true
                },
                null,
                'utf8'
            );
            if (response && response.statusCode === 200) {
                const buffer = await read_stream_join(response);
                return JSON.parse(buffer.toString('utf8'));
            } else {
                throw new Error(`KeyCloak discovery failed: ${well_known_url} returned ${response?.statusCode}`);
            }
        } catch (err) {
            dbg.error('KeyCloak discovery failed:', err);
            throw err;
        }
    }
}

exports.KeyCloakProvider = KeyCloakProvider;

