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

// authorize is exported to be used as an express middleware
// it reads and prepares the authorized info on the request.
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
    return req.load_account('force_miss').then(
        function() {
            return _.pick(req.account, 'id', 'name', 'email', 'systems_role');
        }
    );
}


function update_account(req) {
    return req.load_account('force_miss').then(
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
    return req.load_account('force_miss').then(
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
                    db.Role.findOne({
                        account: account.id,
                        system: system_id,
                    }).exec()
                ]);
            }
        }
    ).then(
        function(res) {
            // use jwt (json web token) to create a signed token
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
            var token = jwt.sign(jwt_payload, process.env.JWT_SECRET, jwt_options);
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



function authorize() {
    // use jwt (json web token) to verify and decode the signed token
    // the token is expected to be set in req.headers.authorization = 'Bearer ' + token
    // which is a standard token authorization used by oauth2.
    var ej = express_jwt({
        secret: process.env.JWT_SECRET,
        userProperty: 'auth',
        credentialsRequired: false,
    });
    // return an express middleware
    return function(req, res, next) {
        ej(req, res, function(err) {
            if (err) {
                console.log('JWT ERROR', err);
                if (err.name === 'UnauthorizedError') {
                    // if the verification of the token failed it might be because of expiration
                    // in any case return http code 401 (Unauthorized)
                    // hoping the client will do authenticate() again.
                    return next({
                        status: 401,
                        data: 'invalid token',
                    });
                } else {
                    return next(err);
                }
            }
            console.log('AUTH', req.auth);
            prepare_auth_request(req);
            next();
        });
    };
}

// hang calls on the request to be able to use in other api's.
function prepare_auth_request(req) {

    // verify that the request auth has a valid account and set req.account.
    req.load_account = function(force_miss) {
        return Q.fcall(
            function() {
                if (req.account) {
                    return; // already loaded
                }
                if (!req.auth || !req.auth.account_id) {
                    console.error('UNAUTHORIZED', req.auth);
                    var err = new Error('unauthorized');
                    err.status = 401;
                    throw err;
                }
                return db.AccountCache.get(req.auth.account_id, force_miss).then(
                    function(account) {
                        if (!account) {
                            console.error('ACCOUNT MISSING', req.auth);
                            throw new Error('account missing');
                        }
                        if (account.deleted) {
                            console.error('ACCOUNT DELETED', account);
                            throw new Error('account deleted');
                        }
                        req.account = account;
                    }
                );
            }
        );
    };

    // verify that the request auth has a valid system and set req.system and req.role.
    // also calls load_account.
    req.load_system = function(valid_roles, force_miss) {
        return req.load_account().then(
            function() {
                if (req.system) {
                    return; // already loaded
                }
                var err;
                if (!req.auth || !req.auth.system_id) {
                    console.error('UNAUTHORIZED SYSTEM', req.auth);
                    err = new Error('unauthorized system');
                    err.status = 401;
                    throw err;
                }
                if ((!valid_roles && !req.auth.role) ||
                    (valid_roles && !_.contains(valid_roles, req.auth.role))) {
                    console.error('FORBIDDEN ROLE', req.auth);
                    err = new Error('forbidden role');
                    err.status = 403;
                    throw err;
                }
                return db.SystemCache.get(req.auth.system_id, force_miss).then(
                    function(system) {
                        if (!system) {
                            console.error('SYSTEM MISSING', req.auth);
                            throw new Error('system missing');
                        }
                        if (system.deleted) {
                            console.error('SYSTEM DELETED', system);
                            throw new Error('system deleted');
                        }
                        req.system = system;
                        req.role = req.auth.role;
                    }
                );
            }
        );
    };
}
