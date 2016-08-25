"use strict";

const fs = require('fs');
const P = require('../util/promise');
const promise_utils = require('../util/promise_utils');
const request = require('request');
//const IP_PORT_REGEX = /(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?):[0-9]{1,4}/;
const url = require('url');
const SETUP_FILENAME = './noobaa-setup';
const EXECUTABLE_MOD_VAL = 511;

var address = "";

process.chdir('/usr/local/noobaa');

fs.readFileAsync('./agent_conf.json')
    .then(agent_conf_file => {
        address = url.parse(JSON.parse(agent_conf_file).address).host;
        return promise_utils.fork('./src/agent/agent_cli');
    }) //TODO: handle agent_conf not being where expected by inserting default value into address
    .catch(err => {
        if (err.code && err.code === 1) {
            console.log('Upgrading Noobaa agent...');
            return promise_utils.fork('./src/agent/agent_cli', '--duplicate');
        }
        throw err;
    })
    .then(() =>
        new P((resolve, reject) => {
            console.log('Downloading Noobaa agent upgrade package...');
            const input = request({
                url: `https://${address}/public/noobaa-setup`,
                strictSSL: false,
                timeout: 2000
            });
            const output = fs.createWriteStream(SETUP_FILENAME);
            input.pipe(output);
            input.on('error', err => {
                reject(err);
            });
            output.on('error', err => {
                reject(err);
            });
            output.on('end', () => {
                resolve();
            });
        }))
    .then(() => fs.chmodAsync(SETUP_FILENAME, EXECUTABLE_MOD_VAL))
    .then(() => {
        console.log('Upgrading Noobaa agent...');
        return promise_utils.spawn(SETUP_FILENAME);
    })
    .catch(err => {
        console.error(`An error occured: ${err}`);
    });
