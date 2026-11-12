/* Copyright (C) 2026 NooBaa */
'use strict';

const dbg = require('../../util/debug_module')(__filename);

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
    const reply = JSON.stringify({
        error: {
            message: 'The requested Iceberg REST catalog operation is not implemented.',
            type: 'UnsupportedOperationException',
            code: 501,
        }
    });
    res.statusCode = 501;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Length', Buffer.byteLength(reply));
    res.end(reply);
}

// EXPORTS
module.exports = irc_rest;
