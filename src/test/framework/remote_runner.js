/* Copyright (C) 2016 NooBaa */
'use strict';

const argv = require('minimist')(process.argv);

const ssh = require('../utils/ssh_functions');

const {
    server_name,
    server_ip,
    server_secret
} = argv;

function main() {
    console.log(`running runner tests on ${server_name}`);
    let ssh_client;
    return ssh.ssh_connect({
            host: server_ip,
            username: 'noobaaroot',
            password: server_secret,
            keepaliveInterval: 5000,
        })
        .then(client => {
            ssh_client = client;
            return ssh.ssh_exec(ssh_client, `sudo bash -c "AWS_ACCESS_KEY_ID=${process.env.AWS_ACCESS_KEY_ID} AWS_SECRET_ACCESS_KEY=${process.env.AWS_SECRET_ACCESS_KEY} /root/node_modules/noobaa-core/src/test/framework/prepare_and_run_tests.sh"`);
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
