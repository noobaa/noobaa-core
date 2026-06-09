/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const jwt = require('jsonwebtoken');

const dbg = require('../../util/debug_module')(__filename);
const StsError = require('./sts_errors').StsError;
const js_utils = require('../../util/js_utils');
const http_utils = require('../../util/http_utils');
const signature_utils = require('../../util/signature_utils');
const system_store = require('../../server/system_services/system_store').get_instance();
const { is_nc_environment } = require('../../nc/nc_utils');
const access_policy_utils = require('../../util/access_policy_utils');

const STS_MAX_BODY_LEN = 4 * 1024 * 1024;

const STS_XML_ROOT_ATTRS = Object.freeze({
    xmlns: 'http://sts.amazonaws.com/doc/2011-06-15/'
});

const RPC_ERRORS_TO_STS = Object.freeze({
    SIGNATURE_DOES_NOT_MATCH: StsError.AccessDeniedException,
    UNAUTHORIZED: StsError.AccessDeniedException,
    INVALID_ACCESS_KEY_ID: StsError.AccessDeniedException,
    DEACTIVATED_ACCESS_KEY_ID: StsError.AccessDeniedException,
    NO_SUCH_ACCOUNT: StsError.AccessDeniedException,
    NO_SUCH_ROLE: StsError.AccessDeniedException,
    ACCESS_DENIED: StsError.AccessDeniedException,
});

const ACTIONS = Object.freeze({
    'AssumeRole': 'assume_role',
    'AssumeRoleWithWebIdentity': 'assume_role_with_web_identity',
});

const OP_NAME_TO_ACTION = Object.freeze({
    post_assume_role: 'sts:AssumeRole',
    post_assume_role_with_web_identity: 'sts:AssumeRoleWithWebIdentity',
});

const STS_OPS = js_utils.deep_freeze({
    post_assume_role: require('./ops/sts_post_assume_role'),
    post_assume_role_with_web_identity: require('./ops/sts_post_assume_role_with_web_identity'),
});


async function sts_rest(req, res) {
    try {
        await handle_request(req, res);
    } catch (err) {
        handle_error(req, res, err);
    }
}

async function handle_request(req, res) {

    http_utils.set_amz_headers(req, res);
    http_utils.set_cors_headers_sts(req, res);

    if (req.method === 'OPTIONS') {
        dbg.log1('OPTIONS!');
        res.statusCode = 200;
        res.end();
        return;
    }

    const headers_options = {
        ErrorClass: StsError,
        error_invalid_argument: StsError.InvalidParameterValue,
        error_access_denied: StsError.AccessDeniedException,
        error_bad_request: StsError.InternalFailure,
        error_invalid_digest: StsError.InternalFailure,
        error_request_time_too_skewed: StsError.InternalFailure,
        error_missing_content_length: StsError.InternalFailure,
        error_invalid_token: StsError.InvalidClientTokenId,
        error_token_expired: StsError.ExpiredToken,
        auth_token: () => signature_utils.make_auth_token_from_request(req)
    };
    http_utils.check_headers(req, headers_options);

    const options = {
        body: { type: req.headers['content-type'] },
        MAX_BODY_LEN: STS_MAX_BODY_LEN,
        XML_ROOT_ATTRS: STS_XML_ROOT_ATTRS,
        ErrorClass: StsError,
        error_max_body_len_exceeded: StsError.InternalFailure,
        error_missing_body: StsError.InternalFailure,
        error_invalid_body: StsError.InternalFailure,
        error_body_sha256_mismatch: StsError.InternalFailure,
    };
    await http_utils.read_and_parse_body(req, options);

    const op_name = parse_op_name(req, req.body.action);
    const op = STS_OPS[op_name];
    if (!op || !op.handler) {
        dbg.error('STS NotImplemented', op_name, req.method, req.originalUrl);
        throw new StsError(StsError.NotImplemented);
    }
    req.op_name = op_name;

    http_utils.authorize_session_token(req, headers_options);
    await authenticate_request(req);
    await authorize_request(req);

    dbg.log1('STS REQUEST', req.method, req.originalUrl, 'op', op_name, 'request_id', req.request_id, req.headers);

    const reply = await op.handler(req, res);
    http_utils.send_reply(req, res, reply, {
        ...options,
        body: op.body,
        reply: op.reply
    });
}

async function authenticate_request(req) {
    try {
        signature_utils.authenticate_request_by_service(req, req.sts_sdk);
        if (req.op_name === 'post_assume_role_with_web_identity') {
            const web_identity_info = fetch_web_identity_info(req);
            const is_ldap_request = web_identity_info.username;
            if (is_ldap_request) {
                // fetch LDAP identity info
                req.sts_sdk.identity_info = await req.sts_sdk.authenticate_web_identity(req);
            }
        }
    } catch (err) {
        dbg.error('authenticate_request: ERROR', err.stack || err);
        if (err.code) {
            throw err;
        } else if (err.rpc_code) {
            throw err;
        } else {
            throw new StsError(StsError.AccessDeniedException);
        }
    }
}

