/* Copyright (C) 2016 NooBaa */
'use strict';

const argv = require('minimist')(process.argv);

const ssh = require('../qa/functions/ssh_functions');

const {
    server_name,
    server_ip,
    server_secret
} = argv;

function main() {
    console.log(`running runner tests on ${server_name}`);
    let ssh_client;
    return ssh.ssh_connect(null, {
            host: server_ip,
            username: 'noobaaroot',
            password: server_secret,
            keepaliveInterval: 5000,
        })
        .then(client => {
            ssh_client = client;
            return ssh.ssh_exec(ssh_client, `sudo bash -c "/root/node_modules/noobaa-core/src/test/framework/prepare_and_run_tests.sh"`, true);
        })
        .then(() => {
                console.log('SUCCESSFUL TESTS');
                process.exit(0);
            },
            err => {
                console.error('TESTS FAILED:', err.message);
                process.exit(1);
            }
        );
}



if (require.main === module) {
    main();
}
