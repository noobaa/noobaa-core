/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const path = require('path');

const P = require('../../util/promise');
const os_utils = require('../../util/os_utils');
const promise_utils = require('../../util/promise_utils');
const base_diagnostics = require('../../util/base_diagnostics');
const stats_aggregator = require('../system_services/stats_aggregator');
const system_store = require('../system_services/system_store').get_instance();
const server_rpc = require('../server_rpc');


const TMP_WORK_DIR = '/tmp/diag';
const DIAG_LOG_FILE = TMP_WORK_DIR + '/diagnostics_collection.log';
const LONG_EXEC_TIMEOUT = 60 * 1000;
const SHORT_EXEC_TIMEOUT = 5 * 1000;

//TODO: Add temp collection dir as param
function collect_server_diagnostics(req) {
    return base_diagnostics.prepare_diag_dir()
        .then(() => base_diagnostics.collect_basic_diagnostics())
        .then(() => {

            // operations for diagnostics that can take place in parallel
            const operations = [
                () => collect_supervisor_logs()
                .then(() => diag_log('collected supervisor logs successfully'))
                .catch(err => diag_log('collect_supervisor_logs failed with error: ' + err)),

                () => promise_utils.exec('cp -fp /log/noobaa_deploy* ' + TMP_WORK_DIR, {
                    ignore_rc: false,
                    return_stdout: false,
                    timeout: LONG_EXEC_TIMEOUT
                })
                .then(() => diag_log('collected noobaa_deploy logs successfully'))
                .catch(err => diag_log('collecting noobaa_deploy.log failed with error: ' + err)),

                () => promise_utils.exec('cp -fp /log/noobaa.log* ' + TMP_WORK_DIR, {
                    ignore_rc: false,
                    return_stdout: false,
                    timeout: LONG_EXEC_TIMEOUT
                })
                .then(() => diag_log('collected noobaa.log files successfully'))
                .catch(err => diag_log('collecting noobaa.log failed with error: ' + err)),

                () => promise_utils.exec('cp -fp /log/client_noobaa.log* ' + TMP_WORK_DIR, {
                    ignore_rc: false,
                    return_stdout: false,
                    timeout: LONG_EXEC_TIMEOUT
                })
                .then(() => diag_log('collected client_noobaa.log files successfully'))
                .catch(err => diag_log('collecting client_noobaa.log failed with error: ' + err)),

                () => promise_utils.exec('cp -fp /data/.env ' + TMP_WORK_DIR + '/env', {
                    ignore_rc: false,
                    return_stdout: false,
                    timeout: LONG_EXEC_TIMEOUT
                })
                .then(() => diag_log('collected .env successfully'))
                .catch(err => diag_log('collecting .env failed with error: ' + err)),

                () => os_utils.top_single(TMP_WORK_DIR + '/top.out')
                .then(() => diag_log('collected top.out successfully'))
                .catch(err => diag_log('collecting top.out failed with error: ' + err)),

                () => os_utils.slabtop(TMP_WORK_DIR + '/slabtop.out')
                .then(() => diag_log('collected slabtop.out successfully'))
                .catch(err => diag_log('collecting slabtop.out failed with error: ' + err)),

                () => promise_utils.exec('cp -fp /etc/noobaa* ' + TMP_WORK_DIR, {
                    ignore_rc: false,
                    return_stdout: false,
                    timeout: LONG_EXEC_TIMEOUT
                })
                .then(() => diag_log('collected /etc/noobaa files successfully'))
                .catch(err => diag_log('collecting /etc/noobaa files failed with error: ' + err)),

                () => promise_utils.exec(`cp -fpR /log/nbfedump ${TMP_WORK_DIR}`, {
                    ignore_rc: false,
                    return_stdout: false,
                    timeout: LONG_EXEC_TIMEOUT
                })
                .then(() => diag_log('collected /log/nbfedump directory successfully'))
                .catch(err => diag_log('collecting /log/nbfedump directory failed with error: ' + err)),

                () => promise_utils.exec('lsof &> ' + TMP_WORK_DIR + '/lsof.out', {
                    ignore_rc: false,
                    return_stdout: false,
                    timeout: LONG_EXEC_TIMEOUT
                })
                .then(() => diag_log('collected lsof.out successfully'))
                .catch(err => diag_log('collecting lsof.out failed with error: ' + err)),


                () => promise_utils.exec('chkconfig &> ' + TMP_WORK_DIR + '/chkconfig.out', {
                    ignore_rc: false,
                    return_stdout: false,
                    timeout: LONG_EXEC_TIMEOUT
                })
                .then(() => diag_log('collected chkconfig.out successfully'))
                .catch(err => diag_log('collecting chkconfig.out failed with error: ' + err)),

                () => promise_utils.exec('cp -fp /var/log/messages* ' + TMP_WORK_DIR, {
                    ignore_rc: false,
                    return_stdout: false,
                    timeout: LONG_EXEC_TIMEOUT
                })
                .then(() => diag_log('collected /var/log/messages files successfully'))
                .catch(err => diag_log('collecting /etc/noobaa files failed with error: ' + err)),

                () => promise_utils.exec('dmesg &> ' + TMP_WORK_DIR + '/dmesg.out', {
                    ignore_rc: false,
                    return_stdout: false,
                    timeout: LONG_EXEC_TIMEOUT
                })
                .then(() => diag_log('collected dmesg successfully'))
                .catch(err => diag_log('collecting dmesg failed with error: ' + err)),

                () => collect_ntp_diagnostics()
                .then(() => diag_log('collected ntp diagnostics successfully'))
                .catch(err => diag_log('collect_ntp_diagnostics failed with error: ' + err)),

                () => promise_utils.exec('df -h &> ' + TMP_WORK_DIR + '/df.out', {
                    ignore_rc: false,
                    return_stdout: false,
                    timeout: LONG_EXEC_TIMEOUT
                })
                .then(() => diag_log('collected df.out successfully'))
                .catch(err => diag_log('collecting df.out failed with error: ' + err)),

                () => promise_utils.exec('cp -fp /tmp/noobaa_wizard.log ' + TMP_WORK_DIR + '/noobaa_wizard.log', {
                    ignore_rc: false,
                    return_stdout: false,
                    timeout: LONG_EXEC_TIMEOUT
                })
                .then(() => diag_log('collected noobaa_wizard.log successfully'))
                .catch(err => diag_log('collecting noobaa_wizard.log failed with error: ' + err)),

                () => collect_statistics(req)
                .then(() => diag_log('collected statistics successfully'))
                .catch(err => diag_log('collect_statistics failed with error: ' + err)),

                () => system_store.get_system_collections_dump()
                .then(dump => fs.writeFileAsync(path.join(TMP_WORK_DIR, 'mongo_db_system_collections_dump.json'), JSON.stringify(dump, null, 2)))
                .then(() => diag_log('finished get_system_collections_dump successfully'))
                .catch(err => diag_log('get_system_collections_dump failed with error: ' + err)),

                () => promise_utils.exec('rndc dumpdb -cache')
                .then(() => promise_utils.exec(`cp -fp /var/named/data/* ${TMP_WORK_DIR}`))
                .then(() => promise_utils.exec(`cp -fp /etc/noobaa_configured_dns.conf ${TMP_WORK_DIR}`))
                .then(() => promise_utils.exec(`cp -fp /etc/named.conf ${TMP_WORK_DIR}`))
                .then(() => diag_log('finished getting named information successfully'))
                .catch(err => diag_log('getting named (dns cache) diagnostics failed with error: ' + err)),

                () => server_rpc.client.host.list_hosts({
                    adminfo: true
                }, {
                    auth_token: req.auth_token
                })
                .then(hosts_list => fs.writeFileAsync(path.join(TMP_WORK_DIR, 'hosts_list.json'), JSON.stringify(hosts_list, null, 2)))
                .then(() => diag_log('finished writing hosts list successfully'))
                .catch(err => diag_log('failed getting hosts list: ' + err)),

            ];


            return P.map(operations, op => op(), {
                    concurrency: 10
                })
                .then(null, function(err) {
                    console.error('Error in collecting server diagnostics (should never happen)', err);
                    throw new Error('Error in collecting server diagnostics ' + err);
                });
        });
}

