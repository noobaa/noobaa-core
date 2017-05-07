/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const dbg = require('./debug_module')(__filename);
const spawn = require('child_process').spawn;
const fs_utils = require('./fs_utils');

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

function do_upgrade(upgrade_file, is_clusterized) {
    dbg.log0('UPGRADE file', upgrade_file, 'upgrade.sh path:', process.cwd() + '/src/deploy/NVA_build');
    var fsuffix = new Date()
        .toISOString()
        .replace(/T/, '-')
        .substr(5, 11);
    var fname = '/var/log/noobaa_deploy_out_' + fsuffix + '.log';
    var stdout = fs.openSync(fname, 'a');
    var stderr = fs.openSync(fname, 'a');
    let cluster_str = is_clusterized ? 'cluster' : '';
    // remove /tmp/test/ before calling upgrade.sh
    fs_utils.folder_delete('/tmp/test/');
    dbg.log0('command:', process.cwd() + '/src/deploy/NVA_build/upgrade.sh from_file ' + upgrade_file, 'fsuffix', fsuffix, cluster_str);
    spawn('nohup', [process.cwd() + '/src/deploy/NVA_build/upgrade.sh',
        'from_file', upgrade_file,
        'fsuffix', fsuffix,
        cluster_str
    ], {
        detached: true,
        stdio: ['ignore', stdout, stderr],
        cwd: '/tmp'
    });
}

//Exports
exports.pre_upgrade = pre_upgrade;
exports.do_upgrade = do_upgrade;
