/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const querystring = require('querystring');

const dbg = require('../../util/debug_module')(__filename);
const S3Error = require('./s3_errors').S3Error;
const http_utils = require('../../util/http_utils');
const time_utils = require('../../util/time_utils');

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

const X_AMZ_META = 'x-amz-meta-';

function get_request_xattr(req) {
    let xattr = {};
    _.each(req.headers, (val, hdr) => {
        if (!hdr.startsWith(X_AMZ_META)) return;
        let key = hdr.slice(X_AMZ_META.length);
        if (!key) return;
        xattr[key] = val;
    });
    return xattr;
}

function set_response_xattr(res, xattr) {
    _.each(xattr, (val, key) => {
        res.setHeader(X_AMZ_META + key, val);
    });
}

function parse_etag(etag, err) {
    const match = (/^\s*(?:"(\S*)"|(\S*))\s*$/).exec(etag);
    if (match) return match[1] || match[2];
    if (err) throw new S3Error(err);
    return etag;
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

function format_copy_source(params) {
    if (!params) return;
    const range_str = http_utils.format_http_range(params.range);
    let copy_source_str = `/${params.bucket}/${params.key}`;
    if (params.version) {
        copy_source_str += `?versionId=${params.version}`;
    }
    return {
        copy_source: copy_source_str,
        range: range_str
    };
}

function set_response_object_md(res, object_md) {
    res.setHeader('ETag', '"' + object_md.etag + '"');
    res.setHeader('Last-Modified', time_utils.format_http_header_date(new Date(object_md.create_time)));
    res.setHeader('Content-Type', object_md.content_type);
    res.setHeader('Content-Length', object_md.size);
    res.setHeader('Accept-Ranges', 'bytes');
    set_response_xattr(res, object_md.xattr);
    return object_md;
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
exports.format_copy_source = format_copy_source;
exports.set_response_object_md = set_response_object_md;
