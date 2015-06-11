'use strict';

// var _ = require('lodash');
var Q = require('q');
var promise_utils = require('../util/promise_utils');
var os_utils = require('../util/os_util');

module.exports = {
    collect_basic_diagnostics: collect_basic_diagnostics,
    collect_server_diagnostics: collect_server_diagnostics,
    collect_agent_diagnostics: collect_agent_diagnostics,

    pack_diagnostics: pack_diagnostics,
};

function collect_basic_diagnostics() {
    return Q.fcall(function() {
            return promise_utils.promised_spawn('rm', ['-rf', '/tmp/diag*'], process.cwd(), true);
        })
        .then(function() {
            return promise_utils.promised_spawn('rm', ['-rf', process.cwd() + '/build/public/diagnose.tgz'], process.cwd(), true);
        })
        .then(function() {
            return promise_utils.promised_spawn('mkdir', ['-p', '/tmp/diag'], process.cwd());
        })
        .then(function() {
            return promise_utils.full_dir_copy(process.cwd() + '/logs', '/tmp/diag');
        })
        .then(function() {
            return promise_utils.promised_spawn('cp', ['-f', process.cwd() + '/package.json', '/tmp/diag'], process.cwd());
        })
        .then(function() {
            return os_utils.top_single('/tmp/diag/top.out');
        })
        .then(function() {
            return os_utils.netstat_single('/tmp/diag/netstat.out');
        })
        .then(function() {
            return promise_utils.promised_exec('lsof >& /tmp/diag/lsof.out');
        })
        .then(function() {
            return 'ok';
        })
        .then(null, function(err) {
            console.error('Error in collecting basic diagnostics', err);
            throw new Error('Error in collecting basic diagnostics ' + err);
        });
}

function collect_server_diagnostics() {
    return Q.fcall(function() {
            return collect_basic_diagnostics();
        })
        .then(function() {
            return promise_utils.promised_spawn('cp', ['-f', '/var/log/noobaa_deploy.log', '/tmp/diag'], process.cwd());
        })
        .then(function() {
            return promise_utils.promised_spawn('cp', ['-f', process.cwd() + '/.env', '/tmp/diag/env'], process.cwd());
        })
        .then(null, function(err) {
            console.error('Error in collecting server diagnostics', err);
            throw new Error('Error in collecting server diagnostics ' + err);
        });
}

function collect_agent_diagnostics() {
    return Q.fcall(function() {
            return collect_basic_diagnostics();
        })
        .then(function() {

        })
        .then(null, function(err) {
            console.error('Error in collecting server diagnostics', err);
            throw new Error('Error in collecting server diagnostics ' + err);
        });
}

function pack_diagnostics(dst) {
    return Q.fcall(function() {
            return promise_utils.promised_exec('tar -zcvf ' + process.cwd() + dst + ' /tmp/diag/*');
        })
        .then(null, function(err) {
            console.error('Error in packing diagnostics', err);
            throw new Error('Error in packing diagnostics ' + err);
        });
}
