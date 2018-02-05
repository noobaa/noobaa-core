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

const EXEC_DEFAULTS = Object.freeze({
    ignore_rc: false,
    return_stdout: true,
    trim_stdout: true
});
const EXEC_IGNORE_RC = Object.freeze({
    ignore_rc: true,
    return_stdout: true,
    trim_stdout: true
});

function exec(command) {
    return promise_utils.exec(command, EXEC_DEFAULTS);
}

function exec_ignore_rc(command) {
    return promise_utils.exec(command, EXEC_IGNORE_RC);
}


function pre_upgrade() {
    dbg.set_process_name('UpgradeWrapperPreUpgrade');
    dbg.log0('pre_upgrade: Called');
    let nodever;
    return P.resolve()
        .then(() => setup_swap())
        .then(() => update_noobaa_net())
        .then(() => exec(`mkdir -p /tmp/supervisor`))
        .then(() => dbg.log0('pre_upgrade: Created /tmp/supervisor'))
        .then(() => exec(`rm -rf ~/.nvm`))
        .then(() => dbg.log0('pre_upgrade: Removed ~/.nvm'))
        .then(() => exec(`mkdir ~/.nvm`))
        .then(() => dbg.log0('pre_upgrade: Created ~/.nvm'))
        .then(() => exec(`cp ${EXTRACTION_PATH}/noobaa-core/build/public/nvm.sh ~/.nvm/`))
        .then(() => dbg.log0('pre_upgrade: Copied nvm.sh'))
        .then(() => exec(`chmod 777 ~/.nvm/nvm.sh`))
        .then(() => dbg.log0('pre_upgrade: Configured permissions to nvm.sh'))
        .then(() => exec(`cat ${EXTRACTION_PATH}/noobaa-core/.nvmrc`))
        .then(res => {
            nodever = res;
        })
        .then(() => dbg.log0('pre_upgrade: Nodever', nodever))
        .then(() => exec(`mkdir /tmp/v${nodever}`))
        .then(() => dbg.log0(`pre_upgrade: Created dir /tmp/v${nodever}`))
        .then(() => exec(`cp ${EXTRACTION_PATH}/noobaa-core/build/public/node-v${nodever}-linux-x64.tar.xz /tmp/`))
        .then(() => dbg.log0(`pre_upgrade: Copied node package`))
        .then(() => exec(`tar -xJf /tmp/node-v${nodever}-linux-x64.tar.xz -C /tmp/v${nodever} --strip-components 1`))
        .then(() => dbg.log0(`pre_upgrade: Extracted node package`))
        .then(() => exec(`mkdir -p ~/.nvm/versions/node/v${nodever}/`))
        .then(() => dbg.log0(`pre_upgrade: Created node dir`))
        .then(() => exec(`mv /tmp/v${nodever}/* ~/.nvm/versions/node/v${nodever}/`))
        .then(() => dbg.log0(`pre_upgrade: Moved node dir from /tmp to /.nvm`))
        .then(() => exec(`rm -f /usr/local/bin/node`))
        .then(() => dbg.log0(`pre_upgrade: Removed /usr/local/bin/node`))
        .then(() => exec(`ln -s ~/.nvm/versions/node/v${nodever}/bin/node /usr/local/bin/node`))
        .then(() => exec(`. ${NVM_DIR}/nvm.sh;nvm alias default ${nodever}`))
        .then(() => exec(`. ${NVM_DIR}/nvm.sh;nvm use ${nodever}`))
        .then(() => dbg.log0('pre_upgrade: Succeess'))
        .catch(err => {
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
            exec_ignore_rc(`md5sum /root/node_modules/noobaa-core/build/public/noobaa-setup*.exe | cut -f 1 -d' '`),
            exec_ignore_rc(`md5sum /backup/build/public/noobaa-setup*.exe | cut -f 1 -d' '`),
            exec(`cp -f ${CORE_DIR}/src/deploy/NVA_build/noobaa_syslog.conf /etc/rsyslog.d/`),
            exec(`cp -f ${CORE_DIR}/src/deploy/NVA_build/logrotate_noobaa.conf /etc/logrotate.d/noobaa`),
            exec(`echo "*/15 * * * * /usr/sbin/logrotate /etc/logrotate.d/noobaa >/dev/null 2>&1" > /var/spool/cron/root`),
            // eslint-disable-next-line no-useless-escape
            exec_ignore_rc(`sed -i "s:^.*ActionFileDefaultTemplate.*::" /etc/rsyslog.conf`)
        )
        .spread((res_curmd, res_prevmd) => {
            curmd = res_curmd;
            prevmd = res_prevmd;
        })
        .then(() => dbg.log0(`Note: installed MD5 was ${prevmd}, new is ${curmd}`))
        .then(() => exec(`rm -f ${CORE_DIR}/.env`))
        .then(() => dbg.log0('post_upgrade: Removed .env'))
        .then(() => exec(`cp -f ${CORE_DIR}/src/deploy/NVA_build/env.orig ${CORE_DIR}/.env`))
        .then(() => dbg.log0('post_upgrade: Assigned new .env'))
        .then(() => exec(`grep JWT_SECRET /backup/.env`))
        .then(jwt => {
            if (jwt === '') return;
            dbg.log0(`post_upgrade: Assigned old JWT_SECRET=${jwt}`);
            return exec(`echo "${jwt}" >> ${CORE_DIR}/.env`);
        })
        .then(() => exec(`grep PLATFORM /backup/.env`))
        .then(plat => {
            if (plat === '') return;
            dbg.log0(`post_upgrade: Assigned old PLATFORM=${plat}`);
            return exec(`echo "${plat}" >> ${CORE_DIR}/.env`);
        })
        .then(() => exec_ignore_rc(`grep "DEV_MODE=true" /backup/.env`))
        .then(devmode => {
            if (devmode === '') return;
            dbg.log0(`post_upgrade: Assigned old DEV_MODE=${devmode}`);
            return exec(`echo "${devmode}" >> ${CORE_DIR}/.env`);
        })
        .then(() => exec_ignore_rc(`grep MONGO_RS_URL /backup/.env`))
        .then(mongo_url => {
            if (mongo_url === '') return;
            dbg.log0(`post_upgrade: Assigned old MONGO_RS_URL=${mongo_url}`);
            return exec(`echo "${mongo_url}" >> ${CORE_DIR}/.env`);
        })
        .then(() => exec_ignore_rc(`grep MONGO_SSL_USER /backup/.env`))
        .then(mongo_user => {
            if (mongo_user === '') return;
            dbg.log0(`post_upgrade: Assigned old MONGO_SSL_USER=${mongo_user}`);
            return exec(`echo "${mongo_user}" >> ${CORE_DIR}/.env`);
        })
        .then(() => exec_ignore_rc(`grep AGENT_VERSION /backup/.env`)
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
            })
        )
        .then(() => exec(`echo "${agent_version_var}" >> ${CORE_DIR}/.env`))
        .then(() => exec(`cp -f ${CORE_DIR}/src/deploy/NVA_build/supervisord.orig /etc/rc.d/init.d/supervisord`))
        .then(() => dbg.log0('post_upgrade: Override supervisord'))
        .then(() => exec(`chmod 777 /etc/rc.d/init.d/supervisord`))
        .then(() => dbg.log0('post_upgrade: Configure permissions to supervisord'))
        .then(() => exec(`cp -f ${CORE_DIR}/src/deploy/NVA_build/first_install_diaglog.sh /etc/profile.d/`))
        .then(() => dbg.log0('post_upgrade: Copying first install dialog into profile.d'))
        .then(() => exec(`chown root:root /etc/profile.d/first_install_diaglog.sh`))
        .then(() => exec(`chmod 4755 /etc/profile.d/first_install_diaglog.sh`))
        .then(() => dbg.log0('post_upgrade: Configure permissions to first install dialog'))
        .then(() => exec_ignore_rc(`rm -f /tmp/*.tar.gz`))
        .then(res => dbg.log0(`post_upgrade: Removed all packages from /tmp/`))
        .then(() => exec_ignore_rc(`rm -rf /tmp/v*`))
        .then(res => dbg.log0(`post_upgrade: Removed all files and folders starting with v from /tmp/`))
        .then(() => exec_ignore_rc(`rm -rf /backup/build/public/*diagnostics*`))
        .then(() => dbg.log0('post_upgrade: Succeess'))
        .catch(err => {
            dbg.error('post_upgrade: Failure', err);
            throw err;
        });
}

