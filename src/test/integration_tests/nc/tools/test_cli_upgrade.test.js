/* Copyright (C) 2016 NooBaa */
'use strict';

// disabling init_rand_seed as it takes longer than the actual test execution
process.env.DISABLE_INIT_RANDOM_SEED = 'true';

const os = require('os');
const path = require('path');
const config = require('../../../../../config');
const pkg = require('../../../../../package.json');
const fs_utils = require('../../../../util/fs_utils');
const { ConfigFS } = require('../../../../sdk/config_fs');
const { TMP_PATH, exec_manage_cli, clean_config_dir, fail_test_if_default_config_dir_exists, TEST_TIMEOUT } = require('../../../system_tests/test_utils');
const { ManageCLIError } = require('../../../../manage_nsfs/manage_nsfs_cli_errors');
const { ManageCLIResponse } = require('../../../../manage_nsfs/manage_nsfs_cli_responses');
const { TYPES, UPGRADE_ACTIONS } = require('../../../../manage_nsfs/manage_nsfs_constants');
const { CONFIG_DIR_PHASES } = require('../../../../sdk/config_fs');

const config_root = path.join(TMP_PATH, 'config_root_cli_upgrade_test');
const config_fs = new ConfigFS(config_root);
const hostname = os.hostname();
const expected_hosts = `${hostname}`;

const old_rpm_expected_system_json = {
    [hostname]: {
        'current_version': '5.16.0',
        'upgrade_history': {
            'successful_upgrades': [{
                'timestamp': 1724687496424,
                'from_version': '5.16.0',
                'to_version': '5.17.0'
            }]
        },
    }
};

const old_expected_system_json = {
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

const old_expected_system_json3 = {
    [hostname]: {
        'current_version': '200',
        'upgrade_history': {
            'successful_upgrades': [{
                'timestamp': 1724687496424,
                'from_version': '700',
                'to_version': '200'
            }]
        },
    }
};

const old_expected_system_json2 = {
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
        'config_dir_version': '1.0.0',
        'upgrade_package_version': '5.18.0',
        'phase': CONFIG_DIR_PHASES.CONFIG_DIR_UNLOCKED,
        'upgrade_history': {
            'successful_upgrades': [
                {
                    'timestamp': 1724687496424,
                    'running_host': hostname,
                    'package_from_version': '5.17.0',
                    'package_to_version': '5.18.0',
                    'config_dir_from_version': '0.0.0',
                    'config_dir_to_version': '1.0.0'
                }]
        }
    }
};

const old_expected_system_json5 = {
    [hostname]: {
        'current_version': pkg.version,
        'upgrade_history': {
            'successful_upgrades': [{
                'timestamp': 1724687496424,
                'from_version': '5.17.0',
                'to_version': pkg.version
            }]
        },
    },
    config_directory: {
        'config_dir_version': '0.0.0',
        'upgrade_package_version': '5.17.0',
        'phase': CONFIG_DIR_PHASES.CONFIG_DIR_UNLOCKED,
        'upgrade_history': {
            'successful_upgrades': [
                {
                    'timestamp': 1724687496424,
                    'running_host': hostname,
                    'package_from_version': '5.16.0',
                    'package_to_version': '5.17.0',
                    'config_dir_from_version': '-1.0.0',
                    'config_dir_to_version': '0.0.0'
                }]
        }
    }
};

const new_expected_system_json = {
    [hostname]: {
        'current_version': pkg.version,
        'upgrade_history': {
            'successful_upgrades': [{
                'timestamp': 1724687496424,
                'from_version': '5.17.0',
                'to_version': pkg.version
            }]
        },
    },
    config_directory: {
        'config_dir_version': '1.0.0',
        'phase': CONFIG_DIR_PHASES.CONFIG_DIR_UNLOCKED,
        'upgrade_history': {
            'successful_upgrades': [
                {
                    'timestamp': 1724687496424,
                    'running_host': hostname,
                    'package_from_version': '5.17.0',
                    'package_to_version': pkg.version,
                    'config_dir_from_version': '0.0.0',
                    'config_dir_to_version': '1.0.0'
                },
                {
                'timestamp': 1724687496424,
                'completed_scripts': [],
                'from_version': '5.16.0',
                'to_version': '5.17.0'
            }]
        }
    }
};

