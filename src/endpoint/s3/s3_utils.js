/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const dbg = require('../../util/debug_module')(__filename);
const S3Error = require('./s3_errors').S3Error;
const http_utils = require('../../util/http_utils');
const time_utils = require('../../util/time_utils');
const endpoint_utils = require('../endpoint_utils');

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


function parse_sse_c(req) {
    const sse_c_key_md5 = req.headers['x-amz-server-side-encryption-customer-key-md5'];
    const sse_c_algo = req.headers['x-amz-server-side-encryption-customer-algorithm'];
    const sse_c_key = req.headers['x-amz-server-side-encryption-customer-key'];

    if (!sse_c_key_md5 && !sse_c_algo && !sse_c_key) return;

    return {
        key_md5: _parse_sse_c_key_md5(sse_c_key_md5),
        key: _parse_sse_c_key(sse_c_key),
        algo: _parse_sse_c_algo(sse_c_algo)
    };
}

// function parse_sse(req) {
//     const sse_enc = req.headers['x-amz-server-side-encryption'];
//     const sse_key = req.headers['x-amz-server-side-encryption-aws-kms-key-id'];

//     if (!sse_enc) return;

//     return {
//         key_md5: _parse_sse_key_md5(sse_key_md5),
//         key: _parse_sse_key(sse_key),
//         sse_enc: _parse_sse_enc(sse_enc)
//     };
// }


function _parse_sse_c_key_md5(md5) {
    // TODO: More suitable error and better check
    const md5_regex = new RegExp('/^[a-f0-9]{32}$/');
    if (md5 === '' || !md5_regex.test(md5)) throw new S3Error(S3Error.InvalidDigest);
    return md5;
}

function _parse_sse_c_key(sse_c_key) {
    // TODO: More suitable error and better check
    const base64_regex = new RegExp('^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$');
    if (sse_c_key === '' || !base64_regex.test(sse_c_key)) throw new S3Error(S3Error.InvalidDigest);
    return sse_c_key;
}

function _parse_sse_c_algo(sse_c_algo) {
    // TODO: More suitable error and better check
    if (sse_c_algo === '' || sse_c_algo !== 'AES256') throw new S3Error(S3Error.InvalidDigest);
    return sse_c_algo;
}

// function _parse_sse_enc(sse_enc) {
//     // TODO: More suitable error and better check
//     if (sse_enc === '' || (sse_enc !== 'AES256' && sse_enc !== 'aws:kms')) throw new S3Error(S3Error.InvalidDigest);
//     return sse_enc;
// }

function parse_content_length(req) {
    const size = Number(req.headers['x-amz-decoded-content-length'] || req.headers['content-length']);
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
    const { query, bucket, key } = endpoint_utils.parse_source_url(source_url);
    const version_id = query && query.versionId;
    const ranges = http_utils.parse_http_ranges(req.headers['x-amz-copy-source-range']);
    return { bucket, key, version_id, ranges };
}

function format_copy_source(copy_source) {
    if (!copy_source) return;
    const copy_source_range = http_utils.format_http_ranges(copy_source.ranges);
    let copy_source_str = `/${copy_source.bucket}/${copy_source.key}`;
    if (copy_source.version_id) {
        copy_source_str += `?versionId=${copy_source.version_id}`;
    }
    return {
        copy_source: copy_source_str,
        copy_source_range,
    };
}

function set_response_object_md(res, object_md) {
    res.setHeader('ETag', '"' + object_md.etag + '"');
    res.setHeader('Last-Modified', time_utils.format_http_header_date(new Date(object_md.create_time)));
    res.setHeader('Content-Type', object_md.content_type);
    res.setHeader('Content-Length', object_md.size);
    res.setHeader('Accept-Ranges', 'bytes');
    if (object_md.version_id) res.setHeader('x-amz-version-id', object_md.version_id);
    set_response_xattr(res, object_md.xattr);
    if (object_md.tag_count) res.setHeader('x-amz-tagging-count', object_md.tag_count);
    return object_md;
}

// Source: https://docs.aws.amazon.com/AmazonS3/latest/dev/object-tagging.html
function parse_body_tagging_xml(req) {
    const tagging = req.body.Tagging;
    if (!tagging) throw new S3Error(S3Error.MalformedXML);
    const tag_set = tagging.TagSet[0];
    const tag_key_names = ['Key', 'Value'];
    const tag_set_map = _.map(tag_set.Tag, tag => {
        const tag_keys = Object.keys(tag);
        if (!_.isEmpty(_.difference(tag_keys, tag_key_names)) ||
            tag_keys.length !== tag_key_names.length) throw new S3Error(S3Error.InvalidTag);
        return {
            key: tag.Key && tag.Key[0],
            value: tag.Value && tag.Value[0]
        };
    });
    if (!tag_set_map || tag_set_map.length > 10) throw new S3Error(S3Error.InvalidTag);
    const tag_map = new Map();
    tag_set_map.forEach(tag => {
        if (!_is_valid_tag_values(tag)) throw new S3Error(S3Error.InvalidTag);
        if (tag_map.has(tag.key)) throw new S3Error(S3Error.InvalidTag);
        tag_map.set(tag.key);
    });
    return tag_set_map;
}

function _is_valid_tag_values(tag) {
    if (tag.key.length > 128 || tag.value.length > 256) return false;
    return true;
}

function parse_tagging_header(req) {
    const tagging_header = req.headers['x-amz-tagging'];
    if (!tagging_header) return;
    let tagging_params;
    try {
        tagging_params = new URLSearchParams(tagging_header);
    } catch (err) {
        dbg.error('parse_tagging_header failed', err);
        throw new S3Error(S3Error.MalformedXML);
    }
    const tag_set = [];
    const tag_map = new Map();
    tagging_params.forEach((value, key) => {
        const tag = { key, value };
        if (!_is_valid_tag_values(tag)) throw new S3Error(S3Error.InvalidTag);
        if (tag_map.has(tag.key)) throw new S3Error(S3Error.InvalidTag);
        tag_map.set(tag.key);
        tag_set.push(tag);
    });
    if (tag_set.length > 10) throw new S3Error(S3Error.InvalidTag);
    return tag_set;
}

/*
Specifies whether the object tags are copied from the source object or replaced with tags provided in the request.
If the tags are copied, the tagset remains unchanged.
If the tags are replaced, all of the original tagset is replaced by the tags you specify.
If you don't specify a tagging directive, Amazon S3 copies tags by default.
If the tagging directive is REPLACE, you specify any tags in url format in the x-amz-tagging header, similar to using a PUT object with tags.
If the tagging directive is REPLACE, but you don't specify the x-amz-tagging in the request, the destination object won't have tags.
Type: String
Default: COPY
Valid values: COPY | REPLACE
Constraints: Values other than COPY or REPLACE result in an immediate 400-based error response.
*/
function is_copy_tagging_directive(req) {
    const allowed_values = ['COPY', 'REPLACE'];
    const tagging_directive = req.headers['x-amz-tagging-directive'];
    if (!tagging_directive) return true;
    if (!allowed_values.includes(tagging_directive)) throw new S3Error(S3Error.InvalidArgument);
    if (tagging_directive === 'COPY') return true;
    return false;
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
exports.parse_sse_c = parse_sse_c;
// exports.parse_sse = parse_sse;
exports.parse_body_tagging_xml = parse_body_tagging_xml;
exports.parse_tagging_header = parse_tagging_header;
exports.is_copy_tagging_directive = is_copy_tagging_directive;
