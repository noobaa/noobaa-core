/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const p = require('path');
const _ = require('lodash');
const mocha = require('mocha');
const child_process = require('child_process');
const argv = require('minimist')(process.argv);
const SensitiveString = require('../../util/sensitive_string');
const { exec_manage_cli, TMP_PATH } = require('../system_tests/test_utils');
const { TYPES, ACTIONS } = require('../../manage_nsfs/manage_nsfs_constants');

// keep me first - this is setting envs that should be set before other modules are required.
const NC_CORETEST = 'nc_coretest';
const config_dir_name = 'nc_coretest_config_root_path';
const master_key_location = `${TMP_PATH}/${config_dir_name}/master_keys.json`;
const NC_CORETEST_CONFIG_DIR_PATH = `${TMP_PATH}/${config_dir_name}`;
process.env.DEBUG_MODE = 'true';
process.env.ACCOUNTS_CACHE_EXPIRY = '1';
process.env.NC_CORETEST = 'true';

require('../../util/dotenv').load();
require('../../util/panic');
require('../../util/fips');

const config = require('../../../config.js');
config.test_mode = true;
config.NC_MASTER_KEYS_FILE_LOCATION = master_key_location;
const new_umask = process.env.NOOBAA_ENDPOINT_UMASK || 0o000;
const old_umask = process.umask(new_umask);
console.log('test_nsfs_access: replacing old umask: ', old_umask.toString(8), 'with new umask: ', new_umask.toString(8));

const dbg = require('../../util/debug_module')(__filename);
const dbg_level =
    (process.env.SUPPRESS_LOGS && -5) ||
    (argv.verbose && 5) ||
    0;
dbg.set_module_level(dbg_level, 'core');

const P = require('../../util/promise');
let _setup = false;

const SYSTEM = NC_CORETEST;
const EMAIL = NC_CORETEST;
const PASSWORD = NC_CORETEST;
const http_port = 6001;
const https_port = 6443;
const http_address = `http://localhost:${http_port}`;
const https_address = `https://localhost:${https_port}`;

const FIRST_BUCKET = 'first.bucket';
const NC_CORETEST_REDIRECT_FILE_PATH = p.join(config.NSFS_NC_DEFAULT_CONF_DIR, '/config_dir_redirect');
const NC_CORETEST_STORAGE_PATH = p.join(TMP_PATH, '/nc_coretest_storage_root_path/');
const FIRST_BUCKET_PATH = p.join(NC_CORETEST_STORAGE_PATH, FIRST_BUCKET, '/');
const CONFIG_FILE_PATH = p.join(NC_CORETEST_CONFIG_DIR_PATH, 'config.json');

const nsrs_to_root_paths = {};
let nsfs_process;

/**
 * setup will setup nc coretest
 * @param {object} options
 */
function setup(options = {}) {
    if (_setup) return;
    _setup = true;

    mocha.before('nc-coretest-before', async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        const start = Date.now();
        await announce('nc-coretest-before');

        await config_dir_setup();
        await admin_account_creation();
        await first_bucket_creation();

        await announce('start nsfs script');
        const logStream = fs.createWriteStream('src/logfile.txt', { flags: 'a' });

        nsfs_process = child_process.spawn('node', ['src/cmd/nsfs.js'], {
            detached: true
        });
        nsfs_process.stdout.pipe(logStream);
        nsfs_process.stderr.pipe(logStream);


        nsfs_process.on('exit', (code, signal) => {
            dbg.error(`nsfs.js exited code=${code}, signal=${signal}`);
            logStream.end();
        });

        nsfs_process.on('error', err => {
            dbg.error(`nsfs.js exited with error`, err);
            logStream.end();
        });

        // TODO - run health
        await announce(`nc coretest ready... (took ${((Date.now() - start) / 1000).toFixed(1)} sec)`);
    });


    mocha.after('nc-coretest-after', async function() {
        this.timeout(60000); // eslint-disable-line no-invalid-this
        try {
            await announce('stop nsfs script');
            if (nsfs_process) nsfs_process.kill('SIGKILL');
            await config_dir_teardown();
            await announce('nc coretest done ...');
        } catch (err) {
            dbg.error('got error on mocha.after', err);
        }
    });
}

