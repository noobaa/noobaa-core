/* Copyright (C) 2024 NooBaa */
'use strict';

const _ = require('lodash');
const path = require('path');
const P = require('../../../util/promise');
const config = require('../../../../config');
const nb_native = require('../../../util/nb_native');
const { ConfigFS, CONFIG_TYPES } = require('../../../sdk/config_fs');
const dbg = require('../../../util/debug_module')(__filename);
const { create_config_dir, create_identity_dir_if_missing, clean_config_dir, fail_test_if_default_config_dir_exists,
    TEST_TIMEOUT, write_manual_config_file, write_manual_old_account_config_file, create_file,
    symlink_account_name, symlink_account_access_keys } = require('../../system_tests/test_utils');
const { get_process_fs_context, is_path_exists } = require('../../../util/native_fs_utils');
const { move_old_accounts_dir, create_account_access_keys_index_if_missing, create_account_name_index_if_missing,
    create_identity_if_missing, prepare_account_upgrade_params, upgrade_account_config_file, upgrade_accounts_config_files, run } = require('../../../upgrade/nc_upgrade_scripts/1.0.0/config_dir_restructure');
const { create_fresh_path } = require('../../../util/fs_utils');
const native_fs_utils = require('../../../util/native_fs_utils');

const mock_access_key = 'Zzto3OwtGflQrqD41h3SEXAMPLE';
const mock_secret_key = 'U2AYaMpU3zRDcRFWmvzgQr9MoHIAsDy3oEXAMPLE';
const mock_access_keys = [{ access_key: mock_access_key, secret_key: mock_secret_key }];
const mock_old_version = '5.16.0';
const config_root_backend = config.NSFS_NC_CONFIG_DIR_BACKEND;
const fs_context = get_process_fs_context(config_root_backend);
const DEFAULT_CONF_DIR_PATH = config.NSFS_NC_DEFAULT_CONF_DIR;
const default_config_fs = new ConfigFS(DEFAULT_CONF_DIR_PATH, config_root_backend, fs_context);
const hidden_old_accounts_path = path.join(default_config_fs.config_root, `.backup_accounts_dir_${mock_old_version}/`);
const hidden_access_keys_backup_path = path.join(default_config_fs.config_root, `.backup_access_keys_dir_${mock_old_version}/`);
const root_dn = 'root';
// as mentioned in ResourcesLimitations.md - there is a soft limit of 5000 supported accounts
const accounts_soft_limit = 5000;
const mock_account_id = '1';
const mock_account_name = 'old_account' + mock_account_id;

// WARNING:
// The following test file will check the directory structure created using create_config_dirs_if_missing()
// which is called when using noobaa-cli, for having an accurate test, it'll be blocked from running on an 
// env having an existing default config directory and the test executer will be asked to remove the default 
// config directory before running the test again, do not run on production env or on any env where the existing config directory is being used
describe('move_old_accounts_dir', () => {

    beforeAll(async () => {
        await fail_test_if_default_config_dir_exists('test_config_dir_restructure', default_config_fs);
        await create_config_dir(config.NSFS_NC_DEFAULT_CONF_DIR);
    });

    afterEach(async () => {
        await clean_config_dir(default_config_fs);
    }, TEST_TIMEOUT);

    it('move_old_accounts_dir() - accounts/ dir is missing', async () => {
        await move_old_accounts_dir(default_config_fs, [], mock_old_version, dbg);
        await assert_old_account_dir_was_deleted();
        await assert_backup_dir({});
    });

    it('move_old_accounts_dir() - accounts/ dir is empty', async () => {
        await create_fresh_path(default_config_fs.old_accounts_dir_path);
        await move_old_accounts_dir(default_config_fs, [], mock_old_version, dbg);
        await assert_old_account_dir_was_deleted();
        await assert_backup_dir({});
    });

    it('move_old_accounts_dir() - accounts/ dir contains a single account', async () => {
        await create_fresh_path(default_config_fs.old_accounts_dir_path);
        const account_name = 'old_account1';
        const account_data = { _id: '1', name: account_name, user: root_dn };
        await write_manual_old_account_config_file(default_config_fs, account_data);
        await move_old_accounts_dir(default_config_fs, [account_name], mock_old_version, dbg);
        await assert_old_account_dir_was_deleted();
        await assert_backup_dir({ [account_name]: account_data});
    });

    it('move_old_accounts_dir() - accounts/ dir contains accounts_soft_limit accounts', async () => {
        await create_fresh_path(default_config_fs.old_accounts_dir_path);
        const account_ids = Array.from({ length: accounts_soft_limit }, (v, i) => Number(i + 1));
        const account_names_obj = {};
        await P.map_with_concurrency(accounts_soft_limit, account_ids, async account_id => {
            const account_data = { _id: String(account_id), name: 'old_account' + account_id, user: root_dn };
            await write_manual_old_account_config_file(default_config_fs, account_data);
            account_names_obj[account_data.name] = account_data;
        });
        await move_old_accounts_dir(default_config_fs, Object.keys(account_names_obj), mock_old_version, dbg);
        await assert_old_account_dir_was_deleted();
        await assert_backup_dir(account_names_obj);
    }, TEST_TIMEOUT);

    it('move_old_accounts_dir() - .backup_accounts_dir already exists and contains some of the accounts in .backup_accounts_dir/ dir', async () => {
        await create_fresh_path(default_config_fs.old_accounts_dir_path);
        await create_fresh_path(default_config_fs.identities_dir_path);
        await create_fresh_path(default_config_fs.accounts_by_name_dir_path);
        await create_fresh_path(hidden_old_accounts_path);

        const account_ids = Array.from({ length: 200 }, (v, i) => Number(i + 1));
        const account_names_obj = {};
        const symlink_options = { symlink_name: false, symlink_access_key: false };
        await P.map_with_concurrency(100, account_ids, async account_id => {
            const account_data = { _id: String(account_id), name: 'old_account' + account_id, user: root_dn };
            await write_manual_old_account_config_file(default_config_fs, account_data, symlink_options);
            account_names_obj[account_data.name] = account_data;
            if (account_id % 2 === 0) {
                const backup_file_path = path.join(hidden_old_accounts_path, default_config_fs.json(account_data.name));
                await create_file(default_config_fs.fs_context, backup_file_path, account_data, { stringify_json: true });
            }
        });
        await move_old_accounts_dir(default_config_fs, Object.keys(account_names_obj), mock_old_version, dbg);
        await assert_old_account_dir_was_deleted();
        await assert_backup_dir(account_names_obj);
    });
});

