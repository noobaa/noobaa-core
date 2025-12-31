/* Copyright (C) 2025 NooBaa */
'use strict';

const dbg = require('../../util/debug_module')(__filename);
const VectorError = require('./vector_errors').VectorError;
const js_utils = require('../../util/js_utils');
const http_utils = require('../../util/http_utils');
const signature_utils = require('../../util/signature_utils');

const VECTOR_MAX_BODY_LEN = 4 * 1024 * 1024; //TODO - validate

const RPC_ERRORS_TO_VECTOR = Object.freeze({ //TODO - validate
    SIGNATURE_DOES_NOT_MATCH: VectorError.AccessDeniedException,
    UNAUTHORIZED: VectorError.AccessDeniedException,
    INVALID_ACCESS_KEY_ID: VectorError.InvalidClientTokenId,
    DEACTIVATED_ACCESS_KEY_ID: VectorError.InvalidClientTokenIdInactiveAccessKey,
    NO_SUCH_ACCOUNT: VectorError.AccessDeniedException,
    NO_SUCH_ROLE: VectorError.AccessDeniedException,
    VALIDATION_ERROR: VectorError.ValidationError,
    /*INVALID_INPUT: VectorError.InvalidInput,
    MALFORMED_POLICY_DOCUMENT: VectorError.MalformedPolicyDocument,
    ENTITY_ALREADY_EXISTS: VectorError.EntityAlreadyExists,
    NO_SUCH_ENTITY: VectorError.NoSuchEntity,
    CONCURRENT_MODIFICATION: VectorError.ConcurrentModification,
    LIMIT_EXCEEDED: VectorError.LimitExceeded,
    SERVICE_FAILURE: VectorError.ServiceFailure,
    DELETE_CONFLICT: VectorError.DeleteConflict,
    ENTITY_TEMPORARILY_UNMODIFIABLE: VectorError.EntityTemporarilyUnmodifiable,*/
    INVALID_PARAMETER_VALUE: VectorError.InvalidParameterValue,
    EXPIRED_TOKEN: VectorError.ExpiredToken,
    ACCESS_DENIED_EXCEPTION: VectorError.AccessDeniedException,
    NOT_AUTHORIZED: VectorError.NotAuthorized,
    INTERNAL_FAILURE: VectorError.InternalFailure,
});

const VECTOR_OPS = js_utils.deep_freeze({
    CreateVectorBucket: require('./ops/vector_bucket_create'),
    DeleteVectorBucket: require('./ops/vector_bucket_delete'),
    PutVectors: require('./ops/vector_put_vectors'),
    ListVectors: require('./ops/vector_list_vectors'),
    QueryVectors: require('./ops/vector_query_vectors'),
    ListVectorBuckets: require('./ops/vector_list_vector_buckets'),
    DeleteVectors: require('./ops/vector_delete_vectors'),
});

async function vector_rest(req, res) {
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
        ErrorClass: VectorError,
        error_invalid_argument: VectorError.InvalidParameterValue,
        error_access_denied: VectorError.AccessDeniedException,
        error_bad_request: VectorError.InternalFailure,
        error_invalid_digest: VectorError.InternalFailure,
        error_request_time_too_skewed: VectorError.InternalFailure,
        error_missing_content_length: VectorError.InternalFailure,
        error_invalid_token: VectorError.InvalidClientTokenId,
        error_token_expired: VectorError.ExpiredToken,
        auth_token: () => signature_utils.make_auth_token_from_request(req)
    };
    http_utils.check_headers(req, headers_options);

    const options = {
        body: {
            type: 'json',
            optional: false
        },
        reply: {type: 'json'},
        MAX_BODY_LEN: VECTOR_MAX_BODY_LEN,
        ErrorClass: VectorError,
        error_max_body_len_exceeded: VectorError.InternalFailure,
        error_missing_body: VectorError.InternalFailure,
        error_invalid_body: VectorError.InternalFailure,
        error_body_sha256_mismatch: VectorError.InternalFailure,
    };
    await http_utils.read_and_parse_body(req, options);

    const op_name = req.originalUrl.startsWith('/') ? req.originalUrl.substring(1) : req.originalUrl;
    const op = VECTOR_OPS[op_name];
    if (!op || !op.handler) {
        dbg.error('Vector (NotImplemented)', op_name, req.method, req.originalUrl);
        throw new VectorError(VectorError.NotImplemented);
    }
    req.op_name = op_name;

    http_utils.authorize_session_token(req, headers_options);
    authenticate_request(req);
    await authorize_request(req);

    dbg.log1('VECTOR REQUEST', req.method, req.originalUrl, 'op', op_name, 'request_id', req.request_id, req.headers);

    const reply = await op.handler(req, res);
    http_utils.send_reply(req, res, reply, options);
}

function authenticate_request(req) {
    try {
        signature_utils.authenticate_request_by_service(req, req.account_sdk);
    } catch (err) {
        dbg.error('authenticate_request: ERROR', err.stack || err);
        if (err.code) {
            throw err;
        } else {
            throw new VectorError(VectorError.AccessDeniedException);
        }
    }
}

// authorize_request_account authorizes the account of the requester
async function authorize_request(req) {
    await req.account_sdk.load_requesting_account(req);
    req.account_sdk.authorize_request_account(req);
}

function handle_error(req, res, err) {
    const vector_err =
        ((err instanceof VectorError) && err) ||
        new VectorError(RPC_ERRORS_TO_VECTOR[err.rpc_code] || VectorError.InternalFailure);
    if (!req.object_sdk.nsfs_config_root) {
        vector_err.message = err.message;
    }
    const reply = vector_err.reply(req.request_id);
    dbg.error('VECTOR ERROR', reply,
        req.method, req.originalUrl,
        JSON.stringify(req.headers),
        err.stack || err);
    if (res.headersSent) {
        dbg.log0('Sending error xml in body, but too late for headers...');
    } else {
        res.statusCode = vector_err.http_code;
        res.setHeader('Content-Type', 'text/xml'); // based on actual header seen in AWS CLI
        res.setHeader('Content-Length', Buffer.byteLength(reply));
    }
    res.end(reply);
}

// EXPORTS
module.exports = vector_rest;
