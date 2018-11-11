/* Copyright (C) 2016 NooBaa */
"use strict";

const os = require('os');
const fs = require('fs');
const path = require('path');
const _ = require('lodash');

const pkg = require('../../package.json');
const dbg = require('../util/debug_module')(__filename);
const P = require('../util/promise');
const promise_utils = require('../util/promise_utils');
const fs_utils = require('../util/fs_utils');
const dotenv = require('../util/dotenv');
const os_utils = require('../util/os_utils');
const supervisor = require('../server/utils/supervisor_ctrl');
const mongo_client = require('../util/mongo_client');

const EXTRACTION_PATH = '/tmp/test';
const UPGRADE_INFO_FILE_PATH = `/tmp/upgrade_info_${pkg.version}.json`;
const CORE_DIR = '/root/node_modules/noobaa-core';
const NEW_VERSION_DIR = path.join(EXTRACTION_PATH, 'noobaa-core');
// use shell script for backup\restore so we won't be dependent in node version
const BACKUP_SCRIPT = path.join(CORE_DIR, 'src/upgrade/pre_upgrade_backup.sh');
const BACKUP_SCRIPT_NEW_PATH = path.join(EXTRACTION_PATH, 'pre_upgrade_backup.sh');
const HOME = '/root';
const NVM_DIR = `${HOME}/.nvm`;

const SWAP_SIZE_MB = 8 * 1024;


// in clustered mongo it can take time before all members are operational. wait up to 10 minutes
const WAIT_FOR_MONGO_TIMEOUT = 10 * 60000;


const DOTENV_VARS_FROM_OLD_VER = Object.freeze([
    'JWT_SECRET',
    'PLATFORM',
    'DEV_MODE',
    'MONGO_RS_URL',
    'MONGO_SSL_USER',
    'ENDPOINT_BLOB_ENABLED'
]);

const EXEC_DEFAULTS = Object.freeze({
    ignore_rc: false,
    return_stdout: true,
    trim_stdout: true
});

// map process name (in ps) to service name (in supervisor.conf)
const SERVICES_INFO = Object.freeze([{
        srv: 'STUN',
        proc: 'turnserver',
        stop: true,
    },
    {
        srv: 'webserver',
        proc: 'web_server',
        stop: true,
    },
    {
        srv: 'bg_workers',
        proc: 'bg_workers',
        stop: true,
    },
    {
        srv: 'hosted_agents',
        proc: 'hosted_agents_starter',
        stop: true,
    },
    {
        srv: 's3rver',
        proc: 's3rver_starter',
        stop: true,
    },
    {
        srv: 'mongo_monitor',
        proc: 'mongo_monitor',
        stop: true,
    },
    {
        srv: 'upgrade_manager',
        proc: 'upgrade_manager',
        stop: false,
    },
    {
        srv: 'mongo_wrapper',
        proc: 'mongo_wrapper',
        stop: false,
    },
]);


async function services_to_stop() {
    const supervised_list = await supervisor.list();
    dbg.log0('UPGRADE: current services list is', supervised_list);

    // stop all services but upgrade_manager and mongo
    return supervised_list.filter(srv => (
        srv !== 'mongo_wrapper' &&
        srv !== 'upgrade_manager'));
}


async function stop_services() {
    // first stop all services in supervisor conf except those required for upgrade
    dbg.log0('UPGRADE: stopping services before upgrade');
    const srv_to_stop = await services_to_stop();
    dbg.log0('UPGRADE: stopping services:', srv_to_stop);
    await supervisor.stop(srv_to_stop);

    // now make sure that all the services to stop are actually stopped
    const procs = SERVICES_INFO
        .filter(info => srv_to_stop.includes(info.srv))
        .map(info => info.proc);
    const ps_services = await os_utils.get_services_ps_info(procs);
    if (ps_services.length > 0) {
        dbg.warn('UPGRADE: found services that should be down. killing them:', ps_services);
        ps_services.forEach(srv => {
            try {
                process.kill(Number.parseInt(srv.pid, 10), 'SIGKILL');
            } catch (err) {
                dbg.warn('failed killing process', srv);
            }
        });
    }

    // now make sure that there is no rouge 
}

async function start_services() {
    const stopped_services = await services_to_stop();
    dbg.log0('UPGRADE: starting services:', stopped_services);
    await supervisor.start(stopped_services);
}