describe('create_account_access_keys_index_if_missing', () => {
    beforeAll(async () => {
        await fail_test_if_default_config_dir_exists('test_config_dir_restructure', default_config_fs);
    });

    beforeEach(async () => {
        await create_config_dir(config.NSFS_NC_DEFAULT_CONF_DIR);
        await default_config_fs.create_config_dirs_if_missing();
        await create_fresh_path(default_config_fs.old_accounts_dir_path);
        await create_fresh_path(hidden_old_accounts_path);
    }, TEST_TIMEOUT);

    afterEach(async () => {
        await clean_config_dir(default_config_fs);
    }, TEST_TIMEOUT);

    // in the following tests we test create_account_access_keys_index_if_missing() 
    // therefore we need to create the target symlink of the access keys, which is the identity file before we run the function
    it('create_account_access_keys_index_if_missing() - single regular account', async () => {
        const account_data = { _id: mock_account_id, name: mock_account_name, user: root_dn, access_keys: mock_access_keys };
        await write_manual_old_account_config_file(default_config_fs, account_data, { symlink_access_key: true });
        await write_manual_config_file(CONFIG_TYPES.ACCOUNT, default_config_fs, account_data, undefined,
            { symlink_access_key: false, symlink_name: false });

        const identity_path = default_config_fs.get_identity_path_by_id(account_data._id);
        const account_upgrade_params = { ...account_data, identity_path };
        await create_account_access_keys_index_if_missing(default_config_fs, account_upgrade_params, hidden_old_accounts_path, dbg);
        await assert_access_key_index_is_updated(account_data);
    });

    it('create_account_access_keys_index_if_missing() - anonymous account', async () => {
        const account_data = { _id: mock_account_id, name: config.ANONYMOUS_ACCOUNT_NAME, user: root_dn };
        await write_manual_old_account_config_file(default_config_fs, account_data, { symlink_access_key: false });
        await write_manual_config_file(CONFIG_TYPES.ACCOUNT, default_config_fs, account_data, undefined,
            { symlink_access_key: false, symlink_name: false });
        const identity_path = default_config_fs.get_identity_path_by_id(account_data._id);
        const account_upgrade_params = { ...account_data, identity_path };
        await create_account_access_keys_index_if_missing(default_config_fs, account_upgrade_params, hidden_old_accounts_path, dbg);
        await assert_access_key_index_is_updated(account_data);
    });

    it('create_account_access_keys_index_if_missing() - new access key index already exists', async () => {
        const account_data = { _id: mock_account_id, name: mock_account_name, user: root_dn, access_keys: mock_access_keys };
        await write_manual_old_account_config_file(default_config_fs, account_data, { symlink_access_key: false });
        await write_manual_config_file(CONFIG_TYPES.ACCOUNT, default_config_fs, account_data, undefined,
            { symlink_access_key: true, symlink_name: false });
        const identity_path = default_config_fs.get_identity_path_by_id(account_data._id);
        const account_upgrade_params = { ...account_data, identity_path };
        await create_account_access_keys_index_if_missing(default_config_fs, account_upgrade_params, hidden_old_accounts_path, dbg);
        await assert_access_key_index_is_updated(account_data);
    });

    it('create_account_access_keys_index_if_missing() - new access key index already exists and points to a non existing location', async () => {
        const account_data = { _id: mock_account_id, name: mock_account_name, user: root_dn, access_keys: mock_access_keys };
        await write_manual_old_account_config_file(default_config_fs, account_data, { symlink_access_key: false });
        await write_manual_config_file(CONFIG_TYPES.ACCOUNT, default_config_fs, account_data, undefined,
            { symlink_access_key: false, symlink_name: false });
        const mock_link_id_path = path.join(default_config_fs.identities_dir_path, 'mock_id_dir', 'identity.json');
        await symlink_account_access_keys(default_config_fs, account_data.access_keys, mock_link_id_path);
        const identity_path = default_config_fs.get_identity_path_by_id(account_data._id);
        const account_upgrade_params = { ...account_data, identity_path };
        await create_account_access_keys_index_if_missing(default_config_fs, account_upgrade_params, hidden_old_accounts_path, dbg);
        await assert_access_key_index_is_updated(account_data);
    });

    it('create_account_access_keys_index_if_missing() - new access key index already exists and points to a wrong location', async () => {
        const account_data = { _id: mock_account_id, name: mock_account_name, user: root_dn, access_keys: mock_access_keys };
        await write_manual_old_account_config_file(default_config_fs, account_data, { symlink_access_key: false });
        await write_manual_config_file(CONFIG_TYPES.ACCOUNT, default_config_fs, account_data, undefined,
            { symlink_access_key: false, symlink_name: false });
        const mock_id_dir = path.join(default_config_fs.identities_dir_path, 'mock_id_dir');
        const mock_link_id_path = path.join(mock_id_dir, 'identity.json');
        await create_fresh_path(mock_id_dir);
        await create_file(default_config_fs.fs_context, mock_link_id_path, { mock_key: 'mock_value' }, { stringify_json: true });
        await symlink_account_access_keys(default_config_fs, account_data.access_keys, mock_link_id_path);
        const identity_path = default_config_fs.get_identity_path_by_id(account_data._id);
        const account_upgrade_params = { ...account_data, identity_path };
        await create_account_access_keys_index_if_missing(default_config_fs, account_upgrade_params, hidden_old_accounts_path, dbg);
        await assert_access_key_index_is_updated(account_data);
    });

    it('create_account_access_keys_index_if_missing() - old access key index already deleted', async () => {
        const account_data = { _id: mock_account_id, name: mock_account_name, user: root_dn, access_keys: mock_access_keys };
        await write_manual_old_account_config_file(default_config_fs, account_data, { symlink_access_key: false });
        await write_manual_config_file(CONFIG_TYPES.ACCOUNT, default_config_fs, account_data, undefined,
            { symlink_access_key: false, symlink_name: false });
        const identity_path = default_config_fs.get_identity_path_by_id(account_data._id);
        const account_upgrade_params = { ...account_data, identity_path };
        await create_account_access_keys_index_if_missing(default_config_fs, account_upgrade_params, hidden_old_accounts_path, dbg);
        await assert_access_key_index_is_updated(account_data);
    });
});