function pack_diagnostics(dst, work_dir) {
    return base_diagnostics.pack_diagnostics(dst, work_dir);
}

function write_agent_diag_file(data) {
    return base_diagnostics.write_agent_diag_file(data);
}

function collect_ntp_diagnostics() {
    if (process.platform !== 'linux') {
        console.log('Skipping ntp diagnostics collection on non linux server');
        return P.resolve();
    }
    let ntp_diag = TMP_WORK_DIR + '/ntp.diag';
    return promise_utils.exec('echo "### NTP diagnostics ###" >' + ntp_diag, {
            ignore_rc: false,
            return_stdout: false,
            timeout: SHORT_EXEC_TIMEOUT
        })
        .then(() => promise_utils.exec('echo "\ncontent of /etc/ntp.conf:" &>>' + ntp_diag, {
            ignore_rc: false,
            return_stdout: false,
            timeout: SHORT_EXEC_TIMEOUT
        }))
        .then(() => promise_utils.exec('cat /etc/ntp.conf &>>' + ntp_diag, {
            ignore_rc: false,
            return_stdout: false,
            timeout: SHORT_EXEC_TIMEOUT
        }))
        .then(() => promise_utils.exec('echo "\n\n" &>>' + ntp_diag, {
            ignore_rc: false,
            return_stdout: false,
            timeout: SHORT_EXEC_TIMEOUT
        }))
        .then(() => promise_utils.exec('ls -l /etc/localtime &>>' + ntp_diag, {
            ignore_rc: false,
            return_stdout: false,
            timeout: SHORT_EXEC_TIMEOUT
        }))
        .then(() => promise_utils.exec('echo "\n\nntpstat:" &>>' + ntp_diag, {
            ignore_rc: false,
            return_stdout: false,
            timeout: SHORT_EXEC_TIMEOUT
        }))
        .then(() => promise_utils.exec('ntpstat &>>' + ntp_diag, {
            ignore_rc: false,
            return_stdout: false,
            timeout: SHORT_EXEC_TIMEOUT
        }))
        .then(() => promise_utils.exec('echo "\n\ndate:" &>>' + ntp_diag, {
            ignore_rc: false,
            return_stdout: false,
            timeout: SHORT_EXEC_TIMEOUT
        }))
        .then(() => promise_utils.exec('date &>>' + ntp_diag, {
            ignore_rc: false,
            return_stdout: false,
            timeout: SHORT_EXEC_TIMEOUT
        }))
        .then(() => promise_utils.exec('echo "\n\nntpdate:" &>>' + ntp_diag, {
            ignore_rc: false,
            return_stdout: false,
            timeout: SHORT_EXEC_TIMEOUT
        }))
        .then(() => promise_utils.exec('ntpdate &>>' + ntp_diag, {
            ignore_rc: false,
            return_stdout: false,
            timeout: SHORT_EXEC_TIMEOUT
        }))
        .then(() => promise_utils.exec('echo "\n\nntptime:" &>>' + ntp_diag, {
            ignore_rc: false,
            return_stdout: false,
            timeout: SHORT_EXEC_TIMEOUT
        }))
        .then(() => promise_utils.exec('ntptime &>>' + ntp_diag, {
            ignore_rc: false,
            return_stdout: false,
            timeout: SHORT_EXEC_TIMEOUT
        }));
}