async function run_platform_upgrade_steps(old_version) {
    if (!should_upgrade_platform()) return;

    dbg.log0(`UPGRADE: upgrading from version ${old_version}`);

    await platform_upgrade_common();

    // perform specific platform upgrades according to old version
    const [major_ver, minor_ver] = parse_ver(old_version.split('-')[0]);
    if (major_ver <= 2) {
        if (minor_ver < 4) await platform_upgrade_2_4_0();
        if (minor_ver < 7) await platform_upgrade_2_7_0();
        if (minor_ver < 8) await platform_upgrade_2_8_0();
        if (minor_ver < 10) await platform_upgrade_2_10_0();
    }

}

async function platform_upgrade_2_10_0() {
    dbg.log0('UPGRADE: running platform_upgrade_2_10_0');
    // azure handles swap in a non generic way. fix to the azure way
    await fix_azure_swap();
    await fix_supervisor_alias();
}


async function fix_mongod_user() {
    // change ownership of mongo related files to mongod user\group
    await exec('chown -R mongod:mongod /var/lib/mongo/');
    await exec('chown -R mongod:mongod /etc/mongo_ssl/');
    //change permissions for mongo_ssl files - allow r\x for dir and r only for files
    await exec('chmod 400 -R /etc/mongo_ssl/*');
    await exec('chmod 500 /etc/mongo_ssl');
}

async function fix_azure_swap() {
    if (process.env.PLATFORM !== 'azure') return;
    // turn off swap
    await exec('/sbin/swapoff -a');
    // remove swap partition from fstab
    await fs_utils.file_delete('/swapfile');
    // remove swap partition in fstab
    await exec(`sed -i 's:/swapfile.*::' /etc/fstab`);

    // configure swap using azure's waagent
    await exec(`sed -i 's:ResourceDisk.EnableSwap=n:ResourceDisk.EnableSwap=y:' /etc/waagent.conf`);
    await exec(`sed -i 's:ResourceDisk.SwapSizeMB=0:ResourceDisk.SwapSizeMB=${SWAP_SIZE_MB}:' /etc/waagent.conf`);
    // restart waagent
    await exec(`service waagent restart`);

}

async function fix_supervisor_alias() {
    const SUPERVISOR_ALIAS = `

supervisorctl() {
/bin/supervisorctl $@
if [ $1 == "status" ]; then
    echo ""
    if [ ! -f /tmp/mongo_wrapper_backoff ]; then
        echo "There is no mongo backoff in effect"
    else
        echo "There is a mongo backoff in effect for $(cat /tmp/mongo_wrapper_backoff) seconds"
    fi
    fi
}

`;

    const supervisor_func = await promise_utils.exec(`grep supervisorctl\\(\\) ~/.bashrc | wc -l`, {
        ignore_rc: false,
        return_stdout: true,
        trim_stdout: true
    });

    if (supervisor_func === '0') {
        await fs.appendFileAsync('/root/.bashrc', SUPERVISOR_ALIAS);
    }
}

async function platform_upgrade_2_8_0() {
    if (process.env.PLATFORM === 'docker') return;
    dbg.log0('UPGRADE: running platform_upgrade_2_8_0');
    // exclude cleaning of supervisor and upgrade files
    await fs.appendFileAsync('/usr/lib/tmpfiles.d/tmp.conf', 'x /tmp/supervisor*\n');
    await fs.appendFileAsync('/usr/lib/tmpfiles.d/tmp.conf', 'x /tmp/test\n');
    await exec('systemctl restart systemd-tmpfiles-clean.service');
}

async function platform_upgrade_2_7_0() {
    dbg.log0('UPGRADE: running platform_upgrade_2_7_0');
    //verify abrt package is removed
    await exec('yum remove abrt -y');
}

// platform upgrade for version 2.4.0
// * ensure swap is configured correctly in /etc/fstab
async function platform_upgrade_2_4_0() {
    dbg.log0('UPGRADE: running platform_upgrade_2_4_0');
    await ensure_swap();
}

async function platform_upgrade_common(params) {
    await copy_first_install();
}

async function copy_first_install() {
    if (process.env.PLATFORM === 'docker') return;
    dbg.log0('UPGRADE: copying first_install_diaglog.sh and setting permissions');
    await exec(`cp -f ${CORE_DIR}/src/deploy/NVA_build/first_install_diaglog.sh /etc/profile.d/`);
    await exec(`chown root:root /etc/profile.d/first_install_diaglog.sh`);
    await exec(`chmod 4755 /etc/profile.d/first_install_diaglog.sh`);
}


