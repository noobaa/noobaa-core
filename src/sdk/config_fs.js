/* Copyright (C) 2024 NooBaa */
'use strict';

const config = require('../../config');
const dbg = require('../util/debug_module')(__filename);
const _ = require('lodash');
const path = require('path');
const nb_native = require('../util/nb_native');
const native_fs_utils = require('../util/native_fs_utils');
const nc_mkm = require('../manage_nsfs/nc_master_key_manager').get_instance();

const CONFIG_SUBDIRS = Object.freeze({
    ACCOUNTS: 'accounts',
    BUCKETS: 'buckets',
    ACCESS_KEYS: 'access_keys'
});

const JSON_SUFFIX = '.json';
const SYMLINK_SUFFIX = '.symlink';

// TODO: A General Disclaimer about symlinks manipulated by this class - 
// currently we use direct symlink()/ unlink()
// safe_link / safe_unlink can be better but the current impl causing ELOOP - Too many levels of symbolic links
// need to find a better way for atomic unlinking of symbolic links
// handle atomicity for symlinks

class ConfigFS {

    /**
     * @param {string} config_root configuration directory path
     * @param {string} [config_root_backend] configuration directory backend type
     * @param {nb.NativeFSContext} [fs_context]
     */
    constructor(config_root, config_root_backend, fs_context) {
        this.config_root = config_root;
        this.config_root_backend = config_root_backend || config.NSFS_NC_CONFIG_DIR_BACKEND;
        this.accounts_dir_path = path.join(config_root, CONFIG_SUBDIRS.ACCOUNTS);
        this.access_keys_dir_path = path.join(config_root, CONFIG_SUBDIRS.ACCESS_KEYS);
        this.buckets_dir_path = path.join(config_root, CONFIG_SUBDIRS.BUCKETS);
        this.config_json_path = path.join(config_root, 'config.json');
        this.fs_context = fs_context || native_fs_utils.get_process_fs_context(this.config_root_backend);
    }

    /**
     * add_config_file_suffix returns the config_file_name follwed by the given suffix
     * @param {string} config_file_name
     * @param {string} suffix
     * @returns {string} 
     */
    add_config_file_suffix(config_file_name, suffix) {
        if (!config_file_name) throw new Error(`Config file name is missing - ${config_file_name}`);
        if (String(config_file_name).endsWith(suffix)) return config_file_name;
        return config_file_name + suffix;
    }


    /**
     * json returns the config_file_name with .json suffix
     * @param {string} config_file_name
     * @returns {string} 
     */
    json(config_file_name) {
        return this.add_config_file_suffix(config_file_name, JSON_SUFFIX);
    }

    /**
     * symlink returns the config_file_name with .symlink suffix
     * @param {string} config_file_name
     * @returns {string} 
     */
    symlink(config_file_name) {
        return this.add_config_file_suffix(config_file_name, SYMLINK_SUFFIX);
    }

    /**
    * validate_config_dir_exists validates the existance of config sub directory path
    * @param {string} config_dir_path 
    * @returns {Promise<boolean>}
    */
    async validate_config_dir_exists(config_dir_path) {
        return native_fs_utils.is_path_exists(this.fs_context, config_dir_path);
    }

    /**
    * create_config_dirs_if_missing creates config directory sub directories if missing
    */
    async create_config_dirs_if_missing() {
        const pre_req_dirs = [
            this.config_root,
            this.buckets_dir_path,
            this.accounts_dir_path,
            this.access_keys_dir_path,
        ];

        if (config.NSFS_GLACIER_LOGS_ENABLED) {
            pre_req_dirs.push(config.NSFS_GLACIER_LOGS_DIR);
        }

        for (const dir_path of pre_req_dirs) {
            try {
                const dir_exists = await this.validate_config_dir_exists(dir_path);
                if (dir_exists) {
                    dbg.log1('create_config_dirs_if_missing: config dir exists:', dir_path);
                } else {
                    await native_fs_utils._create_path(dir_path, this.fs_context, config.BASE_MODE_CONFIG_DIR);
                    dbg.log1('create_config_dirs_if_missing: config dir was created:', dir_path);
                }
            } catch (err) {
                dbg.log1('create_config_dirs_if_missing: could not create prerequisite path', dir_path);
            }
        }
    }

    /**
     * update_config_json_file updates the config.json file with the new configuration data
     * @param {object} data
     * @returns {Promise<void>} 
     */
    async update_config_json_file(data) {
        await native_fs_utils.update_config_file(this.fs_context, this.config_root, this.config_json_path, data);
    }

