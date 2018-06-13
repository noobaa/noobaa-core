/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const url = require('url');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const xml2js = require('xml2js');
const querystring = require('querystring');
const http_proxy_agent = require('http-proxy-agent');
const https_proxy_agent = require('https-proxy-agent');
const P = require('./promise');
const dbg = require('./debug_module')(__filename);
const xml_utils = require('./xml_utils');

function parse_url_query(req) {
    req.originalUrl = req.url;
    const query_pos = req.url.indexOf('?');
    if (query_pos < 0) {
        req.query = {};
    } else {
        req.query = querystring.parse(req.url.slice(query_pos + 1));
        req.url = req.url.slice(0, query_pos);
    }
}

function parse_client_ip(req) {
    // The general format of x-forwarded-for: client, proxy1, proxy2, proxy3
    const fwd =
        req.headers['x-forwarded-for'] ||
        req.connection.remoteAddress ||
        '';
    return fwd.includes(',') ? fwd.split(',', 1)[0] : fwd;
}

function get_md_conditions(req, prefix) {
    var cond;
    prefix = prefix || '';
    if (prefix + 'if-modified-since' in req.headers) {
        cond = cond || {};
        cond.if_modified_since =
            (new Date(req.headers[prefix + 'if-modified-since'])).getTime();
    }
    if (prefix + 'if-unmodified-since' in req.headers) {
        cond = cond || {};
        cond.if_unmodified_since =
            (new Date(req.headers[prefix + 'if-unmodified-since'])).getTime();
    }
    if (prefix + 'if-match' in req.headers) {
        cond = cond || {};
        cond.if_match_etag = req.headers[prefix + 'if-match'];
    }
    if (prefix + 'if-none-match' in req.headers) {
        cond = cond || {};
        cond.if_none_match_etag = req.headers[prefix + 'if-none-match'];
    }
    return cond;
}

/**
 * see https://www.w3.org/Protocols/rfc2616/rfc2616-sec14.html#sec14.24
 */
