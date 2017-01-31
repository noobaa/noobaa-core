"use strict";

/*
 * This script wraps agent_cli
 * it keeps it alive and should also handle ugprades, repairs etc.
 */
const os = require('os');

const WIN_AGENT = os.type() === 'Windows_NT';

const fs = require('fs');
const P = require('../util/promise');
const fs_utils = require('../util/fs_utils');
const promise_utils = require('../util/promise_utils');
const request = require('request');
const url = require('url');
const dbg = require('../util/debug_module')(__filename);
const path = require('path');


const DUPLICATE_RET_CODE = 68;
const EXECUTABLE_MOD_VAL = 511;

const CONFIGURATION = {
    SETUP_FILENAME: WIN_AGENT ? 'noobaa-setup.exe' : 'noobaa-setup',
    PROCESS_DIR: path.join(__dirname, '..', '..'),
    AGENT_CLI: './src/agent/agent_cli',
    NUM_UPGRADE_WARNINGS: 18,
    TIME_BETWEEN_WARNINGS: 10000,
};

CONFIGURATION.SETUP_FILE = CONFIGURATION.PROCESS_DIR + (WIN_AGENT ? '\\' : '/') + CONFIGURATION.SETUP_FILENAME;
CONFIGURATION.INSTALLATION_COMMAND = WIN_AGENT ? `"${CONFIGURATION.SETUP_FILE}" /S` :
    `setsid ${CONFIGURATION.SETUP_FILE} >> /dev/null`;

process.chdir(path.join(__dirname, '..', '..'));

var address = "";

fs_utils.file_delete(CONFIGURATION.SETUP_FILE)
    .catch(console.error)
    .then(() => fs.readFileAsync('./agent_conf.json'))
    .then(agent_conf_file => {
        address = url.parse(JSON.parse(agent_conf_file).address).host;
        dbg.log0('Starting agent_cli');
        return promise_utils.fork(CONFIGURATION.AGENT_CLI, undefined, { stdio: 'ignore' });
    })
    .catch(err => {
        if (err.code && err.code === DUPLICATE_RET_CODE) {
            dbg.log0('Duplicate token');
            return promise_utils.fork(CONFIGURATION.AGENT_CLI, ['--duplicate'], { stdio: 'ignore' });
        }
        throw err;
    })
    // Currently, to signal an upgrade is required agent_cli exits with 0.
    // It should also upgrade when agent_cli throws,
    // but upgrade needs to be handled better by this script first
    .then(() => {
        const output = fs.createWriteStream(CONFIGURATION.SETUP_FILE);
        return new P((resolve, reject) => {
            const request_url = `https://${address}/public/${CONFIGURATION.SETUP_FILENAME}`;
            dbg.log0(`Downloading Noobaa agent upgrade package: ${request_url}`);
            request.get({
                    url: request_url,
                    strictSSL: false,
                    timeout: 20000
                })
                .on('error', err => {
                    dbg.warn('Error downloading NooBaa agent upgrade from', address);
                    return reject(err);
                })
                .pipe(output)
                .on('error', err => reject(err))
                .on('finish', resolve);
        });
    })
    .then(() => fs.chmodAsync(CONFIGURATION.SETUP_FILE, EXECUTABLE_MOD_VAL))
    .then(() => P.delay(2000)) // Not sure why this is necessary, but it is.
    .then(() => promise_utils.exec(CONFIGURATION.INSTALLATION_COMMAND))
    .then(() => promise_utils.retry(CONFIGURATION.NUM_UPGRADE_WARNINGS,
        CONFIGURATION.TIME_BETWEEN_WARNINGS, attempts => {
            let msg = `Still upgrading. ${(CONFIGURATION.NUM_UPGRADE_WARNINGS - attempts) * (CONFIGURATION.TIME_BETWEEN_WARNINGS / 1000)} seconds have passed.`;
            if (attempts !== CONFIGURATION.NUM_UPGRADE_WARNINGS) dbg.warn(msg);
            throw Error(msg);
        }))
    .catch(err => dbg.error(err));
