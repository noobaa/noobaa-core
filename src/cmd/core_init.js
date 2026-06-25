#!/usr/bin/env node
/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const os_utils = require('../util/os_utils');

const SUPERVISORD = '/usr/bin/supervisord_orig';
const PIDFILE = '/var/log/supervisord.pid';
const PACKAGE_JSON_PATH = '/root/node_modules/noobaa-core/package.json';
const NOOBAA_ROOT = '/root/node_modules/noobaa-core';
const NODE_BIN = '/usr/local/bin/node';
const DEFAULT_UPGRADE_SCRIPTS_DIR = `${NOOBAA_ROOT}/src/upgrade/upgrade_scripts`;

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
 * NooBaa core entry point.
 * @returns {Promise<number>} 0 on success
 */
async function start() {
    const version = read_package_version();
    console.log(`Version is: ${version}`);
    console.log('running core server init');
    await run_server_upgrade();

    try {
        await fs.promises.access(SUPERVISORD, fs.constants.X_OK);
    } catch (err) {
        throw new Error(`${SUPERVISORD} is not executable.`);
    }

    console.log('Starting ...');
    await os_utils.spawn('/bin/sh', ['-c', `ulimit -n 102400; exec ${SUPERVISORD} --pidfile ${PIDFILE} -n`], {
        stdio: 'inherit',
    });
    return 0;
}

async function main() {
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
    start,
};
