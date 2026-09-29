/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const nc_mkm = require('./nc_master_key_manager').get_instance();
const dbg = require('../util/debug_module')(__filename);

const ENCRYPTED_FIELDS = Object.freeze(['admin_password', 'jwt_secret']);
const LDAP_TYPE = 'ldap';

/**
 * encrypt_identity_provider_secrets encrypts admin_password and jwt_secret in place.
 * @param {Object} data
 * @param {string[]} [fields_to_encrypt]
 * @returns {Promise<Object>}
 */
async function encrypt_identity_provider_secrets(data, fields_to_encrypt = ENCRYPTED_FIELDS) {
    await nc_mkm.init();
    const master_key_id = data.master_key_id || nc_mkm.active_master_key.id;
    for (const field of fields_to_encrypt) {
        if (data[field]) {
            data[field] = nc_mkm.encryptSync(data[field], master_key_id);
        }
    }
    data.master_key_id = master_key_id;
    return data;
}

/**
 * decrypt_identity_provider_secrets returns a shallow copy with secrets decrypted.
 * If master_key_id is missing, values are treated as plaintext.
 * @param {Object} data
 * @returns {Promise<Object>}
 */
async function decrypt_identity_provider_secrets(data) {
    if (!data || !data.master_key_id) return { ...data };
    await nc_mkm.init();
    const decrypted = { ...data };
    for (const field of ENCRYPTED_FIELDS) {
        if (decrypted[field]) {
            decrypted[field] = nc_mkm.decryptSync(decrypted[field], decrypted.master_key_id);
        }
    }
    return decrypted;
}

/**
 * parse_object_flag parses a CLI JSON-string flag into an object when needed.
 * @param {string|Object} value
 * @returns {Object|undefined}
 */
function parse_object_flag(value) {
    if (value === undefined || value === '') return undefined;
    if (typeof value === 'object') return value;
    return JSON.parse(value);
}

/**
 * get_ldap_identity_provider_config returns the decrypted LDAP identity provider, or undefined.
 * Only one LDAP identity provider is supported; extra LDAP files are ignored with a warning.
 * @param {Object} config_fs
 * @returns {Promise<Object|undefined>}
 */
async function get_ldap_identity_provider_config(config_fs) {
    if (!config_fs) return undefined;
    const names = (await config_fs.list_identity_providers()).filter(Boolean).sort();
    const ldap_configs = [];
    for (const name of names) {
        const data = await config_fs.get_identity_provider_by_name(name, { silent_if_missing: true });
        if (data && data.type === LDAP_TYPE) ldap_configs.push(data);
    }
    if (ldap_configs.length > 1) {
        dbg.warn('get_ldap_identity_provider_config: multiple LDAP identity providers found;',
            'only one is supported, using', ldap_configs[0].name);
    }
    if (!ldap_configs[0]) return undefined;
    return decrypt_identity_provider_secrets(ldap_configs[0]);
}

/**
 * apply_ldap_identity_provider reads the LDAP identity provider from ConfigFS
 * and passes it to ldap_client. No-op when config is unchanged and already connected.
 * @param {Object} config_fs
 * @returns {Promise<void>}
 */
async function apply_ldap_identity_provider(config_fs) {
    const ldap_client = require('../util/ldap_client');
    const params = await get_ldap_identity_provider_config(config_fs);
    const client = ldap_client.instance();
    if (!params) {
        if (client.ldap_params || client.is_connected()) {
            await client.disconnect();
            client.ldap_params = undefined;
        }
        return;
    }
    if (_ldap_params_match(client.ldap_params, params) && client.is_connected()) return;
    await client.load_ldap_config(params);
    client.connect();
}

/**
 * @param {Object} [ldap_params]
 * @param {Object} params
 * @returns {boolean}
 */
function _ldap_params_match(ldap_params, params) {
    if (!ldap_params || !params) return false;
    return ldap_params.uri === params.uri &&
        ldap_params.admin === params.admin_user &&
        ldap_params.secret === params.admin_password &&
        ldap_params.search_dn === params.search_dn &&
        ldap_params.dn_attribute === (params.dn_attribute || 'uid') &&
        ldap_params.search_scope === (params.search_scope || 'sub') &&
        ldap_params.jwt_secret === params.jwt_secret &&
        _.isEqual(ldap_params.tls_options, params.tls_options) &&
        ldap_params.name === params.name;
}

exports.LDAP_TYPE = LDAP_TYPE;
exports.ENCRYPTED_FIELDS = ENCRYPTED_FIELDS;
exports.encrypt_identity_provider_secrets = encrypt_identity_provider_secrets;
exports.decrypt_identity_provider_secrets = decrypt_identity_provider_secrets;
exports.parse_object_flag = parse_object_flag;
exports.get_ldap_identity_provider_config = get_ldap_identity_provider_config;
exports.apply_ldap_identity_provider = apply_ldap_identity_provider;
