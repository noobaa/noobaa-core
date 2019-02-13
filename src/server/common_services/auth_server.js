/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const ip_module = require('ip');


const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const { RpcError } = require('../../rpc');
const net_utils = require('../../util/net_utils');
const system_store = require('../system_services/system_store').get_instance();
const signature_utils = require('../../util/signature_utils');


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
    var target_account;
    var system;

    return P.resolve()
        .then(() => {

            // if email is not provided we skip finding target_account by email
            // and use the current auth account as the authenticated_account
            if (!email) return;

            // consider email not found the same as bad password to avoid phishing attacks.
            target_account = system_store.get_account_by_email(email);
            dbg.log0('credentials account not found', email, system_name);
            if (!target_account) throw new RpcError('UNAUTHORIZED', 'credentials not found');

            // when password is not provided it means we want to give authorization
            // by the currently authorized to another specific account instead of
            // using credentials.
            if (!password) return;

            return P.resolve()
                .then(() => bcrypt.compare(password.unwrap(), target_account.password.unwrap()))
                .then(match => {
                    dbg.log0('password mismatch', email, system_name);
                    if (!match) throw new RpcError('UNAUTHORIZED', 'credentials not found');
                    // authentication passed!
                    // so this account is the authenticated_account
                    authenticated_account = target_account;
                });
        })
        .then(() => {

            // if both accounts were resolved (they can be the same account),
            // then we can skip loading the current authorized account
            if (!authenticated_account || !target_account) {
                // find the current authorized account and assign
                if (!req.auth || !req.auth.account_id) {
                    dbg.log0('no account_id in auth and no credetials', email, system_name);
                    throw new RpcError('UNAUTHORIZED', 'credentials not found');
                }

                var account_arg = system_store.data.get_by_id(req.auth.account_id);
                target_account = target_account || account_arg;
                authenticated_account = authenticated_account || account_arg;

            }

            // check the accounts are valid
            if (!authenticated_account || authenticated_account.deleted) {
                dbg.log0('authenticated account not found', email, system_name);
                throw new RpcError('UNAUTHORIZED', 'credentials not found');
            }
            if (!target_account || target_account.deleted) {
                dbg.log0('target account not found', email, system_name);
                throw new RpcError('UNAUTHORIZED', 'credentials not found');
            }

            // system is optional, and will not be included in the token if not provided
            if (system_name) {

                // find system by name
                system = system_store.data.systems_by_name[system_name];
                if (!system || system.deleted) throw new RpcError('UNAUTHORIZED', 'system not found');

                // find the role of authenticated_account in the system
                var roles = system.roles_by_account &&
                    system.roles_by_account[authenticated_account._id];

                // now approve the role -
                if (
                    // support account  can do anything
                    authenticated_account.is_support ||
                    // system owner can do anything
                    String(system.owner) === String(authenticated_account._id) ||
                    // From some reason, which I couldn't find, system store is
                    // missing roles_by_account from time to time.
                    // In addition, it's not clear why do we need the line above,
                    // as system.owner is an object. I left it for case, I may not
                    //see right now.
                    String(system.owner._id) === String(authenticated_account._id) ||
                    // system admin can do anything
                    _.includes(roles, 'admin') ||
                    // non admin is not allowed to delegate roles to other accounts
                    (role_name && _.includes(roles, role_name) &&
                        String(target_account._id) === String(authenticated_account._id))) {
                    // "system admin" can use any role
                    role_name = role_name || 'admin';
                } else {
                    throw new RpcError('UNAUTHORIZED', 'account role not allowed');
                }
            }

            let token = make_auth_token({
                account_id: target_account._id,
                system_id: system && system._id,
                role: role_name,
                extra: req.rpc_params.extra,
            });

            let info = _get_auth_info(target_account, system, role_name, req.rpc_params.extra);

            return {
                token: token,
                info: info
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
    var access_key = req.rpc_params.access_key.unwrap();
    var string_to_sign = req.rpc_params.string_to_sign;
    var signature = req.rpc_params.signature;

    if (_.isUndefined(string_to_sign) || _.isUndefined(signature)) {
        throw new RpcError('UNAUTHORIZED', 'signature error');
    }

    var account = _.find(system_store.data.accounts, function(acc) {
        if (acc.access_keys) {
            return acc.access_keys[0].access_key.unwrap().toString() === access_key.toString();
        } else {
            return false;
        }
    });

    if (!account || account.deleted) {
        throw new RpcError('UNAUTHORIZED', 'account not found');
    }

    let secret = account.access_keys[0].secret_key.unwrap().toString();
    let signature_test = signature_utils.get_signature_from_auth_token({ string_to_sign: string_to_sign }, secret);
    if (signature_test !== signature) {
        throw new RpcError('UNAUTHORIZED', 'signature error');
    }


    dbg.log0('create_access_key_auth:',
        'account.name', account.email,
        'access_key', access_key,
        'string_to_sign', string_to_sign,
        'signature', signature);

    var role = _.find(system_store.data.roles, function(r) {
        return r.account._id.toString() === account._id.toString();
    });

    if (!role || role.deleted) {
        throw new RpcError('UNAUTHORIZED', 'role not found');
    }

    var system = role.system;

    if (!system) {
        throw new RpcError('UNAUTHORIZED', 'system not found');
    }

    var auth_extra;
    if (req.rpc_params.extra) {
        auth_extra = req.rpc_params.extra;
        auth_extra.signature = req.rpc_params.signature;
        auth_extra.string_to_sign = req.rpc_params.string_to_sign;
    } else {
        auth_extra = {
            signature: req.rpc_params.signature,
            string_to_sign: req.rpc_params.string_to_sign
        };
    }

    var token = make_auth_token({
        system_id: system && system._id,
        account_id: account._id,
        role: 'admin',
        s3_auth: auth_extra,
    });
    dbg.log0('ACCESS TOKEN:', token);
    return {
        token: token
    };
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

    return _get_auth_info(req.account, req.system, req.auth.role, req.auth.extra);
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
    if (req.auth_token) {
        if (typeof req.auth_token === 'object') {
            _authorize_signature_token(req);
        } else {
            _authorize_jwt_token(req);
        }
    }
    if (req.method_api.auth !== false) {
        req.load_auth();
    }
}


function _authorize_jwt_token(req) {
    try {
        req.auth = jwt.verify(req.auth_token, process.env.JWT_SECRET);
    } catch (err) {
        dbg.error('AUTH JWT VERIFY FAILED', req, err);
        throw new RpcError('UNAUTHORIZED', 'verify auth failed');
    }
}


function _authorize_signature_token(req) {
    const auth_token_obj = req.auth_token;

    const account = _.find(system_store.data.accounts, function(acc) {
        return acc.access_keys &&
            acc.access_keys[0].access_key.unwrap() ===
            auth_token_obj.access_key;
    });
    if (!account || account.deleted) {
        throw new RpcError('UNAUTHORIZED', 'account not found');
    }
    const secret_key = account.access_keys[0].secret_key;

    const role = _.find(system_store.data.roles, function(r) {
        return r.account._id.toString() === account._id.toString();
    });
    if (!role || role.deleted) {
        throw new RpcError('UNAUTHORIZED', 'role not found');
    }

    const system = role.system;
    if (!system) {
        throw new RpcError('UNAUTHORIZED', 'system not found');
    }

    req.auth = {
        system_id: system._id,
        account_id: account._id,
        role: role.role,
        client_ip: auth_token_obj.client_ip,
    };

    const signature = signature_utils.get_signature_from_auth_token(auth_token_obj, secret_key.unwrap());

    if (auth_token_obj.signature !== signature) {
        dbg.error('Signature for access key:', auth_token_obj.access_key,
            'expected:', signature,
            'received:', auth_token_obj.signature);
        throw new RpcError('UNAUTHORIZED', 'SignatureDoesNotMatch');
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
    req.load_auth = function() {
        const options = this.method_api.auth || {};

        dbg.log1('load_auth:', options, req.auth);
        if (req.auth) {
            req.account = system_store.data.get_by_id(req.auth.account_id);
            req.system = system_store.data.get_by_id(req.auth.system_id);
            req.role = req.auth.role;
        }

        // when the account field in method_api.auth is missing
        // we consider as if account is implicitly not mandatory for the method.
        // this is because in many internal paths we do not have an account.
        // TODO reconsider if ignore_missing_account should be explicit instead
        const ignore_missing_account = !options.account;
        // for system in order to make it optional we require to pass explicit false.
        const ignore_missing_system = (options.system === false);

        // check that auth has account
        if (!ignore_missing_account || (req.auth && req.auth.account_id)) {
            if (!req.account) {
                throw new RpcError('UNAUTHORIZED', 'account not found ' + (req.auth && req.auth.account_id));
            }
        }

        // check that auth contains system
        if (!ignore_missing_system || (req.auth && req.auth.system_id)) {
            if (!req.system) {
                throw new RpcError('UNAUTHORIZED', 'system not found ' + (req.auth && req.auth.system_id));
            }
        }

        // check that auth contains valid system role or the account is support
        if (!ignore_missing_system) {
            if (!(req.account && req.account.is_support) &&
                !_.includes(options.system, req.auth.role)) {
                dbg.warn('role not allowed in system', options, req.auth, req.account, req.system);
                throw new RpcError('UNAUTHORIZED', 'role not allowed in system');
            }
        }

        // check ip restrictions on the account
        if (req.account && req.account.allowed_ips) {
            const client_ip = net_utils.unwrap_ipv6(req.auth.client_ip);
            if (client_ip) {
                let is_allowed = false;
                const client_ip_val = ip_module.toLong(client_ip);
                for (const ip_range of req.account.allowed_ips) {
                    const start = ip_module.toLong(ip_range.start);
                    const end = ip_module.toLong(ip_range.end);
                    if (client_ip_val >= start && client_ip_val <= end) {
                        is_allowed = true;
                        break;
                    }
                }
                if (!is_allowed) {
                    throw new RpcError('UNAUTHORIZED', 'Client IP not allowed ' + client_ip);
                }
            }
        }
        dbg.log3('load auth system:', req.system);
    };

    req.has_bucket_permission = function(bucket) {
        return has_bucket_permission(bucket, req.account);
    };

    req.check_bucket_permission = function(bucket) {
        if (!req.has_bucket_permission(bucket)) {
            throw new RpcError('UNAUTHORIZED', 'No permission to access bucket');
        }
    };

    req.has_s3_bucket_permission = function(bucket) {

        /*if (req.role === 'admin' || account.is_support) {
            return true;
        }*/

        // If the token includes S3 data, then we check for permissions
        if (req.auth_token && typeof req.auth_token === 'object') {
            return req.has_bucket_permission(bucket);
        } else {
            return true;
        }
    };

    req.check_s3_bucket_permission = function(bucket) {
        if (!req.has_s3_bucket_permission(bucket)) {
            throw new RpcError('UNAUTHORIZED', 'No permission to access bucket');
        }
    };

}

function _get_auth_info(account, system, role, extra) {
    let response = {
        role: role,
        extra: extra
    };

    if (account) {
        response.account = _.pick(account, 'name', 'email');
        if (account.is_support) {
            response.account.is_support = true;
        }

        let next_password_change = account.next_password_change;
        if (next_password_change && next_password_change < Date.now()) {
            response.account.must_change_password = true;
        }
    }

    if (system) {
        response.system = _.pick(system, 'name');
    }

    return response;
}

function has_bucket_permission(bucket, account) {
    return _.get(account, 'allowed_buckets.full_permission', false) ||
        _.find(
            _.get(account, 'allowed_buckets.permission_list') || [],
            allowed_bucket => String(allowed_bucket._id) === String(bucket._id)
        );
}

/**
 *
 * make_auth_token
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
function make_auth_token(options) {
    var auth = _.pick(options, 'account_id', 'system_id', 'role', 'extra');

    // don't incude keys if value is falsy, to minimize the token size
    auth = _.omitBy(auth, value => !value);

    // set expiry if provided
    var jwt_options = {};
    if (options.expiry) {
        jwt_options.expiresIn = options.expiry;
    }
    // create and return the signed token
    return jwt.sign(auth, process.env.JWT_SECRET, jwt_options);
}


// EXPORTS
exports.create_auth = create_auth;
exports.read_auth = read_auth;
exports.create_access_key_auth = create_access_key_auth;
// authorize is exported to be used as an express middleware
// it reads and prepares the authorized info on the request (req.auth).
exports.authorize = authorize;
exports.make_auth_token = make_auth_token;
exports.has_bucket_permission = has_bucket_permission;
