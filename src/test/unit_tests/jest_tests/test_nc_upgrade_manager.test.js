/* Copyright (C) 2016 NooBaa */
/*eslint max-lines-per-function: ["error", 1300]*/
'use strict';

// disabling init_rand_seed as it takes longer than the actual test execution
process.env.DISABLE_INIT_RANDOM_SEED = 'true';

const fs = require('fs');
const os = require('os');
const util = require('util');
const _ = require('lodash');
const path = require('path');
const fs_utils = require('../../../util/fs_utils');
const config = require('../../../../config');
const pkg = require('../../../../package.json');
const { NCUpgradeManager, DEFAULT_NC_UPGRADE_SCRIPTS_DIR, OLD_DEFAULT_PACKAGE_VERSION,
    OLD_DEFAULT_CONFIG_DIR_VERSION } = require('../../../upgrade/nc_upgrade_manager');
const { ConfigFS, CONFIG_DIR_PHASES } = require('../../../sdk/config_fs');
const { TMP_PATH, create_redirect_file, create_config_dir,
    fail_test_if_default_config_dir_exists, clean_config_dir, TEST_TIMEOUT } = require('../../system_tests/test_utils');

const config_root = path.join(TMP_PATH, 'config_root_nc_upgrade_manager_test');
const config_fs = new ConfigFS(config_root);
const hostname = os.hostname();

const dummy_upgrade_script_1 =
`/* Copyright (C) 2024 NooBaa */
'use strict';
async function run() {
    console.log('script number 1');
}
module.exports = {
    run,
    description: 'dummy upgrade script file 1'
};
`;
const dummy_upgrade_script_2 =
`/* Copyright (C) 2024 NooBaa */
'use strict';
async function run() {
    console.log('script number 2');
}
module.exports = {
    run,
    description: 'dummy upgrade script file 2'
};`;

const dummy_failing_upgrade_script_3 =
`/* Copyright (C) 2024 NooBaa */
'use strict';
async function run() {
    console.log('script number 3');
    throw new Error('script number 3 failed')
}
module.exports = {
    run,
    description: 'dummy upgrade script file 1'
};
`;
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

