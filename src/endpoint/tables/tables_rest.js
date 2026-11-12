/* Copyright (C) 2026 NooBaa */
'use strict';

const irc_rest = require('./irc_rest');
const s3tables_rest = require('./s3tables_rest');

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
 * tables_rest routes a request on the TABLES listener by path: IRC protocol
 * to the IRC facade, everything else to the S3Tables facade.
 * @param {import('http').IncomingMessage & NodeJS.Dict} req
 * @param {import('http').ServerResponse} res
 */
function tables_rest(req, res) {
    if (is_irc_path(req.url)) {
        return irc_rest(req, res);
    }
    return s3tables_rest(req, res);
}

// EXPORTS
exports.tables_rest = tables_rest;
exports.is_irc_path = is_irc_path;