// authorize_request_account authorizes the account of the requeser
// authorize_request_policy checks that the requester is allowed to assume a role 
// by the role's assume role policy permissions
async function authorize_request(req) {
    await req.sts_sdk.load_requesting_account(req);
    req.sts_sdk.authorize_request_account(req);
    await authorize_request_policy(req);
}

async function authorize_request_policy(req) {
    if (req.op_name !== 'post_assume_role' && req.op_name !== 'post_assume_role_with_web_identity') return;

    const assume_role_policy = await get_assume_role_policy(req);
    if (!assume_role_policy) throw new StsError(StsError.AccessDeniedException);
    const method = _get_method_from_req(req);
    const cur_account_email = req.sts_sdk.requesting_account && req.sts_sdk.requesting_account.email.unwrap();
    // system owner by design can always assume role policy of any account
    // skip for NC environments since system owner is not applicable
    if (!is_nc_environment() && (cur_account_email === _get_system_owner().unwrap()) && req.op_name.endsWith('assume_role')) return;
    const web_identity_info = fetch_web_identity_info(req);
    const permission = has_assume_role_permission(assume_role_policy, method, req.sts_sdk.requesting_account, web_identity_info);
    dbg.log0('sts_rest.authorize_request_policy permission is: ', permission);
    if (permission === 'DENY' || permission === 'IMPLICIT_DENY') {
        throw new StsError(StsError.AccessDeniedException);
    }
    // permission is ALLOW, can return without error
}

function _get_system_owner() {
    const system = system_store.data && system_store.data.systems && system_store.data.systems[0];
    if (!system) return null;
    return system.owner.email;
}

function _get_method_from_req(req) {
    const sts_op = OP_NAME_TO_ACTION[req.op_name];
    if (!sts_op) {
        dbg.error(`Got a not supported STS op ${req.op_name} - doesn't suppose to happen`);
        throw new StsError(StsError.InternalFailure);
    }
    return sts_op;
}

function parse_op_name(req, action) {
    const method = req.method.toLowerCase();
    if (ACTIONS[action]) {
        return `${method}_${ACTIONS[action]}`;
    }
    dbg.error('STS parse_op_name - NotImplemented', action, method, req.originalUrl);
    throw new StsError(StsError.NotImplemented);
}

function handle_error(req, res, err) {
    let stserr;
    if (err instanceof StsError) {
        stserr = err;
    } else if (err.rpc_code === 'INVALID_WEB_IDENTITY_TOKEN') {
        stserr = new StsError({ ...StsError.InvalidIdentityToken, message: err.message });
    } else if (err.rpc_code === 'EXPIRED_WEB_IDENTITY_TOKEN') {
        stserr = new StsError(StsError.ExpiredToken);
    } else {
        stserr = new StsError(RPC_ERRORS_TO_STS[err.rpc_code] || StsError.InternalFailure);
    }

    const reply = stserr.reply(req.originalUrl, req.request_id);
    dbg.error('STS ERROR', reply,
        req.method, req.originalUrl,
        JSON.stringify(req.headers),
        err.stack || err);
    if (res.headersSent) {
        dbg.log0('Sending error xml in body, but too late for headers...');
    } else {
        res.statusCode = stserr.http_code;
        res.setHeader('Content-Type', 'application/xml');
        res.setHeader('Content-Length', Buffer.byteLength(reply));
    }
    res.end(reply);
}

function has_assume_role_permission(policy, method, account, web_identity_info) {
    const [allow_statements, deny_statements] = _.partition(policy.Statement, statement => statement.Effect === 'Allow');
    // look for explicit denies
    if (_is_statements_fit(deny_statements, method, account, web_identity_info)) return 'DENY';
    // look for explicit allows
    if (_is_statements_fit(allow_statements, method, account, web_identity_info)) return 'ALLOW';

    // implicit deny
    return 'IMPLICIT_DENY';
}

function _is_statements_fit(statements, method, account, web_identity_info) {
    for (const statement of statements) {
        let action_fit = false;
        let principal_fit = false;
        dbg.log0('assume_role_policy: statement', statement);

        // what action can be done

        action_fit = _is_action_fit(method, statement);
        dbg.log0('assume_role_policy: action fit?', action_fit);

        principal_fit = _is_principal_fit(statement, account, web_identity_info);
        dbg.log0('assume_role_policy: principal fit?', principal_fit);

        const condition_fit = _is_condition_fit(statement.Condition, web_identity_info);
        dbg.log0('assume_role_policy: condition fit?', condition_fit);

        dbg.log0('assume_role_policy: is_statements_fit', action_fit, principal_fit, condition_fit);
        if (action_fit && principal_fit && condition_fit) return true;
    }
    return false;
}

