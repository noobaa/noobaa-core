/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const ssh2 = require('ssh2');
const P = require('../../../util/promise');

//will connect the ssh session
function ssh_connect(client, options) {
    client = client || new ssh2.Client();
    return new P((resolve, reject) => client
        .once('ready', () => resolve(client))
        .once('error', reject)
        .connect(options));
}

//will disconnect the ssh session
function ssh_disconnect(client) {
    return new P((resolve, reject) => client
        .once('ready', resolve)
        .once('error', reject)
        .on('end', resolve));
}

//will execute command via ssh
function ssh_exec(client, command, reject_on_exit_code) {
    console.log('Execute ssh command ' + command);
    return P.fromCallback(callback => client.exec(command, { pty: true }, callback))
        .then(stream => new P((resolve, reject) => {
            stream.on('data', data => console.log(data.toString()))
                .once('error', reject)
                .once('close', code => {
                    if (reject_on_exit_code && (code !== 0)) {
                        console.log(`ssh_exec: Failed. ${command} exited with code ${code}`);
                        reject(new Error(`${command} exited with code ${code}`));
                    } else {
                        console.log(`ssh_exec: Done. command ${command} successful`);
                        resolve();
                    }
                });
        }))
        .catch(err => {
            console.log(err);
            throw err;
        });
}

//will do ssh stick which will relese the need to enter password for each ssh session
function ssh_stick(client) {
    const command = `
    sudo mkdir -p /home/noobaa/.ssh
    sudo su -c "echo '${fs.readFileSync(process.env.HOME + '/.ssh/id_rsa.pub', 'utf8')}' >> /home/noobaa/.ssh/authorized_keys"
    sudo chmod 700 /home/noobaa/.ssh
    sudo chmod 600 /home/noobaa/.ssh/authorized_keys
    sudo chown -R noobaa:noobaa /home/noobaa/.ssh
    `;
    return ssh_exec(client, command);
}

exports.ssh_connect = ssh_connect;
exports.ssh_disconnect = ssh_disconnect;
exports.ssh_exec = ssh_exec;
exports.ssh_stick = ssh_stick;
