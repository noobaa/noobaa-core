/* Copyright (C) 2016 NooBaa */
"use strict";

const P = require('../util/promise');
const fs_utils = require('../util/fs_utils');
const promise_utils = require('../util/promise_utils');
const os_utils = require('../util/os_utils');
const dbg = require('../util/debug_module')(__filename);
dbg.set_process_name('UpgradeWrapper');

const EXTRACTION_PATH = '/tmp/test';
const CORE_DIR = "/root/node_modules/noobaa-core";
const HOME = '/root';
const NVM_DIR = `${HOME}/.nvm`;
const NOOBAANET = '/etc/noobaa_network';

module.exports = {
    run_upgrade_wrapper: run_upgrade_wrapper
};

function pre_upgrade() {
    dbg.set_process_name('UpgradeWrapperPreUpgrade');
    dbg.log0('pre_upgrade: Called');
    let nodever;
    return P.resolve()
        .then(() => update_noobaa_net())
        .then(() => promise_utils.exec(`mkdir -p /tmp/supervisor`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0('pre_upgrade: Created /tmp/supervisor');
        })
        .then(() => promise_utils.exec(`rm -rf ~/.nvm`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0('pre_upgrade: Removed ~/.nvm');
        })
        .then(() => promise_utils.exec(`mkdir ~/.nvm`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0('pre_upgrade: Created ~/.nvm');
        })
        .then(() => promise_utils.exec(`cp ${EXTRACTION_PATH}/noobaa-core/build/public/nvm.sh ~/.nvm/`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0('pre_upgrade: Copied nvm.sh');
        })
        .then(() => promise_utils.exec(`chmod 777 ~/.nvm/nvm.sh`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0('pre_upgrade: Configured permissions to nvm.sh');
        })
        .then(() => promise_utils.exec(`cat ${EXTRACTION_PATH}/noobaa-core/.nvmrc`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(res => {
            dbg.log0('pre_upgrade: Nodever', res);
            nodever = res;
        })
        .then(() => promise_utils.exec(`mkdir /tmp/v${nodever}`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0(`pre_upgrade: Created dir /tmp/v${nodever}`);
        })
        .then(() => promise_utils.exec(`cp ${EXTRACTION_PATH}/noobaa-core/build/public/node-v${nodever}-linux-x64.tar.xz /tmp/`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0(`pre_upgrade: Copied node package`);
        })
        .then(() => promise_utils.exec(`tar -xJf /tmp/node-v${nodever}-linux-x64.tar.xz -C /tmp/v${nodever} --strip-components 1`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0(`pre_upgrade: Extracted node package`);
        })
        .then(() => promise_utils.exec(`mkdir -p ~/.nvm/versions/node/v${nodever}/`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0(`pre_upgrade: Created node dir`);
        })
        .then(() => promise_utils.exec(`mv /tmp/v${nodever}/* ~/.nvm/versions/node/v${nodever}/`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0(`pre_upgrade: Moved node dir from /tmp to /.nvm`);
        })
        .then(() => promise_utils.exec(`rm -f /usr/local/bin/node`, {
                ignore_rc: false,
                return_stdout: true,
                trim_stdout: true
            })
            .then(() => {
                dbg.log0(`pre_upgrade: Removed /usr/local/bin/node`);
            })
            .then(() => promise_utils.exec(`ln -s ~/.nvm/versions/node/v${nodever}/bin/node /usr/local/bin/node`, {
                ignore_rc: false,
                return_stdout: true,
                trim_stdout: true
            }))
            .then(() => promise_utils.exec(`. ${NVM_DIR}/nvm.sh;nvm alias default ${nodever}`, {
                ignore_rc: false,
                return_stdout: true,
                trim_stdout: true
            }))
            .then(() => promise_utils.exec(`. ${NVM_DIR}/nvm.sh;nvm use ${nodever}`, {
                ignore_rc: false,
                return_stdout: true,
                trim_stdout: true
            })))
        .then(() => {
            dbg.log0('pre_upgrade: Succeess');
        })
        .catch(function(err) {
            dbg.error('pre_upgrade: Failure', err);
            throw err;
        });
}

function post_upgrade() {
    dbg.set_process_name('UpgradeWrapperPostUpgrade');
    dbg.log0('post_upgrade: Called');
    let curmd;
    let prevmd;
    let agent_version_var;

    return P.join(
            promise_utils.exec(`md5sum /root/node_modules/noobaa-core/build/public/noobaa-setup*.exe | cut -f 1 -d' '`, {
                ignore_rc: false,
                return_stdout: true,
                trim_stdout: true
            }),
            promise_utils.exec(`md5sum /backup/build/public/noobaa-setup*.exe | cut -f 1 -d' '`, {
                ignore_rc: false,
                return_stdout: true,
                trim_stdout: true
            }),
            promise_utils.exec(`cp -f ${CORE_DIR}/src/deploy/NVA_build/noobaa_syslog.conf /etc/rsyslog.d/`, {
                ignore_rc: false,
                return_stdout: true,
                trim_stdout: true
            }),
            promise_utils.exec(`cp -f ${CORE_DIR}/src/deploy/NVA_build/logrotate_noobaa.conf /etc/logrotate.d/noobaa`, {
                ignore_rc: false,
                return_stdout: true,
                trim_stdout: true
            }),
            promise_utils.exec(`echo "*/15 * * * * /usr/sbin/logrotate /etc/logrotate.d/noobaa >/dev/null 2>&1" > /var/spool/cron/root`, {
                ignore_rc: false,
                return_stdout: true,
                trim_stdout: true
            })
        )
        .spread((res_curmd, res_prevmd) => {
            curmd = res_curmd;
            prevmd = res_prevmd;
            dbg.log0(`Note: installed MD5 was ${prevmd}, new is ${curmd}`);
        })
        .then(() => promise_utils.exec(`rm -f ${CORE_DIR}/.env`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0('post_upgrade: Removed .env');
        })
        .then(() => promise_utils.exec(`cp -f ${CORE_DIR}/src/deploy/NVA_build/env.orig ${CORE_DIR}/.env`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0('post_upgrade: Assigned new .env');
        })
        .then(function() {
            return promise_utils.exec(`grep JWT_SECRET /backup/.env`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                })
                .then(jwt => {
                    if (jwt === '') return P.resolve();
                    dbg.log0(`post_upgrade: Assigned old JWT_SECRET=${jwt}`);
                    return promise_utils.exec(`echo "${jwt}" >> ${CORE_DIR}/.env`, {
                        ignore_rc: false,
                        return_stdout: true,
                        trim_stdout: true
                    });
                });
        })
        .then(function() {
            return promise_utils.exec(`grep PLATFORM /backup/.env`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                })
                .then(plat => {
                    if (plat === '') return P.resolve();
                    dbg.log0(`post_upgrade: Assigned old PLATFORM=${plat}`);
                    return promise_utils.exec(`echo "${plat}" >> ${CORE_DIR}/.env`, {
                        ignore_rc: false,
                        return_stdout: true,
                        trim_stdout: true
                    });
                });
        })
        .then(function() {
            return promise_utils.exec(`grep "DEV_MODE=true" /backup/.env`, {
                    ignore_rc: true,
                    return_stdout: true,
                    trim_stdout: true
                })
                .then(devmode => {
                    if (devmode === '') return P.resolve();
                    dbg.log0(`post_upgrade: Assigned old DEV_MODE=${devmode}`);
                    return promise_utils.exec(`echo "${devmode}" >> ${CORE_DIR}/.env`, {
                        ignore_rc: false,
                        return_stdout: true,
                        trim_stdout: true
                    });
                });
        })
        .then(function() {
            return promise_utils.exec(`grep MONGO_RS_URL /backup/.env`, {
                    ignore_rc: true,
                    return_stdout: true,
                    trim_stdout: true
                })
                .then(mongo_url => {
                    if (mongo_url === '') return P.resolve();
                    dbg.log0(`post_upgrade: Assigned old MONGO_RS_URL=${mongo_url}`);
                    return promise_utils.exec(`echo "${mongo_url}" >> ${CORE_DIR}/.env`, {
                        ignore_rc: false,
                        return_stdout: true,
                        trim_stdout: true
                    });
                });
        })
        .then(function() {
            return promise_utils.exec(`grep MONGO_SSL_USER /backup/.env`, {
                    ignore_rc: true,
                    return_stdout: true,
                    trim_stdout: true
                })
                .then(mongo_user => {
                    if (mongo_user === '') return P.resolve();
                    dbg.log0(`post_upgrade: Assigned old MONGO_SSL_USER=${mongo_user}`);
                    return promise_utils.exec(`echo "${mongo_user}" >> ${CORE_DIR}/.env`, {
                        ignore_rc: false,
                        return_stdout: true,
                        trim_stdout: true
                    });
                });
        })
        .then(function() {
            return promise_utils.exec(`grep AGENT_VERSION /backup/.env`, {
                    ignore_rc: true,
                    return_stdout: true,
                    trim_stdout: true
                })
                // TODO: Why the heck are we doing that stuff if nobody uses it anyway except the stats_aggregator
                .then(res_agent_version_var => {
                    dbg.log0(`post_upgrade: AGENT_VERSION=${res_agent_version_var}`);
                    agent_version_var = res_agent_version_var;
                    if (curmd === prevmd) {
                        dbg.log0(`Note: MDs are the same, not updating agent version`);
                    } else {
                        dbg.log0(`Previous md differs from current, bumping agent version`);
                        if (agent_version_var === '') {
                            agent_version_var = `AGENT_VERSION=1`;
                        } else {
                            const AGENT_VERSION_NUMBER = parseInt(agent_version_var.slice(14), 10) + 1;
                            agent_version_var = `AGENT_VERSION=${AGENT_VERSION_NUMBER}`;
                            dbg.log0(`post_upgrade: bumped AGENT_VERSION=${agent_version_var}`);
                        }
                    }
                })
                .catch(err => {
                    dbg.error(err);
                });
        })
        .then(() => promise_utils.exec(`echo "${agent_version_var}" >> ${CORE_DIR}/.env`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => fix_security_issues())
        .then(() => promise_utils.exec(`cp -f ${CORE_DIR}/src/deploy/NVA_build/supervisord.orig /etc/rc.d/init.d/supervisord`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0('post_upgrade: Override supervisord');
        })
        .then(() => promise_utils.exec(`chmod 777 /etc/rc.d/init.d/supervisord`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0('post_upgrade: Configure permissions to supervisord');
        })
        .then(() => promise_utils.exec(`cp -f ${CORE_DIR}/src/deploy/NVA_build/first_install_diaglog.sh /etc/profile.d/`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0('post_upgrade: Copying first install dialog into profile.d');
        })
        .then(() => promise_utils.exec(`chown root:root /etc/profile.d/first_install_diaglog.sh`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => promise_utils.exec(`chmod 4755 /etc/profile.d/first_install_diaglog.sh`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0('post_upgrade: Configure permissions to first install dialog');
        })
        .then(() => promise_utils.exec(`rm -f /tmp/*.tar.gz`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(res => {
            dbg.log0(`post_upgrade: Removed all packages from /tmp/`);
        })
        .then(() => promise_utils.exec(`rm -rf /tmp/v*`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(res => {
            dbg.log0(`post_upgrade: Removed all files and folders starting with v from /tmp/`);
        })
        .then(() => promise_utils.exec(`rm -rf /backup/build/public/*diagnostics*`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0('post_upgrade: Succeess');
        })
        .catch(function(err) {
            dbg.error('post_upgrade: Failure', err);
            throw err;
        });
}

function run_upgrade_wrapper(params) {
    dbg.log0('run_upgrade_wrapper: Called', params);
    return P.resolve()
        .then(function() {
            return promise_utils.exec(`rm -rf /tmp/v*`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                })
                .then(res => {
                    dbg.log0(`run_upgrade_wrapper: Removed all files and folders starting with v from /tmp/`);
                })
                .then(() => {
                    switch (params.stage) {
                        case 'PRE_UPGRADE':
                            return P.resolve()
                                .then(() => pre_upgrade());
                        case 'POST_UPGRADE':
                            return P.resolve()
                                .then(() => post_upgrade());
                        default:
                            throw new Error('run_upgrade_wrapper not supported', params);
                    }
                });
        })
        .then(function() {
            dbg.log0('run_upgrade_wrapper: Success');
        })
        .catch(function(err) {
            dbg.error('run_upgrade_wrapper: Failure', err);
            throw err;
        });
}

function fix_security_issues() {
    dbg.log0('fix_security_issues: Called');
    return P.resolve()
        .then(function() {
            let should_work = true;
            return promise_utils.exec(`ping 8.8.8.8 -c 3`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                })
                .catch(err => {
                    should_work = false;
                    dbg.log0(`Missing internet connectivity`, err);
                })
                .then(function() {
                    if (!should_work) return P.resolve();
                    return promise_utils.exec(`cp -fd /etc/localtime /tmp`, {
                            ignore_rc: false,
                            return_stdout: true,
                            trim_stdout: true
                        })
                        .then(() => promise_utils.exec(`yum clean all`, {
                            ignore_rc: false,
                            return_stdout: true,
                            trim_stdout: true
                        }))
                        .then(res => {
                            dbg.log0('fix_security_issues: yum clean', res);
                        })
                        .then(() => promise_utils.exec(`yum update -y`, {
                            ignore_rc: false,
                            return_stdout: true,
                            trim_stdout: true
                        }))
                        .then(res => {
                            dbg.log0('fix_security_issues: yum update', res);
                        })
                        .then(function() {
                            return promise_utils.exec(`yum clean all`, {
                                    ignore_rc: false,
                                    return_stdout: true,
                                    trim_stdout: true
                                })
                                .then(() => {
                                    dbg.log0(`Updated yum packages`);
                                });
                        })
                        .then(() => promise_utils.exec(`cp -fd /tmp/localtime /etc`, {
                            ignore_rc: false,
                            return_stdout: true,
                            trim_stdout: true
                        }));
                });
        })
        .then(() => {
            dbg.log0('fix_security_issues: Success');
        })
        .catch(function(err) {
            dbg.error('fix_security_issues: Failure', err);
            throw err;
        });
}

function update_noobaa_net() {
    dbg.log0('update_noobaa_net: Called');
    return os_utils.get_all_network_interfaces()
        .then(function(interfaces) {
            let data = "";
            dbg.log0('current network interfaces are', interfaces);
            return P.map(interfaces, inter => {
                    data += inter + '\n';
                })
                .then(() => fs_utils.replace_file(NOOBAANET, data));
        })
        .then(() => {
            dbg.log0('update_noobaa_net: Success');
        })
        .catch(function(err) {
            dbg.error('update_noobaa_net: Failure', err);
            throw err;
        });
}
