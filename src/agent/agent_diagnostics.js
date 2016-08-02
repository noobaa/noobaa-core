'use strict';

module.exports = {
    collect_agent_diagnostics: collect_agent_diagnostics,
    pack_diagnostics: pack_diagnostics,
};

const P = require('../util/promise');
const fs = require('fs');
const fs_utils = require('../util/fs_utils');
const base_diagnostics = require('../util/base_diagnostics');

const TMP_WORK_DIR = '/tmp/diag';

function collect_agent_diagnostics() {
    //mkdir c:\tmp ?
    return P.fcall(function() {
            let limit_logs_size = true;
            return base_diagnostics.collect_basic_diagnostics(limit_logs_size);
        })
        .then(function() {
            const file = fs.createWriteStream(TMP_WORK_DIR + '/ls_agent_storage.out');
            return fs_utils.read_dir_recursive({
                    root: 'agent_storage',
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
                .finally(() => file.end());
        })
        .return()
        .catch(err => {
            console.error('Error in collecting server diagnostics', err);
            throw new Error('Error in collecting server diagnostics ' + err);
        });
}

function pack_diagnostics(dst) {
    return base_diagnostics.pack_diagnostics(dst);
}
