/* Copyright (C) 2016 NooBaa */
'use strict';

// disabling init_rand_seed as it takes longer than the actual test execution
process.env.DISABLE_INIT_RANDOM_SEED = "true";

const path = require('path');
const fs_utils = require('../../../util/fs_utils');
const http_utils = require('../../../util/http_utils');
const config = require('../../../../config');
const { folder_delete } = require('../../../util/fs_utils');
const { exec_manage_cli, TMP_PATH, create_system_json } = require('../../system_tests/test_utils');
const { TYPES } = require('../../../manage_nsfs/manage_nsfs_constants');
const { ManageCLIResponse } = require('../../../manage_nsfs/manage_nsfs_cli_responses');
const { CONFIG_DIR_VERSION, ConfigFS } = require('../../../sdk/config_fs');
const pkg = require('../../../../package.json');

const config_root = path.join(TMP_PATH, 'test_cli_versions');
const config_fs = new ConfigFS(config_root);
const config_dir_mock_version = '1.0.0';

describe('noobaa cli - versions flow', () => {

    let s3_mock_server;
    afterAll(async () => await folder_delete(config_root));

    afterEach(async () => {
        await fs_utils.file_delete(config_fs.system_json_path);
        stop_s3_mock_server(s3_mock_server);
    });

    describe('versions flow', () => {

        it('versions command - while server is up & no system.json file', async () => {
            s3_mock_server = await start_s3_mock_server();
            const res = await exec_manage_cli(TYPES.VERSIONS, '', { config_root }, true);
            const actual_parsed_res = JSON.parse(res);
            const expected_res = {
                expected_host_running_service_versions: {
                    package_version: pkg.version,
                    config_fs_version: CONFIG_DIR_VERSION
                },
                expected_config_dir_version: 'unknown'
            };
            assert_versions_res(actual_parsed_res, expected_res);
        });

        it('versions command - while server is up & system.json file exists', async () => {
            s3_mock_server = await start_s3_mock_server();
            await create_system_json(config_fs, config_dir_mock_version);
            const res = await exec_manage_cli(TYPES.VERSIONS, '', { config_root }, true);
            const actual_parsed_res = JSON.parse(res);
            const expected_res = {
                expected_host_running_service_versions: {
                    package_version: pkg.version,
                    config_fs_version: CONFIG_DIR_VERSION
                },
                expected_config_dir_version: config_dir_mock_version
            };
            assert_versions_res(actual_parsed_res, expected_res);
        });

        it('versions command - while server is down & no system.json file', async () => {
            const res = await exec_manage_cli(TYPES.VERSIONS, '', { config_root }, true);
            const parsed_res = JSON.parse(res);
            const expected_res = {
                expected_host_running_service_versions: {
                    package_version: 'unknown',
                    config_fs_version: 'unknown'
                },
                expected_config_dir_version: 'unknown'
            };
            assert_versions_res(parsed_res, expected_res);
        });

        it('versions command - while server is down & system.json file exists', async () => {
            await create_system_json(config_fs, config_dir_mock_version);
            const res = await exec_manage_cli(TYPES.VERSIONS, '', { config_root }, true);
            const parsed_res = JSON.parse(res);
            const expected_res = {
                expected_host_running_service_versions: {
                    package_version: 'unknown',
                    config_fs_version: 'unknown'
                },
                expected_config_dir_version: config_dir_mock_version
            };
            assert_versions_res(parsed_res, expected_res);
        });

    });
});


/**
 * start_s3_mock_server starts an s3 mock server
 * currently returns always the same pkg.version and CONFIG_DIR_VERSION
 * @returns {Promise<Object>}
 */
async function start_s3_mock_server() {
    const version_mock_handler = async (req, res) => {
        res.end(pkg.version);
    };
    const config_fs_version_mock_handler = async (req, res) => {
        res.end(CONFIG_DIR_VERSION);
    };
    const versions_handler = async (req, res) => {
        if (req.url.startsWith('/_/')) {
            // internals non S3 requests
            const api = req.url.slice('/_/'.length);
            if (api === 'version') {
                return version_mock_handler(req, res);
            } else if (api === 'config_fs_version') {
                return config_fs_version_mock_handler(req, res);
            }
        }
    };
    return http_utils.start_https_server(config.ENDPOINT_SSL_PORT, 'S3', versions_handler, config_root);
}

/**
 * stop_s3_mock_server stops an s3 mock server
 * @param {Object} s3_mock_server 
 */
function stop_s3_mock_server(s3_mock_server) {
    if (s3_mock_server) s3_mock_server.close();
}

/**
 * assert_versions_res asserts the versions response
 * @param {Object} actual_parsed_res
 * @param {Object} expected_res
 */
function assert_versions_res(actual_parsed_res, expected_res) {
    expect(actual_parsed_res.response.code).toBe(ManageCLIResponse.VersionsStatus.code);
    const { rpm_source_code_versions, host_running_service_versions, config_dir_version } = actual_parsed_res.response.reply;
    const { expected_host_running_service_versions, expected_config_dir_version } = expected_res;
    expect(rpm_source_code_versions.package_version).toBe(pkg.version);
    expect(rpm_source_code_versions.config_fs_version).toBe(CONFIG_DIR_VERSION);
    expect(host_running_service_versions.package_version).toBe(expected_host_running_service_versions.package_version);
    expect(host_running_service_versions.config_fs_version).toBe(expected_host_running_service_versions.config_fs_version);
    expect(config_dir_version).toBe(expected_config_dir_version);
}

