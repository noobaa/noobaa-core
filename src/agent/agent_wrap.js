"use strict";

/*
 * This script wrapps agent_cli
 * it makes sure that when it exists, it either upgrades, or reopens as necessary
 */
process.chdir('/usr/local/noobaa');

const fs = require('fs');
//const P = require('../util/promise');
const promise_utils = require('../util/promise_utils');
//const request = require('request');
const url = require('url');
const dbg = require('../util/debug_module')(__filename);

const SETUP_FILENAME = './noobaa-setup';
const EXECUTABLE_MOD_VAL = 511;

var address = "";

const out1 = fs.openSync('/tmp/setupLog.txt', 'a');
const err1 = fs.openSync('/tmp/setupLog.txt', 'a');

fs.readFileAsync('./agent_conf.json')
    .then(agent_conf_file => {
        address = url.parse(JSON.parse(agent_conf_file).address).host;
        dbg.log0('Starting agent_cli');
        return promise_utils.fork('./src/agent/agent_cli');
    }) //TODO: handle agent_conf not being where expected by inserting default value into address
    .catch(err => {
        if (err.code && err.code === 1) { // TODO: is this still 1?
            dbg.log0('Duplicate token');
            return promise_utils.fork('./src/agent/agent_cli', '--duplicate');
        }
        throw err;
    })
    .then(() => fs.chmodAsync(SETUP_FILENAME, EXECUTABLE_MOD_VAL))
    .then(() => {
        dbg.log0('Upgrading Noobaa agent');
        let done = false;
        promise_utils.spawn(SETUP_FILENAME, [], {
            stdio: ['ignore', out1, err1],
            detached: true
        });
        promise_utils.exec('ps -elf | grep node', null, true).then((stdout) => dbg.log0(stdout));
        /*install_child.on('exit', () => {
            done = true;
        });*/
        dbg.log0('Upgrading...');
        (function loop() {
            setTimeout(loop, 10000);
        }());
        dbg.log0('Done upgrading');
    })
    .catch(err => dbg.error(err));
