/* Copyright (C) 2026 NooBaa */
'use strict';

/**
 * Starts a standalone NC (nsfs) S3 endpoint for use as a deep-archive target from
 * containerized coretest. Uses an isolated config_root under TMP_PATH and creates
 * the NC account in-process via ConfigFS (no manage_nsfs CLI — avoids setgroups
 * in unprivileged test containers).
 */

require('../../util/dotenv').load();

const fs = require('fs');
const path = require('path');

const config = require('../../../config');
const { ConfigFS } = require('../../sdk/config_fs');
const { crypto_random_string } = require('../../util/string_utils');
const { TMP_PATH, set_nc_config_dir_in_config } = require('../system_tests/test_utils');
const { NSFS_ARCHIVE_TARGET_HTTP_PORT, write_nc_config_json, spawn_nsfs_process,
        wait_for_nsfs_process_ready, create_nc_account_via_config_fs } = require('./nc_nsfs_test_helpers');

const NC_ARCHIVE_TARGET_ACCOUNT_NAME = 'nc_archive_account';
const NC_ARCHIVE_TARGET_ACCOUNT_ID = '65a8edc9bc5d5bbf9db71a94';
const NC_ARCHIVE_TARGET_CONFIG_DIR = path.join(TMP_PATH, 'restore_nc_archive_config');
const NC_ARCHIVE_TARGET_STORAGE_PATH = path.join(TMP_PATH, 'restore_nc_archive_storage');
const NC_ARCHIVE_TARGET_LOGS_DIR = path.join(TMP_PATH, 'restore_nc_archive_glacier_logs');
const NC_ARCHIVE_TARGET_MASTER_KEYS = path.join(NC_ARCHIVE_TARGET_CONFIG_DIR, 'master_keys.json');
const NC_ARCHIVE_TARGET_CONFIG_FILE = path.join(NC_ARCHIVE_TARGET_CONFIG_DIR, 'config.json');

/** @type {import('child_process').ChildProcess | null} */
let nsfs_process = null;

/** @type {boolean | undefined} */
let original_test_mode;
/** @type {string | undefined} */
let original_nc_master_keys_file_location;
/** @type {string | undefined} */
let original_nsfs_nc_conf_dir;

/**
 * @returns {Promise<{ endpoint: string, access_key: string, secret_key: string }>}
 */
async function start_nc_archive_target() {
    if (nsfs_process) {
        throw new Error('nc_archive_target already started');
    }

    original_test_mode = config.test_mode;
    original_nc_master_keys_file_location = config.NC_MASTER_KEYS_FILE_LOCATION;
    original_nsfs_nc_conf_dir = config.NSFS_NC_CONF_DIR;

    config.test_mode = true;
    config.NC_MASTER_KEYS_FILE_LOCATION = NC_ARCHIVE_TARGET_MASTER_KEYS;
    set_nc_config_dir_in_config(NC_ARCHIVE_TARGET_CONFIG_DIR);

    await fs.promises.mkdir(NC_ARCHIVE_TARGET_STORAGE_PATH, { recursive: true });
    await fs.promises.mkdir(NC_ARCHIVE_TARGET_CONFIG_DIR, { recursive: true });
    await fs.promises.mkdir(NC_ARCHIVE_TARGET_LOGS_DIR, { recursive: true });

    await write_nc_config_json(NC_ARCHIVE_TARGET_CONFIG_FILE, {
        // Archive payloads use DEEP_ARCHIVE; namespace_fs requires glacier support.
        NSFS_GLACIER_ENABLED: true,
        NSFS_GLACIER_LOGS_ENABLED: true,
        NSFS_GLACIER_LOGS_DIR: NC_ARCHIVE_TARGET_LOGS_DIR,
    });

    const access_key = crypto_random_string(20);
    const secret_key = crypto_random_string(40);

    const config_fs = new ConfigFS(NC_ARCHIVE_TARGET_CONFIG_DIR);
    await create_nc_account_via_config_fs(config_fs, {
        _id: NC_ARCHIVE_TARGET_ACCOUNT_ID,
        name: NC_ARCHIVE_TARGET_ACCOUNT_NAME,
        new_buckets_path: NC_ARCHIVE_TARGET_STORAGE_PATH,
        access_key,
        secret_key,
    });

    // nsfs stdout/stderr → nsfs_integration_test_log.txt in cwd (see spawn_nsfs_process default)
    ({ process: nsfs_process } = spawn_nsfs_process({
        http_port: NSFS_ARCHIVE_TARGET_HTTP_PORT,
        config_root: NC_ARCHIVE_TARGET_CONFIG_DIR,
    }));

    nsfs_process.on('exit', (code, signal) => {
        console.warn(`nc_archive_target: nsfs.js exited code=${code} signal=${signal}`);
        nsfs_process = null;
    });

    await wait_for_nsfs_process_ready();

    return {
        endpoint: `http://localhost:${NSFS_ARCHIVE_TARGET_HTTP_PORT}`,
        access_key,
        secret_key,
    };
}

/**
 * @returns {Promise<void>}
 */
async function stop_nc_archive_target() {
    if (nsfs_process) {
        nsfs_process.kill('SIGKILL');
        nsfs_process = null;
    }
    try {
        await fs.promises.rm(NC_ARCHIVE_TARGET_STORAGE_PATH, { recursive: true, force: true });
        await fs.promises.rm(NC_ARCHIVE_TARGET_LOGS_DIR, { recursive: true, force: true });
        await fs.promises.rm(NC_ARCHIVE_TARGET_CONFIG_DIR, { recursive: true, force: true });
    } catch (err) {
        console.warn('nc_archive_target: storage/config cleanup:', err.message);
    } finally {
        if (original_test_mode !== undefined) {
            config.test_mode = original_test_mode;
            original_test_mode = undefined;
        }
        if (original_nc_master_keys_file_location !== undefined) {
            config.NC_MASTER_KEYS_FILE_LOCATION = original_nc_master_keys_file_location;
            original_nc_master_keys_file_location = undefined;
        }
        if (original_nsfs_nc_conf_dir !== undefined) {
            config.NSFS_NC_CONF_DIR = original_nsfs_nc_conf_dir;
            original_nsfs_nc_conf_dir = undefined;
        }
    }
}

module.exports = {
    start_nc_archive_target,
    stop_nc_archive_target,
    NSFS_ARCHIVE_TARGET_HTTP_PORT,
};
