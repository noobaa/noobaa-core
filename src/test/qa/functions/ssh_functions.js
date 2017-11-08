/* Copyright (C) 2016 NooBaa */
'use strict';

const P = require('../../../util/promise');
const fs = require('fs');

//will connect the ssh session
function ssh_connect(client, options) {
    return new P((resolve, reject) => client
        .once('ready', resolve)
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
function ssh_exec(client, command) {
    console.log('Execute ssh command ' + command);
    return P.fromCallback(callback => client.exec(command, { pty: true }, callback))
        .then(stream => new P((resolve, reject) => {
            stream.on('data', data => console.log('ssh_exec: output', data.toString()))
                .on('error', reject)
                .on('end', () => {
                    console.log('ssh_exec: Done');
                    resolve();
                });
        }));
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