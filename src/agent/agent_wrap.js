"use strict";

/*
 * This script wraps agent_cli
 * it keeps it alive and should also handle ugprades, repairs etc.
 */
process.chdir('/usr/local/noobaa');

const fs = require('fs');
const P = require('../util/promise');
const promise_utils = require('../util/promise_utils');
const request = require('request');
const url = require('url');
const dbg = require('../util/debug_module')(__filename);


const SETUP_FILENAME = './noobaa-setup';
const UPGRADE_SCRIPT = './agent_linux_upgrader.sh';
const EXECUTABLE_MOD_VAL = 511;
const DUPLICATE_RET_CODE = 68;

var address = "";

fs.readFileAsync('./agent_conf.json')
    .then(agent_conf_file => {
        address = url.parse(JSON.parse(agent_conf_file).address).host;
        dbg.log0('Starting agent_cli');
        return promise_utils.fork('./src/agent/agent_cli');
    })
    .catch(err => {
        if (err.code && err.code === DUPLICATE_RET_CODE) {
            dbg.log0('Duplicate token');
            return promise_utils.fork('./src/agent/agent_cli', '--duplicate');
        }
        throw err;
    }) // Currently, to signal an upgrade is required agent_cli exits with 0
    .then(() => {
        const output = fs.createWriteStream(SETUP_FILENAME);
        return new P((resolve, reject) => {
            dbg.log0('Downloading Noobaa agent upgrade package');
            request.get({
                    url: `https://${address}/public/noobaa-setup`,
                    strictSSL: false,
                    timeout: 20000
                })
                .on('error', err => reject(err))
                .pipe(output)
                .on('error', err => reject(err))
                .on('finish', resolve);
        });
    })
    .then(() => fs.chmodAsync(SETUP_FILENAME, EXECUTABLE_MOD_VAL))
    .then(() => fs.chmodAsync(UPGRADE_SCRIPT, EXECUTABLE_MOD_VAL))
    .then(() => {
        dbg.log0('Upgrading Noobaa agent');
        return promise_utils.spawn(UPGRADE_SCRIPT);
    })
    .then(() => (function loop() {
        // This will not (or should not) run forever because when the service
        // installs, it stops the old service, which kills this thread.
        dbg.log0('Upgrading Noobaa agent...');
        setTimeout(loop, 30000);
    }()))
    .catch(err => dbg.error(err));
