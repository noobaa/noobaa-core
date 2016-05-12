'use strict';

module.exports = {
    collect_server_diagnostics: collect_server_diagnostics,
    pack_diagnostics: pack_diagnostics,
    write_agent_diag_file: write_agent_diag_file,
};

var TMP_WORK_DIR = '/tmp/diag';

var stats_aggregator = require('../system_services/stats_aggregator');
var P = require('../../util/promise');
var os = require('os');
var fs = require('fs');
var os_utils = require('../../util/os_util');
var promise_utils = require('../../util/promise_utils');
var base_diagnostics = require('../../util/base_diagnostics');

//TODO: Add temp collection dir as param
function collect_server_diagnostics(req) {
    return P.fcall(function() {
            let limit_logs_size = false;
            return base_diagnostics.collect_basic_diagnostics(limit_logs_size);
        })
        .then(function() {
            return collect_supervisor_logs();
        })
        .then(function() {
            return promise_utils.promised_exec('cp -f /var/log/noobaa_deploy* ' + TMP_WORK_DIR, true);
        })
        .then(function() {
            return promise_utils.promised_exec('cp -f /var/log/noobaa.log* ' + TMP_WORK_DIR, true);
        })
        .then(function() {
            return promise_utils.promised_spawn('cp', ['-f', process.cwd() + '/.env', TMP_WORK_DIR + '/env'], process.cwd(), true);
        })
        .then(function() {
            return os_utils.top_single(TMP_WORK_DIR + '/top.out');
        })
        .then(function() {
            return promise_utils.promised_exec('cp -f /etc/noobaa* ' + TMP_WORK_DIR, true);
        })
        .then(function() {
            return promise_utils.promised_exec('lsof &> ' + TMP_WORK_DIR + '/lsof.out', true);
        })
        .then(function() {
            return promise_utils.promised_exec('chkconfig &> ' + TMP_WORK_DIR + '/chkconfig.out', true);
        })
        .then(function() {
            return collect_ntp_diagnostics();
        })
        .then(function() {
            if (stats_aggregator) {
                return stats_aggregator.get_all_stats(req);
            } else {
                return;
            }
        })
        .catch(function(err) {
            console.error('Failed to collect stats', err.stack || err);
        })
        .then(function(restats) {
            if (stats_aggregator) {
                var stats_data = JSON.stringify(restats);
                return P.nfcall(fs.writeFile, TMP_WORK_DIR + '/phone_home_stats.out', stats_data);
            } else {
                return;
            }
        })
        .catch(function(err) {
            console.error('Failed to collect phone_home_stats', err.stack || err);
        })
        .then(null, function(err) {
            console.error('Error in collecting server diagnostics (should never happen)', err);
            throw new Error('Error in collecting server diagnostics ' + err);
        });
}

function pack_diagnostics(dst) {
    return base_diagnostics.pack_diagnostics(dst);
}

function write_agent_diag_file(data) {
    return base_diagnostics.write_agent_diag_file(data);
}

function collect_ntp_diagnostics() {
    let ntp_diag = TMP_WORK_DIR + '/ntp.diag';
    return promise_utils.promised_exec('echo "### NTP diagnostics ###" >' + ntp_diag, true)
        .then(() => promise_utils.promised_exec('echo "\ncontent of /etc/ntp.conf:" &>>' + ntp_diag, true))
        .then(() => promise_utils.promised_exec('cat /etc/ntp.conf &>>' + ntp_diag, true))
        .then(() => promise_utils.promised_exec('echo "\n\n" &>>' + ntp_diag, true))
        .then(() => promise_utils.promised_exec('ls -l /etc/localtime &>>' + ntp_diag, true))
        .then(() => promise_utils.promised_exec('echo "\n\nntpstat:" &>>' + ntp_diag, true))
        .then(() => promise_utils.promised_exec('ntpstat &>>' + ntp_diag, true))
        .then(() => promise_utils.promised_exec('echo "\n\ndate:" &>>' + ntp_diag, true))
        .then(() => promise_utils.promised_exec('date &>>' + ntp_diag, true))
        .then(() => promise_utils.promised_exec('echo "\n\nntpdate:" &>>' + ntp_diag, true))
        .then(() => promise_utils.promised_exec('ntpdate &>>' + ntp_diag, true))
        .then(() => promise_utils.promised_exec('echo "\n\nntptime:" &>>' + ntp_diag, true))
        .then(() => promise_utils.promised_exec('ntptime &>>' + ntp_diag, true));
}

//Collect supervisor logs, only do so on linux platforms and not on OSX (WA for local server run)
function collect_supervisor_logs() {
    if (os.type() === 'Linux') {
        return P.fcall(function() {
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
