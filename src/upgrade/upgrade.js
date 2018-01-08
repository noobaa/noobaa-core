/* Copyright (C) 2016 NooBaa */
"use strict";

var P = require('../util/promise');
var argv = require('minimist')(process.argv);
var fs_utils = require('../util/fs_utils');
var fs = require('fs');
const path = require('path');

var promise_utils = require('../util/promise_utils');
const spawn = require('child_process').spawn;
const dbg = require('../util/debug_module')(__filename);
dbg.set_process_name('Upgrade');

const EXTRACTION_PATH = '/tmp/test';
const PACKAGE_FILE_NAME = 'new_version.tar.gz';
const WRAPPER_FILE_NAME = './upgrade_wrapper.js';
const TMP_PATH = '/tmp';
const NEW_UPGRADE_SCRIPT = `./src/upgrade/upgrade.js`;
const SUPERD = '/usr/bin/supervisord';
const SUPERCTL = '/usr/bin/supervisorctl';
const CORE_DIR = "/root/node_modules/noobaa-core";
let MONGO_SHELL = "/usr/bin/mongo nbcore";


// read node version from nvmrc
const NODE_VER = String(fs.readFileSync(path.join(EXTRACTION_PATH, 'noobaa-core/.nvmrc'))).trim();
const NEW_NODE_BIN = path.join(TMP_PATH, 'v' + NODE_VER, 'bin/node');


function disable_autostart() {
    dbg.log0(`disable_autostart`);
    // we need to start supervisord, but we don't want to start all services.
    // use sed to set autostart to false. replace back when finished.
    return promise_utils.exec(`sed -i "s:autostart=true:autostart=false:" /etc/noobaa_supervisor.conf`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        })
        .then(res => {
            dbg.log0('Autostart Disabled');
        })
        .then(() => promise_utils.exec(`sed -i "s:web_server.js:WEB.JS:" /etc/noobaa_supervisor.conf`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0(`disable_autostart: Success`);
        })
        .catch(err => {
            dbg.error('disable_autostart: Failure', err);
            throw err;
        });
}

function enable_autostart() {
    dbg.log0(`enable_autostart`);
    return promise_utils.exec(`sed -i "s:autostart=false:autostart=true:" /etc/noobaa_supervisor.conf`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        })
        .then(res => {
            dbg.log0('Autostart Enabled');
        })
        .then(() => promise_utils.exec(`sed -i "s:WEB.JS:web_server.js:" /etc/noobaa_supervisor.conf`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0(`enable_autostart: Success`);
        })
        .catch(err => {
            dbg.error('enable_autostart: Failure', err);
            throw err;
        });
}

