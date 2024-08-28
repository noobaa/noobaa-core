/* Copyright (C) 2016 NooBaa */
'use strict';

// disabling init_rand_seed as it takes longer than the actual test execution
process.env.DISABLE_INIT_RANDOM_SEED = 'true';


const os = require('os');
const path = require('path');
const config = require('../../../../config');
const pkg = require('../../../../package.json');
const { update_rpm_upgrade } = require('../../../upgrade/nc_upgrade_manager');
const { ConfigFS } = require('../../../sdk/config_fs');
const { TMP_PATH, create_redirect_file, create_config_dir,
    fail_test_if_default_config_dir_exists, clean_config_dir } = require('../../system_tests/test_utils');

const config_root = path.join(TMP_PATH, 'config_root_nc_upgrade_manager_test');
const config_fs = new ConfigFS(config_root);
const hostname = os.hostname();

const old_expected_system_json = {
    [hostname]: {
        'current_version': '5.17.0',
        'upgrade_history': {
            'successful_upgrades': [{
                'timestamp': 1724687496424,
                'from_version': '5.16.0',
                'to_version': '5.17.0'
            }]
        },
    }
};

const old_expected_system_json_no_successful_upgrades = {
    [hostname]: {
        'current_version': '5.17.0',
        'upgrade_history': {
            'successful_upgrades': []
        },
    }
};

const current_expected_system_json = {
    [hostname]: {
        'current_version': pkg.version,
        'upgrade_history': {
            'successful_upgrades': [{
                'timestamp': 1724687496424,
                'from_version': '5.17.0',
                'to_version': pkg.version
            }]
        },
    }
};


const current_expected_system_json_no_successful_upgrades = {
    [hostname]: {
        'current_version': pkg.version,
        'upgrade_history': {
            'successful_upgrades': []
        },
    }
};

// WARNING:
// The following test file will check the directory structure created using create_config_dirs_if_missing()
// which is called when using noobaa-cli, for having an accurate test, it'll be blocked from running on an 
// env having an existing default config directory and the test executer will be asked to remove the default 
// config directory before running the test again, do not run on production env or on any env where the existing config directory is being used
describe('nc upgrade manager - upgrade RPM', () => {

    beforeAll(async () => {
        await fail_test_if_default_config_dir_exists('test_config_dir_nc_upgrade_manager', config_fs);
    });

    beforeEach(async () => {
        await create_config_dir(config.NSFS_NC_DEFAULT_CONF_DIR);
        await create_config_dir(config_root);
        await create_redirect_file(config_fs, config_root);
    });

    afterEach(async () => {
        await clean_config_dir(config_fs, config_root);
    });

    it('upgrade rpm - nothing to upgrade - no changes in system.json', async () => {
        await config_fs.create_system_config_file(JSON.stringify(current_expected_system_json));
        await update_rpm_upgrade(config_fs);
        const system_data_after_upgrade_run = await config_fs.get_system_config_file();
        expect(current_expected_system_json).toStrictEqual(system_data_after_upgrade_run);
    });

    it('upgrade rpm - nothing to upgrade - no changes in system.json - no successful upgrades', async () => {
        await config_fs.create_system_config_file(JSON.stringify(current_expected_system_json_no_successful_upgrades));
        await update_rpm_upgrade(config_fs);
        const system_data_after_upgrade_run = await config_fs.get_system_config_file();
        expect(current_expected_system_json_no_successful_upgrades).toStrictEqual(system_data_after_upgrade_run);
    });

    it('upgrade status - RPM was upgraded, should update system.json', async () => {
        await config_fs.create_system_config_file(JSON.stringify(old_expected_system_json));
        await update_rpm_upgrade(config_fs);
        const system_data_after_upgrade_run = await config_fs.get_system_config_file();
        const new_version = pkg.version;
        const host_data_after_upgrade = system_data_after_upgrade_run[hostname];
        expect(host_data_after_upgrade.current_version).toStrictEqual(new_version);
        expect(host_data_after_upgrade.upgrade_history.successful_upgrades[0].from_version).toStrictEqual(
            old_expected_system_json[hostname].current_version);
        expect(host_data_after_upgrade.upgrade_history.successful_upgrades[0].to_version).toStrictEqual(new_version);
    });

    it('upgrade status - RPM was upgraded, should update system.json', async () => {
        await config_fs.create_system_config_file(JSON.stringify(old_expected_system_json_no_successful_upgrades));
        await update_rpm_upgrade(config_fs);
        const system_data_after_upgrade_run = await config_fs.get_system_config_file();
        const new_version = pkg.version;
        const host_data_after_upgrade = system_data_after_upgrade_run[hostname];
        expect(host_data_after_upgrade.current_version).toStrictEqual(new_version);
        expect(host_data_after_upgrade.upgrade_history.successful_upgrades[0].from_version).toStrictEqual(
            old_expected_system_json_no_successful_upgrades[hostname].current_version);
        expect(host_data_after_upgrade.upgrade_history.successful_upgrades[0].to_version).toStrictEqual(new_version);
    });
});

