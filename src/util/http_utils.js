/* Copyright (C) 2016 NooBaa */
'use strict';
/* eslint-disable no-control-regex */

const _ = require('lodash');
const util = require('util');
const ip_module = require('ip');
const net = require('net');
const url = require('url');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const xml2js = require('xml2js');
const querystring = require('querystring');
const { HttpProxyAgent } = require('http-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');

const dbg = require('./debug_module')(__filename);
const config = require('../../config');
const xml_utils = require('./xml_utils');
const jwt_utils = require('./jwt_utils');
const net_utils = require('./net_utils');
const time_utils = require('./time_utils');
const cloud_utils = require('./cloud_utils');
const ssl_utils = require('../util/ssl_utils');
const fs_utils = require('../util/fs_utils');
const lifecycle_utils = require('../../src/util/lifecycle_utils');
const RpcError = require('../rpc/rpc_error');
const S3Error = require('../endpoint/s3/s3_errors').S3Error;

const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';
const STREAMING_PAYLOAD = 'STREAMING-AWS4-HMAC-SHA256-PAYLOAD';
const STREAMING_UNSIGNED_PAYLOAD_TRAILER = 'STREAMING-UNSIGNED-PAYLOAD-TRAILER';
const STREAMING_AWS4_HMAC_SHA256_PAYLOAD_TRAILER = 'STREAMING-AWS4-HMAC-SHA256-PAYLOAD-TRAILER';

const CONTENT_TYPE_TEXT_PLAIN = 'text/plain';
const CONTENT_TYPE_APP_OCTET_STREAM = 'application/octet-stream';
const CONTENT_TYPE_APP_JSON = 'application/json';
const CONTENT_TYPE_APP_XML = 'application/xml';
const CONTENT_TYPE_APP_FORM_URLENCODED = 'application/x-www-form-urlencoded';

const INTERNAL_CA_CERTS = process.env.INTERNAL_CA_CERTS || '/var/run/secrets/kubernetes.io/serviceaccount/service-ca.crt';
const EXTERNAL_CA_CERTS = process.env.EXTERNAL_CA_CERTS || '/etc/ocp-injected-ca-bundle/ca-bundle.crt';

const { HTTP_PROXY, HTTPS_PROXY, NO_PROXY } = process.env;
const http_agent = new http.Agent();
const https_agent = new https.Agent({
    ca: (ca => (ca.length ? ca : undefined))([
        fs_utils.try_read_file_sync(INTERNAL_CA_CERTS),
        fs_utils.try_read_file_sync(EXTERNAL_CA_CERTS),
    ].filter(Boolean))
});
const unsecured_https_agent = new https.Agent({ rejectUnauthorized: false });
const http_proxy_agent = HTTP_PROXY ?
    new HttpProxyAgent(HTTP_PROXY) : null;
const https_proxy_agent = HTTPS_PROXY ?
    new HttpsProxyAgent(HTTPS_PROXY) : null;
const unsecured_https_proxy_agent = HTTPS_PROXY ?
    new HttpsProxyAgent(HTTPS_PROXY, { rejectUnauthorized: false }) : null;

const no_proxy_list = (NO_PROXY ? NO_PROXY.split(',') : []).map(addr => {
    let kind = 'FQDN';
    if (net.isIPv4(addr) || net.isIPv6(addr)) {
        kind = 'IP';
    } else if (net_utils.is_cidr(addr)) {
        kind = 'CIDR';
    } else if (addr.startsWith('.')) {
        kind = 'FQDN_SUFFIX';
    }

    return { kind, addr };
});

const parse_xml_to_js = xml2js.parseStringPromise;
const non_printable_regexp = /[\x00-\x1F]/;

/**
 * Since header values can be either string or array of strings we need to handle both cases.
 * While most callers might prefer to always handle a single string value, which is why we 
 * have this helper, some callers might prefer to always convert to array of strings,
 * which is why we have hdr_as_arr().
 * 
 * @param {import('http').IncomingHttpHeaders} headers
 * @param {string} key the header name
 * @param {string} [join_sep] optional separator to join multiple values, if not provided only the first value is returned
 * @returns {string|undefined} the header string value or undefined if not found
 */
function hdr_as_str(headers, key, join_sep) {
    const v = headers[key];
    if (v === undefined) return undefined;
    if (typeof v === 'string') return v;
    if (!Array.isArray(v)) return String(v); // should not happen but would not fail a request for it
    if (join_sep === undefined) return String(v[0]); // if not joining - return just the first
    return v.join(join_sep); // join all values with the separator
}

