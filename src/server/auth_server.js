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
    update_auth: update_auth,
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
    var password = req.rest_params.password;
    var account;

    return Q.fcall(function() {

        // find the account by email
        return db.Account.findOne({
            email: req.rest_params.email,
            deleted: null,
        }).exec();

    }).then(function(account_arg) {
        account = account_arg;

        // consider no account as non matching password
        // to avoid brute force attacks of requests on this api.
        if (!account) return false;

        // verify the password
        return Q.npost(account, 'verify_password', [password]);

    }).then(function(matching) {

        if (!matching) throw req.rest_error('incorrect email and password');

        // rest of the flow uses a func shared with update_auth()
        return _auth_by_account(req, account.id);
    });
}


/**
 * update_auth()
 */
function update_auth(req) {
    return req.load_account('force_miss').then(function() {
        return _auth_by_account(req, req.account.id);
    });
}


/**
 * _auth_by_account()
 */
function _auth_by_account(req, account_id) {
    var system_name = req.rest_params.system;
    var expires = req.rest_params.expires;
    var system;
    var role;
    return Q.fcall(function() {
        if (!system_name) return;

        // find system
        return db.System.findOne({
            name: system_name,
            deleted: null,
        }).exec().then(function(system_arg) {
            system = system_arg;
            if (!system || system.deleted) throw req.rest_error('system not found');

            // find the role of our account and system
            return db.Role.findOne({
                account: account_id,
                system: system.id,
            }).exec();
        }).then(function(role_arg) {
            role = role_arg;
            if (!role) throw req.rest_error('role not found');
        });

    }).then(function() {

        // use jwt (json web token) to create a signed token
        var jwt_payload = {
            account_id: account_id
        };

        // add the system and role if provided
        if (system_name) {
            jwt_payload.system_id = system.id;
            jwt_payload.role = role.role;
        }

        // set expiry if provided
        var jwt_options = {};
        if (expires) jwt_options.expiresInMinutes = expires / 60;

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

    var reply = {};
    if (req.auth.role) reply.role = req.auth.role;

    return Q.fcall(function() {

        if (!req.auth.account_id) return;

        return db.AccountCache.get(req.auth.account_id, 'force_miss')
            .then(function(account) {
                if (!account) return;
                reply.account = _.pick(account, 'name', 'email');
            });

    }).then(function() {

        if (!req.auth || !req.auth.system_id) return;

        return db.SystemCache.get(req.auth.system_id, 'force_miss')
            .then(function(system) {
                if (!system) return;
                reply.system = _.pick(system, 'name');
            });

    }).thenResolve(reply);
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
     * @param <String> force_miss bypass the cache by sending the literal string 'force_miss'.
     */
    req.load_account = function(force_miss) {
        return Q.fcall(function() {

            // check if already loaded
            if (req.account) return;

            // check that auth contains account
            if (!req.auth || !req.auth.account_id) throw req.rest_error('unauthorized', 401);

            // use a cache because this is called on every authorized api
            return db.AccountCache.get(req.auth.account_id, force_miss)
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
     * @param <Array> valid_roles array of acceptable roles
     * @param <String> force_miss bypass the cache by sending the literal string 'force_miss'.
     */
    req.load_system = function(valid_roles, force_miss) {
        return req.load_account().then(function() {

            // check if already loaded
            if (req.system) return;

            // check that auth contains system
            if (!req.auth || !req.auth.system_id) throw req.rest_error('unauthorized system', 401);

            // check that auth contains valid role
            if ((!valid_roles && !req.auth.role) ||
                (valid_roles && !_.contains(valid_roles, req.auth.role))) {
                throw req.rest_error('forbidden role', 403);
            }

            // use a cache because this is called on every authorized api
            return db.SystemCache.get(req.auth.system_id, force_miss)
                .then(function(system) {
                    if (!system) throw new Error('system missing');
                    req.system = system;
                    req.role = req.auth.role;
                });
        });
    };
}
