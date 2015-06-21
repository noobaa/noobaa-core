'use strict';

// var _ = require('lodash');
var Q = require('q');
var fs = require('fs');
var promise_utils = require('../util/promise_utils');
var os_utils = require('../util/os_util');
var dbg = require('noobaa-util/debug_module')(__filename);

module.exports = {
    collect_basic_diagnostics: collect_basic_diagnostics,
    collect_server_diagnostics: collect_server_diagnostics,
    collect_agent_diagnostics: collect_agent_diagnostics,
    write_agent_diag_file: write_agent_diag_file,

    pack_diagnostics: pack_diagnostics,
};

var TMP_WORK_DIR = '/tmp/diag';

function collect_basic_diagnostics() {
    return Q.fcall(function() {
            return promise_utils.promised_spawn('rm', ['-rf', TMP_WORK_DIR], process.cwd(), true);
        })
        .then(function() {
            return promise_utils.promised_spawn('rm', ['-rf', process.cwd() + '/build/public/diagnose.tgz'], process.cwd(), true);
        })
        .then(function() {
            return promise_utils.promised_spawn('mkdir', ['-p', TMP_WORK_DIR], process.cwd());
        })
        .then(function() {
            return promise_utils.full_dir_copy(process.cwd() + '/logs', TMP_WORK_DIR);
        })
        .then(function() {
            return promise_utils.promised_spawn('cp', ['-f', process.cwd() + '/package.json', TMP_WORK_DIR], process.cwd());
        })
        .then(function() {
            return os_utils.netstat_single(TMP_WORK_DIR + '/netstat.out');
        })
        .then(function() {
            return 'ok';
        })
        .then(null, function(err) {
            console.error('Error in collecting basic diagnostics', err);
            throw new Error('Error in collecting basic diagnostics ' + err);
        });
}

//TODO: Add temp collection dir as param
function collect_server_diagnostics() {
    return Q.fcall(function() {
            return collect_basic_diagnostics();
        })
        .then(function() {
            return promise_utils.promised_spawn('cp', ['-f', '/var/log/noobaa_deploy.log', TMP_WORK_DIR], process.cwd());
        })
        .then(function() {
            return promise_utils.promised_spawn('cp', ['-f', process.cwd() + '/.env', TMP_WORK_DIR + '/env'], process.cwd());
        })
        .then(function() {
            return os_utils.top_single(TMP_WORK_DIR + '/top.out');
        })
        .then(function() {
            return promise_utils.promised_exec('lsof >& ' + TMP_WORK_DIR + '/lsof.out');
        })
        .then(null, function(err) {
            console.error('Error in collecting server diagnostics', err);
            throw new Error('Error in collecting server diagnostics ' + err);
        });
}

function collect_agent_diagnostics() {
    //mkdir c:\tmp ?
    return Q.fcall(function() {
            return collect_basic_diagnostics();
        })
        .then(function() {
            return os_utils.dir_agent_storage(TMP_WORK_DIR + '/ls_agent_storage.out');
        })
        .then(null, function(err) {
            console.error('Error in collecting server diagnostics', err);
            throw new Error('Error in collecting server diagnostics ' + err);
        });
}

function write_agent_diag_file(data) {
    return Q.nfcall(fs.writeFile, TMP_WORK_DIR + '/agent_diag.tgz', data);
}

function pack_diagnostics(dst) {
    return Q.fcall(function() {
            return promise_utils.promised_exec('tar -zcvf ' + dst + ' ' + TMP_WORK_DIR + '/*');
        })
        .then(null, function(err) {
            console.error('Error in packing diagnostics', err);
            throw new Error('Error in packing diagnostics ' + err);
        });
}
