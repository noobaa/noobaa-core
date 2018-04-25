/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const api = require('../../api');
const P = require('../../util/promise');
const s3ops = require('../utils/s3ops');
const Report = require('../framework/report');
const argv = require('minimist')(process.argv);
const promise_utils = require('../../util/promise_utils');
const dbg = require('../../util/debug_module')(__filename);
const test_name = 'accounts';
dbg.set_process_name(test_name);

let rpc;
let client;
let errors = [];
let s3AccessKeys = {};
let failures_in_test = false;
const bucketName = 'first.bucket';

const TEST_CFG_DEFAULTS = {
    server_ip: '127.0.0.1',
    name: 'account',
    emailSuffix: '@email.email',
    password: 'Password',
    s3_access: true,
    cycles: 30,
    accounts_number: 1,
    to_delete: true,
    skip_create: false
};

if (argv.help) {
    usage();
    process.exit(3);
}

let TEST_CFG = _.defaults(_.pick(argv, _.keys(TEST_CFG_DEFAULTS)), TEST_CFG_DEFAULTS);
Object.freeze(TEST_CFG);

let report = new Report();

function usage() {
    console.log(`
    --server_ip         -   azure location (default: ${TEST_CFG_DEFAULTS.server_ip})
    --name              -   account preffix (default: ${TEST_CFG_DEFAULTS.name})
    --emailSuffix       -   The email suffix (default: ${TEST_CFG_DEFAULTS.emailSuffix})
    --password          -   Account's Password (default: ${TEST_CFG_DEFAULTS.password}) 
    --s3_access         -   should we have s3 access (default: ${TEST_CFG_DEFAULTS.s3_access})
    --cycles            -   number of cycles (default: ${TEST_CFG_DEFAULTS.cycles})
    --accounts_number   -   number of accounts to create per cycle (default: ${TEST_CFG_DEFAULTS.accounts_number})
    --to_delete         -   should we delete the accounts (default: ${TEST_CFG_DEFAULTS.to_delete})
    --skip_create       -   Skip creating accounts (default: ${TEST_CFG_DEFAULTS.skip_create})
    --help              -   show this help
    `);
}

report.init_reporter({ suite: test_name, conf: TEST_CFG });

function saveErrorAndResume(message) {
    console.error(message);
    errors.push(message);
}

function get_accounts_emails() {
    return client.system.read_system()
        .then(res => res.accounts)
        .then(accounts => {
            let emails = [];
            accounts.forEach(function(acc) {
                emails.push(acc.email);
            });
            console.log("Accounts list: " + emails);
            return emails;
        })
        .catch(err => {
            console.error('Get account list failed!', err);
            throw err;
        });
}

function get_s3_account_access(email) {
    return client.system.read_system()
        .then(res => res.accounts)
        .then(accounts => {
            for (let i = 0; i < accounts.length; i++) {
                if (accounts[i].email === email) {
                    s3AccessKeys = {
                        accessKeyId: accounts[i].access_keys[0].access_key,
                        secretAccessKey: accounts[i].access_keys[0].secret_key,
                        access: accounts[i].has_s3_access
                    };
                    break;
                }
            }
            console.log("S3 access keys: " + s3AccessKeys.accessKeyId, s3AccessKeys.secretAccessKey);
            return s3AccessKeys;
        })
        .catch(err => {
            console.error('Getting s3 access keys return error: ', err);
            throw err;
        });
}

function create_account(has_login, account_name) {
    //building an account parameters object.
    console.log('Creating account: ' + account_name + " with access login: " + has_login + " s3 access: " + TEST_CFG.s3_access);
    let email = account_name + TEST_CFG.emailSuffix;
    let allowed_buckets;
    if (TEST_CFG.s3_access === true) {
        allowed_buckets = {
            full_permission: true,
            permission_list: undefined
        };
    } else {
        allowed_buckets = undefined;
    }
    let accountData = {
        name: account_name,
        email,
        password: TEST_CFG.password,
        has_login,
        s3_access: TEST_CFG.s3_access,
        allowed_buckets,
        default_pool: 'first.pool'
    };
    return client.account.create_account(accountData)
        .then(() => report.success('create_account'))
        .then(() => accountData.email)
        .catch(err => {
            report.fail('create_account');
            console.error('Deleting account with error: ', err);
            throw err;
        })
        .delay(10000);
}