    /**
     * get_config_data reads a config file and returns its content 
     * while omitting secrets if show_secrets flag was not provided
     * and decrypts the account's secret_key if decrypt_secret_key is true
     * if silent_if_missing is true -      
     *   if the config file was deleted (encounter ENOENT error) - continue (returns undefined)
     * @param {string} config_file_path
     * @param {{show_secrets?: boolean, decrypt_secret_key?: boolean, silent_if_missing?: boolean}} [options]
     * @returns {Promise<Object>}
     */
    async get_config_data(config_file_path, options = {}) {
        const { show_secrets = false, decrypt_secret_key = false, silent_if_missing = false } = options;
        try {
            const { data } = await nb_native().fs.readFile(this.fs_context, config_file_path);
            const config_data = _.omit(JSON.parse(data.toString()), show_secrets ? [] : ['access_keys']);
            if (decrypt_secret_key) config_data.access_keys = await nc_mkm.decrypt_access_keys(config_data);
            return config_data;
        } catch (err) {
            dbg.warn('get_config_data: with config_file_path', config_file_path, 'got an error', err);
            if (silent_if_missing && err.code === 'ENOENT') return;
            throw err;
        }
    }

    ///////////////////////////////////////
    ////// ACCOUNT CONFIG DIR FUNCS  //////
    ///////////////////////////////////////

    /**
     * get_account_path_by_name returns the full account path by name
     * @param {string} account_name
     * @param {string} [owner_root_account_id]
     * @returns {string} 
     */
    get_account_path_by_name(account_name, owner_root_account_id) {
        // TODO -  change to this.symlink(account_name) on identities/ PR;
        return owner_root_account_id ?
            this.get_iam_account_path_by_name(account_name, owner_root_account_id) :
            this.get_root_account_path_by_name(account_name);
    }

    /**
     * get_root_account_path_by_name returns the full account path by name
     * @param {string} account_name
     * @returns {string} 
     */
    get_root_account_path_by_name(account_name) {
        // TODO -  change to this.symlink(account_name) on identities/ PR;
        return path.join(this.accounts_dir_path, this.json(account_name));
    }

    /**
     * get_iam_account_path_by_name returns the full account path by name
     * @param {string} account_name
     * @param {string} owner_root_account_id
     * @returns {string} 
    */
    get_iam_account_path_by_name(account_name, owner_root_account_id) {
       // TODO -  change to this.symlink(account_name) on identities/ PR;
       // update IAM user location identities/root_id_number/iam_account_name.symlink
       return path.join(this.accounts_dir_path, this.json(account_name));
    }

    /**
     * get_account_relative_path_by_name returns the full account path by name
     * @param {string} account_name
     * @returns {string} 
    */
    get_account_relative_path_by_name(account_name) {
       // TODO -  change to this.symlink(account_name) on identities/ PR;
       return path.join('../', CONFIG_SUBDIRS.ACCOUNTS, this.json(account_name));
    }

    /**
     * get_account_path_by_access_key returns the full account path by access key
     * @param {string} access_key
     * @returns {string} 
     */
    get_account_path_by_access_key(access_key) {
        return path.join(this.access_keys_dir_path, this.symlink(access_key));
    }

    /**
     * get_old_account_path_by_name returns the full account path by name based on old config dir structure
     * @param {string} account_name
     * @returns {string} 
    */
    get_old_account_path_by_name(account_name) {
        return path.join(this.accounts_dir_path, this.json(account_name));
    }

    /**
     * is_account_exists returns true if account config path exists in config dir
     * it can be determined by any account identifier - name, access_key and in the future id
     * @param {{ name?: string, access_key?: string }} identifier_object
     * @returns {Promise<boolean>} 
    */
    async is_account_exists(identifier_object) {
        if (!identifier_object || typeof identifier_object !== 'object') throw new Error('config_fs.is_account_exists - no identifier provided');
       let path_to_check;
       let use_lstat = false;
       if (identifier_object.name) {
           // TODO - when users/ move to be symlink we need to use_lstat by name, id is not using lstat
           path_to_check = this.get_account_path_by_name(identifier_object.name);
        } else if (identifier_object.access_key) {
            path_to_check = this.get_account_path_by_access_key(identifier_object.access_key);
            use_lstat = true;
       } else {
            throw new Error(`config_fs.is_account_exists - invalid identifier provided ${identifier_object}`);
        }
        // TODO - add is_account_exists by id when idenetities/ added
        // else if (identifier_object.id) {}
        return native_fs_utils.is_path_exists(this.fs_context, path_to_check, use_lstat);
    }