function should_upgrade_platform() {
    return os.type() === 'Linux';
}



async function exec(command, options = {}) {
    try {
        dbg.log0('UPGRADE: executing command:', command);
        const stdout = await promise_utils.exec(command, EXEC_DEFAULTS);
        return stdout;
    } catch (err) {
        dbg.error('UPGRADE: got error when executing command', command, err);
        if (!options.ignore_err) throw err;
    }
}

async function ensure_swap() {
    if (process.env.PLATFORM === 'docker') return;

    // skip swap configuration in azure
    if (process.env.PLATFORM === 'azure') return;

    const swap_conf = await fs_utils.find_line_in_file('/etc/fstab', 'swapfile');
    if (swap_conf) {
        dbg.log0('UPGRADE: swap is already configured in /etc/fstab');
        return;
    }

    try {
        const swap_summary = await exec(`swapon -s`);
        if (swap_summary) {
            dbg.log0('UPGRADE: setup_swap: Swap summary:', swap_summary);
        } else {
            dbg.log0('UPGRADE: setting up swap:');
            dbg.log0(`UPGRADE: allocate /swapfile of size ${SWAP_SIZE_MB}MB`);
            await exec(`dd if=/dev/zero bs=1M count=${SWAP_SIZE_MB} of=/swapfile`);
            await exec(`chmod 600 /swapfile`);
            dbg.log0(`UPGRADE: create and enable swap on /swapfile`);
            await exec(`mkswap /swapfile`);
            await exec(`swapon /swapfile`);
        }
        dbg.log0(`UPGRADE: configure swap in /etc/fstab`);
        await fs.appendFileAsync('/etc/fstab', '/swapfile\tswap\tswap\tsw\t0\t0\n');
    } catch (err) {
        dbg.error('UPGRADE: got error on setup_swap. swap might not be configured', err);
        throw err;
    }
}

async function set_new_node_version(ver) {
    try {
        await exec(`rm -f /usr/local/bin/node`);
        dbg.log0(`UPGRADE: pre_upgrade: Removed /usr/local/bin/node`);
        await exec(`ln -s ~/.nvm/versions/node/v${ver}/bin/node /usr/local/bin/node`);
        await exec(`. ${NVM_DIR}/nvm.sh;nvm alias default ${ver}`);
        await exec(`. ${NVM_DIR}/nvm.sh;nvm use ${ver}`);
    } catch (err) {
        dbg.error(`failed setting node version to ${ver}`, err);
        throw err;
    }
}

async function update_npm_version() {
    const REQUIRED_NPM_VERSION = '6.1.0';
    const npm_version = await promise_utils.exec(`source /root/.nvm/nvm.sh && npm --version`, {
        ignore_rc: false,
        return_stdout: true,
        trim_stdout: true
    });
    if (version_compare(npm_version, REQUIRED_NPM_VERSION) < 0) {
        dbg.log0(`UPGRADE: npm version is ${npm_version}. upgrading to ${REQUIRED_NPM_VERSION}`);
        const npm_update = await promise_utils.exec(`source /root/.nvm/nvm.sh && npm install -g npm@${REQUIRED_NPM_VERSION}`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        });
        dbg.log0('npm update returned', npm_update);
    } else {
        dbg.log0(`UPGRADE: npm version is ${npm_version}. no need to upgrade`);
    }
}

async function update_nvm_version() {
    const REQUIRED_NVM_VERSION = '0.33.11';
    const nvm_version = await promise_utils.exec(`source /root/.nvm/nvm.sh && nvm --version`, {
        ignore_rc: false,
        return_stdout: true,
        trim_stdout: true
    });
    if (version_compare(nvm_version, REQUIRED_NVM_VERSION) < 0) {
        dbg.log0(`UPGRADE: nvm version is ${nvm_version}. upgrading to ${REQUIRED_NVM_VERSION}`);
        const nvm_update = await promise_utils.exec(
            `curl -o- https://raw.githubusercontent.com/creationix/nvm/v${REQUIRED_NVM_VERSION}/install.sh | bash`, {
                ignore_rc: false,
                return_stdout: true,
                trim_stdout: true
            });
        dbg.log0('nvm update returned', nvm_update);
    } else {
        dbg.log0(`UPGRADE: nvm version is ${nvm_version}. no need to upgrade`);
    }
}

