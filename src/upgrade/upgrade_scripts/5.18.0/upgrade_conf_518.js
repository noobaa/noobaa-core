/* Copyright (C) 2024 NooBaa */
'use strict';

const minimist = require('minimist');
const {statSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, symlinkSync, rmSync} = require('fs');
const {join} = require('path');
const { CONFIG_SUBDIRS } = require('../../../manage_nsfs/manage_nsfs_constants');
const config = require('../../../../config');

const dbg = require('../../../util/debug_module')(__filename);

const account_id_to_name = new Map();

function validate_dir_exists(path, print_error) {
    if (!existsSync(path)) {
        if (print_error) {
            dbg.error("path ", path, " does not exist.");
        }
        return false;
    }
    const conf_path_stat = statSync(path);
    if (!conf_path_stat.isDirectory) {
        if (print_error) {
            dbg.error("path ", path, " is not a directory.");
        }
        return false;
    }
    return true;
}

function assert_dir_exists(path) {
    if (!validate_dir_exists(path, true)) {
        process.exit(1);
    }
}

function account_file_to_object(dir_ent) {
    if (!dir_ent.isFile()) {
        dbg.warn("Entry in account dir is not a file. dir_ent = ", dir_ent);
        return {account: undefined, error: 1};
    }
    const filename = join(dir_ent.parentPath, dir_ent.name);
    if (!filename.endsWith(".json")) {
        dbg.warn("File in accounts dir is not a json file. Filename = ", filename);
        return {account: undefined, error: 2};
    }

    const account_str = readFileSync(filename);
    const account = JSON.parse(account_str);

    if ((account.name + ".json") !== dir_ent.name) {
        dbg.error("Account name mismatch filename. Account name = ", account.name, ", filename = ", dir_ent.name);
        return {account: undefined, error: 3};
    }

    return {account, error: undefined};
}

function handle_account_file(dir_ent, conf_dir) {
    const { account, error} = account_file_to_object(dir_ent);
    if (error) {
        return error;
    }

    if (account.access_keys) {
        for (const access_key_obj of account.access_keys) {
            const access_key_symlink = join(conf_dir, CONFIG_SUBDIRS.ACCESS_KEYS, access_key_obj.access_key + ".symlink");
            if (!existsSync(access_key_symlink)) {
                dbg.error("Access key not found. Account name = ", account.name, ", access key = ", access_key_obj.access_key);
                return 4;
            }
        }
    }

    const account_new_name = join(dir_ent.parentPath, account._id + ".json");
    const filename = join(dir_ent.parentPath, dir_ent.name);
    dbg.log("Renaming account file, old =", dir_ent.name, ", new =", account._id + ".json");
    renameSync(filename, account_new_name);

    const symlink_target = join('..', CONFIG_SUBDIRS.ACCOUNTS, account._id + ".json");
    const symlink_target_double = join('..', '..', CONFIG_SUBDIRS.ACCOUNTS, account._id + ".json");

    if (account.access_keys) {
        for (const access_key_obj of account.access_keys) {
            const access_key_symlink = join(conf_dir, CONFIG_SUBDIRS.ACCESS_KEYS, access_key_obj.access_key + ".symlink");
            dbg.log("Updating access key symlink ", access_key_symlink, ", new target =", symlink_target);
            rmSync(access_key_symlink);
            symlinkSync(symlink_target, access_key_symlink);
        }
    }

    //the by-name symlink is root_accounts/<root_account_name>/<account_name>.symlink
    const root_account_name = account.owner ? account_id_to_name.get(account.owner) : account.name;
    const root_account_dir = join(conf_dir, CONFIG_SUBDIRS.ROOT_ACCOUNTS, root_account_name);
    if (!validate_dir_exists(root_account_dir)) {
        dbg.log("Create the root acccount dir ", root_account_dir);
        mkdirSync(root_account_dir);
    }
    const root_account_symlink = join(root_account_dir, account.name + ".symlink");
    dbg.log("Creating account-by-name symlink ", root_account_symlink, ", new target =", symlink_target_double);
    symlinkSync(symlink_target_double, root_account_symlink);

    return 0;
}

function map_account_id_to_name(dir_ent) {
    const { account, error} = account_file_to_object(dir_ent);
    if (error) {
        return error;
    }

    account_id_to_name.set(account._id, account.name);
    return 0;
}

function run({conf_path}) {

    conf_path = conf_path || config.NSFS_NC_CONF_DIR;
    dbg.log0("Configuration directory = ", conf_path);

    //check all dirs exist
    assert_dir_exists(conf_path);

    const account_dir = join(conf_path, CONFIG_SUBDIRS.ACCOUNTS);
    const bucket_dir = join(conf_path, CONFIG_SUBDIRS.BUCKETS);
    assert_dir_exists(account_dir);
    assert_dir_exists(bucket_dir);
    assert_dir_exists(join(conf_path, CONFIG_SUBDIRS.ACCESS_KEYS));

    //create new root_accounts dir
    const root_accounts_path = join(conf_path, CONFIG_SUBDIRS.ROOT_ACCOUNTS);
    if (!validate_dir_exists(root_accounts_path)) {
        dbg.log("Creating root accounts dir at ", root_accounts_path);
        mkdirSync(root_accounts_path);
        if (!validate_dir_exists(root_accounts_path)) {
            dbg.error("Failed to create root accounts directory at ", root_accounts_path);
            return 1;
        }
    }

    //read all accounts
    const account_files = readdirSync(account_dir, {withFileTypes: true});

    //map account id to name (used to create symlinks of iam accounts)
    for (const account_file of account_files) {
        const res = map_account_id_to_name(account_file);
        if (res !== 0) {
            return res;
        }
    }

    //upgrade accounts
    for (const account_file of account_files) {
        const res = handle_account_file(account_file, conf_path);
        if (res !== 0) {
            return res;
        }
    }

    dbg.log("Completed successfully.");
    return 0;
}

function main(argv = minimist(process.argv.slice(2))) {

    //optionally get the conf_path from argv (if not we'll use config.NSFS_NC_CONF_DIR)
    const conf_path = argv.conf_path;
    return run({conf_path});
}

if (require.main === module) {
    process.exit(main());
}
