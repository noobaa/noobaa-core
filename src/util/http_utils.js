/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const url = require('url');
const http = require('http');
const https = require('https');
const HttpProxyAgent = require('http-proxy-agent');
const HttpsProxyAgent = require('https-proxy-agent');
const crypto = require('crypto');
const xml2js = require('xml2js');
const querystring = require('querystring');
const ip = require('ip');
const P = require('./promise');
const dbg = require('./debug_module')(__filename);
const xml_utils = require('./xml_utils');
const cloud_utils = require('./cloud_utils');
const util = require('util');

const { HTTP_PROXY, HTTPS_PROXY, NO_PROXY } = process.env;
const http_agent = new http.Agent();
const http_proxy_agent = HTTP_PROXY ? new HttpProxyAgent(url.parse(HTTP_PROXY)) : null;
const https_agent = new https.Agent();
const https_proxy_agent = HTTPS_PROXY ? new HttpProxyAgent(url.parse(HTTPS_PROXY)) : null;
const unsecured_https_agent = new https.Agent({ rejectUnauthorized: false });
const unsecured_https_proxy_agent = HTTPS_PROXY ?
    new HttpsProxyAgent({ ...url.parse(HTTPS_PROXY), rejectUnauthorized: false }) :
    null;

const no_proxy_list =
    (NO_PROXY ? NO_PROXY.split(',') : []).map(addr => {
        if (ip.isV4Format(addr) || ip.isV6Format(addr)) {
            return {
                kind: 'IP',
                addr
            };
        }

        try {
            ip.cidr(addr);
            return {
                kind: 'CIDR',
                addr
            };
        } catch {
            // noop
        }

        if (addr.startsWith('.')) {
            return {
                kind: 'FQDN_SUFFIX',
                addr
            };
        }

        return {
            kind: 'FQDN',
            addr
        };
    });


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
    if (req.headers[prefix + 'if-modified-since']) {
        cond = cond || {};
        cond.if_modified_since =
            (new Date(req.headers[prefix + 'if-modified-since'])).getTime();
    }
    if (req.headers[prefix + 'if-unmodified-since']) {
        cond = cond || {};
        cond.if_unmodified_since =
            (new Date(req.headers[prefix + 'if-unmodified-since'])).getTime();
    }
    if (req.headers[prefix + 'if-match']) {
        cond = cond || {};
        cond.if_match_etag = req.headers[prefix + 'if-match'];
    }
    if (req.headers[prefix + 'if-none-match']) {
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
 * @param {String} range_header the range header string
 * @return {Array} Array of objects {start,end}
 */
function parse_http_ranges(range_header) {
    if (!range_header) return;
    const eq_index = range_header.indexOf('=');
    if (eq_index < 0) throw_ranges_error(400);
    const units = range_header.slice(0, eq_index);
    if (units !== 'bytes') throw_ranges_error(400);
    return range_header.slice(eq_index + 1).split(',').map(_parse_one_http_range);
}

function _parse_one_http_range(range_str) {
    const p = range_str.indexOf('-');
    if (p < 0) throw_ranges_error(400);
    const first = range_str.slice(0, p);
    const second = range_str.slice(p + 1);
    let start;
    let end;
    if (first) {
        start = Number(first);
        if (!Number.isInteger(start)) throw_ranges_error(400);
        if (second) {
            end = Number(second);
            if (!Number.isInteger(end)) throw_ranges_error(400);
            if (first) end += 1; // end is inclusive in http ranges
        }
    } else {
        // suffix range
        start = -Number(second);
        if (!Number.isInteger(start)) throw_ranges_error(400);
    }
    return { start, end };
}

function format_http_ranges(ranges) {
    if (!ranges || !ranges.length) return;
    let range_header = `bytes=${_format_one_http_range(ranges[0])}`;
    for (let i = 1; i < ranges.length; ++i) {
        range_header += `,${_format_one_http_range(ranges[i])}`;
    }
    return range_header;
}

function _format_one_http_range({ start, end }) {
    const start_str = start >= 0 ? start.toString() : '';
    const end_str = end > 0 ? (end - 1).toString() : ''; // end is inclusive in http ranges
    return `${start_str}-${end_str}`;
}

/**
 * @param {Array} ranges array of {start,end} from parse_http_range
 * @param {Number} size entity size in bytes
 * @return {Array} Array of {start,end}
 */
function normalize_http_ranges(ranges, size, throw_error_ranges = false) {
    if (!ranges) return;
    for (const r of ranges) {
        if (r.end === undefined) {
            if (r.start < 0) r.start += size;
            r.end = size;
        } else if (r.end > size) {
            if (throw_error_ranges) {
                let err = new Error('Invalid Argument');
                err.code = 'InvalidArgument';
                throw err;
            } else {
                r.end = size;
            }
        }
        if (r.start < 0 || r.start > r.end) throw_ranges_error(416);
    }
    if (ranges.length !== 1) throw_ranges_error(416);
    return ranges;
}

function throw_ranges_error(code) {
    const err = new Error('Bad Request');
    err.ranges_code = code;
    throw err;
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
            }
            return resolve();
        });
    });
}

