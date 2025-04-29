/* Copyright (C) 2025 NooBaa */
'use strict';

const _ = require('lodash');
const path = require('path');
const config = require('../../config');
const nb_native = require('./nb_native');

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

/**
 * get_lifecycle_object_info_for_filter returns an object that contains properties needed for filter check
 * based on list_objects/stat result 
 * @param {{key: String, create_time: Number, size: Number, tagging: Object}} entry list object entry
 * @returns {{key: String, age: Number, size: Number, tags: Object}}
 */
function get_lifecycle_object_info_for_filter(entry) {
    return {
        key: entry.key,
        age: get_file_age_days(entry.create_time),
        size: entry.size,
        tags: entry.tagging,
    };
}


/**
 * get_file_age_days gets file time since last modified in days
 * @param {Number} mtime
 * @returns {Number} days since object was last modified
 */
function get_file_age_days(mtime) {
    return Math.floor((Date.now() - mtime) / 24 / 60 / 60 / 1000);
}

/**
 * file_matches_filter used for checking the filter before deletion
 * @param {{obj_info: { key: String, create_time: Number, size: Number, tagging: Object}, filter_func?: Function}} params 
 * @returns {Boolean}
 */
function file_matches_filter({obj_info, filter_func = undefined}) {
    if (filter_func) {
        const object_info_for_filter = get_lifecycle_object_info_for_filter(obj_info);
        if (!filter_func(object_info_for_filter)) {
            return false;
        }
    }
    return true;
}

exports.get_latest_nc_lifecycle_run_status = get_latest_nc_lifecycle_run_status;
exports.file_matches_filter = file_matches_filter;
exports.get_lifecycle_object_info_for_filter = get_lifecycle_object_info_for_filter;
exports.get_file_age_days = get_file_age_days;
