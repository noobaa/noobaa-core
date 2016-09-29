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
const EXECUTABLE_MOD_VAL = 511;
const DUPLICATE_RET_CODE = 68;
const UPGRADE_TIMEOUT = 3;

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
    .then(() => { //TODO: this should also happen in throws, but upgrade handling needs to be handled better by this script first
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
    .then(() => P.delay(2000)) // TODO: investigate why this is necessary (but it is)
    .then(() => promise_utils.exec('setsid ' + SETUP_FILENAME + ' >> /dev/null'))
    .then(() => {
        let i = 0;
        dbg.log0('Upgrading Noobaa agent');
        (function loop() {
            if (i >= UPGRADE_TIMEOUT * 6) return P.reject('Upgrade process did not stop service.');
            i += 1;
            // This will not (or should not) run forever because when the service
            // installs, it stops the old service, which kills this thread.
            dbg.log0('Upgrading Noobaa agent...');
            setTimeout(loop, 10000);
        }());
    })
    .catch(err => dbg.error(err));
