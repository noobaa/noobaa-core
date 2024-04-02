/* Copyright (C) 2023 NooBaa */
'use strict';

const _ = require('lodash');
const util = require('util');
const path = require('path');
const crypto = require('crypto');
const P = require('../util/promise');
const config = require('../../config');
const os_util = require('../util/os_utils');
const RpcError = require('../rpc/rpc_error');
const nb_native = require('../util/nb_native');
const db_client = require('../util/db_client').instance();
const dbg = require('../util/debug_module')(__filename);
const native_fs_utils = require('../util/native_fs_utils');

const TYPE_FILE = 'file';
const TYPE_EXEC = 'executable';
const ACTIVE_MASTER_KEY = 'active_master_key';
const exec_key_suffix = 'master_keys';

class NCMasterKeysManager {
    constructor() {
        this.active_master_key = undefined;
        this.master_keys_by_id = {};
        this.last_init_time = 0;
    }

    static get_instance() {
        NCMasterKeysManager._instance = NCMasterKeysManager._instance || new NCMasterKeysManager();
        return NCMasterKeysManager._instance;
    }

    /**
     * init inits master_key_manager by the store type
     */
    async init() {
        const store_type = config.NC_MASTER_KEYS_STORE_TYPE;
        if (store_type === TYPE_FILE) {
            return this._init_from_file();
        } else if (store_type === TYPE_EXEC) {
            return this._init_from_exec();
        }
        throw new Error(`Invalid Master keys store type - ${store_type} - ${TYPE_EXEC}`);
    }

    /**
     * _set_keys sets the master_key_manager peoperties by master_keys object
     * @param {Object} master_keys
     * @returns {Promise<Object>}
     */
    _set_keys(master_keys) {
        if (!master_keys.active_master_key) throw new RpcError('INVALID_MASTER_KEYS_FILE', 'Invalid master_keys.json file');
        for (const [key_name, master_key] of Object.entries(master_keys)) {
            try {
                if (key_name === ACTIVE_MASTER_KEY) {
                    this.active_master_key = get_buffered_master_key(master_key);
                }
                this.master_keys_by_id[master_key.id] = get_buffered_master_key(master_key);
            } catch (err) {
                dbg.error('couldn\'t load master_keys.json file', err);
                throw new RpcError('INVALID_MASTER_KEYS_FILE', 'Invalid master_keys.json file');
            }
        }
        dbg.log1(`_set_keys: master_key_manager updated successfully! active master key is: ${util.inspect(this.active_master_key)}`);
        return this.active_master_key;
    }

    /**
     * _create_master_key generates a new master key
     */
    async _create_master_key() {
        const master_key = {
            id: db_client.new_object_id(),
            cipher_key: crypto.randomBytes(32),
            cipher_iv: crypto.randomBytes(16),
            encryption_type: 'aes-256-gcm'
        };
        const store_type = config.NC_MASTER_KEYS_STORE_TYPE;
        const stringed_master_key = get_stringed_master_key(master_key);
        if (store_type === TYPE_FILE) {
            // write master key to file
            return this._create_master_keys_file(stringed_master_key);
        } else if (store_type === TYPE_EXEC) {
            return this._create_master_keys_exec(stringed_master_key);
        }
        throw new Error(`Invalid Master keys store type - ${store_type}`);
    }

    ////////////////
    //  FILE API  //
    ////////////////

    /**
     * _init_from_file reads master keys json file and loads its data
     */
    async _init_from_file() {
        const master_keys_path = get_master_keys_file_path();
        const fs_context = native_fs_utils.get_process_fs_context();
        for (let retries = 0; retries < 3;) {
            try {
                const stat = await nb_native().fs.stat(fs_context, master_keys_path);
                if (stat.ctime.getTime() === this.last_init_time) return;
                const master_keys = await native_fs_utils.read_file(fs_context, master_keys_path);

                this._set_keys(master_keys);
                this.last_init_time = stat.ctime.getTime();
                return;
            } catch (err) {
                if (err.code === 'ENOENT') {
                    dbg.warn('init_from_file: couldn\'t find master keys file', master_keys_path);
                    await this._create_master_key();
                } else if (err.rpc_code === 'INVALID_MASTER_KEYS_FILE') {
                    dbg.error('init_from_file: master keys file is invalid', master_keys_path);
                    throw err;
                } else {
                    dbg.error('init_from_file: couldn\'t load master keys file', master_keys_path);
                    retries += 1;
                    await P.delay(1000);
                }
            }
        }
        throw new Error('init_from_file exhausted');
    }

    /**
     * _create_master_keys_file updates master_keys.json file
     * @param {object} new_master_key
     */
    async _create_master_keys_file(new_master_key) {
        const master_keys_path = get_master_keys_file_path();
        const parent_dir = path.dirname(master_keys_path);
        const fs_context = native_fs_utils.get_process_fs_context();
        try {
            const data = JSON.stringify({ active_master_key: new_master_key });
            await native_fs_utils.create_config_file(fs_context, parent_dir, master_keys_path, data);
        } catch (err) {
            dbg.warn('create_master_keys_file got err', err);
            if (err.code === 'EEXIST') return;
            throw err;
        }
    }

    //////////////////////
    //  EXECUTABLE API  //
    //////////////////////

    /**
     * _create_master_keys_exec executes get master keys executable and retuns its data
     * @returns {Promise<Object>}
     */
    async _create_master_keys_exec(master_key) {
        const master_keys_json = JSON.stringify({ active_master_key: master_key });
        await os_util.spawn(config.NC_MASTER_KEYS_PUT_EXECUTABLE, [exec_key_suffix], { input: master_keys_json, stdio: [] });
    }