const old_expected_system_json_has_config_directory = {
    [hostname]: {
        'current_version': '5.18.1',
        'upgrade_history': {
            'successful_upgrades': [{
                'timestamp': 1724687496424,
                'from_version': '5.18.0',
                'to_version': '5.18.1'
            }]
        },
    },
    config_directory: {
        'config_dir_version': '1.0.0',
        'upgrade_package_version': '5.18.0',
        'phase': CONFIG_DIR_PHASES.CONFIG_DIR_UNLOCKED,
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

// invalid system.json
const current_expected_system_json_no_upgrade_history = {
    [hostname]: {
        'current_version': pkg.version,
    }
};

// invalid system.json
const current_expected_system_json_invalid_hostname = {
    'invalid_hostname': {
        'current_version': pkg.version,
        'upgrade_history': {
            'successful_upgrades': []
        },
    }
};

const old_expected_system_json_empty_successful_upgrades = {
    [hostname]: {
        'current_version': '5.18.1',
        'upgrade_history': {
            'successful_upgrades': [{
                'timestamp': 1724687496424,
                'from_version': '5.18.0',
                'to_version': '5.18.1'
            }]
        },
    },
    config_directory: {
        'config_dir_version': '1',
        'phase': CONFIG_DIR_PHASES.CONFIG_DIR_UNLOCKED,
        'upgrade_history': {
            'successful_upgrades': []
        }
    }
};


// WARNING:
// The following test file will check the directory structure created using create_config_dirs_if_missing()
// which is called when using noobaa-cli, for having an accurate test, it'll be blocked from running on an 
// env having an existing default config directory and the test executer will be asked to remove the default 
// config directory before running the test again, do not run on production env or on any env where the existing config directory is being used
describe('nc upgrade manager - upgrade RPM', () => {
    let nc_upgrade_manager;
    beforeAll(async () => {
        await fail_test_if_default_config_dir_exists('test_config_dir_nc_upgrade_manager', config_fs);
    });

    beforeEach(async () => {
        await create_config_dir(config.NSFS_NC_DEFAULT_CONF_DIR);
        await create_config_dir(config_root);
        await create_redirect_file(config_fs, config_root);
        nc_upgrade_manager = new NCUpgradeManager(config_fs);
    });

    afterEach(async () => {
        await clean_config_dir(config_fs, config_root);
    }, TEST_TIMEOUT);

    it('upgrade rpm - nothing to upgrade - no changes in system.json', async () => {
        await config_fs.create_system_config_file(JSON.stringify(current_expected_system_json));
        await nc_upgrade_manager.update_rpm_upgrade(config_fs);
        const system_data_after_upgrade_run = await config_fs.get_system_config_file();
        expect(current_expected_system_json).toStrictEqual(system_data_after_upgrade_run);
    });

    it('upgrade rpm - nothing to upgrade - no changes in system.json - no successful upgrades', async () => {
        await config_fs.create_system_config_file(JSON.stringify(current_expected_system_json_no_successful_upgrades));
        await nc_upgrade_manager.update_rpm_upgrade(config_fs);
        const system_data_after_upgrade_run = await config_fs.get_system_config_file();
        expect(current_expected_system_json_no_successful_upgrades).toStrictEqual(system_data_after_upgrade_run);
    });

    it('upgrade status - RPM was upgraded, should update system.json', async () => {
        await config_fs.create_system_config_file(JSON.stringify(old_expected_system_json));
        await nc_upgrade_manager.update_rpm_upgrade(config_fs);
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
        await nc_upgrade_manager.update_rpm_upgrade(config_fs);
        const system_data_after_upgrade_run = await config_fs.get_system_config_file();
        const new_version = pkg.version;
        const host_data_after_upgrade = system_data_after_upgrade_run[hostname];
        expect(host_data_after_upgrade.current_version).toStrictEqual(new_version);
        expect(host_data_after_upgrade.upgrade_history.successful_upgrades[0].from_version).toStrictEqual(
            old_expected_system_json_no_successful_upgrades[hostname].current_version);
        expect(host_data_after_upgrade.upgrade_history.successful_upgrades[0].to_version).toStrictEqual(new_version);
    });
});

describe('nc upgrade manager - upgrade config directory', () => {
    let nc_upgrade_manager;

    beforeAll(async () => {
        nc_upgrade_manager = new NCUpgradeManager(config_fs);
        await fail_test_if_default_config_dir_exists('test_config_dir_nc_upgrade_manager', config_fs);
    });

    afterEach(async () => {
        await clean_config_dir(config_fs, config_root);
    }, TEST_TIMEOUT);

    describe('nc upgrade manager - config_directory_defaults', () => {

        it('config_directory_defaults - hostname from_version exists - 5.16.0', () => {
            const system_data = old_expected_system_json;
            const config_dir_defaults = nc_upgrade_manager.config_directory_defaults(system_data);
            assert_config_dir_defaults(config_dir_defaults, system_data);
        });

        it('config_directory_defaults - hostname from_version exists - 5.17.0', () => {
            const system_data = current_expected_system_json;
            const config_dir_defaults = nc_upgrade_manager.config_directory_defaults(system_data);
            assert_config_dir_defaults(config_dir_defaults, system_data);
        });

        it('config_directory_defaults - missing hostname successful_upgrades', () => {
            const system_data = current_expected_system_json_no_successful_upgrades;
            const config_dir_defaults = nc_upgrade_manager.config_directory_defaults(system_data);
            assert_config_dir_defaults(config_dir_defaults, system_data);
        });

        it('config_directory_defaults - missing hostname upgrade_history', () => {
            const system_data = current_expected_system_json_no_upgrade_history;
            const config_dir_defaults = nc_upgrade_manager.config_directory_defaults(system_data);
            assert_config_dir_defaults(config_dir_defaults, system_data);
        });

        it('config_directory_defaults - missing hostname', () => { // should throw
            const system_data = current_expected_system_json_invalid_hostname;
            const config_dir_defaults = nc_upgrade_manager.config_directory_defaults(system_data);
            assert_config_dir_defaults(config_dir_defaults, system_data);
        });
    });

    describe('nc upgrade manager - _verify_config_dir_upgrade', () => {
        it('_verify_config_dir_upgrade - empty hosts system_data', async () => {
            const system_data = {};
            const expected_err_msg = 'config dir upgrade can not be started missing hosts_data hosts_data={}';
            await expect(nc_upgrade_manager._verify_config_dir_upgrade(system_data, pkg.version, [hostname]))
                .rejects.toThrow(expected_err_msg);
        });

        it('_verify_config_dir_upgrade - empty host current_version', async () => {
            const system_data = { [hostname]: []};
            const expected_err_msg = `config dir upgrade can not be started until all expected hosts have the expected version=${pkg.version}, host=${hostname} host's current_version=undefined`;
            await expect(nc_upgrade_manager._verify_config_dir_upgrade(system_data, pkg.version, [hostname]))
                .rejects.toThrow(expected_err_msg);
        });

        it('_verify_config_dir_upgrade - host current_version < new_version should upgrade RPM', async () => {
            const old_version = '5.16.0';
            const system_data = { [hostname]: { current_version: old_version }, other_hostname: { current_version: pkg.version } };
            const expected_err_msg = `config dir upgrade can not be started until all expected hosts have the expected version=${pkg.version}, host=${hostname} host's current_version=${old_version}`;
            await expect(nc_upgrade_manager._verify_config_dir_upgrade(system_data, pkg.version, [hostname, 'other_hostname']))
                .rejects.toThrow(expected_err_msg);
        });

        it('_verify_config_dir_upgrade - host current_version > new_version should upgrade RPM', async () => {
            const newer_version = pkg.version + '.1';
            const system_data = { [hostname]: { current_version: newer_version }, other_hostname: { current_version: pkg.version } };
            const expected_err_msg = `config dir upgrade can not be started until all expected hosts have the expected version=${pkg.version}, host=${hostname} host's current_version=${newer_version}`;
            await expect(nc_upgrade_manager._verify_config_dir_upgrade(system_data, pkg.version, [hostname, 'other_hostname']))
                .rejects.toThrow(expected_err_msg);
        });

        it('_verify_config_dir_upgrade - should upgrade config dir', async () => {
            const expected_version = pkg.version;
            const system_data = {
                [hostname]: { current_version: pkg.version }
            };
            await nc_upgrade_manager._verify_config_dir_upgrade(system_data, expected_version, [hostname]);
        });

        it('_verify_config_dir_upgrade - fail on mismatch expected_version', async () => {
            const expected_version = pkg.version + '.1';
            const system_data = { [hostname]: { current_version: pkg.version, other_hostname: { current_version: pkg.version } }};
            const nc_upgrade_manager_higher_version = new NCUpgradeManager(config_fs);
            const expected_err_msg = `config dir upgrade can not be started - the host's package version=${pkg.version} does not match the user's expected version=${expected_version}`;
            await expect(nc_upgrade_manager_higher_version._verify_config_dir_upgrade(system_data, expected_version, [hostname]))
                .rejects.toThrow(expected_err_msg);
        });

        it('fail on already in progress upgrade', async () => {
            const expected_version = pkg.version;
            const system_data = {
                [hostname]: { current_version: pkg.version },
                config_directory: { in_progress_upgrade: { from_version: 'mock-version' } }
            };
            const expected_err_msg = `config dir upgrade can not be started - there is already an ongoing upgrade system_data.config_directory.in_progess_upgrade=${util.inspect(system_data.config_directory.in_progress_upgrade)}`;
            await expect(nc_upgrade_manager._verify_config_dir_upgrade(system_data, expected_version, [hostname]))
                .rejects.toThrow(expected_err_msg);
        });
    });

    describe('nc upgrade manager - _run_nc_upgrade_scripts', () => {
        const from_version = '0.0.0';
        const to_version = '0.0.9-test-nc-upgrade-manager';
        const custom_upgrade_scripts_dir = path.join(TMP_PATH, 'custom_upgrade_scripts_dir');
        const custom_upgrade_scripts_dir_version_path = path.join(TMP_PATH, 'custom_upgrade_scripts_dir', to_version);
        const default_upgrade_script_dir_version_path = path.join(DEFAULT_NC_UPGRADE_SCRIPTS_DIR, to_version);
        const successful_upgrade_scripts_obj = { dummy_upgrade_script_1, dummy_upgrade_script_2 };
        const failing_upgrade_scripts_obj = { ...successful_upgrade_scripts_obj, dummy_failing_upgrade_script_3 };
        const default_this_upgrade = Object.freeze({
            config_dir_from_version: from_version, config_dir_to_version: to_version,
            completed_scripts: []
        });
        const default_upgrade_script_paths = Object.keys(successful_upgrade_scripts_obj).map(script_name =>
            get_upgrade_script_path(DEFAULT_NC_UPGRADE_SCRIPTS_DIR, to_version, script_name));
        const custom_upgrade_script_paths = Object.keys(successful_upgrade_scripts_obj).map(script_name =>
            get_upgrade_script_path(custom_upgrade_scripts_dir, to_version, script_name));

        const nc_upgrade_manager_custom_dir = new NCUpgradeManager(config_fs, { custom_upgrade_scripts_dir });

        beforeEach(async () => {
            await fs_utils.create_path(custom_upgrade_scripts_dir_version_path, config.BASE_MODE_DIR);

            try {
                await fs_utils.create_path(DEFAULT_NC_UPGRADE_SCRIPTS_DIR, config.BASE_MODE_DIR);
                await fs_utils.create_path(default_upgrade_script_dir_version_path, config.BASE_MODE_DIR);
            } catch (err) {
                console.log('couldnt create upgrade scripts dir err', default_upgrade_script_dir_version_path, err);
            }
        });

        afterEach(async () => {
            await fs_utils.folder_delete(custom_upgrade_scripts_dir_version_path);
            await fs_utils.folder_delete(custom_upgrade_scripts_dir);
            await fs_utils.folder_delete(default_upgrade_script_dir_version_path);
        });

        it('_run_nc_upgrade_scripts - no scripts', async () => {
            const this_upgrade = _.cloneDeep(default_this_upgrade);
            await nc_upgrade_manager._run_nc_upgrade_scripts(this_upgrade);
            expect(this_upgrade.completed_scripts).toEqual([]);
        });

        it('_run_nc_upgrade_scripts - custom_upgrade_scripts_dir - no upgrade scripts dir', async () => {
            const this_upgrade = _.cloneDeep(default_this_upgrade);
            await fs_utils.folder_delete(custom_upgrade_scripts_dir_version_path);
            await fs_utils.folder_delete(custom_upgrade_scripts_dir);
            await nc_upgrade_manager_custom_dir._run_nc_upgrade_scripts(this_upgrade);
            expect(this_upgrade.completed_scripts).toEqual([]);
        });

        it('_run_nc_upgrade_scripts - custom_upgrade_scripts_dir - successful scripts', async () => {
            await populate_upgrade_scripts_dir(custom_upgrade_scripts_dir, to_version, successful_upgrade_scripts_obj);
            const this_upgrade = _.cloneDeep(default_this_upgrade);
            await nc_upgrade_manager_custom_dir._run_nc_upgrade_scripts(this_upgrade);
            expect(this_upgrade.completed_scripts).toEqual(custom_upgrade_script_paths);
        });

        it('_run_nc_upgrade_scripts - custom_upgrade_scripts_dir - failing scripts', async () => {
            await populate_upgrade_scripts_dir(custom_upgrade_scripts_dir, to_version, failing_upgrade_scripts_obj);
            const this_upgrade = _.cloneDeep(default_this_upgrade);
            const expected_err_msg = '_run_nc_upgrade_scripts: nc upgrade manager failed!!!, Error: script number 3 failed';
            await expect(nc_upgrade_manager_custom_dir._run_nc_upgrade_scripts(this_upgrade)).rejects.toThrow(expected_err_msg);
            expect(this_upgrade.completed_scripts).toEqual([]);
            expect(this_upgrade.error).toContain('Error: script number 3 failed');
        });

        it('_run_nc_upgrade_scripts - default upgrade scripts dir - successful scripts', async () => {
            await populate_upgrade_scripts_dir(DEFAULT_NC_UPGRADE_SCRIPTS_DIR, to_version, successful_upgrade_scripts_obj);
            const this_upgrade = _.cloneDeep(default_this_upgrade);
            await nc_upgrade_manager._run_nc_upgrade_scripts(this_upgrade);
            expect(this_upgrade.completed_scripts).toEqual(default_upgrade_script_paths);
            await delete_upgrade_scripts(DEFAULT_NC_UPGRADE_SCRIPTS_DIR, to_version, successful_upgrade_scripts_obj);
        });

        it('_run_nc_upgrade_scripts - default upgrade scripts dir - failing scripts', async () => {
            await populate_upgrade_scripts_dir(DEFAULT_NC_UPGRADE_SCRIPTS_DIR, to_version, failing_upgrade_scripts_obj);
            const this_upgrade = _.cloneDeep(default_this_upgrade);
            const expected_err_msg = '_run_nc_upgrade_scripts: nc upgrade manager failed!!!, Error: script number 3 failed';
            await expect(nc_upgrade_manager._run_nc_upgrade_scripts(this_upgrade)).rejects.toThrow(expected_err_msg);
            expect(this_upgrade.completed_scripts).toEqual([]);
            expect(this_upgrade.error).toContain('Error: script number 3 failed');
            await delete_upgrade_scripts(DEFAULT_NC_UPGRADE_SCRIPTS_DIR, to_version, failing_upgrade_scripts_obj);
        });
    });

    describe('nc upgrade manager - _update_config_dir_upgrade_start', () => {

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
        }, TEST_TIMEOUT);

        it('_update_config_dir_upgrade_start - system_data doesn\'t contain old config_directory data', async () => {
            const system_data = old_expected_system_json;
            const options = {
                config_dir_from_version: '0.0.0',
                config_dir_to_version: '0.0.9-test-nc-upgrade-manager',
                package_from_version: '5.16.0',
                package_to_version: '5.17.0',
            };
            await config_fs.create_system_config_file(JSON.stringify(system_data));
            const upgrade_start_data = await nc_upgrade_manager._update_config_dir_upgrade_start(system_data, options);
            const expected_data = {
                ...system_data,
                config_directory: {
                    config_dir_version: options.config_dir_from_version,
                    upgrade_package_version: options.package_from_version,
                    in_progress_upgrade: {
                        completed_scripts: [],
                        running_host: hostname,
                        ...options
                    }
                }
            };
            assert_upgrade_start_data(upgrade_start_data, expected_data);
            const system_json_data = await config_fs.get_system_config_file();
            assert_upgrade_start_data(system_json_data, expected_data);
        });

        it('_update_config_dir_upgrade_start - system_data contains old config_directory data', async () => {
            const system_data = old_expected_system_json_has_config_directory;
            const options = {
                config_dir_from_version: old_expected_system_json_has_config_directory.config_directory.config_dir_version,
                config_dir_to_version: '2.0.0',
                package_from_version: old_expected_system_json_has_config_directory.config_directory.upgrade_package_version,
                package_to_version: '5.18.1',
            };
            await config_fs.create_system_config_file(JSON.stringify(system_data));

            const upgrade_start_data = await nc_upgrade_manager._update_config_dir_upgrade_start(system_data, options);
            system_data.config_directory.in_progress_upgrade = {
                completed_scripts: [],
                running_host: hostname,
                    ...options
            };
            assert_upgrade_start_data(upgrade_start_data, system_data);
            const system_json_data = await config_fs.get_system_config_file();
            assert_upgrade_start_data(system_json_data, system_data);
        });
    });

    describe('nc upgrade manager - _update_config_dir_upgrade_finish', () => {

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
        }, TEST_TIMEOUT);

        it('_update_config_dir_upgrade_finish - system_data doesn\'t contain old successful_upgrades data', async () => {
            const system_data = _.cloneDeep(old_expected_system_json_empty_successful_upgrades);
            const this_upgrade = {
                timestamp: 1714687496424,
                running_host: hostname,
                completed_scripts: [],
                config_dir_from_version: '1.0.0',
                config_dir_to_version: '2.0.0',
                package_from_version: '5.18.0',
                package_to_version: '5.18.1',
            };
            await config_fs.create_system_config_file(JSON.stringify(system_data));
            await nc_upgrade_manager._update_config_dir_upgrade_finish(system_data, this_upgrade);
            const expected_data = {
                ...system_data,
                config_directory: {
                    phase: CONFIG_DIR_PHASES.CONFIG_DIR_UNLOCKED,
                    config_dir_version: this_upgrade.config_dir_to_version,
                    upgrade_package_version: this_upgrade.package_to_version,
                    upgrade_history: {
                        successful_upgrades: [this_upgrade]
                    }
                }
            };
            const system_json_data = await config_fs.get_system_config_file();
            assert_upgrade_finish_or_fail_data(system_json_data, expected_data);
        });

        it('_update_config_dir_upgrade_finish - system_data contains old successful_upgrades and last_failure data', async () => {
            const system_data = _.cloneDeep(old_expected_system_json_empty_successful_upgrades);
            system_data.config_directory.upgrade_history.successful_upgrades = [{
                'timestamp': 1724687496424,
                'completed_scripts': [],
                'package_from_version': '5.17.0',
                'package_to_version': '5.18.0'
            }];
            system_data.config_directory.upgrade_history.last_failure = {
                'timestamp': 1714687496424,
                'running_host': hostname,
                'completed_scripts': [],
                'config_dir_from_version': '0.0.0',
                'config_dir_to_version': '0.0.9-test-nc-upgrade-manager',
                'package_from_version': '5.17.0',
                'package_to_version': '5.18.0',
                'error': new Error('this is a last failure error').stack
            };
            const this_upgrade = {
                timestamp: 1714687496424,
                running_host: hostname,
                completed_scripts: [],
                config_dir_from_version: '1.0.0',
                config_dir_to_version: '2.0.0',
                package_from_version: '5.18.0',
                package_to_version: '5.18.1',
            };
            await config_fs.create_system_config_file(JSON.stringify(system_data));

            await nc_upgrade_manager._update_config_dir_upgrade_finish(system_data, this_upgrade);
            const expected_data = {
                ...system_data,
                config_directory: {
                    phase: CONFIG_DIR_PHASES.CONFIG_DIR_UNLOCKED,
                    config_dir_version: this_upgrade.config_dir_to_version,
                    upgrade_package_version: this_upgrade.package_to_version,
                    upgrade_history: {
                        last_failure: system_data.config_directory.upgrade_history.last_failure,
                        successful_upgrades: [this_upgrade, ...system_data.config_directory.upgrade_history.successful_upgrades]
                    }
                }
            };
            const system_json_data = await config_fs.get_system_config_file();
            assert_upgrade_finish_or_fail_data(system_json_data, expected_data);
        });
    });

    describe('nc upgrade manager - _update_config_dir_upgrade_failed', () => {

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
        }, TEST_TIMEOUT);

        it('_update_config_dir_upgrade_failed - system_data doesn\'t contain old upgrade_history data', async () => {
            const system_data = _.cloneDeep(old_expected_system_json_empty_successful_upgrades);
            const this_upgrade = {
                timestamp: 1714687496424,
                running_host: hostname,
                completed_scripts: [],
                config_dir_from_version: system_data.config_directory.config_dir_version,
                config_dir_to_version: '2.0.0',
                package_from_version: '5.18.0',
                package_to_version: '5.18.1',
            };
            system_data.config_directory.phase = CONFIG_DIR_PHASES.CONFIG_DIR_LOCKED;
            const new_error = new Error('this is a new last failure error');
            await config_fs.create_system_config_file(JSON.stringify(system_data));
            await nc_upgrade_manager._update_config_dir_upgrade_failed(system_data, this_upgrade, new_error);
            const expected_data = {
                ...system_data,
                config_directory: {
                    phase: CONFIG_DIR_PHASES.CONFIG_DIR_LOCKED,
                    config_dir_version: system_data.config_directory.config_dir_version,
                    upgrade_package_version: system_data.config_directory.upgrade_package_version,
                    upgrade_history: {
                        last_failure: { ...this_upgrade, error: new_error.stack },
                        successful_upgrades: []
                    }
                }
            };
            const system_json_data = await config_fs.get_system_config_file();
            assert_upgrade_finish_or_fail_data(system_json_data, expected_data);
        });

        it('_update_config_dir_upgrade_failed - system_data contains old successful_upgrades and last_failure data', async () => {
            const system_data = _.cloneDeep(old_expected_system_json_empty_successful_upgrades);
            system_data.config_directory.upgrade_history.successful_upgrades = [{
                'timestamp': 1724687496424,
                'completed_scripts': [],
                'package_from_version': '5.17.0',
                'package_to_version': '5.18.0'
            }];
            system_data.config_directory.phase = CONFIG_DIR_PHASES.CONFIG_DIR_LOCKED;
            system_data.config_directory.upgrade_history.last_failure = {
                'timestamp': 1714687496424,
                'running_host': hostname,
                'completed_scripts': [],
                'config_dir_from_version': '0.0.0',
                'config_dir_to_version': '0.0.9-test-nc-upgrade-manager',
                'package_from_version': '5.17.0',
                'package_to_version': '5.18.0',
                'error': new Error('this is a last failure error').stack
            };
            const this_upgrade = {
                timestamp: 1714687496424,
                running_host: hostname,
                completed_scripts: [],
                config_dir_from_version: '1.0.0',
                config_dir_to_version: '2.0.0',
                package_from_version: '5.18.0',
                package_to_version: '5.18.1'
            };
            await config_fs.create_system_config_file(JSON.stringify(system_data));
            const new_error = new Error('this is a new last failure error');
            await nc_upgrade_manager._update_config_dir_upgrade_failed(system_data, this_upgrade, new_error);
            const expected_data = {
                ...system_data,
                config_directory: {
                    phase: CONFIG_DIR_PHASES.CONFIG_DIR_LOCKED,
                    config_dir_version: system_data.config_directory.config_dir_version,
                    upgrade_package_version: system_data.config_directory.upgrade_package_version,
                    upgrade_history: {
                        last_failure: { ...this_upgrade, error: new_error.stack },
                        successful_upgrades: system_data.config_directory.upgrade_history.successful_upgrades
                    }
                }
            };
            const system_json_data = await config_fs.get_system_config_file();
            assert_upgrade_finish_or_fail_data(system_json_data, expected_data);
        });
    });
});

