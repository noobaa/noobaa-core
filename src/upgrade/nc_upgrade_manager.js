/* Copyright (C) 2016 NooBaa */
"use strict";

const os = require('os');
const path = require('path');
const util = require('util');
const pkg = require('../../package.json');
const dbg = require('../util/debug_module')(__filename);
const { CONFIG_DIR_PHASES } = require('../sdk/config_fs');
const { should_upgrade, run_upgrade_scripts, version_compare } = require('./upgrade_utils');

const hostname = os.hostname();
// prior to 5.18.0 - there is no config dir version, the config dir version to be used on the first upgrade is 0.0.0 (5.17.0 -> 5.18.0)
const OLD_DEFAULT_CONFIG_DIR_VERSION = '0.0.0';
const OLD_DEFAULT_PACKAGE_VERSION = '5.17.0';
const DEFAULT_NC_UPGRADE_SCRIPTS_DIR = path.join(__dirname, 'nc_upgrade_scripts');

/////////////////////////////
//       NC UPGRADES       //
/////////////////////////////

class NCUpgradeManager {

    /**
     * @param {import('../sdk/config_fs').ConfigFS} config_fs
     * @param {{custom_upgrade_scripts_dir?: string}} [options]
     */
    constructor(config_fs, { custom_upgrade_scripts_dir } = {}) {
        this.config_fs = config_fs;
        this.config_dir_version = config_fs.config_dir_version;
        this.package_version = pkg.version;
        this.upgrade_scripts_dir = custom_upgrade_scripts_dir || DEFAULT_NC_UPGRADE_SCRIPTS_DIR;
    }

    /**
     * NC upgrades are Online(*) upgrades that should be executed as follows - 
     * 1. Backup the config directory.
     * 2. Iterate all hosts one by one - 
     *    2.1. Upgrade the host's RPM
     *    2.2. Restart noobaa service on the host.
     * 3. Run `noobaa-cli upgrade start` - will initialize config directory upgrade
     * 
     * * Online upgrade - during the config directory upgrade, all creations/updates/deletions of entities like buckets/accounts will be blocked.
     * 
     * system.json upgrade information - 
     * 1. RPM upgrades are per host, therefore they will be presented under the hostname object, in the upgrade history section.
     * 2. Config Directory are cluster scoped - therefore, the config_directory key will be on the first level and in_progress_upgrade and upgrade_history of the config directory will be under it.
     * Example -
     * {
     *   [hostname]: { current_version: 5.18.0, upgrade_history: {{ from_version: 5.17.0, to_version: 5.18.0, completed_scripts: [], timestamp }}}
     *   config_directory: { config_dir_version: 1,
     *                       upgrade_package_version: 5.17.0,
     *                       phase: 'CONFIG_DIR_LOCKED',
     *                       in_progress_upgrade: { from_version: 5.17.0, to_version: 5.18.0, config_dir_from_version: 0, config_dir_to_version: 1, completed_scripts: [], timestamp }},
     *                       upgrade_history: {}
     * }
     */


    /**
     * update_rpm_upgrade updates an RPM upgrade of a specific host in the system.json file if there was an upgrade
     * an upgrade is detected when the version in system.json is lower than the version in package.json.
     * @returns {Promise<Void>}
     */
    async update_rpm_upgrade() {
        const system_data = await this.config_fs.get_system_config_file({ silent_if_missing: true });
        if (!system_data) return;

        const from_version = system_data?.[hostname]?.current_version;
        const to_version = this.package_version;

        if (!should_upgrade(from_version, to_version)) return;

        const this_upgrade = { timestamp: Date.now(), from_version, to_version };
        system_data[hostname].current_version = to_version;
        system_data[hostname].config_dir_version = this.config_fs.config_dir_version;
        system_data[hostname]?.upgrade_history?.successful_upgrades.unshift(this_upgrade);
        await this.config_fs.update_system_json_with_retries(JSON.stringify(system_data));
    }

