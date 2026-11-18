/* Copyright (C) 2026 NooBaa */
'use strict';

const dbg = require('../../util/debug_module')(__filename);
const { S3Error } = require('../s3/s3_errors');
const { RpcError } = require('../../rpc');

/**
 * RPC error codes raised while authenticating a request (resolving the caller and verifying the
 * SigV4 signature), mapped to a protocol-neutral { http_code, code, message }. Both facades share
 * the same signing name and authenticate identically (§3.6), so they share this table and render
 * the descriptor in their own shape. The full semantic error vocabulary of §7.3 arrives with the
 * facade stories (10, 13, 15).
 */
const AUTH_ERRORS = Object.freeze({
    SIGNATURE_DOES_NOT_MATCH: {
        http_code: 403,
        code: 'SignatureDoesNotMatch',
        message: 'The request signature we calculated does not match the signature you provided.',
    },
    UNAUTHORIZED: {
        http_code: 403,
        code: 'AccessDenied',
        message: 'Access Denied',
    },
    INVALID_ACCESS_KEY_ID: {
        http_code: 403,
        code: 'InvalidAccessKeyId',
        message: 'The access key Id you provided does not exist in our records.',
    },
    DEACTIVATED_ACCESS_KEY_ID: {
        http_code: 403,
        code: 'InvalidAccessKeyId',
        message: 'The access key Id you provided is inactive.',
    },
    NO_SUCH_ACCOUNT: {
        http_code: 403,
        code: 'AccessDenied',
        message: 'Access Denied',
    },
    NO_SUCH_ROLE: {
        http_code: 403,
        code: 'AccessDenied',
        message: 'Access Denied',
    },
    EXPIRED_TOKEN: {
        http_code: 403,
        code: 'ExpiredToken',
        message: 'The provided token has expired.',
    },
    INTERNAL_ERROR: {
        http_code: 500,
        code: 'InternalError',
        message: 'An internal error occurred, please try again.',
    },
});

// Fallback for a codeless error reaching a facade's handle_error. The outer catch also covers account
// loading and authorization, so an unexpected failure there is a server error, not a credential one -
// the catch-all is therefore InternalError (500). Known 403 authentication failures carry an explicit
// code before they reach here: SigV4 header parsing errors (e.g. the `Mismatching date` Error) are
// normalized to AccessDenied at their source in tables_rest.parse_auth_token. The stack is logged by
// the caller.
const DEFAULT_ERROR = AUTH_ERRORS.INTERNAL_ERROR;

/**
 * error_details normalizes a thrown error into the protocol-neutral descriptor both facades render.
 * @param {Error & NodeJS.Dict} err
 * @returns {{ http_code: number, code: string, message: string }}
 */
function error_details(err) {
    // check_headers and SigV4 header parsing raise S3Error, which already carries code/http_code.
    if (err instanceof S3Error) {
        return { http_code: err.http_code || 403, code: err.code, message: err.message };
    }
    if (err instanceof RpcError) {
        const mapped = AUTH_ERRORS[err.rpc_code];
        if (mapped) return mapped;
    }
    dbg.error('tables_utils.error_details: unexpected error', err && (err.stack || err));
    return DEFAULT_ERROR;
}

// EXPORTS
exports.AUTH_ERRORS = AUTH_ERRORS;
exports.error_details = error_details;
