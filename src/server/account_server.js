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
    list_system_accounts: list_system_accounts,
    accounts_status: accounts_status,
    get_system_roles: get_system_roles,
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
            console.log('account created!!');
            if (req.is_support||_.isUndefined(req.system)) {

                console.log('about to create system:' + info.name);
                return server_rpc.client.system.create_system({
                        name: info.name
                    }, {
                        // the request needs a token with the newly created account
                        auth_token: req.make_auth_token({
                            account_id: account.id,
                        })
                    })
                    .then(function(res) {
                        console.log('nothing to do');
                        return {
                            token: res.token
                        };
                    });
            } else {
                console.log('no need to create system:' + info.name, 'acc_id:', account.id, 'sys id', req.system);
                return Q.when(db.Role.create({
                        account: account.id,
                        system: req.system._id,
                        role: 'admin',
                    }))
                    .then(function() {
                        return {
                            token: ''
                        };
                    });

            }
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
    console.log('req.rpc:',req.rpc_params);

    // pick and send the updates
    var info = _.pick(req.rpc_params, 'name', 'email', 'password');
    return Q.fcall(function() {
            if (req.rpc_params.original_email) {
                var original_email = req.rpc_params.original_email;
                console.log('update account of ',original_email,' with ', info.email);
                return Q.when(db.Account.find({
                        email: original_email,
                        deleted: null
                    })
                    .exec());
            } else {
                // invalidate the local cache
                db.AccountCache.invalidate(req.account.id);
                return [{
                    _id: req.account.id
                }];
            }
        })
        .then(function(account_info) {
            console.log('account update info2:' +account_info[0]._id+':::'+account_info[0].id+':::'+req.account.id+':::'+ JSON.stringify(info));
            // we just mark the deletion time to make it easy to regret
            // and to avoid stale refs side effects of actually removing from the db.
            return Q.when(db.Account
                .findByIdAndUpdate(account_info[0]._id,
                    info)
                .exec()).
                then(function(update_info){
                    console.log('update status:'+JSON.stringify(update_info));
                }).
                then(null,function(err){
                    console.log('error while update2', err);
                });
        })
        .then(null, function(err) {
            console.log('error while update', err);
        });
}



/**
 *
 * DELETE_ACCOUNT
 *
 */
function delete_account(req) {

    return Q.fcall(function() {
            if (req.params) {
                var user_email = req.params;
                console.log('delete_account1', user_email);
                return Q.when(db.Account.find({
                        email: user_email,
                        deleted: null
                    })
                    .exec());
            } else {
                // invalidate the local cache
                db.AccountCache.invalidate(req.account.id);
                return [{
                    _id: req.account.id
                }];
            }
        })
        .then(function(account_info) {
            console.log('account_info2:' +account_info[0]._id+':::'+ JSON.stringify(account_info[0]));

            // we just mark the deletion time to make it easy to regret
            // and to avoid stale refs side effects of actually removing from the db.
            return Q.when(db.Account
                .findByIdAndUpdate(account_info[0]._id, {
                    deleted: new Date()
                })
                .exec())
                .thenResolve();
        })
        .then(null, function(err) {
            console.log('error while deleting', err);
        });
}


/**
 *
 * LIST_ACCOUNTS
 *
 */
function list_accounts(req, system_id) {


    var roles_query = db.Role.find();
    var accounts_query = db.Account.find();
    var accounts_promise;

    //query for all accounts, not for support user
    if (!_.isUndefined(system_id)) {
        roles_query = db.Role.find({
            system: req.system.id
        });
        accounts_query = db.Account.find({
            deleted: null
        });

    }
    if (req.account.is_support || !_.isUndefined(system_id)) {
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

            return {
                accounts: _.map(accounts, function(account) {
                    if (roles_per_account[account.id]) {
                        var account_roles = roles_per_account[account.id];
                        return get_account_info(account, account_roles);
                    }
                })
            };
        });
}

/**
 *
 * LIST_ACCOUNTS
 *
 */
function list_system_accounts(req) {
    return Q.fcall(function() {
        return list_accounts(req, req.system.id);
    }).then(function(accounts) {
        var normalized_accounts = _.filter(accounts.accounts, null);
        accounts.accounts = normalized_accounts;
        return accounts;
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

function get_system_roles(req) {
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
    console.log('account', account);
    var info = _.pick(account, 'name', 'email', '_id');
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