describe('create_account_name_index_if_missing', () => {
    beforeAll(async () => {
        await fail_test_if_default_config_dir_exists('test_config_dir_restructure', default_config_fs);
    });

    beforeEach(async () => {
        await create_config_dir(config.NSFS_NC_DEFAULT_CONF_DIR);
        await default_config_fs.create_config_dirs_if_missing();
        await create_fresh_path(default_config_fs.old_accounts_dir_path);
        await create_fresh_path(hidden_old_accounts_path);
    }, TEST_TIMEOUT);

    afterEach(async () => {
        await clean_config_dir(default_config_fs);
    }, TEST_TIMEOUT);


    it('create_account_name_index_if_missing() - single regular account', async () => {
        const account_data = { _id: mock_account_id, name: mock_account_name, user: root_dn, access_keys: mock_access_keys };
        await write_manual_old_account_config_file(default_config_fs, account_data, { symlink_access_key: false });
        await write_manual_config_file(CONFIG_TYPES.ACCOUNT, default_config_fs, account_data, undefined,
            { symlink_access_key: false, symlink_name: false });

        const identity_path = default_config_fs.get_identity_path_by_id(account_data._id);
        const account_upgrade_params = { ...account_data, account_name: account_data.name, identity_path };
        await create_account_name_index_if_missing(default_config_fs, account_upgrade_params, dbg);
        await assert_name_index_is_updated(account_data);
    });

    it('create_account_name_index_if_missing() - anonymous account', async () => {
        const account_data = { _id: mock_account_id, name: config.ANONYMOUS_ACCOUNT_NAME, user: root_dn };
        const symlink_options = { symlink_access_key: false };
        await write_manual_old_account_config_file(default_config_fs, account_data, symlink_options);
        await write_manual_config_file(CONFIG_TYPES.ACCOUNT, default_config_fs, account_data, undefined, symlink_options);
        const identity_path = default_config_fs.get_identity_path_by_id(account_data._id);
        const account_upgrade_params = { ...account_data, account_name: account_data.name, identity_path };
        await create_account_name_index_if_missing(default_config_fs, account_upgrade_params, dbg);
        await assert_name_index_is_updated(account_data);
    });

    it('create_account_name_index_if_missing() - new name index already exists', async () => {
        const account_data = { _id: mock_account_id, name: mock_account_name, user: root_dn, access_keys: mock_access_keys };
        await write_manual_old_account_config_file(default_config_fs, account_data, { symlink_access_key: false });
        await write_manual_config_file(CONFIG_TYPES.ACCOUNT, default_config_fs, account_data, undefined,
            { symlink_access_key: false, symlink_name: true });
        const identity_path = default_config_fs.get_identity_path_by_id(account_data._id);
        const account_upgrade_params = { ...account_data, account_name: account_data.name, identity_path };
        await create_account_name_index_if_missing(default_config_fs, account_upgrade_params, dbg);
        await assert_name_index_is_updated(account_data);
    });

    it('create_account_name_index_if_missing() - new name index already exists and points to a non existing location', async () => {
        const account_data = { _id: mock_account_id, name: mock_account_name, user: root_dn, access_keys: mock_access_keys };
        await write_manual_old_account_config_file(default_config_fs, account_data, { symlink_access_key: false });
        await write_manual_config_file(CONFIG_TYPES.ACCOUNT, default_config_fs, account_data, undefined,
            { symlink_access_key: false, symlink_name: false });
        const mock_link_id_path = path.join(default_config_fs.identities_dir_path, 'mock_id_dir', 'identity.json');
        await symlink_account_name(default_config_fs, account_data.name, mock_link_id_path);
        const identity_path = default_config_fs.get_identity_path_by_id(account_data._id);
        const account_upgrade_params = { ...account_data, account_name: account_data.name, identity_path };
        await create_account_name_index_if_missing(default_config_fs, account_upgrade_params, dbg);
        await assert_name_index_is_updated(account_data);
    });

    it('create_account_name_index_if_missing() - new name index already exists and points to wrong location', async () => {
        const account_data = { _id: mock_account_id, name: mock_account_name, user: root_dn, access_keys: mock_access_keys };
        await write_manual_old_account_config_file(default_config_fs, account_data, { symlink_access_key: false });
        await write_manual_config_file(CONFIG_TYPES.ACCOUNT, default_config_fs, account_data, undefined,
            { symlink_access_key: false, symlink_name: false });
        const mock_id_dir = path.join(default_config_fs.identities_dir_path, 'mock_id_dir');
        const mock_link_id_path = path.join(mock_id_dir, 'identity.json');
        await create_fresh_path(mock_id_dir);
        await create_file(default_config_fs.fs_context, mock_link_id_path, { mock_key: 'mock_value' }, { stringify_json: true });
        await symlink_account_name(default_config_fs, account_data.name, mock_link_id_path);
        const identity_path = default_config_fs.get_identity_path_by_id(account_data._id);
        const account_upgrade_params = { ...account_data, account_name: account_data.name, identity_path };
        await create_account_name_index_if_missing(default_config_fs, account_upgrade_params, dbg);
        await assert_name_index_is_updated(account_data);
    });

    it('create_account_name_index_if_missing() - old name index already deleted', async () => {
        const account_data = { _id: mock_account_id, name: mock_account_name, user: root_dn, access_keys: mock_access_keys };
        await write_manual_old_account_config_file(default_config_fs, account_data, { symlink_access_key: false });
        await write_manual_config_file(CONFIG_TYPES.ACCOUNT, default_config_fs, account_data, undefined,
            { symlink_access_key: false, symlink_name: false });
        const identity_path = default_config_fs.get_identity_path_by_id(account_data._id);
        const account_upgrade_params = { ...account_data, account_name: account_data.name, identity_path };
        await create_account_name_index_if_missing(default_config_fs, account_upgrade_params, dbg);
        await assert_name_index_is_updated(account_data);
    });
});