async function update_node_version() {

    let old_nodever;
    let nodever;
    try {
        nodever = (await fs.readFileAsync(`${EXTRACTION_PATH}/noobaa-core/.nvmrc`)).toString();
        old_nodever = (await fs.readFileAsync(`${CORE_DIR}/.nvmrc`)).toString();
        dbg.log0(`UPGRADE: old node version is ${old_nodever}. new node version is ${nodever}`);
        if (nodever === old_nodever) {
            dbg.log0(`UPGRADE: node version is not changed. skip node update`);
            return;
        }
    } catch (err) {
        dbg.warn('UPGRADE: failed getting node versions. abort', err);
        throw err;
    }

    await exec(`cp -f ${EXTRACTION_PATH}/noobaa-core/build/public/nvm.sh ~/.nvm/`);
    dbg.log0('UPGRADE: pre_upgrade: Copied nvm.sh');
    await exec(`chmod 777 ~/.nvm/nvm.sh`);
    dbg.log0('UPGRADE: pre_upgrade: Configured permissions to nvm.sh');

    dbg.log0('UPGRADE: pre_upgrade: Nodever', nodever);
    await fs_utils.create_fresh_path(`/tmp/v${nodever}`);
    dbg.log0(`UPGRADE: pre_upgrade: Created dir /tmp/v${nodever}`);
    await exec(`cp ${EXTRACTION_PATH}/noobaa-core/build/public/node-v${nodever}-linux-x64.tar.xz /tmp/`);
    dbg.log0(`UPGRADE: pre_upgrade: Copied node package`);
    await exec(`tar -xJf /tmp/node-v${nodever}-linux-x64.tar.xz -C /tmp/v${nodever} --strip-components 1`);
    dbg.log0(`UPGRADE: pre_upgrade: Extracted node package`);
    await exec(`mkdir -p ~/.nvm/versions/node/v${nodever}/`);
    dbg.log0(`UPGRADE: pre_upgrade: Created node dir`);
    await exec(`cp -r /tmp/v${nodever}/* ~/.nvm/versions/node/v${nodever}/`);
    dbg.log0(`UPGRADE: pre_upgrade: copied node dir from /tmp to /.nvm`);

    // TODO: maybe backup the old node version in backup script
    try {
        await set_new_node_version(nodever);
    } catch (err) {
        dbg.error('failed when trying to set new node version. try to revert to version', old_nodever);
        await set_new_node_version(old_nodever);
        throw err;
    }
    dbg.log0('UPGRADE: pre_upgrade: Succeess');
}

async function platform_upgrade_init() {
    if (!should_upgrade_platform()) return;

    await update_npm_version();
    await update_nvm_version();
    await update_node_version();
}

async function backup_old_version() {
    if (!should_upgrade_platform()) return;

    dbg.log0('UPGRADE: backing up old version platform files');
    // init to default backup script for old versions that did not implement
    let backup_script = path.join(NEW_VERSION_DIR, 'src/upgrade/default_upgrade_backup.sh');
    if (await fs_utils.file_exists(BACKUP_SCRIPT)) {
        backup_script = BACKUP_SCRIPT;
    }
    // copy backup script from current location to a new stable location
    await fs_utils.file_copy(backup_script, BACKUP_SCRIPT_NEW_PATH);
    await exec(`${backup_script}`);
    dbg.log0('UPGRADE: old version backed up successfully');
}

async function restore_old_version() {
    if (!should_upgrade_platform()) return;

    dbg.log0('UPGRADE: restoring back to old version');
    await exec(`${BACKUP_SCRIPT_NEW_PATH} restore`);
}

async function copy_new_code() {
    if (!should_upgrade_platform()) return;
    dbg.log0(`UPGRADE: deleting old code from ${CORE_DIR}`);
    await fs_utils.folder_delete(CORE_DIR);
    dbg.log0(`UPGRADE: copying ${NEW_VERSION_DIR} to ${CORE_DIR}`);
    await fs_utils.full_dir_copy(NEW_VERSION_DIR, CORE_DIR);
}

// make sure that all the file which are requiered by the new version (.env, etc.) are in the new dir
async function prepare_new_dir() {
    await _build_dotenv();
    await _create_packages_md5();
}

