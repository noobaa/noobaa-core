/* Copyright (C) 2016 NooBaa */
"use strict";

/*
 * This script wraps agent_cli
 * it keeps it alive and should also handle ugprades, repairs etc.
 */
const os = require('os');
const fs = require('fs');
const url = require('url');
const request = require('request');
const path = require('path');

const WIN_AGENT = os.type() === 'Windows_NT';

const P = require('../util/promise');
const fs_utils = require('../util/fs_utils');
const promise_utils = require('../util/promise_utils');
const dbg = require('../util/debug_module')(__filename);
dbg.set_process_name('agent_wrapper');

const DUPLICATE_RET_CODE = 68;
const NOTFOUND_RET_CODE = 69;
const EXECUTABLE_MOD_VAL = 511;

const CONFIGURATION = {
    SETUP_FILENAME: WIN_AGENT ? 'noobaa-setup.exe' : 'noobaa-setup',
    PROCESS_DIR: path.join(__dirname, '..', '..'),
    AGENT_CLI: './src/agent/agent_cli',
    NUM_UPGRADE_WARNINGS: WIN_AGENT ? 3 : 18, // for windows it seems unnecessary to wait. reducing for now
    TIME_BETWEEN_WARNINGS: 10000,
    PATHS_TO_BACKUP: ['src', 'node_modules', 'build'],
};

CONFIGURATION.SETUP_FILE = path.join(CONFIGURATION.PROCESS_DIR, CONFIGURATION.SETUP_FILENAME);
CONFIGURATION.INSTALLATION_COMMAND = WIN_AGENT ? `"${CONFIGURATION.SETUP_FILE}" /S` :
    `setsid ${CONFIGURATION.SETUP_FILE} >> /dev/null`;

process.chdir(path.join(__dirname, '..', '..'));
CONFIGURATION.BACKUP_DIR = path.join(process.cwd(), `backup`);

var address = "";
let new_backup_dir = CONFIGURATION.BACKUP_DIR;

dbg.log0('deleting file', CONFIGURATION.SETUP_FILE);
fs_utils.file_delete(CONFIGURATION.SETUP_FILE)
    // clean previous backup folder
    .then(() => fs.readdirAsync(process.cwd()))
    .then(files => files.find(file => file.startsWith('backup_')))
    .then(backup_dir => {
        if (backup_dir) {
            dbg.log0(`found backup dir ${backup_dir}, deleting old backup dir, and renaming ${backup_dir} to backup`);
            return fs_utils.folder_delete(CONFIGURATION.BACKUP_DIR)
                .then(() => fs.renameAsync(backup_dir, CONFIGURATION.BACKUP_DIR));
        }
    })
    .catch(console.error)
    .then(() => fs.readFileAsync('./agent_conf.json'))
    .then(agent_conf_file => {
        dbg.log0('found agent_conf: ', String(agent_conf_file));
        address = url.parse(JSON.parse(agent_conf_file).address).host;
        dbg.log0('Starting agent_cli');
        return promise_utils.fork(CONFIGURATION.AGENT_CLI, undefined, { stdio: 'ignore' });
    })
    .catch(err => {
        dbg.log0('agent_cli exited with error code', err.code);
        if (err.code && err.code === DUPLICATE_RET_CODE) {
            dbg.log0('Duplicate token. calling agent_cli with --duplicate flag');
            return promise_utils.fork(CONFIGURATION.AGENT_CLI, ['--duplicate'], { stdio: 'ignore' });
        } else if (err.code && err.code === NOTFOUND_RET_CODE) {
            dbg.log0('Agent not found. calling agent_cli with --notfound flag');
            return promise_utils.fork(CONFIGURATION.AGENT_CLI, ['--notfound'], { stdio: 'ignore' });
        }
        dbg.log0('unkown error code. rethorwing');
        throw err;
    })
    // Currently, to signal an upgrade is required agent_cli exits with 0.
    // It should also upgrade when agent_cli throws,
    // but upgrade needs to be handled better by this script first
    .then(() => {
        dbg.log0('agent_cli exited with code 0. downloading upgrade file');
        const output = fs.createWriteStream(CONFIGURATION.SETUP_FILE);
        return new P((resolve, reject) => {
            const request_url = `https://${address}/public/${CONFIGURATION.SETUP_FILENAME}`;
            dbg.log0(`Downloading Noobaa agent upgrade package from: ${request_url}`);
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
    // before running setup move old code to backup dir
    .then(() => {
        new_backup_dir += '_' + String(Date.now());
        dbg.log0('backup old code to backup dir', new_backup_dir);
        return fs_utils.create_path(new_backup_dir)
            .then(() => P.each(CONFIGURATION.PATHS_TO_BACKUP, file => {
                const old_path = path.join(process.cwd(), file);
                const new_path = path.join(new_backup_dir, file);
                dbg.log0(`moving ${old_path} to ${new_path}`);
                return fs.renameAsync(old_path, new_path);
            }))
            .catch(err => dbg.error('failed in moving old code to backup dir', err));
    })
    .then(() => P.delay(2000)) // Not sure why this is necessary, but it is.
    .then(() => {
        dbg.log0('running agent installation command: ', CONFIGURATION.INSTALLATION_COMMAND);
        return promise_utils.exec(CONFIGURATION.INSTALLATION_COMMAND);
    })
    .then(() => promise_utils.retry(CONFIGURATION.NUM_UPGRADE_WARNINGS,
        CONFIGURATION.TIME_BETWEEN_WARNINGS, attempts => {
            let msg = `Still upgrading. ${(CONFIGURATION.NUM_UPGRADE_WARNINGS - attempts) * (CONFIGURATION.TIME_BETWEEN_WARNINGS / 1000)} seconds have passed.`;
            if (attempts !== CONFIGURATION.NUM_UPGRADE_WARNINGS) dbg.warn(msg);
            throw new Error(msg);
        }))
    .catch(err => dbg.error(err));
