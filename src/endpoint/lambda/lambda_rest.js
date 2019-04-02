/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const js_utils = require('../../util/js_utils');
const time_utils = require('../../util/time_utils');
const http_utils = require('../../util/http_utils');
const LambdaError = require('./lambda_errors').LambdaError;
const signature_utils = require('../../util/signature_utils');

const LAMBDA_MAX_BODY_LEN = 4 * 1024 * 1024;

const RPC_ERRORS_TO_LAMBDA = Object.freeze({
    UNAUTHORIZED: LambdaError.AccessDenied,
    FORBIDDEN: LambdaError.AccessDenied,
    NO_SUCH_FUNC: LambdaError.ResourceNotFoundException,
    CONFLICT: LambdaError.ResourceConflictException,
});

const LAMBDA_OPS = load_ops();

function lambda_rest(req, res) {
    return P.try(() => handle_request(req, res))
        .catch(err => handle_error(req, res, err));
}

function handle_request(req, res) {
    // fill up standard amz response headers
    res.setHeader('x-amz-request-id', req.request_id);
    res.setHeader('x-amz-id-2', req.request_id);

    // note that browsers will not allow origin=* with credentials
    // but anyway we allow it by the agent server.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers',
        'Content-Type,Content-MD5,Authorization,X-Amz-User-Agent,X-Amz-Date,ETag,X-Amz-Content-Sha256');
    res.setHeader('Access-Control-Expose-Headers', 'ETag');

    if (req.method === 'OPTIONS') {
        dbg.log0('OPTIONS!');
        res.statusCode = 200;
        res.end();
        return;
    }

    // setting default headers which might get overriden by api's that
    // return actual data in the reply instead of json
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('ETag', '"1"');
    check_headers(req);
    authenticate_request(req);

    // resolve the op to call
    const op_name = parse_op_name(req);
    dbg.log0('LAMBDA REQUEST', req.method, req.originalUrl, 'op', op_name, 'request_id', req.request_id, req.headers);
    const op = LAMBDA_OPS[op_name];
    if (!op || !op.handler) {
        dbg.error('LAMBDA TODO (NotImplemented)', op_name, req.method, req.originalUrl);
        throw new LambdaError(LambdaError.NotImplemented);
    }

    const options = {
        body: op.body,
        reply: op.reply,
        MAX_BODY_LEN: LAMBDA_MAX_BODY_LEN,
        XML_ROOT_ATTRS: {},
        ErrorClass: LambdaError,
        error_max_body_len_exceeded: LambdaError.MaxMessageLengthExceeded,
        error_missing_body: LambdaError.MissingRequestBodyError,
        error_invalid_body: LambdaError.InvalidRequest,
        error_body_sha256_mismatch: LambdaError.XAmzContentSHA256Mismatch,
    };

    return P.resolve()
        .then(() => http_utils.read_and_parse_body(req, options))
        .then(() => op.handler(req, res))
        .then(reply => http_utils.send_reply(req, res, reply, options));
}

function check_headers(req, res) {
    _.each(req.headers, (val, key) => {
        // test for non printable characters
        // 403 is required for unreadable headers
        // eslint-disable-next-line no-control-regex
        if ((/[\x00-\x1F]/).test(val) || (/[\x00-\x1F]/).test(key)) {
            dbg.warn('Invalid header characters', key, val);
            if (key !== 'expect') {
                throw new LambdaError(LambdaError.AccessDenied);
            }
        }
    });

    if (req.headers['content-length'] === '') {
        throw new LambdaError(LambdaError.BadRequestWithoutCode);
    }

    const content_md5_b64 = req.headers['content-md5'];
    if (typeof content_md5_b64 === 'string') {
        req.content_md5 = Buffer.from(content_md5_b64, 'base64');
        if (req.content_md5.length !== 16) {
            throw new LambdaError(LambdaError.InvalidDigest);
        }
    }

    req.content_sha256_sig = req.headers['x-amz-content-sha256'];
    if (typeof req.content_sha256_sig === 'string') {
        req.content_sha256_buf = Buffer.from(req.content_sha256_sig, 'hex');
        if (req.content_sha256_buf.length !== 32) {
            throw new LambdaError(LambdaError.InvalidDigest);
        }
    }

    const req_time =
        time_utils.parse_amz_date(req.headers['x-amz-date'] || req.query['X-Amz-Date']) ||
        time_utils.parse_http_header_date(req.headers.date);
    if (Math.abs(Date.now() - req_time) > config.AMZ_DATE_MAX_TIME_SKEW_MILLIS) {
        throw new LambdaError(LambdaError.RequestTimeTooSkewed);
    }
}

