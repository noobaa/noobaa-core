/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const dbg = require('../util/debug_module')(__filename);
const spawn = require('child_process').spawn;
const fs_utils = require('../util/fs_utils');
const promise_utils = require('../util/promise_utils');

function pre_upgrade(upgrade_file) {
    dbg.log0('UPGRADE:', 'pre_upgrade called with upgrade_file =', upgrade_file);
    var result = true;
    var message = '';

    //Add here whatever pre-requesites & checks we want to perform

    //Can also load the readme here

    return {
        result: result,
        message: message
    };
}

function do_upgrade(upgrade_file, is_clusterized, err_handler) {
    err_handler = err_handler || dbg.error;
    dbg.log0('UPGRADE file', upgrade_file, 'upgrade.js path:', process.cwd() + '/src/deploy/NVA_build');
    var fsuffix = new Date()
        .toISOString()
        .replace(/T/, '-')
        .substr(5, 11);
    var fname = '/var/log/noobaa_deploy_out_' + fsuffix + '.log';
    var stdout = fs.openSync(fname, 'a');
    var stderr = fs.openSync(fname, 'a');
    let cluster_str = is_clusterized ? 'cluster' : ' ';
    // remove /tmp/test/ before calling upgrade.js
    fs_utils.folder_delete('/tmp/test/');
    dbg.log0('command: /usr/local/bin/node ', process.cwd() + '/src/upgrade/upgrade.js --from_file ' + upgrade_file, '--fsuffix', fsuffix, '--cluster_str', cluster_str);
    let upgrade_proc = spawn('nohup', [
        '/usr/local/bin/node',
        process.cwd() + '/src/upgrade/upgrade.js',
        '--from_file', upgrade_file,
        '--fsuffix', fsuffix,
        '--cluster_str', cluster_str
    ], {
        detached: true,
        stdio: ['ignore', stdout, stderr],
        cwd: process.cwd()
    });
    upgrade_proc.on('exit', (code, signal) => {
        // upgrade.js is supposed to kill this node process, so it should not exit while
        // this node process is still running. treat exit as error.
        if (code) {
            const err_msg = `upgrade.js process was closed with code ${code} and signal ${signal}`;
            err_handler(err_msg);
        }
    });
    upgrade_proc.on('error', err_handler);
}

function test_major_version_change(upgrade_file) {
    const command = "tar -zxvf " + upgrade_file + " noobaa-core/package.json -O | grep version | awk '{print $2}'";
    return promise_utils.exec(command, {
            ignore_rc: false,
            return_stdout: true
        })
        .then(ver => {
            if (ver.charAt(1) === '1') {
                dbg.error('Unsupported upgrade, 2.X to 1.X');
                throw new Error('Unsupported upgrade path 2.X -> 1.X');
            }
        });
}

//Exports
exports.pre_upgrade = pre_upgrade;
exports.do_upgrade = do_upgrade;
exports.test_major_version_change = test_major_version_change;