/**
 * Since header values can be either string or array of strings we need to handle both cases.
 * While most callers might prefer to always handle a single string value, which is why we 
 * have hdr_as_str(), some callers might prefer to always convert to array of strings,
 * which is why we have this helper.
 * 
 * @param {import('http').IncomingHttpHeaders} headers
 * @param {string} key the header name
 * @returns {string[]|undefined} the header string value or undefined if not found
 */
function hdr_as_arr(headers, key) {
    const v = headers[key];
    if (v === undefined) return undefined;
    if (typeof v === 'string') return [v];
    if (!Array.isArray(v)) return [String(v)]; // should not happen but would not fail a request for it
    return v;
}

/**
 * @param {http.IncomingMessage & NodeJS.Dict} req 
 * @returns {querystring.ParsedUrlQuery}
 */
function parse_url_query(req) {
    // some clients include host in http url
    if (req.url.startsWith('http://')) {
        req.url = req.url.slice(req.url.indexOf('/', 'http://'.length));
    } else if (req.url.startsWith('https://')) {
        req.url = req.url.slice(req.url.indexOf('/', 'https://'.length));
    }
    req.originalUrl = req.url;
    const query_pos = req.url.indexOf('?');
    if (query_pos < 0) {
        req.query = {};
    } else {
        req.query = querystring.parse(req.url.slice(query_pos + 1));
        req.url = req.url.slice(0, query_pos);
    }
    return req.query;
}

function parse_client_ip(req) {
    // The general format of x-forwarded-for: client, proxy1, proxy2, proxy3
    const fwd =
        req.headers['x-forwarded-for'] ||
        req.connection.remoteAddress ||
        '';
    return fwd.includes(',') ? fwd.split(',', 1)[0] : fwd;
}

/**
 * @typedef {{
 *  if_modified_since?: number,
 *  if_unmodified_since?: number,
 *  if_match_etag?: string,
 *  if_none_match_etag?: string,
 * }} MDConditions
 */

/**
 * 
 * @param {*} req 
 * @param {*} prefix
 * @returns {MDConditions|void}
 */