describe('create_identity_if_missing', () => {
    beforeAll(async () => {
        await fail_test_if_default_config_dir_exists('test_config_dir_restructure', default_config_fs);
    });

    beforeEach(async () => {
        await create_config_dir(config.NSFS_NC_DEFAULT_CONF_DIR);
        await default_config_fs.create_config_dirs_if_missing();
        await create_fresh_path(default_config_fs.old_accounts_dir_path);
        await create_fresh_path(hidden_old_accounts_path);
    }, TEST_TIMEOUT);

    afterEach(async () => {
        await clean_config_dir(default_config_fs);
    }, TEST_TIMEOUT);

    it('create_identity_if_missing() - identity does not exist', async () => {
        const account_data = { _id: mock_account_id, name: mock_account_name, user: root_dn, access_keys: mock_access_keys };
        await write_manual_old_account_config_file(default_config_fs, account_data);
        const account_old_path = default_config_fs._get_old_account_path_by_name(account_data.name);
        const account_old_path_stat = await nb_native().fs.stat(default_config_fs.fs_context, account_old_path);
        const identity_path = default_config_fs.get_identity_path_by_id(account_data._id);
        const identity_dir_path = default_config_fs.get_identity_dir_path_by_id(account_data._id);
        const account_upgrade_params = {
            ...account_data, account_name: account_data.name, identity_path,
            account_old_path,
            account_old_path_stat, identity_dir_path
         };
        await create_identity_if_missing(default_config_fs.fs_context, account_upgrade_params, dbg);
        await assert_identity_created(account_data);
    });

    it('create_identity_if_missing() - identity file and dir already exists', async () => {
        const account_data = { _id: mock_account_id, name: mock_account_name, user: root_dn, access_keys: mock_access_keys };
        await write_manual_old_account_config_file(default_config_fs, account_data);
        await write_manual_config_file(CONFIG_TYPES.ACCOUNT, default_config_fs, account_data, undefined);
        const account_old_path = default_config_fs._get_old_account_path_by_name(account_data.name);
        const account_old_path_stat = await nb_native().fs.stat(default_config_fs.fs_context, account_old_path);
        const identity_path = default_config_fs.get_identity_path_by_id(account_data._id);
        const identity_dir_path = default_config_fs.get_identity_dir_path_by_id(account_data._id);
        const account_upgrade_params = {
            ...account_data, account_name: account_data.name, identity_path,
            account_old_path,
            account_old_path_stat, identity_dir_path
         };
        await create_identity_if_missing(default_config_fs.fs_context, account_upgrade_params, dbg);
        await assert_identity_created(account_data);
    });

    it('create_identity_if_missing() - only dir exists but file doesn’t', async () => {
        const account_data = { _id: mock_account_id, name: mock_account_name, user: root_dn, access_keys: mock_access_keys };
        await write_manual_old_account_config_file(default_config_fs, account_data);
        await create_identity_dir_if_missing(default_config_fs, account_data._id);
        const account_old_path = default_config_fs._get_old_account_path_by_name(account_data.name);
        const account_old_path_stat = await nb_native().fs.stat(default_config_fs.fs_context, account_old_path);
        const identity_path = default_config_fs.get_identity_path_by_id(account_data._id);
        const identity_dir_path = default_config_fs.get_identity_dir_path_by_id(account_data._id);
        const account_upgrade_params = {
            ...account_data, account_name: account_data.name, identity_path,
            account_old_path,
            account_old_path_stat, identity_dir_path
        };
        await create_identity_if_missing(default_config_fs.fs_context, account_upgrade_params, dbg);
        await assert_identity_created(account_data);
    });
});

