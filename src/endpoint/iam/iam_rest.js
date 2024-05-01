/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../util/debug_module')(__filename);
const IamError = require('./iam_errors').IamError;
const js_utils = require('../../util/js_utils');
const http_utils = require('../../util/http_utils');
const signature_utils = require('../../util/signature_utils');

const IAM_MAX_BODY_LEN = 4 * 1024 * 1024;

const IAM_XML_ROOT_ATTRS = Object.freeze({
    xmlns: 'https://iam.amazonaws.com/doc/2010-05-08/'
});

const RPC_ERRORS_TO_IAM = Object.freeze({
    SIGNATURE_DOES_NOT_MATCH: IamError.AccessDeniedException,
    UNAUTHORIZED: IamError.AccessDeniedException,
    INVALID_ACCESS_KEY_ID: IamError.AccessDeniedException,
    NO_SUCH_ACCOUNT: IamError.AccessDeniedException,
    NO_SUCH_ROLE: IamError.AccessDeniedException
});

const ACTIONS = Object.freeze({
    'CreateUser': 'create_user',
    'GetUser': 'get_user',
    'UpdateUser': 'update_user',
    'DeleteUser': 'delete_user',
    'ListUsers': 'list_users',
    'CreateAccessKey': 'create_access_key',
    'GetAccessKeyLastUsed': 'get_access_key_last_used',
    'UpdateAccessKey': 'update_access_key',
    'DeleteAccessKey': 'delete_access_key',
    'ListAccessKeys': 'list_access_keys',
});

// notice: shows all methods as method post
const IAM_OPS = js_utils.deep_freeze({
    // user CRUD
    post_create_user: require('./ops/iam_create_user'),
    post_get_user: require('./ops/iam_get_user'),
    post_update_user: require('./ops/iam_update_user'),
    post_delete_user: require('./ops/iam_delete_user'),
    post_list_users: require('./ops/iam_list_users'),
    // access key CRUD
    post_create_access_key: require('./ops/iam_create_access_key'),
    post_get_access_key_last_used: require('./ops/iam_get_access_key'),
    post_update_access_key: require('./ops/iam_update_access_key'),
    post_delete_access_key: require('./ops/iam_delete_access_key'),
    post_list_access_keys: require('./ops/iam_list_access_keys'),
});

async function iam_rest(req, res) {
    try {
        await handle_request(req, res);
    } catch (err) {
        handle_error(req, res, err);
    }
}

async function handle_request(req, res) {

    http_utils.set_amz_headers(req, res);

    if (req.method === 'OPTIONS') {
        dbg.log1('OPTIONS!');
        res.statusCode = 200;
        res.end();
        return;
    }

    const headers_options = {
        ErrorClass: IamError,
        error_invalid_argument: IamError.InvalidParameterValue,
        error_access_denied: IamError.AccessDeniedException,
        error_bad_request: IamError.InternalFailure,
        error_invalid_digest: IamError.InternalFailure,
        error_request_time_too_skewed: IamError.InternalFailure,
        error_missing_content_length: IamError.InternalFailure,
        error_invalid_token: IamError.InvalidClientTokenId,
        error_token_expired: IamError.ExpiredToken,
        auth_token: () => signature_utils.make_auth_token_from_request(req)
    };
    http_utils.check_headers(req, headers_options);

    const options = {
        body: { type: req.headers['content-type'] },
        MAX_BODY_LEN: IAM_MAX_BODY_LEN,
        XML_ROOT_ATTRS: IAM_XML_ROOT_ATTRS,
        ErrorClass: IamError,
        error_max_body_len_exceeded: IamError.InternalFailure,
        error_missing_body: IamError.InternalFailure,
        error_invalid_body: IamError.InternalFailure,
        error_body_sha256_mismatch: IamError.InternalFailure,
    };
    verify_op_request_body_type(req);
    await http_utils.read_and_parse_body(req, options);

    const op_name = parse_op_name(req, req.body.action);
    req.op_name = op_name;

    http_utils.authorize_session_token(req, headers_options);
    authenticate_request(req);
    await authorize_request(req);

    dbg.log1('IAM REQUEST', req.method, req.originalUrl, 'op', op_name, 'request_id', req.request_id, req.headers);

    const op = IAM_OPS[op_name];
    if (!op || !op.handler) {
        dbg.error('IAM TODO (NotImplemented)', op_name, req.method, req.originalUrl);
        throw new IamError(IamError.NotImplemented);
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
        req.account_sdk.set_auth_token(auth_token);
        signature_utils.check_request_expiry(req);
    } catch (err) {
        dbg.error('authenticate_request: ERROR', err.stack || err);
        if (err.code) {
            throw err;
        } else {
            throw new IamError(IamError.AccessDeniedException);
        }
    }
}

// authorize_request_account authorizes the account of the requester
async function authorize_request(req) {
    await req.account_sdk.load_requesting_account(req);
    await req.account_sdk.authorize_request_account(req);
}

function parse_op_name(req, action) {
    const method = req.method.toLowerCase();
    if (ACTIONS[action]) {
        return `${method}_${ACTIONS[action]}`;
    }
    throw new IamError(IamError.NotImplemented);
}

function handle_error(req, res, err) {
    const iam_err =
        ((err instanceof IamError) && err) ||
        new IamError(RPC_ERRORS_TO_IAM[err.rpc_code] || IamError.InternalFailure);

    const reply = iam_err.reply(req.request_id);
    dbg.error('IAM ERROR', reply,
        req.method, req.originalUrl,
        JSON.stringify(req.headers),
        err.stack || err);
    if (res.headersSent) {
        dbg.log0('Sending error xml in body, but too late for headers...');
    } else {
        res.statusCode = iam_err.http_code;
        res.setHeader('Content-Type', 'text/xml'); // based on actual header seen in AWS CLI
        res.setHeader('Content-Length', Buffer.byteLength(reply));
    }
    res.end(reply);
}

// we only support request with specific type
function verify_op_request_body_type(req) {
    const headers = req.headers['content-type'];
    if (!headers.includes(http_utils.CONTENT_TYPE_APP_FORM_URLENCODED)) {
        dbg.error(`verify_op_request_body_type: should have header ${http_utils.CONTENT_TYPE_APP_FORM_URLENCODED}` +
            `in request, ${headers}`);
        // GAP - need to make sure which error we need to throw
        throw new IamError(IamError.InvalidParameterValue);
    }
}

// EXPORTS
module.exports = iam_rest;
