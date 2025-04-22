/* Copyright (C) 2024 NooBaa */
'use strict';

const util = require('util');
const path = require('path');
const P = require('../../../util/promise');
const config = require('../../../../config');
const { ConfigFS } = require('../../../sdk/config_fs');
const native_fs_utils = require('../../../util/native_fs_utils');
const nb_native = require('../../../util/nb_native');

/**
* @typedef {{ 
    * account_name: String, 
    * _id: String, 
    * access_keys: Object[], 
    * account_old_path: String, 
    * identity_path: String, 
    * identity_dir_path: String, 
    * src_file: nb.NativeFile, 
    * account_old_path_stat: nb.NativeFSStats, 
    * gpfs_options?: { src_file: nb.NativeFile, dst_file: nb.NativeFile } 
* }} AccountUpgradeParams
*/

/**
 * run does the following config directory restructure - 
 * 1. creation of the identities/ directory
 * 2. creation of accounts_by_name/ directory
 * 3. Upgrade config files of all accounts under accounts/ (old directory) 
 * 4. delete accounts/ directory
 * @param {{dbg: *, from_version: String}} params 
 */
async function run({ dbg, from_version }) {
    try {
        const config_fs = new ConfigFS(config.NSFS_NC_CONF_DIR, config.NSFS_NC_CONFIG_DIR_BACKEND);

        await config_fs.create_dir_if_missing(config_fs.identities_dir_path);
        await config_fs.create_dir_if_missing(config_fs.accounts_by_name_dir_path);

        const old_account_names = await config_fs.list_old_accounts();
        const failed_accounts = await upgrade_accounts_config_files(config_fs, old_account_names, from_version, dbg);

        if (failed_accounts.length > 0) throw new Error('NC upgrade process failed, failed_accounts array length is bigger than 0' + util.inspect(failed_accounts));
        await move_old_accounts_dir(config_fs, old_account_names, from_version, dbg);
    } catch (err) {
        dbg.error('NC upgrade process failed due to - ', err);
        throw err;
    }
}

/**
 * upgrade_accounts_config_files list all old accounts and upgrade their config files by doing the following - 
 * 1. Iterate all accounts under accounts/ (old directory)
 * 2. upgrade account config file with 3 retries
 * @param {import('../../../sdk/config_fs').ConfigFS} config_fs 
 * @param {String[]} old_account_names 
 * @param {String} from_version 
 * @param {*} dbg 
 * @returns {Promise<Object[]>}
 */
async function upgrade_accounts_config_files(config_fs, old_account_names, from_version, dbg) {
    const failed_accounts = [];

    const backup_access_keys_path = path.join(config_fs.config_root, `.backup_access_keys_dir_${from_version}/`);
    await config_fs.create_dir_if_missing(backup_access_keys_path);

    for (const account_name of old_account_names) {
        let retries = 3;
        while (retries > 0) {
            try {
                await upgrade_account_config_file(config_fs, account_name, backup_access_keys_path, dbg);
                break;
            } catch (err) {
                retries -= 1;
                dbg.warn(`upgrade accounts config failed ${account_name}, err ${err} retries left ${retries}`);
                if (retries <= 0) {
                    failed_accounts.push({ account_name, err });
                    break;
                }
                await P.delay(20);
            }
        }
    }
    try {
        // delete dir only if it's empty
        await nb_native().fs.rmdir(config_fs.fs_context, backup_access_keys_path);
    } catch (err) {
        dbg.warn(`config_dir_restructure.upgrade_accounts_cofig_files could not delete access keys backup directory ${backup_access_keys_path} err ${err}`);
    }
    return failed_accounts;
}

/**
 * upgrade_account_config_file upgrade a single account 
 * 1.1. identity creation
 * 1.2. account name symlink creation
 * 1.3. account access key symlink update
 * @param {import('../../../sdk/config_fs').ConfigFS} config_fs 
 * @param {String} account_name 
 * @param {String} backup_access_keys_path
 * @param {*} dbg 
 * @returns 
 */
async function upgrade_account_config_file(config_fs, account_name, backup_access_keys_path, dbg) {
    let account_upgrade_params;
    const fs_context = config_fs.fs_context;
    try {
        account_upgrade_params = await prepare_account_upgrade_params(config_fs, account_name);
        await create_identity_if_missing(fs_context, account_upgrade_params, dbg);
        await create_account_name_index_if_missing(config_fs, account_upgrade_params, dbg);
        await create_account_access_keys_index_if_missing(config_fs, account_upgrade_params, backup_access_keys_path, dbg);
    } catch (err) {
        dbg.warn(`upgrade account config failed ${account_name}, err ${err}`);
        throw err;
    } finally {
        if (account_upgrade_params) {
            const files_to_close = [account_upgrade_params.src_file, account_upgrade_params.gpfs_options.dst_file];
            await native_fs_utils.finally_close_files(fs_context, files_to_close);
        }
    }
}

