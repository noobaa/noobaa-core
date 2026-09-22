/* Copyright (C) 2016 NooBaa */
'use strict';

const { KeyCloakProvider } = require('./keycloak_utils');
const config = require('../../config');
const dbg = require('./debug_module')(__filename);
const fs = require('fs');
const jwt = require('jsonwebtoken');

/**
 * Singleton KeyCloak client manager
 * Manages multiple KeyCloak OIDC providers (e.g., Keycloak instances)
 */
class KeyCloakClientManager {
    constructor() {
        this.providers = new Map();
        this.config_path = config.KEYCLOAK_CONFIG_PATH;
        this.initialized = false;
        fs.watchFile(this.config_path, {
            interval: config.KEYCLOAK_RELOAD_CONFIG_INTERVAL
        }, () => this.initialize()).unref();
    }

    /**
     * Initialize KeyCloak OIDC providers from config file
     */
    async initialize() {
        if (this.initialized) return;
        try {
            if (fs.existsSync(this.config_path)) {
                const config_data = JSON.parse(fs.readFileSync(this.config_path, 'utf8'));
                for (const provider of config_data.providers || []) {
                    await this.add_provider(provider);
                }
                this.initialized = true;
                dbg.log0('KeyCloak client initialized with', this.providers.size, 'providers');
            } else {
                dbg.log0('No KeyCloak config found at', this.config_path);
            }
        } catch (err) {
            dbg.error('Failed to initialize KeyCloak client:', err);
            // Don't throw - allow system to continue without KeyCloak
        }
    }

    /**
     * Add KeyCloak provider (e.g., Keycloak)
     */
    async add_provider(provider_config) {
        try {
            // Auto-discover endpoints if only issuer is provided
            if (provider_config.issuer) {
                dbg.log0('Discovering KeyCloak configuration for:', provider_config.issuer);
                const discovery = await KeyCloakProvider.discover(provider_config.issuer);
                provider_config.token_introspection_endpoint = discovery.introspection_endpoint;
            }
            const provider = new KeyCloakProvider(provider_config);
            this.providers.set(provider_config.issuer, provider);
            dbg.log0('Added KeyCloak provider:', provider_config.issuer);
        } catch (err) {
            dbg.error('Failed to add KeyCloak provider:', err);
            throw err;
        }
    }

    /**
     * Get provider by issuer
     * @param {String} issuer - issuer
     * @returns {KeyCloakProvider} - provider
     */
    get_provider(issuer) {
        return this.providers.get(issuer);
    }

    /**
     * This method decode the token and returns the decoded token object
     * @param {String} token - token
     * @return {Promise<Object>} - recoded token
     */
    async verify_token(token) {
        const decoded = jwt.decode(token);
        if (!decoded || !decoded.iss) {
            throw new Error('Invalid token: missing issuer');
        }
        return decoded;
    }

    /**
     * Introspect token with Keycloak (validates with authorization server)
     * This is the recommended approach for Keycloak as it checks token revocation
     * @param {String} token - token
     * @returns {Promise<Object>} - introspection result
     */
    async introspect_token(token) {
        const decoded = jwt.decode(token);
        const provider = this.get_provider(decoded.iss);
        if (!provider) {
            throw new Error(`No KeyCloak provider configured for issuer: ${decoded.iss}`);
        }

        return await provider.introspect_token(token);
    }

    /**
     * Check if KeyCloak is configured
     */
    is_configured() {
        return this.initialized && this.providers.size > 0;
    }
}

// Singleton instance
let instance = null;

/**
 * Get KeyCloak client manager instance
 * @returns {KeyCloakClientManager} - KeyCloak client manager instance
 */
function get_instance() {
    if (!instance) {
        instance = new KeyCloakClientManager();
    }
    return instance;
}

/**
 * Get KeyCloak client manager instance configured or not
 * @returns {Promise<Boolean>} - true if KeyCloak is configured, false otherwise
 */

async function is_keycloak_configured() {
    const client = get_instance();
    if (!client.initialized) {
        await client.initialize();
    }
    return client.is_configured();
}

exports.get_instance = get_instance;
exports.is_keycloak_configured = is_keycloak_configured;
