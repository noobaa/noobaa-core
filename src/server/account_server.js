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

account_server.account_session = account_session;

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
    return account_session(req, 'force').then(
        function() {
            return db.Account.findById(get_session_account_id(req)).exec();
        }
    ).then(
        function(account) {
            if (!account) {
                console.error('MISSING ACCOUNT', get_session_account_id(req));
                throw new Error('account not found');
            }
            return {
                name: account.name,
                email: account.email,
            };
        },
        function(err) {
            console.error('FAILED read_account', err);
            throw new Error('read account failed');
        }
    );
}


function update_account(req) {
    return account_session(req, 'force').then(
        function() {
            var info = _.pick(req.rest_params, 'name', 'email', 'password');
            return db.Account.findByIdAndUpdate(get_session_account_id(req), info).exec();
        }
    ).then(null,
        function(err) {
            console.error('FAILED update_account', err);
            throw new Error('update account failed');
        }
    ).thenResolve();
}


function delete_account(req) {
    return account_session(req, 'force').then(
        function() {
            return db.Account.findByIdAndRemove(get_session_account_id(req)).exec();
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
    var info = _.pick(req.rest_params, 'email');
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
    delete req.session.account;
}



/////////////
// SESSION //
/////////////


function get_session_account_id(req) {
    var a = req.session.account;
    if (a) {
        return a.id;
    }
}

// set account info in the session
// (expected to use secure cookie session)
function set_session_account(req, account) {
    req.session.account = {
        id: account.id,
        name: account.name,
        email: account.email,
    };
}

// cache for accounts in memory.
// since accounts don't really change we can simply keep in the server's memory,
// and decide how much time it makes sense before expiring and re-reading from db.
var account_session_lru = new LRU({
    max_length: 100,
    expiry_ms: 600000, // 10 minutes expiry
});


// verify that the session has a valid account using the account_session_lru cache.
// this function is also exported to be used by other servers as a middleware.
function account_session(req, force) {
    return Q.fcall(
        function() {
            var account_id = get_session_account_id(req);
            if (!account_id) {
                console.error('NO ACCOUNT SESSION', account_id);
                throw new Error('not logged in');
            }

            var item = account_session_lru.find_or_add_item(account_id);

            // use cached account if not expired
            if (item.account && force !== 'force') {
                req.account = item.account;
                return req.account;
            }

            // fetch account from the database
            console.log('ACCOUNT MISS', account_id);
            return db.Account.findById(account_id).exec().then(
                function(account) {
                    if (!account) {
                        console.error('MISSING ACCOUNT SESSION', account_id);
                        throw new Error('account removed');
                    }
                    // update the cache item
                    item.account = account;
                    req.account = account;
                    return req.account;
                }
            );
        }
    );
}
