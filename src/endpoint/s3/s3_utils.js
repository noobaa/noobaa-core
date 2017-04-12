/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const querystring = require('querystring');

const dbg = require('../../util/debug_module')(__filename);
const S3Error = require('./s3_errors').S3Error;
const http_utils = require('../../util/http_utils');

const STORAGE_CLASS_STANDARD = 'STANDARD';

const DEFAULT_S3_USER = Object.freeze({
    ID: '123',
    DisplayName: 'NooBaa'
});

function format_s3_xml_date(input) {
    let date = input ? new Date(input) : new Date();
    date.setMilliseconds(0);
    return date.toISOString();
}

function get_request_xattr(req) {
    let xattr = {};
    _.each(req.headers, (val, hdr) => {
        if (!hdr.startsWith('x-amz-meta-')) return;
        let key = hdr.slice('x-amz-meta-'.length);
        if (!key) return;
        xattr[key] = val;
    });
    return xattr;
}

function set_response_xattr(res, xattr) {
    _.each(xattr, (val, key) => {
        res.setHeader('x-amz-meta-' + key, val);
    });
}

function parse_etag(etag, err) {
    const match = (/\s*"(.*)"\s*/).exec(etag);
    if (!match) throw new S3Error(err);
    return match[1];
}

function parse_content_length(req) {
    const size = Number(req.headers['content-length']);
    if (!Number.isInteger(size) || size < 0) {
        dbg.warn('Missing content-length', req.headers['content-length']);
        throw new S3Error(S3Error.MissingContentLength);
    }
    return size;
}

function parse_part_number(num_str, err) {
    const num = Number(num_str);
    if (!Number.isInteger(num) || num < 1 || num > 10000) {
        dbg.warn('Invalid partNumber', num_str);
        throw new S3Error(err);
    }
    return num;
}

function parse_copy_source(req) {
    const source_url = req.headers['x-amz-copy-source'];
    if (!source_url) return;

    // I wonder: do we want to support copy source url with host:port too?

    let slash_index = source_url.indexOf('/');
    let start_index = 0;
    if (slash_index === 0) {
        start_index = 1;
        slash_index = source_url.indexOf('/', 1);
    }
    let query_index = source_url.indexOf('?', slash_index);
    let query;
    if (query_index < 0) {
        query_index = source_url.length;
    } else {
        query = querystring.parse(source_url.slice(query_index + 1));
    }

    const bucket = decodeURIComponent(source_url.slice(start_index, slash_index));
    const key = decodeURIComponent(source_url.slice(slash_index + 1, query_index));
    const version = query && query.versionId;
    const range = http_utils.parse_http_range(req.headers['x-amz-copy-source-range']);
    return {
        bucket,
        key,
        version,
        range,
    };
}

function check_md_conditions(req, res, object_md) {
    // See http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectHEAD.html#req-header-consideration-1
    // See https://tools.ietf.org/html/rfc7232 (HTTP Conditional Requests)
    let matched = false;
    let unmatched = false;
    if ('if-match' in req.headers) {
        if (!http_utils.match_etag(req.headers['if-match'], object_md.etag)) {
            throw new S3Error(S3Error.PreconditionFailed);
        }
        matched = true;
    }
    if ('if-none-match' in req.headers) {
        if (http_utils.match_etag(req.headers['if-none-match'], object_md.etag)) {
            if (req.method === 'GET' || req.method === 'HEAD') {
                throw new S3Error(S3Error.NotModified);
            } else {
                throw new S3Error(S3Error.PreconditionFailed);
            }
        }
        unmatched = true;
    }
    if ('if-modified-since' in req.headers) {
        if (!unmatched && object_md.create_time <= (new Date(req.headers['if-modified-since'])).getTime()) {
            throw new S3Error(S3Error.NotModified);
        }
    }
    if ('if-unmodified-since' in req.headers) {
        if (!matched && object_md.create_time >= (new Date(req.headers['if-unmodified-since'])).getTime()) {
            throw new S3Error(S3Error.PreconditionFailed);
        }
    }
}

function set_md_conditions(req, params, params_key, prefix) {
    var cond = params[params_key];
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
    if (params[params_key] !== cond) {
        params[params_key] = cond;
    }
}


exports.STORAGE_CLASS_STANDARD = STORAGE_CLASS_STANDARD;
exports.DEFAULT_S3_USER = DEFAULT_S3_USER;
exports.format_s3_xml_date = format_s3_xml_date;
exports.get_request_xattr = get_request_xattr;
exports.set_response_xattr = set_response_xattr;
exports.parse_etag = parse_etag;
exports.parse_content_length = parse_content_length;
exports.parse_part_number = parse_part_number;
exports.parse_copy_source = parse_copy_source;
exports.check_md_conditions = check_md_conditions;
exports.set_md_conditions = set_md_conditions;
