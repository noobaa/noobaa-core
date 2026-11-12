/* Copyright (C) 2026 NooBaa */
'use strict';

const dbg = require('../../util/debug_module')(__filename);

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
    const code = 'NotImplemented';
    const reply = JSON.stringify({
        __type: code,
        message: 'The requested S3 Tables operation is not implemented.',
    });
    res.statusCode = 501;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('x-amzn-ErrorType', code);
    res.setHeader('Content-Length', Buffer.byteLength(reply));
    res.end(reply);
}

// EXPORTS
module.exports = s3tables_rest;
