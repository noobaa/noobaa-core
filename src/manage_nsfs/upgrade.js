/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../util/debug_module')(__filename);
const { ManageCLIError } = require('./manage_nsfs_cli_errors');
const { UPGRADE_ACTIONS } = require('./manage_nsfs_constants');
const { ManageCLIResponse } = require('../manage_nsfs/manage_nsfs_cli_responses');
const { throw_cli_error, write_stdout_response } = require('./manage_nsfs_cli_utils');

/**
 * manage_upgrade_operations handles cli upgrade operations
 * @param {string} action 
 * @returns {Promise<Void>}
 */
async function manage_upgrade_operations(action, config_fs) {
    switch (action) {
        case UPGRADE_ACTIONS.START:
            await exec_config_dir_upgrade();
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
 * exec_config_dir_upgrade handles cli upgrade operation
 * @returns {Promise<Void>}
 */
async function exec_config_dir_upgrade() {
    try {
        // TODO - add verifications and a call to the config directory upgrade
        throw new Error('Upgrade Config Directory is not implemented yet');
    } catch (err) {
        dbg.error('could not upgrade config directory successfully - err', err);
        throw_cli_error({ ...ManageCLIError.UpgradeFailed, cause: err });
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
