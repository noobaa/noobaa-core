/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const dbg = require('../../util/debug_module')(__filename);
const StsError = require('./sts_errors').StsError;
const js_utils = require('../../util/js_utils');
const http_utils = require('../../util/http_utils');
const signature_utils = require('../../util/signature_utils');
const system_store = require('../../server/system_services/system_store').get_instance();

const STS_MAX_BODY_LEN = 4 * 1024 * 1024;

const STS_XML_ROOT_ATTRS = Object.freeze({
    xmlns: 'http://sts.amazonaws.com/doc/2011-06-15/'
});

const RPC_ERRORS_TO_STS = Object.freeze({
    SIGNATURE_DOES_NOT_MATCH: StsError.AccessDeniedException,
    UNAUTHORIZED: StsError.AccessDeniedException,
    INVALID_ACCESS_KEY_ID: StsError.AccessDeniedException,
    NO_SUCH_ACCOUNT: StsError.AccessDeniedException,
    NO_SUCH_ROLE: StsError.AccessDeniedException
});

const ACTIONS = Object.freeze({
    'AssumeRole': 'assume_role'
});

const OP_NAME_TO_ACTION = Object.freeze({
    post_assume_role: 'sts:AssumeRole',
});

const STS_OPS = load_ops();

async function sts_rest(req, res) {
    try {
        await handle_request(req, res);
    } catch (err) {
        handle_error(req, res, err);
    }
}

async function handle_request(req, res) {

    http_utils.set_response_headers(req, res, { expose_headers: 'ETag' });

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
    req.op_name = op_name;

    http_utils.authorize_session_token(req, headers_options);
    authenticate_request(req);
    await authorize_request(req);

    dbg.log1('STS REQUEST', req.method, req.originalUrl, 'op', op_name, 'request_id', req.request_id, req.headers);

    const op = STS_OPS[op_name];
    if (!op || !op.handler) {
        dbg.error('STS TODO (NotImplemented)', op_name, req.method, req.originalUrl);
        throw new StsError(StsError.NotImplemented);
    }

    const reply = await op.handler(req, res);
    http_utils.send_reply(req, res, reply, {
        ...options,
        body: op.body,
        reply: op.reply
    });
}

function authenticate_request(req) {
    try {
        const auth_token = signature_utils.make_auth_token_from_request(req);
        if (auth_token) {
            auth_token.client_ip = http_utils.parse_client_ip(req);
        }
        if (req.session_token) {
            auth_token.access_key = req.session_token.assumed_role_access_key;
            auth_token.temp_access_key = req.session_token.access_key;
            auth_token.temp_secret_key = req.session_token.secret_key;
        }
        req.sts_sdk.set_auth_token(auth_token);
        signature_utils.check_request_expiry(req);
    } catch (err) {
        dbg.error('authenticate_request: ERROR', err.stack || err);
        if (err.code) {
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
    await req.sts_sdk.authorize_request_account(req);
    await authorize_request_policy(req);
}

async function authorize_request_policy(req) {
    if (req.op_name !== 'post_assume_role') return;
    const account_info = await req.sts_sdk.get_assumed_role(req);
    const assume_role_policy = account_info.role_config && account_info.role_config.assume_role_policy;
    if (!assume_role_policy) throw new StsError(StsError.AccessDeniedException);
    const method = _get_method_from_req(req);
    const cur_account_email = req.sts_sdk.requesting_account && req.sts_sdk.requesting_account.email.unwrap();
    // system owner by design can always assume role policy of any account
    if ((cur_account_email === _get_system_owner().unwrap()) && req.op_name.endsWith('assume_role')) return;

    const permission = has_assume_role_permission(assume_role_policy, method, cur_account_email);
    dbg.log0('sts_rest.authorize_request_policy permission is: ', permission);
    if (permission === 'DENY' || permission === 'IMPLICIT_DENY') {
        throw new StsError(StsError.AccessDeniedException);
    }
    // permission is ALLOW, can return without error
}

function _get_system_owner() {
    const system = system_store.data.systems[0];
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
    throw new StsError(StsError.NotImplemented);
}

function handle_error(req, res, err) {
    let stserr =
        ((err instanceof StsError) && err) ||
        new StsError(RPC_ERRORS_TO_STS[err.rpc_code] || StsError.InternalFailure);

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

function load_ops() {
    /* eslint-disable global-require */
    return js_utils.deep_freeze({
        post_assume_role: require('./ops/sts_post_assume_role'),
    });
}

function has_assume_role_permission(policy, method, cur_account_email) {
    const [allow_statements, deny_statements] = _.partition(policy.statement, statement => statement.effect === 'allow');

    // look for explicit denies
    if (_is_statements_fit(deny_statements, method, cur_account_email)) return 'DENY';

    // look for explicit allows
    if (_is_statements_fit(allow_statements, method, cur_account_email)) return 'ALLOW';

    // implicit deny
    return 'IMPLICIT_DENY';
}

function _is_statements_fit(statements, method, cur_account_email) {
    for (const statement of statements) {
        let action_fit = false;
        let principal_fit = false;
        dbg.log0('assume_role_policy: statement', statement);

        // what action can be done
        for (const action of statement.action) {
            dbg.log0('assume_role_policy: action fit?', action, method);
            if ((action === '*') || (action === 'sts:*') || (action === method)) {
                action_fit = true;
            }
        }
        // who can do that action
        for (const principal of statement.principal) {
            dbg.log0('assume_role_policy: principal fit?', principal.unwrap().toString(), cur_account_email);
            if (principal.unwrap() === cur_account_email) {
                principal_fit = true;
            }
        }
        dbg.log0('assume_role_policy: is_statements_fit', action_fit, principal_fit);
        if (action_fit && principal_fit) return true;
    }
    return false;
}

// EXPORTS
module.exports = sts_rest;
module.exports.OP_NAME_TO_ACTION = OP_NAME_TO_ACTION;
