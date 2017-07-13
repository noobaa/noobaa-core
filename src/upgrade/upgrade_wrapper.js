/* Copyright (C) 2016 NooBaa */
"use strict";

const P = require('../util/promise');
const fs_utils = require('../util/fs_utils');
const promise_utils = require('../util/promise_utils');
const os_utils = require('../util/os_utils');
const dbg = require('../util/debug_module')(__filename);
dbg.set_process_name('UpgradeWrapper');

const EXTRACTION_PATH = '/tmp/test';
const NOOBAA_ROOTPWD = '/etc/nbpwd';
const SUPERD = '/usr/bin/supervisord';
const SUPERCTL = '/usr/bin/supervisorctl';
const CORE_DIR = "/root/node_modules/noobaa-core";
const HOME = '/root';
const NVM_DIR = `${HOME}/.nvm`;
const NOOBAANET = '/etc/noobaa_network';

module.exports = {
    run_upgrade_wrapper: run_upgrade_wrapper
};

function fix_iptables() {
    dbg.log0(`fix_iptables: Called`);
    return P.resolve()
        .then(() => promise_utils.exec(`iptables -L -n -v | grep ':80 ' | grep eth0 | wc -l`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(exist => {
            if (exist === "1") {
                return promise_utils.exec(`iptables -D INPUT -i eth0 -p tcp --dport 80 -j ACCEPT`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                });
            }
        })
        .then(() => promise_utils.exec(`iptables -L -n -v | grep ':80 ' | wc -l`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(exist => {
            if (exist === "0") {
                return promise_utils.exec(`iptables -I INPUT 1  -p tcp --dport 80 -j ACCEPT`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                });
            }
        })
        .then(() => promise_utils.exec(`iptables -L -n -v | grep ':443 ' | grep eth0 | wc -l`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(exist => {
            if (exist === "1") {
                return promise_utils.exec(`iptables -D INPUT -i eth0 -p tcp --dport 443 -j ACCEPT`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                });
            }
        })
        .then(() => promise_utils.exec(`iptables -L -n -v | grep ':443 ' | wc -l`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(exist => {
            if (exist === "0") {
                return promise_utils.exec(`iptables -I INPUT 1  -p tcp --dport 443 -j ACCEPT`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                });
            }
        })
        .then(() => promise_utils.exec(`iptables -L -n -v | grep ':8080 ' | grep eth0 | wc -l`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(exist => {
            if (exist === "1") {
                return promise_utils.exec(`iptables -D INPUT -i eth0 -p tcp --dport 8080 -j ACCEPT`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                });
            }
        })
        .then(() => promise_utils.exec(`iptables -L -n -v | grep ':8080 ' | wc -l`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(exist => {
            if (exist === "0") {
                return promise_utils.exec(`iptables -I INPUT 1  -p tcp --dport 8080 -j ACCEPT`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                });
            }
        })
        .then(() => promise_utils.exec(`iptables -L -n -v | grep ':8443 ' | grep eth0 | wc -l`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(exist => {
            if (exist === "1") {
                return promise_utils.exec(`iptables -D INPUT -i eth0 -p tcp --dport 8443 -j ACCEPT`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                });
            }
        })
        .then(() => promise_utils.exec(`iptables -L -n -v | grep ':8443 ' | wc -l`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(exist => {
            if (exist === "0") {
                return promise_utils.exec(`iptables -I INPUT 1  -p tcp --dport 8443 -j ACCEPT`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                });
            }
        })
        .then(() => promise_utils.exec(`iptables -L -n -v | grep ':8444 ' | grep eth0 | wc -l`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(exist => {
            if (exist === "1") {
                return promise_utils.exec(`iptables -D INPUT -i eth0 -p tcp --dport 8444 -j ACCEPT`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                });
            }
        })
        .then(() => promise_utils.exec(`iptables -L -n -v | grep ':8444 ' | wc -l`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(exist => {
            if (exist === "0") {
                return promise_utils.exec(`iptables -I INPUT 1  -p tcp --dport 8444 -j ACCEPT`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                });
            }
        })
        .then(() => promise_utils.exec(`iptables -L -n -v| grep ':26050 ' | grep eth0 | wc -l`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(exist => {
            if (exist === "1") {
                return promise_utils.exec(`iptables -D INPUT -i eth0 -p tcp --dport 26050 -j ACCEPT`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                });
            }
        })
        .then(() => promise_utils.exec(`iptables -L -n -v| grep ':26050 ' | wc -l`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(exist => {
            if (exist === "0") {
                return promise_utils.exec(`iptables -I INPUT 1  -p tcp --dport 26050 -j ACCEPT`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                });
            }
        })
        .then(() => promise_utils.exec(`iptables -L -n -v | grep ':27000 ' | grep eth0 | wc -l`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(exist => {
            if (exist === "1") {
                return promise_utils.exec(`iptables -D INPUT -i eth0 -p tcp --dport 27000 -j ACCEPT`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                });
            }
        })
        .then(() => promise_utils.exec(`iptables -L -n -v | grep ':27000 ' | wc -l`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(exist => {
            if (exist === "0") {
                return promise_utils.exec(`iptables -I INPUT 1  -p tcp --dport 27000 -j ACCEPT`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                });
            }
        })
        .then(() => promise_utils.exec(`iptables -L -n | grep ':60100 ' | wc -l`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(exist => {
            if (exist === "1") {
                return promise_utils.exec(`iptables -D INPUT -i eth0 -p tcp --dport 60100 -j ACCEPT`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                });
            }
        })
        .then(() => promise_utils.exec(`iptables -L -n | grep "multiport dports 60100:60600" | wc -l`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(exist => {
            if (exist === "0") {
                return promise_utils.exec(`iptables -A INPUT -p tcp --match multiport --dports 60100:60600 -j ACCEPT`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                });
            }
        })
        .then(() => promise_utils.exec(`service iptables save`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0('fix_iptables: Succeess');
        })
        .catch(function(err) {
            dbg.error('fix_iptables: Failure', err);
            throw err;
        });
}


function disable_autostart() {
    dbg.log0('disable_autostart: Called');
    return promise_utils.exec(`sed -i "s:autostart=true:autostart=false:" /etc/noobaa_supervisor.conf`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        })
        .then(() => promise_utils.exec(`sed -i "s:web_server.js:WEB.JS:" /etc/noobaa_supervisor.conf`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0('disable_autostart: Succeess');
        })
        .catch(function(err) {
            dbg.error('disable_autostart: Failure', err);
            throw err;
        });
}

function enable_autostart() {
    dbg.log0('enable_autostart: Called');
    return promise_utils.exec(`sed -i "s:autostart=false:autostart=true:" /etc/noobaa_supervisor.conf`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        })
        .then(() => promise_utils.exec(`sed -i "s:WEB.JS:web_server.js:" /etc/noobaa_supervisor.conf`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0('enable_autostart: Succeess');
        })
        .catch(function(err) {
            dbg.error('enable_autostart: Failure', err);
            throw err;
        });
}

function upgrade_mongo_version() {
    dbg.log0('upgrade_mongo_version: Called');
    let skip_upgrade = false;
    return promise_utils.exec(`mongo --version | grep "version v3.4.4" | wc -l`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        })
        .then(ver => {
            dbg.log0('upgrade_mongo_version: Mongo version found', ver);
            if (ver !== '0') {
                skip_upgrade = true;
                throw new Error('SKIPPING UPGRADE');
            }
        })
        .then(() => disable_autostart())
        .then(() => promise_utils.exec(`${SUPERD}`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0('upgrade_mongo_version: Ran SUPERD');
        })
        .delay(3000)
        .then(() => promise_utils.exec(`sed -i 's:exclude=mongodb-org.*::' /etc/yum.conf`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0('upgrade_mongo_version: Updated yum.conf');
        })
        .then(() => promise_utils.exec(`${SUPERCTL} stop mongo_wrapper`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0('upgrade_mongo_version: Stopped mongo_wrapper');
        })
        .then(() => promise_utils.exec(`rm -f /etc/yum.repos.d/mongodb-org-*`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0('upgrade_mongo_version: Removed mongo from yum repos');
        })
        .then(() => promise_utils.exec(`cp -f ${CORE_DIR}/src/deploy/NVA_build/mongo.repo /etc/yum.repos.d/mongodb-org-3.4.repo`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0('upgrade_mongo_version: Copied mongo repo');
        })
        .then(() => {
            const packages_to_install = [
                'mongodb-org-3.4.4',
                'mongodb-org-server-3.4.4',
                'mongodb-org-shell-3.4.4',
                'mongodb-org-mongos-3.4.4',
                'mongodb-org-tools-3.4.4',
            ];
            return promise_utils.exec(`yum install -y ${packages_to_install.join(' ')}`, {
                ignore_rc: false,
                return_stdout: true,
                trim_stdout: true
            });
        })
        .then(res => {
            dbg.log0('upgrade_mongo_version: Installed yum packages', res);
        })
        .then(() => promise_utils.exec(`echo "exclude=mongodb-org,mongodb-org-server,mongodb-org-shell,mongodb-org-mongos,mongodb-org-tools" >> /etc/yum.conf`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0('upgrade_mongo_version: Updated yum.conf');
        })
        .then(() => enable_autostart())
        .then(() => promise_utils.exec(`${SUPERCTL} shutdown`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0('upgrade_mongo_version: Success');
        })
        .catch(err => {
            if (!skip_upgrade) {
                dbg.error('upgrade_mongo_version: Failure', err);
                throw err;
            }
        });
}

function setup_mongo_ssl() {
    dbg.log0('setup_mongo_ssl: Called');
    let client_subject;
    return fs_utils.file_must_not_exist('/etc/mongo_ssl/')
        .catch(err => {
            dbg.log0(err);
            return fs_utils.create_path('/etc/mongo_ssl/')
                .then(() => promise_utils.exec(`${CORE_DIR}/src/deploy/NVA_build/setup_mongo_ssl.sh`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                }))
                .then(res => {
                    dbg.log0('setup_mongo_ssl: Deployed setup_mongo_ssl.sh', res);
                })
                .then(() => promise_utils.exec(`chmod 400 -R /etc/mongo_ssl`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                }))
                .then(() => {
                    dbg.log0('setup_mongo_ssl: Configured permissions to /etc/mongo_ssl');
                })
                .then(() => promise_utils.exec(`openssl x509 -in /etc/mongo_ssl/client.pem -inform PEM -subject -nameopt RFC2253 | grep subject | awk '{sub("subject= ",""); print}'`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                }))
                .then(client_subject_res => {
                    dbg.log0('setup_mongo_ssl: openssl configuration', client_subject_res);
                    client_subject = client_subject_res;
                    return promise_utils.exec(`echo "MONGO_SSL_USER=${client_subject}" >> ${CORE_DIR}/.env`, {
                        ignore_rc: false,
                        return_stdout: true,
                        trim_stdout: true
                    });
                })
                .then(() => {
                    dbg.log0('setup_mongo_ssl: Configured MONGO_SSL_USER');
                })
                .then(() => promise_utils.exec(`echo "mongo --ssl --sslPEMKeyFile /etc/mongo_ssl/client.pem --sslCAFile /etc/mongo_ssl/root-ca.pem --sslAllowInvalidHostnames -u \\"${client_subject}\\" --authenticationMechanism MONGODB-X509 --authenticationDatabase \\"\\\\$external\\" \\"\\$@\\"" > /usr/bin/mongors`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                }))
                .then(() => {
                    dbg.log0('setup_mongo_ssl: Configured mongors');
                })
                .then(() => promise_utils.exec(`chmod +x /usr/bin/mongors`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                }));
        })
        .then(() => {
            dbg.log0('setup_mongo_ssl: Succeess');
        })
        .catch(function(err) {
            dbg.error('setup_mongo_ssl: Failure', err);
            throw err;
        });
}

function pre_upgrade() {
    dbg.set_process_name('UpgradeWrapperPreUpgrade');
    dbg.log0('pre_upgrade: Called');
    let nodever;
    return P.resolve()
        .then(() => update_noobaa_net())
        .then(() => fix_iptables())
        .then(() => promise_utils.exec(`mkdir -p /tmp/supervisor`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0('pre_upgrade: Created /tmp/supervisor');
        })
        .then(function() {
            return promise_utils.exec(`grep -q "net.ipv4.tcp_challenge_ack_limit = 999999999" /etc/sysctl.conf`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                })
                .catch(err => {
                    dbg.log0(err);
                    return promise_utils.exec(`echo "net.ipv4.tcp_challenge_ack_limit = 999999999" >> /etc/sysctl.conf`, {
                        ignore_rc: false,
                        return_stdout: true,
                        trim_stdout: true
                    });
                });
        })
        .then(() => promise_utils.exec(`echo "64000" > /proc/sys/kernel/threads-max`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0('pre_upgrade: Configured /proc/sys/kernel/threads-max');
        })
        .then(() => promise_utils.exec(`sysctl -w net.ipv4.tcp_keepalive_time=120`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0('pre_upgrade: Configured sysctl');
        })
        .then(() => promise_utils.exec(`sysctl -e -p`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0('pre_upgrade: Configured sysctl flags');
        })
        .then(function() {
            return promise_utils.exec(`grep -q 'fix_server_plat' /etc/rc.local`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                })
                .catch(err => {
                    dbg.log0(err);
                    return promise_utils.exec(`echo "bash /root/node_modules/noobaa-core/src/deploy/NVA_build/fix_server_plat.sh" >> /etc/rc.local`, {
                        ignore_rc: false,
                        return_stdout: true,
                        trim_stdout: true
                    });
                });
        })
        .then(() => promise_utils.exec(`sed -i 's:.*fix_server_sec.sh::' /etc/rc.local`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0('pre_upgrade: Configured /etc/rc.local');
        })
        .then(function() {
            return promise_utils.exec(`grep -q 'fix_server_sec' /etc/rc.local`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                })
                .catch(err => {
                    dbg.log0(err);
                    return promise_utils.exec(`echo "bash /root/node_modules/noobaa-core/src/deploy/NVA_build/fix_server_sec.sh" >> /etc/rc.local`, {
                        ignore_rc: false,
                        return_stdout: true,
                        trim_stdout: true
                    });
                });
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
        .then(() => {
            return promise_utils.exec(`rm -f /usr/local/bin/node`, {
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
                }));
        })
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
            let should_work = true;
            return promise_utils.exec(`grep -q JWT_SECRET /backup/.env`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                })
                .catch(err => {
                    dbg.log0(err);
                    should_work = false;
                })
                .then(res => {
                    if (!should_work) return P.resolve();
                    dbg.log0(res);
                    return promise_utils.exec(`grep JWT_SECRET /backup/.env`, {
                            ignore_rc: false,
                            return_stdout: true,
                            trim_stdout: true
                        })
                        .then(jwt => {
                            dbg.log0(`post_upgrade: Assigned old JWT_SECRET=${jwt}`);
                            return promise_utils.exec(`echo "${jwt}" >> ${CORE_DIR}/.env`, {
                                ignore_rc: false,
                                return_stdout: true,
                                trim_stdout: true
                            });
                        });
                });
        })
        .then(function() {
            let should_work = true;
            return promise_utils.exec(`grep -q "DEV_MODE=true" /backup/.env`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                })
                .catch(err => {
                    dbg.log0(err);
                    should_work = false;
                })
                .then(res => {
                    if (!should_work) return P.resolve();
                    return promise_utils.exec(`grep "DEV_MODE=true" /backup/.env`, {
                            ignore_rc: false,
                            return_stdout: true,
                            trim_stdout: true
                        })
                        .then(devmode => {
                            dbg.log0(`post_upgrade: Assigned old DEV_MODE=${devmode}`);
                            return promise_utils.exec(`echo "${devmode}" >> ${CORE_DIR}/.env`, {
                                ignore_rc: false,
                                return_stdout: true,
                                trim_stdout: true
                            });
                        });
                });
        })
        .then(function() {
            let should_work = true;
            return promise_utils.exec(`grep -q MONGO_RS_URL /backup/.env`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                })
                .catch(err => {
                    dbg.log0(err);
                    should_work = false;
                })
                .then(res => {
                    if (!should_work) return P.resolve();
                    return promise_utils.exec(`grep MONGO_RS_URL /backup/.env`, {
                            ignore_rc: false,
                            return_stdout: true,
                            trim_stdout: true
                        })
                        .then(mongo_url => {
                            dbg.log0(`post_upgrade: Assigned old MONGO_RS_URL=${mongo_url}`);
                            return promise_utils.exec(`echo "${mongo_url}" >> ${CORE_DIR}/.env`, {
                                ignore_rc: false,
                                return_stdout: true,
                                trim_stdout: true
                            });
                        });
                });
        })
        .then(function() {
            let should_work = true;
            return promise_utils.exec(`grep -q MONGO_SSL_USER /backup/.env`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                })
                .catch(err => {
                    dbg.log0(err);
                    should_work = false;
                })
                .then(res => {
                    if (!should_work) return P.resolve();
                    return promise_utils.exec(`grep MONGO_SSL_USER /backup/.env`, {
                            ignore_rc: false,
                            return_stdout: true,
                            trim_stdout: true
                        })
                        .then(mongo_user => {
                            dbg.log0(`post_upgrade: Assigned old MONGO_SSL_USER=${mongo_user}`);
                            return promise_utils.exec(`echo "${mongo_user}" >> ${CORE_DIR}/.env`, {
                                ignore_rc: false,
                                return_stdout: true,
                                trim_stdout: true
                            });
                        });
                });
        })
        .then(function() {
            return promise_utils.exec(`grep AGENT_VERSION /backup/.env`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                })
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
        .then(function() {
            return P.join(
                    promise_utils.exec(`grep "bg_workers_starter" /etc/noobaa_supervisor.conf | wc -l`, {
                        ignore_rc: false,
                        return_stdout: true,
                        trim_stdout: true
                    }),
                    promise_utils.exec(`grep "mongodb" /etc/noobaa_supervisor.conf | wc -l`, {
                        ignore_rc: false,
                        return_stdout: true,
                        trim_stdout: true
                    }),
                    promise_utils.exec(`grep "stderr_logfile_backups" /etc/noobaa_supervisor.conf | wc -l`, {
                        ignore_rc: false,
                        return_stdout: true,
                        trim_stdout: true
                    })
                )
                .spread((bg_res, mongo_db_res, log_res) => {
                    dbg.log0(`post_upgrade: Configuration of /etc/noobaa_supervisor.conf BG=${bg_res}, MONGO=${mongo_db_res}, LOG=${log_res}`);
                    if (bg_res === '1' || mongo_db_res === '1' || log_res === '0') {
                        dbg.log0(`post_upgrade: Override /etc/noobaa_supervisor.conf with new`);
                        return promise_utils.exec(`cp -f ${CORE_DIR}/src/deploy/NVA_build/noobaa_supervisor.conf /etc/noobaa_supervisor.conf`, {
                            ignore_rc: false,
                            return_stdout: true,
                            trim_stdout: true
                        });
                    }
                });
        })
        .then(() => {
            // add --systemcheck and --syslog to mongo_wrapper
            return promise_utils.exec(`grep -q "\\-\\-syslog \\-\\-syslogFacility local0" /etc/noobaa_supervisor.conf`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                })
                .catch(err => {
                    dbg.log0(err);
                    return promise_utils.exec(`grep mongo_wrapper.sh /etc/noobaa_supervisor.conf | sed 's:command=\\(.*\\):\\1:'`, {
                            ignore_rc: false,
                            return_stdout: true,
                            trim_stdout: true
                        })
                        .then(res => {
                            dbg.log0('post_upgrade: Current mongo_wrapper.sh configuration', res);
                            const newcmd = res + " --syslog --syslogFacility local0";
                            return promise_utils.exec(`echo ${newcmd} | sed 's:\\(.*mongo_wrapper.sh \\)\\(.*\\):command=\\1--testsystem \\2:'`, {
                                ignore_rc: false,
                                return_stdout: true,
                                trim_stdout: true
                            });
                        })
                        .then(newcmd => promise_utils.exec(`sed -i "s:.*mongo_wrapper.sh.*:${newcmd}:" /etc/noobaa_supervisor.conf`, {
                            ignore_rc: false,
                            return_stdout: true,
                            trim_stdout: true
                        }))
                        .catch(error => {
                            dbg.error(error);
                            throw error;
                        });
                });
        })
        .then(() => fix_security_issues())
        .then(() => promise_utils.exec(`sed -i 's:logfile=.*:logfile=/tmp/supervisor/supervisord.log:' /etc/supervisord.conf`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => promise_utils.exec(`sed -i 's:;childlogdir=.*:childlogdir=/tmp/supervisor/:' /etc/supervisord.conf`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => promise_utils.exec(`sed -i 's:logfile_backups=.*:logfile_backups=5:' /etc/supervisord.conf`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0('post_upgrade: Updated /etc/supervisord.conf configurations');
        })
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
        .then(() => promise_utils.exec(`chkconfig --level 2 supervisord off`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        }))
        .then(() => {
            dbg.log0('post_upgrade: Configure chkconfig of supervisord');
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
        .then(() => {
            dbg.log0('list core dir');
            return promise_utils.exec(`ls -R ${CORE_DIR}/build/`, {
                    ignore_rc: false,
                    return_stdout: true,
                })
                .then(res => {
                    dbg.log0('post_upgrade: /build/ directory', res);
                })
                .catch(err => {
                    dbg.error(err);
                });
        })
        .then(function() {
            return promise_utils.exec(`grep noobaa /etc/sudoers | wc -l`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                })
                .then(function(res) {
                    if (res === '0') {
                        dbg.log0(`post_upgrade: Adding noobaa to sudoers`);
                        return promise_utils.exec(`echo "noobaa ALL=(ALL)   NOPASSWD:ALL" >> /etc/sudoers`, {
                                ignore_rc: false,
                                return_stdout: true,
                                trim_stdout: true
                            })
                            .then(() => promise_utils.exec(`grep noobaa /etc/sudoers | wc -l`, {
                                ignore_rc: false,
                                return_stdout: true,
                                trim_stdout: true
                            }))
                            .then(reply => {
                                if (reply === '0') {
                                    dbg.log0(`post_upgrade: Failed to add noobaa to sudoers`);
                                }
                            });
                    }
                });
        })
        .then(function() {
            return fs_utils.file_must_not_exist(`/etc/init.d/mongod`)
                .catch(err => {
                    dbg.log0(err);
                    dbg.log0(`removed mongod service (supervised by supervisord)`);
                    return promise_utils.exec(`chkconfig mongod off`, {
                            ignore_rc: false,
                            return_stdout: true,
                            trim_stdout: true
                        })
                        .then(() => {
                            dbg.log0('post_upgrade: Removed mongod from chkconfig');
                        })
                        .then(() => promise_utils.exec(`rm -f /etc/init.d/mongod`, {
                            ignore_rc: false,
                            return_stdout: true,
                            trim_stdout: true
                        }));
                });
        })
        .then(function() {
            return promise_utils.exec(`yum list installed ntp > /dev/null 2>&1`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                })
                .then(res => {
                    dbg.log0(`post_upgrade: Ntp installed`, res);
                })
                .catch(err => {
                    dbg.log0(`post_upgrade: Installing ntp`, err);
                    return promise_utils.exec(`yum install -y ntp`, {
                            ignore_rc: false,
                            return_stdout: true,
                            trim_stdout: true
                        })
                        .then(res => {
                            dbg.log0('post_upgrade: Installed Ntp', res);
                        })
                        .then(() => promise_utils.exec(`/sbin/chkconfig ntpd on 2345`, {
                            ignore_rc: false,
                            return_stdout: true,
                            trim_stdout: true
                        }))
                        .then(() => promise_utils.exec(`/etc/init.d/ntpd start`, {
                            ignore_rc: false,
                            return_stdout: true,
                            trim_stdout: true
                        }))
                        .then(() => promise_utils.exec(`sed -i 's:\\(^server.*\\):#\\1:g' /etc/ntp.conf`, {
                            ignore_rc: false,
                            return_stdout: true,
                            trim_stdout: true
                        }))
                        .then(() => promise_utils.exec(`ln -sf /usr/share/zoneinfo/US/Pacific /etc/localtime`, {
                            ignore_rc: false,
                            return_stdout: true,
                            trim_stdout: true
                        }));
                });
        })
        .then(function() {
            return promise_utils.exec(`grep 'NooBaa Configured NTP Server' /etc/ntp.conf | wc -l`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                })
                .then(noobaa_ntp => {
                    if (noobaa_ntp !== '0') {
                        dbg.log0('post_upgrade: Added NTP server line into ntp.conf');
                        return promise_utils.exec(`echo "# NooBaa Configured NTP Server" >> /etc/ntp.conf`, {
                            ignore_rc: false,
                            return_stdout: true,
                            trim_stdout: true
                        });
                    }
                });
        })
        .then(function() {
            return promise_utils.exec(`grep 'NooBaa Configured Primary DNS Server' /etc/resolv.conf | wc -l`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                })
                .then(noobaa_dns => {
                    if (noobaa_dns === '0') {
                        dbg.log0('post_upgrade: Added DNS server lines into resolv.conf');
                        return promise_utils.exec(`echo "#NooBaa Configured Primary DNS Server" >> /etc/resolv.conf`, {
                                ignore_rc: false,
                                return_stdout: true,
                                trim_stdout: true
                            })
                            .then(() => promise_utils.exec(`echo "#NooBaa Configured Secondary DNS Server" >> /etc/resolv.conf`, {
                                ignore_rc: false,
                                return_stdout: true,
                                trim_stdout: true
                            }));
                    }
                });
        })
        .then(function() {
            return promise_utils.exec(`grep 'NooBaa Configured Search' /etc/resolv.conf | wc -l`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                })
                .then(noobaa_search => {
                    if (noobaa_search === '0') {
                        dbg.log0('post_upgrade: Added Configured Search line into resolv.conf');
                        return promise_utils.exec(`echo "#NooBaa Configured Search" >> /etc/resolv.conf`, {
                            ignore_rc: false,
                            return_stdout: true,
                            trim_stdout: true
                        });
                    }
                });
        })
        .then(() => upgrade_mongo_version())
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
        .then(() => setup_mongo_ssl())
        .then(function() {
            return fs_utils.file_must_not_exist(`/usr/lib/node_modules/`)
                .catch(() => promise_utils.exec(`rm -rf /usr/lib/node_modules/`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                }));
        })
        .then(function() {
            return fs_utils.file_must_not_exist(`/usr/local/lib/node_modules/`)
                .catch(() => promise_utils.exec(`rm -rf /usr/local/lib/node_modules/`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                }));
        })
        .then(function() {
            return fs_utils.file_must_not_exist(`/usr/src/node-v0.10.33/`)
                .catch(() => promise_utils.exec(`rm -rf /usr/src/node-v0.10.33/`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                }));
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
    return P.join(
            promise_utils.exec(`grep '#X11Forwarding no' /etc/ssh/sshd_config | wc -l`, {
                ignore_rc: false,
                return_stdout: true,
                trim_stdout: true
            }),
            promise_utils.exec(`grep timeout /etc/yum.conf | wc -l`, {
                ignore_rc: false,
                return_stdout: true,
                trim_stdout: true
            })
        )
        .spread(function(sshd_exists, timeout_exists) {
            dbg.log0('fix_security_issues: Success', sshd_exists, timeout_exists);
            return P.join(
                P.resolve().then(() => {
                    if (sshd_exists === '0') {
                        return promise_utils.exec(`sed -i -e 's/X11Forwarding yes/#X11Forwarding yes/g' /etc/ssh/sshd_config`, {
                                ignore_rc: false,
                                return_stdout: true,
                                trim_stdout: true
                            })
                            .then(() => promise_utils.exec(`sed -i -e 's/#X11Forwarding no/X11Forwarding no/g' /etc/ssh/sshd_config`, {
                                ignore_rc: false,
                                return_stdout: true,
                                trim_stdout: true
                            }))
                            .then(() => promise_utils.exec(`sed -i -e 's/#MaxStartups/MaxStartups/g' /etc/ssh/sshd_config`, {
                                ignore_rc: false,
                                return_stdout: true,
                                trim_stdout: true
                            }))
                            .then(() => promise_utils.exec(`/etc/init.d/sshd restart`, {
                                ignore_rc: false,
                                return_stdout: true,
                                trim_stdout: true
                            }));
                    }
                }),
                P.resolve().then(() => {
                    // #proxy settings for yum install - for future use
                    // #http_proxy="http://yum-user:qwerty@mycache.mydomain.com:3128"
                    // #export http_proxy
                    if (timeout_exists === '0') {
                        return promise_utils.exec(`echo timeout=20 >> /etc/yum.conf`, {
                            ignore_rc: false,
                            return_stdout: true,
                            trim_stdout: true
                        });
                    }
                })
            );
        })
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
        .then(function() {
            let rootpwd;
            return fs_utils.file_must_exist(NOOBAA_ROOTPWD)
                .then(() => {
                    dbg.log0('fix_security_issues: NOOBAA_ROOTPWD', NOOBAA_ROOTPWD);
                    // # workaround for test servers - specify password in /etc/nbpwd file
                    rootpwd = NOOBAA_ROOTPWD;
                })
                .catch(err => {
                    dbg.log0(err);
                    return promise_utils.exec(`uuidgen`, {
                            ignore_rc: false,
                            return_stdout: true,
                            trim_stdout: true
                        })
                        .then(res => {
                            dbg.log0('fix_security_issues: uuidgen', res);
                            rootpwd = res;
                        });
                })
                .then(() => promise_utils.exec(`echo ${rootpwd} | passwd root --stdin`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                }));
        })
        .then(function() {
            return promise_utils.exec(`grep -q 'PermitRootLogin no' /etc/ssh/sshd_config`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                })
                .catch(err => {
                    dbg.log0(err);
                    return promise_utils.exec(`echo 'PermitRootLogin no' >> /etc/ssh/sshd_config`, {
                        ignore_rc: false,
                        return_stdout: true,
                        trim_stdout: true
                    });
                });
        })
        .then(function() {
            return promise_utils.exec(`grep -q 'Match User noobaa' /etc/ssh/sshd_config`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                })
                .catch(err => {
                    dbg.log0(err);
                    return P.all([
                        promise_utils.exec(`echo 'Match User noobaa'  >> /etc/ssh/sshd_config`, {
                            ignore_rc: false,
                            return_stdout: true,
                            trim_stdout: true
                        }),
                        promise_utils.exec(`echo 'PasswordAuthentication no'  >> /etc/ssh/sshd_config`, {
                            ignore_rc: false,
                            return_stdout: true,
                            trim_stdout: true
                        })
                    ]);
                });
        })
        .then(function() {
            return promise_utils.exec(`grep -q 'fix_server_plat' /etc/rc.local`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                })
                .catch(err => {
                    dbg.log0(err);
                    return promise_utils.exec(`echo "bash /root/node_modules/noobaa-core/src/deploy/NVA_build/fix_server_plat.sh" >> /etc/rc.local`, {
                        ignore_rc: false,
                        return_stdout: true,
                        trim_stdout: true
                    });
                });
        })
        .then(function() {
            return promise_utils.exec(`grep -q 'fix_mongo_ssl' /etc/rc.local`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                })
                .catch(err => {
                    dbg.log0(err);
                    return promise_utils.exec(`echo "bash /root/node_modules/noobaa-core/src/deploy/NVA_build/fix_mongo_ssl.sh" >> /etc/rc.local`, {
                        ignore_rc: false,
                        return_stdout: true,
                        trim_stdout: true
                    });
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
