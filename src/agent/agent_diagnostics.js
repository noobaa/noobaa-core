/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    collect_agent_diagnostics: collect_agent_diagnostics,
    pack_diagnostics: pack_diagnostics,
};

const fs = require('fs');
const path = require('path');

const fs_utils = require('../util/fs_utils');
const base_diagnostics = require('../util/base_diagnostics');

const TMP_WORK_DIR = base_diagnostics.get_tmp_workdir();

function collect_agent_diagnostics(storage_path) {
    let diag_log;

    //mkdir c:\tmp ?
    return base_diagnostics.prepare_diag_dir()
        .then(function() {
            diag_log = fs.createWriteStream(path.join(TMP_WORK_DIR, 'agent_diagnostics.log'))
                .on('error', err => console.error('ERROR in agent_diagnostics.log', err));
            return base_diagnostics.collect_basic_diagnostics()
                .catch(err => {
                    diag_log.write(`failed collecting basic diagnostics. ${err.message}`);
                });
        })
        .then(function() {
            if (fs.existsSync(process.cwd() + '/logs')) {
                //will take only noobaa.log and the first 9 zipped logs
                return fs_utils.full_dir_copy(process.cwd() + '/logs', TMP_WORK_DIR,
                        'noobaa?[1-9][0-9].log.gz')
                    .catch(err => {
                        diag_log.write(`failed collecting log files. ${err.message}`);
                    });
            }
        })
        .then(function() {
            if (fs.existsSync('/var/log/noobaalocalservice.log')) {
                return fs_utils.file_copy('/var/log/noobaalocalservice.log', TMP_WORK_DIR)
                    .catch(err => {
                        diag_log.write(`failed collecting noobaalocalservice.log. ${err.message}`);
                    });

            }
        })
        .then(function() {
            const file = fs.createWriteStream(TMP_WORK_DIR + '/ls_noobaa_storage.out');
            return fs_utils.read_dir_recursive({
                    root: storage_path,
                    depth: 5,
                    on_entry: entry => {
                        file.write(JSON.stringify(entry) + '\n');
                        // we cannot read the entire blocks_tree dir which gets huge
                        // so stop the recursion from t
                        if (entry.stat.isDirectory() &&
                            (entry.path.endsWith('blocks') ||
                                entry.path.endsWith('blocks_tree'))) {
                            return false;
                        }
                    },
                })
                .finally(() => file.end())
                .catch(err => {
                    diag_log.write(`failed reading ${storage_path} dir. ${err.message}`);
                });
        })
        .finally(() => diag_log.end())
        .then(() => undefined)
        .catch(err => {
            console.error('Error in collecting server diagnostics', err);
            throw new Error('Error in collecting server diagnostics ' + err);
        });
}

function pack_diagnostics(dst) {
    return base_diagnostics.pack_diagnostics(dst);
}