// build .env file in new version by taking all required env vars from old version
async function _build_dotenv() {
    dbg.log0('UPGRADE: generating dotenv file in the new version directory');
    const old_env = dotenv.parse(await fs.readFileAsync(`${CORE_DIR}/.env`));
    const new_env = Object.assign(
        dotenv.parse(await fs.readFileAsync(`${NEW_VERSION_DIR}/src/deploy/NVA_build/env.orig`)),
        _.pick(old_env, DOTENV_VARS_FROM_OLD_VER),
    );

    dbg.log0('UPGRADE: genertaing .env file for new version:', new_env);

    await fs.writeFileAsync(`${NEW_VERSION_DIR}/.env`, dotenv.stringify(new_env));
}

async function _create_packages_md5() {
    const linux_md5_string = await fs_utils.get_md5_of_file(path.join(NEW_VERSION_DIR, 'build/public/noobaa-setup-' + pkg.version));
    await fs.writeFileAsync(path.join(NEW_VERSION_DIR, 'build/public/noobaa-setup-' + pkg.version + '.md5'), linux_md5_string);
    const win_md5_string = await fs_utils.get_md5_of_file(path.join(NEW_VERSION_DIR, 'build/public/noobaa-setup-' + pkg.version + '.exe'));
    await fs.writeFileAsync(path.join(NEW_VERSION_DIR, 'build/public/noobaa-setup-' + pkg.version + '.exe.md5'), win_md5_string);
    dbg.log0(`UPGRADE: creating a hash file for both linux/windows upgrade packs: ${linux_md5_string}/${win_md5_string}`);
}


// TODO: make sure that update_services is synchronized between all cluster members 
// (currently all members are upgraded serially, so we're good)
async function update_services(old_version) {
    dbg.log0('UPGRADE: updating services in noobaa_supervisor.conf');
    // perform specific platform upgrades according to old version
    const [major_ver, minor_ver] = parse_ver(old_version.split('-')[0]);
    if (major_ver <= 2) {
        if (minor_ver < 10) await update_services_2_10_0();
    }

}


async function update_services_2_10_0() {
    dbg.log0('UPGRADE: upgrading from version older than 2.10.0');
    dbg.log0('UPGRADE: change mongo kill signal from KILL to INT');
    // change_mongo_kill_signal will also restart mongo_wrapper so it will run mongod by mongod user
    await change_mongo_kill_signal_and_update_mongod_user();
}

// attempt to send kill -2 to currently running mongod, so it can do a clean shutdown
async function clean_shutdown_old_mongo() {
    try {
        const mongo_pid = Number.parseInt(await exec('pgrep mongod'), 10);
        if (mongo_pid) {
            // send SIGINT to mongod
            dbg.log0(`UPGRADE: mongod PID is ${mongo_pid}. sending SIGINT for clean shutdown`);
            process.kill(mongo_pid, 'SIGINT');
            dbg.log0(`UPGRADE: sent SIGINT to ${mongo_pid}. wait for mongod to shutdown`);

            // wait for mongo to shutdown
            let mongo_running = true;
            const timeout_seconds = 5 * 60;
            let secs = 0;
            const delay_secs = 2;
            while (mongo_running) {
                await P.delay(delay_secs * 1000);
                try {
                    // send signal 0 to test if pid is still alive
                    process.kill(mongo_pid, 0);
                    // process is still alive:
                    secs += delay_secs;
                    dbg.warn(`UPGRADE: mongod process[${mongo_pid}] is still alive. waiting for shutdown..`);
                    if (secs >= timeout_seconds) {
                        dbg.warn(`UPGRADE: mongod process[${mongo_pid}] did not shutdown in ${timeout_seconds}`,
                            ` seconds!! force killing mongod and continue with upgrade..`);
                        process.kill(mongo_pid, 'SIGKILL');
                        mongo_running = false;
                    }
                } catch (error) {
                    dbg.log0(`UPGRADE: mongod[${mongo_pid}] was shutdown successfully. continue with upgrade..`);
                    mongo_running = false;
                }
            }
        }
        // stop mongo_wrapper program
        await supervisor.stop(['mongo_wrapper']);
    } catch (err) {
        dbg.warn('failed to send SIGINT to mongod', err);
    }
}

function disconnect_mongo_client() {
    dbg.warn('UPGRADE: disconnecting mongo_client..');
    mongo_client.instance().disconnect();
}

function connect_mongo_client() {
    dbg.warn('UPGRADE: connecting mongo_client..');
    mongo_client.instance().connect();
}