/**
 * prepare_account_upgrade_params is creating account upgrade params
 * @param {import('../../../sdk/config_fs').ConfigFS} config_fs 
 * @param {String} account_name 
 * @returns {Promise<AccountUpgradeParams>}
 */
async function prepare_account_upgrade_params(config_fs, account_name) {
    const { fs_context } = config_fs;
    const account_old_path = config_fs._get_old_account_path_by_name(account_name);
    const src_file = await native_fs_utils.open_file(fs_context, undefined, account_old_path, 'r');
    const account_old_path_stat = await src_file.stat(fs_context);

    const { _id, access_keys } = await config_fs.get_identity_config_data(account_old_path, { show_secrets: true });
    const identity_path = config_fs.get_identity_path_by_id(_id);
    const identity_dir_path = config_fs.get_identity_dir_path_by_id(_id);

    const is_gpfs = native_fs_utils._is_gpfs(fs_context);
    const dst_file = is_gpfs ? await native_fs_utils.open_file(fs_context, undefined, identity_path, 'w') : undefined;

    return {
        account_name,
        _id,
        access_keys,
        account_old_path,
        identity_path,
        identity_dir_path,
        src_file,
        account_old_path_stat,
        gpfs_options: { src_file, dst_file }
    };
}

/**
 * create_identity does the following - 
 * 1. create {config_dir}/identities/{account_id}/ directory - does not fail on EEXIST
 * 2. create a hard link from {config_dir}/accounts/{account_name}.json to {config_dir}/identities/{account_id}/identity.json
 *    2.1. if failed report
 * @param {nb.NativeFSContext} fs_context
 * @param {AccountUpgradeParams} account_upgrade_params
 * @param {*} dbg
 * @returns {Promise<Void>}
 */
async function create_identity_if_missing(fs_context, account_upgrade_params, dbg) {
    const { account_old_path, identity_path, identity_dir_path, account_old_path_stat, gpfs_options } = account_upgrade_params;
    try {
        await native_fs_utils._create_path(identity_dir_path, fs_context, config.BASE_MODE_CONFIG_DIR);
        await native_fs_utils.safe_link(fs_context, account_old_path, identity_path, account_old_path_stat, gpfs_options);
    } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        dbg.warn(`identity file was created on previous run of the upgrade script, skipping ${account_old_path}, ${identity_path}`);
    }
}

/**
 * create_account_name_index_if_missing creates name symlink to identity
 * @param {import('../../../sdk/config_fs').ConfigFS} config_fs 
 * @param {Object} account_upgrade_params 
 * @param {*} dbg 
 * @returns {Promise<Void>}
 */
async function create_account_name_index_if_missing(config_fs, account_upgrade_params, dbg) {
    const { account_name, _id, identity_path } = account_upgrade_params;
    try {
        const account_name_path = config_fs.get_account_path_by_name(account_name);
        const is_account_symlink_exists = await native_fs_utils.is_path_exists(config_fs.fs_context, account_name_path, true);
        const is_account_symlink_target_exists = await native_fs_utils.is_path_exists(config_fs.fs_context, account_name_path);
        const account_name_already_linked_to_identity = is_account_symlink_target_exists &&
            (await config_fs._is_symlink_pointing_to_identity(account_name_path, identity_path));
        if (!account_name_already_linked_to_identity) {
            // in case it was linked to a wrong location or the target does not exist, delete it
            if (is_account_symlink_exists) await native_fs_utils.unlink_ignore_enoent(config_fs.fs_context, account_name_path);
            await config_fs.link_account_name_index(_id, account_name);
        }
    } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        dbg.warn(`account name was already linked on a previous run of the upgrade script, skipping ${account_name}, ${_id}`);
    }
}

/**
 * create_account_access_keys_index_if_missing creates access keys symlink to the identity
 * 1. iterate all access keys array (there should be only one access_key)
 * 2. check if we already have an access_key symlink pointing to the identity, if there is, continue
 * 3. symlink tmp access_key path to the identity path
 * 4. rename tmp access_key path to access_key path - this will replace atomically the old symlink with the new one
 * @param {import('../../../sdk/config_fs').ConfigFS} config_fs 
 * @param {AccountUpgradeParams} account_upgrade_params 
 * @param {String} backup_access_keys_path
 * @param {*} dbg 
 * @returns {Promise<Void>}
 */