describe('prepare_account_upgrade_params', () => {
    beforeAll(async () => {
        await fail_test_if_default_config_dir_exists('test_config_dir_restructure', default_config_fs);
    });

    beforeEach(async () => {
        await create_config_dir(config.NSFS_NC_DEFAULT_CONF_DIR);
        await default_config_fs.create_config_dirs_if_missing();
        await create_fresh_path(default_config_fs.old_accounts_dir_path);
        await create_fresh_path(hidden_old_accounts_path);
    }, TEST_TIMEOUT);

    afterEach(async () => {
        await clean_config_dir(default_config_fs);
    }, TEST_TIMEOUT);

    it('prepare_account_upgrade_params() - account name exists', async () => {
        const account_data = { _id: mock_account_id, name: mock_account_name, user: root_dn, access_keys: mock_access_keys };
        await write_manual_old_account_config_file(default_config_fs, account_data);
        const account_old_path = default_config_fs._get_old_account_path_by_name(account_data.name);
        const identity_path = default_config_fs.get_identity_path_by_id(account_data._id);
        const identity_dir_path = default_config_fs.get_identity_dir_path_by_id(account_data._id);
        let src_file;
        let actual_upgrade_params;
        try {
            src_file = await native_fs_utils.open_file(fs_context, undefined, account_old_path, 'r');
            const account_old_path_stat = await src_file.stat(default_config_fs.fs_context);
            const expected_account_upgrade_params = {
                _id: account_data._id,
                access_keys: account_data.access_keys,
                account_name: account_data.name,
                identity_path,
                account_old_path,
                account_old_path_stat,
                identity_dir_path,
                src_file,
                gpfs_options: { src_file, dst_file: undefined }
            };
            actual_upgrade_params = await prepare_account_upgrade_params(default_config_fs, account_data.name);
            assert_upgrade_params(actual_upgrade_params, expected_account_upgrade_params);
        } catch (err) {
            fail(err);
        } finally {
            if (src_file) await src_file.close(default_config_fs.fs_context);
            if (actual_upgrade_params.src_file) await actual_upgrade_params.src_file.close(default_config_fs.fs_context);
        }
    });

    it('prepare_account_upgrade_params() - account name does not exist', async () => {
        const account_data = { _id: mock_account_id, name: mock_account_name, user: root_dn, access_keys: mock_access_keys };
        await expect(prepare_account_upgrade_params(default_config_fs, account_data.name)).rejects.toThrow('No such file or directory');
    });
});

