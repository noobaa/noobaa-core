/* Copyright (C) 2016 NooBaa */
'use strict';

require('../util/fips');

const ldap = require('ldapts');
const dbg = require('./debug_module')(__filename);
const P = require('../util/promise');

class LdapClient {
    /**
     * Stops an in-flight _connect retry loop without unbinding admin_client.
     */
    _cancel_connect_loop() {
        this._disconnected_state = true;
        if (this._connect_ac) {
            this._connect_ac.abort();
            this._connect_ac = undefined;
        }
        this._connect_promise = null;
    }

    async disconnect() {
        dbg.log0('ldap client disconnect called');
        this._cancel_connect_loop();
        if (this.admin_client) {
            try {
                await this.admin_client.unbind();
            } catch (err) {
                // ignore
            }
        }
    }

    async reconnect() {
        dbg.log0(`reconnect called`);
        await this.disconnect();
        return this.connect();
    }

    /**
     * load_ldap_config applies LDAP connection settings passed in by the caller.
     * Does not bind or reconnect; callers should call connect() separately.
     * @param {Object} params
     */
    async load_ldap_config(params) {
        dbg.log0('load_ldap_config called');
        if (!params) return;
        const new_ldap_params = {
            uri: params.uri || 'ldaps://127.0.0.1:636',
            admin: params.admin_user || 'Administrator',
            secret: params.admin_password || 'Passw0rd',
            search_dn: params.search_dn || 'ou=people,dc=example,dc=com',
            dn_attribute: params.dn_attribute || 'uid', // for LDAP 'sAMAccountName' for AD
            search_scope: params.search_scope || 'sub',
            jwt_secret: params.jwt_secret,
            ...params,
        };
        const new_tls_options = new_ldap_params.tls_options || {
            'rejectUnauthorized': false,
        };
        // Build the next client first so a constructor failure leaves current state intact
        let new_admin_client;
        try {
            new_admin_client = new ldap.Client({
                url: new_ldap_params.uri,
                tlsOptions: new_tls_options,
            });
        } catch (err) {
            dbg.error('load_ldap_config failed', err);
            throw err;
        }
        const prev_client = this.admin_client;
        // Stop any in-flight connect retries for the previous client before replacing it
        this._cancel_connect_loop();
        this.ldap_params = new_ldap_params;
        this.tls_options = new_tls_options;
        this.admin_client = new_admin_client;
        if (prev_client) {
            try {
                await prev_client.unbind();
            } catch (err) {
                // ignore
            }
        }
    }

    /**
     * @returns {LdapClient}
     */
    static instance() {
        if (!LdapClient._instance) LdapClient._instance = new LdapClient();
        return LdapClient._instance;
    }

    is_connected() {
        return this.admin_client?.isConnected;
    }

    async connect() {
        if (!this.ldap_params?.uri) {
            dbg.log0('connect skipped, LDAP is not configured');
            return;
        }
        this._disconnected_state = false;
        if (this._connect_promise) return this._connect_promise;
        dbg.log0('connect called, current url:', this.ldap_params.uri);
        this._connect_ac = new AbortController();
        this._connect_promise = this._connect(this._connect_ac.signal);
        return this._connect_promise;
    }

    /**
     * @param {AbortSignal} signal
     */
    async _connect(signal) {
        const client = this.admin_client;
        const admin = this.ldap_params.admin;
        const secret = this.ldap_params.secret;
        let is_connected = false;
        while (!is_connected && !this._disconnected_state && !signal.aborted) {
            try {
                await this._bind(client, admin, secret);
                dbg.log0('_connect: initial connect succeeded');
                is_connected = true;
            } catch (err) {
                if (this._disconnected_state || signal.aborted) break;
                dbg.error('_connect: initial connect failed, will retry', err.message);
                await P.delay(3000);
            }
        }
    }

    async _bind(client, user, password) {
        try {
            await client.bind(user, password);
        } catch (err) {
            await client.unbind();
            throw err;
        }
    }

    async authenticate(user, password) {
        // EqualityFilter automatically escapes the value to prevent LDAP injection
        const eqFilter = new ldap.EqualityFilter({
            attribute: this.ldap_params.dn_attribute,
            value: user,
        });
        const attrs = ['dn', 'ou', 'memberOf', 'uid', 'cn', 'mail'];
        /** @type {ldap.SearchOptions} */
        const search_options = {
            filter: eqFilter,
            scope: this.ldap_params.search_scope,
            attributes: attrs
        };
        const user_client = new ldap.Client({
            url: this.ldap_params.uri,
            tlsOptions: this.tls_options,
        });
        try {
            const { searchEntries } = await this.admin_client.search(this.ldap_params.search_dn, search_options);
            if (!searchEntries || searchEntries.length === 0) {
                throw new Error('User not found');
            }
            await this._bind(user_client, searchEntries[0].dn, password);
            return Object.fromEntries(
                attrs.map(attr => [attr, searchEntries[0][attr]])
            );
        } finally {
            // Always unbind the per-auth client so search/bind failures do not leak a socket
            try {
                await user_client.unbind();
            } catch (err) {
                // ignore
            }
        }
    }
}

async function is_ldap_configured() {
    return Boolean(LdapClient._instance?.ldap_params);
}


LdapClient._instance = undefined;

// EXPORTS
exports.LdapClient = LdapClient;
exports.instance = LdapClient.instance;
exports.is_ldap_configured = is_ldap_configured;