/**
 * assert_upgrade_start_data asserts that 
 * 1. the expected upgrade start properties in the system_data matches the actual system_data written to system.json
 * 2. the expected upgrade start properties in the system_data matches the return value
 * @param {Object} actual_upgrade_start 
 * @param {Object} expected_system_data 
 */
function assert_upgrade_start_data(actual_upgrade_start, expected_system_data) {
    const { config_dir_version, upgrade_package_version, phase, upgrade_history, in_progress_upgrade, current_version } =
        actual_upgrade_start.config_directory;
    const expected_in_progress_upgrade = expected_system_data.config_directory?.in_progress_upgrade;

    expect(phase).toBe(CONFIG_DIR_PHASES.CONFIG_DIR_LOCKED);
    expect(config_dir_version).toBe(expected_system_data.config_directory?.config_dir_version);
    expect(upgrade_package_version).toBe(expected_system_data.config_directory?.upgrade_package_version);
    expect(upgrade_history).toEqual(expected_system_data.config_directory?.upgrade_history);
    expect(current_version).toEqual(expected_system_data.config_directory?.current_version);

    expect(in_progress_upgrade.completed_scripts).toEqual(expected_in_progress_upgrade?.completed_scripts);
    expect(in_progress_upgrade.running_host).toEqual(expected_in_progress_upgrade?.running_host);
    expect(in_progress_upgrade.config_dir_from_version).toEqual(expected_in_progress_upgrade?.config_dir_from_version);
    expect(in_progress_upgrade.config_dir_to_version).toEqual(expected_in_progress_upgrade?.config_dir_to_version);
    expect(in_progress_upgrade.package_from_version).toEqual(expected_in_progress_upgrade?.package_from_version);
    expect(in_progress_upgrade.package_to_version).toEqual(expected_in_progress_upgrade?.package_to_version);

    expect(actual_upgrade_start[hostname]).toEqual(expected_system_data[hostname]);
}

