/* Copyright (C) 2024 NooBaa */
'use strict';

const path = require('path');
const fs_utils = require('../../../../util/fs_utils');
const { ConfigFS, CONFIG_TYPES } = require('../../../../sdk/config_fs');
const { TMP_PATH, TEST_TIMEOUT, write_manual_config_file, write_manual_old_account_config_file } = require('../../../system_tests/test_utils');


const tmp_fs_path = path.join(TMP_PATH, 'test_config_fs_backward_compatibility');
const config_root = path.join(tmp_fs_path, 'config_root');
const config_fs = new ConfigFS(config_root);

const silent_options = { silent_if_missing: true };
const accounts = {
    '1': {
        old: { _id: '1', name: 'backwards_account1', user: 'root' },
        new: { _id: '1', name: 'backwards_account1', user: 'staff' }
    },
    '2': {
        old: { _id: '2', name: 'backwards_account2', user: 'root' },
        new: { _id: '2', name: 'backwards_account2', user: 'staff' }
    },
    '3': {
        old: { _id: '3', name: 'backwards_account3', user: 'root' },
        new: { _id: '3', name: 'backwards_account3', user: 'staff' }
    }
};

describe('ConfigFS Backwards Compatibility', () => {
    const old_accounts_path = config_fs.old_accounts_dir_path;

    beforeAll(async () => {
        await fs_utils.create_fresh_path(old_accounts_path);
        await fs_utils.create_fresh_path(config_fs.identities_dir_path);
        await fs_utils.create_fresh_path(config_fs.accounts_by_name_dir_path);
    });

    afterAll(async () => {
        await fs_utils.folder_delete(config_root);
    }, TEST_TIMEOUT);

    afterEach(async () => {
        await clean_accounts();
    });

    ///////////////////////////
    /// GET ACCOUNT BY NAME ///
    ///////////////////////////

    it('get_account_by_name() - {config_dir}/accounts_by_name/{account_name} is missing', async () => {
        const old_account_data = accounts['1'].old;
        await write_manual_old_account_config_file(config_fs, old_account_data);
        const res = await config_fs.get_account_by_name(old_account_data.name, silent_options);
        assert_account(res, old_account_data);
    });

    it('get_account_by_name() - {config_dir}/accounts_by_name/{account_name} exist', async () => {
        const new_account_data = accounts['1'].new;
        await write_manual_config_file(CONFIG_TYPES.ACCOUNT, config_fs, new_account_data);
        const res = await config_fs.get_account_by_name(new_account_data.name, silent_options);
        assert_account(res, new_account_data);
    });

    it('get_account_by_name() - both {config_dir}/accounts_by_name/{account_name}.symlink and {config_dir}/accounts/{account_name}.json missing', async () => {
        const old_account_data = accounts['1'].old;
        const new_account_data = accounts['1'].new;
        await write_manual_old_account_config_file(config_fs, old_account_data);
        await write_manual_config_file(CONFIG_TYPES.ACCOUNT, config_fs, new_account_data);
        const res = await config_fs.get_account_by_name(new_account_data.name, silent_options);
        assert_account(res, new_account_data);
    });

    it('get_account_by_name() - none exists', async () => {
        const new_account_data = accounts['1'].new;
        const res = await config_fs.get_account_by_name(new_account_data.name, silent_options);
        expect(res).toBeUndefined();
    });

    /////////////////////////
    /// IS ACCOUNT EXISTS ///
    /////////////////////////


    it('is_account_exists() - {config_dir}/accounts_by_name/{account_name} is missing', async () => {
        const old_account_data = accounts['1'].old;
        await write_manual_old_account_config_file(config_fs, old_account_data);
        const res = await config_fs.is_account_exists_by_name(old_account_data.name, undefined);
        expect(res).toBe(true);
    });


    it('is_account_exists() - {config_dir}/accounts_by_name/{account_name} exist', async () => {
        const new_account_data = accounts['1'].new;
        await write_manual_config_file(CONFIG_TYPES.ACCOUNT, config_fs, new_account_data);
        const res = await config_fs.is_account_exists_by_name(new_account_data.name, undefined);
        expect(res).toBe(true);
    });

    it('is_account_exists() - both {config_dir}/accounts_by_name/{account_name}.symlink and {config_dir}/accounts/{account_name}.json missing', async () => {
        const old_account_data = accounts['1'].old;
        const new_account_data = accounts['1'].new;
        await write_manual_old_account_config_file(config_fs, old_account_data);
        await write_manual_config_file(CONFIG_TYPES.ACCOUNT, config_fs, new_account_data);
        const res = await config_fs.is_account_exists_by_name(new_account_data.name, undefined);
        expect(res).toBe(true);
    });

    it('is_account_exists() - none exists', async () => {
        const new_account_data = accounts['1'].new;
        const res = await config_fs.is_account_exists_by_name(new_account_data.name, undefined);
        expect(res).toBe(false);
    });


    ///////////////////////////
    /// LIST ACCOUNT EXISTS ///
    ///////////////////////////

    it('list_accounts() - none exists', async () => {
        const res = await config_fs.list_accounts();
        expect(res.length).toBe(0);
    });

    it('list_accounts() - only new exists', async () => {
        await write_manual_config_file(CONFIG_TYPES.ACCOUNT, config_fs, accounts['1'].new);
        await write_manual_config_file(CONFIG_TYPES.ACCOUNT, config_fs, accounts['2'].new);
        await write_manual_config_file(CONFIG_TYPES.ACCOUNT, config_fs, accounts['3'].new);

        const res = await config_fs.list_accounts();
        expect(res.length).toBe(3);
    });

    it('list_accounts() - only old exists', async () => {
        await write_manual_old_account_config_file(config_fs, accounts['1'].old);
        await write_manual_old_account_config_file(config_fs, accounts['2'].old);
        await write_manual_old_account_config_file(config_fs, accounts['3'].old);
        const res = await config_fs.list_accounts();
        expect(res.length).toBe(3);
    });

    it('list_accounts() - both new and old exists', async () => {
        await write_manual_config_file(CONFIG_TYPES.ACCOUNT, config_fs, accounts['1'].new);
        await write_manual_config_file(CONFIG_TYPES.ACCOUNT, config_fs, accounts['2'].new);
        await write_manual_config_file(CONFIG_TYPES.ACCOUNT, config_fs, accounts['3'].new);
        await write_manual_old_account_config_file(config_fs, accounts['1'].old);
        await write_manual_old_account_config_file(config_fs, accounts['2'].old);
        await write_manual_old_account_config_file(config_fs, accounts['3'].old);
        const res = await config_fs.list_accounts();
        expect(res.length).toBe(3);
    });
});

function assert_account(result_account, expected_account) {
    expect(result_account._id).toBe(expected_account._id);
    expect(result_account.name).toBe(expected_account.name);
    expect(result_account.user).toBe(expected_account.user);
}


async function clean_accounts() {
    for (const account of Object.values(accounts)) {
        if (account.old) {
            const old_account_path = config_fs._get_old_account_path_by_name(account.old.name);
            await fs_utils.file_delete(old_account_path);
        }
        if (account.new) {
            const new_account_path = config_fs.get_account_or_user_path_by_name(account.old.name);
            const new_account_id_path = config_fs.get_identity_path_by_id(account.old._id);
            const new_account_id_dir_path = config_fs.get_identity_dir_path_by_id(account.old._id);
            await fs_utils.file_delete(new_account_path);
            await fs_utils.file_delete(new_account_id_path);
            await fs_utils.folder_delete(new_account_id_dir_path);
        }
    }
}