    /**
     * get_account_by_access_key returns the account data based on access key
     * while omitting secrets if show_secrets flag was not provided
     * and decrypts the account's secret_key if decrypt_secret_key is true
     * @param {string} access_key
     * @param {{show_secrets?: boolean, decrypt_secret_key?: boolean, silent_if_missing?: boolean}} [options]
     * @returns {Promise<Object>}
     */
    async get_account_by_access_key(access_key, options = {}) {
        const account_path = this.get_account_path_by_access_key(access_key);
        const account = await this.get_config_data(account_path, options);
        return account;
    }

    /**
     * get_account_by_name returns the account data based on name
     * while omitting secrets if show_secrets flag was not provided
     * and decrypts the account's secret_key if decrypt_secret_key is true
     * silent_if_missing -  is important when dealing with concurrency.
     * When we iterate files (for example for listing them) between the time we read the entries
     * from the directory and the time we we are trying to read the config file,
     * a file might be deleted (by another process), and we would not want to throw this error
     * as a part of iterating the file, therefore we continue
     * (not throwing this error and return undefined)
     * @param {string} account_name
     * @param {{show_secrets?: boolean, decrypt_secret_key?: boolean, silent_if_missing?: boolean}} [options]
     * @returns {Promise<Object>}
     */
    async get_account_by_name(account_name, options = {}) {
        const account_path = this.get_account_path_by_name(account_name);
        const account = await this.get_config_data(account_path, options);
        return account;
    }

    /**
     * list_root_accounts returns the root accounts array exists under the config dir
     * @returns {Promise<Dirent[]>} 
     */
    async list_root_accounts(options) {
        return nb_native().fs.readdir(this.fs_context, this.accounts_dir_path);
    }

    /**
     * create_account_config_file creates account config file
     * if account_data.access_keys is an array that contains at least 1 item -
     * link all item in account_data.access_keys to the relative path of the newly created config file
     * @param {string} account_name
     * @param {*} account_data
     * @param {boolean} symlink_new_access_keys
     * @param {String[]} old_access_keys
     * @returns {Promise<void>} 
     */
    async create_account_config_file(account_name, account_data, symlink_new_access_keys, old_access_keys = []) {
        const account_path = this.get_account_path_by_name(account_name);
        await native_fs_utils.create_config_file(this.fs_context, this.accounts_dir_path, account_path, JSON.stringify(account_data));

        if (old_access_keys.length > 0) {
            for (const access_key of old_access_keys) {
                const access_key_config_path = this.get_account_path_by_access_key(access_key);
                await nb_native().fs.unlink(this.fs_context, access_key_config_path);
            }
        }
        if (symlink_new_access_keys && account_data.access_keys?.length > 0) {
            for (const access_key_obj of account_data.access_keys) {
                const account_config_access_key_path = this.get_account_path_by_access_key(access_key_obj.access_key);
                const account_config_relative_path = this.get_account_relative_path_by_name(account_name);
                await native_fs_utils._create_path(this.access_keys_dir_path, this.fs_context, config.BASE_MODE_CONFIG_DIR);
                await nb_native().fs.symlink(this.fs_context, account_config_relative_path, account_config_access_key_path);
            }
        }
    }

    /**
     * update_account_config_file updates account config file
     * if old_access_keys is an array that contains at least 1 item -
     * unlink old access_keys and link new access_keys
     * @param {string} account_name
     * @param {Object} account_new_data
     * @param {Object[]} [new_access_keys_to_link]
     * @param {String[]} [old_access_keys_to_remove]
     * @returns {Promise<void>}
     */
    async update_account_config_file(account_name, account_new_data, new_access_keys_to_link = [], old_access_keys_to_remove = []) {
        const account_config_path = this.get_account_path_by_name(account_name);
        await native_fs_utils.update_config_file(this.fs_context, this.accounts_dir_path,
            account_config_path, JSON.stringify(account_new_data));

        if (new_access_keys_to_link.length > 0) {
            for (const access_keys of new_access_keys_to_link) {
                const new_access_key_path = this.get_account_path_by_access_key(access_keys.access_key);
                const account_config_relative_path = this.get_account_relative_path_by_name(account_name);
                await nb_native().fs.symlink(this.fs_context, account_config_relative_path, new_access_key_path);
            }
        }

        if (old_access_keys_to_remove.length > 0) {
            for (const access_key of old_access_keys_to_remove) {
                const cur_access_key_path = this.get_account_path_by_access_key(access_key);
                await nb_native().fs.unlink(this.fs_context, cur_access_key_path);
            }
        }
    }