function delete_account(email) {
    console.log('Deleting account: ' + email);
    return client.account.delete_account({
            email: email
        })
        .then(() => report.success('delete_account'))
        .delay(10000)
        .catch(err => {
            report.fail('delete_account');
            console.error('Deleting account with error: ', err);
            throw err;
        });
}

function regenerate_s3Access(email) {
    console.log('Regenerating account keys: ' + email);
    return client.account.generate_account_keys({
            email,
            verification_password: 'DeMo1'
        })
        .then(() => report.success('regenerate_s3Access'))
        .catch(err => {
            report.fail('regenerate_s3Access');
            console.error('Regenerating account keys with error: ', err);
            throw err;
        });
}

function edit_s3Access(email, s3Access) {
    console.log('Editing account s3 access: ' + email + 'with access to bucket ' + s3Access);
    return client.account.update_account_s3_access({
            email,
            s3_access: s3Access
        })
        .then(() => report.success('edit_s3Access'))
        .catch(err => {
            report.fail('edit_s3Access');
            console.error('Editing access with error: ', err);
            throw err;
        });
}

function restrict_ip_access(email, ips) {
    console.log('Restrictions ip for account s3 access: ' + email);
    return client.account.update_account({
            email,
            ips
        })
        .then(() => report.success('restrict_ip_access'))
        .catch(err => {
            report.fail('restrict_ip_access');
            console.error('Editing restriction ip access with error: ', err);
            throw err;
        });
}

function verify_s3_access(email) {
    return get_s3_account_access(email)
        .then(keys => s3ops.get_list_buckets(TEST_CFG.server_ip, keys.accessKeyId, keys.secretAccessKey))
        .then(buckets => {
            if (buckets.includes(bucketName)) {
                console.log(`Created account has access to s3 bucket ${bucketName}`);
            } else {
                saveErrorAndResume(`Created account doesn't have access to s3 bucket ${bucketName}`);
                failures_in_test = true;
            }
        });
}

function login_user(email) {
    rpc = api.new_rpc('wss://' + TEST_CFG.server_ip + ':8443');
    client = rpc.new_client({});
    return P.fcall(() => {
            let auth_params = {
                email,
                password: 'DeMo1',
                system: 'demo'
            };
            return client.create_auth_token(auth_params);
        })
        .then(res => {
            if (res.token !== null && res.token !== '') {
                console.log('Account ', email, 'has access to server');
            } else {
                saveErrorAndResume('Account can\'t auth');
                failures_in_test = true;
            }
        });
}

function reset_password(email) {
    console.log('Resetting password for account ' + email);
    return login_user('demo@noobaa.com')
        .then(() => client.account.reset_password({
            email,
            must_change_password: false,
            password: "DeMo1",
            verification_password: "DeMo1"
        }))
        .then(() => report.success('reset_password'))
        .catch(err => {
            report.fail('reset_password');
            console.error('Resetting password with error: ', err);
            throw err;
        })
        .then(() => rpc.disconnect_all());
}

function verify_account_in_system(email, isPresent) {
    return get_accounts_emails()
        .then(emails => {
            if (emails.includes(email) === isPresent) {
                console.log('System contains ', isPresent, 'account');
            } else {
                saveErrorAndResume('Created account doesn\'t contain on system');
                failures_in_test = true;
            }
        });
}