function get_md_conditions(req, prefix) {
    /** @type {MDConditions} */
    let cond;
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
 * See http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectHEAD.html#req-header-consideration-1
 * See https://tools.ietf.org/html/rfc7232 (HTTP Conditional Requests)
 * @param {MDConditions} [conditions] the conditions to check from the request headers
 * @param {{
 *   etag?: string,
 *   last_modified_time?: Date,
 *   create_time?: Date,
 *   _id?: nb.ID,
 * }} [obj] the object to check the conditions against if exists
 */
function check_md_conditions(conditions, obj) {
    if (!conditions) return;
    const { if_match_etag, if_none_match_etag, if_modified_since, if_unmodified_since } = conditions;
    if (!if_match_etag && !if_none_match_etag && !if_modified_since && !if_unmodified_since) return;

    const etag = obj?.etag || '';
    const last_modified =
        obj?.last_modified_time?.getTime() ||
        obj?.create_time?.getTime() ||
        obj?._id?.getTimestamp()?.getTime() ||
        0;

    // Using RpcError in order to return the proper headers in case of error
    // see _prepare_error() in s3_rest.
    const rpc_data = { etag, last_modified };

    // obj must exist to count as matched.
    const matched = if_match_etag && (obj && match_etag(if_match_etag, etag));
    if (if_match_etag && !matched) {
        throw new RpcError('IF_MATCH_ETAG', 'check_md_conditions failed', rpc_data);
    }

    // when obj does not exist it is a valid none matched condition
    const none_matched = if_none_match_etag && !(obj && match_etag(if_none_match_etag, etag));
    if (if_none_match_etag && !none_matched) {
        throw new RpcError('IF_NONE_MATCH_ETAG', 'check_md_conditions failed', rpc_data);
    }

    // obj must exist to count as modified.
    // none_matched must be false to check for modified condition (per the spec)
    const modified = if_modified_since && obj && (last_modified > if_modified_since);
    if (if_modified_since && !none_matched && !modified) {
        throw new RpcError('IF_MODIFIED_SINCE', 'check_md_conditions failed', rpc_data);
    }

    // non existing obj counts as modified.
    // matched must be false to check for unmodified condition (per the spec)
    const unmodified = if_unmodified_since && !(obj && (last_modified > if_unmodified_since));
    if (if_unmodified_since && !matched && !unmodified) {
        throw new RpcError('IF_UNMODIFIED_SINCE', 'check_md_conditions failed', rpc_data);
    }
}

/**
 * see https://www.w3.org/Protocols/rfc2616/rfc2616-sec14.html#sec14.24
 * @param {string} condition the condition string from the header
 * @param {string} etag the object etag to match
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
            end += 1; // end is inclusive in http ranges
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
                throw Object.assign(new Error('Invalid Argument'), { code: 'InvalidArgument' });
            }
            r.end = size;
        }
        if (r.start < 0 || r.start > r.end) throw_ranges_error(416);
    }
    if (ranges.length !== 1) throw_ranges_error(416);
    return ranges;
}

function throw_ranges_error(ranges_code) {
    throw Object.assign(new Error('Bad Request'), { ranges_code });
}

async function read_and_parse_body(req, options) {
    if (options.body.type === 'empty' ||
        options.body.type === 'raw') {
        return;
    }
    await read_request_body(req, options);
    await parse_request_body(req, options);
}

function read_request_body(req, options) {
    return new Promise((resolve, reject) => {
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
                req.content_sha256_sig ||= sha256_buf.toString('hex');
            }
            return resolve();
        });
    });
}

async function parse_request_body(req, options) {
    if (!req.body && !options.body.optional) {
        throw new options.ErrorClass(options.error_missing_body);
    }
    if (options.body.type === 'xml') {
        try {
            const data = await parse_xml_to_js(req.body, options.body.xml_options);
            req.body = data;
            return;
        } catch (err) {
            console.error('parse_request_body: XML parse problem', err);
            throw new options.ErrorClass(options.error_invalid_body);
        }
    }
    if (options.body.type === 'json') {
        try {
            req.body = JSON.parse(req.body);
            return;
        } catch (err) {
            console.error('parse_request_body: JSON parse problem', err);
            throw new options.ErrorClass(options.error_invalid_body);
        }
    }
    if (options.body.type.includes(CONTENT_TYPE_APP_FORM_URLENCODED)) {
        try {
            const res = querystring.parse(req.body.toString());
            const renamed = _.mapKeys(res, (value, key) => _.snakeCase(key));
            req.body = renamed;
            return;
        } catch (err) {
            console.error('parse_request_body: urlencoded parse problem', err);
            throw new options.ErrorClass(options.error_invalid_body);
        }
    }
    dbg.error('HTTP BODY UNEXPECTED TYPE', req.method, req.originalUrl,
        JSON.stringify(req.headers), options);
    throw new Error(`HTTP BODY UNEXPECTED TYPE ${options.body.type}`);
}

function send_reply(req, res, reply, options) {
    if (options.reply.type === 'raw') {
        // in this case the handler already replied
        dbg.log1('HTTP REPLY RAW', req.method, req.originalUrl);
        return;
    }
    if (!reply || options.reply.type === 'empty') {
        if (!options.reply.keep_status_code && req.method === 'DELETE' &&
            (!res.statusCode || res.statusCode < 300)) {
            res.statusCode = 204;
        }
        dbg.log1('HTTP REPLY EMPTY', req.method, req.originalUrl,
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
        // TODO: Refactor later on to support potential headers response and delayed XML body
        // This is done for the complete since we assign the XML header only in body prior to responding
        const xml_reply = xml_utils.encode_xml(xml_root, /* ignore_header */ res.headersSent);
        dbg.log1('HTTP REPLY XML', req.method, req.originalUrl,
            JSON.stringify(req.headers),
            xml_reply.length <= 2000 ?
                xml_reply : xml_reply.slice(0, 1000) + ' ... ' + xml_reply.slice(-1000));
        if (res.headersSent) {
            dbg.log0('Sending xml reply in body, bit too late for headers');
        } else {
            res.setHeader('Content-Type', 'application/xml');
            res.setHeader('Content-Length', Buffer.byteLength(xml_reply));
        }
        res.end(xml_reply);
        return;
    }
    if (options.reply.type === 'json') {
        const json_reply = JSON.stringify(reply);
        dbg.log1('HTTP REPLY JSON', req.method, req.originalUrl,
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
    const isIp = net.isIPv4(hostname) || net.isIPv6(hostname);
    dbg.log2(`should_proxy: hostname ${hostname} isIp ${isIp}`);

    for (const { kind, addr } of no_proxy_list) {
        dbg.log3(`should_proxy: an item from no_proxy_list: kind ${kind} addr ${addr}`);
        if (isIp) {
            if (kind === 'IP' && net_utils.is_equal(addr, hostname)) {
                return false;
            }
            if (kind === 'CIDR' && ip_module.cidrSubnet(addr).contains(hostname)) {
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
    const hostname = url.parse(endpoint) ? url.parse(endpoint).hostname : endpoint;
    const is_localhost = _.isString(hostname) && hostname.toLowerCase() === 'localhost';
    return _get_http_agent(endpoint, is_localhost || (!is_aws_address && _.isEmpty(https_agent.options.ca)));
}

/**
 * 
 * @param {string} endpoint 
 * @param {boolean} request_unsecured 
 * @returns {https.Agent | http.Agent | HttpsProxyAgent | HttpProxyAgent}
 */
function _get_http_agent(endpoint, request_unsecured) {
    const { protocol, hostname } = url.parse(endpoint);
    const should_proxy_by_hostname = should_proxy(hostname);
    dbg.log2(`_get_http_agent: ` +
        `endpoint ${endpoint} request_unsecured ${request_unsecured} ` +
        `protocol ${protocol} hostname ${hostname} should_proxy(hostname) ${should_proxy_by_hostname} ` +
        `Boolean(HTTPS_PROXY) ${Boolean(HTTPS_PROXY)} Boolean(HTTP_PROXY) ${Boolean(HTTP_PROXY)}`);

    if (protocol === "https:" || protocol === "wss:") {
        if (HTTPS_PROXY && should_proxy_by_hostname) {
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
    } else if (HTTP_PROXY && should_proxy_by_hostname) {
        return http_proxy_agent;
    } else {
        return http_agent;
    }
}

function get_agent_by_endpoint(endpoint) {
    return cloud_utils.is_aws_endpoint(endpoint) ?
        get_default_agent(endpoint) :
        get_unsecured_agent(endpoint);
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

/**
 * 
 * @param {http.RequestOptions} options 
 * @param {*} body 
 * @returns {Promise<http.IncomingMessage>}
 */
async function make_http_request(options, body) {
    return new Promise((resolve, reject) => {
        http.request(options, resolve)
            .on('error', reject)
            .end(body);
    });
}

// Write periodically to keep the connection alive
// TODO: Every complete above the S3_KEEP_ALIVE_WHITESPACE_INTERVAL
// will be responded in BODY, we cannot rollback from that for pre HEADER failures
// instread of having a fine tuned way start of sending body to make sure that we won't respond by BODY on HEADER failures
function set_keep_alive_whitespace_interval(res) {
    let count = 0;
    res.keep_alive_whitespace_interval = setInterval(() => {
        count += 1;
        dbg.log0(`keep_alive_whitespace_interval headersSent=${res.headersSent} count=${count}`);
        if (res.headersSent) {
            // Keep the connection alive with white spaces
            res.write(' ');
        } else {
            // Mark begining of BODY response
            // Assuming that write automatically assigns 200 OK status
            res.write(xml_utils.XML_HEADER);
        }
    }, config.S3_KEEP_ALIVE_WHITESPACE_INTERVAL);
    res.keep_alive_whitespace_interval.unref();
    const clear = () => clearInterval(res.keep_alive_whitespace_interval);
    res.on('close', clear);
    res.on('finish', clear);
}

function check_headers(req, options) {
    _.each(req.headers, (val, key) => {
        // test for non printable characters
        // 403 is required for unreadable headers
        // eslint-disable-next-line no-control-regex
        if (non_printable_regexp.test(val) || non_printable_regexp.test(key)) {
            dbg.warn('Invalid header characters', key, val);
            if (key.startsWith('x-amz-meta-')) {
                throw new options.ErrorClass(options.error_invalid_argument);
            }
            if (key !== 'expect' && key !== 'user-agent') {
                throw new options.ErrorClass(options.error_access_denied);
            }
        }
    });
    _.each(req.query, (val, key) => {
        // test for non printable characters
        // 403 is required for unreadable query
        // eslint-disable-next-line no-control-regex
        if (non_printable_regexp.test(val) || non_printable_regexp.test(key)) {
            dbg.warn('Invalid query characters', key, val);
            if (key !== 'marker') {
                throw new options.ErrorClass(options.error_invalid_argument);
            }
        }
    });

    if (req.headers['content-length'] === '') {
        throw new options.ErrorClass(options.error_bad_request);
    }

    if (req.headers['azure-metadata-handling'] && !_.includes(['ExcludeIfInvalid', 'FailIfInvalid', 'RenameIfInvalid'], req.headers['azure-metadata-handling'])) {
        throw new options.ErrorClass(options.error_bad_request);
    }


    if (req.method === 'POST' || req.method === 'PUT') parse_content_length(req, options);

    const content_md5_b64 = req.headers['content-md5'];
    if (typeof content_md5_b64 === 'string') {
        req.content_md5 = Buffer.from(content_md5_b64, 'base64');
        if (req.content_md5.length !== 16) {
            throw new options.ErrorClass(options.error_invalid_digest);
        }
    }

    const content_sha256_hdr = req.headers['x-amz-content-sha256'];
    req.content_sha256_sig = req.query['X-Amz-Signature'] ?
        UNSIGNED_PAYLOAD :
        content_sha256_hdr;
    if (typeof content_sha256_hdr === 'string' &&
        content_sha256_hdr !== UNSIGNED_PAYLOAD &&
        content_sha256_hdr !== STREAMING_PAYLOAD &&
        content_sha256_hdr !== STREAMING_UNSIGNED_PAYLOAD_TRAILER &&
        content_sha256_hdr !== STREAMING_AWS4_HMAC_SHA256_PAYLOAD_TRAILER) {
        req.content_sha256_buf = Buffer.from(content_sha256_hdr, 'hex');
        if (req.content_sha256_buf.length !== 32) {
            throw new options.ErrorClass(options.error_invalid_digest);
        }
    }

    const content_encoding = req.headers['content-encoding'] || '';
    req.chunked_content =
        content_encoding.split(',').map(encoding => encoding.trim()).includes('aws-chunked') ||
        content_sha256_hdr === STREAMING_PAYLOAD;

    const req_time =
        time_utils.parse_amz_date(req.headers['x-amz-date'] || req.query['X-Amz-Date']) ||
        time_utils.parse_http_header_date(req.headers.date);

    const auth_token = options.auth_token(req);
    const is_not_anonymous_req = Boolean(auth_token && auth_token.access_key);
    // In case of presigned urls / anonymous requests we shouldn't fail on non provided time.
    if (isNaN(req_time) && !req.query.Expires && is_not_anonymous_req) {
        throw new options.ErrorClass(options.error_access_denied);
    }
    // futureus presigned url request should throw AccessDenied with request is no valid yet message
    // we add a grace period of one second
    const is_presigned_url = req.query.Expires || (req.query['X-Amz-Date'] && req.query['X-Amz-Expires']);
    if (is_presigned_url && (req_time > (Date.now() + 2000))) {
        throw new S3Error(S3Error.RequestNotValidYet);
    }
    // on regular requests the skew limit is 15 minutes
    // on presigned url requests we don't need to check skew
    if (!is_presigned_url && (Math.abs(Date.now() - req_time) > config.AMZ_DATE_MAX_TIME_SKEW_MILLIS)) {
        throw new options.ErrorClass(options.error_request_time_too_skewed);
    }
}

/**
 * @param {http.IncomingMessage & {request_id: string}} req
 * @param {http.ServerResponse} res
 */
function set_amz_headers(req, res) {
    res.setHeader('x-amz-request-id', req.request_id);
    res.setHeader('x-amz-id-2', req.request_id);
}

/**
 * set_expiration_header sets the `x-amz-expiration` response header for GET, PUT, or HEAD object requests
 * if the object matches any enabled bucket lifecycle rule
 *
 * @param {Object} req
 * @param {http.ServerResponse} res
 * @param {Object} object_info
 */
async function set_expiration_header(req, res, object_info) {
    if (!config.S3_LIFECYCLE_EXPIRATION_HEADER_ENABLED) return;

    const rules = req.params.bucket && await req.object_sdk.get_bucket_lifecycle_configuration_rules({ name: req.params.bucket });

    const matched_rule = lifecycle_utils.get_lifecycle_rule_for_object(rules, object_info);
    if (matched_rule) {
        const expiration_header = lifecycle_utils.build_expiration_header(matched_rule, object_info.create_time);
        if (expiration_header) {
            dbg.log1('set x_amz_expiration header from applied rule: ', matched_rule);
            res.setHeader('x-amz-expiration', expiration_header);
        }
    }
}

/**
 * @typedef {{
 *      allow_origin: string;
 *      allow_methods: string;
 *      allow_headers?: string;
 *      expose_headers?: string;
 *      allow_credentials?: string;
 *      max_age?: number;
 * }} CORSConfig
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {CORSConfig} cors
 */
function set_cors_headers(req, res, cors) {
    res.setHeader('Access-Control-Allow-Origin', cors.allow_origin);
    res.setHeader('Access-Control-Allow-Methods', cors.allow_methods);
    if (cors.allow_headers) res.setHeader('Access-Control-Allow-Headers', cors.allow_headers);
    if (cors.expose_headers) res.setHeader('Access-Control-Expose-Headers', cors.expose_headers);
    if (cors.allow_credentials) res.setHeader('Access-Control-Allow-Credentials', cors.allow_credentials);
    if (cors.max_age) res.setHeader('Access-Control-Max-Age', cors.max_age);
}

/**
 * * @typedef {{
 *      allowed_origins: string[];
 *      allowed_credentials: string[];
 *      allowed_methods: string[];
 *      allowed_headers: string[];
 *      expose_headers: string[];
 *      max_age: number;
 * }} CORSRule
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {CORSRule[]} cors_rules 
 */
function set_cors_headers_s3(req, res, cors_rules) {
    if (!config.S3_CORS_ENABLED || !cors_rules) return;

    // based on https://docs.aws.amazon.com/AmazonS3/latest/userguide/cors.html
    const match_method = req.headers['access-control-request-method'] || req.method;
    const match_origin = req.headers.origin;
    const match_header = req.headers['access-control-request-headers']; // not a must
    const matched_rule = req.headers.origin && ( // find the first rule with origin and method match
        cors_rules.find(rule => {
            const allowed_origins_regex = rule.allowed_origins.map(r => RegExp(`^${r.replace(/\*/g, '.*')}$`));
            const allowed_headers_regex = rule.allowed_headers?.map(r => RegExp(`^${r.replace(/\*/g, '.*')}$`, 'i'));
            return allowed_origins_regex.some(r => r.test(match_origin)) &&
                rule.allowed_methods.includes(match_method) &&
                // we can match if no request headers or if reuqest headers match the rule allowed headers
                (!match_header || allowed_headers_regex?.some(r => r.test(match_header)));
        }));
    if (matched_rule) {
        // https://docs.aws.amazon.com/AmazonS3/latest/API/RESTCommonResponseHeaders.html
        dbg.log0('set_cors_headers_s3: found matching CORS rule:', matched_rule);
        set_cors_headers(req, res, {
            allow_origin: matched_rule.allowed_origins.includes('*') ? '*' : req.headers.origin,
            allow_methods: matched_rule.allowed_methods.join(','),
            allow_headers: matched_rule.allowed_headers?.join(','),
            expose_headers: matched_rule.expose_headers?.join(','),
            allow_credentials: 'true',
            max_age: matched_rule?.max_age
        });
    }
}

/**
 * same as set_cors_headers_s3 besides expose_headers
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
function set_cors_headers_sts(req, res) {
    if (config.S3_CORS_ENABLED) {
        set_cors_headers(req, res, {
            allow_origin: config.S3_CORS_ALLOW_ORIGIN[0],
            allow_credentials: config.S3_CORS_ALLOW_CREDENTIAL,
            allow_methods: config.S3_CORS_ALLOW_METHODS.join(','),
            allow_headers: config.S3_CORS_ALLOW_HEADERS.join(','),
            expose_headers: config.STS_CORS_EXPOSE_HEADERS,
        });
    }
}

function parse_content_length(req, options) {
    const size = Number(req.headers['x-amz-decoded-content-length'] || req.headers['content-length']);
    const copy = req.headers['x-amz-copy-source'];
    if (!copy && (!Number.isInteger(size) || size < 0)) {
        dbg.warn('Missing content-length', req.headers['content-length']);
        throw new options.ErrorClass(options.error_missing_content_length);
    }
    return size;
}

function authorize_session_token(req, options) {
    if (!req.headers['x-amz-security-token']) {
        return;
    }
    try {
        req.session_token = jwt_utils.authorize_jwt_token(req.headers['x-amz-security-token']);
    } catch (err) {
        dbg.error('http_utils.authorize_session_token JWT VERIFY FAILED', err);
        if (err.name === 'TokenExpiredError') throw new options.ErrorClass(options.error_token_expired);
        throw new options.ErrorClass(options.error_invalid_token);
    }
}

function validate_server_ip_whitelist(req) {
    if (config.S3_SERVER_IP_WHITELIST.length === 0) return;
    // remove prefix for V4 IPs for whitelist validation
    // TODO: replace the equality check with net.BlockList() usage
    const server_ip = req.connection.localAddress.replace(/^::ffff:/, '');
    for (const whitelist_ip of config.S3_SERVER_IP_WHITELIST) {
        if (server_ip === whitelist_ip) {
            return;
        }
    }
    dbg.error(`Whitelist ip validation failed for ip : ${server_ip}`);
    throw new S3Error(S3Error.AccessDenied);
}



// This function is intended to provide partial functionalaty to replace the deprecated request npm module (https://www.npmjs.com/package/request)
// Before using this function, make sure it provides your needs., or consider using more full featured library like axios (https://www.npmjs.com/package/axios)
// e.g.: one drawback of this implementation is that it does not follow redirects (this can be fixed by using 3rd party modules)
// the function returns a stream.
function http_get(uri, options) {
    options = options || {};
    const client = uri.startsWith('https:') ? https : http;
    return new Promise((resolve, reject) => {
        client.get(uri, options, resolve).on('error', reject);
    });
}

/**
 * Log on accepted and closed connections to the http server, 
 * including fd and remote address for better debugging of connection issues
 * @param {net.Socket} conn 
 */
function http_server_connections_logger(conn) {
    // @ts-ignore
    const fd = conn._handle?.fd;
    const info = { port: conn.localPort, fd, remote: conn.remoteAddress };
    dbg.log0('HTTP connection accepted', info);
    conn.once('close', () => {
        dbg.log0('HTTP connection closed', info);
    });
}

/**
 * start_https_server starts the secure https server by type and options and creates a certificate if required
 * @param {number} https_port
 * @param {('S3'|'IAM'|'STS'|'METRICS'|'FORK_HEALTH')} server_type
 * @param {Object} request_handler
 */
async function start_https_server(https_port, server_type, request_handler, nsfs_config_root) {
    const ssl_cert_info = await ssl_utils.get_ssl_cert_info(server_type, nsfs_config_root);
    const https_server = await ssl_utils.create_https_server(ssl_cert_info, true, request_handler);
    https_server.on('connection', http_server_connections_logger);
    ssl_cert_info.on('update', updated_ssl_cert_info => {
        dbg.log0(`Setting updated ${server_type} ssl certs for endpoint.`);
        const updated_ssl_options = { ...updated_ssl_cert_info.cert, honorCipherOrder: true };
        https_server.setSecureContext(updated_ssl_options);
    });
    dbg.log0(`Starting ${server_type} server on HTTPS port ${https_port}`);
    await listen_port(https_port, https_server, server_type);
    dbg.log0(`Started ${server_type} HTTPS server successfully`);
    return https_server;
}

/**
 * start_http_server starts the non-secure http server by type
 * @param {number} http_port
 * @param {('S3'|'IAM'|'STS'|'METRICS'|'FORK_HEALTH')} server_type
 * @param {Object} request_handler
 */
async function start_http_server(http_port, server_type, request_handler) {
    const http_server = http.createServer(request_handler);
    http_server.on('connection', http_server_connections_logger);
    if (http_port > 0) {
        dbg.log0(`Starting ${server_type} server on HTTP port ${http_port}`);
        await listen_port(http_port, http_server, server_type);
        dbg.log0(`Started ${server_type} HTTP server successfully`);
    }
    return http_server;
}

/**
 * Listen server for http/https ports
 * @param {number} port
 * @param {http.Server} server
 * @param {('S3'|'IAM'|'STS'|'METRICS'|'FORK_HEALTH')} server_type
 */
function listen_port(port, server, server_type) {
    return new Promise((resolve, reject) => {
        if (server_type !== 'METRICS' && server_type !== 'FORK_HEALTH') {
            setup_endpoint_server(server);
        }
        const local_ip = process.env.LOCAL_IP || '0.0.0.0';
        server.listen(port, local_ip, err => {
            if (err) {
                dbg.error('ENDPOINT FAILED to listen', err);
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

/**
 * Setup endpoint socket and server, Setup is not used for non-endpoint servers.
 * @param {http.Server} server
 */
function setup_endpoint_server(server) {
    // Handle 'Expect' header different than 100-continue to conform with AWS.
    // Consider any expect value as if the client is expecting 100-continue.
    // See https://github.com/ceph/s3-tests/blob/master/s3tests/functional/test_headers.py:
    // - test_object_create_bad_expect_mismatch()
    // - test_object_create_bad_expect_empty()
    // - test_object_create_bad_expect_none()
    // - test_object_create_bad_expect_unreadable()
    // See https://nodejs.org/api/http.html#http_event_checkexpectation
    server.on('checkExpectation', function on_s3_check_expectation(req, res) {
        res.writeContinue();
        server.emit('request', req, res);
    });

    // See https://nodejs.org/api/http.html#http_event_clienterror
    server.on('clientError',
        /**
         * @param {Error & { code?: string, bytesParsed?: number }} err
         * @param {net.Socket} socket
         */
        (err, socket) => {

            if (err.code === 'ECONNRESET' || !socket.writable) {
                return;
            }
            // On parsing errors we reply 400 Bad Request to conform with AWS
            // These errors come from the nodejs native http parser.
            if (typeof err.code === 'string' &&
                err.code.startsWith('HPE_INVALID_') &&
                err.bytesParsed > 0) {
                console.error('ENDPOINT CLIENT ERROR - REPLY WITH BAD REQUEST', err);
                socket.write('HTTP/1.1 400 Bad Request\r\n');
                socket.write(`Date: ${new Date().toUTCString()}\r\n`);
                socket.write('Connection: close\r\n');
                socket.write('Content-Length: 0\r\n');
                socket.end('\r\n');
            }

            // in any case we destroy the socket
            socket.destroy();
        });

    server.keepAliveTimeout = config.ENDPOINT_HTTP_SERVER_KEEPALIVE_TIMEOUT;
    server.requestTimeout = config.ENDPOINT_HTTP_SERVER_REQUEST_TIMEOUT;
    server.maxRequestsPerSocket = config.ENDPOINT_HTTP_MAX_REQUESTS_PER_SOCKET;

    server.on('error', handle_server_error);

    // This was an attempt to read from the socket in large chunks,
    // but it seems like it has no effect and we still get small chunks
    // server.on('connection', function on_s3_connection(socket) {
    // socket._readableState.highWaterMark = 1024 * 1024;
    // socket.setNoDelay(true);
    // });
}

function handle_server_error(err) {
    dbg.error('ENDPOINT FAILED TO START on error:', err.code, err.message, err.stack || err);
    process.exit(1);
}

/**
 * set_response_headers_from_request sets the response headers based on the request headers
 * gap - response-content-encoding needs to be added with a more complex logic
 * @param {http.IncomingMessage & { query: querystring.ParsedUrlQuery }} req 
 * @param {http.ServerResponse} res 
 */
function set_response_headers_from_request(req, res) {
    dbg.log2(`set_response_headers_from_request req.query ${util.inspect(req.query)}`);
    if (req.query['response-cache-control']) res.setHeader('Cache-Control', req.query['response-cache-control']);
    if (req.query['response-content-disposition']) res.setHeader('Content-Disposition', req.query['response-content-disposition']);
    if (req.query['response-content-language']) res.setHeader('Content-Language', req.query['response-content-language']);
    if (req.query['response-content-type']) res.setHeader('Content-Type', req.query['response-content-type']);
    if (req.query['response-expires']) res.setHeader('Expires', req.query['response-expires']);
}

/**
 * Authenticate JWT bearer token for metrics / version endpoints.
 * Returns `true` on success, `false` after the function already sent an HTTP
 * response (401/403) and the caller should terminate the handler early.
 * 
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string[]} [roles]
 */
function authorize_bearer(req, res, roles = undefined) {
    const { authorization, ...rest_headers } = req.headers;

    const populate_response = () => {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'text/plain');
        res.end('Forbidden');
    };


    if (!authorization) {
        dbg.error('Authentication required:', req.method, req.url, rest_headers);
        // request lacks authentication, let the client know it's required with 401 Unauthorized
        res.statusCode = 401;
        res.setHeader('WWW-Authenticate', 'Bearer');
        res.setHeader('Content-Type', 'text/plain');
        res.end('Unauthorized');
        return false;
    }
    if (!authorization.startsWith('Bearer ')) {
        dbg.error('Authentication scheme must be Bearer:', req.method, req.url, rest_headers);
        // authentication was provided but is invalid, return 403 Forbidden.
        populate_response();
        return false;
    }
    const token = authorization.slice('Bearer '.length);
    let auth;
    try {
        auth = jwt_utils.authorize_jwt_token(token);
    } catch (err) {
        dbg.error('Authentication failed to verify JWT token:', req.method, req.url, rest_headers, err);
        populate_response();
        return false;
    }
    if (roles && !roles.includes(auth.role)) {
        dbg.error('Authentication role is not allowed:', auth, roles, req.method, req.url, rest_headers);
        populate_response();
        return false;
    }
    return true;
}

exports.hdr_as_str = hdr_as_str;
exports.hdr_as_arr = hdr_as_arr;
exports.parse_url_query = parse_url_query;
exports.parse_client_ip = parse_client_ip;
exports.get_md_conditions = get_md_conditions;
exports.check_md_conditions = check_md_conditions;
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
exports.make_http_request = make_http_request;
exports.set_keep_alive_whitespace_interval = set_keep_alive_whitespace_interval;
exports.parse_xml_to_js = parse_xml_to_js;
exports.check_headers = check_headers;
exports.set_amz_headers = set_amz_headers;
exports.set_expiration_header = set_expiration_header;
exports.set_cors_headers = set_cors_headers;
exports.set_cors_headers_s3 = set_cors_headers_s3;
exports.set_cors_headers_sts = set_cors_headers_sts;
exports.parse_content_length = parse_content_length;
exports.authorize_session_token = authorize_session_token;
exports.get_agent_by_endpoint = get_agent_by_endpoint;
exports.validate_server_ip_whitelist = validate_server_ip_whitelist;
exports.http_get = http_get;
exports.start_http_server = start_http_server;
exports.start_https_server = start_https_server;
exports.http_server_connections_logger = http_server_connections_logger;
exports.CONTENT_TYPE_TEXT_PLAIN = CONTENT_TYPE_TEXT_PLAIN;
exports.CONTENT_TYPE_APP_OCTET_STREAM = CONTENT_TYPE_APP_OCTET_STREAM;
exports.CONTENT_TYPE_APP_JSON = CONTENT_TYPE_APP_JSON;
exports.CONTENT_TYPE_APP_XML = CONTENT_TYPE_APP_XML;
exports.CONTENT_TYPE_APP_FORM_URLENCODED = CONTENT_TYPE_APP_FORM_URLENCODED;
exports.set_response_headers_from_request = set_response_headers_from_request;
exports.authorize_bearer = authorize_bearer;