/**
 * assert_upgrade_finish_or_fail_data asserts that 
 * 1. the expected system_data properties in the system_data matches the actual system_data written to system.json
 * @param {Object} actual_system_data
 * @param {Object} expected_system_data 
 */
function assert_upgrade_finish_or_fail_data(actual_system_data, expected_system_data) {
    const { config_dir_version, upgrade_package_version, phase, upgrade_history, in_progress_upgrade, current_version } =
        actual_system_data.config_directory;

    expect(phase).toBe(expected_system_data.config_directory?.phase);
    expect(config_dir_version).toBe(expected_system_data.config_directory?.config_dir_version);
    expect(upgrade_package_version).toBe(expected_system_data.config_directory?.upgrade_package_version);
    expect(upgrade_history).toStrictEqual(expected_system_data.config_directory?.upgrade_history);
    expect(current_version).toEqual(expected_system_data.config_directory?.current_version);

    expect(in_progress_upgrade).toEqual(undefined);
    expect(actual_system_data[hostname]).toEqual(expected_system_data[hostname]);
}

/**
 * assert_config_dir_defaults asserts that the expected config dir properties in the system_data matches the actual config dir defaults
 * @param {Object} actual_config_dir_defaults 
 * @param {Object} system_data 
 */
function assert_config_dir_defaults(actual_config_dir_defaults, system_data) {
    const { config_dir_version, upgrade_package_version, phase, upgrade_history } = actual_config_dir_defaults;
    const expected_package_from_version = system_data?.[hostname]?.upgrade_history?.successful_upgrades?.[0]?.from_version ||
        OLD_DEFAULT_PACKAGE_VERSION;
    expect(config_dir_version).toBe(OLD_DEFAULT_CONFIG_DIR_VERSION);
    expect(upgrade_package_version).toBe(expected_package_from_version);
    expect(phase).toBe(CONFIG_DIR_PHASES.CONFIG_DIR_UNLOCKED);
    expect(upgrade_history).toEqual({ successful_upgrades: [] });
}

