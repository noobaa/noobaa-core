/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../util/debug_module')(__filename);
const config = require('../../config');
const pkg = require('../../package.json');
const http_utils = require('../util/http_utils');
const buffer_utils = require('../util/buffer_utils');
const { write_stdout_response } = require('./manage_nsfs_cli_utils');
const { ManageCLIResponse } = require('./manage_nsfs_cli_responses');

////////////////////////
// VERSIONS MANAGEMENT //
////////////////////////

/**
 * versions_management 
 */
async function versions_management(config_fs) {
    const system_json = await config_fs.get_system_config_file({ silent_if_missing: true });
    const versions = {
        rpm_source_code_versions: {
            package_version: pkg.version,
            config_fs_version: config_fs.config_dir_version,
        },
        host_running_service_versions: await get_running_service_versions(),
        config_dir_version: system_json?.config_directory.config_dir_version || 'unknown'
    };

    const response = { code: ManageCLIResponse.VersionsStatus, detail: versions };
    write_stdout_response(response.code, response.detail);
}

/**
 * get_running_service_versions returns the versions of the running service
 * @returns {Promise<Object>}
 */
async function get_running_service_versions() {
    const host_service_versions = {};
    try {
        const package_version_api = '/_/version';
        const config_dir_version_api = '/_/config_fs_version';
        host_service_versions.package_version = await get_version_api_response(package_version_api);
        host_service_versions.config_fs_version = await get_version_api_response(config_dir_version_api);
    } catch (err) {
        dbg.warn('could not receive versions response', err);
    }
    return host_service_versions;
}

/**
 * get_version_api_response runs a GET request to the given api and returns the response
 * @param {string} api 
 * @returns 
 */
async function get_version_api_response(api) {
    let version;
    try {
        const res = await http_utils.make_https_request({
            hostname: 'localhost',
            port: config.ENDPOINT_SSL_PORT,
            path: api,
            method: 'GET',
            rejectUnauthorized: false
        });

        if (res.statusCode === 200) {
            const buffer = await buffer_utils.read_stream_join(res);
            version = buffer.toString('utf8');
        } else if (res.statusCode >= 500) {
            const buffer = await buffer_utils.read_stream_join(res);
            const body = buffer.toString('utf8');
            dbg.log0(`get_version_api_response received an error from ${api} api, skipping', ${body}`);
        }
    } catch (err) {
        dbg.warn('get_version_api_response: err', err);
    }
    return version?.trim() || 'unknown';
}

// EXPORTS
exports.versions_management = versions_management;