    /**
     * _init_from_exec init master keys from executable
     */
    async _init_from_exec() {
        const command = `${config.NC_MASTER_KEYS_GET_EXECUTABLE} ${exec_key_suffix}`;
        for (let retries = 0; retries < 3;) {
            try {
                if (this.last_init_time &&
                    (new Date()).getTime() - this.last_init_time > config.NC_MASTER_KEYS_MANAGER_REFRESH_THRESHOLD) return;
                const master_keys = await os_util.exec(command, { return_stdout: true });
                const parsed_master_keys = JSON.parse(master_keys);
                this._set_keys(parsed_master_keys);
                this.last_init_time = (new Date()).getTime();
                return;
            } catch (err) {
                if (err.stderr && err.stderr.trim() === 'NO_SUCH_KEY') {
                    dbg.warn('init_from_exec: couldn\'t find master keys', err, err.code);
                    await this._create_master_key();
                } else {
                    dbg.error('init_from_exec: couldn\'t load master keys', err, err.code);
                    retries += 1;
                    await P.delay(1000);
                }
            }
        }
        throw new Error('init_from_exec exhausted');
    }

    /**
     * encrypt refreshes the cache encrypts a secret_key using the cached active master key
     * @param {string} secret_key
     * @param {nb.ID} master_key_id
     * @returns {Promise<string>}
     */
    async encrypt(secret_key, master_key_id) {
        await this.init();
        return this.encryptSync(secret_key, master_key_id);
    }

    /**
     * encryptSync encrypts a secret_key using the cached active master key
     * @param {string} secret_key
     * @param {nb.ID} master_key_id
     * @returns {string}
     */
    encryptSync(secret_key, master_key_id = this.active_master_key?.id) {
        const { cipher_key, cipher_iv, encryption_type } = this.master_keys_by_id[master_key_id];
        const cipher = crypto.createCipheriv(encryption_type, cipher_key, cipher_iv);
        const updated_value = cipher.update(Buffer.from(secret_key));
        const enccypted_value = updated_value.toString('base64');
        return enccypted_value;
    }

    /**
     * decrypt refreshes the cache and decrypts a secret_key using the cached master key
     * @param {string} secret_key
     * @param {nb.ID} master_key_id
     * @returns {Promise<string>}
     */
    async decrypt(secret_key, master_key_id) {
        await this.init();
        return this.decryptSync(secret_key, master_key_id);
    }

    /**
     * decrypt decrypts a secret_key using the cached master key
     * @param {string} secret_key
     * @param {nb.ID} master_key_id
     * @returns {string}
     */
    decryptSync(secret_key, master_key_id) {
        const { cipher_key, cipher_iv, encryption_type } = this.master_keys_by_id[master_key_id];
        const decipher = crypto.createDecipheriv(encryption_type, cipher_key, cipher_iv);
        const decrypted_secret_key = decipher.update(Buffer.from(secret_key, 'base64')).toString();
        return decrypted_secret_key;
    }

    /**
     * encrypt_access_keys encrypts the secret key of an account and returns the encypted account data
     * @param {Object} account
     * @returns {Promise<Object>}
     */
    async encrypt_access_keys(account) {
        await this.init();
        const master_key_id = this.active_master_key.id;
        const encrypted_access_keys = await P.all(_.map(account.access_keys, async access_keys => ({
            access_key: access_keys.access_key,
            encrypted_secret_key: await this.encrypt(access_keys.secret_key, master_key_id)
        })));
        return { ...account, access_keys: encrypted_access_keys, master_key_id };
    }

    /**
     * decrypt_access_keys decrypts the secret key of an account and returns the decrypted access keys
     * @param {Object} account
     * @returns {Promise<Object>}
     */
    async decrypt_access_keys(account) {
        const decrypted_access_keys = await P.all(_.map(account.access_keys, async access_keys => ({
                access_key: access_keys.access_key,
                secret_key: await this.decrypt(access_keys.encrypted_secret_key, account.master_key_id)
        })));
        return decrypted_access_keys;
    }
}

/**
 * get_buffered_master_key converts cipher_key and cipher_iv base64 strings to buffers
 * @param {object} master_key
 */
function get_buffered_master_key(master_key) {
    try {
        const buffered_master_key = {
            ...master_key,
            cipher_key: Buffer.from(master_key.cipher_key, 'base64'),
            cipher_iv: Buffer.from(master_key.cipher_iv, 'base64'),
        };
        return buffered_master_key;
    } catch (err) {
        throw new RpcError('INVALID_MASTER_KEYS_FILE', 'Invalid master_keys.json file');
    }
}

/**
 * get_stringed_master_key converts cipher_key and cipher_iv buffers of strings in base64 
 * @param {object} master_key
 */
function get_stringed_master_key(master_key) {
    const stringed_master_key = {
        ...master_key,
        cipher_key: master_key.cipher_key.toString('base64'),
        cipher_iv: master_key.cipher_iv.toString('base64'),
    };
    return stringed_master_key;
}

/**
 * get_master_keys_file_path returns the master_keys.json file
 * @returns {string}
 */
function get_master_keys_file_path() {
    const default_master_keys_path = path.join(config.NSFS_NC_CONF_DIR, 'master_keys.json');
    const master_keys_path = config.NC_MASTER_KEYS_FILE_LOCATION || default_master_keys_path;
    return master_keys_path;
}

NCMasterKeysManager._instance = undefined;

// EXPORTS
exports.NCMasterKeysManager = NCMasterKeysManager;
exports.get_instance = NCMasterKeysManager.get_instance;
