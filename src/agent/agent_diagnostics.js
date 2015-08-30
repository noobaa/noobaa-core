'use strict';

module.exports = {
    collect_agent_diagnostics: collect_agent_diagnostics,
    pack_diagnostics: pack_diagnostics,
};

var base_diagnostics = require('../util/base_diagnostics');
var fs_utils = require('../util/fs_utils');
var P = require('../util/promise');

var TMP_WORK_DIR = '/tmp/diag';

function collect_agent_diagnostics() {
    //mkdir c:\tmp ?
    return P.fcall(function() {
            return base_diagnostics.collect_basic_diagnostics();
        })
        .then(function() {
            return fs_utils.list_directory_to_file(process.cwd() + '/agent_storage/', TMP_WORK_DIR + '/ls_agent_storage.out');
        })
        .then(null, function(err) {
            console.error('Error in collecting server diagnostics', err);
            throw new Error('Error in collecting server diagnostics ' + err);
        });
}

function pack_diagnostics(dst) {
    return base_diagnostics.pack_diagnostics(dst);
}
