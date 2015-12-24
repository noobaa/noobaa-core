// this module is written for both nodejs.
'use strict';

var _ = require('lodash');
var P = require('../util/promise');
var db = require('./db');
var jwt = require('jsonwebtoken');
var dbg = require('../util/debug_module')(__filename);
var s3_auth = require('aws-sdk/lib/signers/s3');
var s3 = new s3_auth();

/**
 *
 * AUTH_SERVER
 *
 */
var auth_server = {

    create_auth: create_auth,
    read_auth: read_auth,
    create_access_key_auth: create_access_key_auth,

    /**
     * authorize is exported to be used as an express middleware
     * it reads and prepares the authorized info on the request (req.auth).
     */
    authorize: authorize
};

module.exports = auth_server;



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

    var email = req.rpc_params.email;
    var password = req.rpc_params.password;
    var system_name = req.rpc_params.system;
    var role_name = req.rpc_params.role;
    // var expiry = req.rpc_params.expiry;
    var authenticated_account;
    var account;
    var system;

    return P.fcall(function() {

        // if email is not provided we skip finding account by email
        // and use the current auth account as the authenticated_account
        if (!email) return;

        // find account by email
        return db.Account
            .findOne({
                email: email,
                deleted: null,
            })
            .exec()
            .then(function(account_arg) {

                // consider email not found the same as bad password to avoid phishing attacks.
                account = account_arg;
                if (!account) throw req.unauthorized('credentials account not found');

                // when password is not provided it means we want to give authorization
                // by the currently authorized to another specific account instead of
                // using credentials.
                if (!password) return;

                // use bcrypt to verify password
                return P.npost(account, 'verify_password', [password])
                    .then(function(match) {
                        if (!match) throw req.unauthorized('password mismatch');
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
        if (!req.auth || !req.auth.account_id) {
            throw req.unauthorized('no account_id in auth and no credetials');
        }
        return db.Account
            .findById(req.auth.account_id)
            .exec()
            .then(function(account_arg) {
                account = account || account_arg;
                authenticated_account = authenticated_account || account_arg;
            });

    }).then(function() {

        // check the accounts are valid
        if (!authenticated_account || authenticated_account.deleted) {
            throw req.unauthorized('authenticated account not found');
        }
        if (!account || account.deleted) throw req.unauthorized('account not found');

        // system is optional, and will not be included in the token if not provided
        if (!system_name) return;

        // find system by name
        return db.System
            .findOne({
                name: system_name,
                deleted: null,
            })
            .exec()
            .then(function(system_arg) {

                system = system_arg;
                if (!system || system.deleted) throw req.unauthorized('system not found');

                // now we need to approve the role.
                // "support accounts" or "system owners" can use any role the ask for.
                if (authenticated_account.is_support ||
                    String(system.owner) === String(authenticated_account.id)) {
                    role_name = role_name || 'admin';
                    return;
                }

                // find the role of authenticated_account and system
                return db.Role
                    .findOne({
                        account: authenticated_account.id,
                        system: system.id,
                    })
                    .exec()
                    .then(function(role) {

                        if (!role) throw req.unauthorized('account has no role in system');

                        // "system admin" can use any role
                        if (role.role === 'admin') {
                            role_name = role_name || 'admin';
                            return;
                        }

                        // non admin is not allowed to delegate to other accounts
                        // and only allowed to use its formal role
                        if (String(account.id) === String(authenticated_account.id) ||
                            role_name !== role.role) {
                            throw req.unauthorized('non admin cannot delegate');
                        }
                    });
            });

    }).then(function() {

        var token = req.make_auth_token({
            account_id: account.id,
            system_id: system && system.id,
            role: role_name,
            extra: req.rpc_params.extra,
        });

        return {
            token: token
        };
    });
}


/**
 *
 * CREATE_ACCESS_KEY_AUTH
 *
 * Access and Secret key authentication.
 *
 * We use it to authenticate requests from S3 REST server and Agents.
 *
 * S3 REST requests
 *
 * The authorization header or query params includes the access key and
 * a signature.The signature uses the secret key and a string that includes
 * part of the request headers (string_to_sign).
 * The REST server forwards this authorization information to the web server.
 * The Server simply validate (by signing the string_to_sign and comparing
 * to the provided signature).
 * This allows us to avoid saving access key and secret key on the s3 rest.
 * It also allows s3 rest server to serve more than one system.
 *
 * Agent
 *
 * The agent sends authorization information, we identify the system and
 * returns token that will be used from now on (exactly like we used it before)
 *
 */
function create_access_key_auth(req) {

    var access_key = req.rpc_params.access_key;
    var string_to_sign = req.rpc_params.string_to_sign;
    var signature = req.rpc_params.signature;
    // var expiry = req.rpc_params.expiry;
    var system;

    dbg.log0('create_access_key_auth', access_key, string_to_sign, signature);

    return P.fcall(function() {

        // find system by name
        return db.System.findOne({
                "access_keys": {
                    $elemMatch: {
                        "access_key": access_key
                    }
                }
            })
            .exec()
            .then(function(system_arg) {
                system = system_arg;
                if (!system || system.deleted) {
                    throw req.unauthorized('system not found');
                }
                dbg.log0('system.access_keys', system && system.access_keys);

                var secret_key = _.result(_.find(system._doc.access_keys, 'access_key', access_key), 'secret_key');
                var s3_signature = s3.sign(secret_key, string_to_sign);
                dbg.log0('signature for access key:', access_key, 'string:', string_to_sign, ' is', s3_signature);

                //TODO:bring back ASAP!!!! - temporary for V4 "Support"
                //
                // if (signature === s3_signature) {
                //     dbg.log0('s3 authentication test passed!!!');
                // } else {
                //     throw req.unauthorized('SignatureDoesNotMatch');
                // }

                var token = req.make_auth_token({
                    system_id: system && system.id,
                    role: 'admin',
                    extra: req.rpc_params.extra,
                });
                console.log('ACCESS TOKEN:', token);
                return {
                    token: token
                };
            });
    });
}



/**
 *
 * READ_AUTH
 *
 */
function read_auth(req) {
    if (!req.auth) {
        return {};
    }

    var reply = _.pick(req.auth, 'role', 'extra');
    if (req.account) {
        reply.account = _.pick(req.account, 'name', 'email');
        if (req.account.is_support) {
            reply.account.is_support = true;
        }
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
 * rpc authorizer to parse and verify the auth token
 * and assign the info in req.auth.
 *
 */
function authorize(req) {

    _prepare_auth_request(req);
    var auth_token_obj;

    if (req.auth_token) {
        try {
            var auth_token;
            if (req.auth_token.indexOf('auth_token') > 0) {
                auth_token_obj = JSON.parse(req.auth_token);
                auth_token = auth_token_obj.auth_token;
            } else {
                auth_token = req.auth_token;
            }
            req.auth = jwt.verify(auth_token, process.env.JWT_SECRET);
        } catch (err) {
            dbg.error('AUTH JWT VERIFY FAILED', req, err);
            throw {
                statusCode: 401,
                data: 'unauthorized'
            };
        }
    }

    if (req.method_api.auth !== false) {
        dbg.log3('authorize:', req.method_api.auth, req.srv);

        return req.load_auth(req.method_api.auth)
            .then(function() {
                //if request request has access signature, validate the signature
                if (auth_token_obj) {
                    var secret_key = _.result(_.find(req.system._doc.access_keys, 'access_key', auth_token_obj.access_key), 'secret_key');
                    var s3_signature = s3.sign(secret_key, auth_token_obj.string_to_sign);

                    //TODO:bring back ASAP!!!! - temporary for V4 "Support"

                    // if (auth_token_obj.signature === s3_signature) {
                    //     dbg.log3('Access key authentication (per request) test passed !!!');
                    // } else {
                    //     dbg.error('Signature for access key:', auth_token_obj.access_key, 'computed:', s3_signature, 'expected:', auth_token_obj.signature);
                    //     throw req.unauthorized('SignatureDoesNotMatch');
                    // }
                }
            });
    }
}



/**
 *
 * _prepare_auth_request()
 *
 * set utility functions on the request to be able to use in other api's.
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

        return P.fcall(function() {
            dbg.log3('options:', options, req.auth);
            // check that auth has account_id
            var ignore_missing_account = (options.account === false || _.isEmpty(options.account));
            if (!req.auth || !req.auth.account_id) {
                if (ignore_missing_account) {
                    return;
                } else {
                    throw req.unauthorized('no account_id in auth');
                }
            }

            // use a cache because this is called on every authorized api
            return db.AccountCache.get(req.auth.account_id)
                .then(function(account) {
                    if (!account) {
                        if (ignore_missing_account) {
                            return;
                        } else {
                            throw req.unauthorized('auth account not found in cache');
                        }
                    }
                    req.account = account;
                });

        }).then(function() {

            // check that auth contains system
            var ignore_missing_system = (options.system === false || _.isEmpty(options.system));
            if (!req.auth || !req.auth.system_id) {
                if (ignore_missing_system) {
                    return;
                } else {
                    throw req.unauthorized('no system_id in auth');
                }
            }

            // check that auth contains valid system role

            if (!ignore_missing_system && !_.contains(options.system, req.auth.role)) {
                throw req.unauthorized('system role not allowed');
            }

            // use a cache because this is called on every authorized api
            return db.SystemCache.get(req.auth.system_id)
                .then(function(system) {
                    if (!system) {
                        if (ignore_missing_system) {
                            return;
                        } else {
                            throw req.unauthorized('auth system not found in cache');
                        }
                    }
                    req.system = system;
                    req.role = req.auth.role;
                    dbg.log3('load auth system:', req.system);
                });
        });
    };


    /**
     *
     * req.make_auth_token()
     *
     * make jwt token (json web token) used for authorization.
     *
     * @param <Object> options:
     *      - account_id
     *      - system_id
     *      - role
     *      - extra
     *      - expiry
     * @return <String> token
     */
    req.make_auth_token = function(options) {
        var auth = _.pick(options, 'account_id', 'system_id', 'role', 'extra');

        // don't incude keys if value is falsy, to minimize the token size
        auth = _.omit(auth, function(value) {
            return !value;
        });

        // set expiry if provided
        var jwt_options = {};
        if (options.expiry) {
            jwt_options.expiresInMinutes = options.expiry / 60;
        }
        // create and return the signed token
        return jwt.sign(auth, process.env.JWT_SECRET, jwt_options);
    };


    /**
     *
     * req.unauthorized()
     *
     * the auth server uses only unauthorized error to all auth failures
     * without sending an explicit message, only server is logging the reason,
     * to prevent phishing attacks.
     *
     */
    req.unauthorized = function(reason) {
        return req.rpc_error('UNAUTHORIZED', null, reason);
    };


    /**
     *
     * req.forbidden()
     *
     * reply that the request is not permitted.
     *
     */
    req.forbidden = function(reason) {
        return req.rpc_error('FORBIDDEN', null, reason);
    };

}




// UTILS //////////////////////////////////////////////////////////
