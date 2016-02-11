'use strict';

/*
 * Basic (Common) Diagnostics between server and agent,
 * see agent diagnostics and server diagnostics as well
 */

module.exports = {
    collect_basic_diagnostics: collect_basic_diagnostics,
    write_agent_diag_file: write_agent_diag_file,
    pack_diagnostics: pack_diagnostics,
};

var _ = require('lodash');
var P = require('../util/promise');
var fs = require('fs');
var mkdirp = require('mkdirp');
var promise_utils = require('../util/promise_utils');
var os_utils = require('../util/os_util');
var config = require('../../config.js');

var TMP_WORK_DIR = '/tmp/diag';

function collect_basic_diagnostics() {
    return P.fcall(function() {
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

function write_agent_diag_file(data) {
    return P.nfcall(fs.writeFile, TMP_WORK_DIR + '/from_agent_diag.tgz', data);
}

function pack_diagnostics(dst) {
    return P.fcall(function() {
            return promise_utils.promised_exec('tar -zcvf ' + dst + ' ' + TMP_WORK_DIR + '/*');
        })
        .then(function() {
            return archive_diagnostics_pack(dst);
        })
        .then(null, function(err) {
            //The reason is that every distribution has its own issues.
            //We had a case where it failed due to file change during the file.
            //This flag can help, but not all the distributions support it
            console.error("failed to tar, an attempt to ignore file changes");
            return P.fcall(function() {
                    return promise_utils.promised_exec('tar --warning=no-file-changed -zcvf ' + dst + ' ' + TMP_WORK_DIR + '/*');
                })
                .then(function() {
                    return archive_diagnostics_pack(dst);
                })
                .then(null, function(err) {
                    console.error('Error in packing diagnostics', err);
                    throw new Error('Error in packing diagnostics ' + err);
                });
        });
}

/*
 * Internal Utils
 */

//Archive the current diagnostics pack, save to
function archive_diagnostics_pack(dst) {
    return P.fcall(function() {
            return mkdirp.sync(config.central_stats.previous_diag_packs_dir);
        })
        .then(function() {
            return P.nfcall(fs.readdir, config.central_stats.previous_diag_packs_dir);
        })
        .then(function(files) {
            //Check if current number of archived packs exceeds the max
            if (files.length === config.central_stats.previous_diag_packs_count) {
                //Delete the oldest pack
                var sorted_files = _.orderBy(files);
                return P.nfcall(fs.unlink, config.central_stats.previous_diag_packs_dir + '/' + sorted_files[0]);
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