    /**
     * upgrade_config_dir does the following - 
     * 1. verifies if an upgrade is available - the config directory version mentioned in the config directory in system json is lower than the version appears in config_fs
     * 2. verifies if upgrade can start
     * 3. set upgrade start on system.json - 
     *    3.1. updates the phase to CONFIG_DIR_LOCKED
     *    3.2. in_progess_upgrade on system.json 
     * 3. runs upgrade scripts
     * 4. set upgrade finish on system json - 
     *    4.1. new config_dir_version
     *    4.2. new upgrade_package_version
     *    4.3. updates the phase to CONFIG_DIR_UNLOCKED
     *    4.4. moves the current upgrade from in_progress_upgrade to the upgrade_history.successful_upgrades 
     *    4.5. is 5.17.0 is a good default for from_version?
     * @param {string} expected_version
     * @param {[string]} hosts_list
     * @param {{skip_verification?: boolean}} [options]
     * @returns {Promise<Object>}
     */
    async upgrade_config_dir(expected_version, hosts_list, { skip_verification } = {}) {
        let system_data = await this.config_fs.get_system_config_file({ silent_if_missing: true });
        if (!system_data) throw new Error('system does not exist');

        if (!system_data.config_directory) system_data.config_directory = this.config_directory_defaults(system_data);
        const config_dir_from_version = system_data.config_directory.config_dir_version;
        const config_dir_to_version = this.config_dir_version;
        const package_from_version = system_data.config_directory.upgrade_package_version;
        const package_to_version = this.package_version;
        const this_upgrade_versions = { config_dir_from_version, config_dir_to_version, package_from_version, package_to_version };

        if (!should_upgrade(config_dir_from_version, config_dir_to_version)) return { message: 'config_dir_version on system.json and config_fs.config_dir_version match, nothing to upgrade' };

        if (!skip_verification) await this._verify_config_dir_upgrade(system_data, expected_version, hosts_list);

        system_data = await this._update_config_dir_upgrade_start(system_data, this_upgrade_versions);
        const this_upgrade = system_data.config_directory.in_progress_upgrade;

        try {
            await this._run_nc_upgrade_scripts(this_upgrade);
        } catch (err) {
            await this._update_config_dir_upgrade_failed(system_data, this_upgrade, err);
            throw err;
        }

        await this._update_config_dir_upgrade_finish(system_data, this_upgrade);
        return this_upgrade;
    }

    //////////////////////////////
    //         HELPERS          //
    //////////////////////////////


    /**
     * config_directory_defaults returns a default initial config directory object
     * @param {Object} system_data
     * @returns {Object}
     */
    config_directory_defaults(system_data) {
        const hosts_old_package_version = system_data?.[hostname]?.upgrade_history?.successful_upgrades?.[0]?.from_version;
        return {
            config_dir_version: OLD_DEFAULT_CONFIG_DIR_VERSION,
            upgrade_package_version: hosts_old_package_version || OLD_DEFAULT_PACKAGE_VERSION,
            phase: CONFIG_DIR_PHASES.CONFIG_DIR_UNLOCKED,
            upgrade_history: { successful_upgrades: [] }
        };
    }

    /**
     * _verify_config_dir_upgrade verifies that - 
     * 1. All hosts appearing in system.json were RPM upgraded to the same version the host running the upgrade
     * 2. The user's expected_version is the host's package version - 
     *    expected_version is the expected source code version that the user asks to upgrade to, it's an optional verification, 
     *    if expected_version was not provided we assume that the source code on this host is 
     * 3. The user's expected_hosts exist in system.json
     * 4. If there are hosts in system.json that ere not provided in the expected_hosts we will print a warning but won't fail
     * we do that because of hostname can be renamed, hosts that are on maintainance and we don't want to block the upgrade becuase it might take a lot of time,
     * or because of hosts that used to be a part of the cluster and they were removed from the cluster, we don't get the updated info of the hosts on system.json 
     * therefore we can not treat the system.json as the source of truth of the hosts information
     * @param {Object} system_data
     * @param {String} expected_version
     * @param {[String]} expected_hosts
     * @returns {Promise<Void>}
     */
    async _verify_config_dir_upgrade(system_data, expected_version, expected_hosts) {
        const new_version = this.package_version;
        const hosts_data = this.config_fs.get_hosts_data(system_data);
        let err_message;
        if (expected_version !== new_version) {
            err_message = `config dir upgrade can not be started - the host's package version=${new_version} does not match the user's expected version=${expected_version}`;
        }
        const hostnames = Object.keys(hosts_data);

        if (!err_message && !hostnames.length) {
            err_message = `config dir upgrade can not be started missing hosts_data hosts_data=${util.inspect(hosts_data)}`;
        }

        const all_hostnames_exist_in_expected_hosts = hostnames.every(item => expected_hosts.includes(item));
        if (!all_hostnames_exist_in_expected_hosts) {
            dbg.warn(`_verify_config_dir_upgrade - system.json contains one or more hosts info that are not specified in expected_hosts: hosts_data=${util.inspect(hosts_data)} expected_hosts=${util.inspect(expected_hosts)}`);
        }

        const all_expected_hosts_exist_in_system_json = expected_hosts.every(item => hostnames.includes(item));
        if (!err_message && !all_expected_hosts_exist_in_system_json) {
            err_message = `config dir upgrade can not be started - expected_hosts contains one or more hosts that are not specified in system.json hosts_data=${util.inspect(hosts_data)} expected_hosts=${util.inspect(expected_hosts)}`;
        }

        if (!err_message) {
            for (const cur_hostname of expected_hosts) {
                const host_data = hosts_data[cur_hostname];
                if (!host_data.current_version || version_compare(host_data.current_version, new_version) !== 0) {
                    err_message = `config dir upgrade can not be started until all expected hosts have the expected version=${new_version}, host=${cur_hostname} host's current_version=${host_data.current_version}`;
                }
            }
        }

        if (!err_message && system_data.config_directory?.in_progress_upgrade) {
            err_message = `config dir upgrade can not be started - there is already an ongoing upgrade system_data.config_directory.in_progess_upgrade=${util.inspect(system_data.config_directory.in_progress_upgrade)}`;
        }

        if (err_message) {
            dbg.error(`_verify_config_dir_upgrade: ${err_message}`);
            throw new Error(err_message);
        }
    }