async function change_mongo_kill_signal_and_update_mongod_user() {
    const mongo_wrapper_prog = await supervisor.get_program('mongo_wrapper');
    // before touching mongo, first disconnect mongo_client
    disconnect_mongo_client();
    dbg.log0(`UPGRADE: changing mongo_wrapper stop signal in noobaa_supervisor.conf from ${mongo_wrapper_prog.stopsignal} to INT`);
    mongo_wrapper_prog.stopsignal = 'INT';
    // stopwaitsecs is the time supervisord waits for the supervised program to end before using SIGKILL
    dbg.log0(`UPGRADE: adding to mongo_wrapper stopwaitsecs=30`);
    mongo_wrapper_prog.stopwaitsecs = 30;

    try {
        await supervisor.update_program(mongo_wrapper_prog);
        await clean_shutdown_old_mongo();

        // after mongod is stopped fix ownership and 
        await fix_mongod_user();

        await supervisor.apply_changes();
        await supervisor.start(['mongo_wrapper']);
    } catch (err) {
        dbg.error('failed updating mongo program in supervisor conf', err);
    }

    try {
        connect_mongo_client();
        dbg.log0('waiting for mongo..');
        await mongo_client.instance().wait_for_all_members(WAIT_FOR_MONGO_TIMEOUT);
        dbg.log0('UPGRADE: all mongodb members are up');
    } catch (err) {
        // if mongo is not up yet something went wrong
        // exit upgrade manager and let it restart from current stage. can help if the problem is in mongo_client\mongo-driver
        dbg.error('UPGRADE: failed waiting for mongo to start. exit and restart upgrade manager', err);
        process.exit(1);
    }
}


async function upgrade_mongodb_version(params) {
    if (params.should_upgrade_mongodb) {
        try {
            // before touching mongo, first disconnect mongo_client
            disconnect_mongo_client();
            if (params.is_cluster && await mongo_client.instance().is_master(params.ip)) {
                // if this is the master, step down the and continue
                try {
                    await mongo_client.instance().step_down_master({ force: true, duration: 120 });
                } catch (err) {
                    dbg.error(`UPGRADE: failed to step down master. stopping mongo and continuing with upgrade`);
                }
            }
            mongo_client.instance().ignore_connect_timeout();
            dbg.log0('UPGRADE: stopping mongo_wrapper service before upgrading mongodb');
            await supervisor.stop(['mongo_wrapper']);
            dbg.log0('UPGRADE: mongo_wrapper stopped');
            const mongo_repo_path = `${NEW_VERSION_DIR}/src/deploy/NVA_build/mongo.repo`;
            dbg.log0(`UPGRADE: copying ${mongo_repo_path} to /etc/yum.repos.d/mongodb-org-3.6.repo`);
            fs_utils.file_copy(mongo_repo_path, '/etc/yum.repos.d/mongodb-org-3.6.repo');
            fs_utils.file_delete('/etc/yum.repos.d/mongodb-org-3.4.repo');
            const mongo_packages_to_install = [
                `mongodb-org-${params.required_mongodb_version}`,
                `mongodb-org-server-${params.required_mongodb_version}`,
                `mongodb-org-shell-${params.required_mongodb_version}`,
                `mongodb-org-mongos-${params.required_mongodb_version}`,
                `mongodb-org-tools-${params.required_mongodb_version}`
            ];
            const yum_clean_res = await promise_utils.exec(`yum clean all`, {
                ignore_rc: true,
                return_stdout: true,
                trim_stdout: true
            });
            dbg.log0('UPGRADE: yum clean all returned:', yum_clean_res);
            const yum_res = await promise_utils.exec(`yum update -y ${mongo_packages_to_install.join(' ')} --disableexcludes=all`, {
                ignore_rc: false,
                return_stdout: true,
                trim_stdout: true
            });
            dbg.log0('UPGRADE: yum install returned:', yum_res);

            // make sure all files are owned by mongod user
            await fix_mongod_user();

            dbg.log0('UPGRADE: restarting mongo_wrapper');
            const mongo_wrapper_prog = await supervisor.get_program('mongo_wrapper');
            // in 3.6 the default bind_ip is 127.0.01 (mongo cannot get connections from outside). change to bind all interfaces
            mongo_wrapper_prog.command += ' --bind_ip_all';
            await supervisor.update_program(mongo_wrapper_prog);
            await supervisor.apply_changes();
            await supervisor.start(['mongo_wrapper']);


            try {
                connect_mongo_client();
                dbg.log0('waiting for mongo..');
                await mongo_client.instance().wait_for_all_members(WAIT_FOR_MONGO_TIMEOUT);
                dbg.log0('UPGRADE: all mongodb members are up');
            } catch (err) {
                dbg.error('UPGRADE: failed waiting for mongo to start.', err);
                throw err;
            }

        } catch (err) {
            dbg.error('UPGRADE: failed upgrading mongodb version', err);
            throw err;
        }

    }
}

