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


/**
 *
 * AUTH SERVER (REST)
 *
 */
module.exports = new api.auth_api.Server({
    create_auth: create_auth,
    read_auth: read_auth,
});



/**
 * authorize is exported to be used as an express middleware
 * it reads and prepares the authorized info on the request (req.auth).
 */
module.exports.authorize = authorize;



/**
 *
 * CREATE_AUTH
 *
 * authenticate and return an authorized token.
 *
 * the simplest usage is to send email & password, which will be verified
 * to match the existing account, and will return an authorized token containing the account.
 *
 * another usage is to get a system authorization by passing system_name.
 * one option is to combine with email & password, and another is to call without
 * email and password but with existing authorization token which contains
 * a previously authenticated account.
 *
 */
function create_auth(req) {

    var email = req.rest_params.email;
    var password = req.rest_params.password;
    var system_name = req.rest_params.system;
    var role_name = req.rest_params.role;
    var expiry = req.rest_params.expiry;
    var authenticated_account;
    var account;
    var system;
    var role;

    return Q.fcall(function() {

        // if email is not provided we skip finding account by email
        // and use the current auth account as the authenticated_account
        if (!email) return;

        // find account by email
        return db.Account.findOne({
            email: email,
            deleted: null,
        }).exec().then(function(account_arg) {

            // consider email not found the same as bad password to avoid phishing attacks.
            account = account_arg;
            if (!account) throw req.unauthorized();

            // when password is not provided it means we want to give authorization
            // by the currently authorized to another specific account instead of
            // using credentials.
            if (!password) return;

            // use bcrypt to verify password
            return Q.npost(account, 'verify_password', [password])
                .then(function(match) {
                    if (!match) throw req.unauthorized();
                    // authentication passed!
                    // so this account is the authenticated_account
                    authenticated_account = account;
                });
        });

    }).then(function() {

        // if both accounts were resolved (they can be the same account),
        // then we can skip loading the current authorized account
        if (authenticated_account && account) return;

        // find the current authorized account and assign
        if (!req.auth.account_id) throw req.unauthorized();
        return db.Account.findById(req.auth.account_id).exec()
            .then(function(account_arg) {
                account = account || account_arg;
                authenticated_account = authenticated_account || account_arg;
            });

    }).then(function() {

        // check the accounts are valid
        if (!authenticated_account || authenticated_account.deleted) throw req.unauthorized();
        if (!account || account.deleted) throw req.unauthorized();

        // system is optional, and will not be included in the token if not provided
        if (!system_name) return;

        // find system by name
        return Q.when(db.System.findOne({
            name: system_name,
            deleted: null,
        }).exec()).then(function(system_arg) {

            system = system_arg;
            if (!system || system.deleted) throw req.unauthorized();

            // now we need to approve the role.
            // "support accounts" or "system owners" can use any role the ask for.
            if (authenticated_account.is_support ||
                String(system.owner) === String(authenticated_account.id)) {
                role_name = role_name || 'admin';
                return;
            }

            // find the role of authenticated_account and system
            return db.Role.findOne({
                account: authenticated_account.id,
                system: system.id,
            }).exec().then(function(role) {

                if (!role) throw req.unauthorized();

                // "system admin" can use any role
                if (role.role === 'admin') {
                    role_name = role_name || 'admin';
                    return;
                }

                // non admin is not allowed to delegate to other accounts
                // and only allowed to use its formal role
                if (String(account.id) === String(authenticated_account.id) ||
                    role_name !== role.role) {
                    throw req.unauthorized();
                }
            });
        });

    }).then(function() {

        // use jwt (json web token) to create a signed token
        var jwt_payload = {
            account_id: account.id
        };

        // add the system and role if provided
        if (system) {
            jwt_payload.system_id = system.id;
        }
        if (role_name) {
            jwt_payload.role = role_name;
        }

        // add extra info
        if (req.rest_params.extra) {
            jwt_payload.extra = req.rest_params.extra;
        }

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
 *
 * READ_AUTH
 *
 */
function read_auth(req) {
    if (!req.auth) return {};

    var reply = _.pick(req.auth, 'role', 'extra');
    if (req.account) {
        reply.account = _.pick(req.account, 'name', 'email');
    }
    if (req.system) {
        reply.system = _.pick(req.system, 'name');
    }
    return reply;
}




/**
 *
 * AUTHORIZE
 *
 * middleware for express to parse and verify the auth token
 * and assign the info in req.auth.
 *
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
        _prepare_auth_request(req);
        jwt_middleware(req, res, function(err) {
            // if the verification of the token failed it might be because of expiration
            // in any case return http code 401 (Unauthorized)
            // hoping the client will do authenticate() again.
            if (err && err.name === 'UnauthorizedError') {
                console.log('AUTH ERROR', err);
                res.status(401).send('unauthorized');
                return;
            }
            next(err);
        });
    };
}


/**
 *
 * _prepare_auth_request()
 *
 * on valid token, set utility functions on the request to be able to use in other api's.
 * see the function docs below.
 *
 */
function _prepare_auth_request(req) {

    /**
     *
     * req.load_auth()
     *
     * verifies that the request auth has a valid account and sets req.account.
     * verifies that the request auth has a valid system
     * and sets req.system and req.role.
     *
     * @param <Object> options:
     *      - <Boolean> account: if false don't fail if there is no account in req.auth
     *      - <Boolean> system: if false don't fail if there is no system in req.auth
     *      - <Array> roles: acceptable roles
     */
    req.load_auth = function(options) {
        options = options || {};

        return Q.fcall(function() {

            // check that auth has account_id
            var ignore_missing_account = (options.account === false);
            if (!req.auth || !req.auth.account_id) {
                if (!ignore_missing_account) throw req.unauthorized();
                return;
            }

            // use a cache because this is called on every authorized api
            return db.AccountCache.get(req.auth.account_id)
                .then(function(account) {
                    if (!account) throw req.unauthorized();
                    req.account = account;
                });

        }).then(function() {

            // check that auth contains system
            var ignore_missing_system = (options.system === false);
            if (!req.auth || !req.auth.system_id) {
                if (!ignore_missing_system) throw req.unauthorized();
                return;
            }

            // check that auth contains valid system role

            if (!ignore_missing_system && !_.contains(options.system, req.auth.role)) {
                throw req.unauthorized();
            }

            // use a cache because this is called on every authorized api
            return db.SystemCache.get(req.auth.system_id)
                .then(function(system) {
                    if (!system) throw new Error('system missing');
                    req.system = system;
                    req.role = req.auth.role;
                });
        });
    };


    /**
     *
     * req.make_auth_token()
     *
     * make auth token based on the existing auth with the given modifications.
     *
     * @param <Object> options:
     *      - system_id
     *      - role
     *      - extra
     *      - expiry
     * @return <String> token
     */
    req.make_auth_token = function(options) {
        var jwt_payload = _.pick(req.auth, 'account_id', 'system_id', 'role', 'extra');
        if (options.system_id) {
            jwt_payload.system_id = options.system_id;
        }
        if (options.role) {
            jwt_payload.role = options.role;
        }
        if (options.extra) {
            jwt_payload.extra = options.extra;
        }

        // set expiry if provided
        var jwt_options = {};
        if (options.expiry) jwt_options.expiresInMinutes = options.expiry / 60;

        // create and return the signed token
        return jwt.sign(jwt_payload, process.env.JWT_SECRET, jwt_options);
    };


    /**
     *
     * req.unauthorized()
     *
     * the auth server uses only 401-unauthorized error to all auth failures
     * to prevent phishing attacks.
     * TODO should auth server use 403-forbidden errors as well as 401-unauthorized?
     *
     */
    req.unauthorized = function() {
        return req.rest_error('unauthorized', 401);
    };


    /**
     *
     * req.forbidden()
     *
     * reply that the request is not permitted.
     *
     */
    req.forbidden = function() {
        return req.rest_error('forbidden', 403);
    };

}




// UTILS //////////////////////////////////////////////////////////
