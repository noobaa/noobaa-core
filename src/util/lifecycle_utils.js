/* Copyright (C) 2025 NooBaa */
'use strict';

const _ = require("lodash");
const nb_native = require("./nb_native");
const path = require("path");
const config = require("../../config");

/**
 * get_latest_nc_lifecycle_run_status returns the latest lifecycle run status
 * latest run can be found by maxing the lifecycle log entry names, log entry name is the lifecycle_run_{timestamp}.json of the run
 * @param {Object} config_fs
 * @param {{silent_if_missing: boolean}} options
 * @returns {Promise<object | undefined >}
 */
async function get_latest_nc_lifecycle_run_status(config_fs, options) {
    const { silent_if_missing = false } = options;
    try {
        const lifecycle_log_entries = await nb_native().fs.readdir(config_fs.fs_context, config.NC_LIFECYCLE_LOGS_DIR);
        const latest_lifecycle_run = _.maxBy(lifecycle_log_entries, entry => entry.name);
        const latest_lifecycle_run_status_path = path.join(config.NC_LIFECYCLE_LOGS_DIR, latest_lifecycle_run.name);
        const latest_lifecycle_run_status = await config_fs.get_config_data(latest_lifecycle_run_status_path, options);
        return latest_lifecycle_run_status;
    } catch (err) {
        if (err.code === 'ENOENT' && silent_if_missing) {
            return;
        }
        throw err;
    }
}


exports.get_latest_nc_lifecycle_run_status = get_latest_nc_lifecycle_run_status;
