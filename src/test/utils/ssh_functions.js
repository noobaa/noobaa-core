/* Copyright (C) 2016 NooBaa */
'use strict';

const ssh2 = require('ssh2');
const P = require('../../util/promise');

//will connect the ssh session
function ssh_connect(options) {
    let client = new ssh2.Client();
    return new P((resolve, reject) => client
        .once('ready', () => resolve(client))
        .once('error', reject)
        .connect(options));
}

//will execute command via ssh
function ssh_exec(client, command, ignore_rc = false) {
    console.log('Execute ssh command ' + command);
    return P.fromCallback(callback => client.exec(command, { pty: true }, callback))
        .then(stream => new P((resolve, reject) => {
            stream.on('data', data => console.log(data.toString()))
                .once('error', reject)
                .once('close', code => {
                    if (code === 0) {
                        console.log(`ssh_exec: Done. command ${command} successful`);
                        resolve();
                    } else if (ignore_rc) {
                        console.log(`ssh_exec: command ${command}, ignoring return code: ${code}`);
                        resolve();
                    } else {
                        console.log(`ssh_exec: Failed. ${command} exited with code ${code}`);
                        reject(new Error(`${command} exited with code ${code}`));
                    }
                });
        }));
}

exports.ssh_connect = ssh_connect;
exports.ssh_exec = ssh_exec;