    /**
     * delete_account_config_file deletes account config file
     * if access_keys_to_delete is an array that contains at least 1 item -
     * unlink all items in access_keys_to_delete
     * @param {string} account_name
     * @param {Object[]} [access_keys_to_delete]
     * @returns {Promise<void>} 
     */
    async delete_account_config_file(account_name, access_keys_to_delete = []) {
        const account_config_path = this.get_account_path_by_name(account_name);
        await native_fs_utils.delete_config_file(this.fs_context, this.accounts_dir_path, account_config_path);
        for (const access_keys of access_keys_to_delete) {
            const access_key_config_path = this.get_account_path_by_access_key(access_keys.access_key);
            await nb_native().fs.unlink(this.fs_context, access_key_config_path);
        }
    }

    /**
     * unlink_access_key_symlink unlinks the access key from the file system
     * @param {string} access_key
     * @returns {Promise<void>} 
     */
    async unlink_access_key_symlink(access_key) {
        const acces_key_path = this.get_account_path_by_access_key(access_key);
        await nb_native().fs.unlink(this.fs_context, acces_key_path);
    }

    //////////////////////////////////////
    ////// BUCKET CONFIG DIR FUNCS  //////
    //////////////////////////////////////

    /**
     * get_bucket_by_name returns the full bucket path by name
     * @param {string} bucket_name
     * @returns {string} 
     */
    get_bucket_path_by_name(bucket_name) {
        const new_path = path.join(this.buckets_dir_path, this.json(bucket_name));
        return new_path;
    }

    /**
     * is_bucket_exists returns true if bucket config path exists in config dir
     * @param {string} bucket_name
     * @returns {Promise<boolean>} 
     */
    async is_bucket_exists(bucket_name) {
        const path_to_check = this.get_bucket_path_by_name(bucket_name);
        return native_fs_utils.is_path_exists(this.fs_context, path_to_check);
    }

    /**
     * get_bucket_by_name returns the full bucket info by name
     * @param {string} bucket_name
     * @param {{silent_if_missing?: boolean}} [options]
     * @returns {Promise<any>} 
     */
    async get_bucket_by_name(bucket_name, options = {}) {
        const bucket_path = this.get_bucket_path_by_name(bucket_name);
        const bucket = await this.get_config_data(bucket_path, options);
        return bucket;
    }

    /**
     * list_buckets returns the array of buckets that exists under the config dir
     * @returns {Promise<Dirent[]>} 
     */
    async list_buckets() {
        return nb_native().fs.readdir(this.fs_context, this.buckets_dir_path);
    }

    /**
     * create_bucket_config_file creates bucket config file
     * @param {string} bucket_name
     * @param {*} data
     * @returns {Promise<void>} 
     */
    async create_bucket_config_file(bucket_name, data) {
        const bucket_path = this.get_bucket_path_by_name(bucket_name);
        await native_fs_utils.create_config_file(this.fs_context, this.buckets_dir_path, bucket_path, data);
    }

    /**
     * update_bucket_config_file updates bucket config file
     * @param {string} bucket_name
     * @param {*} data
     * @returns {Promise<void>} 
     */
    async update_bucket_config_file(bucket_name, data) {
        const bucket_config_path = this.get_bucket_path_by_name(bucket_name);
        await native_fs_utils.update_config_file(this.fs_context, this.buckets_dir_path, bucket_config_path, data);
    }

    /**
     * delete_bucket_config_file deletes bucket config file
     * @param {string} bucket_name
     * @returns {Promise<void>} 
     */
    async delete_bucket_config_file(bucket_name) {
        const bucket_config_path = this.get_bucket_path_by_name(bucket_name);
        await native_fs_utils.delete_config_file(this.fs_context, this.buckets_dir_path, bucket_config_path);
    }
}

// EXPORTS
exports.SYMLINK_SUFFIX = SYMLINK_SUFFIX;
exports.JSON_SUFFIX = JSON_SUFFIX;
exports.CONFIG_SUBDIRS = CONFIG_SUBDIRS;
exports.ConfigFS = ConfigFS;