describe('upgrade_account_config_file', () => {
    beforeAll(async () => {
        await fail_test_if_default_config_dir_exists('test_config_dir_restructure', default_config_fs);
    });

    beforeEach(async () => {
        await create_config_dir(config.NSFS_NC_DEFAULT_CONF_DIR);
        await default_config_fs.create_config_dirs_if_missing();
        await create_fresh_path(default_config_fs.old_accounts_dir_path);
        await create_fresh_path(hidden_old_accounts_path);
        await create_fresh_path(hidden_access_keys_backup_path);
    }, TEST_TIMEOUT);

    afterEach(async () => {
        await clean_config_dir(default_config_fs);
    }, TEST_TIMEOUT);

    it('upgrade_account_config_file() - account exists in accounts/', async () => {
        const account_data = { _id: mock_account_id, name: mock_account_name, user: root_dn, access_keys: mock_access_keys };
        await write_manual_old_account_config_file(default_config_fs, account_data, { symlink_access_key: true });
        await upgrade_account_config_file(default_config_fs, account_data.name, hidden_access_keys_backup_path, dbg);
        await assert_account_config_file_upgraded({[account_data.name]: account_data});
    });

    it('upgrade_account_config_file() - account was already upgraded', async () => {
        const account_data = { _id: mock_account_id, name: mock_account_name, user: root_dn, access_keys: mock_access_keys };
        await write_manual_old_account_config_file(default_config_fs, account_data, { symlink_access_key: false });
        await write_manual_config_file(CONFIG_TYPES.ACCOUNT, default_config_fs, account_data, undefined,
            { symlink_access_key: false, symlink_name: false });
        await upgrade_account_config_file(default_config_fs, account_data.name, hidden_access_keys_backup_path, dbg);
        await assert_account_config_file_upgraded({[account_data.name]: account_data});
    });

    it('upgrade_account_config_file() - identity exists but indexes (symlinks) are not', async () => {
        const account_data = { _id: mock_account_id, name: mock_account_name, user: root_dn, access_keys: mock_access_keys };
        await write_manual_old_account_config_file(default_config_fs, account_data, { symlink_access_key: false });
        await write_manual_config_file(CONFIG_TYPES.ACCOUNT, default_config_fs, account_data, undefined,
            { symlink_access_key: false, symlink_name: false });
        await upgrade_account_config_file(default_config_fs, account_data.name, hidden_access_keys_backup_path, dbg);
        await assert_account_config_file_upgraded({[account_data.name]: account_data});
    });

    it('upgrade_account_config_file() - identity exists, name index (symlink) exist, access keys index (symlink) does not', async () => {
        const account_data = { _id: mock_account_id, name: mock_account_name, user: root_dn, access_keys: mock_access_keys };
        await write_manual_old_account_config_file(default_config_fs, account_data, { symlink_access_key: false });
        await write_manual_config_file(CONFIG_TYPES.ACCOUNT, default_config_fs, account_data, undefined,
            { symlink_access_key: false, symlink_name: true });
        await upgrade_account_config_file(default_config_fs, account_data.name, hidden_access_keys_backup_path, dbg);
        await assert_account_config_file_upgraded({[account_data.name]: account_data});
    });

    it('upgrade_account_config_file() - identity exists, access keys index exist, name index does not', async () => {
        const account_data = { _id: mock_account_id, name: mock_account_name, user: root_dn, access_keys: mock_access_keys };
        await write_manual_old_account_config_file(default_config_fs, account_data, { symlink_access_key: false });
        await write_manual_config_file(CONFIG_TYPES.ACCOUNT, default_config_fs, account_data, undefined,
            { symlink_access_key: true, symlink_name: false });
        await upgrade_account_config_file(default_config_fs, account_data.name, hidden_access_keys_backup_path, dbg);
        await assert_account_config_file_upgraded({[account_data.name]: account_data});
    });
});

