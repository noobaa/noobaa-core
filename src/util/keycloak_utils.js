/* Copyright (C) 2016 NooBaa */
'use strict';

const querystring = require('querystring');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const { make_http_request, make_https_request } = require('./http_utils');
const { read_stream_join } = require('./buffer_utils');
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
        this.jwks_uri = config.jwks_uri;
        this.token_introspection_endpoint = config.token_introspection_endpoint;
        this.jwks_client = null;

        if (this.jwks_uri) {
            this.jwks_client = jwksClient({
                jwksUri: this.jwks_uri,
                cache: true,
                cacheMaxAge: 600000, // 10 minutes
                rateLimit: true,
                jwksRequestsPerMinute: 10
            });
        }
    }

    /**
     * Get signing key for JWT verification
     *  @param {String} kid - kid
     * @returns {Promise} - signing key
     */
    async get_signing_key(kid) {
        if (!this.jwks_client) {
            throw new Error('JWKS client not configured');
        }
        return new Promise((resolve, reject) => {
            this.jwks_client.getSigningKey(kid, (err, key) => {
                if (err) {
                    reject(err);
                } else {
                    const signingKey = key.getPublicKey();
                    resolve(signingKey);
                }
            });
        });
    }

    /**
     * Verify token using JWT signature verification
     * @param {String} token - kid
     * @returns {Promise<Object>} - verified token object
     */
    async verify_token(token) {
        try {
            // Decode header to get kid
            const decoded_header = jwt.decode(token, { complete: true });
            if (!decoded_header) {
                throw new Error('Invalid token format');
            }
            const signing_key = await this.get_signing_key(decoded_header.header.kid);
            const verified = jwt.verify(token, signing_key, {
                issuer: this.issuer,
                algorithms: ['RS256']
            });
            return verified;
        } catch (err) {
            dbg.error('KeyCloak token verification failed:', err);
            throw err;
        }
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
            throw new Error(`KeyCloak token introspection failed with status: ${response.statusCode}, body: ${body_str}`);
        }

        const result = JSON.parse(body_str);

        if (!result.active) {
            throw new Error('Token is not active');
        }

        return result;
    }

    /**
     * Discover KeyCloak configuration from well-known endpoint
     * @param {string} issuer_url - The access token to introspect
     * @returns {Promise<Object>} - .well-known OIDC provider configuration object
     */
    static async discover(issuer_url) {
        const well_known_url = new URL('.well-known/openid-configuration', issuer_url);
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

/**
 * Extract AWS session tags from KeyCloak token
 * Session tags can be used for attribute-based access control (ABAC)
 * @param {string} token - The access token to get the session tags from
 * @returns {Object} - Session tags object
 */
function extract_session_tags(token) {
    // TODO: validate tags against the policy
    const aws_tags_claim = 'https://aws.amazon.com/tags';
    if (token[aws_tags_claim] && token[aws_tags_claim].principal_tags) {
        return token[aws_tags_claim].principal_tags;
    }
    return {};
}

exports.KeyCloakProvider = KeyCloakProvider;
exports.extract_session_tags = extract_session_tags;
