/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const api = require('../../api');
const request = require('request');
const ssh = require('./ssh_functions');
const Report = require('../framework/report');
const srv_ops = require('../utils/basic_server_ops');
const P = require('../../util/promise');

let report = new Report();

const activation_code = "pe^*pT%*&!&kmJ8nj@jJ6h3=Ry?EVns6MxTkz+JBwkmk_6e" +
    "k&Wy%*=&+f$KE-uB5B&7m$2=YXX9tf&$%xAWn$td+prnbpKb7MCFfdx6S?txE=9bB+SVtKXQay" +
    "zLVbAhqRWHW-JZ=_NCAE!7BVU_t5pe#deWy*d37q6m?KU?VQm?@TqE+Srs9TSGjfv94=32e_a#" +
    "3H5Q7FBgMZd=YSh^J=!hmxeXtFZE$6bG+^r!tQh-Hy2LEk$+V&33e3Z_mDUVd";

//will enable noobaa user login via ssh
async function enable_nooba_login(server_ip, secret) {
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

//will set first install mark via ssh
async function set_first_install_mark(server_ip, secret) {
    const client_ssh = await ssh.ssh_connect({
        host: server_ip,
        //  port: 22,
        username: 'noobaaroot',
        password: secret,
        keepaliveInterval: 5000,
    });
    //enabling noobaa user login
    await ssh.ssh_exec(client_ssh, `
        if [ ! -f /etc/first_install.mrk ]
        then
            date | sudo tee -a /etc/first_install.mrk &> /dev/null
        fi
        `);
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

//will wait untill the server reconnects via rpc
async function wait_server_recoonect(server_ip) {
    console.log(`Connecting to the server via rpc`);
    const rpc = api.new_rpc(`wss://${server_ip}:8443`);
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

//will validate the activation code with the email
async function validate_activation_code(server_ip) {
    console.log(`Connecting to the server via rpc`);
    const rpc = api.new_rpc(`wss://${server_ip}:8443`);
    const client = rpc.new_client({});
    console.log(`Validating the activation code`);
    const validate = await client.system.validate_activation({
        code: activation_code,
        email: 'demo@noobaa.com'
    });
    if (validate.valid === true) {
        console.log(`The activation code is valid`);
    } else {
        throw new Error('The activation code is not valid!!! validate is', validate);
    }
}

//will create a system and check that the default account status is true.
async function create_system_and_check(server_ip) {
    console.log(`Connecting to the server via rpc`);
    const rpc = api.new_rpc(`wss://${server_ip}:8443`);
    const client = rpc.new_client({});
    try {
        await client.system.create_system({
            email: 'demo@noobaa.com',
            name: 'demo',
            password: 'DeMo1',
            activation_code
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

async function clean_ova_and_create_system(server_ip, secret) {
    try {
        await clean_ova(server_ip, secret);
        await wait_server_recoonect(server_ip);
        await validate_activation_code(server_ip);
        await create_system_and_check(server_ip);
    } catch (e) {
        throw new Error(e);
    }
}

//upload upgrade package
function upload_upgrade_package(server_ip, package_path) {
    let formData = {
        upgrade_file: {
            value: fs.createReadStream(package_path),
            options: {
                filename: package_path,
                contentType: 'application/x-gzip'
            }
        }
    };
    return P.ninvoke(request, 'post', {
        url: 'http://' + server_ip + ':8080/upgrade',
        formData: formData,
        rejectUnauthorized: false,
    });
}

async function upgrade_server(server_ip, upgrade) {
    console.log('Upgrading server to: ' + upgrade);
    try {
        if (upgrade) {
            await srv_ops.upload_and_upgrade(server_ip, upgrade);
        }
        await report.success('upgrade');
    } catch (err) {
        await report.fail('upgrade');
        console.error('Upgrade Failed with error: ', err);
        throw err;
    }
}

exports.enable_nooba_login = enable_nooba_login;
exports.set_first_install_mark = set_first_install_mark;
exports.clean_ova = clean_ova;
exports.wait_server_recoonect = wait_server_recoonect;
exports.validate_activation_code = validate_activation_code;
exports.create_system_and_check = create_system_and_check;
exports.clean_ova_and_create_system = clean_ova_and_create_system;
exports.upload_upgrade_package = upload_upgrade_package;
exports.upgrade_server = upgrade_server;
