/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const util = require('util');
const crypto = require('crypto');
const config = require('../../../config');
const db_client = require('../../util/db_client').instance();
const dbg = require('../../util/debug_module')(__filename);
const SensitiveString = require('../../util/sensitive_string');
const LRUCache = require('../../util/lru_cache');

const ROOT_KEY = 'noobaa-root-master-key';

class MasterKeysManager {
    constructor() {
        this.is_initialized = false;
        this.resolved_master_keys_by_id = {};
        this.master_keys_by_id = {};
        this.secret_keys_cache = new LRUCache({
            name: 'SecretKeysCache',
            expiry_ms: Infinity,
            max_usage: Infinity,
            make_key: params => params.encrypted_value,
            load: params => new SensitiveString(params.decipher.update(
                Buffer.from(params.encrypted_value, 'base64')).toString())
        });
    }

    static get_instance() {
        MasterKeysManager._instance = MasterKeysManager._instance || new MasterKeysManager();
        return MasterKeysManager._instance;
    }

    /**
     * 
     * @returns {String} 
     */
    get_root_key_id() {
        return ROOT_KEY;
    }

    /**
     * 
     * @returns {Object} 
     */
    get_root_key() {
        return this.resolved_master_keys_by_id[ROOT_KEY];
    }

    async load_root_key() {
        if (this.is_initialized) return;
        const { NOOBAA_ROOT_SECRET } = process.env;
        if (!NOOBAA_ROOT_SECRET) throw new Error('NON_EXISTING_ROOT_KEY');
        const r_key = {
            _id: ROOT_KEY,
            cipher_key: Buffer.from(NOOBAA_ROOT_SECRET, 'base64'),
            cipher_type: "aes-256-gcm",
            description: "Root Master Key",
            disabled: false
        };
        this.resolved_master_keys_by_id[ROOT_KEY] = r_key;
        this.is_initialized = true;
    }

    /**
     * 
     * @param {Array} master_keys_by_id 
     */
    update_master_keys(master_keys_by_id) {
        if (!master_keys_by_id) {
            dbg.error('Invalid master_keys_by_id, got ', master_keys_by_id);
            throw new Error('Invalid master_keys_by_id');
        }
        this.master_keys_by_id = master_keys_by_id;
    }

    /**
     * 
     * @param {Object} options 
     * @returns {Object} 
     */
    new_master_key(options) {
        const { description, master_key_id, cipher_type } = options;
        const _id = db_client.new_object_id();
        const m_key = _.omitBy({
            _id,
            description,
            master_key_id: master_key_id === ROOT_KEY ? ROOT_KEY :
                (master_key_id && db_client.parse_object_id(master_key_id)) || undefined,
            cipher_type: cipher_type || config.CHUNK_CODER_CIPHER_TYPE,
            cipher_key: crypto.randomBytes(32),
            cipher_iv: crypto.randomBytes(16),
            disabled: false
        }, _.isUndefined);

        const encrypted_m_key = _.cloneDeep(m_key);
        encrypted_m_key.cipher_key = this.encrypt_buffer_with_master_key_id(m_key.cipher_key, master_key_id);

        this.resolved_master_keys_by_id[_id.toString()] = m_key;
        this.master_keys_by_id[_id.toString()] = encrypted_m_key;
        return encrypted_m_key;
    }
    /**
     * 
     * @param {String} _id 
     * @returns {Object}  
     */
    get_master_key_by_id(_id) {
        if (_id === ROOT_KEY) return this.get_root_key();
        const mkey = this.master_keys_by_id[_id.toString()];
        if (!mkey) throw new Error('NO_SUCH_KEY');
        return this.resolved_master_keys_by_id[_id.toString()] || this._resolve_master_key(mkey);
    }

    /**
     * 
     * @param {Object} m_key 
     * @returns {Object}  
     */
    _resolve_master_key(m_key) {
        // m_key.master_key_id._id doesn't exist when encrypting account secret keys and the account 
        // not yet inserted to db (in create account) or when master_key_id is the ROOT_KEY
        const m_of_mkey_id = (m_key.master_key_id && m_key.master_key_id._id) || m_key.master_key_id;
        const m_of_mkey = this.get_master_key_by_id(m_of_mkey_id || ROOT_KEY);
        if (!m_of_mkey) throw new Error('NO_SUCH_KEY');

        const iv = m_of_mkey.cipher_iv || Buffer.alloc(1);
        const decipher = crypto.createDecipheriv(m_of_mkey.cipher_type, m_of_mkey.cipher_key, iv);
        // cipher_key is Buffer and after load system - cipher_key is binary.
        const data = Buffer.isBuffer(m_key.cipher_key) ? m_key.cipher_key : Buffer.from(m_key.cipher_key.buffer, 'base64');
        let cipher_key = decipher.update(data);
        if (m_key.cipher_type !== 'aes-256-gcm') cipher_key = Buffer.concat([cipher_key, decipher.final()]);
        const decrypted_master_key = _.defaults({ cipher_key }, m_key);

        if (!Buffer.isBuffer(decrypted_master_key.cipher_iv)) {
            // we would like to keep it as Buffer in resolved_master_keys_by_id
            decrypted_master_key.cipher_iv = Buffer.from(decrypted_master_key.cipher_iv.buffer, 'base64');
        }
        this.resolved_master_keys_by_id[m_key._id.toString()] = decrypted_master_key;
        return decrypted_master_key;
    }

