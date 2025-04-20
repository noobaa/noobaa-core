/* Copyright (C) 2016 NooBaa */
'use strict';

require('../util/fips');

const fs = require('fs');
const config = require('../../config');
const EventEmitter = require('events').EventEmitter;
const ldap = require('ldapts');
const dbg = require('./debug_module')(__filename);
const P = require('../util/promise');

class LdapClient extends EventEmitter {
    async disconnect() {
        dbg.log0('ldap client disconnect called');
        this._disconnected_state = true;
        this._connect_promise = null;
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

    constructor() {
        super();
        this.load_ldap_config();
        fs.watchFile(config.LDAP_CONFIG_PATH, {
            interval: config.NC_RELOAD_CONFIG_INTERVAL
        }, () => this.load_ldap_config()).unref();
    }

    async load_ldap_config() {
        try {
            dbg.log0('load_ldap_config called');
            const params = JSON.parse(fs.readFileSync(config.LDAP_CONFIG_PATH).toString());
            this.ldap_params = {
                uri: params.uri || 'ldaps://127.0.0.1:636',
                admin: params.admin_user || 'Administrator',
                secret: params.admin_password || 'Passw0rd',
                search_dn: params.search_dn || 'ou=people,dc=example,dc=com',
                dn_attribute: params.dn_attribute || 'uid', // for LDAP 'sAMAccountName' for AD
                search_scope: params.search_scope || 'sub',
                jwt_secret: params.jwt_secret,
                ...params,
            };
            this.tls_options = this.ldap_params.tls_options || {
                'rejectUnauthorized': false,
            };
            this.admin_client = new ldap.Client({
                url: this.ldap_params.uri,
                tlsOptions: this.tls_options,
            });
            if (this.is_connected) {
                await this.reconnect();
            }
        } catch (err) {
            // we cannot rethrow, next watch event will try to load again
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
        this._disconnected_state = false;
        if (this._connect_promise) return this._connect_promise;
        dbg.log0('connect called, current url:', this.ldap_params.uri);
        this._connect_promise = this._connect();
        return this._connect_promise;
    }

    async _connect() {
        let is_connected = false;
        while (!is_connected) {
            try {
                await this._bind(this.admin_client, this.ldap_params.admin, this.ldap_params.secret);
                dbg.log0('_connect: initial connect succeeded');
                is_connected = true;
            } catch (err) {
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
        /** @type {ldap.SearchOptions} */
        const search_options = {
            filter: eqFilter,
            scope: this.ldap_params.search_scope,
            attributes: ['dn']
        };
        const user_client = new ldap.Client({
            url: this.ldap_params.uri,
            tlsOptions: this.tls_options,
        });
        const { searchEntries } = await this.admin_client.search(this.ldap_params.search_dn, search_options);
        if (!searchEntries || searchEntries.length === 0) {
            throw new Error('User not found');
        }
        await this._bind(user_client, searchEntries[0].dn, password);
        return searchEntries[0].dn;
    }
}

async function is_ldap_configured() {
    try {
        return fs.statSync(config.LDAP_CONFIG_PATH).isFile();
    } catch (err) {
        if (err.code === 'ENOENT') {
            return false;
        }
        throw err;
    }
}


LdapClient._instance = undefined;

// EXPORTS
exports.LdapClient = LdapClient;
exports.instance = LdapClient.instance;
exports.is_ldap_configured = is_ldap_configured;