// const new_expected_system_json2 = {
//     [hostname]: {
//         'current_version': '5.16.0',
//         'upgrade_history': {
//             'successful_upgrades': [{
//                 'timestamp': 1724687496424,
//                 'from_version': '5.16.0',
//                 'to_version': '5.17.0'
//             }]
//         },
//     },
//     config_directory: {
//         'config_dir_version': '1',
//         'phase': CONFIG_DIR_PHASES.CONFIG_DIR_UNLOCKED,
//         'upgrade_history': {
//             'successful_upgrades': [
//                 {
//                     'timestamp': 1724687496424,
//                     'running_host': hostname,
//                     'from_version': '5.18.0',
//                     'to_version': '5.18.1',
//                     'config_dir_from_version': '0',
//                     'config_dir_to_version': '1'
//                 },
//                 {
//                 'timestamp': 1724687496424,
//                 'completed_scripts': [],
//                 'from_version': '5.17.0',
//                 'to_version': '5.18.0'
//             }]
//         }
//     }
// };

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
        'config_dir_version': '1',
        'phase': 'CONFIG_DIR_LOCK',
        'in_progress_upgrade': {
            'start_timestamp': 1724687496424,
            'running_host': hostname,
            'package_from_version': '5.18.0',
            'package_to_version': '5.18.1',
            'config_dir_from_version': '0',
            'config_dir_to_version': '1'
        },
        'upgrade_history': {
            'successful_upgrades': [{
                'timestamp': 1724687496424,
                'completed_scripts': [],
                'package_from_version': '5.17.0',
                'package_to_version': '5.18.0'
            }]
        }
    }
};

const invalid_hostname_system_json = {
    [hostname]: {
        'current_version': pkg.version,
        'upgrade_history': {
            'successful_upgrades': [{
                'timestamp': 1724687496424,
                'from_version': '5.17.0',
                'to_version': pkg.version
            }]
        },
    },
    'hostname1': {
        'current_version': pkg.version,
        'upgrade_history': {
            'successful_upgrades': [{
                'timestamp': 1724687496424,
                'from_version': '5.17.0',
                'to_version': pkg.version
            }]
        },
    },
};

