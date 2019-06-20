/* Copyright (C) 2016 NooBaa */
"use strict";

var P = require('../util/promise');
var argv = require('minimist')(process.argv);
var fs = require('fs');
const path = require('path');

var promise_utils = require('../util/promise_utils');
const spawn = require('child_process').spawn;
const dbg = require('../util/debug_module')(__filename);
const platform_upgrade = require('./platform_upgrade');
const supervisor = require('../server/utils/supervisor_ctrl');
dbg.set_process_name('Upgrade');

const OLD_VER = require('/root/node_modules/noobaa-core/package.json').version;
const EXTRACTION_PATH = '/tmp/test';
const TMP_PATH = '/tmp';
const NEW_UPGRADE_SCRIPT = `./src/upgrade/upgrade.js`;
const UPGRADE_MANAGER_SCRIPT = `./src/upgrade/upgrade_manager.js`;


// read node version from nvmrc
const NODE_VER = String(fs.readFileSync(path.join(EXTRACTION_PATH, 'noobaa-core/.nvmrc'))).trim();
const NEW_NODE_BIN = path.join(TMP_PATH, 'v' + NODE_VER, 'bin/node');


async function do_upgrade() {
    dbg.log0('UPGRADE: starting do_upgrade in upgrade.js');
    try {
        dbg.log0('UPGRADE: backup up old version before starting..');
        // TODO: move the backup stage into upgrade_manager
        await platform_upgrade.backup_old_version();
        await start_upgrade_manager();
    } catch (err) {
        // TODO: better error handling here. we should store the error in DB before aborting (should use mongo shell)
        // also make sure that exiting here will not cause the upgrade to get stuck in the UI.
        dbg.error('failed preparing environment for upgrade_manager', err);
        // restart services to stop upgrade
        // TODO: better solution than restarting services
        supervisor.restart(['webserver']);
        process.exit(1);
    }
}



async function start_upgrade_manager() {
    // add new version upgrade agent to the supervisor.conf
    const upgrade_prog = {};
    const args = [
        '--cluster_str', argv.cluster_str,
        '--old_version', OLD_VER
    ];
    upgrade_prog.name = 'upgrade_manager';
    upgrade_prog.command = `${NEW_NODE_BIN} ${UPGRADE_MANAGER_SCRIPT} ${args.join(' ')}`;
    upgrade_prog.directory = `${EXTRACTION_PATH}/noobaa-core/`;
    upgrade_prog.user = 'root';
    upgrade_prog.autostart = 'true';
    upgrade_prog.priority = '1';
    upgrade_prog.stopsignal = 'KILL';
    dbg.log0('UPGRADE: adding upgrade manager to supervisor and applying. configuration is', upgrade_prog);
    try {
        await supervisor.add_program(upgrade_prog);
        await supervisor.apply_changes();
    } catch (err) {
        dbg.error(`UPGRADE: failed adding upgrade manager to supervisor. 
        this probably means that supervisorctl is failing to connect to supervisord. restarting supervisord`, err);
        await supervisor.restart_supervisord();
        throw err;
    }
}

function main() {
    return run_upgrade()
        .then(function() {
            dbg.log0('run_upgrade: Upgrade finished successfully');
        })
        .catch(function(err) {
            dbg.error('run_upgrade: Failed', err);
            throw err;
        });
}

if (require.main === module) {
    main();
}

function run_upgrade() {
    dbg.log0('run_upgrade: Called', argv);
    let file_descriptors;
    //   #services under supervisord
    return promise_utils.exec(`lsof -p $$ | grep LISTEN | awk '{print $4}' | sed 's:\\(.*\\)u:\\1:'`, {
            ignore_rc: false,
            return_stdout: true,
        })
        .then(res => {
            file_descriptors = res.split('\n');
            dbg.log0(`Detected File Descriptors ${file_descriptors}`);
        })
        .then(() => P.map(file_descriptors, function(fd) {
            return promise_utils.exec(`eval "exec ${fd}<&-"`, {
                ignore_rc: false,
                return_stdout: true,
                trim_stdout: true
            });
        }).catch(err => {
            dbg.error(err);
        }))
        .then(() => {
            if (argv.from_file === '') {
                dbg.log0(`upgrade.js called with ${argv}`);
                dbg.log0(`Must supply path to upgrade package`);
                throw new Error('run_upgrade: Must supply path to upgrade package');
            } else if (argv.from_file) {
                var stdout;
                var stderr;
                dbg.log0(`upgrade.js called for package extraction`);
                return P.resolve()
                    .then(() => {
                        var fname = '/log/noobaa_deploy_out_' + argv.fsuffix + '.log';
                        stdout = fs.openSync(fname, 'a');
                        stderr = fs.openSync(fname, 'a');
                    })
                    .then(() => {
                        let upgrade_proc = spawn(NEW_NODE_BIN, [
                            NEW_UPGRADE_SCRIPT,
                            '--do_upgrade', 'true',
                            '--fsuffix', argv.fsuffix,
                            '--cluster_str', argv.cluster_str
                        ], {
                            detached: true,
                            stdio: ['ignore', stdout, stderr, 'ipc'],
                            cwd: `${EXTRACTION_PATH}/noobaa-core/`
                        });
                        upgrade_proc.on('exit', (code, signal) => {
                            // upgrade.js is supposed to kill this node process, so it should not exit while
                            // this node process is still running. treat exit as error.
                            if (code) {
                                const err_msg = `upgrade.js process was closed with code ${code} and signal ${signal}`;
                                dbg.error(err_msg);
                            }
                        });
                        upgrade_proc.on('error', dbg.error);
                    });
            } else if (argv.do_upgrade) {
                dbg.log0(`upgrade.js called with ${argv}`);
                return do_upgrade();
            }
        })
        .then(function() {
            dbg.log0('run_upgrade: Success');
        })
        .catch(function(err) {
            dbg.error('run_upgrade: Failure', err);
            throw err;
        });
}