function run_upgrade_wrapper(params) {
    dbg.log0('run_upgrade_wrapper: Called', params);
    return P.resolve()
        .then(() => exec(`rm -rf /tmp/v*`))
        .then(() => dbg.log0(`run_upgrade_wrapper: Removed all files and folders starting with v from /tmp/`))
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
        })
        .then(() => dbg.log0('run_upgrade_wrapper: Success'))
        .catch(err => {
            dbg.error('run_upgrade_wrapper: Failure', err);
            throw err;
        });
}


function update_noobaa_net() {
    dbg.log0('update_noobaa_net: Called');
    return os_utils.get_all_network_interfaces()
        .then(interfaces => {
            let data = "";
            dbg.log0('current network interfaces are', interfaces);
            return P.map(interfaces, inter => {
                    data += inter + '\n';
                })
                .then(() => fs_utils.replace_file(NOOBAANET, data));
        })
        .then(() => dbg.log0('update_noobaa_net: Success'))
        .catch(err => {
            dbg.error('update_noobaa_net: Failure', err);
            throw err;
        });
}

function setup_swap() {
    const SWAP_SIZE_MB = 8 * 1024;
    return P.resolve()
        .then(() => exec(`swapon -s`))
        .then(swap_summary => {
            if (swap_summary) {
                dbg.log0('setup_swap: Swap summary:', swap_summary);
                return;
            }
            dbg.log0('setup_swap: Creating swapfile');
            return P.resolve()
                .then(() => exec(`dd if=/dev/zero bs=1M count=${SWAP_SIZE_MB} of=/swapfile`))
                .then(() => exec(`chmod 600 /swapfile`))
                .then(() => exec(`mkswap /swapfile`))
                .then(() => exec(`swapon /swapfile`));
        })
        .then(() => dbg.log0('setup_swap: Success'));
}


exports.run_upgrade_wrapper = run_upgrade_wrapper;
