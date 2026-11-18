/* Copyright (C) 2026 NooBaa */
'use strict';

const dbg = require('../../util/debug_module')(__filename);
const tables_utils = require('./tables_utils');

/**
 * S3Tables facade - skeleton.
 * Answers every request with an AWS-shaped NotImplemented exception.
 * Real operations arrive in later stories.
 *
 * @param {import('http').IncomingMessage & NodeJS.Dict} req
 * @param {import('http').ServerResponse} res
 */
function s3tables_rest(req, res) {
    dbg.log1('S3Tables (NotImplemented)', req.method, req.originalUrl);
    reply_error(res, {
        http_code: 501,
        code: 'NotImplemented',
        message: 'The requested S3 Tables operation is not implemented.',
    });
}

/**
 * handle_error renders a thrown error as an AWS JSON exception, in the form AWS SDKs parse (the
 * `x-amzn-ErrorType` header plus a `__type` body field).
 * @param {import('http').IncomingMessage & NodeJS.Dict} req
 * @param {import('http').ServerResponse} res
 * @param {Error} err
 */
function handle_error(req, res, err) {
    dbg.error('S3Tables error', req.method, req.originalUrl, err && (err.stack || err));
    reply_error(res, tables_utils.error_details(err));
}

/**
 * @param {import('http').ServerResponse} res
 * @param {{ http_code: number, code: string, message: string }} details
 */
function reply_error(res, { http_code, code, message }) {
    const reply = JSON.stringify({
        __type: code,
        message,
    });
    res.statusCode = http_code;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('x-amzn-ErrorType', code);
    res.setHeader('Content-Length', Buffer.byteLength(reply));
    res.end(reply);
}

// EXPORTS
exports.s3tables_rest = s3tables_rest;
exports.handle_error = handle_error;
