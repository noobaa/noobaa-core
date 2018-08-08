/* Copyright (C) 2016 NooBaa */
'use strict';

const argv = require('minimist')(process.argv, { string: ['server_secret'] });

require('../../util/dotenv').load();
const ssh = require('../utils/ssh_functions');

const {
    server_name,
    server_ip,
    server_secret
} = argv;


const ENV_VARS = [
    `AWS_ACCESS_KEY_ID=${process.env.AWS_ACCESS_KEY_ID}`,
    `AWS_SECRET_ACCESS_KEY=${process.env.AWS_SECRET_ACCESS_KEY}`,
    `AZURE_STORAGE_CONNECTION_STRING='${process.env.AZURE_STORAGE_CONNECTION_STRING}'`,
    `TEST_RUN_NAME='${process.env.TEST_RUN_NAME}'`
];

function main() {
    console.log(`running runner tests on ${server_name}, IP ${server_ip} Secret ${server_secret}`);
    let ssh_client;
    return ssh.ssh_connect({
            host: server_ip,
            username: 'noobaaroot',
            password: server_secret,
            keepaliveInterval: 5000,
        })
        .then(client => {
            ssh_client = client;
            const command = `sudo bash -c "${ENV_VARS.join(' ')} /root/node_modules/noobaa-core/src/test/framework/prepare_and_run_tests.sh"`;
            console.log(`executing command on remote server (${server_ip}): ${command}`);
            return ssh.ssh_exec(ssh_client, command);
        })
        .then(() => {
                console.log('SUCCESSFUL TESTS');
                process.exit(0);
            },
            err => {
                console.error('Remote Runner FAILED:', err.message);
                process.exit(1);
            }
        );
}



if (require.main === module) {
    main();
}
