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
    delete_curr_account: delete_curr_account,
    delete_account: delete_account,
    list_accounts: list_accounts,
    list_system_accounts: list_system_accounts,
    accounts_status: accounts_status,
    get_system_roles: get_system_roles,
    add_account_sync_credentials_cache: add_account_sync_credentials_cache,
    get_account_sync_credentials_cache: get_account_sync_credentials_cache
};

module.exports = account_server;

system_store.on('load', ensure_support_account);


/**
 *
 * CREATE_ACCOUNT
 *
 */
function create_account(req) {
    var account = _.pick(req.rpc_params, 'name', 'email', 'password');
    account._id = system_store.generate_id();
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
                            _id: system_store.generate_id(),
                            account: account._id,
                            system: req.system._id,
                            role: 'admin',
                        }]
                    }
                };
            }
            create_activity_log_entry(req, 'create', account);
            return system_store.make_changes(changes);
        })
        .then(function() {
            var created_account = system_store.data.get_by_id(account._id);
            var auth = {
                account_id: created_account._id
            };
            if (!req.system) {
                // since we created the first system for this account
                // we expect just one system, but use _.each to get it from the map
                _.each(created_account.roles_by_system, (roles, system_id) => {
                    auth.system_id = system_id;
                    auth.role = roles[0];
                });
            }
            return {
                token: req.make_auth_token(auth),
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

            create_activity_log_entry(req, 'update', updates);
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

 // TODO: Remove after retiring the old menegment console.
function delete_curr_account(req) {
    create_activity_log_entry(req, 'delete', req.account);

    return system_store.make_changes({
            remove: {
                accounts: [req.account._id]
            }
        })
        .return();
}

function delete_account(req) {
    if (!is_support_or_admin(req.system, req.account)) {
        throw req.unauthorized('Action not allowed');
    }

    let account_to_delete = system_store.data.accounts_by_email[req.rpc_params.email];

    if (account_to_delete.is_support) {
        throw new Error('Invalid account, cannot delete support account');
    }

    if (account_to_delete.email === req.system.owner.email) {
        throw new Error('Invalid account, cannot delete system owner account');   
    }

    let roles_to_delete = system_store.data.roles
        .filter(
            role => String(role.account._id) === String(account_to_delete._id)
        )
        .map(
            role => role._id
        );

    return system_store.make_changes({
            remove: {
                accounts: [account_to_delete._id],
                roles: roles_to_delete
            }
        })
        .then(
            val => {
                create_activity_log_entry(req, 'delete', account_to_delete);
                return val;
            },
            err => {
                create_activity_log_entry(req, 'delete', account_to_delete, 'alert');
                throw err;
            }
        )
        .return();
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
            var roles = account.roles_by_system[system_id];
            return roles && roles.length;
        });
    }
    return {
        accounts: _.map(accounts, get_account_info)
    };
}

/**
 *
 * LIST_SYSTEM_ACCOUNTS
 *
 */
function list_system_accounts(req) {
    let accounts;
    if (is_support_or_admin(req.system, req.account)) {
        accounts = _.filter(
            system_store.data.accounts,
            account => {
                if (account.is_support) {
                    return false;
                } else {
                    let roles = account.roles_by_system[req.system._id];
                    return roles && roles.length > 0;
                }
            }
        )
    } else {
        accounts = [req.account];
    }

    return {
        accounts: _.map(accounts, get_account_info)
    };
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
    var info = _.pick(account, 'name', 'email');
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
 *
 *
 */
function ensure_support_account() {
    return system_store.refresh()
        .then(function() {
            var support_account = _.find(system_store.data.accounts, function(account) {
                return !!account.is_support;
            });
            if (support_account) {
                return;
            }
            support_account = {
                _id: system_store.generate_id(),
                name: 'Support',
                email: 'support@noobaa.com',
                password: process.env.SUPPORT_DEFAULT_PASSWORD || 'help',
                is_support: true
            };
            return bcrypt_password(support_account)
                .then(() => system_store.make_changes({
                    insert: {
                        accounts: [support_account]
                    }
                }))
                .then(() => console.log('SUPPORT ACCOUNT CREATED'));
        })
        .catch(function(err) {
            console.error('FAILED CREATE SUPPORT ACCOUNT', err);
        });
}


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


function is_support_or_admin(system, account) {
    return account.is_support || 
        account.roles_by_system[system._id]
            .some(
                role => role === 'admin'
            );
}

function create_activity_log_entry(req, event, account, level) {
    db.ActivityLog.create({
        event: 'account.' + event,
        level: level || 'info',
        system: req.system ? req.system._id : undefined,
        actor: req.account ? req.account._id : undefined,
        account: account._id,
    });
}