/**
 * announce will pretty print msg
 * @param {string} msg
 * @returns {Promise<void>}
 */
async function announce(msg) {
    if (process.env.SUPPRESS_LOGS) return;
    const l = Math.max(80, msg.length + 4);
    console.log('='.repeat(l));
    console.log('=' + ' '.repeat(l - 2) + '=');
    console.log('= ' + msg + ' '.repeat(l - msg.length - 3) + '=');
    console.log('=' + ' '.repeat(l - 2) + '=');
    console.log('='.repeat(l));
    await P.delay(500);
}

/**
 * config_dir_setup creates the config dir, storage dirs and other config files
 * @returns {Promise<void>}
 */
async function config_dir_setup() {
    await announce('config_dir_setup');
    await fs.promises.mkdir(NC_CORETEST_STORAGE_PATH, { recursive: true });
    await fs.promises.mkdir(config.NSFS_NC_DEFAULT_CONF_DIR, { recursive: true });
    await fs.promises.mkdir(NC_CORETEST_CONFIG_DIR_PATH, { recursive: true });
    await fs.promises.writeFile(NC_CORETEST_REDIRECT_FILE_PATH, NC_CORETEST_CONFIG_DIR_PATH);
    await fs.promises.writeFile(CONFIG_FILE_PATH, JSON.stringify({
        ALLOW_HTTP: true,
        OBJECT_SDK_BUCKET_CACHE_EXPIRY_MS: 1,
        NC_RELOAD_CONFIG_INTERVAL: 1,
        // DO NOT CHANGE - setting VACCUM_ANALYZER_INTERVAL=1 needed for failing the tests
        // in case where vaccumAnalyzer is being called before setting process.env.NC_NSFS_NO_DB_ENV = 'true' on nsfs.js
        VACCUM_ANALYZER_INTERVAL: 1
    }));
    await fs.promises.mkdir(FIRST_BUCKET_PATH, { recursive: true });

}

/**
 * config_dir_teardown removes the config dir, storage dirs and other config files
 * @returns {Promise<void>}
 */
async function config_dir_teardown() {
    await announce('config_dir_teardown');
    await fs.promises.rm(NC_CORETEST_STORAGE_PATH, { recursive: true });
    await fs.promises.rm(NC_CORETEST_REDIRECT_FILE_PATH);
    await fs.promises.rm(NC_CORETEST_CONFIG_DIR_PATH, { recursive: true, force: true });
}

/**
 * admin_account_creation creates admin account
 * @returns {Promise<void>}
 */
async function admin_account_creation() {
    await announce('admin_account_creation');
    const cli_account_options = get_admin_mock_account_details();
    await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, cli_account_options);
}

/**
 * first_bucket_creation creates first.bucket
 * @returns {Promise<void>}
 */
async function first_bucket_creation() {
    await announce('first_bucket_creation');
    const cli_bucket_options = {
        name: FIRST_BUCKET,
        owner: NC_CORETEST,
        path: FIRST_BUCKET_PATH,
    };
    await exec_manage_cli(TYPES.BUCKET, ACTIONS.ADD, cli_bucket_options);
}

/**
 * log prints args if process.env.SUPPRESS_LOGS=false
 * @param {object} args
 */
function log(...args) {
    if (process.env.SUPPRESS_LOGS) return;
    console.log(...args);
}

/**
 * get_dbg_level return nc coretest dbg_level variable
 */
function get_dbg_level() {
    return dbg_level;
}

/**
 * get_http_address return nc coretest http_address variable
 */
function get_http_address() {
    return http_address;
}

/**
 * get_https_address return nc coretest https_address variable
 */
function get_https_address() {
    return https_address;
}

///////////////////////////////////
///////// HELPER FUNCTIONS ////////
///////////////////////////////////

/**
 * get_name_by_email returns name by email
 * rpc account calls identified by email
 * manage_nsfs account commands identified by name  
 */
const get_name_by_email = email => {
    const name = email === NC_CORETEST ? NC_CORETEST : email.slice(0, email.indexOf('@'));
    return name;
};

/**
 * get_admin_mock_account_details returns the account details that we use in NC core tests
 */
