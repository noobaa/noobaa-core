/* Copyright (C) 2024 NooBaa */
'use strict';

const os = require('os');
const util = require('util');
const _ = require('lodash');
const path = require('path');
const P = require('../util/promise');
const config = require('../../config');
const pkg = require('../../package.json');
const dbg = require('../util/debug_module')(__filename);
const os_utils = require('../util/os_utils');
const SensitiveString = require('../util/sensitive_string');
const nb_native = require('../util/nb_native');
const native_fs_utils = require('../util/native_fs_utils');
const { RpcError } = require('../rpc');
const nc_mkm = require('../manage_nsfs/nc_master_key_manager').get_instance();
const nsfs_schema_utils = require('../manage_nsfs/nsfs_schema_utils');
const { version_compare } = require('../upgrade/upgrade_utils');
const { anonymous_access_key } = require('./object_sdk');

/** @typedef {import('fs').Dirent} Dirent */

/* Config directory sub directory comments - 
   On 5.18 - 
   1. accounts/ will be deprecated
   2. A new identities/ directory will be created that represents an account identity, 
      for example -
      when an account called alice is created (id = 111) and an IAM user called bob (id = 222) 
      was created for alice, in the FS it will look as the folloing - 
      2.1. config_dir/identities/111/identity.json -> represents the account properties (alice)
      2.2. config_dir/identities/111/users/ -> represents the account's iam users
      2.3. config_dir/identities/111/users/bob.symlink -> config_dir/identities/222/identity.json (an index to another identity)
      2.4. config_dir/identities/222/identity.json -> represents the account properties (bob)     
      in the future the identity directory will contain more features like policies, roles etc.
   3. A new accounts_by_name/ directory will be created that represents an index which is a 
      a symlink from account name to its actual identity.
      For example - 
      config_dir/accounts_by_name/alice.symlink -> config_dir/identities/111/identity.json
*/

const CONFIG_SUBDIRS = Object.freeze({
    BUCKETS: 'buckets',
    ACCESS_KEYS: 'access_keys',
    IDENTITIES: 'identities',
    ACCOUNTS_BY_NAME: 'accounts_by_name',
    ACCOUNTS: 'accounts', // deprecated on 5.18
    USERS: 'users',
    CONNECTIONS: 'connections',
});

const CONFIG_TYPES = Object.freeze({
    ACCOUNT: 'account',
    BUCKET: 'bucket',
});

const JSON_SUFFIX = '.json';
const SYMLINK_SUFFIX = '.symlink';

const CONFIG_DIR_PHASES = Object.freeze({
    CONFIG_DIR_LOCKED: 'CONFIG_DIR_LOCKED',
    CONFIG_DIR_UNLOCKED: 'CONFIG_DIR_UNLOCKED'
});

// TODO: A General Disclaimer about symlinks manipulated by this class - 
// currently we use direct symlink()/ unlink()
// safe_link / safe_unlink can be better but the current impl causing ELOOP - Too many levels of symbolic links
// need to find a better way for atomic unlinking of symbolic links
// handle atomicity for symlinks


/**
 * config_dir_version is a semver that describes the config directory's version.  
 * config_dir_version is planned to be upgraded when a change that can not be solved only by backward compatibility 
 * and must require a use of an upgrade script.
 * The config directory upgrade script will handle config directory changes of the structure or content of the config files.
 * The upgrade script will run via `noobaa-cli upgrade run command`
 */

const CONFIG_DIR_VERSION = '1.0.0';

class ConfigFS {