//Collect supervisor logs, only do so on linux platforms and not on OSX (WA for local server run)
function collect_supervisor_logs() {
    return P.resolve()
        .then(() => {
            if (process.platform === 'linux') {
                // compress supervisor logs to the destination directory with compression level 1 (fastest).
                // it appears to be faster than copying and then compressing
                return promise_utils.exec('GZIP=-1 tar -czf ' + TMP_WORK_DIR + '/supervisor_log.tgz /log/supervisor/* ', {
                        ignore_rc: false,
                        return_stdout: false,
                        timeout: LONG_EXEC_TIMEOUT
                    })
                    .catch(function(err) {
                        console.error('Error in collecting supervisor logs', err);
                        throw new Error('Error in collecting supervisor logs ' + err);
                    });
            } else {
                console.log('Skipping supervisor logs collection on non linux server');
            }
        });
}

function collect_statistics(req) {
    return P.resolve().then(function() {
            let current_clustering = system_store.get_local_cluster_info();
            if (stats_aggregator && !((current_clustering && current_clustering.is_clusterized) && !system_store.is_cluster_master)) {
                return stats_aggregator.get_all_stats(req);
            }
        })
        .catch(function(err) {
            console.error('Failed to collect stats', err.stack || err);
        })
        .then(function(restats) {
            if (stats_aggregator) {
                var stats_data = JSON.stringify(restats);
                return fs.writeFileAsync(TMP_WORK_DIR + '/phone_home_stats.out', stats_data);
            }
        })
        .catch(function(err) {
            console.error('Failed to collect phone_home_stats', err.stack || err);
        });
}


function diag_log(msg) {
    console.log('writing to diag log:', msg);
    return fs.appendFileAsync(DIAG_LOG_FILE, msg + '\n\n');
}

// EXPORTS
exports.collect_server_diagnostics = collect_server_diagnostics;
exports.pack_diagnostics = pack_diagnostics;
exports.write_agent_diag_file = write_agent_diag_file;