async function get_mongo_shell_command(is_cluster) {
    let mongo_shell = '/usr/bin/mongo nbcore';
    if (is_cluster) {
        dbg.log0('UPGRADE: set_mongo_cluster_mode: Called');
        const rs_servers = await promise_utils.exec(`grep MONGO_RS_URL /root/node_modules/noobaa-core/.env | cut -d'@' -f 2 | cut -d'/' -f 1`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        });
        dbg.log0(`UPGRADE: set_mongo_cluster_mode: MONGO_SHELL`, rs_servers);
        mongo_shell = `/usr/bin/mongors --host mongodb://${rs_servers}/nbcore?replicaSet=shard1`;
    }
    dbg.log0(`UPGRADE: using this mongo shell command: ${mongo_shell}`);
    return mongo_shell;

}

async function upgrade_mongodb_schemas(params) {
    const secret = await os_utils.read_server_secret();
    const MONGO_SHELL = await get_mongo_shell_command(params.is_cluster);
    const ver = pkg.version;

    let is_pure_version = false;
    try {
        // eslint-disable-next-line global-require
        const old_config = require('/backup/noobaa-core/config');
        is_pure_version = old_config.EXPERIMENTAL_DISABLE_S3_COMPATIBLE_DELEGATION === true ||
            old_config.EXPERIMENTAL_DISABLE_S3_COMPATIBLE_METADATA === true;
    } catch (err) {
        if (err.code !== 'MODULE_NOT_FOUND') throw err;
        console.log('did not find old config /backup/noobaa-core/config');
    }
    async function set_mongo_debug_level(level) {
        await promise_utils.exec(`${MONGO_SHELL} --quiet --eval 'db.setLogLevel(${level})'`, {
            ignore_rc: false,
            return_stdout: true,
            trim_stdout: true
        });
    }

    dbg.log0(`UPGRADE: upgrading mongodb schemas. secret=${secret} ver=${ver} params=`, params);
    let UPGRADE_SCRIPTS = [];
    if (params.should_upgrade_schemas) {
        UPGRADE_SCRIPTS = [
            { file: 'mongo_upgrade_2_1_3.js', version: [2, 1, 3] },
            { file: 'mongo_upgrade_2_3_0.js', version: [2, 3, 0] },
            { file: 'mongo_upgrade_2_3_1.js', version: [2, 3, 1] },
            { file: 'mongo_upgrade_2_6_0.js', version: [2, 6, 0] },
            { file: 'mongo_upgrade_2_7_3.js', version: [2, 7, 3] },
            { file: 'mongo_upgrade_2_8_0.js', version: [2, 8, 0] },
            { file: 'mongo_upgrade_2_8_2.js', version: [2, 8, 2] },
            { file: 'mongo_upgrade_2_9_0.js', version: [2, 9, 0] },
            { file: 'mongo_upgrade_2_10_0.js', version: [2, 10, 0] },
            { file: 'mongo_upgrade_mark_completed.js' }
        ];
    } else {
        UPGRADE_SCRIPTS = [
            { file: 'mongo_upgrade_wait_for_master.js' }
        ];
    }

    // set mongo debug level
    await set_mongo_debug_level(5);
    const [old_major, old_minor, old_patch] = parse_ver(params.old_version.split('-')[0]);
    // calculate single int value to represent version
    const old_ver_value = (old_major * 10000) + (old_minor * 100) + old_patch;
    for (const script of UPGRADE_SCRIPTS) {
        const [script_major, script_minor, script_patch] = script.version || [99, 99, 99];
        const script_ver_value = (script_major * 10000) + (script_minor * 100) + script_patch;
        // only run upgrade script if we upgrade from a version older than the upgrade script version
        if (old_ver_value < script_ver_value) {
            dbg.log0(`UPGRADE: Running Mongo Upgrade Script ${script.file}`);
            try {
                await promise_utils.exec(`${MONGO_SHELL} --eval "var param_secret='${secret}', version='${ver}', is_pure_version=${is_pure_version}" ${CORE_DIR}/src/deploy/mongo_upgrade/${script.file}`, {
                    ignore_rc: false,
                    return_stdout: true,
                    trim_stdout: true
                });

            } catch (err) {
                dbg.error(`Failed Mongo Upgrade Script ${script.file}`, err);
                await set_mongo_debug_level(0);
                throw err;
            }
        } else {
            dbg.log0(`UPGRADE: Skipping old Mongo Upgrade Script ${script.file}`);
        }
    }

    if (!params.is_cluster ||
        (params.is_cluster && params.mongodb_upgraded && await mongo_client.instance().is_master(params.ip))) {
        // if mongodb was upgraded, once all members are up and schemas are upgraded, enable backwards-incompatible 3.6 features
        dbg.log0(`this is master (${params.ip}). setting feature version to ${params.feature_version} after mongodb upgrade`);
        await mongo_client.instance().set_feature_version({ version: params.feature_version });
    }

    await set_mongo_debug_level(0);

    dbg.log0('UPGRADE: upgrade_mongodb_schemas: Success');
}

