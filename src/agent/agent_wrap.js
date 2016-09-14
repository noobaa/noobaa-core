"use strict";

process.chdir('/usr/local/noobaa');

const fs = require('fs');
const P = require('../util/promise');
const promise_utils = require('../util/promise_utils');
const request = require('request');
const url = require('url');
//const dbg = require('../util/debug_module')(__filename);

const SETUP_FILENAME = './noobaa-setup';
const EXECUTABLE_MOD_VAL = 511;

var address = "";


fs.readFileAsync('./agent_conf.json')
    .then(agent_conf_file => {
        address = url.parse(JSON.parse(agent_conf_file).address).host;
        //dbg.log0('Starting agent_cli');
        console.log('Starting agent_cli');
        return promise_utils.fork('./src/agent/agent_cli');
    }) //TODO: handle agent_conf not being where expected by inserting default value into address
    .catch(err => {
        if (err.code && err.code === 1) {
            //dbg.log0('Duplicate token');
            console.log('Duplicate token');
            return promise_utils.fork('./src/agent/agent_cli', '--duplicate');
        }
        throw err;
    })
    .then(() => {
        const output = fs.createWriteStream(SETUP_FILENAME);
        return new P((resolve, reject) => {
            console.log('Downloading Noobaa agent upgrade package');
            //dbg.log0('Downloading Noobaa agent upgrade package');
            request.get({
                    url: `https://${address}/public/noobaa-setup`,
                    strictSSL: false,
                    timeout: 2000
                })
                .on('error', err => reject(err))
                .pipe(output)
                .on('error', err => reject(err))
                .on('finish', resolve);
        });
    })
    .then(() => fs.chmodAsync(SETUP_FILENAME, EXECUTABLE_MOD_VAL))
    .then(() => {
        //dbg.log0('Upgrading Noobaa agent');
        console.log('Upgrading Noobaa agent');
        return promise_utils.spawn(SETUP_FILENAME);
    })
    .catch(err => console.error(err));
//dbg.error(err));
