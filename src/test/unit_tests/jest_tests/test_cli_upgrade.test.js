/* Copyright (C) 2016 NooBaa */
'use strict';

// disabling init_rand_seed as it takes longer than the actual test execution
process.env.DISABLE_INIT_RANDOM_SEED = 'true';


const os = require('os');
const path = require('path');
const fs_utils = require('../../../util/fs_utils');
const { ConfigFS } = require('../../../sdk/config_fs');
const { TMP_PATH, exec_manage_cli } = require('../../system_tests/test_utils');
const { ManageCLIError } = require('../../../manage_nsfs/manage_nsfs_cli_errors');
const { ManageCLIResponse } = require('../../../manage_nsfs/manage_nsfs_cli_responses');
const { TYPES, UPGRADE_ACTIONS } = require('../../../manage_nsfs/manage_nsfs_constants');

const config_root = path.join(TMP_PATH, 'config_root_cli_upgrade_test');
const config_fs = new ConfigFS(config_root);
const hostname = os.hostname();
const expected_system_json = {
    [hostname]: {
        'current_version': '5.18.0',
        'upgrade_history': {
            'successful_upgrades': [{
                'timestamp': 1724687496424,
                'from_version': '5.17.0',
                'to_version': '5.18.0'
            }]
        },
    },
    config_directory: {
        'schema_version': 1,
        'in_progress_upgrade': {
            'start_timestamp': 1724687496424,
            'phase': 'CONFIG_DIR_LOCK',
            'from_version': '5.18.0',
            'to_version': '5.18.1'
        },
        'upgrade_history': {
            'successful_upgrades': [{
                'timestamp': 1724687496424,
                'completed_scripts': [],
                'from_version': '5.17.0',
                'to_version': '5.18.0'
            }]
        }
    }
};

describe('noobaa cli - upgrade', () => {
    afterEach(async () => await fs_utils.file_delete(config_fs.system_json_path));

    it('upgrade invalid action - should fail', async () => {
        const res = await exec_manage_cli(TYPES.UPGRADE, 'invalid_action', { config_root }, true);
        const parsed_res = JSON.parse(res.stdout);
        expect(parsed_res.error.code).toBe(ManageCLIError.InvalidUpgradeAction.code);
        expect(parsed_res.error.message).toBe(ManageCLIError.InvalidUpgradeAction.message);
    });

    it('upgrade start - should fail with not implemented', async () => {
        const res = await exec_manage_cli(TYPES.UPGRADE, UPGRADE_ACTIONS.START, { config_root }, true);
        const parsed_res = JSON.parse(res.stdout);
        expect(parsed_res.error.code).toBe(ManageCLIError.UpgradeFailed.code);
        expect(parsed_res.error.message).toBe(ManageCLIError.UpgradeFailed.message);
    });

    it('upgrade status - should fail - there is no ongoing upgrade', async () => {
        const res = await exec_manage_cli(TYPES.UPGRADE, UPGRADE_ACTIONS.STATUS, { config_root }, true);
        const parsed_res = JSON.parse(res);
        expect(parsed_res.response.code).toBe(ManageCLIResponse.UpgradeStatus.code);
        expect(parsed_res.response.reply.message).toEqual('Config directory upgrade status is empty, there is no ongoing config directory upgrade');
    });

    it('upgrade status', async () => {
        await fs_utils.replace_file(config_fs.system_json_path, JSON.stringify(expected_system_json));
        const res = await exec_manage_cli(TYPES.UPGRADE, UPGRADE_ACTIONS.STATUS, { config_root }, true);
        const parsed_res = JSON.parse(res);
        expect(parsed_res.response.code).toBe(ManageCLIResponse.UpgradeStatus.code);
        expect(parsed_res.response.reply).toEqual(expected_system_json.config_directory.in_progress_upgrade);
    });

    it('upgrade history - should fail - there is no config directory upgrade history', async () => {
        const res = await exec_manage_cli(TYPES.UPGRADE, UPGRADE_ACTIONS.HISTORY, { config_root }, true);
        const parsed_res = JSON.parse(res);
        expect(parsed_res.response.code).toBe(ManageCLIResponse.UpgradeHistory.code);
        expect(parsed_res.response.reply.message).toEqual('Config directory upgrade history is empty');
    });

    it('upgrade history', async () => {
        await fs_utils.replace_file(config_fs.system_json_path, JSON.stringify(expected_system_json));
        const res = await exec_manage_cli(TYPES.UPGRADE, UPGRADE_ACTIONS.HISTORY, { config_root }, true);
        const parsed_res = JSON.parse(res);
        expect(parsed_res.response.code).toBe(ManageCLIResponse.UpgradeHistory.code);
        expect(parsed_res.response.reply).toEqual(expected_system_json.config_directory.upgrade_history);
    });
});

