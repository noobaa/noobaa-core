/* Copyright (C) 2016 NooBaa */
"use strict";

/*
 * This script wraps agent_cli
 * it keeps it alive and should also handle ugprades, repairs etc.
 */
const fs = require('fs');
const url = require('url');
const request = require('request');
const path = require('path');

const dbg = require('../util/debug_module')(__filename);
dbg.set_process_name('agent_wrapper');

const P = require('../util/promise');
const fs_utils = require('../util/fs_utils');
const os_utils = require('../util/os_utils');
const child_process = require('child_process');

const AGENT_MSG_CODES = Object.freeze([
    'UPGRADE',
    'DUPLICATE',
    'UNINSTALL',
    'NOTFOUND'
]);

const EXECUTABLE_MOD_VAL = 511;

const CONFIGURATION = {
    SETUP_FILENAME: 'noobaa-setup',
    PROCESS_DIR: path.join(__dirname, '..', '..'),
    AGENT_CLI: './src/agent/agent_cli',
    NUM_UPGRADE_WARNINGS: 18,
    TIME_BETWEEN_WARNINGS: 10000,
    PATHS_TO_BACKUP: ['src', 'node_modules', 'build'],
};

CONFIGURATION.SETUP_FILE = path.join(CONFIGURATION.PROCESS_DIR, CONFIGURATION.SETUP_FILENAME);
CONFIGURATION.INSTALLATION_COMMAND = `setsid ${CONFIGURATION.SETUP_FILE} >> /dev/null`;

process.chdir(path.join(__dirname, '..', '..'));
CONFIGURATION.BACKUP_DIR = path.join(process.cwd(), `backup`);

let address = "";
let new_backup_dir = CONFIGURATION.BACKUP_DIR;

function _download_file(request_url, output) {
    return new Promise((resolve, reject) => {
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
}

async function run_agent_cli(agent_args = []) {
    return new Promise((resolve, reject) => {
        const args = [CONFIGURATION.AGENT_CLI, ...agent_args];
        const agent_cli_proc = child_process.spawn('./node', args, {
            stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
            detached: false
        });
        let promise_handled = false;

        // on agent message kill agent_cli and return the message code
        agent_cli_proc.on('message', msg => {
            promise_handled = true;
            agent_cli_proc.kill('SIGKILL');
            if (!AGENT_MSG_CODES.includes(msg.code)) reject(new Error('agent_cli sent unknown message'));
            resolve(msg.code);
        });

        // agent_cli should not exit on normal flow. throw error on exit\error
        agent_cli_proc.on('exit', (code, signal) => {
            if (!promise_handled) {
                dbg.error(`agent_cli exited for unknown reason. code=${code}, signal=${signal}`);
                promise_handled = true;
                let e = new Error(`agent_cli exited for unknown reason. code=${code}, signal=${signal}`);
                e.code = code;
                reject(e);
            }
        });

        agent_cli_proc.on('error', err => {
            dbg.error(`agent_cli exited with error`, err);
            if (!promise_handled) {
                promise_handled = true;
                reject(err);
            }
        });
    });
}

dbg.log0('deleting file', CONFIGURATION.SETUP_FILE);


async function clean_old_files() {
    try {
        // clean previous setup file (why?)
        await fs_utils.file_delete(CONFIGURATION.SETUP_FILE);

        // clean previous backup dir
        const files = await fs.promises.readdir(process.cwd());
        const backup_dir = files.find(file => file.startsWith('backup_'));
        if (backup_dir) {
            dbg.log0(`found backup dir ${backup_dir}, deleting old backup dir, and renaming ${backup_dir} to backup`);
            await fs_utils.folder_delete(CONFIGURATION.BACKUP_DIR);
            await fs.promises.rename(backup_dir, CONFIGURATION.BACKUP_DIR);
        }
    } catch (err) {
        dbg.error('failed on clean_old_files. continue as usual', err);
    }
}

async function upgrade_agent() {
    dbg.log0('starting agent upgrade. downloading upgrade file..');
    await _download_file(`https://${address}/public/${CONFIGURATION.SETUP_FILENAME}`, fs.createWriteStream(CONFIGURATION.SETUP_FILE));

    // make setup file executable
    await fs.promises.chmod(CONFIGURATION.SETUP_FILE, EXECUTABLE_MOD_VAL);

    // backup agent dir before upgrade:
    new_backup_dir += '_' + String(Date.now());
    dbg.log0('backup old code to backup dir', new_backup_dir);
    await fs_utils.create_path(new_backup_dir);
    for (const file of CONFIGURATION.PATHS_TO_BACKUP) {
        const old_path = path.join(process.cwd(), file);
        const new_path = path.join(new_backup_dir, file);
        dbg.log0(`moving ${old_path} to ${new_path}`);
        try {
            await fs.promises.rename(old_path, new_path);
        } catch (err) {
            dbg.error(`failed moving ${old_path} to ${new_path}`);
        }
    }
    await P.delay(2000); // Not sure why this is necessary, but it is.

    dbg.log0('running agent installation command: ', CONFIGURATION.INSTALLATION_COMMAND);
    await os_utils.exec(CONFIGURATION.INSTALLATION_COMMAND);

    // installation of new version should eventually stop this agent_wrapper instance and restart in the new version
    // wait for agent_wrapper to get killed
    await P.retry({
        attempts: CONFIGURATION.NUM_UPGRADE_WARNINGS,
        delay_ms: CONFIGURATION.TIME_BETWEEN_WARNINGS,
        func: attempts => {
            const msg = `Still upgrading. ${
                (CONFIGURATION.NUM_UPGRADE_WARNINGS - attempts) *
                (CONFIGURATION.TIME_BETWEEN_WARNINGS / 1000)
            } seconds have passed.`;
            if (attempts !== CONFIGURATION.NUM_UPGRADE_WARNINGS) dbg.warn(msg);
            throw new Error(msg);
        }
    });
}

async function main() {

    dbg.log0('starting agent_wrapper. OS info:', await os_utils.get_distro());

    await clean_old_files();

    // get server address from agent_conf
    address = url.parse(JSON.parse(await fs.promises.readFile(os_utils.get_agent_platform_path().concat('agent_conf.json'))).address).host;

    try {
        dbg.log0('Starting agent_cli');
        const agent_res = await run_agent_cli();
        dbg.log0(`agent_cli returned result: ${agent_res}`);

        switch (agent_res) {
            case 'UPGRADE':
                await upgrade_agent();
                break;
            case 'DUPLICATE':
                dbg.log0('Duplicate token. calling agent_cli with --duplicate flag');
                await os_utils.fork(CONFIGURATION.AGENT_CLI, ['--duplicate'], { stdio: 'ignore' });
                break;
            case 'NOTFOUND':
                dbg.log0('Agent not found. calling agent_cli with --notfound flag');
                await os_utils.fork(CONFIGURATION.AGENT_CLI, ['--notfound'], { stdio: 'ignore' });
                break;
            default:
                break;
        }
    } catch (err) {
        dbg.error('agent_wrapper failed with error. should exit and restart now', err);
    }
}

if (require.main === module) {
    main();
}
