/* Copyright (C) 2016 NooBaa */
'use strict';

// disabling init_rand_seed as it takes longer than the actual test execution
process.env.DISABLE_INIT_RANDOM_SEED = 'true';

const fs = require('fs');
const os = require('os');
const path = require('path');
const fs_utils = require('../../../util/fs_utils');
const config = require('../../../../config');
const pkg = require('../../../../package.json');
const { update_rpm_upgrade, _verify_config_dir_upgrade, config_directory_defaults, _run_nc_upgrade_scripts,
    CONFIG_DIR_UNLOCKED, OLD_DEFAULT_CONFIG_DIR_VERSION, OLD_DEFAULT_PACKAGE_VERSION, DEFAULT_NC_UPGRADE_SCRIPTS_DIR } = require('../../../upgrade/nc_upgrade_manager');
const { ConfigFS } = require('../../../sdk/config_fs');
const { TMP_PATH, create_redirect_file, create_config_dir,
    fail_test_if_default_config_dir_exists, clean_config_dir } = require('../../system_tests/test_utils');

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

describe('nc upgrade manager - upgrade config directory', () => {

    beforeAll(async () => {
        await fail_test_if_default_config_dir_exists('test_config_dir_nc_upgrade_manager', config_fs);
    });

    describe('nc upgrade manager - config_directory_defaults', () => {

        it('config_directory_defaults - hostname from_version exists - 5.16.0', () => {
            const system_data = old_expected_system_json;
            const config_dir_defaults = config_directory_defaults(system_data);
            assert_config_dir_defaults(config_dir_defaults, system_data);
        });

        it('config_directory_defaults - hostname from_version exists - 5.17.0', () => {
            const system_data = current_expected_system_json;
            const config_dir_defaults = config_directory_defaults(system_data);
            assert_config_dir_defaults(config_dir_defaults, system_data);
        });

        it('config_directory_defaults - missing hostname successful_upgrades', () => {
            const system_data = current_expected_system_json_no_successful_upgrades;
            const config_dir_defaults = config_directory_defaults(system_data);
            assert_config_dir_defaults(config_dir_defaults, system_data);
        });

        it('config_directory_defaults - missing hostname upgrade_history', () => {
            const system_data = current_expected_system_json_no_upgrade_history;
            const config_dir_defaults = config_directory_defaults(system_data);
            assert_config_dir_defaults(config_dir_defaults, system_data);
        });

        it('config_directory_defaults - missing hostname', () => { // should throw
            const system_data = current_expected_system_json_invalid_hostname;
            const config_dir_defaults = config_directory_defaults(system_data);
            assert_config_dir_defaults(config_dir_defaults, system_data);
        });
    });

    describe('nc upgrade manager - _verify_config_dir_upgrade', () => {
        it('_verify_config_dir_upgrade - empty hosts system_data', async () => {
            const system_data = {};
            try {
                await _verify_config_dir_upgrade(system_data);
                fail('should have failed on invalid system_data');
            } catch (err) {
                expect(err.message).toBe('config dir upgrade can not be started missing hosts_data hosts_data={}');
            }
        });

        it('_verify_config_dir_upgrade - empty host current_version', async () => {
            const system_data = { [hostname]: []};
            try {
                await _verify_config_dir_upgrade(system_data);
                fail('should have failed on invalid system_data');
            } catch (err) {
                expect(err.message).toBe(`config dir upgrade can not be started until all nodes have the expected version=${pkg.version}, host=${hostname} host's current_version=undefined`);
            }
        });

        it('_verify_config_dir_upgrade - host current_version < new_version should upgrade RPM', async () => {
            const old_version = '5.16.0';
            const system_data = { [hostname]: { current_version: old_version }, other_hostname: { current_version: pkg.version } };
            try {
                await _verify_config_dir_upgrade(system_data);
                fail('should have failed on mismatch system and package version');
            } catch (err) {
                expect(err.message).toBe(`config dir upgrade can not be started until all nodes have the expected version=${pkg.version}, host=${hostname} host's current_version=${old_version}`);
            }
        });

        it('_verify_config_dir_upgrade - should upgrade config dir', async () => {
            const system_data = {
                [hostname]: { current_version: pkg.version, other_hostname: { current_version: pkg.version } }
            };
            await _verify_config_dir_upgrade(system_data);
        });

        it('_verify_config_dir_upgrade - host current_version > new_version should upgrade RPM', async () => {
            const newer_version = pkg.version + '.1';

            const system_data = { [hostname]: { current_version: newer_version }, other_hostname: { current_version: pkg.version } };
            try {
                await _verify_config_dir_upgrade(system_data);
                fail('should have failed on mismatch system and package version');
            } catch (err) {
                expect(err.message).toBe(`config dir upgrade can not be started until all nodes have the expected version=${pkg.version}, host=${hostname} host's current_version=${newer_version}`);
            }
        });

        it('_verify_config_dir_upgrade - should upgrade config dir', async () => {
            const expected_version = pkg.version;
            const system_data = {
                [hostname]: { current_version: pkg.version, other_hostname: { current_version: pkg.version } }
            };
            await _verify_config_dir_upgrade(system_data, expected_version);
        });

        it('_verify_config_dir_upgrade - fail on mismatch expected_version', async () => {
            const expected_version = pkg.version + '.1';
            const system_data = {
                [hostname]: { current_version: pkg.version, other_hostname: { current_version: pkg.version } }
            };
            try {
                await _verify_config_dir_upgrade(system_data, expected_version);
                fail('should have failed on mismatch system and package version');
            } catch (err) {
                expect(err.message).toBe(`config dir upgrade can not be started - the host's package version=${pkg.version} does not match the user's expected version=${expected_version}`);
            }
        });
    });

    describe('nc upgrade manager - _run_nc_upgrade_scripts', () => {
        const custom_upgrade_script_dir = path.join(TMP_PATH, 'custom_upgrade_script_dir');
        const custom_upgrade_script_dir_version_path = path.join(TMP_PATH, 'custom_upgrade_script_dir', '1.0.0');
        beforeEach(async () => {
            await fs_utils.create_path(custom_upgrade_script_dir_version_path, 777);
        });

        afterEach(async () => {
            await fs_utils.folder_delete(custom_upgrade_script_dir_version_path);
            await fs_utils.folder_delete(custom_upgrade_script_dir);
        });

        it('_run_nc_upgrade_scripts - no scripts', async () => {
            const this_upgrade = { config_dir_from_version: '0.0.0', config_dir_to_version: '1.0.0', completed_scripts: []};
            await _run_nc_upgrade_scripts(this_upgrade);
            expect(this_upgrade.completed_scripts).toEqual([]);
        });

        it('_run_nc_upgrade_scripts - no upgrade scripts dir', async () => {
            const this_upgrade = { config_dir_from_version: '0.0.0', config_dir_to_version: '1.0.0', completed_scripts: [] };
            await fs_utils.folder_delete(custom_upgrade_script_dir_version_path);
            await fs_utils.folder_delete(custom_upgrade_script_dir);
            await _run_nc_upgrade_scripts(this_upgrade, custom_upgrade_script_dir);
            expect(this_upgrade.completed_scripts).toEqual([]);
        });

        it('_run_nc_upgrade_scripts - custom_upgrade_script_dir - 2 successful scripts', async () => {
            const dummy_script1_path = path.join(custom_upgrade_script_dir_version_path, 'dummy_upgrade_script_1.js');
            const dummy_script2_path = path.join(custom_upgrade_script_dir_version_path, 'dummy_upgrade_script_2.js');
            await fs.promises.writeFile(dummy_script1_path, Buffer.from(dummy_upgrade_script_1));
            await fs.promises.writeFile(dummy_script2_path, Buffer.from(dummy_upgrade_script_2));

            const this_upgrade = { config_dir_from_version: '0.0.0', config_dir_to_version: '1.0.0', completed_scripts: []};
            await _run_nc_upgrade_scripts(this_upgrade, custom_upgrade_script_dir);
            expect(this_upgrade.completed_scripts).toEqual([dummy_script1_path, dummy_script2_path]);
        });

        it('_run_nc_upgrade_scripts - custom_upgrade_script_dir - 2 successful scripts, 1 failing script', async () => {
            const dummy_script1_path = path.join(custom_upgrade_script_dir_version_path, 'dummy_upgrade_script_1.js');
            const dummy_script2_path = path.join(custom_upgrade_script_dir_version_path, 'dummy_upgrade_script_2.js');
            const dummy_script3_path = path.join(custom_upgrade_script_dir_version_path, 'dummy_failing_upgrade_script_3.js');
            await fs.promises.writeFile(dummy_script1_path, Buffer.from(dummy_upgrade_script_1));
            await fs.promises.writeFile(dummy_script2_path, Buffer.from(dummy_upgrade_script_2));
            await fs.promises.writeFile(dummy_script3_path, Buffer.from(dummy_failing_upgrade_script_3));

            const this_upgrade = { config_dir_from_version: '0.0.0', config_dir_to_version: '1.0.0', completed_scripts: []};
            try {
                await _run_nc_upgrade_scripts(this_upgrade, custom_upgrade_script_dir);
                fail('should have failed on script number 3 failed');
            } catch (err) {
                expect(err.message).toBe('_run_nc_upgrade_scripts: nc upgrade manager failed!!!, Error: script number 3 failed');
            }
        });

        it('_run_nc_upgrade_scripts - 2 successful scripts', async () => {
            const dummy_script1_path = path.join(DEFAULT_NC_UPGRADE_SCRIPTS_DIR, '1.0.0', 'dummy_upgrade_script_1.js');
            const dummy_script2_path = path.join(DEFAULT_NC_UPGRADE_SCRIPTS_DIR, '1.0.0', 'dummy_upgrade_script_2.js');
            await fs.promises.writeFile(dummy_script1_path, Buffer.from(dummy_upgrade_script_1));
            await fs.promises.writeFile(dummy_script2_path, Buffer.from(dummy_upgrade_script_2));
            const this_upgrade = { config_dir_from_version: '0.0.0', config_dir_to_version: '1.0.0', completed_scripts: []};
            await _run_nc_upgrade_scripts(this_upgrade);
            expect(this_upgrade.completed_scripts).toEqual([dummy_script1_path, dummy_script2_path]);
            await fs_utils.file_delete(dummy_script1_path);
            await fs_utils.file_delete(dummy_script2_path);
        });

        it('_run_nc_upgrade_scripts - 2 successful scripts, 1 failing script', async () => {
            const dummy_script1_path = path.join(DEFAULT_NC_UPGRADE_SCRIPTS_DIR, '1.0.0', 'dummy_upgrade_script_1.js');
            const dummy_script2_path = path.join(DEFAULT_NC_UPGRADE_SCRIPTS_DIR, '1.0.0', 'dummy_upgrade_script_2.js');
            const dummy_script3_path = path.join(DEFAULT_NC_UPGRADE_SCRIPTS_DIR, '1.0.0', 'dummy_failing_upgrade_script_3.js');
            await fs.promises.writeFile(dummy_script1_path, Buffer.from(dummy_upgrade_script_1));
            await fs.promises.writeFile(dummy_script2_path, Buffer.from(dummy_upgrade_script_2));
            await fs.promises.writeFile(dummy_script3_path, Buffer.from(dummy_failing_upgrade_script_3));

            const this_upgrade = { config_dir_from_version: '0.0.0', config_dir_to_version: '1.0.0', completed_scripts: []};
            try {
                await _run_nc_upgrade_scripts(this_upgrade);
                fail('should have failed on script number 3 failed');
            } catch (err) {
                expect(err.message).toBe('_run_nc_upgrade_scripts: nc upgrade manager failed!!!, Error: script number 3 failed');
            } finally {
                await fs_utils.file_delete(dummy_script1_path);
                await fs_utils.file_delete(dummy_script2_path);
                await fs_utils.file_delete(dummy_script3_path);
            }
        });

    });

});

// Jest has builtin function fail that based on Jasmine
// in case Jasmine would get removed from jest, created this one
// based on this: https://stackoverflow.com/a/55526098/16571658
function fail(reason) {
    throw new Error(reason);
}


function assert_config_dir_defaults(actual_config_dir_defaults, system_data) {
    const { config_dir_version, upgrade_package_version, phase, upgrade_history } = actual_config_dir_defaults;
    const expected_package_from_version = system_data?.[hostname]?.upgrade_history?.successful_upgrades?.[0]?.from_version ||
        OLD_DEFAULT_PACKAGE_VERSION;
    expect(config_dir_version).toBe(OLD_DEFAULT_CONFIG_DIR_VERSION);
    expect(upgrade_package_version).toBe(expected_package_from_version);
    expect(phase).toBe(CONFIG_DIR_UNLOCKED);
    expect(upgrade_history).toEqual({ successful_upgrades: [] });
}