    /**
     * @param {string} config_root configuration directory path
     * @param {string} [config_root_backend] configuration directory backend type
     * @param {nb.NativeFSContext} [fs_context]
     */
    constructor(config_root, config_root_backend, fs_context) {
        this.config_root = config_root;
        this.config_root_backend = config_root_backend || config.NSFS_NC_CONFIG_DIR_BACKEND;
        this.config_dir_version = CONFIG_DIR_VERSION;
        this.old_accounts_dir_path = path.join(config_root, CONFIG_SUBDIRS.ACCOUNTS);
        this.accounts_by_name_dir_path = path.join(config_root, CONFIG_SUBDIRS.ACCOUNTS_BY_NAME);
        this.identities_dir_path = path.join(config_root, CONFIG_SUBDIRS.IDENTITIES);
        this.access_keys_dir_path = path.join(config_root, CONFIG_SUBDIRS.ACCESS_KEYS);
        this.buckets_dir_path = path.join(config_root, CONFIG_SUBDIRS.BUCKETS);
        this.connections_dir_path = path.join(config_root, CONFIG_SUBDIRS.CONNECTIONS);
        this.system_json_path = path.join(config_root, 'system.json');
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
        if (!config_file_name) dbg.warn(`Config file name is missing - ${config_file_name}`);
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
     * create_dir_if_missing creates a directory specified by dir_path if it does not exist
     * @param {string} dir_path
     * @returns {Promise<void>}
     */
    async create_dir_if_missing(dir_path) {
        try {
            const dir_exists = await this.validate_config_dir_exists(dir_path);
            if (dir_exists) {
                dbg.log1('create_dir_if_missing: config dir exists:', dir_path);
            } else {
                await native_fs_utils._create_path(dir_path, this.fs_context, config.BASE_MODE_CONFIG_DIR);
                dbg.log1('create_dir_if_missing: config dir was created:', dir_path);
            }
        } catch (err) {
            dbg.log1('create_dir_if_missing: could not create prerequisite path', dir_path);
        }
    }

    /**
     * create_config_dirs_if_missing creates config directory sub directories if missing
     */
    async create_config_dirs_if_missing() {
        const pre_req_dirs = [
            this.config_root,
            this.buckets_dir_path,
            this.accounts_by_name_dir_path,
            this.identities_dir_path,
            this.access_keys_dir_path,
            this.connections_dir_path,
        ];

        if (config.NSFS_GLACIER_LOGS_ENABLED) {
            pre_req_dirs.push(config.NSFS_GLACIER_LOGS_DIR);
        }

        for (const dir_path of pre_req_dirs) {
            await this.create_dir_if_missing(dir_path);
        }
    }

    /**
     * get_config_json_path returns config.json file path
     * @returns {String} 
     */
    get_config_json_path() {
        return this.config_json_path;
    }

    /**
     * get_config_json returns config.json file data
     * @returns {Promise<Object>} 
     */
    async get_config_json() {
        const config_json_data = await this.get_config_data(this.config_json_path);
        return config_json_data;
    }

    /**
     * create_config_json_file creates the config.json file with the configuration data
     * @param {object} data
     * @returns {Promise<void>} 
     */
    async create_config_json_file(data) {
        await native_fs_utils.create_config_file(this.fs_context, this.config_root, this.config_json_path, data);
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
     * delete_config_json_file deletes the config.json file
     * @returns {Promise<void>} 
     */
    async delete_config_json_file() {
        await native_fs_utils.delete_config_file(this.fs_context, this.config_root, this.config_json_path);
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
    async get_identity_config_data(config_file_path, options = {}) {
        const { show_secrets = false, decrypt_secret_key = false, silent_if_missing = false } = options;
        try {
            const data = await this.get_config_data(config_file_path, options);
            if (!data && silent_if_missing) return;
            const config_data = _.omit(data, show_secrets ? [] : ['access_keys']);
            if (decrypt_secret_key) config_data.access_keys = await nc_mkm.decrypt_access_keys(config_data);
            return config_data;
        } catch (err) {
            dbg.warn('get_identity_config_data: with config_file_path', config_file_path, 'got an error', err);
            if (err.code === 'ENOENT' && silent_if_missing) return;
            throw err;
        }
    }
    /**
     * get_config_data reads a config file and returns its content
     * @param {string} config_file_path
     * @param {{ silent_if_missing?: boolean }} [options]
     * @returns {Promise<Object>}
     */
    async get_config_data(config_file_path, options = {}) {
        try {
            const { data } = await nb_native().fs.readFile(this.fs_context, config_file_path);
            const config_data = JSON.parse(data.toString());
            return config_data;
        } catch (err) {
            dbg.warn('get_config_data: with config_file_path', config_file_path, 'got an error', err);
            if (err.code === 'ENOENT' && options.silent_if_missing) return;
            throw err;
        }
    }

    ///////////////////////////////////////
    ////// ACCOUNT CONFIG DIR FUNCS  //////
    ///////////////////////////////////////

    /**
     * get_account_path_by_name returns the full user or account path by name
     * @param {string} account_name
     * @param {string} [owner_account_id]
     * @returns {string} 
     */
    get_account_or_user_path_by_name(account_name, owner_account_id) {
        return owner_account_id ?
            this.get_user_path_by_name(account_name, owner_account_id) :
            this.get_account_path_by_name(account_name);
    }

    /**
     * get_account_path_by_name returns the full account path by name
     * root account can be found by name under accounts_by_name/account_name.symlink
     * @param {string} account_name
     * @returns {string} 
     */
    get_account_path_by_name(account_name) {
        return path.join(this.accounts_by_name_dir_path, this.symlink(account_name));
    }

    /**
     * get_user_path_by_name returns the full iam user path by name
     * user can be found by name under identities/<owner_account_id>/users/<user_name>.symlink
     * @param {string} username
     * @param {string} owner_account_id
     * @returns {string} 
     */
    get_user_path_by_name(username, owner_account_id) {
        return path.join(this.identities_dir_path, owner_account_id, CONFIG_SUBDIRS.USERS, this.symlink(username));
    }

    /**
     * get_old_account_relative_path_by_name returns the old (5.17) full account path by name
     * @param {string} account_name
     * @returns {string} 
    */
    get_old_account_relative_path_by_name(account_name) {
        return path.join('../', CONFIG_SUBDIRS.ACCOUNTS, this.json(account_name));
    }

    /**
     * get_account_or_user_relative_path_by_id returns the full user/account path by id
     * in case it is user the account ID is the user ID (_id in the config file)
     * @param {string} account_id
     * @param {string} [owner_account_id]
     * @returns {string} 
    */
    get_account_or_user_relative_path_by_id(account_id, owner_account_id) {
        return owner_account_id === undefined ?
            this.get_account_relative_path_by_id(account_id) :
            this.get_user_relative_path_by_id(account_id);
    }

    /**
     * get_account_relative_path_by_id returns the full account path by id
     * the target of symlinks will be the 
     * @param {string} account_id
     * @returns {string} 
    */
    get_account_relative_path_by_id(account_id) {
       return path.join('../', CONFIG_SUBDIRS.IDENTITIES, account_id, this.json('identity'));
    }

    /**
     * get_account_relative_path_by_id returns the full user path by id
     * @param {string} user_id
     * @returns {string} 
    */
    get_user_relative_path_by_id(user_id) {
        return path.join('../', '../', user_id, this.json('identity'));
    }

    /**
     * get_identity_path_by_id returns the full identity path by id as following - 
     * {config_dir}/identities/{id}/identity.json
     * @param {string} id
     * @returns {string} 
    */
    get_identity_path_by_id(id) {
        return path.join(this.identities_dir_path, id, this.json('identity'));
    }

    /**
     * get_identity_by_id returns the full account/user data by id from the following path
     * {config_dir}/identities/{account_id}/identity.json
     * @param {string} id
     * @param {string} [type]
     * @param {{show_secrets?: boolean, decrypt_secret_key?: boolean, silent_if_missing?: boolean}} [options]
     * @returns {Promise<Object>} 
    */
    async get_identity_by_id(id, type, options = {}) {
        const identity_path = this.get_identity_path_by_id(id);
        let identity = await this.get_identity_config_data(identity_path, { ...options, silent_if_missing: true });

        if (!identity && type === CONFIG_TYPES.ACCOUNT) {
            identity = await this.search_accounts_by_id(id, options);
        }
        if (!identity && !options.silent_if_missing) {
            const err = new Error(`Could not find identity by id ${id}`);
            err.code = 'ENOENT';
            throw err;
        }
        return identity;
    }

    /**
     * search_accounts_by_id searches old accounts directory and finds an account that its _id matches the given id param
     * @param {string} id
     * @param {{show_secrets?: boolean, decrypt_secret_key?: boolean, silent_if_missing?: boolean}} [options]
     * @returns {Promise<Object>} 
    */
    async search_accounts_by_id(id, options = {}) {
        const old_account_names = await this.list_old_accounts();
        for (const account_name of old_account_names) {
            const account_data = await this.get_account_by_name(account_name, { ...options, silent_if_missing: true });
            if (!account_data) continue;
            if (account_data._id === id) return account_data;
        }
    }

    /**
     * get_identities_by_id returns the full account/user data by id from the following path
     * {config_dir}/identities/{id}/identity.json
     * @param {string[]} ids
     * @returns {Promise<Object>} 
    */
    async get_identities_by_id(ids, options = {}) {
        const res = [];
        for (const id of ids) {
            const id_path = this.get_identity_path_by_id(id);
            const id_data = await this.get_identity_config_data(id_path, { ...options, silent_if_missing: true });
            if (!id_data) continue;
            res.push(id_data);
        }
        return res;
    }

    /**
     * get_identity_path_by_id returns the account/user identity dir path by id as follows
     * {config_dir}/identities/{account_id}/
     * @param {string} id
     * @returns {string} 
    */
    get_identity_dir_path_by_id(id) {
        return path.join(this.identities_dir_path, id, '/');
    }

    /**
     * get_users_dir_path_by_id returns the path {config_dir}/identities/{account_id}/users
     * @param {string} id
     * @returns {string} 
     */
    get_users_dir_path_by_id(id) {
        return path.join(this.identities_dir_path, id, CONFIG_SUBDIRS.USERS);
    }

    /**
     * get_account_or_user_path_by_access_key returns the full account path by access key as follows
     * {config_dir}/access_keys/{access_key}.symlink
     * @param {string} access_key
     * @returns {string} 
     */
    get_account_or_user_path_by_access_key(access_key) {
        return path.join(this.access_keys_dir_path, this.symlink(access_key));
    }

    /**
     * _get_old_account_path_by_name returns the full account path by name based on old config dir structure
     * as follows - {config_dir}/accounts/{access_name}.json
     * @param {string} account_name
     * @returns {string} 
    */
    _get_old_account_path_by_name(account_name) {
        return path.join(this.old_accounts_dir_path, this.json(account_name));
    }

    /**
     * stat_account_config_file will return the stat output on account config file
     * please notice that stat might throw an error - you should wrap it with try-catch and handle the error
     * Note: access_key type of anonymous_access_key is a symbol, otherwise it is a string (not SensitiveString)
     * @param {Symbol|string} access_key
     * @returns {Promise<nb.NativeFSStats>}
     */
    stat_account_config_file(access_key) {
        let path_for_account_or_user_config_file;
        if (typeof access_key === 'symbol' && access_key === anonymous_access_key) { // anonymous account case
            path_for_account_or_user_config_file = this.get_account_path_by_name(config.ANONYMOUS_ACCOUNT_NAME);
        } else if (typeof access_key === 'string') { // rest of the cases
            path_for_account_or_user_config_file = this.get_account_or_user_path_by_access_key(access_key);
        } else { // we should not get here
            throw new Error(`access_key must be a from valid type ${typeof access_key} ${access_key}`);
        }
        return nb_native().fs.stat(this.fs_context, path_for_account_or_user_config_file);
    }

    /**
     * is_account_exists_by_name returns true if account config path exists in config dir
     * if account does not exist and it's a regular account (not an IAM user) 
     * try to locate it under the old accounts/ directory
     * @param {string} account_name
     * @param {string} [owner_account_id]
     * @returns {Promise<boolean>} 
    */
    async is_account_exists_by_name(account_name, owner_account_id) {
        const path_to_check = this.get_account_or_user_path_by_name(account_name, owner_account_id);
        let account_exists = await native_fs_utils.is_path_exists(this.fs_context, path_to_check);

        if (!account_exists && account_name !== undefined && owner_account_id === undefined) {
            const old_path_to_check = this._get_old_account_path_by_name(account_name);
            account_exists = await native_fs_utils.is_path_exists(this.fs_context, old_path_to_check);
        }
        return account_exists;
    }

    /**
     * is_identity_exists returns true if identity config path exists in config dir
     * @param {string} id
     * @param {string} [type]
     * @param {{show_secrets?: boolean, decrypt_secret_key?: boolean, silent_if_missing?: boolean}} [options]
     * @returns {Promise<boolean>} 
    */
    async is_identity_exists(id, type, options) {
        const path_to_check = this.get_identity_path_by_id(id);
        let identity = await native_fs_utils.is_path_exists(this.fs_context, path_to_check);

        if (!identity && type === CONFIG_TYPES.ACCOUNT) {
            identity = await this.search_accounts_by_id(id, options);
        }
        if (!identity && !options.silent_if_missing) {
            const err = new Error(`Could not find identity by id ${id}`);
            err.code = 'ENOENT';
            throw err;
        }
        return identity;
    }

    /**
     * is_account_exists_by_access_key returns true if account config path exists in config dir
     * @param {string} access_key
     * @returns {Promise<boolean>} 
    */
    async is_account_exists_by_access_key(access_key) {
        const path_to_check = this.get_account_or_user_path_by_access_key(access_key);
        return native_fs_utils.is_path_exists(this.fs_context, path_to_check);
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
        const account_path = this.get_account_or_user_path_by_access_key(access_key);
        const account = await this.get_identity_config_data(account_path, options);
        return account;
    }

     /**
     * get_account_or_user_by_name returns the account/user data based on name
     * in case it is user - must pass the owner_account_id
     * @param {string} account_name
     * @param {string} [owner_account_id]
     * @param {{show_secrets?: boolean, decrypt_secret_key?: boolean, silent_if_missing?: boolean}} [options]
     * @returns {Promise<Object>}
     */
    async get_account_or_user_by_name(account_name, owner_account_id, options = {}) {
        return owner_account_id ?
            await this.get_user_by_name(account_name, owner_account_id, options) :
            await this.get_account_by_name(account_name, options);
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
        let account = await this.get_identity_config_data(account_path, { ...options, silent_if_missing: true });
        if (!account) {
            const old_account_path = this._get_old_account_path_by_name(account_name);
            account = await this.get_identity_config_data(old_account_path, { ...options, silent_if_missing: true });
        }
        if (!account && !options.silent_if_missing) {
            const err = new Error(`Could not find account by name ${account_name}`);
            err.code = 'ENOENT';
            throw err;
        }
        return account;
    }

    /**
     * is_account_exists_by_principal checks if we can get the account in multiple ways:
     * 1. name
     * 2. id
     * (in the future using ARN - currently it is a GAP)
     * 
     * @param {string|SensitiveString} principal
     * @param {object} options
     * @returns {Promise<Boolean>}
     */
    async is_account_exists_by_principal(principal, options = { silent_if_missing: true }) {
        if (principal === undefined) return undefined;

        const principal_as_string = principal instanceof SensitiveString ? principal.unwrap() : principal;
        const arn_prefix = 'arn:aws:iam::';
        dbg.log2('is_account_exists_by_principal:', principal, options);
        if (principal_as_string.includes(arn_prefix)) {
            return false; // GAP
        }
        const principal_by_id = await this.is_identity_exists(principal_as_string, undefined, options);
        dbg.log2('is_account_exists_by_principal: principal_by_id', principal_by_id);
        if (principal_by_id) return true;
        const principal_by_name = await this.is_account_exists_by_name(principal_as_string, undefined);
        dbg.log2('is_account_exists_by_principal: principal_by_name', principal_by_name);
        if (principal_by_name) return true;
        return false;
    }

    /**
     * get_user_by_name returns the user data based on username and owner_account_id
     * @param {string} username
     * @param {string} owner_account_id
     * @param {{show_secrets?: boolean, decrypt_secret_key?: boolean, silent_if_missing?: boolean}} [options]
     * @returns {Promise<Object>}
     */
    async get_user_by_name(username, owner_account_id, options = {}) {
        const user_path = this.get_user_path_by_name(username, owner_account_id);
        const user = await this.get_identity_config_data(user_path, { ...options, silent_if_missing: true });
        return user;
    }

    /**
     * list_accounts returns the account names array - 
     * 1. get new accounts names
     * 2. check old accounts/ dir exists
     * 3. if old accounts dir exists return the union of new accounts and old accounts names array
     * 4. else return new account names array
     * and add accounts from old accounts/ directory if exists
     * during upgrade - list accounts is a very expensive operation as it's iterating old accounts and adds the entries that still do not appear in the new accounts folder
     * @returns {Promise<string[]>} 
     */
    async list_accounts() {
        const new_entries = await nb_native().fs.readdir(this.fs_context, this.accounts_by_name_dir_path);
        const new_accounts_names = this._get_config_entries_names(new_entries, SYMLINK_SUFFIX);
        const old_accounts_names = await this.list_old_accounts();
        return this.unify_old_and_new_accounts(new_accounts_names, old_accounts_names);
    }

    /**
     * list_users_under_account returns the users names array - 
     * under /users directory in the account
     * in case the /users dir does not exist it will return an empty array
     * @param {string} owner_account_id
     * @returns {Promise<string[]>} 
     */
    async list_users_under_account(owner_account_id) {
        const users_dir_path = this.get_users_dir_path_by_id(owner_account_id);
        const is_users_dir_exists = await this.validate_config_dir_exists(users_dir_path);
        if (!is_users_dir_exists) return [];
        const entries = await nb_native().fs.readdir(this.fs_context, users_dir_path);
        const usernames = this._get_config_entries_names(entries, SYMLINK_SUFFIX);
        return usernames;
    }

    /**
     * unify_old_and_new_accounts list the old accounts directory and add them to a set of the accounts
     * this will create a union of accounts and old accounts under accounts/ directory.
     * @returns {Promise<string[] | undefined>} 
     */
    async unify_old_and_new_accounts(new_entries, old_entries) {
        if (!old_entries?.length) return new_entries;
        const set = new Set([...new_entries, ...old_entries]);
        return Array.from(set);
    }

    /**
     * list_old_accounts lists the old accounts under accounts/ directory and return their names.
     * @returns {Promise<string[]>} 
     */
    async list_old_accounts() {
        const old_accounts_dir_exists = await native_fs_utils.is_path_exists(this.fs_context, this.old_accounts_dir_path);
        if (!old_accounts_dir_exists) return [];

        const old_entries = await nb_native().fs.readdir(this.fs_context, this.old_accounts_dir_path);
        if (old_entries.length === 0) return [];

        return this._get_config_entries_names(old_entries, JSON_SUFFIX);
    }

    /**
     * create_account_config_file creates account config file
     * 1. create /identities/account_id/ directory
     * 2. create /identities/account_id/identity.json file
     * 3. create symlink:
     *    - account case: symlink /accounts_by_name/account_name -> /identities/account_id/identity.json
     *    - user case: symlink /identities/<account_id>/users/<user-name>  -> /identities/<user_id>/identity.json
     * 4. symlink new access keys if account_data.access_keys is an array that contains at least 1 item -
     *      link each item in account_data.access_keys to the relative path of the newly created config file
     * @param {Object} account_data
     * @returns {Promise<Object>} 
     */
    async create_account_config_file(account_data) {
        await this._throw_if_config_dir_locked();
        const { _id, name, owner = undefined } = account_data;
        const { parsed_account_data, string_account_data } = await this._prepare_for_account_schema(account_data);
        const account_path = this.get_identity_path_by_id(_id);
        const account_dir_path = this.get_identity_dir_path_by_id(_id);

        await native_fs_utils._create_path(account_dir_path, this.fs_context, config.BASE_MODE_CONFIG_DIR);
        await native_fs_utils.create_config_file(this.fs_context, account_dir_path, account_path, string_account_data);
        await this.link_account_name_index(_id, name, owner);
        await this.link_access_keys_index(_id, account_data.access_keys);
        return parsed_account_data;
    }

    /**
     * create_users_dir_if_missing create /identities/<account_id>/users if does not exist
     * @param {string} id
     * @returns {Promise<void>} 
     */
    async create_users_dir_if_missing(id) {
        const dir_path = this.get_users_dir_path_by_id(id);
        await this.create_dir_if_missing(dir_path);
    }

    /**
     * update_account_config_file updates account config file
     * if old_access_keys is an array that contains at least 1 item -
     * unlink old access_keys and link new access_keys
     * 1. update /identities/account_id/identity.json
     * 2. if name updated -
     *    link /accounts_by_name/new_account_name -> /identities/account_id/identity.json
     *    unlink /accounts_by_name/old_account_name
     * 3. if access key was updated -
     *    for all new_access_keys - link /access_keys/new_access_key -> /identities/account_id/identity.json
     *    for all old_access_keys - unlink /access_keys/old_access_key
     * @param {Object} account_new_data
     * @param {{old_name?: string, new_access_keys_to_link?: Object[], access_keys_to_delete?: { access_key: string }[]}} [options]
     * @returns {Promise<Object>}
     */
    async update_account_config_file(account_new_data, options = {}) {
        await this._throw_if_config_dir_locked();
        const { _id, name, owner = undefined } = account_new_data;
        const { parsed_account_data, string_account_data} = await this._prepare_for_account_schema(account_new_data);
        const account_path = this.get_identity_path_by_id(_id);
        const account_dir_path = this.get_identity_dir_path_by_id(_id);
        await native_fs_utils.update_config_file(this.fs_context, account_dir_path, account_path, string_account_data);

        if (options.old_name) {
            await this.link_account_name_index(_id, name, owner);
            await this.unlink_account_name_index(options.old_name, account_path, owner);
        }
        await this.link_access_keys_index(_id, options.new_access_keys_to_link);
        await this.unlink_access_keys_indexes(options.access_keys_to_delete, account_path);
        return parsed_account_data;
    }

    /**
     * delete_account_config_file deletes account config file
     * 1. unlink /access_keys/access_key if access_keys_to_delete is an array that contains at least 1 item -
     *    unlink all item in access_keys_to_delete
     * 2. unlink /root_accounts/account_name
     * 3. delete /identities/account_id/identity.json
     * 4. delete /identities/account_id/ folder
     * @param {Object} data
     * @returns {Promise<void>}
     */
    async delete_account_config_file(data) {
        await this._throw_if_config_dir_locked();
        const { _id, name, owner, access_keys = [] } = data;
        const account_id_config_path = this.get_identity_path_by_id(_id);
        const account_dir_path = this.get_identity_dir_path_by_id(_id);

        await this.unlink_access_keys_indexes(access_keys, account_id_config_path);
        await this.unlink_account_name_index(name, account_id_config_path, owner);
        await native_fs_utils.delete_config_file(this.fs_context, account_dir_path, account_id_config_path);
        await native_fs_utils.folder_delete(account_dir_path, this.fs_context, undefined, true);
    }


    /**
     * _prepare_for_account_schema processes account data before writing it to the config dir and does the following -
     * 1. encrypts its access keys
     * 2. sets the used master key on the account
     * 3. removes undefined properties, unwrap sensitive_strings and creation_data to string
     * 4. validate the account_data against the account schema
     * 5. returns stringified data ready to be written to the config directory and parsed data to be printed to the user
     * @param {Object} account_data
     * @returns {Promise<{parsed_account_data: Object, string_account_data: string}>}
     */
    async _prepare_for_account_schema(account_data) {
        const encrypted_account = await nc_mkm.encrypt_access_keys(account_data);
        const string_account_data = JSON.stringify(encrypted_account);
        const parsed_account_data = JSON.parse(string_account_data);
        nsfs_schema_utils.validate_account_schema(parsed_account_data);
        return { parsed_account_data, string_account_data };
    }

    /////////////////////////////////////
    //////   ACCOUNT NAME INDEX    //////
    /////////////////////////////////////

    /**
     * link_account_name_index links the access key to the relative path of the account id config file
     * @param {string} account_id
     * @param {string} account_name
     * @param {string} [owner_account_id]
     * @returns {Promise<void>} 
     */
    async link_account_name_index(account_id, account_name, owner_account_id) {
        if (owner_account_id !== undefined) await this.create_users_dir_if_missing(owner_account_id);
        const account_name_path = this.get_account_or_user_path_by_name(account_name, owner_account_id);
        const account_id_relative_path = this.get_account_or_user_relative_path_by_id(account_id, owner_account_id);
        await nb_native().fs.symlink(this.fs_context, account_id_relative_path, account_name_path);
    }

    /**
     * unlink_account_name_index unlinks the access key from the config directory
     * 1. get the account name path
     * 2. check realpath on the account name path to make sure it belongs to the account id we meant to delete
     * 3. check if the account id path is the same as the account name path 
     * 4. unlink the account name path
     * 5. else, do nothing as the name path might already point to a new identity/deleted by concurrent calls 
     * @param {string} account_name
     * @param {string} account_id_config_path
     * @param {string} [owner_account_id]
     * @returns {Promise<void>} 
     */
    async unlink_account_name_index(account_name, account_id_config_path, owner_account_id) {
        const account_name_path = this.get_account_or_user_path_by_name(account_name, owner_account_id);
        const should_unlink = await this._is_symlink_pointing_to_identity(account_name_path, account_id_config_path);
        if (should_unlink) {
            try {
                await nb_native().fs.unlink(this.fs_context, account_name_path);
            } catch (err) {
                if (err.code === 'ENOENT') {
                    dbg.warn(`config_fs.unlink_account_name_index: account name already unlinked ${account_name} ${account_id_config_path}`);
                    return;
                }
                throw err;
            }
        }
    }

    //////////////////////////////////////
    //////   ACCESS KEYS INDEXES    //////
    //////////////////////////////////////

    /**
     * link_access_keys_index links the access keys symlinks
     * @param {Object[]} access_keys_to_link
     * @returns {Promise<void>} 
     */
    async link_access_keys_index(account_id, access_keys_to_link = []) {
        if (!access_keys_to_link?.length) return;
        const account_config_relative_path = this.get_account_relative_path_by_id(account_id);
        for (const access_keys of access_keys_to_link) {
            const new_access_key_path = this.get_account_or_user_path_by_access_key(access_keys.access_key);
            await nb_native().fs.symlink(this.fs_context, account_config_relative_path, new_access_key_path);
        }
    }

    /**
     * unlink_access_key_index unlinks the access key from the config directory
     * 1. get the account access_key path
     * 2. check realpath on the account access_key path to make sure it belongs to the account id (or account_name on versions older than 5.18) we meant to delete
     * 3. check if the account id path is the same as the account access_key path 
     * 4. unlink the account access_key path
     * 5. else, do nothing as the access_key path might already point to a new identity/deleted by concurrent calls 
     * @param {string} access_key
     * @returns {Promise<void>} 
     */
    async unlink_access_key_index(access_key, account_config_path) {
        const access_key_path = this.get_account_or_user_path_by_access_key(access_key);
        const should_unlink = await this._is_symlink_pointing_to_identity(access_key_path, account_config_path);
        if (should_unlink) {
            try {
                await nb_native().fs.unlink(this.fs_context, access_key_path);
            } catch (err) {
                if (err.code === 'ENOENT') {
                    dbg.warn(`config_fs.unlink_access_key_index: account access_key already unlinked ${access_key} ${account_config_path}`);
                    return;
                }
                throw err;
            }
        }
    }

    /**
     * unlink_access_keys_index unlinks the access keys from the config directory
     *  iterate access_keys_to_delete array and for each call unlink_access_key_index()
     * @param {Object[]} access_keys_to_delete
     * @param {String} account_id_config_path
     * @returns {Promise<void>} 
     */
    async unlink_access_keys_indexes(access_keys_to_delete, account_id_config_path) {
        if (!access_keys_to_delete?.length) return;
        for (const access_keys of access_keys_to_delete) {
            await this.unlink_access_key_index(access_keys.access_key, account_id_config_path);
        }
    }

    /**
     * _is_symlink_pointing_to_identity checks if the index symlink (name/access_key)
     * is pointing to the identity file path
     * @param {string} symlink_path 
     * @param {string} identity_path 
     * @returns {Promise<Boolean>}
     */
    async _is_symlink_pointing_to_identity(symlink_path, identity_path) {
        const full_path = await nb_native().fs.realpath(this.fs_context, symlink_path);
        return (full_path === identity_path ||
            (os_utils.IS_MAC && full_path === path.join('/private/', identity_path)));
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
     * stat_bucket_config_file will return the stat output on bucket config file
     * please notice that stat might throw an error - you should wrap it with try-catch and handle the error
     * @param {string} bucket_name
     * @returns {Promise<nb.NativeFSStats>}
     */
    stat_bucket_config_file(bucket_name) {
        const bucket_config_path = this.get_bucket_path_by_name(bucket_name);
        return nb_native().fs.stat(this.fs_context, bucket_config_path);
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
        this.adjust_bucket_with_schema_updates(bucket);
        return bucket;
    }

    /**
     * list_buckets returns the array of buckets that exists under the config dir
     * @returns {Promise<string[]>} 
     */
    async list_buckets() {
        const bucket_entries = await nb_native().fs.readdir(this.fs_context, this.buckets_dir_path);
        const bucket_names = this._get_config_entries_names(bucket_entries, JSON_SUFFIX);
        return bucket_names;
    }

    /**
     * create_bucket_config_file creates bucket config file
     * @param {Object} bucket_data
     * @returns {Promise<String>} 
     */
    async create_bucket_config_file(bucket_data) {
        await this._throw_if_config_dir_locked();
        const { parsed_bucket_data, string_bucket_data } = this._prepare_for_bucket_schema(bucket_data);
        const bucket_path = this.get_bucket_path_by_name(bucket_data.name);
        await native_fs_utils.create_config_file(this.fs_context, this.buckets_dir_path, bucket_path, string_bucket_data);
        return parsed_bucket_data;
    }

    /**
     * _prepare_for_bucket_schema processes bucket data before writing it to the config dir and does the following -
     * 1. removes undefined properties, unwrap sensitive_strings and creation_data to string
     * 2. validate the bucket_data against the bucket schema
     * 3. returns stringified data ready to be written to the config directory and parsed data for printing to the user
     * @param {Object} bucket_data
     * @returns {{parsed_bucket_data: Object, string_bucket_data: string}}
     */
    _prepare_for_bucket_schema(bucket_data) {
        const bucket_data_api_props_omitted = _.omitBy(bucket_data, _.isUndefined);
        const string_bucket_data = JSON.stringify(bucket_data_api_props_omitted);
        const parsed_bucket_data = JSON.parse(string_bucket_data);
        nsfs_schema_utils.validate_bucket_schema(parsed_bucket_data);
        return { parsed_bucket_data, string_bucket_data };
    }

    /**
     * update_bucket_config_file updates bucket config file
     * @param {Object} bucket_data
     * @returns {Promise<String>} 
     */
    async update_bucket_config_file(bucket_data) {
        await this._throw_if_config_dir_locked();
        const { parsed_bucket_data, string_bucket_data } = this._prepare_for_bucket_schema(bucket_data);
        const bucket_config_path = this.get_bucket_path_by_name(bucket_data.name);
        await native_fs_utils.update_config_file(this.fs_context, this.buckets_dir_path, bucket_config_path, string_bucket_data);
        return parsed_bucket_data;
    }

    /**
     * delete_bucket_config_file deletes bucket config file
     * @param {string} bucket_name
     * @returns {Promise<void>} 
     */
    async delete_bucket_config_file(bucket_name) {
        await this._throw_if_config_dir_locked();
        const bucket_config_path = this.get_bucket_path_by_name(bucket_name);
        await native_fs_utils.delete_config_file(this.fs_context, this.buckets_dir_path, bucket_config_path);
    }

    ////////////////////////
    ///     SYSTEM      ////
    ////////////////////////

    /**
     * get_system_config_file read system.json file
     * @param {{silent_if_missing?: boolean}} [options]
     * @returns {Promise<Object>}
     */
    async get_system_config_file(options = {}) {
        const system_data = await this.get_config_data(this.system_json_path, options);
        return system_data;
    }

    /**
     * create_system_config_file creates a new system.json file
     * @returns {Promise<Void>}
     */
    async create_system_config_file(system_data) {
        await native_fs_utils.create_config_file(this.fs_context, this.config_root, this.system_json_path, system_data);
    }

    /**
     * update_system_config_file updates system.json file
     * @returns {Promise<Void>}
     */
    async update_system_config_file(system_data) {
        await native_fs_utils.update_config_file(this.fs_context, this.config_root, this.system_json_path, system_data);
    }

    /**
     * @param {Object} new_system_data
     * @returns {Promise<Void>}
     */
    async update_system_json_with_retries(new_system_data, { max_retries = 3, delay = 1000 } = {}) {
        let retries = 0;
        let changes_updated = false;
        while (!changes_updated) {
            try {
                await this.update_system_config_file(new_system_data);
                changes_updated = true;
            } catch (err) {
                if (retries === max_retries) {
                    const message = `update_system_json_with_retries failed. aborting after ${max_retries} retries. 
                    new_system_data=${util.inspect(new_system_data, { depth: 5 })} error= ${err}`;
                    dbg.error(message);
                    throw new Error(message);
                }
                dbg.warn(`update_system_json_with_retries failed. will retry in ${delay / 1000} seconds. changes=`,
                    util.inspect(new_system_data, { depth: 5 }),
                    'error=', err);
                retries += 1;
                await P.delay(delay);
            }
        }
    }

    /**
     * register_hostname_in_system_json creates/updates system.json file
     * if system.json does not exist (a new system) - host and config dir data will be set on the newly created file
     * else -
     *  1. if the host data already exist in system.json - return
     *  2. update the host data on system.json
     * Note - config directory data on upgraded systems will be set by nc_upgrade_manager
     * @returns {Promise<Object>}
     */
    async register_hostname_in_system_json() {
        const system_data = await this.get_system_config_file({silent_if_missing: true});

        let updated_system_json = system_data || {};
        const is_new_system = !system_data;
        const hostname = os.hostname();
        try {
            if (is_new_system) {
                updated_system_json = this._get_new_system_json_data();
                await this.create_system_config_file(JSON.stringify(updated_system_json));
                dbg.log0('created NC system data with version: ', pkg.version);
                return updated_system_json;
            } else {
                if (updated_system_json[hostname]?.current_version) return;
                const new_host_data = this._get_new_hostname_data();
                updated_system_json = { ...updated_system_json, ...new_host_data };
                await this.update_system_config_file(JSON.stringify(updated_system_json));
                dbg.log0('updated NC system data with version: ', pkg.version);
                return updated_system_json;
            }
        } catch (err) {
            const msg = 'failed to create/update NC system data due to - ' + err.message;
            const error = new Error(msg);
            dbg.error(msg, err);
            throw error;
        }
    }

    ////////////////////////
    ///     HELPERS     ////
    ////////////////////////

    /**
     * adjust_bucket_with_schema_updates changes the bucket properties according to the schema
     * @param {object} bucket
     */
    adjust_bucket_with_schema_updates(bucket) {
        if (!bucket) return;
        // system_owner is deprecated since version 5.18
        if (bucket.system_owner !== undefined) {
            delete bucket.system_owner;
        }
        // bucket_owner is deprecated since version 5.18
        if (bucket.bucket_owner !== undefined) {
            delete bucket.bucket_owner;
        }
    }

    /**
    * @param {Dirent} entry
    * @param {string} suffix
    * @returns {boolean}
    */
    _has_config_file_name_format(entry, suffix) {
        return entry.name.endsWith(suffix) &&
            !entry.name.includes(config.NSFS_TEMP_CONF_DIR_NAME) &&
            !native_fs_utils.isDirectory(entry);
    }

    /**
    * _get_config_entry_name returns config file entry name if it adheres a config file name format, 
    * else returns undefined
    * @param {Dirent} entry
    * @param {string} suffix
    * @returns {string | undefined}
    */
    _get_config_entry_name(entry, suffix) {
        return (this._has_config_file_name_format(entry, suffix)) ?
            path.parse(entry.name).name :
            undefined;
    }

    /**
    * _get_config_entries_names returns config file names array 
    * @param {Dirent[]} entries
    * @param {string} suffix
    * @returns {string[]}
    */
    _get_config_entries_names(entries, suffix) {
        const config_file_names = [];
        for (const entry of entries) {
            if (this._has_config_file_name_format(entry, suffix)) {
                config_file_names.push(path.parse(entry.name).name);
            }
        }
        return config_file_names;
    }

    /**
     * _throw_if_config_dir_locked validates that
     * config dir schema version on system.json matches the config_dir_version on package.json
     * throws an error if they do not match.
     * @returns {Promise<void>}
     */
    async _throw_if_config_dir_locked() {
        const system_data = await this.get_system_config_file({ silent_if_missing: true });
        // if system was never created, currently we allow using the CLI without creating system
        // we should consider changing it to throw on this scenario as well
        // https://github.com/noobaa/noobaa-core/issues/8468
        if (!system_data) return;
        if (!system_data.config_directory) {
            throw new RpcError('CONFIG_DIR_VERSION_MISMATCH', `config_directory data is missing in system.json, any updates to the config directory are blocked until the config dir upgrade`);
        }
        const running_code_config_dir_version = this.config_dir_version;
        const system_config_dir_version = system_data.config_directory.config_dir_version;
        const ver_comparison_err = this.compare_host_and_config_dir_version(running_code_config_dir_version, system_config_dir_version);
        if (ver_comparison_err !== undefined) {
            throw new RpcError('CONFIG_DIR_VERSION_MISMATCH', ver_comparison_err);
        }
    }

    /**
     * compare_host_and_config_dir_version compares the version of the config dir in the system.json file 
     * with the config dir version of the running host
     * if compare result is 0 - undefined will be returned
     * else - an appropriate error string will be returned
     * @param {String} running_code_config_dir_version 
     * @param {String} system_config_dir_version 
     * @returns {String | Undefined}
     */
    compare_host_and_config_dir_version(running_code_config_dir_version, system_config_dir_version) {
        const ver_comparison = version_compare(running_code_config_dir_version, system_config_dir_version);
        dbg.log0(`config_fs.compare_host_and_config_dir_version: ver_comparison ${ver_comparison} running_code_config_dir_version ${running_code_config_dir_version} system_config_dir_version ${system_config_dir_version}`);
        if (ver_comparison > 0) {
            return `running code config_dir_version=${running_code_config_dir_version} is higher than the config dir version ` +
                `mentioned in system.json=${system_config_dir_version}, any updates to the config directory are blocked until the config dir upgrade`;
        }
        if (ver_comparison < 0) {
            return `running code config_dir_version=${running_code_config_dir_version} is lower than the config dir version ` +
                `mentioned in system.json=${system_config_dir_version}, any updates to the config directory are blocked until the source code upgrade`;
        }
        return undefined;
    }

    /**
     * _get_new_hostname_data returns new hostanme data for system.json
     * @returns {Object}
     */
    _get_new_hostname_data() {
        return {
            [os.hostname()]: {
                current_version: pkg.version,
                config_dir_version: this.config_dir_version,
                upgrade_history: {
                    successful_upgrades: []
                },
            },
        };
    }

    /**
     * _get_new_system_json_data returns new system.json data
     * @returns {Object}
     */
    _get_new_system_json_data() {
        return {
            ...this._get_new_hostname_data(),
            config_directory: {
                config_dir_version: this.config_dir_version,
                upgrade_package_version: pkg.version,
                phase: CONFIG_DIR_PHASES.CONFIG_DIR_UNLOCKED,
                upgrade_history: {
                    successful_upgrades: [],
                    last_failure: undefined
                }
            }
        };
    }

    /**
     * get_hosts_data recieves system_data and returns only the hosts data
     * @param {Object} system_data 
     * @returns {Object}
     */
    get_hosts_data(system_data) {
        return _.omit(system_data, 'config_directory');
    }
}

// EXPORTS
exports.SYMLINK_SUFFIX = SYMLINK_SUFFIX;
exports.JSON_SUFFIX = JSON_SUFFIX;
exports.CONFIG_SUBDIRS = CONFIG_SUBDIRS;
exports.CONFIG_TYPES = CONFIG_TYPES;
exports.CONFIG_DIR_PHASES = CONFIG_DIR_PHASES;
exports.ConfigFS = ConfigFS;
