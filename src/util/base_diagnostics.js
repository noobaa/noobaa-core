/* Copyright (C) 2016 NooBaa */
/*
 * Basic (Common) Diagnostics between server and agent,
 * see agent diagnostics and server diagnostics as well
 */
'use strict';

const _ = require('lodash');
const fs = require('fs');
const path = require('path');

const P = require('./promise');
const dbg = require('./debug_module')(__filename);
const config = require('../../config.js');
const fs_utils = require('./fs_utils');

const TMP_WORK_DIR = get_tmp_workdir();


function prepare_diag_dir() {
    return P.fcall(function() {
            return fs_utils.folder_delete(TMP_WORK_DIR);
        })
        .then(function() {
            return fs_utils.file_delete(process.cwd() + '/build/public/diagnose.tgz');
        })
        .then(function() {
            console.log('creating ', TMP_WORK_DIR);
            return fs_utils.create_path(TMP_WORK_DIR);
        });
}

function collect_basic_diagnostics(limit_logs_size) {
    return P.fcall(
            () => fs_utils.file_copy(
                process.cwd() + '/package.json',
                TMP_WORK_DIR
            )
        )
        .then(() => 'ok')
        .catch(err => {
            console.error('Error in collecting basic diagnostics', err);
        });
}

function write_agent_diag_file(data) {
    return fs.promises.writeFile(TMP_WORK_DIR + '/from_agent_diag.tgz', data);
}

function pack_diagnostics(dst, working_dir) {
    const work_dir = working_dir || TMP_WORK_DIR;
    return P.resolve()
        .then(() => fs_utils.file_delete(dst))
        .then(() => fs_utils.create_path(path.dirname(dst)))
        .then(() => fs_utils.tar_pack(dst, work_dir))
        .then(() => dbg.log0('Successfully created a tar package'))
        .catch(err => {
            //The reason is that every distribution has its own issues.
            //We had a case where it failed due to file change during the file.
            //This flag can help, but not all the distributions support it
            //This is not valid for windows where we have our own executable
            console.error("failed to tar, an attempt to ignore file changes", err);
            return P.resolve()
                .then(() => fs_utils.tar_pack(dst, work_dir, 'ignore_file_changes'))
                .catch(err2 => {
                    console.error('failed to tar with ignore file changes');
                    throw new Error('Error while creating tar package ' + err2);
                });
        })
        .then(() => fs.promises.stat(dst))
        .then(stats => dbg.log0(`created diag tar package sized ${stats.size}`))
        .then(() => archive_diagnostics_pack(dst))
        .catch(err => {
            console.error('Error in packing diagnostics', err);
            throw new Error('Error in packing diagnostics ' + err);
        });
}

/*
 * Internal Utils
 */

//Archive the current diagnostics pack, save to
function archive_diagnostics_pack(dst) {
    return P.fcall(function() {
            console.log('archive_diagnostics_pack1');
            return fs_utils.create_path(config.central_stats.previous_diag_packs_dir);
        })
        .then(function() {
            console.log('archive_diagnostics_pack2');
            return fs.promises.readdir(config.central_stats.previous_diag_packs_dir);
        })
        .then(function(files) {
            console.log('archive_diagnostics_pack3');

            //Check if current number of archived packs exceeds the max
            if (files.length === config.central_stats.previous_diag_packs_count) {
                //Delete the oldest pack
                console.log('archive_diagnostics_pack4');

                var sorted_files = _.orderBy(files);
                return fs.promises.unlink(config.central_stats.previous_diag_packs_dir + '/' + sorted_files[0]);
            } else {
                console.log('archive_diagnostics_pack5');
            }
        })
        .then(function() {
            console.log('archive_diagnostics_pack6');
            //Archive the current pack
            var now = new Date();
            var tail = now.getDate() + '-' + (now.getMonth() + 1) + '_' + now.getHours() + '-' + now.getMinutes();
            return fs_utils.file_copy(dst, config.central_stats.previous_diag_packs_dir + '/DiagPack_' + tail + '.tgz');
        })
        .then(null, function(err) {
            console.error('Error in archive_diagnostics_pack', err, err.stack);
        });
}

function get_tmp_workdir() {
    let is_windows = (process.platform === "win32");
    return is_windows ? process.env.ProgramData + '/diag' : '/tmp/diag';
}


// EXPORTS
exports.prepare_diag_dir = prepare_diag_dir;
exports.collect_basic_diagnostics = collect_basic_diagnostics;
exports.write_agent_diag_file = write_agent_diag_file;
exports.pack_diagnostics = pack_diagnostics;
exports.get_tmp_workdir = get_tmp_workdir;