/**
 * populate_upgrade_scripts_dir created all upgrade scripts based on the patameters
 * @param {String} upgrade_scripts_dir 
 * @param {String} version 
 * @param {Object} scripts_obj 
 */
async function populate_upgrade_scripts_dir(upgrade_scripts_dir, version, scripts_obj) {
    for (const [script_name, upgrade_script] of Object.entries(scripts_obj)) {
        const dummy_script_path = get_upgrade_script_path(upgrade_scripts_dir, version, script_name);
        await fs.promises.writeFile(dummy_script_path, Buffer.from(upgrade_script));
    }
}

/**
 * delete_upgrade_scripts deletes all upgrade scripts based on the patameters
 * @param {String} upgrade_scripts_dir 
 * @param {String} version 
 * @param {Object} scripts_obj 
 */
async function delete_upgrade_scripts(upgrade_scripts_dir, version, scripts_obj) {
    for (const [script_name] of Object.entries(scripts_obj)) {
        const dummy_script_path = get_upgrade_script_path(upgrade_scripts_dir, version, script_name);
        await fs_utils.file_delete(dummy_script_path);
    }
}

/**
 * get_upgrade_script_path returns upgrade script full path
 * @param {String} upgrade_scripts_dir 
 * @param {String} version 
 * @param {String} script_name 
 * @returns {String}
 */
function get_upgrade_script_path(upgrade_scripts_dir, version, script_name) {
    return path.join(upgrade_scripts_dir, version, script_name + '.js');
}
