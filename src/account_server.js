// this module is written for both nodejs.
'use strict';

var _ = require('underscore');
var Q = require('q');
var restful_api = require('./restful_api');
var account_api = require('./account_api');
var Account = require('./models/account');
var LRU = require('noobaa-util/lru');

var account_server = new account_api.Server({
    login_account: login_account,
    logout_account: logout_account,
    create_account: create_account,
    read_account: read_account,
    update_account: update_account,
    delete_account: delete_account,
});

// utility function for other servers
account_server.account_session = account_session;

module.exports = account_server;

function login_account(req) {
    var info = {
        email: req.restful_params.email,
    };
    var password = req.restful_params.password;
    var account;
    // find account by email, and verify password
    return Account.findOne(info).exec().then(function(account_arg) {
        account = account_arg;
        return Q.npost(account, 'verify_password', [password]);
    }).then(function(matching) {
        if (!matching) {
            throw new Error('bad password');
        }
        // insert the account id into the session 
        // (expected to use secure cookie session)
        req.session.account_id = account.id;
    });
}


function logout_account(req) {
    delete req.session.account_id;
}


function create_account(req) {
    var info = _.pick(req.restful_params, 'email', 'password');
    return Account.create(info).then(function(account) {
        return undefined;
    });
}


function read_account(req) {
    return account_session(req, 'force').then(function() {
        return Account.findById(req.session.account_id).exec();
    }).then(function(account) {
        if (!account) {
            throw new Error('NO ACCOUNT ' + req.session.account_id);
        }
        return {
            email: account.email,
        };
    });
}


function update_account(req) {
    return account_session(req, 'force').then(function() {
        var info = _.pick(req.restful_params, 'email', 'password');
        return Account.findByIdAndUpdate(req.session.account_id, info).exec();
    }).then(function() {
        return undefined;
    });
}


function delete_account(req) {
    return account_session(req, 'force').then(function() {
        return Account.findByIdAndRemove(req.session.account_id).exec();
    }).then(function() {
        return undefined;
    });
}


// 10 minutes expiry
var accounts_lru = new LRU(200, 600000, 'accounts_lru');

// verify that the session has a valid account using a cache
// to be used by other servers
function account_session(req, force) {
    return Q.fcall(function() {
        var account_id = req.session.account_id;
        if (!account_id) {
            throw new Error('NO ACCOUNT ' + account_id);
        }

        var item = accounts_lru.find_or_add_item(account_id);

        // use cached account if not expired
        if (item.account && force !== 'force') {
            req.account = item.account;
            return req.account;
        }

        // fetch account from the database
        console.log('ACCOUNT MISS', account_id);
        return Account.findById(account_id).exec().then(function(account) {
            if (!account) {
                throw new Error('MISSING ACCOUNT ' + account_id);
            }
            // update the cache item
            item.account = account;
            req.account = account;
            return req.account;
        });
    });
}