function disable_supervisord() {
    dbg.log0(`disable_supervisord`);
    let services;
    return promise_utils.exec(`${SUPERCTL} status | grep pid | sed 's:.*pid \\(.*\\), uptime.*:\\1:'`, {
            ignore_rc: false,
            return_stdout: true,
        })
        .then(res => {
            services = res.split('\n');
            dbg.log0('disable_supervisord services pgids:', services);
        })
        .then(() => promise_utils.exec(`${SUPERCTL} shutdown`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0('disable_supervisord shutdown');
        })
        .then(() => P.map(services, service => {
            if (service) {
                dbg.log0(`Killing pgid:${service}`);

                return promise_utils.exec(`kill -9 -${service}`, {
                    ignore_rc: true,
                    return_stdout: true,
                    trim_stdout: true
                });
            }
        }))
        .then(() => promise_utils.exec(`ps -ef | grep mongod`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(res => {
            dbg.log0(`Mongo status after disabling supervisord ${res}`);
        })
        .catch(err => {
            dbg.error('disable_supervisord: Failure', err);
            throw err;
        });
}

function mongo_upgrade() {
    dbg.log0('mongo_upgrade: Called');
    let secret;
    return disable_autostart()
        .then(() => promise_utils.exec(`${SUPERD}`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0('mongo_upgrade: Ran SUPERD');
        })
        .then(() => promise_utils.exec(`${SUPERCTL} start mongo_wrapper`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0('mongo_upgrade: Ran MONGO_WRAPPER');
        })
        .then(() => wait_for_mongo())
        .then(function() {
            return promise_utils.exec(`cat /etc/noobaa_sec`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                })
                .then(res_sec => {
                    dbg.log0('mongo_upgrade: Secret', res_sec);
                    secret = res_sec;
                });
        })
        .then(() => P.join(
            promise_utils.exec(`/usr/local/bin/node ${CORE_DIR}/src/tools/bcrypt_cli.js --bcrypt_password ${secret}`, {
                ignore_rc: false,
                return_stdout: true,
                trim_stdout: true
            }),
            promise_utils.exec(`uuidgen | cut -f 1 -d'-'`, {
                ignore_rc: false,
                return_stdout: true,
                trim_stdout: true
            }),
            promise_utils.exec(`/sbin/ifconfig eth0 | grep 'inet addr:' | cut -d: -f2 | cut -f 1 -d' '`, {
                ignore_rc: false,
                return_stdout: true,
                trim_stdout: true
            }),
            promise_utils.exec(`openssl x509 -in /etc/mongo_ssl/client.pem -inform PEM -subject -nameopt RFC2253 | grep subject | awk '{sub("subject= ",""); print}'`, {
                ignore_rc: false,
                return_stdout: true,
                trim_stdout: true
            }),
            promise_utils.exec(`grep '"version": "' ${CORE_DIR}/package.json | cut -d\\" -f 4`, {
                ignore_rc: true,
                return_stdout: true,
                trim_stdout: true
            })
        ))
        .spread((bcrypt_secret, id, ip, client_subject, version) => {
            dbg.log0(`starting mongo data upgrade ${bcrypt_secret} ${id} ${ip} ${client_subject} ${version}`);
            return mongo_upgrade_database_metadata({ secret, bcrypt_secret, ip, client_subject, version })
                .then(() => dbg.log0(`finished mongo data upgrade`))
                .catch(err => {
                    dbg.error('FAILED mongo data upgrade!', err);
                    throw err;
                });
        })
        .then(() => enable_autostart())
        .then(() => promise_utils.exec(`${SUPERCTL} update`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0('mongo_upgrade: SUPERCTL updated');
        })
        .then(() => promise_utils.exec(`${SUPERCTL} start all`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0('mongo_upgrade: SUPERCTL started all services');
        })
        .delay(3000)
        .then(() => {
            dbg.log0('mongo_upgrade: Success');
        })
        .catch(err => {
            dbg.error('mongo_upgrade: Failure', err);
            throw err;
        });
}

function do_upgrade() {
    dbg.log0('do_upgrade: Called', argv);
    let upgrade_wrapper;
    try {
        upgrade_wrapper = require(`${WRAPPER_FILE_NAME}`); // eslint-disable-line global-require
    } catch (err) {
        return P.reject(`do_upgrade: Could not require ${WRAPPER_FILE_NAME}`);
    }
    // #Update packages before we stop services, minimize downtime, limit run time for yum update so it won't get stuck
    return P.resolve()
        .then(() => disable_supervisord())
        .then(() => {
            dbg.log0(`do_upgrade: Running pre upgrade`);
            return upgrade_wrapper.run_upgrade_wrapper({
                stage: 'PRE_UPGRADE',
                fsuffix: argv.fsuffix
            });
        })
        .then(() => promise_utils.exec(`rm -rf /backup`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0(`do_upgrade: Removed /backup`);
        })
        .then(() => promise_utils.exec(`mv ${CORE_DIR} /backup`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0(`do_upgrade: Moved files from ${CORE_DIR} to /backup`);
        })
        .then(() => fs_utils.create_path(CORE_DIR))
        .then(() => {
            dbg.log0(`do_upgrade: Created ${CORE_DIR}`);
        })
        .then(() => promise_utils.exec(`mv ${TMP_PATH}/${PACKAGE_FILE_NAME} /root/node_modules`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0(`do_upgrade: Moved files from ${TMP_PATH}/${PACKAGE_FILE_NAME} to /root/node_modules`);
        })
        .then(() => promise_utils.exec(`cd /root/node_modules/;tar -xzvf /root/node_modules/${PACKAGE_FILE_NAME} >& /dev/null`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(res => {
            dbg.log0(`do_upgrade: Extracted new version ${PACKAGE_FILE_NAME}`, res);
        })
        .then(function() {
            let should_work = true;
            return fs_utils.file_must_exist('/backup/noobaa_storage/')
                .catch(err => {
                    dbg.log0(err);
                    should_work = false;
                })
                .then(() => {
                    if (!should_work) return P.resolve();
                    dbg.log0(`do_upgrade: Moving old noobaa_storage to ${CORE_DIR}`);
                    return promise_utils.exec(`mv /backup/noobaa_storage/ ${CORE_DIR}`, {
                        ignore_rc: false,
                        return_stdout: true,
                        trim_stdout: true
                    });
                });
        })
        .then(() => {
            dbg.log0(`do_upgrade: Running post upgrade`);
            return upgrade_wrapper.run_upgrade_wrapper({
                stage: 'POST_UPGRADE',
                fsuffix: argv.fsuffix
            });
        })
        .then(() => mongo_upgrade())
        .then(() => wait_for_mongo())
        .then(() => promise_utils.exec(`rm -rf ${EXTRACTION_PATH}/*`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0(`do_upgrade: Upgrade finished successfully!`);
        })
        .catch(err => {
            dbg.error(`do_upgrade: Failed`, err);
            throw err;
        });
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
            if (argv.from_file) {
                if (argv.from_file === '') {
                    dbg.log0(`upgrade.js called with ${argv}`);
                    dbg.log0(`Must supply path to upgrade package`);
                    throw new Error('run_upgrade: Must supply path to upgrade package');
                } else {
                    var stdout;
                    var stderr;
                    dbg.log0(`upgrade.js called for package extraction`);
                    return P.resolve()
                        .then(() => {
                            var fname = '/var/log/noobaa_deploy_out_' + argv.fsuffix + '.log';
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
                }
            } else if (argv.do_upgrade) {
                return P.resolve()
                    .then(() => {
                        if (argv.cluster_str === 'cluster') {
                            // TODO: handle differenet shard
                            return set_mongo_cluster_mode();
                        }
                    })
                    .then(() => {
                        dbg.log0(`upgrade.js called with ${argv}`);
                        return P.resolve()
                            .then(() => do_upgrade());
                    });
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

function mongo_upgrade_database_metadata(params) {
    dbg.log0(`mongo_upgrade_database_metadata: Called`, params);
    let UPGRADE_SCRIPTS = [];
    return promise_utils.exec(`${MONGO_SHELL} --quiet --eval "db.clusters.find({owner_secret: '${params.secret}'}).toArray()[0].upgrade.mongo_upgrade" | tail -n 1`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        })
        .then(should_mongo_upgrade => {
            dbg.log0(`mongo_upgrade_database_metadata: secret is ${params.secret} - should_mongo_upgrade = ${should_mongo_upgrade}`);
            if (should_mongo_upgrade === "true") {
                UPGRADE_SCRIPTS = [
                    'mongo_upgrade_mark_completed.js'
                ];
            } else {
                UPGRADE_SCRIPTS = [
                    'mongo_upgrade_wait_for_master.js'
                ];
            }
        })
        .then(() => {
            if (argv.cluster_str === 'cluster') {
                dbg.log0(`mongo_upgrade_database_metadata: Cluster upgrade`);
                // # TODO: handle differenet shard
                return set_mongo_cluster_mode();
            }
        })
        // set mongo audit and debug
        .then(() => promise_utils.exec(`${MONGO_SHELL} --quiet --eval 'db.setLogLevel(5)'`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(function() {
            return P.each(UPGRADE_SCRIPTS, script => {
                dbg.log0(`Running Mongo Upgrade Script ${script}`);
                return promise_utils.exec(`${MONGO_SHELL} --eval "var param_secret='${params.secret}', param_bcrypt_secret='${params.bcrypt_secret}', param_ip='${params.ip}', version='${params.version}', param_client_subject='${params.client_subject}'" ${CORE_DIR}/src/deploy/mongo_upgrade/${script}`, {
                        ignore_rc: false,
                        return_stdout: true,
                        trim_stdout: true
                    })
                    .catch(err => {
                        dbg.error(`Failed Mongo Upgrade Script ${script}`, err);
                        throw err;
                    });
            });
        })
        .finally(() => promise_utils.exec(`${MONGO_SHELL} --quiet --eval 'db.setLogLevel(0)'`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0('mongo_upgrade_database_metadata: Success');
        })
        .catch(err => {
            dbg.error('mongo_upgrade_database_metadata: Failure', err);
            throw err;
        });
}

function set_mongo_cluster_mode() {
    dbg.log0('set_mongo_cluster_mode: Called');
    return promise_utils.exec(`grep MONGO_RS_URL /root/node_modules/noobaa-core/.env | cut -d'@' -f 2 | cut -d'/' -f 1`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        })
        .then(rs_servers => {
            dbg.log0(`set_mongo_cluster_mode: MONGO_SHELL`, rs_servers);
            MONGO_SHELL = `/usr/bin/mongors --host mongodb://${rs_servers}/nbcore?replicaSet=shard1`;
        });
}

function check_mongo_status() {
    dbg.log0(`check_mongo_status: Called`);
    // # even if the supervisor reports the service is running try to connect to it
    // local mongo_status
    // # beware not to run "local" in the same line changes the exit code
    return promise_utils.exec(`${MONGO_SHELL} --quiet --eval 'quit(!db.serverStatus().ok)'`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        })
        .then(res => {
            dbg.log0(`check_mongo_status: Response`, res);
            return res;
        })
        .catch(err => {
            dbg.error(`check_mongo_status: Failure`, err);
            throw err;
        });
}

function wait_for_mongo() {
    dbg.log0(`wait_for_mongo: Called`);
    let mongo_stable = false;
    return promise_utils.pwhile(
        () => !mongo_stable,
        () => {
            dbg.log0(`wait_for_mongo: Waiting for mongo (sleep 5)`);
            // deploy_log "wait_for_mongo: Waiting for mongo (sleep 5)"
            return check_mongo_status()
                .then(() => {
                    mongo_stable = true;
                })
                .catch(err => {
                    dbg.error('check_mongo_status: Failed to connect to mongod', err);
                })
                .delay(5000);
        });
}
