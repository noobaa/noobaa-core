// this module is written for both nodejs.
'use strict';

var _ = require('lodash');
var Q = require('q');
var db = require('./db');
var server_rpc = require('./server_rpc');
// var dbg = require('noobaa-util/debug_module')(__filename);


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
    accounts_status: accounts_status,
    get_system_accounts: get_system_accounts,
};

module.exports = account_server;



/**
 *
 * CREATE_ACCOUNT
 *
 */
function create_account(req) {
    var info = _.pick(req.rpc_params, 'name', 'email', 'password');
    var account;

    return Q.when(db.Account.create(info))
        .then(null, db.check_already_exists(req, 'account'))
        .then(function(account_arg) {
            account = account_arg;
            return server_rpc.client.system.create_system({
                name: info.name
            }, {
                // the request needs a token with the newly created account
                auth_token: req.make_auth_token({
                    account_id: account.id,
                })
            });
        })
        .then(function(res) {
            return {
                token: res.token
            };
        });
}



/**
 *
 * READ_ACCOUNT
 *
 */
function read_account(req) {
    // read roles of this account
    return Q.when(
            db.Role.find({
                account: req.account.id
            })
            .populate('system')
            .exec())
        .then(function(roles) {
            return get_account_info(req.account, roles);
        });
}



/**
 *
 * UPDATE_ACCOUNT
 *
 */
function update_account(req) {
    // invalidate the local cache
    db.AccountCache.invalidate(req.account.id);

    // pick and send the updates
    var info = _.pick(req.rpc_params, 'name', 'email', 'password');
    return Q.when(db.Account
            .findByIdAndUpdate(req.account.id, info)
            .exec())
        .thenResolve();
}



/**
 *
 * DELETE_ACCOUNT
 *
 */
function delete_account(req) {
    // invalidate the local cache
    db.AccountCache.invalidate(req.account.id);

    // we just mark the deletion time to make it easy to regret
    // and to avoid stale refs side effects of actually removing from the db.
    return Q.when(db.Account
            .findByIdAndUpdate(req.account.id, {
                deleted: new Date()
            })
            .exec())
        .thenResolve();
}


/**
 *
 * LIST_ACCOUNTS
 *
 */
function list_accounts(req) {

    var roles_query = db.Role.find();
    var accounts_query = db.Account.find();
    var accounts_promise;

    if (req.account.is_support) {
        // for support account - list all accounts and roles
        accounts_promise = accounts_query.exec();
    } else {
        // for normal accounts - use current account and query account roles
        roles_query.where('account').eq(req.account.id);
        accounts_promise = Q.resolve(req.account);
    }

    roles_query.populate('system');

    return Q.all([accounts_promise, roles_query.exec()])
        .spread(function(accounts, roles) {
            var roles_per_account = _.groupBy(roles, function(role) {
                return role.account;
            });
            console.log('roles_per_account', roles_per_account);
            return {
                accounts: _.map(accounts, function(account) {
                    var account_roles = roles_per_account[account.id];
                    return get_account_info(account, account_roles);
                })
            };
        });
}


// once any account is found then we can save this state
// in memory since it will not change.
var any_account_exists = false;


/**
 *
 * ACCOUNTS_STATUS
 *
 */
function accounts_status(req) {
    return Q.fcall(function() {
            // use the cached value only if positive,
            // otherwise we have to check the DB to know for sure
            if (any_account_exists) {
                return true;
            } else {
                return check_db_if_any_account_exists();
            }
        })
        .then(function(has_accounts) {
            if (has_accounts) {
                any_account_exists = true;
            }
            return {
                has_accounts: has_accounts
            };
        });
}

function get_system_accounts(req) {
    return Q.when(
            db.Role.find({
              system: req.system.id
            })
            .exec())
        .then(function(roles) {
            return roles;
        });
}



// UTILS //////////////////////////////////////////////////////////



function get_account_info(account, roles) {
    var info = _.pick(account, 'name', 'email');
    if (account.is_support) {
        info.is_support = true;
    }

    // make a list of systems from the account roles
    var roles_per_system = _.groupBy(roles, function(role) {
        if (role.system && !role.system.deleted) {
            return role.system.id;
        }
    });

    info.systems = _.map(roles_per_system, function(system_roles) {
        return {
            name: system_roles[0].system.name,
            roles: _.pluck(system_roles, 'role')
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
    return Q.when(db.Account.create({
            name: 'Support',
            email: 'support@noobaa.com',
            password: process.env.SUPPORT_DEFAULT_PASSWORD || 'help',
            is_support: true
        }))
        .then(function() {
            console.log('SUPPORT ACCOUNT CREATED');
        }, function(err) {
            if (db.is_err_exists(err)) return;
            console.error('FAILED CREATE SUPPORT ACCOUNT (will retry)', err);
            var delay = 3000 + (1000 * Math.random());
            return Q.delay(delay).then(create_support_account);
        });
}

Q.delay(1000).then(create_support_account);


function check_db_if_any_account_exists() {
    return Q.when(
            db.Account.findOne({
                is_support: null,
                deleted: null
            }, {
                _id: 1
            })
            .exec())
        .then(function(any_account) {
            return !!any_account;
        });
}
