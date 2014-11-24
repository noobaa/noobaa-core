// this module is written for both nodejs.
'use strict';

var _ = require('lodash');
var Q = require('q');
var assert = require('assert');
var moment = require('moment');
var LRU = require('noobaa-util/lru');
var db = require('./db');
var rest_api = require('../util/rest_api');
var size_utils = require('../util/size_utils');
var account_api = require('../api/account_api');
var node_monitor = require('./node_monitor');


var account_server = new account_api.Server({
    // CRUD
    create_account: create_account,
    read_account: read_account,
    update_account: update_account,
    delete_account: delete_account,
    // LOGIN / LOGOUT
    login_account: login_account,
    logout_account: logout_account,
});

account_server.account_session_middleware = account_session_middleware;

module.exports = account_server;



//////////
// CRUD //
//////////


function create_account(req) {
    var info = _.pick(req.rest_params, 'name', 'email', 'password');
    return Q.fcall(
        function() {
            return db.Account.create(info);
        }
    ).then(
        function(account) {
            set_session_account(req, account);
        }
    ).then(null,
        function(err) {
            if (err.code === 11000) {
                throw new Error('account already exists');
            } else {
                console.error('FAILED create_account', err);
                throw new Error('failed create account');
            }
        }
    ).thenResolve();
}


function read_account(req) {
    return account_session(req, true).then(
        function() {
            return _.pick(req.account, 'name', 'email', 'systems_role');
        },
        function(err) {
            console.error('FAILED read_account', err);
            throw new Error('read account failed');
        }
    );
}


function update_account(req) {
    return account_session(req, true).then(
        function() {
            var info = _.pick(req.rest_params, 'name', 'email', 'password');
            return db.Account.findByIdAndUpdate(req.account.id, info).exec();
        }
    ).then(null,
        function(err) {
            console.error('FAILED update_account', err);
            throw new Error('update account failed');
        }
    ).thenResolve();
}


function delete_account(req) {
    return account_session(req, true).then(
        function() {
            clear_session_account(req);
            db.AccountCache.invalidate(req.account.id);
            return db.Account.findByIdAndUpdate(req.account.id, {
                deleted: new Date()
            }).exec();
        }
    ).then(null,
        function(err) {
            console.error('FAILED delete_account', err);
            throw new Error('delete account failed');
        }
    ).thenResolve();
}



////////////////////
// LOGIN / LOGOUT //
////////////////////


function login_account(req) {
    var info = {
        email: req.rest_params.email,
        // filter out accounts that were deleted
        deleted: null,
    };
    var password = req.rest_params.password;
    var account;
    // find the account by email, and verify password
    return Q.fcall(
        function() {
            return db.Account.findOne(info).exec();
        }
    ).then(
        function(account_arg) {
            account = account_arg;
            if (account) {
                return Q.npost(account, 'verify_password', [password]);
            }
        }
    ).then(
        function(matching) {
            if (!matching) {
                throw new Error('incorrect email and password');
            }
            set_session_account(req, account);
        },
        function(err) {
            console.error('FAILED login_account', err);
            throw new Error('login failed');
        }
    ).thenResolve();
}


function logout_account(req) {
    clear_session_account(req);
}



/////////////
// SESSION //
/////////////

// set account info in the secure cookie session
// (expected the request to provide secure cookie session)
function set_session_account(req, account) {
    req.session.account_id = account.id;
}
function clear_session_account(req) {
    delete req.session.account_id;
}

// this is exported to be used by other servers as a middleware
function account_session_middleware(req, res, next) {
    account_session(req).thenResolve().nodeify(next);
}

// verify that the session has a valid account using the account cache,
// and set req.account to be available for other apis.
function account_session(req, force) {
    return Q.fcall(
        function() {
            var account_id = req.session.account_id;
            if (!account_id) {
                if (force) {
                    console.error('ACCOUNT SESSION NOT LOGGED IN', account_id);
                    throw new Error('not logged in');
                }
                return;
            }
            return db.AccountCache.get(account_id, force && 'bypass').then(
                function(account) {
                    if (!account) {
                        console.error('ACCOUNT SESSION MISSING', account_id);
                        throw new Error('account missing');
                    }
                    if (account.deleted) {
                        console.error('ACCOUNT SESSION DELETED', account);
                        throw new Error('account deleted');
                    }
                    req.account = account;
                }
            );
        }
    );
}
