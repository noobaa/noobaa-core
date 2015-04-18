// this module is written for both nodejs.
'use strict';

var _ = require('lodash');
var Q = require('q');
var assert = require('assert');
var moment = require('moment');
var LRU = require('noobaa-util/lru');
var size_utils = require('../util/size_utils');
var db = require('./db');
var api = require('../api');
var system_server = require('./system_server');


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
};

module.exports = account_server;



/**
 *
 * CREATE_ACCOUNT
 *
 */
function create_account(req) {
    var info = _.pick(req.rest_params, 'name', 'email', 'password');

    // reply_token will be filled with token info for reply
    // this is to be used by internal calls to create_system etc.
    req.reply_token = {};

    return Q.when(db.Account.create(info))
        .then(null, db.check_already_exists(req, 'account'))
        .then(function(account) {

            // filling reply_token
            req.reply_token.account_id = account.id;

            // create a new request that inherits from current req
            var system_req = Object.create(req);
            system_req.account = account;
            system_req.params = {
                name: account.name
            };
            return system_server.create_system(system_req);
        })
        .then(function() {
            // a token for the new account
            console.log('req.reply_token', req.reply_token);
            var token = req.make_auth_token(req.reply_token);
            return {
                token: token
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
    var info = _.pick(req.rest_params, 'name', 'email', 'password');
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
