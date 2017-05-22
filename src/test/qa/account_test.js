/* Copyright (C) 2016 NooBaa */
'use strict';

const P = require('../../util/promise');
const api = require('../../api');
const argv = require('minimist')(process.argv);
const _ = require('lodash');
const serverName = argv.server_ip || '127.0.0.1';
const rpc = api.new_rpc('wss://' + serverName + ':5443');
const client = rpc.new_client({});
const promise_utils = require('../../util/promise_utils');
// const concurrency = 10;

//defining the required parameters
const {
    name = 'account',
    emailSuffix = '@email.email',
    password = 'Password',
    s3_access = false,
    cycles = 10,
    accounts = 10,
    to_delete = false, //the default should be true or false??
    skip_create = false
} = argv;

//Verfy account is exist by list (using the emails).
function verify_account_by_list(emails) {
    client.account.list_accounts()
        // .then(reply => {
        //     const { accounts: loadedAccounts } = reply;
        //     return emails.every(
        //         email => loadedAccounts.some(
        //             account => account.email === email
        //         )
        //     );
        // })
        .then(({ accounts: loadedAccounts }) => emails.every(
            email => loadedAccounts.some(
                account => account.email === email
            )
        ))
        .then(ok => {
            console.log(ok);
            if (!ok) {
                throw new Error('Could not find an account');
            }
            console.log(emails);
            return emails;
        });
    return emails;
}

function doCycle(cycle_num, count) {
    return P.all(
        _.times(count, account_num => {
            //building an account parameters object.
            const fullName = `${name}${account_num}_cycle${cycle_num}`;
            const req = {
                name: fullName,
                email: `${fullName}${emailSuffix}`,
                password: password,
                s3_access: s3_access
            };
            console.log(`accounts(${JSON.stringify(req)})`);
            return skip_create ? req.email : client.account.create_account(req).then(() => req.email);
        })
    )
        .then(emails => verify_account_by_list(emails))
        .then(emails => to_delete && P.all(
            emails.map(email => {
                console.log(`deleting(${JSON.stringify({ email })})`);
                return client.account.delete_account({ email }); //{ email: req.email });
            })
        ));
}


return P.resolve()
    .then(() => client.create_auth_token({
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    }))
    .then(() => promise_utils.loop(
        cycles,
        cycle => doCycle(cycle, accounts)
    ))
    .then(() => {
        console.info('dissconnecting RPC');
        rpc.disconnect_all();
        process.exit(0);
    })
    .catch(err => {
        console.error('Major error during test :( - exiting...', err);
        process.exit(1);
    });