async function create_account_access_keys_index_if_missing(config_fs, account_upgrade_params, backup_access_keys_path, dbg) {
    const { fs_context } = config_fs;
    const { access_keys, _id, identity_path } = account_upgrade_params;

    if (access_keys) {
        for (const { access_key } of access_keys) {
            const access_key_path = config_fs.get_account_or_user_path_by_access_key(access_key);
            const tmp_access_key_path = path.join(backup_access_keys_path, config_fs.symlink(access_key));
            const account_config_relative_path = config_fs.get_account_relative_path_by_id(_id);

            try {
                const access_key_already_linked = await config_fs._is_symlink_pointing_to_identity(access_key_path, identity_path);
                if (access_key_already_linked) continue;
            } catch (err) {
                dbg.warn(`config_dir_restructure.create_account_access_keys_index_if_missing _is_symlink_pointing_to_identity failed ${access_key}`, err);
            }

            try {
                await nb_native().fs.symlink(fs_context, account_config_relative_path, tmp_access_key_path);
            } catch (err) {
                if (err.code !== 'EEXIST') throw err;
                dbg.warn(`account access key backup was already linked on a previous run of the upgrade script, continue ${access_keys}, ${tmp_access_key_path}`);
            }
            try {
                await nb_native().fs.rename(fs_context, tmp_access_key_path, access_key_path);
            } catch (err) {
                if (err.code !== 'EEXIST') throw err;
                dbg.warn(`account access key was already linked on a previous run of the upgrade script, skipping ${access_keys}, ${_id}`);
            }
        }
    }
}

/**
 * move_old_accounts_dir moves -
 * 1. creates a hidden directory
 * 2. iterates all old accounts to a hidden directory
 * 3. deletes the accounts/ directory
 * // TODO - consider removing the accounts in the future, currently we decide to not delete old accounts
 * @param {import('../../../sdk/config_fs').ConfigFS} config_fs 
 * @param {String[]} account_names 
 * @param {String} from_version 
 * @param {*} dbg 
 * @returns {Promise<Void>}
 */
async function move_old_accounts_dir(config_fs, account_names, from_version, dbg) {
    const fs_context = config_fs.fs_context;
    const old_account_tmp_dir_path = path.join(config_fs.old_accounts_dir_path, native_fs_utils.get_config_files_tmpdir());
    const hidden_old_accounts_path = path.join(config_fs.config_root, `.backup_accounts_dir_${from_version}/`);
    try {
        await nb_native().fs.mkdir(fs_context, hidden_old_accounts_path);
    } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        dbg.warn(`config_dir_restructure.move_old_accounts_dir backup dir for old accounts already exists ${hidden_old_accounts_path}, skipping`);
    }
    for (const account_name of account_names) {
        const old_account_path = path.join(config_fs.old_accounts_dir_path, config_fs.json(account_name));
        const hidden_old_account_path = path.join(hidden_old_accounts_path, config_fs.json(account_name));
        try {
            await native_fs_utils.unlink_ignore_enoent(fs_context, hidden_old_account_path);
            await nb_native().fs.link(fs_context, old_account_path, hidden_old_account_path);
            await native_fs_utils.unlink_ignore_enoent(fs_context, old_account_path);
        } catch (err) {
            if (err.code !== 'ENOENT') throw err;
            dbg.warn(`config_dir_restructure.move_old_accounts_dir old account file does not exist ${old_account_path}, skipping`);
        }
    }
    try {
        await native_fs_utils.folder_delete(old_account_tmp_dir_path, fs_context, true);
        await nb_native().fs.rmdir(fs_context, config_fs.old_accounts_dir_path);
    } catch (err) {
        if (err.code !== 'ENOENT') throw err;
        dbg.warn(`config_dir_restructure.move_old_accounts_dir old accounts dir does not exist ${old_account_tmp_dir_path}, skipping`);
    }
}

module.exports = {
    run,
    description: 'Config directory resturcture'
};

module.exports.move_old_accounts_dir = move_old_accounts_dir;
module.exports.create_identity_if_missing = create_identity_if_missing;
module.exports.upgrade_account_config_file = upgrade_account_config_file;
module.exports.prepare_account_upgrade_params = prepare_account_upgrade_params;
module.exports.create_account_name_index_if_missing = create_account_name_index_if_missing;
module.exports.create_account_access_keys_index_if_missing = create_account_access_keys_index_if_missing;
module.exports.upgrade_accounts_config_files = upgrade_accounts_config_files;
