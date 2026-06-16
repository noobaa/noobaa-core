#!/usr/bin/env node
/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const { spawn } = require('child_process');
const os_utils = require('../util/os_utils');
const {
    is_core_lease_enabled,
    create_client_from_env,
} = require('../util/core_lease_utils');

const SUPERVISORD = '/usr/bin/supervisord_orig';
const PIDFILE = '/var/log/supervisord.pid';
const PACKAGE_JSON_PATH = '/root/node_modules/noobaa-core/package.json';
const NOOBAA_ROOT = '/root/node_modules/noobaa-core';
const NODE_BIN = '/usr/local/bin/node';
const DEFAULT_UPGRADE_SCRIPTS_DIR = `${NOOBAA_ROOT}/src/upgrade/upgrade_scripts`;
const SUPERVISORD_SHUTDOWN_MS = 30000;

/** @type {import('child_process').ChildProcess|null} */
let _supervisord_proc = null;
/** @type {import('../util/core_lease_utils').CoreLeaseClient|null} */
let _lease_client = null;
let _shutting_down = false;
/** @type {Promise<void>|null} */
let _step_down_promise = null;

/**
 * Parses the NooBaa package version from package.json.
 * @param {string} [package_json_path]
 * @returns {string}
 */
function read_package_version(package_json_path = process.env.CORE_INIT_TEST_PACKAGE_JSON || PACKAGE_JSON_PATH) {
    const pkg = JSON.parse(fs.readFileSync(package_json_path, 'utf8'));
    if (typeof pkg.version !== 'string' || !pkg.version) {
        throw new Error(`version not found in ${package_json_path}`);
    }
    return pkg.version;
}

/**
 * Runs upgrade_manager.js for the core server init path.
 * TODO: move to a separate K8s init job in the future.
 * @returns {Promise<void>}
 */
async function run_server_upgrade() {
    const upgrade_scripts_dir = process.env.UPGRADE_SCRIPTS_DIR || DEFAULT_UPGRADE_SCRIPTS_DIR;
    const upgrade_cmd = `${NODE_BIN} src/upgrade/upgrade_manager.js --upgrade_scripts_dir ${upgrade_scripts_dir}`;
    console.log(`Running ${upgrade_cmd}`);
    await os_utils.spawn(NODE_BIN, [
        'src/upgrade/upgrade_manager.js',
        '--upgrade_scripts_dir',
        upgrade_scripts_dir,
    ], {
        cwd: NOOBAA_ROOT,
        stdio: 'inherit',
    });
}

/**
 * Starts the in-process lease renew loop. Must run before supervisord blocks the process.
 * @param {import('../util/core_lease_utils').CoreLeaseClient} client
 */
function start_core_lease_renewal(client) {
    _lease_client = client;
    client.on('lost_leadership', () => step_down_from_lease());
    client.renew_lease_loop().catch(err => {
        if (_shutting_down) return;
        console.log(`core lease renew failed: ${err.message}`);
        step_down_from_lease();
    });
}

/**
 * SIGKILL supervisord and wait for it to exit.
 */
async function kill_supervisord() {
    if (!_supervisord_proc) {
        return;
    }
    const proc = _supervisord_proc;
    proc.kill('SIGKILL');
    await new Promise(resolve => proc.once('close', resolve));
}

/**
 * Stops the supervisord child process with SIGTERM, falling back to SIGKILL.
 */
async function shutdown_supervisord() {
    if (!_supervisord_proc) {
        return;
    }
    const proc = _supervisord_proc;
    await new Promise(resolve => {
        let exited = false;
        const timer = setTimeout(() => {
            if (!exited) {
                proc.kill('SIGKILL');
            }
        }, SUPERVISORD_SHUTDOWN_MS);
        proc.once('close', () => {
            exited = true;
            clearTimeout(timer);
            resolve();
        });
        proc.kill('SIGTERM');
    });
}

/**
 * Releases the core lease when held by this pod.
 */
async function release_core_lease() {
    try {
        await _lease_client?.release_lease();
    } catch (err) {
        console.log(`release_lease failed: ${err.message}`);
    }
}

/**
 * Stops serving immediately when lease leadership is lost.
 * This will happen when the lease is lost or about to expire.
 * We store the promise so start()'s finally block can await it and ensure
 * release_core_lease() completes before process.exit() is called from main().
 */
function step_down_from_lease() {
    if (!_step_down_promise) {
        _step_down_promise = _do_step_down();
    }
    return _step_down_promise;
}

/**
 * Internal async body of step_down_from_lease.
 */
async function _do_step_down() {
    if (_shutting_down) {
        return;
    }
    _shutting_down = true;
    await kill_supervisord();
    await release_core_lease();
    process.exit(0);
}

/**
 * Stops supervisord, then the renew loop, then releases the lease.
 */
async function stop_serving_and_release_lease() {
    await shutdown_supervisord();
    if (_lease_client) {
        await _lease_client.stop_renew_loop();
        await release_core_lease();
    }
}

/**
 * Handles pod SIGTERM: stop serving, then release the lease.
 */
async function handle_sigterm() {
    if (_shutting_down) {
        return;
    }
    _shutting_down = true;
    console.log('received SIGTERM, shutting down');
    await stop_serving_and_release_lease();
    process.exit(0);
}

/**
 * Spawns supervisord and waits until it exits.
 * @returns {Promise<number>}
 */
async function run_supervisord() {
    try {
        await fs.promises.access(SUPERVISORD, fs.constants.X_OK);
    } catch (err) {
        throw new Error(`${SUPERVISORD} is not executable.`);
    }

    console.log('Starting ...');
    return new Promise((resolve, reject) => {
        _supervisord_proc = spawn('/bin/sh', ['-c', `ulimit -n 102400; exec ${SUPERVISORD} --pidfile ${PIDFILE} -n`], {
            stdio: 'inherit',
        });
        _supervisord_proc.on('error', reject);
        _supervisord_proc.on('close', status => {
            _supervisord_proc = null;
            resolve(status ?? 1);
        });
    });
}

async function start() {
    const version = read_package_version();
    console.log(`Version is: ${version}`);
    console.log('running core server init');

    if (is_core_lease_enabled()) {
        _lease_client = create_client_from_env();
        await _lease_client.acquire_lease();
        start_core_lease_renewal(_lease_client);
    }

    let status;
    try {
        await run_server_upgrade();
        status = await run_supervisord();
    } finally {
        if (_step_down_promise) {
            // Leadership was lost — wait for the step-down to finish (release_core_lease)
            // before returning to main(), which would otherwise call process.exit() first.
            await _step_down_promise;
        } else if (_lease_client && !_shutting_down) {
            await stop_serving_and_release_lease();
        }
    }
    return status ?? 1;
}

async function main() {
    process.on('SIGTERM', () => {
        handle_sigterm().catch(err => {
            console.log(err.message);
            process.exit(1);
        });
    });

    try {
        process.exit(await start());
    } catch (err) {
        console.log(err.message);
        /** @type {Error & { exitCode?: number }} */
        const exit_err = err;
        process.exit(exit_err.exitCode ?? 1);
    }
}


if (require.main === module) {
    main();
}

//used by unit tests
module.exports = {
    SUPERVISORD,
    PIDFILE,
    PACKAGE_JSON_PATH,
    NOOBAA_ROOT,
    DEFAULT_UPGRADE_SCRIPTS_DIR,
    read_package_version,
    run_server_upgrade,
    start_core_lease_renewal,
    step_down_from_lease,
    handle_sigterm,
    start,
};