describe('noobaa cli - upgrade', () => {
    beforeAll(async () => {
        await fail_test_if_default_config_dir_exists('test_cli_upgrade');
        await fs_utils.create_fresh_path(config.NSFS_NC_DEFAULT_CONF_DIR);
    });

    afterEach(async () => await fs_utils.file_delete(config_fs.system_json_path));

    afterAll(async () => {
        await clean_config_dir(config_fs, config_root);
    }, TEST_TIMEOUT);

    it('upgrade start - should fail on no system', async () => {
        const options = { config_root, expected_version: pkg.version, expected_hosts };
        const res = await exec_manage_cli(TYPES.UPGRADE, UPGRADE_ACTIONS.START, options, true);
        const parsed_res = JSON.parse(res.stdout);
        expect(parsed_res.error.message).toBe(ManageCLIError.UpgradeFailed.message);
        expect(parsed_res.error.cause).toContain('system does not exist');
    });

    it('upgrade start - should fail on no expected_version', async () => {
        await fs_utils.replace_file(config_fs.system_json_path, JSON.stringify(old_rpm_expected_system_json));
        const res = await exec_manage_cli(TYPES.UPGRADE, UPGRADE_ACTIONS.START, { config_root, expected_hosts }, true);
        const parsed_res = JSON.parse(res.stdout);
        expect(parsed_res.error.message).toBe(ManageCLIError.MissingExpectedVersionFlag.message);
    });

    it('upgrade start - should fail on expected_version with wrong type (number instead of string)', async () => {
        await fs_utils.replace_file(config_fs.system_json_path, JSON.stringify(old_rpm_expected_system_json));
        const res = await exec_manage_cli(TYPES.UPGRADE, UPGRADE_ACTIONS.START, { config_root, expected_version: 5, expected_hosts }, true);
        const parsed_res = JSON.parse(res.stdout);
        expect(parsed_res.error.code).toBe(ManageCLIError.InvalidArgumentType.code);
        expect(parsed_res.error.detail).toContain('type of flag expected_version should be string');
    });

    it('upgrade start - should fail on expected_version is a string not in the format on sematic version', async () => {
        await fs_utils.replace_file(config_fs.system_json_path, JSON.stringify(old_rpm_expected_system_json));
        const res = await exec_manage_cli(TYPES.UPGRADE, UPGRADE_ACTIONS.START, { config_root, expected_version: 'invalid-semversion', expected_hosts }, true);
        const parsed_res = JSON.parse(res.stdout);
        expect(parsed_res.error.code).toBe(ManageCLIError.InvalidArgumentType.code);
        expect(parsed_res.error.detail).toContain('expected_version must have sematic version structure');
    });

    it('upgrade start - should fail on expected_version that is later that package version', async () => {
        await fs_utils.replace_file(config_fs.system_json_path, JSON.stringify(old_rpm_expected_system_json));
        const res = await exec_manage_cli(TYPES.UPGRADE, UPGRADE_ACTIONS.START, { config_root, expected_version: '6.18.0', expected_hosts }, true);
        const parsed_res = JSON.parse(res.stdout);
        expect(parsed_res.error.code).toBe(ManageCLIError.UpgradeFailed.code);
        expect(parsed_res.error.cause).toContain('expected_version must match the package version');
    });

    it('upgrade start - should fail on expected_version that is older that package version', async () => {
        await fs_utils.replace_file(config_fs.system_json_path, JSON.stringify(old_rpm_expected_system_json));
        const res = await exec_manage_cli(TYPES.UPGRADE, UPGRADE_ACTIONS.START, { config_root, expected_version: '5.16.0', expected_hosts }, true);
        const parsed_res = JSON.parse(res.stdout);
        expect(parsed_res.error.code).toBe(ManageCLIError.UpgradeFailed.code);
        expect(parsed_res.error.cause).toContain('expected_version must match the package version');
    });

    it('upgrade start - should succeed although missing expected hosts', async () => {
        await fs_utils.replace_file(config_fs.system_json_path, JSON.stringify(old_rpm_expected_system_json));
        const res = await exec_manage_cli(TYPES.UPGRADE, UPGRADE_ACTIONS.START, { config_root, expected_version: pkg.version }, true);
        const parsed_res = JSON.parse(res);
        expect(parsed_res.response.code).toBe(ManageCLIResponse.UpgradeSuccessful.code);
    });

    it('upgrade start - should fail on missing expected_hosts in system.json', async () => {
        await fs_utils.replace_file(config_fs.system_json_path, JSON.stringify(old_rpm_expected_system_json));
        const res = await exec_manage_cli(TYPES.UPGRADE, UPGRADE_ACTIONS.START, { config_root, expected_version: pkg.version, expected_hosts: `${hostname},bla1,bla2` }, true);
        const parsed_res = JSON.parse(res.stdout);
        expect(parsed_res.error.message).toBe(ManageCLIError.UpgradeFailed.message);
        expect(parsed_res.error.cause).toContain('config dir upgrade can not be started - expected_hosts contains one or more hosts that are not specified in system.json hosts_data=');
    });

    it('upgrade start - should succeed although system.json contains extra hosts than specified in expected_hosts', async () => {
        await fs_utils.replace_file(config_fs.system_json_path, JSON.stringify(invalid_hostname_system_json));
        const res = await exec_manage_cli(TYPES.UPGRADE, UPGRADE_ACTIONS.START, { config_root, expected_version: pkg.version, expected_hosts: `${hostname}` }, true);
        const parsed_res = JSON.parse(res);
        expect(parsed_res.response.code).toBe(ManageCLIResponse.UpgradeSuccessful.code);
    });

    it('upgrade start - should succeed although on missing system.json hosts in expected_hosts with comma', async () => {
        // we set intentionally comma at the end so we will test we know how to parse it
        await fs_utils.replace_file(config_fs.system_json_path, JSON.stringify(invalid_hostname_system_json));
        const res = await exec_manage_cli(TYPES.UPGRADE, UPGRADE_ACTIONS.START, { config_root, expected_version: pkg.version, expected_hosts: `${hostname},` }, true);
        const parsed_res = JSON.parse(res);
        expect(parsed_res.response.code).toBe(ManageCLIResponse.UpgradeSuccessful.code);
    });

    it('upgrade start - should fail expected_version invalid', async () => {
        await fs_utils.replace_file(config_fs.system_json_path, JSON.stringify(old_rpm_expected_system_json));
        const expected_version = '5.16.0';
        const res = await exec_manage_cli(TYPES.UPGRADE, UPGRADE_ACTIONS.START, { config_root, expected_version, expected_hosts }, true);
        const parsed_res = JSON.parse(res.stdout);
        expect(parsed_res.error.message).toBe(ManageCLIError.UpgradeFailed.message);
        expect(parsed_res.error.cause).toContain(`expected_version must match the package version`);
    });

    it('upgrade start - should fail on old rpm version', async () => {
        await fs_utils.replace_file(config_fs.system_json_path, JSON.stringify(old_rpm_expected_system_json));
        const options = { config_root, expected_version: pkg.version, expected_hosts };
        const res = await exec_manage_cli(TYPES.UPGRADE, UPGRADE_ACTIONS.START, options, true);
        const parsed_res = JSON.parse(res.stdout);
        expect(parsed_res.error.message).toBe(ManageCLIError.UpgradeFailed.message);
        expect(parsed_res.error.cause).toContain('config dir upgrade can not be started until all expected hosts have the expected version');
    });

    it('upgrade start - should fail - RPM version is higher than source code version', async () => {
        await fs_utils.replace_file(config_fs.system_json_path, JSON.stringify(old_expected_system_json3));
        const system_data_before_upgrade = await config_fs.get_system_config_file();
        const options = { config_root, expected_version: pkg.version, expected_hosts };
        const res = await exec_manage_cli(TYPES.UPGRADE, UPGRADE_ACTIONS.START, options, true);
        const parsed_res = JSON.parse(res.stdout);
        expect(parsed_res.error.code).toBe(ManageCLIError.UpgradeFailed.code);
        expect(parsed_res.error.cause).toContain('config dir upgrade can not be started until all expected hosts have the expected');
        const system_data_after_upgrade = await config_fs.get_system_config_file();
        // check that in the hostname section nothing changed
        expect(system_data_before_upgrade[hostname]).toStrictEqual(system_data_after_upgrade[hostname]);
        expect(system_data_after_upgrade.config_directory).toBeUndefined();
    });

    it('upgrade start - should fail - same version, nothing to upgrade - config directory property exists', async () => {
        await fs_utils.replace_file(config_fs.system_json_path, JSON.stringify(old_expected_system_json2));
        const system_data_before_upgrade = await config_fs.get_system_config_file();
        const options = { config_root, expected_version: pkg.version, expected_hosts };
        const res = await exec_manage_cli(TYPES.UPGRADE, UPGRADE_ACTIONS.START, options, true);
        const parsed_res = JSON.parse(res.stdout);
        expect(parsed_res.error.message).toBe(ManageCLIError.UpgradeFailed.message);
        expect(parsed_res.error.cause).toContain(`config_dir_version on system.json and config_fs.config_dir_version match, nothing to upgrade`);
        const system_data_after_upgrade = await config_fs.get_system_config_file();
        // check that in the hostname section nothing changed
        expect(system_data_before_upgrade[hostname]).toStrictEqual(system_data_after_upgrade[hostname]);
    });

    it('upgrade start - should succeed - no old config directory', async () => {
        await fs_utils.replace_file(config_fs.system_json_path, JSON.stringify(old_expected_system_json));
        const system_data_before_upgrade = await config_fs.get_system_config_file();
        const options = { config_root, expected_version: pkg.version, expected_hosts };
        const res = await exec_manage_cli(TYPES.UPGRADE, UPGRADE_ACTIONS.START, options, true);
        const parsed_res = JSON.parse(res);
        expect(parsed_res.response.code).toBe(ManageCLIResponse.UpgradeSuccessful.code);
        const system_data_after_upgrade = await config_fs.get_system_config_file();
        assert_config_dir_upgrade(system_data_before_upgrade, system_data_after_upgrade);
    });

    it('upgrade start - should succeed - old config directory exists', async () => {
        await fs_utils.replace_file(config_fs.system_json_path, JSON.stringify(old_expected_system_json5));
        const system_data_before_upgrade = await config_fs.get_system_config_file();
        const options = { config_root, expected_version: pkg.version, expected_hosts };
        const res = await exec_manage_cli(TYPES.UPGRADE, UPGRADE_ACTIONS.START, options, true);
        const parsed_res = JSON.parse(res);
        expect(parsed_res.response.code).toBe(ManageCLIResponse.UpgradeSuccessful.code);
        const system_data_after_upgrade = await config_fs.get_system_config_file();
        assert_config_dir_upgrade(system_data_before_upgrade, system_data_after_upgrade);
    });

    it('upgrade start - should succeed - old config directory missing', async () => {
        await fs_utils.replace_file(config_fs.system_json_path, JSON.stringify(old_expected_system_json));
        const system_data_before_upgrade = await config_fs.get_system_config_file();
        const options = { config_root, expected_version: pkg.version, expected_hosts };
        const res = await exec_manage_cli(TYPES.UPGRADE, UPGRADE_ACTIONS.START, options, true);
        const parsed_res = JSON.parse(res);
        expect(parsed_res.response.code).toBe(ManageCLIResponse.UpgradeSuccessful.code);
        const system_data_after_upgrade = await config_fs.get_system_config_file();
        assert_config_dir_upgrade(system_data_before_upgrade, system_data_after_upgrade);
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

/**
 * assert_upgrade assert that -
 * 1. hosts data was not changed
 * 2. config_directory data properties were upgraded - 
 *    2.1. config_dir_version
 *    2.2. phase
 * 3. config_directory.successful_upgrades is updated - 
 *    3.1. running_host
 *    3.2. from_version
 *    3.3. to_version
 *    3.4. config_dir_from_version
 *    3.5. config_dir_to_version
 * @param {Object} system_data_before_upgrade
 * @param {Object} system_data_after_upgrade
 */
function assert_config_dir_upgrade(system_data_before_upgrade, system_data_after_upgrade) {
    // check that in the hostname section nothing changed
    expect(system_data_before_upgrade[hostname]).toStrictEqual(system_data_after_upgrade[hostname]);
    const actual_config_directory = system_data_after_upgrade.config_directory;
    const expected_config_directory = new_expected_system_json.config_directory;

    expect(actual_config_directory.config_dir_version).toBe(expected_config_directory.config_dir_version);
    expect(actual_config_directory.phase).toBe(expected_config_directory.phase);
    const actual_upgrade = system_data_after_upgrade.config_directory.upgrade_history.successful_upgrades[0];
    const expected_upgrade = new_expected_system_json.config_directory.upgrade_history.successful_upgrades[0];
    expect(actual_upgrade.running_host).toBe(expected_upgrade.running_host);
    expect(actual_upgrade.package_from_version).toBe(expected_upgrade.package_from_version);
    expect(actual_upgrade.package_to_version).toBe(expected_upgrade.package_to_version);
    expect(actual_upgrade.config_dir_from_version).toBe(expected_upgrade.config_dir_from_version);
    expect(actual_upgrade.config_dir_to_version).toBe(expected_upgrade.config_dir_to_version);
}
