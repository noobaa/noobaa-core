/* Copyright (C) 2016 NooBaa */
'use strict';

const url = require('url');

const _ = require('lodash');
const time_utils = require('../../util/time_utils');
const endpoint_utils = require('../endpoint_utils');

function set_response_object_md(res, object_md) {
    res.setHeader('ETag', '"' + object_md.etag + '"');
    res.setHeader('Last-Modified', time_utils.format_http_header_date(new Date(object_md.create_time)));
    res.setHeader('Content-Type', object_md.content_type);
    res.setHeader('Content-Length', object_md.size);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('x-ms-lease-status', 'unlocked');
    res.setHeader('x-ms-lease-state', 'available');
    res.setHeader('x-ms-blob-type', 'BlockBlob');
    res.setHeader('x-ms-server-encrypted', false);
    set_response_xattr(res, object_md.xattr);
}

const X_MS_META = 'x-ms-meta-';

function get_request_xattr(req) {
    let xattr = {};
    _.each(req.headers, (val, hdr) => {
        if (!hdr.startsWith(X_MS_META)) return;
        let key = hdr.slice(X_MS_META.length);
        if (!key) return;
        xattr[key] = val;
    });
    return xattr;
}

function set_response_xattr(res, xattr) {
    _.each(xattr, (val, key) => {
        res.setHeader(X_MS_META + key, val);
    });
}

function parse_etag(etag) {
    const match = (/^\s*(?:"(\S*)"|(\S*))\s*$/).exec(etag);
    if (match) return match[1] || match[2];
    return etag;
}

function parse_copy_source(req) {
    const copy_source = req.headers['x-ms-copy-source'];
    if (!copy_source) return;
    const source_url = url.parse(copy_source).path;
    return _.pick(endpoint_utils.parse_source_url(source_url), 'bucket', 'key');
}


exports.set_response_object_md = set_response_object_md;
exports.get_request_xattr = get_request_xattr;
exports.set_response_xattr = set_response_xattr;
exports.parse_etag = parse_etag;
exports.parse_copy_source = parse_copy_source;
