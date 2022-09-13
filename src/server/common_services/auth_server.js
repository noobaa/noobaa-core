/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const bcrypt = require('bcrypt');
const ip_module = require('ip');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const { RpcError } = require('../../rpc');
const net_utils = require('../../util/net_utils');
const system_store = require('../system_services/system_store').get_instance();
const signature_utils = require('../../util/signature_utils');
const server_rpc = require('../server_rpc');
const SensitiveString = require('../../util/sensitive_string');
const oauth_utils = require('../../util/oauth_utils');
const addr_utils = require('../../util/addr_utils');
const kube_utils = require('../../util/kube_utils');
const jwt_utils = require('../../util/jwt_utils');
const config = require('../../../config');
const s3_utils = require('../../endpoint/s3/s3_utils');


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
            if (!target_account) {
                dbg.log0('credentials account not found', email, system_name);
                throw new RpcError('UNAUTHORIZED', 'credentials not found');
            }

            // when password is not provided it means we want to give authorization
            // by the currently authorized to another specific account instead of
            // using credentials.
            if (!password) return;

            return P.resolve()
                .then(() => bcrypt.compare(password.unwrap(), target_account.password.unwrap()))
                .then(match => {
                    if (!match) {
                        dbg.log0('password mismatch', email, system_name);
                        throw new RpcError('UNAUTHORIZED', 'credentials not found');
                    }
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
                    dbg.log0('no account_id in auth and no credentials', email, system_name);
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
                    // From some reason, which I couldn't find, system store is
                    // missing roles_by_account from time to time.
                    String(system.owner._id) === String(authenticated_account._id) ||
                    // system admin can do anything
                    _.includes(roles, 'admin') ||
                    // operator can do anything
                    _.includes(roles, 'operator') ||
                    // non admin is not allowed to delegate roles to other accounts
                    (role_name && _.includes(roles, role_name) &&
                        String(target_account._id) === String(authenticated_account._id))) {
                    // "system admin" can use any role
                    role_name = role_name || 'admin';
                } else {
                    throw new RpcError('UNAUTHORIZED', 'account role not allowed');
                }
            }

            const token = make_auth_token({
                account_id: target_account._id,
                system_id: system && system._id,
                role: role_name,
                extra: req.rpc_params.extra,
                expiry: req.rpc_params.expiry,
            });

            const info = _get_auth_info(
                target_account,
                system,
                'noobaa',
                role_name,
                req.rpc_params.extra,
            );

            return { token, info };
        });
}

/**
 *
 * CREATE_K8S_AUTH
 *
 * authenticate a user using a k8s OAuth server then match that
 * user with a equivalent NooBaa user (or create a new one if one does not exists)
 * and return an authorized token for that user.
 *
 */
async function create_k8s_auth(req) {
    const { grant_code } = req.rpc_params;

    // Currently I have no means to get the system name in the FE without an email and password.
    // So i default to the first (and currently only system)
    let system = system_store.data.systems[0];
    if (!system || system.deleted) {
        throw new RpcError('UNAUTHORIZED', 'system not found');
    }

    const {
        KUBERNETES_SERVICE_HOST,
        KUBERNETES_SERVICE_PORT,
        OAUTH_TOKEN_ENDPOINT,
        NOOBAA_SERVICE_ACCOUNT,
        DEV_MODE,
        HTTPS_PORT = 5443
    } = process.env;

    if (!KUBERNETES_SERVICE_HOST || !KUBERNETES_SERVICE_PORT) {
        throw new RpcError('UNAUTHORIZED', 'Authentication using oauth is supported only on kubernetes deployments');
    }

    if (!OAUTH_TOKEN_ENDPOINT || !NOOBAA_SERVICE_ACCOUNT) {
        throw new RpcError('UNAUTHORIZED', 'Authentication using oauth is not supported');
    }

    let redirect_host;
    if (DEV_MODE === 'true') {
        redirect_host = `https://localhost:${HTTPS_PORT}`;

    } else {
        const { system_address } = system;
        redirect_host = addr_utils.get_base_address(system_address, {
            hint: 'EXTERNAL',
            protocol: 'https'
        }).toString();
    }

    const sa_token = await kube_utils.read_sa_token(unauthorized_error);
    const kube_namespace = await kube_utils.read_namespace(unauthorized_error);
    const oauth_client = `system:serviceaccount:${kube_namespace}:${NOOBAA_SERVICE_ACCOUNT}`;
    const { access_token, expires_in } = await oauth_utils.trade_grant_code_for_access_token(
        OAUTH_TOKEN_ENDPOINT,
        oauth_client,
        sa_token,
        redirect_host,
        grant_code,
        unauthorized_error
    );

    const token_review = await oauth_utils.review_token(
        KUBERNETES_SERVICE_HOST,
        sa_token,
        access_token,
        KUBERNETES_SERVICE_PORT,
        unauthorized_error
    );

    const { username, groups = [] } = token_review.status.user;
    const { OAUTH_REQUIRED_GROUPS = [] } = config;
    if (
        OAUTH_REQUIRED_GROUPS.length > 0 &&
        groups.every(grp_name => !OAUTH_REQUIRED_GROUPS.includes(grp_name))
    ) {
        throw new RpcError('UNAUTHORIZED', `User must be a member of at least one of the following k8s groups: ${OAUTH_REQUIRED_GROUPS}`);
    }

    const user_info = {
        name: new SensitiveString(username),
        email: new SensitiveString(username),
    };

    let account = system_store.get_account_by_email(user_info.email);
    if (!account) {
        const owner_token = make_auth_token({
            account_id: system.owner._id,
            system_id: system._id,
            role: 'admin',
        });

        await server_rpc.client.account.create_external_user_account(
            user_info, { auth_token: owner_token }
        );
        account = system_store.get_account_by_email(user_info.email);
    }


    // For some reason in the case of a new account the account role cannot be found
    // using system.roles_by_account so I search for it directly on the roles collection.
    const is_admin = system_store.data.roles.some(r =>
        String(r.system._id) === String(system._id) &&
        String(r.account._id) === String(account._id) &&
        r.role === 'admin'
    );

    if (!is_admin) {
        throw new RpcError('UNAUTHORIZED', 'account does not have an admin role');
    }

    const authorized_by = 'k8s';
    const token = make_auth_token({
        account_id: account._id,
        system_id: system._id,
        expiry: Math.floor(expires_in * 1000),
        role: 'admin',
        authorized_by
    });

    const info = _get_auth_info(
        account,
        system,
        authorized_by,
        'admin',
        req.rpc_params.extra
    );

    return { token, info };
}

