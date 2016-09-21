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

let fd = fs.openSync('/tmp/setupLog.txt', 'a');

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
        promise_utils.spawn(SETUP_FILENAME, [], {
            stdio: 'ignore',
            detached: true
        });
        setTimeout(() => {
            dbg.log0('Upgrading...');
        }, 10000);
    })
    .catch(err => dbg.error(err));