async function after_upgrade_cleanup() {
    dbg.log0(`UPGRADE: deleting ${EXTRACTION_PATH}`);
    await fs_utils.folder_delete(`${EXTRACTION_PATH}`);
    await exec(`rm -f /tmp/*.tar.gz`, { ignore_err: true });
    await exec(`rm -rf /tmp/v*`, { ignore_err: true });
    await exec(`rm -rf /backup/build/public/*diagnostics*`, { ignore_err: true });
    await exec(`rm -f ${UPGRADE_INFO_FILE_PATH}`, { ignore_err: true });
}

function parse_ver(ver) {
    return ver.split('.').map(i => Number.parseInt(i, 10));
}


// compares 2 versions. returns positive if ver1 is larger, negative if ver2, 0 if equal
function version_compare(ver1, ver2) {
    const ver1_arr = parse_ver(ver1);
    const ver2_arr = parse_ver(ver2);
    const max_length = Math.max(ver1_arr.length, ver2_arr.length);
    for (let i = 0; i < max_length; ++i) {
        const comp1 = ver1_arr[i] || 0;
        const comp2 = ver2_arr[i] || 0;
        const diff = comp1 - comp2;
        // if version component is not the same, return the 
        if (diff) return diff;
    }
    return 0;
}


async function get_upgrade_info() {
    try {
        let upgrade_info = JSON.parse(await fs.readFileAsync(UPGRADE_INFO_FILE_PATH));
        dbg.log0('UPGRADE: found existing upgrade info', upgrade_info);
        return upgrade_info;
    } catch (err) {
        if (err.code !== 'ENOENT') {
            dbg.error(`got unexpected error when reading upgrade info file ${UPGRADE_INFO_FILE_PATH}`, err);
        }
        dbg.log0('there is no previous upgrade info');
    }
}

async function set_upgrade_info(new_upgrade_info) {
    try {
        const upgrade_data = JSON.stringify(new_upgrade_info);
        await fs.writeFileAsync(UPGRADE_INFO_FILE_PATH, upgrade_data);
        dbg.log0('UPGRADE: upgrade info updated successfuly with upgrade_info =', new_upgrade_info);
    } catch (err) {
        dbg.error(`got unexpected error when writing upgrade info file ${UPGRADE_INFO_FILE_PATH}`, err);
    }
}





exports.run_platform_upgrade_steps = run_platform_upgrade_steps;
exports.platform_upgrade_init = platform_upgrade_init;
exports.backup_old_version = backup_old_version;
exports.restore_old_version = restore_old_version;
exports.copy_new_code = copy_new_code;
exports.prepare_new_dir = prepare_new_dir;
exports.update_services = update_services;
exports.upgrade_mongodb_version = upgrade_mongodb_version;
exports.upgrade_mongodb_schemas = upgrade_mongodb_schemas;
exports.after_upgrade_cleanup = after_upgrade_cleanup;
exports.stop_services = stop_services;
exports.start_services = start_services;
exports.version_compare = version_compare;
exports.get_upgrade_info = get_upgrade_info;
exports.set_upgrade_info = set_upgrade_info;
