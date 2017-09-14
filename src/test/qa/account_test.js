/* Copyright (C) 2016 NooBaa */
'use strict';

const P = require('../../util/promise');
const api = require('../../api');
const argv = require('minimist')(process.argv);
const s3ops = require('../qa/s3ops');
const _ = require('lodash');
const promise_utils = require('../../util/promise_utils');
const serverName = argv.server_ip || '127.0.0.1';
const systemName = argv.system_ip;
const rpc = api.new_rpc('wss://' + serverName + ':8443');
var client = rpc.new_client({});
const bucketName = 'first.bucket';
var failures_in_test = false;
var newAccount;
var s3AccessKeys = {};
let errors = [];

const {
        name = 'account',
        emailSuffix = '@email.email',
        password = 'Password',
        s3_access = true,
        cycles = 10,
        accounts_number = 10,
        to_delete = true, //the default should be true or false??
        skip_create = false
} = argv;

function saveErrorAndResume(message) {
    console.log(message);
    errors.push(message);
}

function get_accounts_emails() {
    return client.system.read_system()
        .then(res => res.accounts)
        .then(accounts => {
            var emails = [];
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
           for (var i = 0; i < accounts.length; i++) {
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

function create_account(hasLogin, s3Access, account_name) {
        //building an account parameters object.
        var s3BucketsAllow;
        if (s3Access === true) {
            s3BucketsAllow = {
                full_permission: true,
                permission_list: undefined
            };
        } else {
            s3BucketsAllow = undefined;
        }
        var accountData = {
            name: account_name,
            email: account_name + emailSuffix,
            password: password,
            has_login: hasLogin,
            s3_access: s3Access,
            allowed_buckets: s3BucketsAllow,
            default_pool: 'first.pool'
        };
        console.log('Creating account: ' + account_name + " with access login: " + hasLogin + " s3 access: " + s3Access);
        return client.account.create_account(accountData)
            .then(() => accountData.email)
            .catch(err => {
                console.error('Deleting account with error: ', err);
                throw err;
            });
        }

function delete_account(email) {
    console.log('Deleting account: ' + email);
    return client.account.delete_account({
        email: email
    })
        .catch(err => {
            console.error('Deleting account with error: ', err);
            throw err;
        });
}

function regenerate_s3Access(email) {
    console.log('Regenerating account keys: ' + email);
    return client.account.generate_account_keys({
        email: email,
        verification_password: 'DeMo1'
    })
        .catch(err => {
            console.error('Regenerating account keys with error: ', err);
            throw err;
        });
}

function edit_s3Access(email, s3Access) {
    console.log('Editing account s3 access: ' + email);
    return client.account.update_account_s3_access({
        email: email,
        s3_access: s3Access
    })
        .catch(err => {
            console.error('Editing access with error: ', err);
            throw err;
        });
}

function restrict_ip_access(email, ipsList) {
    console.log('Editing account s3 access: ' + email);
    return client.account.update_account({
        email: email,
        ips: ipsList
    })
        .catch(err => {
            console.error('Editing restriction ip access with error: ', err);
            throw err;
        });
}

function verify_s3_access(email) {
    return get_s3_account_access(email)
    .then(keys => P.resolve(s3ops.get_list_buckets(systemName, keys.accessKeyId, keys.secretAccessKey)))
        .then(buckets => {
            if (buckets.includes(bucketName)) {
                console.log('Created account has access to s3 bucket' + bucketName);
            } else {
                saveErrorAndResume('Created account doesn\'t have access to s3 bucket ' + bucketName);
                failures_in_test = true;
            }
        });
}

function login_user(email) {
    console.info('disconnecting RPC');
    rpc.disconnect_all();
    client = rpc.new_client({});
    console.log('Creating token with user ' + email);
    return P.resolve(client.create_auth_token({
        email: email,
        system: 'demo',
        password: "DeMo1",
    }))
        .then(res => {
            if (res.token !== null && res.token !== '') {
                console.log('Account has access to server');
            } else {
                saveErrorAndResume('Account can\'t auth');
                failures_in_test = true;
            }
        });
}

function reset_password(email) {
    console.log('Resetting password for account ' + email);
    return P.resolve(client.account.reset_password({
        email: email,
        must_change_password: false,
        password: "DeMo1",
        verification_password: "DeMo1"
    }))
        .catch(err => {
            console.error('Editing restriction ip access with error: ', err);
            throw err;
        });
}

function verify_account_in_system(email, is_contain) {
    return P.resolve(get_accounts_emails())
    .then(emails => {
    if (emails.includes(email) === is_contain) {
        console.log('System contains created account');
    } else {
        saveErrorAndResume('Created account doesn\'t contain on system');
        failures_in_test = true;
    }
    });
}
P.fcall(function() {
    var auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    };
    return client.create_auth_token(auth_params);
    })
    .then(() => P.resolve(create_account(true, true)))
    .delay(10000)
    .then(res => {
        newAccount = res;
        return P.resolve(verify_account_in_system(newAccount, true));
    })
    .then(() => P.resolve(verify_s3_access(newAccount)))
    .then(() => P.resolve(regenerate_s3Access(newAccount)))
    .then(() => P.resolve(verify_s3_access(newAccount)))
    .then(() => P.resolve(restrict_ip_access(newAccount, [])))
    .then(() => P.resolve(get_s3_account_access(newAccount)))
    .then(keys => P.resolve(s3ops.get_list_buckets(systemName, keys.accessKeyId, keys.secretAccessKey)))
    .then(buckets => {
        if (buckets.length === 0) {
            console.log('Account doesn\'t have access to buckets');
        } else {
            saveErrorAndResume('After set restrict ip no allow ip s3 access account still has access to' + buckets);
            failures_in_test = true;
        }
    })
    .then(() => P.resolve(restrict_ip_access(newAccount, null)))
    .then(() => P.resolve(verify_s3_access(newAccount)))
    .then(() => P.resolve(edit_s3Access(newAccount, false)))
    .then(() => P.resolve(get_s3_account_access(newAccount)))
    .then(keys => {
        var hasAccess = keys.access;
        if (hasAccess === false) {
            console.log('S3 access was changed successfully');
        } else {
            saveErrorAndResume('S3 access wasn\'t changed to false after edit');
            failures_in_test = true;
        }
        return P.resolve(s3ops.get_list_buckets(systemName, keys.accessKeyId, keys.secretAccessKey));
    })
    .then(buckets => {
        if (buckets.length === 0) {
            console.log('Account doesn\'t have access to buckets');
        } else {
            saveErrorAndResume('After switch off s3 access account still has access to' + buckets);
            failures_in_test = true;
        }
    })
    .then(() => P.resolve(reset_password(newAccount)))
    .then(() => P.resolve(login_user(newAccount)))
    .then(() => P.resolve(delete_account(newAccount)))
    .then(() => P.resolve(login_user('demo@noobaa.com')))
    .then(() => P.resolve(verify_account_in_system(newAccount, false)))
    .then(() => {
        console.info('disconnecting RPC');
        rpc.disconnect_all();
    })
    .then(() => {
        if (failures_in_test) {
            console.log('Got error/s during test :( - exiting...' + errors);
            process.exit(1);
        } else {
            console.log('Test passed with no errors :) - exiting...');
            process.exit(0);
        }
    })
    .catch(err => {
        console.log('Major error during test :( - exiting...', err);
        process.exit(1);
    });

function doCycle(cycle_num, count) {
    return P.all(
        _.times(count, account_num => {
            const fullName = `${name}${account_num}_cycle${cycle_num}` + (Math.floor(Date.now() / 1000));
            return skip_create ? fullName : create_account(true, s3_access, fullName)
                .then(() => newAccount)
                .then(() => verify_account_in_system(newAccount, true))
                .then(() => {
                    if (s3_access === true) {
                        return P.resolve(verify_s3_access(newAccount))
                            .then(() => P.resolve(regenerate_s3Access(newAccount)))
                            .then(() => P.resolve(verify_s3_access(newAccount)))
                            .then(() => P.resolve(restrict_ip_access(newAccount, [])))
                            .then(() => P.resolve(get_s3_account_access(newAccount)))
                            .then(keys => P.resolve(s3ops.get_list_buckets(systemName, keys.accessKeyId, keys.secretAccessKey)))
                            .then(buckets => {
                                if (buckets.length === 0) {
                                    console.log('Account doesn\'t have access to buckets');
                                } else {
                                    saveErrorAndResume('After set restrict ip no allow ip s3 access account still has access to' + buckets);
                                    failures_in_test = true;
                                }
                            })
                            .then(() => P.resolve(restrict_ip_access(newAccount, null)))
                            .then(() => P.resolve(verify_s3_access(newAccount)))
                            .then(() => P.resolve(edit_s3Access(newAccount, false)))
                            .then(() => P.resolve(get_s3_account_access(newAccount)))
                            .then(keys => {
                                var hasAccess = keys.access;
                                if (hasAccess === false) {
                                    console.log('S3 access was changed successfully');
                                } else {
                                    saveErrorAndResume('S3 access wasn\'t changed to false after edit');
                                    failures_in_test = true;
                                }
                                return P.resolve(s3ops.get_list_buckets(systemName, keys.accessKeyId, keys.secretAccessKey));
                            })
                            .then(buckets => {
                                if (buckets.length === 0) {
                                    console.log('Account doesn\'t have access to buckets');
                                } else {
                                    saveErrorAndResume('After switch off s3 access account still has access to' + buckets);
                                    failures_in_test = true;
                                }
                            });
                    } else {
                        return P.resolve(get_s3_account_access(newAccount))
                            .then(keys => {
                                var hasAccess = keys.access;
                                if (hasAccess === false) {
                                    console.log('S3 access was changed successfully');
                                } else {
                                    saveErrorAndResume('S3 access wasn\'t changed to false after edit');
                                    failures_in_test = true;
                                }
                            });
                    }
                })
                .then(() => P.resolve(reset_password(newAccount)))
                .then(() => P.resolve(login_user(newAccount)))
                .then(() => {
                if (to_delete === true) {
                    return P.resolve(delete_account(newAccount))
                    .then(() => P.resolve(login_user('demo@noobaa.com')))
                    .then(() => P.resolve(verify_account_in_system(newAccount, false)));
                } else {
                    console.log('Deleting skipped');
                }
                });
    }));
}

return P.resolve()
    .then(() => login_user('demo@noobaa.com'))
    .then(() => promise_utils.loop(
        cycles,
        cycle => doCycle(cycle, accounts_number)
    ))
    .then(() => {
        console.info('disconnecting RPC');
        rpc.disconnect_all();
        process.exit(0);
    })
    .catch(err => {
        console.error('Major error during test :( - exiting...', err);
        process.exit(1);
    });