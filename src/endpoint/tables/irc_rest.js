/* Copyright (C) 2026 NooBaa */
'use strict';

const dbg = require('../../util/debug_module')(__filename);
const tables_utils = require('./tables_utils');

/**
 * IRC (Iceberg REST Catalog) facade - skeleton.
 * Answers every request with a not-implemented error shaped as an Iceberg
 * IcebergErrorResponse. Real operations arrive in later stories.
 *
 * @param {import('http').IncomingMessage & NodeJS.Dict} req
 * @param {import('http').ServerResponse} res
 */
function irc_rest(req, res) {
    dbg.log1('IRC (NotImplemented)', req.method, req.originalUrl);
    reply_error(res, {
        http_code: 501,
        code: 'UnsupportedOperationException',
        message: 'The requested Iceberg REST catalog operation is not implemented.',
    });
}

/**
 * handle_error renders a thrown error as an Iceberg IcebergErrorResponse.
 * @param {import('http').IncomingMessage & NodeJS.Dict} req
 * @param {import('http').ServerResponse} res
 * @param {Error} err
 */
function handle_error(req, res, err) {
    dbg.error('IRC error', req.method, req.originalUrl, err && (err.stack || err));
    reply_error(res, tables_utils.error_details(err));
}

/**
 * @param {import('http').ServerResponse} res
 * @param {{ http_code: number, code: string, message: string }} details
 */
function reply_error(res, { http_code, code, message }) {
    const reply = JSON.stringify({
        error: {
            message,
            type: code,
            code: http_code,
        }
    });
    res.statusCode = http_code;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Length', Buffer.byteLength(reply));
    res.end(reply);
}

// EXPORTS
exports.irc_rest = irc_rest;
exports.handle_error = handle_error;
