/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const util = require('util');
const kube_utils = require('../../util/kube_utils');
const crypto = require('crypto');
// const LRUCache = require('../../util/lru_cache');
const config = require('../../../config');
// const dbg = require('../../util/debug_module')(__filename);
const mongo_utils = require('../../util/mongo_utils');
// const { RpcError } = require('../../rpc');

const ROOT_KEY = 'SLOTH';
const RESOLVED_ROOT_SECRET_KEYS = ['cipher_type', 'cipher_key', 'cipher_iv'];

class MasterKeysManager {

    static get_instance() {
        MasterKeysManager._instance = MasterKeysManager._instance || new MasterKeysManager();
        return MasterKeysManager._instance;
    }

    constructor() {
        this.is_initialized = false;
        this.master_keys_by_id = [];
        this.resolved_master_keys_by_id = [];
    }

    get_master_key_by_id(_id) {
        const mkey = this.master_keys_by_id[_id];
        if (!mkey) throw new Error('NO_SUCH_KEY');
        return _.defaults(this.resolved_master_keys_by_id[_id] || this._resolve_master_key(mkey), mkey);
    }

    update_master_keys(master_keys_by_id) {
        this.master_keys_by_id = master_keys_by_id;
    }

    async load_root_key() {
        if (this.is_initialized) return;
        const r_key_cr = await kube_utils.get_resource('secret', 'noobaa-root-master-key');
        if (!r_key_cr) throw new Error('NON_EXISTING_ROOT_KEY');
        const r_key = Object.keys(r_key_cr.data).reduce((acc, key) => {
            acc[key] = Buffer.from(r_key_cr.data[key], 'base64').toString('ascii');
            return acc;
        }, {});
        this.master_keys_by_id[ROOT_KEY] = r_key;
        this.resolved_master_keys_by_id[ROOT_KEY] = _.pick(r_key, RESOLVED_ROOT_SECRET_KEYS);
        this.is_initialized = true;
    }

    _resolve_master_key(m_key) {
        const m_of_mkey = this.get_master_key_by_id(m_key.master_key_id || ROOT_KEY);
        if (!m_of_mkey) throw new Error('NO_SUCH_KEY');
        return this._decipher_master_key({ m_key, m_of_mkey });
    }

    _decipher_master_key({ m_key, m_of_mkey }) {
        const decipher = crypto.createDecipheriv(m_of_mkey.cipher_type, m_of_mkey.cipher_key, m_of_mkey.cipher_iv);
        const cipher_key = decipher.update(m_key.cipher_key);
        decipher.final();
        return _.defaults({ cipher_key }, m_key);
    }

    decrypt_value_with_master_key_id(value, _id) {
        if (!_id) return value;
        const m_key = this.get_master_key_by_id(_id);
        if (!m_key) throw new Error('NO_SUCH_KEY');
        const decipher = crypto.createDecipheriv(m_key.cipher_type, m_key.cipher_key, m_key.cipher_iv);
        const deciphered_value = decipher.update(value);
        decipher.final();
        return deciphered_value;
    }

    encrypt_value_with_master_key_id(value, _id) {
        if (!_id) return value;
        const m_key = this.get_master_key_by_id(_id);
        if (!m_key) throw new Error('NO_SUCH_KEY');
        const cipher = crypto.createCipheriv(m_key.cipher_type, m_key.cipher_key, m_key.cipher_iv);
        const ciphered_value = cipher.update(value);
        cipher.final();
        return ciphered_value;
    }

    async new_master_key(options) {
        const { description, master_key_id, cipher_type } = options;
        const cipher_iv = Buffer.from(Array.prototype.map.call(Buffer.alloc(16), () => Math.floor(Math.random() * 256)));
        const m_key = _.omitBy({
            _id: mongo_utils.new_object_id(),
            description,
            master_key_id: master_key_id ? mongo_utils.parse_object_id(master_key_id) : undefined,
            cipher_type: cipher_type || config.CHUNK_CODER_CIPHER_TYPE,
            cipher_key: { binary: true },
            cipher_iv,
            disabled: false
        }, _.isUndefined);
        this.master_key_cache.put_in_cache(m_key._id, m_key);
    }

    get_root_key_id() {
        return ROOT_KEY;
    }

    [util.inspect.custom]() { return 'MasterKeysManager'; }
}

MasterKeysManager._instance = undefined;

// EXPORTS
exports.MasterKeysManager = MasterKeysManager;
exports.get_instance = MasterKeysManager.get_instance;
