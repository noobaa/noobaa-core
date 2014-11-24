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
var express_jwt = require('express-jwt');
var jwt = require('jsonwebtoken');


var account_server = new account_api.Server({
    // CRUD
    create_account: create_account,
    read_account: read_account,
    update_account: update_account,
    delete_account: delete_account,
    // AUTH
    authenticate: authenticate,
});

account_server.authorize = authorize;

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
            return _.pick(account, 'id');
        },
        function(err) {
            if (err.code === 11000) {
                throw new Error('account already exists');
            } else {
                console.error('FAILED create_account', err);
                throw new Error('failed create account');
            }
        }
    );
}


function read_account(req) {
    fail_no_account(req);
    return _.pick(req.account, 'id', 'name', 'email', 'systems_role');
}


function update_account(req) {
    fail_no_account(req);
    return Q.fcall(
        function() {
            db.AccountCache.invalidate(req.account.id);
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
    fail_no_account(req);
    return Q.fcall(
        function() {
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



//////////
// AUTH //
//////////

var JWT_SECRET = process.env.JWT_SECRET || '93874gfn987wgfb98721tb4f897tu';

function authenticate(req) {
    var info = {
        email: req.rest_params.email,
        // filter out accounts that were deleted
        deleted: null,
    };
    var password = req.rest_params.password;
    var system_id = req.rest_params.system;
    var expires = req.rest_params.expires;
    var account;
    var auth_error;
    // find the account by email, and verify password
    return Q.fcall(
        function() {
            return db.Account.findOne(info).exec();
        }
    ).then(
        function(account_arg) {
            account = account_arg;
            if (!account) {
                // consider no account as non matching password
                // to avoid brute force attacks of requests on this api.
                return false;
            } else {
                return Q.npost(account, 'verify_password', [password]);
            }
        }
    ).then(
        function(matching) {
            if (!matching) {
                auth_error = new Error('incorrect email and password');
                throw auth_error;
            }

            if (!system_id) {
                return [];
            } else {
                // find system and role
                return Q.all([
                    db.System.findById(system_id).exec(),
                    db.Role.find({
                        account: account.id,
                        system: system_id,
                    }).exec()
                ]);
            }
        }
    ).then(
        function(res) {
            var jwt_payload = {
                account_id: account.id
            };
            if (system_id) {
                var system = res[0];
                var role = res[1];
                if (!system) {
                    auth_error = new Error('system not found');
                    throw auth_error;
                }
                if (!role) {
                    auth_error = new Error('role not found');
                    throw auth_error;
                }
                jwt_payload.system_id = system_id;
                jwt_payload.role = role.role;
            }
            var jwt_options = {};
            if (expires) {
                jwt_options.expiresInMinutes = expires / 60;
            }
            var token = jwt.sign(jwt_payload, JWT_SECRET, jwt_options);
            return {
                token: token
            };
        }
    ).then(null,
        function(err) {
            if (err === auth_error) {
                throw auth_error;
            }
            console.error('FAILED authenticate', err);
            throw new Error('authenticate failed');
        }
    );
}




// this is exported to be used as a middleware
function authorize() {
    var ej = express_jwt({
        secret: JWT_SECRET,
        userProperty: 'auth',
        credentialsRequired: false,
    });
    return function(req, res, next) {
        ej(req, res, function(err) {
            console.log('JWT', err, req.auth);
            if (err) {
                if (err.name === 'UnauthorizedError') {
                    return next({
                        status: 401,
                        data: 'invalid token',
                    });
                } else {
                    return next(err);
                }
            }
            prepare_auth_request(req).thenResolve().nodeify(next);
        });
    };
}

// verify that the request authorization is a valid account and system,
// and set req.account & req.system & req.role to be available for other apis.
function prepare_auth_request(req) {
    return Q.fcall(
        function() {
            if (!req.auth) {
                return;
            }
            var account_id = req.auth.account_id;
            if (!account_id) {
                return;
            }
            var system_id = req.auth.system_id;
            return Q.all([
                db.AccountCache.get(account_id).then(
                    function(account) {
                        if (!account) {
                            console.error('ACCOUNT MISSING', account_id);
                            throw new Error('account missing');
                        }
                        if (account.deleted) {
                            console.error('ACCOUNT DELETED', account);
                            throw new Error('account deleted');
                        }
                        req.account = account;
                    }
                ),
                // check system if auth provided a system_id
                system_id && db.SystemCache.get(system_id).then(
                    function(system) {
                        if (!system) {
                            console.error('SYSTEM MISSING', system_id);
                            throw new Error('system missing');
                        }
                        if (system.deleted) {
                            console.error('SYSTEM DELETED', system);
                            throw new Error('system deleted');
                        }
                        req.system = system;
                        req.role = req.auth.role;
                    }
                ),
            ]);
        }
    );
}

function fail_no_account(req) {
    if (!req.account) {
        console.error('NOT LOGGED IN', req.auth);
        throw new Error('not logged in');
    }
}
