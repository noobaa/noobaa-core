/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const api = require('../../api');
const request = require('request');
const ssh = require('./ssh_functions');
const P = require('../../util/promise');
const promise_utils = require('../../util/promise_utils');

const activation_code = "pe^*pT%*&!&kmJ8nj@jJ6h3=Ry?EVns6MxTkz+JBwkmk_6e" +
    "k&Wy%*=&+f$KE-uB5B&7m$2=YXX9tf&$%xAWn$td+prnbpKb7MCFfdx6S?txE=9bB+SVtKXQay" +
    "zLVbAhqRWHW-JZ=_NCAE!7BVU_t5pe#deWy*d37q6m?KU?VQm?@TqE+Srs9TSGjfv94=32e_a#" +
    "3H5Q7FBgMZd=YSh^J=!hmxeXtFZE$6bG+^r!tQh-Hy2LEk$+V&33e3Z_mDUVd";

//will enable noobaa user login via ssh
function enable_nooba_login(server_ip, secret) {
    let client_ssh;
    return ssh.ssh_connect({
            host: server_ip,
            //  port: 22,
            username: 'noobaaroot',
            password: secret,
            keepaliveInterval: 5000,
        })
        //enabling noobaa user login
        .then(cssh => {
            client_ssh = cssh;
            return ssh.ssh_exec(client_ssh, `
        if sudo grep -q 'Match User noobaa' /etc/ssh/sshd_config
        then
            sudo sed -i 's/Match User noobaa//g' /etc/ssh/sshd_config
            sudo sed -i 's/PasswordAuthentication no//g' /etc/ssh/sshd_config
            sudo service sshd restart
            #sudo systemctl restart sshd.service
        fi
        `);
        })
        .then(() => ssh.ssh_stick(client_ssh));
}

//will set first install mark via ssh
function set_first_install_mark(server_ip, secret) {
    let client_ssh;
    return ssh.ssh_connect({
            host: server_ip,
            //  port: 22,
            username: 'noobaaroot',
            password: secret,
            keepaliveInterval: 5000,
        })
        //enabling noobaa user login
        .then(cssh => {
            client_ssh = cssh;
            return ssh.ssh_exec(client_ssh, `
        if [ ! -f /etc/first_install.mrk ]
        then
            date | sudo tee -a /etc/first_install.mrk &> /dev/null
        fi
        `);
        });
}

//will run clean_ova and reboot the server
function clean_ova(server_ip, secret) {
    let client_ssh;
    return ssh.ssh_connect({
            host: server_ip,
            //  port: 22,
            username: 'noobaaroot',
            password: secret,
            keepaliveInterval: 5000,
        })
        .then(cssh => {
            client_ssh = cssh;
            return ssh.ssh_exec(client_ssh, 'sudo /root/node_modules/noobaa-core/src/deploy/NVA_build/clean_ova.sh -a -d');
        })
        .then(() => ssh.ssh_exec(client_ssh, 'sudo reboot -fn', true))
        .then(() => client_ssh.end());
}

//will wait untill the server reconnects via rpc
function wait_server_recoonect(server_ip) {
    console.log(`Connecting to the server via rpc`);
    const rpc = api.new_rpc(`wss://${server_ip}:8443`);
    const client = rpc.new_client({});
    let retries = 10;
    let final_result;
    return promise_utils.pwhile(
        function() {
            return retries > 0;
        },
        function() {
            return P.resolve(client.account.accounts_status({}))
                .then(res => {
                    console.log('The server is ready:', res);
                    retries = 0;
                    final_result = res;
                })
                .catch(() => {
                    console.warn(`Waiting for read server config, will retry extra ${retries} times`);
                    return P.delay(30000);
                });
        }).then(() => final_result);
}

//will validate the activation code with the email
function validate_activation_code(server_ip) {
    console.log(`Connecting to the server via rpc`);
    const rpc = api.new_rpc(`wss://${server_ip}:8443`);
    const client = rpc.new_client({});
    console.log(`Validating the activation code`);
    return P.resolve(client.system.validate_activation({
            code: activation_code,
            email: 'demo@noobaa.com'
        }))
        .then(result => {
            let code_is = result.valid;
            if (code_is === true) {
                console.log(`The activation code is valid`);
            } else {
                throw new Error(`The activation code is not valid!!!`);
            }
        });
}

//will create a system and check that the default account status is true.
function create_system_and_check(server_ip) {
    console.log(`Connecting to the server via rpc`);
    const rpc = api.new_rpc(`wss://${server_ip}:8443`);
    const client = rpc.new_client({});
    return P.resolve(client.system.create_system({
            email: 'demo@noobaa.com',
            name: 'demo',
            password: 'DeMo1',
            activation_code: activation_code
        }))
        .then(() => P.resolve(client.account.accounts_status({})))
        .then(res => P.resolve()
            .then(() => promise_utils.pwhile(
                function() {
                    return !res.has_accounts === true;
                },
                function() {
                    console.warn(`Waiting for the default account to be in status true`);
                    return P.delay(5000);
                }))
            .timeout(1 * 60 * 1000)
            .then(() => {
                console.log(`Account's status is: ${res.has_accounts}`);
            })
            .catch(() => {
                throw new Error(`Couldn't create system`);
            }));
}

//upload upgrade package
function upload_upgrade_package(ip, package_path) {
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
        url: 'http://' + ip + ':8080/upgrade',
        formData: formData,
        rejectUnauthorized: false,
    });
}

exports.enable_nooba_login = enable_nooba_login;
exports.set_first_install_mark = set_first_install_mark;
exports.clean_ova = clean_ova;
exports.wait_server_recoonect = wait_server_recoonect;
exports.validate_activation_code = validate_activation_code;
exports.create_system_and_check = create_system_and_check;
exports.upload_upgrade_package = upload_upgrade_package;
