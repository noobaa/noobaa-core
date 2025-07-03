/* Copyright (C) 2024 NooBaa */
'use strict';

const path = require('path');
const config = require('../../../../../config');
const { ConfigFS } = require('../../../../sdk/config_fs');
const { TMP_PATH, create_redirect_file, create_config_dir, clean_config_dir,
    fail_test_if_default_config_dir_exists, TEST_TIMEOUT } = require('../../../system_tests/test_utils');
const { get_process_fs_context, is_path_exists } = require('../../../../util/native_fs_utils');

const tmp_fs_path = path.join(TMP_PATH, 'test_config_dir_restructure');
const config_root = path.join(tmp_fs_path, 'config_root');
const config_root_backend = config.NSFS_NC_CONFIG_DIR_BACKEND;
const fs_context = get_process_fs_context(config_root_backend);


const DEFAULT_CONF_DIR_PATH = config.NSFS_NC_DEFAULT_CONF_DIR;
const CUSTOM_CONF_DIR_PATH = path.join(TMP_PATH, 'redirected_config_dir');
const default_config_fs = new ConfigFS(DEFAULT_CONF_DIR_PATH, config_root_backend, fs_context);
const custom_config_fs = new ConfigFS(CUSTOM_CONF_DIR_PATH, config_root_backend, fs_context);
const config_fs = new ConfigFS(config_root, config_root_backend, fs_context);

const old_accounts_dir_name = '/accounts/';

// WARNING:
// The following test file will check the directory structure created using create_config_dirs_if_missing()
// which is called when using noobaa-cli, for having an accurate test, it'll be blocked from running on an 
// env having an existing default config directory and the test executer will be asked to remove the default 
// config directory before running the test again, do not run on production env or on any env where the existing config directory is being used
describe('create_config_dirs_if_missing', () => {

    beforeAll(async () => {
        await fail_test_if_default_config_dir_exists('test_config_dir_restructure', config_fs);
    });

    afterEach(async () => {
        await clean_config_dir(config_fs, CUSTOM_CONF_DIR_PATH);
    }, TEST_TIMEOUT);

    it('create_config_dirs_if_missing() first time - nothing exists - everything should be created', async () => {
        await default_config_fs.create_config_dirs_if_missing();
        await assert_config_dir(DEFAULT_CONF_DIR_PATH);
    });

    it('create_config_dirs_if_missing() first time - config_dir exists - all subdirs should be created under the default config dir', async () => {
        const config_dir = DEFAULT_CONF_DIR_PATH;
        await create_config_dir(config_dir);
        await default_config_fs.create_config_dirs_if_missing();
        await assert_config_dir(config_dir);
    });

    it('create_config_dirs_if_missing() first time - default_config_dir exists and redirect file, redirected config_dir missing - all subdirs should be created under the redirect folder', async () => {
        const default_config_dir = DEFAULT_CONF_DIR_PATH;
        const config_dir = CUSTOM_CONF_DIR_PATH;
        await create_config_dir(default_config_dir);
        await create_redirect_file(config_fs, CUSTOM_CONF_DIR_PATH);
        await custom_config_fs.create_config_dirs_if_missing();
        await assert_config_dir(config_dir);
    });

    it('create_config_dirs_if_missing() first time - default_config_dir, redirect file, redirected config_dir exist - all subdirs should be created under the redirect folder', async () => {
        const default_config_dir = DEFAULT_CONF_DIR_PATH;
        const config_dir = CUSTOM_CONF_DIR_PATH;
        await create_config_dir(default_config_dir);
        await create_config_dir(CUSTOM_CONF_DIR_PATH);
        await create_redirect_file(config_fs, CUSTOM_CONF_DIR_PATH);
        await custom_config_fs.create_config_dirs_if_missing();
        await assert_config_dir(config_dir);
    });
});


/**
 * assert_config_dir asserts the config dir structure was created appropriately  
 * 1. default config dir exists
 * 2. if redirect file exists - 
 *    redirect config dir exists 
 * 3. sub directories exists under the redirect config dir if exists else under the default config dir
 * 4. old accounts/ folder does not exist
 * @param {String} config_dir_path 
 */
async function assert_config_dir(config_dir_path) {
    // config dir exists
    let path_exists = await is_path_exists(fs_context, config_dir_path);
    expect(path_exists).toBe(true);
    const buckets_dir_name = '/buckets/';
    const identities_dir_name = '/identities/';
    const accounts_by_name = '/accounts_by_name/';
    const access_keys_dir_name = '/access_keys/';
    // config subdirs do not exist
    for (const dir of [buckets_dir_name, identities_dir_name, access_keys_dir_name, accounts_by_name]) {
        const path_to_check = path.join(config_dir_path, dir);
        path_exists = await is_path_exists(fs_context, path_to_check);
        expect(path_exists).toBe(true);
    }

    // old accounts directory does not exist - (5.17)
    const path_to_check = path.join(config_dir_path, old_accounts_dir_name);
    path_exists = await is_path_exists(fs_context, path_to_check);
    expect(path_exists).toBe(false);
}

