/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const path = require('path');

const P = require('../../util/promise');
const os_utils = require('../../util/os_utils');
const base_diagnostics = require('../../util/base_diagnostics');
const stats_aggregator = require('../system_services/stats_aggregator');
const system_store = require('../system_services/system_store').get_instance();
const server_rpc = require('../server_rpc');

const TMP_WORK_DIR = '/tmp/diag';
const DIAG_LOG_FILE = TMP_WORK_DIR + '/diagnostics_collection.log';
const LONG_EXEC_TIMEOUT = 60 * 1000;

// operations for diagnostics that can take place in parallel
const operations = [
    async () => {
        try {
            await collect_supervisor_logs();
            return diag_log('collected supervisor logs successfully');
        } catch (err) {
            return diag_log('collect_supervisor_logs failed with error: ' + err);
        }
    },

    async () => {
        try {
            await copy_files('/log/noobaa_deploy*', TMP_WORK_DIR, 'fp');
            return diag_log('collected noobaa_deploy logs successfully');
        } catch (err) {
            return diag_log('collecting noobaa_deploy.log failed with error: ' + err);
        }
    },

    async () => {
        try {
            await copy_files('/log/noobaa.log*', TMP_WORK_DIR, 'fp');
            return diag_log('collected noobaa.log files successfully');
        } catch (err) {
            return diag_log('collecting noobaa.log failed with error: ' + err);
        }
    },

    async () => {
        try {
            await copy_files('/log/client_noobaa.log*', TMP_WORK_DIR, 'fp');
            return diag_log('collected client_noobaa.log files successfully');
        } catch (err) {
            return diag_log('collecting client_noobaa.log failed with error: ' + err);
        }
    },

    async () => {
        try {
            await copy_files('/log/nbfedump', TMP_WORK_DIR, 'fpR');
            return diag_log('collected /log/nbfedump directory successfully');
        } catch (err) {
            return diag_log('collecting /log/nbfedump directory failed with error: ' + err);
        }
    },

    async () => {
        try {
            await os_utils.exec(`lsof &> ${TMP_WORK_DIR}/lsof.out`, {
                ignore_rc: false,
                return_stdout: false,
                timeout: LONG_EXEC_TIMEOUT
            });
            return diag_log('collected lsof.out successfully');
        } catch (err) {
            return diag_log('collecting lsof.out failed with error: ' + err);
        }
    },

    async () => {
        try {
            await os_utils.exec(`chkconfig &> ${TMP_WORK_DIR}/chkconfig.out`, {
                ignore_rc: false,
                return_stdout: false,
                timeout: LONG_EXEC_TIMEOUT
            });
            return diag_log('collected chkconfig.out successfully');
        } catch (err) {
            return diag_log('collecting chkconfig.out failed with error: ' + err);
        }
    },

    async () => {
        try {
            await copy_files('/var/log/messages*', TMP_WORK_DIR, 'fp');
            return diag_log('collected /var/log/messages files successfully');
        } catch (err) {
            return diag_log('collecting /etc/noobaa files failed with error: ' + err);
        }
    },

    async () => {
        try {
            await os_utils.exec(`df -h &> ${TMP_WORK_DIR}/df.out`, {
                ignore_rc: false,
                return_stdout: false,
                timeout: LONG_EXEC_TIMEOUT
            });
            return diag_log('collected df.out successfully');
        } catch (err) {
            return diag_log('collecting df.out failed with error: ' + err);
        }
    },

    async req => {
        try {
            await collect_statistics(req);
            return diag_log('collected statistics successfully');
        } catch (err) {
            return diag_log('collect_statistics failed with error: ' + err);
        }
    },

    async () => {
        try {
            const dump = await system_store.get_system_collections_dump();
            await fs.promises.writeFile(
                path.join(TMP_WORK_DIR, 'mongo_db_system_collections_dump.json'),
                JSON.stringify(dump, null, 2)
            );
            return diag_log('finished get_system_collections_dump successfully');
        } catch (err) {
            return diag_log('get_system_collections_dump failed with error: ' + err);
        }
    },

    async req => {
        try {
            const hosts_list = await server_rpc.client.host.list_hosts({
                adminfo: true
            }, {
                auth_token: req.auth_token
            });
            await fs.promises.writeFile(path.join(TMP_WORK_DIR, 'hosts_list.json'), JSON.stringify(hosts_list, null, 2));
            return diag_log('finished writing hosts list successfully');
        } catch (err) {
            return diag_log('failed getting hosts list: ' + err);
        }
    }
];

//TODO: Add temp collection dir as param
async function collect_server_diagnostics(req) {
    try {
        await base_diagnostics.prepare_diag_dir();
        await base_diagnostics.collect_basic_diagnostics();
        await P.map_with_concurrency(10, operations, op => op(req));

    } catch (err) {
        console.error('Error in collecting server diagnostics (should never happen)', err);
        throw new Error('Error in collecting server diagnostics ' + err);
    }
}

async function copy_files(src, dest, flags) {
    const f = flags ? `-${flags}` : '';
    try {
        await os_utils.exec(`cp ${f} ${src} ${dest}`, {
            ignore_rc: false,
            return_stdout: true,
            timeout: LONG_EXEC_TIMEOUT
        });

    } catch (err) {
        if (!err.stderr.includes('No such file or directory')) {
            throw err;
        }
    }
}

function pack_diagnostics(dst, work_dir) {
    return base_diagnostics.pack_diagnostics(dst, work_dir);
}

function write_agent_diag_file(data) {
    return base_diagnostics.write_agent_diag_file(data);
}

//Collect supervisor logs, only do so on linux platforms and not on OSX (WA for local server run)
function collect_supervisor_logs() {
    return P.resolve()
        .then(() => {
            if (process.platform === 'linux') {
                // compress supervisor logs to the destination directory with compression level 1 (fastest).
                // it appears to be faster than copying and then compressing
                return os_utils.exec('GZIP=-1 tar -czf ' + TMP_WORK_DIR + '/supervisor_log.tgz /log/supervisor/* ', {
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
            if (stats_aggregator) {
                return stats_aggregator.get_all_stats(req);
            }
        })
        .catch(function(err) {
            console.error('Failed to collect stats', err.stack || err);
        })
        .then(function(restats) {
            if (stats_aggregator) {
                var stats_data = JSON.stringify(restats);
                return fs.promises.writeFile(TMP_WORK_DIR + '/phone_home_stats.out', stats_data);
            }
        })
        .catch(function(err) {
            console.error('Failed to collect phone_home_stats', err.stack || err);
        });
}


function diag_log(msg) {
    console.log('writing to diag log:', msg);
    return fs.promises.appendFile(DIAG_LOG_FILE, `${msg}\n\n`);
}

// EXPORTS
exports.collect_server_diagnostics = collect_server_diagnostics;
exports.pack_diagnostics = pack_diagnostics;
exports.write_agent_diag_file = write_agent_diag_file;