function unauthorized_error(reason) {
    return new RpcError('UNAUTHORIZED', reason);
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
        system_id: system._id,
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

    return _get_auth_info(
        req.account,
        req.system,
        req.auth.authorized_by,
        req.auth.role,
        req.auth.extra
    );
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
    // This check is only for to pass RPC tests
    if (req.method_api.auth !== false) {
        req.load_auth();
        if (req.auth) {
            req.check_auth();
        } else {
            req.check_anonymous();
        }
    }
}


function _authorize_jwt_token(req) {
    try {
        req.auth = jwt_utils.authorize_jwt_token(req.auth_token);
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
    const signature_secret = auth_token_obj.temp_secret_key || secret_key.unwrap();
    const signature = signature_utils.get_signature_from_auth_token(auth_token_obj, signature_secret);

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

    const options = req.method_api.auth || {};
    // when the account field in method_api.auth is missing
    // we consider as if account is implicitly not mandatory for the method.
    // this is because in many internal paths we do not have an account.
    // TODO reconsider if allow_missing_account should be explicit instead
    const allow_missing_account = !options.account;
    // for system in order to make it optional we require to pass explicit false.
    const allow_missing_system = (options.system === false);
    // for anonymous access operations
    const allow_anonymous_access = (options.anonymous === true);

    /**
     * req.load_auth() sets req.account, req.system and req.role.
     */
    req.load_auth = function() {
        if (req.auth) {
            if (req.auth.account_id) req.account = system_store.data.get_by_id(req.auth.account_id);
            if (req.auth.system_id) req.system = system_store.data.get_by_id(req.auth.system_id);
            req.role = req.auth.role;
        }
    };

    req.check_anonymous = function() {
        if (!allow_anonymous_access) throw new RpcError('UNAUTHORIZED', 'not anonymous method ' + (req.method_api.name));
        // Currently authorize anonymous with the system that we have
        // Notice that we only authorize if system doesn't exist
        // Since the anonymous methods can be called authenticated as well
        if (!req.system) req.system = system_store.data.systems[0];
    };

    /**
     * req.check_auth() verifies that the request auth has a valid account, system and role
     */
    req.check_auth = function() {
        dbg.log1('load_auth:', options, req.auth);
        // check that auth has account
        if (!req.account) {
            if (!allow_missing_account || req.auth.account_id) {
                throw new RpcError('UNAUTHORIZED', 'account not found ' + req.auth.account_id);
            }
        }

        // check that auth contains system
        if (!req.system) {
            if (!allow_missing_system || req.auth.system_id) {
                throw new RpcError('UNAUTHORIZED', 'system not found ' + req.auth.system_id);
            }
        }

        // check that auth contains valid system role or the account is support
        // We should not check for roles and accounts in anonymous access
        // if (req.system && req.account) {
        if (req.system) {
            let allowed_role;
            if ((req.account && req.account.is_support) || req.auth.role === 'operator') {
                allowed_role = true;
            } else if (typeof options.system === 'string') {
                allowed_role = options.system === req.auth.role;
            } else if (Array.isArray(options.system)) {
                allowed_role = _.includes(options.system, req.auth.role);
            } else {
                allowed_role = allow_missing_system;
            }

            if (!allowed_role) {
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

        dbg.log3('load auth system:', req.system && req.system._id);
    };

    req.has_bucket_anonymous_permission = function(bucket, action, bucket_path) {
        return has_bucket_anonymous_permission(bucket, action, bucket_path);
    };

    req.has_s3_bucket_permission = function(bucket, action, bucket_path) {
        // Since this method can be called both authorized and unauthorized
        // We need to check the anonymous permission only when the bucket is configured to server anonymous requests
        // In case of anonymous function but with authentication flow we roll back to previous code and not return here
        if (req.auth_token && typeof req.auth_token === 'object') {
            return req.has_bucket_action_permission(bucket, action, bucket_path);
        }
        // If we came with a NooBaa management token then we've already checked the method permissions prior to this function
        // There is nothing specific to bucket permissions for the management credentials
        // So we allow bucket access to any valid auth token
        if (req.auth && req.system && req.account) {
            return true;
        }

        if (options.anonymous === true) {
            return req.has_bucket_anonymous_permission(bucket, action, bucket_path);
        }

        return false;
    };

    req.check_bucket_action_permission = function(bucket, action, bucket_path) {
        if (!has_bucket_action_permission(bucket, req.account, action, bucket_path)) {
            throw new RpcError('UNAUTHORIZED', 'No permission to access bucket');
        }
    };

    req.has_bucket_action_permission = function(bucket, action, bucket_path) {
        return has_bucket_action_permission(bucket, req.account, action, bucket_path);
    };
}

function _get_auth_info(account, system, authorized_by, role, extra) {
    const response = { authorized_by, role, extra };

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

/**
 * has_bucket_action_permission returns true if the requesting account has permission to perform
 * the given action on the given bucket.
 * 
 * The evaluation takes into account
 *  @TODO: System owner as a construct needs to be removed 
 *  - system owner must be able to access all buckets 
 *  - the bucket's owner account
 *  - the bucket claim owner
 *  - the bucket policy
 * @param {Record<string, any>} bucket requested bucket bucket
 * @param {Record<string, any>} account requesting account
 * @param {string} action s3 bucket action (lowercased only)
 * @param {string} bucket_path s3 bucket path (must start from "/")
 * @returns {boolean} true if the account has permission to perform the action on the bucket
 */
function has_bucket_action_permission(bucket, account, action, bucket_path = "") {
    dbg.log0('has_bucket_action_permission:', bucket.name, account.email, bucket.owner_account.email);

    // If the system owner account wants to access the bucket, allow it
    if (bucket.system.owner.email.unwrap() === account.email.unwrap()) return true;

    const is_owner = (bucket.owner_account.email.unwrap() === account.email.unwrap()) ||
        (account.bucket_claim_owner && account.bucket_claim_owner.name.unwrap() === bucket.name.unwrap());
    const bucket_policy = bucket.s3_policy;

    if (!bucket_policy) return is_owner;
    if (!action) {
        throw new Error('has_bucket_action_permission: action is required');
    }

    const result = s3_utils.has_bucket_policy_permission(
        bucket_policy,
        account.email.unwrap(),
        action,
        `arn:aws:s3:::${bucket.name.unwrap()}${bucket_path}`,
    );

    if (result === 'DENY') return false;
    return is_owner || result === 'ALLOW';
}

/**
 * has_bucket_anonymous_permission returns true if the bucket is configured to serve anonymous requests
 * and the action is allowed by the bucket policy.
 * @param {Record<string, any>} bucket bucket
 * @param {string} action s3 action (lowercased)
 * @param {string} bucket_path bucket path
 * @returns {boolean} true if the bucket is configured to serve anonymous requests
 */
function has_bucket_anonymous_permission(bucket, action, bucket_path = "") {
    const bucket_policy = bucket.s3_policy;
    if (!bucket_policy) return false;
    return s3_utils.has_bucket_policy_permission(
        bucket_policy,
        // Account is anonymous
        undefined,
        action || `s3:getobject`,
        `arn:aws:s3:::${bucket.name.unwrap()}${bucket_path}`,
    ) === 'ALLOW';
}

/**
 *
 * make_auth_token
 *
 * make jwt token (json web token) used for authorization.
 *
 * @param {Object} options
 *      - account_id
 *      - system_id
 *      - role
 *      - extra
 *      - expiry
 * @return <String> token
 */
function make_auth_token(options) {
    var auth = _.pick(options, 'account_id', 'system_id', 'role', 'extra', 'authorized_by');
    auth.authorized_by = auth.authorized_by || 'noobaa';

    // don't incude keys if value is falsy, to minimize the token size
    auth = _.omitBy(auth, value => !value);

    // set expiry if provided
    var jwt_options = {};
    if (options.expiry) {
        jwt_options.expiresIn = options.expiry;
    }
    // create and return the signed token
    return jwt_utils.make_auth_token(auth, jwt_options);
}


// EXPORTS
exports.create_auth = create_auth;
exports.read_auth = read_auth;
exports.create_k8s_auth = create_k8s_auth;
exports.create_access_key_auth = create_access_key_auth;
// authorize is exported to be used as an express middleware
// it reads and prepares the authorized info on the request (req.auth).
exports.authorize = authorize;
exports.make_auth_token = make_auth_token;
exports.has_bucket_action_permission = has_bucket_action_permission;
exports.has_bucket_anonymous_permission = has_bucket_anonymous_permission;
