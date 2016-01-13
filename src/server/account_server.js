// this module is written for both nodejs.
'use strict';

var _ = require('lodash');
var P = require('../util/promise');
var db = require('./db');
var bcrypt = require('bcrypt');
var system_store = require('./stores/system_store');
var system_server = require('./system_server');
// var server_rpc = require('./server_rpc').server_rpc;
// var dbg = require('../util/debug_module')(__filename);



/**
 *
 * ACCOUNT_SERVER
 *
 */
var account_server = {
    create_account: create_account,
    read_account: read_account,
    update_account: update_account,
    delete_account: delete_account,
    list_accounts: list_accounts,
    list_system_accounts: list_system_accounts,
    accounts_status: accounts_status,
    get_system_roles: get_system_roles,
    add_account_sync_credentials_cache: add_account_sync_credentials_cache,
    get_account_sync_credentials_cache: get_account_sync_credentials_cache
};

module.exports = account_server;



/**
 *
 * CREATE_ACCOUNT
 *
 */
function create_account(req) {
    var account = _.pick(req.rpc_params, 'name', 'email', 'password');
    account._id = db.new_object_id();
    return P.fcall(function() {
            return bcrypt_password(account);
        })
        .then(function() {
            var changes;
            if (!req.system) {
                changes = system_server.new_system_changes(account.name, account._id);
                changes.insert.accounts = [account];
            } else {
                changes = {
                    insert: {
                        accounts: [account],
                        roles: [{
                            account: account._id,
                            system: req.system._id,
                            role: 'admin',
                        }]
                    }
                };
            }
            db.ActivityLog.create({
                event: 'account.create',
                level: 'info',
                system: req.system && req.system._id,
                actor: req.account && req.account._id,
                account: account._id,
            });
            return system_store.make_changes(changes);
        })
        .then(function() {
            return {
                token: ''
            };
        });

}



/**
 *
 * READ_ACCOUNT
 *
 */
function read_account(req) {
    return get_account_info(req.account);
}



/**
 *
 * UPDATE_ACCOUNT
 *
 */
function update_account(req) {
    var updates = _.pick(req.rpc_params, 'name', 'email', 'password');
    return P.fcall(function() {
            return bcrypt_password(updates);
        })
        .then(function() {
            var orig_email = req.rpc_params.original_email;
            if (orig_email) {
                var orig_account = system_store.data.accounts_by_email[orig_email];
                updates._id = orig_account._id;
            } else {
                updates._id = req.account._id;
            }
            db.ActivityLog.create({
                event: 'account.update',
                level: 'info',
                system: req.system._id,
                actor: req.account._id,
                account: updates._id,
            });
            return system_store.make_changes({
                update: {
                    accounts: [updates]
                }
            });
        })
        .return();
}



/**
 *
 * DELETE_ACCOUNT
 *
 */
function delete_account(req) {
    db.ActivityLog.create({
        event: 'account.delete',
        level: 'info',
        system: req.system._id,
        actor: req.account._id,
        account: req.account._id,
    });
    return system_store.make_changes({
        remove: {
            accounts: [req.account._id]
        }
    });
}


/**
 *
 * LIST_ACCOUNTS
 *
 */
function list_accounts(req, system_id) {
    var accounts;
    if (req.account.is_support) {
        // for support account - list all accounts
        accounts = system_store.data.accounts;
    } else {
        // for normal accounts - use current account
        accounts = [req.account];
    }
    // system_id is provided by internal call from list_system_accounts
    if (system_id) {
        accounts = _.filter(accounts, function(account) {
            return account.system._id.toString() === system_id.toString();
        });
    }
    return _.map(accounts, get_account_info);
}

/**
 *
 * LIST_ACCOUNTS
 *
 */
function list_system_accounts(req) {
    return list_accounts(req, req.system._id);
}


/**
 *
 * ACCOUNTS_STATUS
 *
 */
function accounts_status(req) {
    var any_non_support_account = _.find(system_store.data.accounts, function(account) {
        return !account.is_support;
    });
    return {
        has_accounts: !!any_non_support_account
    };
}

// called only from stats_aggregator,
// we can remove here and access directly from there
function get_system_roles(req) {
    return req.system.roles_by_account;
}

/**
 *
 * UPDATE_ACCOUNT with keys
 *
 */

function get_account_sync_credentials_cache(req) {
    return req.account.sync_credentials_cache || [];
}
/**
 *
 * UPDATE_ACCOUNT with keys
 *
 */

function add_account_sync_credentials_cache(req) {
    var info = _.pick(req.rpc_params, 'access_key', 'secret_key');
    var updates = {
        _id: req.account._id,
        sync_credentials_cache: req.account.sync_credentials_cache || []
    };
    updates.sync_credentials_cache.push(info);
    return system_store.make_changes({
        update: {
            accounts: [updates]
        }
    }).return();
}




// UTILS //////////////////////////////////////////////////////////



function get_account_info(account) {
    console.log('account', account);
    var info = _.pick(account, 'name', 'email', '_id');
    if (account.is_support) {
        info.is_support = true;
    }
    info.systems = _.map(account.roles_by_system, function(roles, system_id) {
        var system = system_store.data.get_by_id(system_id);
        return {
            name: system.name,
            roles: roles
        };
    });
    console.log('get_account_info', info);
    return info;
}




/**
 *
 * CREATE_SUPPORT_ACCOUNT
 *
 */
function create_support_account() {
    return system_store.refresh()
        .then(function() {
            var support_account = _.find(system_store.data.accounts, function(account) {
                return !!account.is_support;
            });
            if (support_account) return;
            return system_store.make_changes({
                insert: {
                    accounts: [{
                        name: 'Support',
                        email: 'support@noobaa.com',
                        password: process.env.SUPPORT_DEFAULT_PASSWORD || 'help',
                        is_support: true
                    }]
                }
            });
        })
        .then(function() {
            console.log('SUPPORT ACCOUNT CREATED/EXISTS');
        })
        .catch(function(err) {
            console.error('FAILED CREATE SUPPORT ACCOUNT (will retry)', err);
            var delay = 3000 + (1000 * Math.random());
            return P.delay(delay).then(create_support_account);
        });
}

P.delay(1000).then(create_support_account);



function bcrypt_password(account) {
    if (!account.password) {
        return P.resolve();
    }
    return P.fcall(function() {
            return P.nfcall(bcrypt.genSalt, 10);
        })
        .then(function(salt) {
            return P.nfcall(bcrypt.hash, account.password, salt);
        })
        .then(function(password_hash) {
            account.password = password_hash;
        });
}