function get_admin_mock_account_details() {
    const cli_account_options = {
        name: NC_CORETEST,
        new_buckets_path: NC_CORETEST_STORAGE_PATH,
        uid: 200,
        gid: 200
    };
    return cli_account_options;
}

////////////////////////////////////
//////// ACCOUNT MANAGE CMDS ///////
////////////////////////////////////

/**
 * create_account_manage creates account using manage_nsfs and returns rpc-like result
 * @param {object} options
 * @return {Promise<object>}
 */
async function create_account_manage(options) {
    const cli_options = {
        name: options.name,
        new_buckets_path: options.nsfs_account_config.new_buckets_path,
        distinguished_name: options.nsfs_account_config.distinguished_name,
        uid: options.nsfs_account_config.uid,
        gid: options.nsfs_account_config.gid,
        access_key: options.access_key,
        secret_key: options.secret_key
    };
    const res = await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, cli_options);
    const json_account = JSON.parse(res);
    const account = json_account.response.reply;
    account.access_keys[0] = {
        access_key: new SensitiveString(account.access_keys[0].access_key),
        secret_key: new SensitiveString(account.access_keys[0].secret_key)
    };
    return account;
}


/**
 * read_bucket_manage reads a bucket using manage_nsfs and returns rpc-like result
 * @param {object} options
 * @return {Promise<object>}
 */
async function read_bucket_manage(options) {
    const res = await exec_manage_cli(TYPES.BUCKET, ACTIONS.STATUS, options);
    const json_bucket = JSON.parse(res);
    const bucket = json_bucket.response.reply;
    bucket.owner_account = {
        email: bucket.bucket_owner,
        id: bucket.owner_account
    };
    return bucket;
}

/**
 * read_account_manage reads an account using manage_nsfs and returns rpc-like result
 * @param {object} options
 * @return {Promise<object>}
 */
async function read_account_manage(options) {
    const cli_options = { name: get_name_by_email(options.email), show_secrets: true };
    const res = await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.STATUS, cli_options);
    const json_account = JSON.parse(res);
    const account = json_account.response.reply;
    account.access_keys[0] = {
        access_key: new SensitiveString(account.access_keys[0].access_key),
        secret_key: new SensitiveString(account.access_keys[0].secret_key)
    };
    return account;
}

/**
 * delete_account_manage deletes an account using manage_nsfs
 * @param {object} options
 * @returns {Promise<void>}
 */
async function delete_account_manage(options) {
    const cli_options = { name: get_name_by_email(options.email) };
    await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.DELETE, cli_options);
}

/**
 * delete_account_by_property_manage lists accounts by property and deletes the result list using manage_nsfs
 * @param {object} params
 * @param {object} params.nsfs_account_config
 * @returns {Promise<void>}
 */
async function delete_account_by_property_manage({ nsfs_account_config }) {
    const list = await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.LIST, nsfs_account_config);
    const accounts = JSON.parse(list).response.reply;
    for (const account of accounts) {
        const cli_options = { name: account.name };
        await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.DELETE, cli_options);
    }
}

/**
 * list_accounts_manage lists accounts using manage_nsfs and returns rpc-like result
 * @param {object} options
 * @return {Promise<object>}
 */
async function list_accounts_manage(options) {
    const list = await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.LIST, options);
    return { accounts: JSON.parse(list).response.reply };
}

/**
 * update_account_s3_access_manage updates an account using manage_nsfs
 * @param {object} options
 * @returns {Promise<void>}
 */
async function update_account_s3_access_manage(options) {
    const cli_options = {
        name: get_name_by_email(options.email),
        new_buckets_path: options.nsfs_account_config.new_buckets_path,
        distinguished_name: options.nsfs_account_config.distinguished_name,
        uid: options.nsfs_account_config.uid,
        gid: options.nsfs_account_config.gid,
    };
    await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.UPDATE, cli_options);
}

////////////////////////////////////
///// NAMESPACE RESOURCE MOCKS /////
////////////////////////////////////

/**
 * read_namespace_resource_mock reads namespace_resource properties and returns rpc-like result
 * @param {object} options
 * @return {object}
 * @throws {Error} throws if namespace resource not found
 */