describe('upgrade_accounts_config_files', () => {
    beforeAll(async () => {
        await fail_test_if_default_config_dir_exists('test_config_dir_restructure', default_config_fs);
    });

    beforeEach(async () => {
        await create_config_dir(config.NSFS_NC_DEFAULT_CONF_DIR);
        await default_config_fs.create_config_dirs_if_missing();
        await create_fresh_path(default_config_fs.old_accounts_dir_path);
        await create_fresh_path(default_config_fs.access_keys_dir_path);
        await create_fresh_path(hidden_old_accounts_path);
        await create_fresh_path(hidden_access_keys_backup_path);
    }, TEST_TIMEOUT);

    afterEach(async () => {
        await clean_config_dir(default_config_fs);
    }, TEST_TIMEOUT);

    it('upgrade_accounts_config_files() - empty accounts/ dir', async () => {
        await upgrade_accounts_config_files(default_config_fs, [], mock_old_version, dbg);
        await assert_dir_is_empty(default_config_fs.identities_dir_path);
        await assert_dir_is_empty(default_config_fs.accounts_by_name_dir_path);
        await assert_dir_is_empty(default_config_fs.access_keys_dir_path);
    });

    it('upgrade_accounts_config_files() - accounts/ dir contains accounts_soft_limit accounts', async () => {
        const account_ids = Array.from({ length: accounts_soft_limit }, (v, i) => Number(i + 1));
        const account_names_obj = {};
        await P.map_with_concurrency(100, account_ids, async account_id => {
            const access_keys = _.cloneDeep(mock_access_keys);
            access_keys[0].access_key += String(account_id);
            const account_data = { _id: String(account_id), name: 'old_account' + account_id, user: root_dn, access_keys };
            await write_manual_old_account_config_file(default_config_fs, account_data, { symlink_access_key: true });
            account_names_obj[account_data.name] = account_data;
        });
        await upgrade_accounts_config_files(default_config_fs, Object.keys(account_names_obj), mock_old_version, dbg);
        await assert_account_config_file_upgraded(account_names_obj);
    }, TEST_TIMEOUT);
});

describe('run', () => {
    beforeAll(async () => {
        await fail_test_if_default_config_dir_exists('test_config_dir_restructure', default_config_fs);
    });

    beforeEach(async () => {
        await create_config_dir(config.NSFS_NC_DEFAULT_CONF_DIR);
        await create_fresh_path(default_config_fs.old_accounts_dir_path);
        await create_fresh_path(default_config_fs.access_keys_dir_path);
    }, TEST_TIMEOUT);

    afterEach(async () => {
        await clean_config_dir(default_config_fs);
    }, TEST_TIMEOUT);

    it('run() - empty accounts/ dir', async () => {
        await run({ dbg, from_version: mock_old_version });
        await assert_dir_is_empty(default_config_fs.identities_dir_path);
        await assert_dir_is_empty(default_config_fs.accounts_by_name_dir_path);
        await assert_dir_is_empty(default_config_fs.access_keys_dir_path);
        await assert_old_account_dir_was_deleted();
        await assert_backup_dir({});
    });

    it('run() - accounts/ dir contains accounts_soft_limit accounts', async () => {
        const account_ids = Array.from({ length: accounts_soft_limit }, (v, i) => Number(i + 1));
        const account_names_obj = {};
        await P.map_with_concurrency(100, account_ids, async account_id => {
            const access_keys = _.cloneDeep(mock_access_keys);
            access_keys[0].access_key += String(account_id);
            const account_data = { _id: String(account_id), name: 'old_account' + account_id, user: root_dn, access_keys };
            await write_manual_old_account_config_file(default_config_fs, account_data, { symlink_access_key: true });
            account_names_obj[account_data.name] = account_data;
        });
        await run({ dbg, from_version: mock_old_version });
        await assert_account_config_file_upgraded(account_names_obj);
        await assert_old_account_dir_was_deleted();
        await assert_backup_dir(account_names_obj);
    }, TEST_TIMEOUT);
});