function authenticate_request(req, res) {
    try {
        const auth_token = signature_utils.make_auth_token_from_request(req);
        auth_token.client_ip = http_utils.parse_client_ip(req);
        req.func_sdk.set_auth_token(auth_token);
        signature_utils.check_request_expiry(req);
    } catch (err) {
        dbg.error('authenticate_request: ERROR', err.stack || err);
        throw new LambdaError(LambdaError.SignatureDoesNotMatch);
    }
}

function parse_op_name(req) {
    const m = req.method.toLowerCase();
    const u = req.url.slice('/2015-03-31/functions'.length);

    // service url
    if (u === '/' || u === '' || u[0] !== '/') {
        req.params = {};
        return `${m}_service`;
    }

    const index1 = u.indexOf('/', 1);
    const pos1 = index1 < 0 ? u.length : index1;
    const index2 = u.indexOf('/', pos1 + 1);
    const pos2 = index2 < 0 ? u.length : index2;

    const func_name = decodeURIComponent(u.slice(1, pos1));
    const sub_resource = decodeURIComponent(u.slice(pos1 + 1, pos2));
    const sub_resource_id = decodeURIComponent(u.slice(pos2 + 1));

    if (sub_resource && sub_resource_id) {
        // func sub resource with identifier
        req.params = {
            func_name,
            [sub_resource]: sub_resource_id,
        };
        return `${m}_func_${sub_resource}`;
    } else if (sub_resource) {
        // func sub resource
        req.params = { func_name };
        return `${m}_func_${sub_resource}`;
    } else {
        // func url
        req.params = { func_name };
        return `${m}_func`;
    }
}

function handle_error(req, res, err) {
    const lambda_err =
        ((err instanceof LambdaError) && err) ||
        new LambdaError(RPC_ERRORS_TO_LAMBDA[err.rpc_code] || LambdaError.ServiceException);

    const reply = lambda_err.reply();
    dbg.error('LAMBDA ERROR', reply,
        req.method, req.originalUrl,
        JSON.stringify(req.headers),
        err.stack || err);
    res.statusCode = lambda_err.http_code;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Length', Buffer.byteLength(reply));
    res.end(reply);
}

function load_ops() {
    const r = x => require(x); // eslint-disable-line global-require
    return js_utils.deep_freeze({
        get_service: r('./ops/lambda_list_funcs'),
        get_func: r('./ops/lambda_get_func'),
        delete_func: r('./ops/lambda_delete_func'),
        post_service: r('./ops/lambda_create_func'),
        post_func_invocations: r('./ops/lambda_invoke_func'),
    });
}

// EXPORTS
module.exports = lambda_rest;


/*

function lambda_call(action_name, req, res, next) {
    dbg.log0('LAMBDA REQUEST', action_name, req.method, req.originalUrl, req.headers);
    let action = controller[action_name];
    if (!action) {
        dbg.error('LAMBDA TODO (NotImplemented)', action_name, req.method, req.originalUrl);
        next(new Error('NotImplemented'));
        return;
    }
    P.fcall(() => action.call(controller, req, res))
        .then(reply => {
            dbg.log1('LAMBDA REPLY', action_name, req.method, req.originalUrl, reply);
            if (!res.statusCode) {
                if (req.method === 'POST') {
                    // HTTP Created is the common reply to POST method
                    // BUT some APIs might require 200 or 202
                    res.statusCode = 201;
                } else if (req.method === 'DELETE') {
                    // HTTP No Content is the common reply to DELETE method
                    // BUT some APIs might require 200 or 202
                    res.statusCode = 204;
                } else {
                    // HTTP OK for GET, PUT, HEAD, OPTIONS
                    res.statusCode = 200;
                }
            }
            if (reply) {
                dbg.log0('LAMBDA REPLY', action_name, req.method, req.originalUrl,
                    JSON.stringify(req.headers), reply);
                res.send(reply);
            } else {
                dbg.log0('LAMBDA EMPTY REPLY', action_name, req.method, req.originalUrl,
                    JSON.stringify(req.headers));
                res.end();
            }
        })
        .catch(err => next(err));
}

function read_json_body(req, res, next) {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', function(chunk) {
        data += chunk;
    });
    req.on('end', function() {
        try {
            if (data) {
                req.body = JSON.parse(data);
            }
            const content_sha256_hex = req.headers['x-amz-content-sha256'];
            req.content_sha256 =
                content_sha256_hex ? Buffer.from(content_sha256_hex, 'hex') :
                (crypto.createHash('sha256')
                    .update(data)
                    .digest());
            return next();
        } catch (err) {
            return next(err);
        }
    });
}

*/
