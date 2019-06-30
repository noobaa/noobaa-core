/* Copyright (C) 2016 NooBaa */
'use strict';

let _ = require('lodash');

const api = require('../../api');
const ssh = require('./ssh_functions');
const Report = require('../framework/report');
const P = require('../../util/promise');

let report = new Report();

//Enable reporter and set parameters
function init_reporter(report_params) {
    const suite_name = report_params.suite_name || 'UNKNW_server_func';
    report.init_reporter({
        suite: suite_name,
        conf: {},
        mongo_report: true,
        cases: report_params.cases,
        prefix: report_params.cases_prefix
    });
}

//will enable noobaa user login via ssh
async function enable_noobaa_login(server_ip, secret) {
    const client_ssh = await ssh.ssh_connect({
        host: server_ip,
        //  port: 22,
        username: 'noobaaroot',
        password: secret,
        keepaliveInterval: 5000,
    });
    //enabling noobaa user login
    await ssh.ssh_exec(client_ssh, `
        if sudo grep -q 'Match User noobaa' /etc/ssh/sshd_config
        then
            sudo sed -i 's/Match User noobaa//g' /etc/ssh/sshd_config
            sudo sed -i 's/PasswordAuthentication no//g' /etc/ssh/sshd_config
            sudo service sshd restart
            #sudo systemctl restart sshd.service
        fi
        `);
    await ssh.ssh_stick(client_ssh);
}

//will run clean_ova and reboot the server
async function clean_ova(server_ip, secret) {
    try {
        const client_ssh = await ssh.ssh_connect({
            host: server_ip,
            //  port: 22,
            username: 'noobaaroot',
            password: secret,
            keepaliveInterval: 5000,
        });
        await ssh.ssh_exec(client_ssh, 'sudo /root/node_modules/noobaa-core/src/deploy/NVA_build/clean_ova.sh -a -d');
        await ssh.ssh_exec(client_ssh, 'sudo reboot -fn', true);
        await client_ssh.end();
        await report.success('clean_ova');
    } catch (e) {
        await report.fail('clean_ova');
        throw new Error(`clean_ova failed: ${e}`);
    }
}

async function remove_swap_on_azure(server_ip, secret) {
    try {
        const client_ssh = await ssh.ssh_connect({
            host: server_ip,
            //  port: 22,
            username: 'noobaaroot',
            password: secret,
            keepaliveInterval: 5000,
        });
        await ssh.ssh_exec(client_ssh, `sudo sed -i 's:ResourceDisk.EnableSwap=y:ResourceDisk.EnableSwap=n:' /etc/waagent.conf`, true);
        await client_ssh.end();
    } catch (e) {
        throw new Error(`remove_swap_on_azure failed: ${e}`);
    }
}

//will wait until the server reconnects via rpc
async function wait_server_reconnect(server_ip) {
    console.log(`Connecting to the server via rpc`);
    const rpc = api.new_rpc_from_base_address(`wss://${server_ip}:8443`, 'EXTERNAL');
    const client = rpc.new_client({});
    for (let retries = 10; retries >= 0; --retries) {
        try {
            const account_stat = await client.account.accounts_status({});
            console.log('The server is ready: ', account_stat);
            return account_stat;
        } catch (e) {
            console.warn(`Waiting for read server config, will retry extra ${retries} times`);
            await P.delay(30 * 1000);
        }
    }
}

//will create a system and check that the default account status is true.
async function create_system_and_check(server_ip) {
    console.log(`Connecting to the server via rpc`);
    const rpc = api.new_rpc_from_base_address(`wss://${server_ip}:8443`, 'EXTERNAL');
    const client = rpc.new_client({});
    try {
        await client.system.create_system({
            email: 'demo@noobaa.com',
            name: 'demo',
            password: 'DeMo1'
        });
        let has_account;
        const base_time = Date.now();
        while (Date.now() - base_time < 60 * 1000) {
            try {
                const account_stat = await client.account.accounts_status({});
                has_account = account_stat.has_accounts;
                if (has_account) break;
            } catch (e) {
                console.warn(`Waiting for the default account to be in status true`);
                await P.delay(5 * 1000);
            }
        }
        if (has_account) {
            await report.success('create_system');
        } else {
            await report.fail('create_system');
            throw new Error(`Couldn't create system`);
        }
    } catch (err) {
        await report.fail('create_system');
        throw new Error(`Couldn't create system`);
    }
}


//will create a system and check that the default account status is true.
async function create_system(server_ip, port, protocol) {
    protocol = protocol || 'wss';
    const rpc = api.new_rpc_from_base_address(`${protocol}://${server_ip}:${port}`, 'EXTERNAL');
    const client = rpc.new_client({});
    try {
        await client.system.create_system({
            email: 'demo@noobaa.com',
            name: 'demo',
            password: 'DeMo1'
        });
        let has_account;
        const base_time = Date.now();
        while (Date.now() - base_time < 120 * 1000) {
            try {
                const account_stat = await client.account.accounts_status({});
                has_account = account_stat.has_accounts;
                if (has_account) break;
            } catch (e) {
                console.warn(`Waiting for the default account to be in status true`);
                await P.delay(5 * 1000);
            }
        }
        if (!has_account) {
            throw new Error(`Couldn't create system. no account`);
        }
    } catch (err) {
        throw new Error(`Couldn't create system ${err}`);
    }
}