/**
 * assert_old_account_dir_was_deleted asserts old accounts/ dir was deleted
 * @returns {Promise<Void>}
 */
async function assert_old_account_dir_was_deleted() {
    const exists = await is_path_exists(default_config_fs.fs_context, default_config_fs.old_accounts_dir_path);
    expect(exists).toBe(false);
}

/**
 * assert_backup_dir was created and contains the given accounts
 * expected_accounts is an object that consisted of {account_name: account_data}
 * @param {{[account_name: String]: Object}} [expected_accounts] 
 * @returns {Promise<Void>}
 */
async function assert_backup_dir(expected_accounts = {}) {
    const exists = await is_path_exists(default_config_fs.fs_context, hidden_old_accounts_path);
    expect(exists).toBe(true);
    for (const account_name of Object.keys(expected_accounts)) {
        const account_path = path.join(hidden_old_accounts_path, default_config_fs.json(account_name));
        const account_exists = await is_path_exists(default_config_fs.fs_context, account_path);
        expect(account_exists).toBe(true);
    }
}

/**
 * assert_access_key_index_is_updated to point to the account's identity.json file
 * @param {Object} account_data 
 * @returns {Promise<Void>}
 */
async function assert_access_key_index_is_updated(account_data) {
    const { _id, name, access_keys } = account_data;
    if (name === config.ANONYMOUS_ACCOUNT_NAME && !access_keys?.[0]?.access_key) return;
    for (const access_key_obj of access_keys) {
        const access_key_path = default_config_fs.get_account_or_user_path_by_access_key(access_key_obj.access_key);
        const identity_path = default_config_fs.get_identity_path_by_id(_id);
        const exists = await is_path_exists(default_config_fs.fs_context, access_key_path);
        expect(exists).toBe(true);
        const access_key_linked_to_identity = await default_config_fs._is_symlink_pointing_to_identity(access_key_path, identity_path);
        expect(access_key_linked_to_identity).toBe(true);
    }
}

/**
 * assert_name_index_is_updated to point to the account's identity.json file
 * @param {Object} account_data
 * @returns {Promise<Void>}
 */
async function assert_name_index_is_updated(account_data) {
    const { _id, name } = account_data;
    const account_by_name_path = default_config_fs.get_account_or_user_path_by_name(name);
    const identity_path = default_config_fs.get_identity_path_by_id(_id);
    const exists = await is_path_exists(default_config_fs.fs_context, account_by_name_path);
    expect(exists).toBe(true);
    const name_linked_to_identity = await default_config_fs._is_symlink_pointing_to_identity(account_by_name_path, identity_path);
    expect(name_linked_to_identity).toBe(true);
}

/**
 * assert_identity_created asserts that -
 * 1. the identity dir was created
 * 2. the identity.json file was created
 * @param {Object} account_data
 * @returns {Promise<Void>}
 */
async function assert_identity_created(account_data) {
    const { _id } = account_data;
    const identity_dir_path = default_config_fs.get_identity_path_by_id(_id);
    const dir_exists = await is_path_exists(default_config_fs.fs_context, identity_dir_path);
    expect(dir_exists).toBe(true);
    const identity_data = await default_config_fs.get_identity_by_id(_id, CONFIG_TYPES.ACCOUNT, { show_secrets: true });
    expect(identity_data).toStrictEqual(account_data);
}

/**
 * assert_upgrade_params asserts that the actual upgrade params are as expected
 * @param {Object} actual_upgrade_params 
 * @param {Object} expected_account_upgrade_params
 * @returns {Void} 
 */
function assert_upgrade_params(actual_upgrade_params, expected_account_upgrade_params) {
    expect(actual_upgrade_params).toStrictEqual(expected_account_upgrade_params);
}

/**
 * assert_account_config_file_upgraded asserts that the account config file was upgraded as expected
 */
async function assert_account_config_file_upgraded(expected_accounts) {
    for (const account_name of Object.keys(expected_accounts)) {
        const account_data = expected_accounts[account_name];
        await assert_access_key_index_is_updated(account_data);
        await assert_name_index_is_updated(account_data);
        await assert_identity_created(account_data);
    }
}

// Jest has builtin function fail that based on Jasmine
// in case Jasmine would get removed from jest, created this one
// based on this: https://stackoverflow.com/a/55526098/16571658
function fail(reason) {
    throw new Error(reason);
}

/**
 * assert_dir_is_empty readdir and checks that the length is 0
 * @param {String} dir_path 
 */
async function assert_dir_is_empty(dir_path) {
    const entries = await nb_native().fs.readdir(default_config_fs.fs_context, default_config_fs.identities_dir_path);
    expect(entries.length).toBe(0);
}