function match_etag(condition, etag) {

    // trim white space
    condition = condition.trim();

    // * matches any etag
    if (condition === '*') return true;

    // detect exact match, but only allow it if no commas at all
    if (!condition.includes(',')) {
        if (condition === `"${etag}"` || condition === etag) return true;
    }

    // split the condition on commas followed by proper quoted-string
    // the then compare to find any match
    return condition.split(/,(?=\s*"[^"]*"\s*)/)
        .some(c => c.trim() === `"${etag}"`);
}

/**
 * @param {String} range_str the range header string
 * @return {undefined|Number|Array} according to these options:
 *  - undefined (no range)
 *  - 400 (HTTP Bad request)
 *  - Array of objects {start,end}
 */
function parse_http_range(range_str) {
    if (!range_str) return;
    const eq_index = range_str.indexOf('=');
    if (eq_index < 0) return 400;
    const units = range_str.slice(0, eq_index);
    if (units !== 'bytes') return 400;
    return range_str.slice(eq_index + 1)
        .split(',')
        .map(item => {
            const r = item.split('-');
            return {
                start: Number(r[0] || NaN),
                end: Number(r[1] || NaN),
            };
        });
}

function format_http_range(range) {
    if (!range) return;
    return `bytes=${range.start}-${range.end}`;
}

/**
 * @param {Array} ranges array of {start,end} from parse_http_range
 * @param {Number} size entity size in bytes
 * @return {Number|Array} according to these options:
 *  - undefined (no range)
 *  - 416 (HTTP Range not satisfiable)
 *  - Array of {start,end}
 */
function normalize_http_ranges(ranges, size) {
    if (!Array.isArray(ranges)) return ranges;
    for (var i = 0; i < ranges.length; ++i) {
        const r = ranges[i];
        if (isNaN(r.end)) {
            if (isNaN(r.start)) return 416;
            r.end = size - 1;
        } else if (isNaN(r.start)) {
            r.start = size - r.end;
            r.end = size - 1;
        } else if (r.end >= size) {
            r.end = size - 1;
        }
        if (r.start < 0 || r.start > r.end) return 416;
    }
    if (ranges.length !== 1) return 416;
    return ranges;
}

function read_and_parse_body(req, options) {
    if (options.body.type === 'empty' ||
        options.body.type === 'raw') {
        return P.resolve();
    }
    return read_request_body(req, options)
        .then(() => parse_request_body(req, options));
}

function read_request_body(req, options) {
    return new P((resolve, reject) => {
        let data = '';
        let content_len = 0;
        const sha256 = crypto.createHash('sha256');
        req.on('data', chunk => {
            content_len += chunk.length;
            if (content_len > options.MAX_BODY_LEN) {
                return reject(new options.ErrorClass(options.error_max_body_len_exceeded));
            }
            sha256.update(chunk);
            // Parse the data after the length check
            data += chunk.toString('utf8');
        });
        req.once('error', reject);
        req.once('end', () => {
            req.body = data;
            const sha256_buf = sha256.digest();
            if (req.content_sha256_buf) {
                if (Buffer.compare(sha256_buf, req.content_sha256_buf)) {
                    return reject(new options.ErrorClass(options.error_body_sha256_mismatch));
                }
            } else {
                req.content_sha256_buf = sha256_buf;
                if (!req.content_sha256) req.content_sha256 = req.content_sha256_buf.toString('hex');
            }
            return resolve();
        });
    });
}

function parse_request_body(req, options) {
    if (!req.body && !options.body.optional) {
        throw new options.ErrorClass(options.error_missing_body);
    }
    if (options.body.type === 'xml') {
        return P.fromCallback(callback => xml2js.parseString(req.body, options.body.xml_options, callback))
            .then(data => {
                req.body = data;
            })
            .catch(err => {
                console.error('parse_request_body: XML parse problem', err);
                throw new options.ErrorClass(options.error_invalid_body);
            });
    }
    if (options.body.type === 'json') {
        return P.try(() => {
                req.body = JSON.parse(req.body);
            })
            .catch(err => {
                console.error('parse_request_body: JSON parse problem', err);
                throw new options.ErrorClass(options.error_invalid_body);
            });
    }
    dbg.error('HTTP BODY UNEXPECTED TYPE', req.method, req.originalUrl,
        JSON.stringify(req.headers), options);
    throw new Error(`HTTP BODY UNEXPECTED TYPE ${options.body.type}`);
}

function send_reply(req, res, reply, options) {
    if (options.reply.type === 'raw') {
        // in this case the handler already replied
        dbg.log0('HTTP REPLY RAW', req.method, req.originalUrl);
        return;
    }
    if (!reply || options.reply.type === 'empty') {
        if (!options.reply.keep_status_code && req.method === 'DELETE' &&
            (!res.statusCode || res.statusCode < 300)) {
            res.statusCode = 204;
        }
        dbg.log0('HTTP REPLY EMPTY', req.method, req.originalUrl,
            JSON.stringify(req.headers), res.statusCode);
        res.end();
        return;
    }
    if (options.reply.type === 'xml') {
        const xml_root = options.XML_ROOT_ATTRS ?
            _.mapValues(reply, val => {
                if (val._attr) {
                    _.defaults(val._attr, options.XML_ROOT_ATTRS);
                    return val;
                } else {
                    return {
                        _attr: options.XML_ROOT_ATTRS,
                        _content: val
                    };
                }
            }) :
            reply;
        const xml_reply = xml_utils.encode_xml(xml_root);
        dbg.log0('HTTP REPLY XML', req.method, req.originalUrl,
            JSON.stringify(req.headers),
            xml_reply.length <= 2000 ?
            xml_reply : xml_reply.slice(0, 1000) + ' ... ' + xml_reply.slice(-1000));
        res.setHeader('Content-Type', 'application/xml');
        res.setHeader('Content-Length', Buffer.byteLength(xml_reply));
        res.end(xml_reply);
        return;
    }
    if (options.reply.type === 'json') {
        const json_reply = JSON.stringify(reply);
        dbg.log0('HTTP REPLY JSON', req.method, req.originalUrl,
            JSON.stringify(req.headers), json_reply);
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Length', Buffer.byteLength(json_reply));
        res.end(json_reply);
        return;
    }
    dbg.error('HTTP REPLY UNEXPECTED TYPE', req.method, req.originalUrl,
        JSON.stringify(req.headers), options);
    res.statusCode = 500;
    res.end();
}


/**
 * Get http / https agent according to protocol
 */
function get_unsecured_http_agent(endpoint, proxy) {
    const { protocol } = url.parse(endpoint);
    if (proxy) {
        return protocol === "https:" ?
            https_proxy_agent(
                Object.assign(url.parse(proxy), {
                    rejectUnauthorized: false
                })
            ) :
            http_proxy_agent(
                Object.assign(url.parse(proxy)));
    }
    return protocol === "https:" ?
        new https.Agent({
            rejectUnauthorized: false,
        }) :
        new http.Agent();
}

exports.parse_url_query = parse_url_query;
exports.parse_client_ip = parse_client_ip;
exports.get_md_conditions = get_md_conditions;
exports.match_etag = match_etag;
exports.parse_http_range = parse_http_range;
exports.format_http_range = format_http_range;
exports.normalize_http_ranges = normalize_http_ranges;
exports.read_and_parse_body = read_and_parse_body;
exports.send_reply = send_reply;
exports.get_unsecured_http_agent = get_unsecured_http_agent;
