'use strict';

module.exports = {
    collect_basic_diagnostics: collect_basic_diagnostics,
    collect_server_diagnostics: collect_server_diagnostics,
    collect_agent_diagnostics: collect_agent_diagnostics,
    write_agent_diag_file: write_agent_diag_file,

    pack_diagnostics: pack_diagnostics,
};

var _ = require('lodash');
var Q = require('q');
var fs = require('fs');
var os = require('os');
var mkdirp = require('mkdirp');
var promise_utils = require('../util/promise_utils');
var os_utils = require('../util/os_util');
var fs_utils = require('../util/fs_utils');
var config = require('../../config.js');
var dbg = require('noobaa-util/debug_module')(__filename);


try {
    var stats = require('../server/stats_aggregator');
} catch (err) {
    dbg.warn('stats_aggregator is unavailble');
}

var TMP_WORK_DIR = '/tmp/diag';

function collect_basic_diagnostics() {
    return Q.fcall(function() {
            return promise_utils.promised_spawn('rm', ['-rf', TMP_WORK_DIR], process.cwd(), true);
        })
        .then(function() {
            return promise_utils.promised_spawn('rm', ['-rf', process.cwd() + '/build/public/diagnose.tgz'], process.cwd(), true);
        })
        .then(function() {
            return mkdirp.sync(TMP_WORK_DIR);
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
            return collect_supervisor_logs();
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
        .then(function() {
            if (stats) {
                return stats.get_all_stats();
            } else {
                return;
            }
        })
        .then(function(restats) {
            if (stats) {
                var stats_data = JSON.stringify(restats);
                return Q.nfcall(fs.writeFile, TMP_WORK_DIR + '/phone_home_stats.out', stats_data);
            } else {
                return;
            }
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
            return fs_utils.list_directory_to_file(process.cwd() + '/agent_storage/', TMP_WORK_DIR + '/ls_agent_storage.out');
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
        .then(function() {
            return archive_diagnostics_pack(dst);
        })
        .then(null, function(err) {
            console.error('Error in packing diagnostics', err);
            throw new Error('Error in packing diagnostics ' + err);
        });
}

/*
 * Internal Utils
 */

//Collect supervisor logs, only do so on linux platforms and not on OSX (WA for local server run)
function collect_supervisor_logs() {
    if (os.type() === 'Linux') {
        return Q.fcall(function() {
                return promise_utils.full_dir_copy('/tmp/supervisor', TMP_WORK_DIR);
            })
            .then(null, function(err) {
                console.error('Error in collecting supervisor logs', err);
                throw new Error('Error in collecting supervisor logs ' + err);
            });
    } else if (os.type() === 'Darwin') {
        console.log('Skipping supervisor logs collection on local OSX server');
    }
}

//Archive the current diagnostics pack, save to
function archive_diagnostics_pack(dst) {
    return Q.fcall(function() {
            return mkdirp.sync(config.central_stats.previous_diag_packs_dir);
        })
        .then(function() {
            return Q.nfcall(fs.readdir, config.central_stats.previous_diag_packs_dir);
        })
        .then(function(files) {
            //Check if current number of archived packs exceeds the max
            if (files.length === config.central_stats.previous_diag_packs_count) {
                //Delete the oldest pack
                var sorted_files = _.sortByOrder(files);
                return Q.nfcall(fs.unlink, config.central_stats.previous_diag_packs_dir + '/' + sorted_files[0]);
            } else {
                return;
            }
        })
        .then(function() {
            //Archive the current pack
            var now = new Date();
            var tail = now.getDate() + '-' + (now.getMonth() + 1) + '_' + now.getHours() + '-' + now.getMinutes();

            return promise_utils.promised_exec('cp ' + dst + ' ' + config.central_stats.previous_diag_packs_dir + '/DiagPack_' + tail + '.tgz');
        })
        .then(null, function(err) {
            console.error('Error in archive_diagnostics_pack', err, err.stack);
            return;
        });
}
