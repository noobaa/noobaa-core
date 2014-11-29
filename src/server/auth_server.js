// this module is written for both nodejs.
'use strict';

var _ = require('lodash');
var Q = require('q');
var assert = require('assert');
var moment = require('moment');
var db = require('./db');
var rest_api = require('../util/rest_api');
var api = require('../api');
var express_jwt = require('express-jwt');
var jwt = require('jsonwebtoken');


var auth_server = new api.auth_api.Server({
    // CRUD
    create_auth: create_auth,
    read_auth: read_auth,
});

// authorize is exported to be used as an express middleware
// it reads and prepares the authorized info on the request.
auth_server.authorize = authorize;

module.exports = auth_server;



//////////
// CRUD //
//////////

/**
 * create_auth()
 */
function create_auth(req) {
    var email = req.rest_params.email;
    var password = req.rest_params.password;
    var system_name = req.rest_params.system;
    var expiry = req.rest_params.expiry;
    var email_account;
    var authorizing_account;
    var account_to_authorize;
    var system;
    var role_name;

    // return the same error to all auth failures
    // this is to avoid attacks of querying with different params to peek into our db.
    var auth_fail = function() {
        return req.rest_error('unauthorized', 401);
    };

    return req.load_account({
        allow_missing: true
    }).then(function() {

        if (!email) return;

        // find account by email
        return db.Account.findOne({
            email: email,
            deleted: null,
        }).exec();

    }).then(function(account_arg) {
        email_account = account_arg;

        // consider email not found the same as bad password
        // this is to avoid attacks of querying emails to detect which exist in our db.
        if (!email_account || !password) return;

        // verify the password
        return Q.npost(email_account, 'verify_password', [password]);

    }).then(function(password_verified) {

        if (!email) {
            // when email is not provided it is to re-authorize the current account
            if (!req.account) throw auth_fail();
            authorizing_account = req.account;
            account_to_authorize = req.account;
        } else if (!password) {
            // email is provided but not password -
            // it is to give authorization by current account to the email account
            if (!req.account || !email_account) throw auth_fail();
            authorizing_account = req.account;
            account_to_authorize = email_account;
        } else {
            // email and password provided to authenticate with credentials
            // if not verified - either account missing or bad password
            if (!password_verified) throw auth_fail();
            authorizing_account = email_account;
            account_to_authorize = email_account;
        }

        if (!system_name) return;

        // find system
        return Q.when(db.System.findOne({
                name: system_name,
                deleted: null,
            }).exec())
            .then(function(system_arg) {
                system = system_arg;
                if (!system || system.deleted) throw auth_fail();

                // find the role of authorizing_account and system
                return db.Role.findOne({
                    account: authorizing_account.id,
                    system: system.id,
                }).exec();
            })
            .then(function(role) {
                // support accounts can give other accounts any permission
                if (authorizing_account.is_support) {
                    role_name = req.rest_params.role || 'admin';
                    return;
                }

                if (!role) throw auth_fail();
                role_name = req.rest_params.role || role.role;

                // only admin can give other accounts any permission
                if (role_name !== role.role && role.role !== 'admin') throw auth_fail();
            });

    }).then(function() {

        // use jwt (json web token) to create a signed token
        var jwt_payload = {
            account_id: account_to_authorize.id
        };

        // add the system and role if provided
        if (system_name) {
            jwt_payload.system_id = system.id;
            jwt_payload.role = role_name;
        }

        var more_auth = _.pick(req.rest_params, 'bucket', 'object');
        _.extend(jwt_payload, more_auth);

        // set expiry if provided
        var jwt_options = {};
        if (expiry) jwt_options.expiresInMinutes = expiry / 60;

        // create and return the signed token
        var token = jwt.sign(jwt_payload, process.env.JWT_SECRET, jwt_options);
        return {
            token: token
        };
    });
}


/**
 * read_auth()
 */
