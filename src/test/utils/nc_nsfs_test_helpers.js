/* Copyright (C) 2026 NooBaa */
'use strict';

/**
 * Shared helpers for starting NC nsfs in tests (nc_coretest, archive target, etc).
 * Kept separate from nc_coretest.js so containerized tests can reuse nsfs startup
 * without setting NC_CORETEST.
 */

const fs = require('fs');
const child_process = require('child_process');

const P = require('../../util/promise');

/** Default NC coretest S3 HTTP port (matches config.ENDPOINT_PORT default). */
const NSFS_CORETEST_HTTP_PORT = 6001;

/**
 * HTTP port for a standalone NC archive-target nsfs endpoint: coretest default + 10
 * so it can run beside nc_coretest on the same host without binding the same port.
 */
const NSFS_ARCHIVE_TARGET_HTTP_PORT = NSFS_CORETEST_HTTP_PORT + 10;

/**
 * Fixed delay after spawning nsfs before sending S3 requests.
 * Without it, clients often see ECONNREFUSED while the endpoint is still starting.
 */
const NSFS_PROCESS_STARTUP_DELAY_MS = 5000;

/** Stable creation_date for test NC account config files (identity.json schema). */
const NC_TEST_ACCOUNT_CREATION_DATE = '2023-10-30T04:46:33.815Z';

/**
 * Base config.json entries shared by nc_coretest and isolated archive-target instances.
 * @param {object} [overrides]
 * @returns {object}
 */
function get_base_nc_config_json(overrides = {}) {
    return {
        ALLOW_HTTP: true,
        OBJECT_SDK_BUCKET_CACHE_EXPIRY_MS: 1,
        NC_RELOAD_CONFIG_INTERVAL: 1,
        // DO NOT CHANGE - setting VACCUM_ANALYZER_INTERVAL=1 needed for failing the tests
        // in case where vaccumAnalyzer is being called before setting process.env.NC_NSFS_NO_DB_ENV = 'true' on nsfs.js
        VACCUM_ANALYZER_INTERVAL: 1,
        ...overrides,
    };
}

/**
 * Writes config.json under a config_root directory.
 * @param {string} config_file_path
 * @param {object} [overrides]
 * @returns {Promise<void>}
 */
async function write_nc_config_json(config_file_path, overrides = {}) {
    await fs.promises.writeFile(
        config_file_path,
        JSON.stringify(get_base_nc_config_json(overrides)),
    );
}

/**
 * Spawns nsfs.js detached (same pattern as nc_coretest).
 * detached: child can outlive the parent test process until explicitly killed.
 * stdout/stderr are piped to log_file for debugging failed runs.
 * @param {{ http_port: number, config_root: string, log_file?: string, extra_args?: string[] }} options
 * @returns {{ process: import('child_process').ChildProcess, log_stream: fs.WriteStream }}
 */
function spawn_nsfs_process({ http_port, config_root, log_file = 'nsfs_integration_test_log.txt', extra_args = [] }) {
    const log_stream = fs.createWriteStream(log_file, { flags: 'a' });
    const argv = [
        'src/cmd/nsfs.js',
        '--http_port',
        String(http_port),
        '--config_root',
        config_root,
        ...extra_args,
    ];
    const nsfs_process = child_process.spawn('node', argv, { detached: true });
    nsfs_process.stdout.pipe(log_stream);
    nsfs_process.stderr.pipe(log_stream);
    nsfs_process.on('exit', () => log_stream.end());
    nsfs_process.on('error', () => log_stream.end());
    return { process: nsfs_process, log_stream };
}

/**
 * Waits for a freshly spawned nsfs process to accept connections.
 * @returns {Promise<void>}
 */
async function wait_for_nsfs_process_ready() {
    await P.delay(NSFS_PROCESS_STARTUP_DELAY_MS);
}

/**
 * Creates an NC account identity via ConfigFS (no manage_nsfs CLI, no setgroups).
 * @param {import('../../sdk/config_fs').ConfigFS} config_fs
 * @param {{ _id: string, name: string, email?: string, new_buckets_path: string, access_key: string, secret_key: string, creation_date?: string }} account
 * @returns {Promise<object>}
 */
async function create_nc_account_via_config_fs(config_fs, account) {
    const {
        _id,
        name,
        email = name,
        new_buckets_path,
        access_key,
        secret_key,
        creation_date = NC_TEST_ACCOUNT_CREATION_DATE,
    } = account;
    await config_fs.create_config_dirs_if_missing();
    return config_fs.create_account_config_file({
        _id,
        name,
        email,
        allow_bucket_creation: true,
        access_keys: [{ access_key, secret_key }],
        nsfs_account_config: {
            uid: process.getuid(),
            gid: process.getgid(),
            new_buckets_path,
        },
        creation_date,
    });
}

module.exports = {
    NSFS_CORETEST_HTTP_PORT,
    NSFS_ARCHIVE_TARGET_HTTP_PORT,
    NSFS_PROCESS_STARTUP_DELAY_MS,
    NC_TEST_ACCOUNT_CREATION_DATE,
    get_base_nc_config_json,
    write_nc_config_json,
    spawn_nsfs_process,
    wait_for_nsfs_process_ready,
    create_nc_account_via_config_fs,
};
