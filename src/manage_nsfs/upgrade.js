/* Copyright (C) 2024 NooBaa */
'use strict';

const _ = require('lodash');
const dbg = require('../util/debug_module')(__filename);
const { ManageCLIError } = require('./manage_nsfs_cli_errors');
const { UPGRADE_ACTIONS } = require('./manage_nsfs_constants');
const { NCUpgradeManager } = require('../upgrade/nc_upgrade_manager');
const { ManageCLIResponse } = require('../manage_nsfs/manage_nsfs_cli_responses');
const { throw_cli_error, write_stdout_response, get_boolean_or_string_value } = require('./manage_nsfs_cli_utils');
const { NoobaaEvent } = require('./manage_nsfs_events_utils');
const { validate_expected_version } = require('./manage_nsfs_validations');

/**
 * manage_upgrade_operations handles cli upgrade operations
 * @param {string} action 
 * @param {string} user_input 
 * @param {import('../sdk/config_fs').ConfigFS} config_fs
 * @returns {Promise<Void>}
 */
async function manage_upgrade_operations(action, user_input, config_fs) {
    switch (action) {
        case UPGRADE_ACTIONS.START:
            await start_config_dir_upgrade(user_input, config_fs);
            break;
        case UPGRADE_ACTIONS.STATUS:
            await get_upgrade_status(config_fs);
            break;
        case UPGRADE_ACTIONS.HISTORY:
            await get_upgrade_history(config_fs);
            break;
        default:
            throw_cli_error(ManageCLIError.InvalidUpgradeAction);
    }
}

/**
 * start_config_dir_upgrade handles cli upgrade operation
 * @param {Object} user_input
 * @param {import('../sdk/config_fs').ConfigFS} config_fs
 * @returns {Promise<Void>}
 */
async function start_config_dir_upgrade(user_input, config_fs) {
    try {
        const skip_verification = get_boolean_or_string_value(user_input.skip_verification);
        const expected_version = user_input.expected_version;
        const expected_hosts = user_input.expected_hosts && user_input.expected_hosts.split(',').filter(host => !_.isEmpty(host));
        const custom_upgrade_scripts_dir = user_input.custom_upgrade_scripts_dir;

        new NoobaaEvent(NoobaaEvent.CONFIG_DIR_UPGRADE_STARTED).create_event(undefined, { expected_version, expected_hosts }, undefined);

        validate_expected_version(expected_version, skip_verification);
        if (!expected_hosts) dbg.warn('expected_hosts flag is empty, config dir upgrade will be performed without hosts version verification');

        const nc_upgrade_manager = new NCUpgradeManager(config_fs, { custom_upgrade_scripts_dir });
        const upgrade_res = await nc_upgrade_manager.upgrade_config_dir(expected_version, expected_hosts, { skip_verification });
        if (!upgrade_res) throw new Error('Upgrade config directory failed', { cause: upgrade_res });
        write_stdout_response(
            upgrade_res.code || ManageCLIResponse.UpgradeSuccessful,
            upgrade_res.upgrade_info, { expected_version, expected_hosts }
        );
    } catch (err) {
        if (err instanceof ManageCLIError) {
            // those are errors that the admin made in the CLI, the upgrade didn't start
            // therefore, we won't report it as UpgradeFailed and without adding an event
            throw err;
        } else {
            dbg.error('could not upgrade config directory successfully - error', err);
            throw_cli_error({ ...ManageCLIError.UpgradeFailed, cause: err }, undefined, { error: err.stack || err });
        }
    }
}

/**
 * get_upgrade_status handles cli upgrade status operation
 * @param {import('../sdk/config_fs').ConfigFS} config_fs
 * @returns {Promise<Void>}
 */
async function get_upgrade_status(config_fs) {
    try {
        const system_config = await config_fs.get_system_config_file({ silent_if_missing: true });
        let upgrade_status = system_config?.config_directory?.in_progress_upgrade;
        if (!upgrade_status) upgrade_status = { message: 'Config directory upgrade status is empty, there is no ongoing config directory upgrade' };
        write_stdout_response(ManageCLIResponse.UpgradeStatus, upgrade_status);
    } catch (err) {
        dbg.error('could not get upgrade status response', err);
        throw_cli_error({ ...ManageCLIError.UpgradeStatusFailed, cause: err });
    }
}

/**
 * get_upgrade_history handles cli upgrade history operation
 * @param {import('../sdk/config_fs').ConfigFS} config_fs
 * @returns {Promise<Void>}
 */
async function get_upgrade_history(config_fs) {
    try {
        const system_config = await config_fs.get_system_config_file({ silent_if_missing: true });
        let upgrade_history = system_config?.config_directory?.upgrade_history;
        if (!upgrade_history) upgrade_history = { message: 'Config directory upgrade history is empty' };
        write_stdout_response(ManageCLIResponse.UpgradeHistory, upgrade_history);
    } catch (err) {
        dbg.error('could not get upgrade history response', err);
        throw_cli_error({ ...ManageCLIError.UpgradeHistoryFailed, cause: err });
    }
}

exports.manage_upgrade_operations = manage_upgrade_operations;
