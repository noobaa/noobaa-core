/* Copyright (C) 2026 NooBaa */
'use strict';

const dbg = require('../../util/debug_module')(__filename);
const http_utils = require('../../util/http_utils');
const signature_utils = require('../../util/signature_utils');
const { S3Error } = require('../s3/s3_errors');
const { RpcError } = require('../../rpc');
const { irc_rest, handle_error: irc_handle_error } = require('./irc_rest');
const { s3tables_rest, handle_error: s3tables_handle_error } = require('./s3tables_rest');

const IRC_PATH_PREFIXES = Object.freeze(['/iceberg/v1', '/v1']);

/**
 * is_irc_path returns true if the request path belongs to the IRC facade:
 * `/iceberg/v1/...` and `/v1/...`. A prefix only matches on a path segment
 * boundary, so `/v10` or `/v1x` go to the S3Tables facade.
 * @param {string} url request url, query string optional
 * @returns {boolean}
 */
function is_irc_path(url) {
    const query_pos = url.indexOf('?');
    const path = query_pos < 0 ? url : url.slice(0, query_pos);
    return IRC_PATH_PREFIXES.some(prefix =>
        path === prefix || path.startsWith(prefix + '/'));
}

/**
 * tables_rest is the entry point of the TABLES listener. It authenticates every request with
 * SigV4 (signing name `s3tables`) and routes by path: IRC protocol to the IRC facade, everything
 * else to the S3Tables facade. The facade is resolved up front so an authentication failure is
 * rendered in that protocol's own error shape - both facades authenticate identically (§3.6).
 * @param {import('http').IncomingMessage & NodeJS.Dict} req
 * @param {import('http').ServerResponse} res
 */
async function tables_rest(req, res) {
    const irc = is_irc_path(req.url);
    try {
        await handle_request(req, res, irc);
    } catch (err) {
        const handle_error = irc ? irc_handle_error : s3tables_handle_error;
        handle_error(req, res, err);
    }
}

/**
 * @param {import('http').IncomingMessage & NodeJS.Dict} req
 * @param {import('http').ServerResponse} res
 * @param {boolean} irc whether the request routes to the IRC facade
 */
async function handle_request(req, res, irc) {
    http_utils.set_amz_headers(req, res);

    if (req.method === 'OPTIONS') {
        dbg.log1('OPTIONS!');
        res.statusCode = 200;
        res.end();
        return;
    }

    // Header validation and SigV4 parsing raise S3Error specs, which carry { code, message,
    // http_code }. Reusing the S3 specs keeps the TABLES listener resolving the caller exactly the
    // way the S3 endpoint does (§3.6); the facade renderers turn whatever is thrown into the right
    // protocol shape.
    const headers_options = {
        ErrorClass: S3Error,
        error_invalid_argument: S3Error.InvalidArgument,
        error_access_denied: S3Error.AccessDenied,
        error_bad_request: S3Error.BadRequest,
        error_invalid_digest: S3Error.InvalidDigest,
        error_request_time_too_skewed: S3Error.RequestTimeTooSkewed,
        error_missing_content_length: S3Error.MissingContentLength,
        error_invalid_token: S3Error.InvalidToken,
        error_token_expired: S3Error.ExpiredToken,
        auth_token: () => parse_auth_token(req),
    };
    http_utils.check_headers(req, headers_options);
    http_utils.authorize_session_token(req, headers_options);

    authenticate_request(req);
    await req.object_sdk.load_requesting_account(req);
    // Verifies the SigV4 signature against the resolved account's secret key. No bucket is addressed
    // yet, so this performs signature verification only; per-operation s3tables: authorization
    // arrives with the facades (stories 10, 13, 15).
    await req.object_sdk.authorize_request_account(req);

    dbg.log1('TABLES REQUEST', req.method, req.originalUrl, 'request_id', req.request_id);

    // The facades are skeletons until later stories; both answer with a not-implemented error.
    return irc ? irc_rest(req, res) : s3tables_rest(req, res);
}

/**
 * parse_auth_token parses the request's SigV4 credentials. SigV4 header parsing throws bare Errors
 * (e.g. the `Mismatching date` Error make_auth_token_from_request throws) that AWS answers with 403.
 * Normalize those to AccessDenied here, at the signature-parsing source, so error_details can treat
 * its catch-all as a 500 server error without masking these known authentication failures as 500.
 * S3Error and coded errors already carry an http_code and pass through unchanged.
 * @param {import('http').IncomingMessage & NodeJS.Dict} req
 */
function parse_auth_token(req) {
    try {
        return signature_utils.make_auth_token_from_request(req);
    } catch (err) {
        if (err instanceof S3Error || err.rpc_code || err.code) throw err;
        dbg.warn('parse_auth_token: normalizing codeless signature error to AccessDenied', err.stack || err);
        throw new S3Error(S3Error.AccessDenied);
    }
}

/**
 * authenticate_request authenticates the caller with SigV4 (signing name `s3tables`), resolving
 * them the same way the S3 endpoint does. No OAuth and no anonymous access (§3.6).
 * @param {import('http').IncomingMessage & NodeJS.Dict} req
 */
function authenticate_request(req) {
    try {
        signature_utils.authenticate_request_by_service(req, req.object_sdk);
        // No anonymous access: authenticate_request_by_service sets the parsed token on the sdk
        // (undefined for an unsigned request), so reject anonymous without re-parsing.
        const auth_token = req.object_sdk.get_auth_token();
        if (!auth_token) {
            throw new RpcError('UNAUTHORIZED', 'Anonymous access is not supported on the S3 Tables endpoint');
        }
        if (auth_token.extra?.service !== 's3tables') {
            throw new RpcError('UNAUTHORIZED', 'Only SigV4 requests signed for the s3tables service are accepted');
        }
    } catch (err) {
        dbg.error('authenticate_request: ERROR', err.stack || err);
        if (err.rpc_code || err.code) throw err;
        throw new RpcError('UNAUTHORIZED', 'Access Denied');
    }
}

// EXPORTS
exports.tables_rest = tables_rest;
exports.is_irc_path = is_irc_path;
