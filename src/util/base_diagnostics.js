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

var is_windows = (process.platform === "win32");

var TMP_WORK_DIR = is_windows ? process.env.ProgramData+'/diag' : '/tmp/diag';

function collect_basic_diagnostics(limit_logs_size) {
    return P.fcall(function() {
            return promise_utils.folder_delete(TMP_WORK_DIR);
            //return promise_utils.promised_spawn('rm', ['-rf', TMP_WORK_DIR], process.cwd(), true);
        })
        .then(function() {
            return promise_utils.file_delete(process.cwd() + '/build/public/diagnose.tgz');
            //return promise_utils.promised_spawn('rm', ['-rf', process.cwd() + '/build/public/diagnose.tgz'], process.cwd(), true);
        })
        .then(function() {
            console.log('creating ',TMP_WORK_DIR);
            return mkdirp.sync(TMP_WORK_DIR);
        })
        .then(function() {
            if (fs.existsSync(process.cwd() + '/logs')) {
                if (limit_logs_size) {
                    //will take only noobaa.log and the first 9 zipped logs
                    return promise_utils.full_dir_copy(process.cwd() + '/logs', TMP_WORK_DIR, 'noobaa?[1-9][0-9].log.gz');
                } else {
                    return promise_utils.full_dir_copy(process.cwd() + '/logs', TMP_WORK_DIR);
                }
            } else {
                return;
            }
        })
        .then(function() {
            if (fs.existsSync('/var/log/noobaa_local_service.log')) {
                return promise_utils.file_copy('/var/log/noobaa_local_service.log', TMP_WORK_DIR);
                //return promise_utils.promised_spawn('cp', ['-f', '/var/log/noobaa_local_service.log', TMP_WORK_DIR], process.cwd());
            } else {
                return;
            }
        })
        .then(function() {
            return promise_utils.file_copy( process.cwd() + '/package.json', TMP_WORK_DIR);
            //return promise_utils.promised_spawn('cp', ['-f', process.cwd() + '/package.json', TMP_WORK_DIR], process.cwd());
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
        return promise_utils.file_delete(dst);
    }).then(function(){
        console.log('pack - ',dst);
        return promise_utils.pack(dst,TMP_WORK_DIR);
//            return promise_utils.promised_exec('tar -zcvf ' + dst + ' ' + TMP_WORK_DIR + '/*');
        })
        .then(function() {
            return archive_diagnostics_pack(dst);
        })
        .then(null, function(err) {
            //The reason is that every distribution has its own issues.
            //We had a case where it failed due to file change during the file.
            //This flag can help, but not all the distributions support it
            //This is not valid for windows where we have our own executable
            console.error("failed to tar, an attempt to ignore file changes",err);
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
            console.log('archive_diagnostics_pack1');
            return mkdirp.sync(config.central_stats.previous_diag_packs_dir);
        })
        .then(function() {
            console.log('archive_diagnostics_pack2');
            return P.nfcall(fs.readdir, config.central_stats.previous_diag_packs_dir);
        })
        .then(function(files) {
            console.log('archive_diagnostics_pack3');

            //Check if current number of archived packs exceeds the max
            if (files.length === config.central_stats.previous_diag_packs_count) {
                //Delete the oldest pack
                console.log('archive_diagnostics_pack4');

                var sorted_files = _.orderBy(files);
                return P.nfcall(fs.unlink, config.central_stats.previous_diag_packs_dir + '/' + sorted_files[0]);
            } else {
                console.log('archive_diagnostics_pack5');

                return;
            }
        })
        .then(function() {
            console.log('archive_diagnostics_pack6');

            //Archive the current pack
            var now = new Date();
            var tail = now.getDate() + '-' + (now.getMonth() + 1) + '_' + now.getHours() + '-' + now.getMinutes();
            return promise_utils.file_copy(dst,config.central_stats.previous_diag_packs_dir + '/DiagPack_' + tail + '.tgz');
            //return promise_utils.file_copy('cp ' + dst + ' ' + config.central_stats.previous_diag_packs_dir + '/DiagPack_' + tail + '.tgz');
        })
        .then(null, function(err) {
            console.error('Error in archive_diagnostics_pack', err, err.stack);
            return;
        });
}