function read_namespace_resource_mock(options) {
    if (!nsrs_to_root_paths[options.name]) {
        const err = new Error('Could not found namespace resource');
        err.rpc_code = 'NO_SUCH_NAMESPACE_RESOURCE';
        throw err;
    }
    return { name: options.name, fs_root_path: nsrs_to_root_paths[options.name] };
}

/**
 * create_namespace_resource_mock sets namespace_resource properties
 * @param {object} options
 */
function create_namespace_resource_mock(options) {
    nsrs_to_root_paths[options.name] = options.nsfs_config && options.nsfs_config.fs_root_path;
}

////////////////////////////////////
//////// BUCKET MANAGE CMDS ////////
////////////////////////////////////

/**
 * create_bucket_manage creates a bucket using manage_nsfs
 * TODO: return create result when needed
 * @param {object} options
 * @returns {Promise<void>}
 */
async function create_bucket_manage(options) {
    const { resource, path } = options.namespace.write_resource;
    const bucket_storage_path = p.join(nsrs_to_root_paths[resource], path);
    const cli_options = { name: options.name, owner: options.owner || NC_CORETEST, path: bucket_storage_path};
    await exec_manage_cli(TYPES.BUCKET, ACTIONS.ADD, cli_options);
}

/**
 * update_bucket_manage updates a bucket using manage_nsfs
 * TODO: return update result when needed
 * @param {object} options
 * @returns {Promise<void>}
 */
async function update_bucket_manage(options) {
    const { resource, path } = options.namespace.write_resource;
    const bucket_storage_path = p.join(nsrs_to_root_paths[resource], path);
    const cli_options = { name: options.name, path: bucket_storage_path };
    await exec_manage_cli(TYPES.BUCKET, ACTIONS.UPDATE, cli_options);
}

/**
 * put_bucket_policy_manage updates the bucket policy of a bucket using manage_nsfs
 * @param {object} options
 * @returns {Promise<void>}
 */
async function put_bucket_policy_manage(options) {
    const cli_options = { name: options.name, bucket_policy: options.policy };
    await exec_manage_cli(TYPES.BUCKET, ACTIONS.UPDATE, cli_options);
}

/**
 * delete_bucket_manage deletes a bucket bucket using manage_nsfs
 * @param {object} options
 * @returns {Promise<void>}
 */
async function delete_bucket_manage(options) {
    const cli_options = { name: options.name, force: true };
    await exec_manage_cli(TYPES.BUCKET, ACTIONS.DELETE, cli_options);
}

// rpc_cli_funcs_to_manage_nsfs_cli_cmds contains override functions for nc coretest
// containerized rpc calls mapped to managa_nsfs/mock functions
const rpc_cli_funcs_to_manage_nsfs_cli_cmds = {
    create_auth_token: () => _.noop,
    account: {
        create_account: async options => create_account_manage(options),
        read_account: async options => read_account_manage(options),
        delete_account: async options => delete_account_manage(options),
        delete_account_by_property: async options => delete_account_by_property_manage(options),
        list_accounts: async options => list_accounts_manage(options),
        update_account_s3_access: async options => update_account_s3_access_manage(options)
    },
    pool: {
        read_namespace_resource: options => read_namespace_resource_mock(options),
        create_namespace_resource: options => create_namespace_resource_mock(options),
    },
    bucket: {
        create_bucket: async options => create_bucket_manage(options),
        update_bucket: async options => update_bucket_manage(options),
        put_bucket_policy: async options => put_bucket_policy_manage(options),
        delete_bucket: async options => delete_bucket_manage(options),
        read_bucket: async options => read_bucket_manage(options),
    }
};

exports.setup = setup;
exports.no_setup = _.noop;
exports.log = log;
exports.SYSTEM = SYSTEM;
exports.EMAIL = EMAIL;
exports.PASSWORD = PASSWORD;
exports.get_dbg_level = get_dbg_level;
exports.rpc_client = rpc_cli_funcs_to_manage_nsfs_cli_cmds;
exports.get_http_address = get_http_address;
exports.get_https_address = get_https_address;
exports.get_admin_mock_account_details = get_admin_mock_account_details;
exports.NC_CORETEST_CONFIG_DIR_PATH = NC_CORETEST_CONFIG_DIR_PATH;