async function clean_ova_and_create_system(server_ip, secret) {
    try {
        await clean_ova(server_ip, secret);
    } catch (e) {
        throw new Error('clean_ova::' + e);
    }
    try {
        await wait_server_reconnect(server_ip);
    } catch (e) {
        throw new Error('wait_server_reconnect::' + e);
    }
    try {
        await create_system_and_check(server_ip);
    } catch (e) {
        throw new Error('create_system_and_check::' + e);
    }
}




async function add_server_to_cluster(master_ip, slave_ip, slave_secret, slave_name) {
    const rpc = api.new_rpc_from_base_address('wss://' + master_ip + ':8443', 'EXTERNAL');
    const client = rpc.new_client({});
    const auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    };
    await client.create_auth_token(auth_params);

    // register for notification to know when add_member is finished
    let add_member_completed = new P((resolve, reject) => {
        let notified = false;
        let notification_server = {
            alert: _.noop,
            remove_host: _.noop,
            change_upgrade_status: _.noop,
            add_memeber_to_cluster: async req => {
                if (notified) return;
                notified = true;
                const { secret, result, reason } = req.rpc_params;
                if (result) {
                    console.log(`got notification on successful add_member (secret: ${secret})`);
                    resolve(secret);
                } else {
                    console.warn(`got notification on failed add_member (secret: ${secret} reason: ${reason})`);
                    reject(new Error(reason));
                }
            }
        };
        rpc.register_service(
            rpc.schema.frontend_notifications_api,
            notification_server, {}
        );
        client.redirector.register_for_alerts();
    });

    // 2 minutes timeout for add_member
    const ADD_MEMBER_TIMEOUT = 120 * 1000;
    return P.resolve()
        .then(async () => {
            // add member to master_ip
            console.log(`Adding member: [master ip: ${master_ip}] [new member ip: ${slave_ip}]`);
            await client.cluster_server.add_member_to_cluster({
                address: slave_ip,
                secret: slave_secret,
                role: 'REPLICA',
                shard: 'shard1',
                new_hostname: slave_name
            });

            const secret = await add_member_completed;
            if (secret !== slave_secret) {
                console.error(`expected to get secret=${slave_secret} but got ${secret}`);
                throw new Error('got unexpected secret from completed add_member');
            }
            console.log(`successfully added server ${slave_ip} to cluster, with master ${master_ip}`);
        })
        .timeout(ADD_MEMBER_TIMEOUT, `add_member_to_cluster timed out after ${ADD_MEMBER_TIMEOUT / 1000} seconds`)
        .finally(async () => {
            await client.redirector.unregister_from_alerts();
            rpc.disconnect_all();
        });
}

async function clean_pre_upgrade_leftovers(params) {
    const ssh_client = await ssh.ssh_connect({
        host: params.ip,
        username: 'noobaaroot',
        password: params.secret,
        keepaliveInterval: 5000,
    });
    await ssh.ssh_exec(ssh_client, `sudo bash -c "rm -rf /tmp/test/ /tmp/new_version.tar.gz /tmp/nb_upgrade_*"`);
}


async function create_pool(server_ip, port, pool_name) {
    const rpc = api.new_rpc_from_base_address(`wss://${server_ip}:${port}`, 'EXTERNAL');
    const client = rpc.new_client({});
    const auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    };
    await client.create_auth_token(auth_params);
    await client.pool.create_hosts_pool({ name: pool_name, hosts: [] });
}

async function get_num_optimal_agents(server_ip, port) {
    const rpc = api.new_rpc_from_base_address(`wss://${server_ip}:${port}`, 'EXTERNAL');
    const client = rpc.new_client({});
    const auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    };
    await client.create_auth_token(auth_params);
    return (await client.host.list_hosts({
        query: {
            mode: ['OPTIMAL']
        }
    })).hosts.length;
}

exports.enable_noobaa_login = enable_noobaa_login;
exports.clean_ova = clean_ova;
exports.wait_server_reconnect = wait_server_reconnect;
exports.create_system_and_check = create_system_and_check;
exports.clean_ova_and_create_system = clean_ova_and_create_system;
exports.init_reporter = init_reporter;
exports.add_server_to_cluster = add_server_to_cluster;
exports.remove_swap_on_azure = remove_swap_on_azure;
exports.clean_pre_upgrade_leftovers = clean_pre_upgrade_leftovers;
exports.create_system = create_system;
exports.create_pool = create_pool;
exports.get_num_optimal_agents = get_num_optimal_agents;