/**
 * _is_principal_fit checks if the statement can be applied to the account
 * @param {Object | Array} statement - The condition(s) from the policy statement
 * @param {Object} account - The account to validate against
 * @param {Object} web_identity_info - The web identity information to validate against
 * @returns {boolean} - true if all principle are satisfied, false otherwise
 */
function _is_principal_fit(statement, account, web_identity_info) {
    const statement_principal = statement.Principal || statement.NotPrincipal;

        let principal_fit = false;
        if (statement_principal.Federated) {
            for (const federated of _.flatten([statement_principal.Federated])) {
                const federated_url = typeof federated === 'string' ? federated : federated.unwrap();
                dbg.log0('assume_role_policy: principal federated fit?', federated_url, web_identity_info.iss);
                if (federated_url.split("oidc-provider/")[1] === web_identity_info.iss?.split('//')[1]) {
                    principal_fit = true;
                }
            }
        }

        if (statement_principal.AWS) {
            for (const principal_aws of _.flatten([statement_principal.AWS])) {
                const principal = typeof principal_aws === 'string' ? principal_aws : principal_aws.unwrap();
                const cur_account_email = account?.email.unwrap();
                // Added ARN to principle validation
                const account_identifier_arn = account ? access_policy_utils.get_bucket_policy_principal_arn(account) : "";
                dbg.log0('assume_role_policy: principal fit?', principal, cur_account_email, account_identifier_arn);
                if ((principal === cur_account_email) || (principal === '*') || (principal === account_identifier_arn)) {
                    principal_fit = true;
                }
            }
        }

    return statement.Principal ? principal_fit : !principal_fit;
}


/**
 * _is_action_fit checks if the method is allowed by the statement
 * @param {String} method - The account to validate against
 * @param {Object|Array} statement - The condition(s) from the policy statement
 * @returns {boolean} - true if all method are satisfied, false otherwise
 */
function _is_action_fit(method, statement) {
    const statement_action = statement.Action || statement.NotAction;
    let action_fit = false;
    for (const action of _.flatten([statement_action])) {
        dbg.log1('access_policy: ', statement.Action ? 'Action' : 'NotAction', ' fit?', action, method);
        if (action === method || access_policy_utils._is_wildcard_match(action, method)) {
            action_fit = true;
            break;
        }
    }
    return statement.Action ? action_fit : !action_fit;
}


/**
 * _is_condition_fit checks if the statement conditions match the web identity info
 * @param {Object|Array} statement_condition - The condition(s) from the policy statement
 * @param {Object} web_identity_info - The web identity information to validate against
 * @returns {boolean} - true if all conditions are satisfied, false otherwise
 */
function _is_condition_fit(statement_condition, web_identity_info) {
    if (!statement_condition) return true;

    let statement_conditions = statement_condition;
    // if the condition is an object, wrap it in an array
    if (!Array.isArray(statement_condition)) {
        statement_conditions = [statement_condition];
    }
    const is_keycloak_request = web_identity_info.iss;
    for (const condition of statement_conditions) {
        const condition_fit = access_policy_utils._is_identity_condition_fit(is_keycloak_request, condition, web_identity_info);
        if (!condition_fit) {
            return false;
        }
    }
    return true;
}

/**
 * fetch web identity object from request web_identity_token param
 * @param {Object} req - Request object
 * @returns {Object} - web_identity_info
 */
function fetch_web_identity_info(req) {
    let web_identity_info;
    if (req.body.web_identity_token) {
        web_identity_info = jwt.decode(req.body.web_identity_token, { json: true });
    }
    return web_identity_info || {};
}

/**
 * get_assume_role_policy retrieves the assume role policy document
 * @param {Object} req - Request object
 * @returns {Promise<Object>} - Assume role policy document
 */
async function get_assume_role_policy(req) {
    const role_arn = req.body.role_arn;
    const role_name = role_arn.slice(role_arn.lastIndexOf('/') + 1);
    // TODO: Get the iam_role from cache
    const iam_role = _.find(system_store.data.iam_roles || [], role => {
        if (role.deleted) return false;
        return role.name === role_name;
    });
    return iam_role?.assume_role_policy_document;
}


// EXPORTS
module.exports = sts_rest;
module.exports.OP_NAME_TO_ACTION = OP_NAME_TO_ACTION;
