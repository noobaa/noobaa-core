/* Copyright (C) 2016 NooBaa */
'use strict';

var fs = require('fs');
var dbg = require('./debug_module')(__filename);
var time_utils = require('./time_utils');
var spawn = require('child_process').spawn;

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
    var fsuffix = time_utils.time_suffix();
    var fname = '/var/log/noobaa_deploy_out_' + fsuffix + '.log';
    var stdout = fs.openSync(fname, 'a');
    var stderr = fs.openSync(fname, 'a');
    let cluster_str = is_clusterized ? 'cluster' : '';
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