    /**
     * 
     * @param {Buffer} value 
     * @param {String} _id
     * @returns {Buffer} 
     */
    encrypt_buffer_with_master_key_id(value, _id) {
        if (!_id) return value;
        const m_key = this.get_master_key_by_id(_id);
        if (!m_key) throw new Error('NO_SUCH_KEY');
        const iv = m_key.cipher_iv || Buffer.alloc(1);
        const cipher = crypto.createCipheriv(m_key.cipher_type, m_key.cipher_key, iv);
        let ciphered_value = cipher.update(value);
        if (m_key.cipher_type !== 'aes-256-gcm') ciphered_value = Buffer.concat([ciphered_value, cipher.final()]);
        return ciphered_value;
    }

    /**
     * 
     * @param {String} value 
     * @param {String} _id
     * @returns {Buffer} 
     */
    decrypt_value_with_master_key_id(value, _id) {
        if (!_id) Buffer.from(value, 'base64');
        const m_key = this.get_master_key_by_id(_id);
        if (!m_key) throw new Error('NO_SUCH_KEY');

        const decipher = crypto.createDecipheriv(m_key.cipher_type, m_key.cipher_key, m_key.cipher_iv);
        let deciphered_value = decipher.update(Buffer.from(value, 'base64'));
        if (m_key.cipher_type !== 'aes-256-gcm') deciphered_value = Buffer.concat([deciphered_value, decipher.final()]);

        return deciphered_value;
    }

    /**
     * 
     * @param {SensitiveString} value 
     * @param {String} _id
     * @returns {SensitiveString} 
     */
    encrypt_sensitive_string_with_master_key_id(value, _id) {
        if (!_id) return value;
        const m_key = this.get_master_key_by_id(_id);
        if (!m_key) throw new Error('NO_SUCH_KEY');

        const cipher = crypto.createCipheriv(m_key.cipher_type, m_key.cipher_key, m_key.cipher_iv);
        let updated_value = cipher.update(Buffer.from(value.unwrap()));
        if (m_key.cipher_type !== 'aes-256-gcm') updated_value = Buffer.concat([updated_value, cipher.final()]);

        const ciphered_value = new SensitiveString(updated_value.toString('base64'));
        this.secret_keys_cache.put_in_cache(ciphered_value, value);
        return ciphered_value;
    }

    async decrypt_all_accounts_secret_keys({ accounts, pools, namespace_resources }) {
        for (const account of accounts) {
            if (account.master_key_id && account.master_key_id._id) {
                const m_key = this.get_master_key_by_id(account.master_key_id._id);
                if (!m_key) throw new Error('NO_SUCH_KEY');
                const decipher = crypto.createDecipheriv(m_key.cipher_type, m_key.cipher_key, m_key.cipher_iv);

                if (account.access_keys) {
                    for (const keys of account.access_keys) {
                        keys.secret_key = await this.secret_keys_cache.get_with_cache({
                            encrypted_value: keys.secret_key.unwrap(),
                            decipher
                        }, undefined);
                    }
                }
                if (account.sync_credentials_cache) {
                    for (const keys of account.sync_credentials_cache) {
                        keys.secret_key = await this.secret_keys_cache.get_with_cache({
                            encrypted_value: keys.secret_key.unwrap(),
                            decipher
                        }, undefined);
                    }
                }
            }
        }

        for (const pool of pools) {
            if (pool.cloud_pool_info && pool.cloud_pool_info.access_keys) {
                pool.cloud_pool_info.access_keys.secret_key = await this.secret_keys_cache.get_with_cache({
                    encrypted_value: pool.cloud_pool_info.access_keys.secret_key.unwrap(),
                    undefined
                }, undefined);
            }
        }

        for (const ns_resource of namespace_resources) {
            if (ns_resource.connection) {
                ns_resource.connection.secret_key = await this.secret_keys_cache.get_with_cache({
                    encrypted_value: ns_resource.connection.secret_key.unwrap(),
                    undefined
                }, undefined);
            }
        }
    }

    [util.inspect.custom]() { return 'MasterKeysManager'; }
}

MasterKeysManager._instance = undefined;

// EXPORTS
exports.MasterKeysManager = MasterKeysManager;
exports.get_instance = MasterKeysManager.get_instance;