function read_auth(req) {
    if (!req.auth) return {};

    return req.load_system({
            allow_missing: true
        })
        .then(function() {
            var reply = _.pick(req.auth, 'role', 'bucket', 'object');
            if (req.account) {
                reply.account = _.pick(req.account, 'name', 'email');
            }
            if (req.system) {
                reply.system = _.pick(req.system, 'name');
            }
            return reply;
        });
}



//////////////////////////
// AUTHORIZE MIDDLEWARE //
//////////////////////////

/**
 * authorize()
 */
function authorize() {

    // use jwt (json web token) to verify and decode the signed token
    // the token is expected to be set in req.headers.authorization = 'Bearer ' + token
    // which is a standard token authorization used by oauth2.
    var jwt_middleware = express_jwt({
        secret: process.env.JWT_SECRET,
        userProperty: 'auth',
        credentialsRequired: false,
    });

    // return an express middleware
    return function(req, res, next) {
        jwt_middleware(req, res, function(err) {
            if (err) {
                // if the verification of the token failed it might be because of expiration
                // in any case return http code 401 (Unauthorized)
                // hoping the client will do authenticate() again.
                console.log('AUTH ERROR', err);
                if (err.name === 'UnauthorizedError') {
                    res.status(401).send('unauthorized token');
                } else {
                    next(err);
                }
            } else {
                _prepare_auth_request(req);
                next();
            }
        });
    };
}

/**
 * _prepare_auth_request() hang calls on the request to be able to use in other api's.
 */
function _prepare_auth_request(req) {

    /**
     * req.load_account verifies that the request auth has a valid account
     * and sets req.account.
     *
     * @param <Object> options:
     *      - <Boolean> allow_missing don't fail if there is no system in req.auth
     *      - <Boolean> cache_miss bypass the cache.
     */
    req.load_account = function(options) {
        return Q.fcall(function() {

            // check if already loaded
            if (req.account) return;

            options = options || {};

            // check that auth contains account
            if (!req.auth || !req.auth.account_id) {
                if (options.allow_missing) return;
                throw req.rest_error('unauthorized', 401);
            }

            // use a cache because this is called on every authorized api
            return db.AccountCache.get(req.auth.account_id, options.cache_miss && 'cache_miss')
                .then(function(account) {
                    if (!account) throw new Error('account missing');
                    req.account = account;
                });
        });
    };

    /**
     * req.load_system() verifies that the request auth has a valid system
     * and sets req.system and req.role.
     * it implicitly calls load_account.
     *
     * @param <Object|Array> options, if array assumed is array of roles, if object:
     *      - <Array> roles acceptable roles
     *      - <Boolean> allow_missing don't fail if there is no system in req.auth
     *      - <Boolean> cache_miss bypass the cache
     */
    req.load_system = function(options) {
        if (_.isArray(options)) {
            options = {
                roles: options
            };
        } else {
            options = options || {};
        }

        return req.load_account(options).then(function() {

            // check if already loaded
            if (req.system) return;

            // check that auth contains system
            if (!req.auth || !req.auth.system_id) {
                if (options.allow_missing) return;
                throw req.rest_error('unauthorized system', 401);
            }

            // check that auth contains valid role

            if (!is_role_valid(req, options.roles)) {
                if (options.allow_missing) return;
                throw req.rest_error('forbidden role', 403);
            }

            // use a cache because this is called on every authorized api
            return db.SystemCache.get(req.auth.system_id, options.cache_miss && 'cache_miss')
                .then(function(system) {
                    if (!system) throw new Error('system missing');
                    req.system = system;
                    req.role = req.auth.role;
                });
        });
    };
}

function is_role_valid(req, roles) {
    if (req.account && req.account.is_support) {
        // allow support accounts to work on any system
        return true;
    } else if (!roles) {
        return !!req.auth.role;
    } else {
        return _.contains(roles, req.auth.role);
    }
}
