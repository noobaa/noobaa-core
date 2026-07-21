/* Copyright (C) 2016 NooBaa */
'use strict';


const dbg = require('../../util/debug_module')(__filename);
const StsError = require('./sts_errors').StsError;
const js_utils = require('../../util/js_utils');
const http_utils = require('../../util/http_utils');
const signature_utils = require('../../util/signature_utils');
const system_store = require('../../server/system_services/system_store').get_instance();
const { is_nc_environment } = require('../../nc/nc_utils');
const access_policy_utils = require('../../util/access_policy_utils');
const { resolve_iam_role_by_arn } = require('../iam/iam_utils');

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
            const web_identity_info = access_policy_utils.fetch_web_identity_info(req);
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

    // Build the account identifier array (email + ARN + account id) for Principal.AWS matching.
    const account = req.sts_sdk.requesting_account;
    const account_arr = [];
    if (account) {
        account_arr.push(account.email.unwrap());
        account_arr.push(access_policy_utils.get_policy_principal_arn(account));
        account_arr.push(account._id.toString());
    }

    const permission = await access_policy_utils.has_access_policy_permission(
        assume_role_policy,
        account_arr,
        method,
        undefined,
        req,
        {
            is_trust_policy: true,
        }
    );
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

/**
 * get_assume_role_policy retrieves the assume role policy document
 * @param {Object} req - Request object
 * @returns {Promise<Object>} - Assume role policy document
 */
async function get_assume_role_policy(req) {
    // TODO: Get the iam_role from cache
    const resolved_role = await resolve_iam_role_by_arn(req.body.role_arn);
    return resolved_role.iam_role?.assume_role_policy_document;
}


// EXPORTS
module.exports = sts_rest;
module.exports.OP_NAME_TO_ACTION = OP_NAME_TO_ACTION;