    /**
     * _update_config_dir_upgrade_start updates system.json that a new upgrade was started - 
     * 1. phase of the config dir is locked
     * 2. config_dir_version is the config_dir_version in system.json or '0'
     * 3. upgrade_package_version is the source code version in config_directory of system.json or the from_version appears in the last upgrade of this host 
     *    because of the check that the RPM was already upgraded
     * 4. in_progress_upgrade -
     *    4.1. timestamp of the start of the upgrade
     *    4.2. completed_scripts - currently empty array
     *    4.3. running_host - the hosts that runs the config directory upgrade
     *    4.4. config_dir_from_version - the current config directory version
     *    4.5. config_dir_to_version - the new config directory version
     *    4.6. from_version - the current source code version
     *    4.7. to_version - the new source code version
     * @param {Object} system_data
     * @param {{ config_dir_from_version: string; config_dir_to_version: string; package_from_version: string; package_to_version: string; }} options
     * @returns {Promise<Object>}
    */
    async _update_config_dir_upgrade_start(system_data, options) {
        const updated_config_directory = {
            ...system_data.config_directory,
            phase: CONFIG_DIR_PHASES.CONFIG_DIR_LOCKED,
            config_dir_version: options.config_dir_from_version,
            upgrade_package_version: options.package_from_version,
            in_progress_upgrade: {
                timestamp: Date.now(),
                completed_scripts: [],
                running_host: os.hostname(),
                config_dir_from_version: options.config_dir_from_version,
                config_dir_to_version: options.config_dir_to_version,
                package_from_version: options.package_from_version,
                package_to_version: options.package_to_version
            }
        };
        const updated_system_data = { ...system_data, config_directory: updated_config_directory };
        await this.config_fs.update_system_json_with_retries(JSON.stringify(updated_system_data));
        return updated_system_data;
    }


    /**
     * _run_nc_upgrade_scripts runs the config directory upgrade scripts 
     * @param {Object} this_upgrade
     * @returns {Promise<Void>}
     */
    async _run_nc_upgrade_scripts(this_upgrade) {
        try {
            await run_upgrade_scripts(this_upgrade, this.upgrade_scripts_dir, { dbg, from_version: this_upgrade.package_from_version });
        } catch (err) {
            const upgrade_failed_msg = `_run_nc_upgrade_scripts: nc upgrade manager failed!!!, ${err}`;
            dbg.error(upgrade_failed_msg);
            throw new Error(upgrade_failed_msg);
        }
    }

    /**
     * _update_config_dir_upgrade_finish updates the system.json on finish of the upgrade, it updates that - 
     * 1. config directory is unlocked
     * 2. config_dir_version is the new version
     * 3. upgrade_package_version is the new source code version
     * 4. add the finished upgrade to the successful_upgrades array
     * 5. last_failure is removed after a successful upgrade
     * @param {Object} system_data
     * @param {Object} this_upgrade 
     * @returns {Promise<Void>}
     */
    async _update_config_dir_upgrade_finish(system_data, this_upgrade) {
        const upgrade_history = system_data?.config_directory?.upgrade_history;
        const successful_upgrades = upgrade_history?.successful_upgrades || [];

        const updated_config_directory = {
            phase: CONFIG_DIR_PHASES.CONFIG_DIR_UNLOCKED,
            config_dir_version: this_upgrade.config_dir_to_version,
            upgrade_package_version: this_upgrade.package_to_version,
            upgrade_history: {
                ...upgrade_history,
                successful_upgrades: [this_upgrade, ...successful_upgrades],
                last_failure: undefined
            }
        };
        const updated_system_data = { ...system_data, config_directory: updated_config_directory };
        await this.config_fs.update_system_json_with_retries(JSON.stringify(updated_system_data));
    }

    /**
     * _update_config_dir_upgrade_failed updates the system.json on failure of the upgrade
     * @param {Object} system_data 
     * @param {Object} this_upgrade 
     * @param {Error} error
     * @returns {Promise<Void>}
     */
    async _update_config_dir_upgrade_failed(system_data, this_upgrade, error) {
        system_data.config_directory.upgrade_history.last_failure = this_upgrade;
        system_data.config_directory.upgrade_history.last_failure.error = error.stack;
        delete system_data.config_directory.in_progress_upgrade;
        await this.config_fs.update_system_json_with_retries(JSON.stringify(system_data));
    }
}


exports.NCUpgradeManager = NCUpgradeManager;
exports.OLD_DEFAULT_CONFIG_DIR_VERSION = OLD_DEFAULT_CONFIG_DIR_VERSION;
exports.OLD_DEFAULT_PACKAGE_VERSION = OLD_DEFAULT_PACKAGE_VERSION;
exports.DEFAULT_NC_UPGRADE_SCRIPTS_DIR = DEFAULT_NC_UPGRADE_SCRIPTS_DIR;
