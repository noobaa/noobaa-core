/* Copyright (C) 2016 NooBaa */
'use strict';

var P = require('../../util/promise');

function ssh_connect(client, options) {
    return new P((resolve, reject) => client
        .once('ready', resolve)
        .once('error', reject)
        .connect(options));
}

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
function ssh_disconnect(client) {
    return new P((resolve, reject) => client
        .once('ready', resolve)
        .once('error', reject)
        .on('end', resolve));
}

exports.ssh_exec = ssh_exec;
exports.ssh_connect = ssh_connect;
exports.ssh_disconnect = ssh_disconnect;