const parse_xml_to_js = util.promisify(xml2js.parseString);

function parse_request_body(req, options) {
    if (!req.body && !options.body.optional) {
        throw new options.ErrorClass(options.error_missing_body);
    }
    if (options.body.type === 'xml') {
        return parse_xml_to_js(req.body, options.body.xml_options)
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
 * Check if a hostname should be proxied or not
 */
function should_proxy(hostname) {
    const isIp = ip.isV4Format(hostname) || ip.isV6Format(hostname);

    for (const { kind, addr } of no_proxy_list) {
        if (isIp) {
            if (kind === 'IP' && ip.isEqual(addr, hostname)) {
                return false;
            }
            if (kind === 'CIDR' && ip.cidrSubnet(addr).contains(hostname)) {
                return false;
            }

        } else {
            if (kind === 'FQDN_SUFFIX' && hostname.endsWith(addr)) {
                return false;
            }
            if (kind === 'FQDN' && hostname === addr) {
                return false;
            }
        }
    }

    return true;
}

/**
 * Get http / https agent according to protocol and proxy rules
 */
function get_default_agent(endpoint) {
    return _get_http_agent(endpoint, false);
}

/**
 * Get an unsecured http / https agent according to protocol and proxy rules
 */
function get_unsecured_agent(endpoint) {
    const is_aws_address = cloud_utils.is_aws_endpoint(endpoint);
    return _get_http_agent(endpoint, !is_aws_address);
}

function _get_http_agent(endpoint, request_unsecured) {
    const { protocol, hostname } = url.parse(endpoint);

    if (protocol === "https:" || protocol === "wss:") {
        if (HTTPS_PROXY && should_proxy(hostname)) {
            if (request_unsecured) {
                return unsecured_https_proxy_agent;
            } else {
                return https_proxy_agent;
            }
        } else if (request_unsecured) {
            return unsecured_https_agent;
        } else {
            return https_agent;
        }
    } else if (HTTP_PROXY && should_proxy(hostname)) {
        return http_proxy_agent;
    } else {
        return http_agent;
    }
}

function update_http_agents(options) {
    Object.assign(http.globalAgent, options);
    Object.assign(http_agent, options);
    if (http_proxy_agent) Object.assign(http_proxy_agent, options);
}

function update_https_agents(options) {
    if (!_.isUndefined(options.rejectUnauthorized)) {
        throw new Error('Changing rejectUnauthorized on agents is not allowed');
    }

    Object.assign(https.globalAgent, options);
    Object.assign(https_agent, options);
    Object.assign(unsecured_https_agent, options);
    if (https_proxy_agent) Object.assign(https_proxy_agent, options);
    if (unsecured_https_proxy_agent) Object.assign(unsecured_https_proxy_agent, options);
}

function make_https_request(options, body, body_encoding) {
    const { agent, hostname, rejectUnauthorized = true } = options;
    if (!agent) {
        options.agent = rejectUnauthorized ?
            get_default_agent(`https://${hostname}`) :
            get_unsecured_agent(`https://${hostname}`);
    }

    return new Promise((resolve, reject) => {
        https.request(options, resolve)
            .on('error', reject)
            .end(body, body_encoding);
    });
}

exports.parse_url_query = parse_url_query;
exports.parse_client_ip = parse_client_ip;
exports.get_md_conditions = get_md_conditions;
exports.match_etag = match_etag;
exports.parse_http_ranges = parse_http_ranges;
exports.format_http_ranges = format_http_ranges;
exports.normalize_http_ranges = normalize_http_ranges;
exports.read_and_parse_body = read_and_parse_body;
exports.send_reply = send_reply;
exports.should_proxy = should_proxy;
exports.get_default_agent = get_default_agent;
exports.get_unsecured_agent = get_unsecured_agent;
exports.update_http_agents = update_http_agents;
exports.update_https_agents = update_https_agents;
exports.make_https_request = make_https_request;
exports.parse_xml_to_js = parse_xml_to_js;