function checkAccountFeatures() {
    let newAccount;
    const fullName = `${TEST_CFG.name}` + (Math.floor(Date.now() / 1000));
    return create_account(true, fullName)
        .then(res => {
            newAccount = res;
            console.log('Created account is ', newAccount, ' with access s3 ', TEST_CFG.s3_access);
            return verify_account_in_system(newAccount, true);
        })
        .then(() => {
            if (TEST_CFG.s3_access === true) {
                return verify_s3_access(newAccount)
                    .then(() => regenerate_s3Access(newAccount))
                    .then(() => verify_s3_access(newAccount))
                    .then(() => restrict_ip_access(newAccount, []))
                    .then(() => get_s3_account_access(newAccount))
                    .then(keys => s3ops.get_list_buckets(TEST_CFG.server_ip, keys.accessKeyId, keys.secretAccessKey)
                        .catch(err => {
                            if (err.code === 'AccessDenied') {
                                console.log(`Account doesn't have access to buckets after switch off access, err ${err.code} - as should`);
                            } else {
                                saveErrorAndResume('After switch off access to buckets account has access to s3');
                            }
                        })
                    )
                    .then(() => restrict_ip_access(newAccount, null))
                    .then(() => verify_s3_access(newAccount))
                    .then(() => edit_s3Access(newAccount, false))
                    .delay(10000)
                    .then(() => get_s3_account_access(newAccount))
                    .then(keys => {
                        let hasAccess = keys.access;
                        if (hasAccess === false) {
                            console.log('S3 access was changed successfully');
                        } else {
                            saveErrorAndResume('S3 access wasn\'t changed to false after edit');
                            failures_in_test = true;
                        }
                        return s3ops.get_list_buckets(TEST_CFG.server_ip, keys.accessKeyId, keys.secretAccessKey)
                            .then(buckets => {
                                if (buckets.length === 0) {
                                    console.log('Account doesn\'t have access to buckets after changing access - as should');
                                } else {
                                    saveErrorAndResume('After switch off s3 access account still has access to ' + buckets);
                                    failures_in_test = true;
                                }
                            });
                    })
                    .then(() => rpc.disconnect_all());
            } else {
                return get_s3_account_access(newAccount)
                    .then(keys => {
                        let hasAccess = keys.access;
                        if (hasAccess === false) {
                            console.log('S3 access was changed successfully');
                        } else {
                            saveErrorAndResume('S3 access wasn\'t changed to false after edit');
                            failures_in_test = true;
                        }
                    });
            }
        })
        .then(() => reset_password(newAccount))
        .then(() => login_user(newAccount))
        .delay(10000)
        .then(() => {
            if (TEST_CFG.to_delete === true) {
                return login_user('demo@noobaa.com')
                    .then(() => delete_account(newAccount))
                    .then(() => verify_account_in_system(newAccount, false));
            } else {
                console.log('Deleting skipped');
            }
        });
}

function doCycle(cycle_num, count) {
    return P.all(
        _.times(count, account_num => {
            const fullName = `${TEST_CFG.name}${account_num}_cycle${cycle_num}_` + (Math.floor(Date.now() / 1000));
            let newAccount;
            return TEST_CFG.skip_create ? fullName : create_account(true, fullName)
                .then(res => {
                    newAccount = res;
                    console.log('Created account is ', newAccount, ' with access s3 ', TEST_CFG.s3_access);
                    return verify_account_in_system(newAccount, true);
                })
                .delay(10000)
                .then(() => {
                    if (TEST_CFG.to_delete === true) {
                        return delete_account(newAccount)
                            .then(() => verify_account_in_system(newAccount, false));
                    } else {
                        console.log('Deleting skipped');
                    }
                });
        }));
}

return promise_utils.loop(TEST_CFG.cycles, cycle => login_user('demo@noobaa.com')
        .then(() => checkAccountFeatures())
        .then(() => rpc.disconnect_all())
        .then(() => login_user('demo@noobaa.com'))
        .then(() => doCycle(cycle, TEST_CFG.accounts_number))
        .delay(10000)
        .then(() => checkAccountFeatures())
        .then(() => rpc.disconnect_all())
    )
    .catch(err => report.print_report()
        .then(() => {
            console.error('something went wrong ' + err + errors);
            failures_in_test = true;
            process.exit(1);
        }))
    .then(() => report.print_report())
    .then(() => {
        if (failures_in_test) {
            console.error('Errors during account test ' + errors);
            process.exit(1);
        } else {
            console.log('account test were successful');
            process.exit(0);
        }
    });
