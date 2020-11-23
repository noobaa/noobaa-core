/* Copyright (C) 2016 NooBaa */
'use strict';

const url = require('url');

const _ = require('lodash');
const time_utils = require('../../util/time_utils');
const endpoint_utils = require('../endpoint_utils');
const { make_https_request, parse_xml_to_js } = require('../../util/http_utils');
const { read_stream_join } = require('../../util/buffer_utils');

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




//////// BLOB API UTILS ////////

// https://docs.microsoft.com/en-us/rest/api/storageservices/list-blobs
// This API called directly because of an inefficient matching function of the Azure blob SDK.
async function list_objects(params, account_name, container, sasToken) {

    const hostname = `${account_name}.blob.core.windows.net`;

    let path = `https://${account_name}.blob.core.windows.net/${container}?restype=container&comp=list` +
        `&maxresults=${params.limit}&${sasToken}`;
    if (params.key_marker) path += `&marker=${params.key_marker}`;
    if (params.delimiter) path += `&delimiter=${params.delimiter}`;
    if (params.prefix) path += `&prefix=${params.prefix}`;

    let response;
    try {
        response = await make_https_request({ hostname, port: 443, path, method: 'GET' });
    } catch (err) {
        throw new Error(`GET ${path} did not responed or returned with an error ${err}`);
    }
    const status_code = response.statusCode;
    const buffer = await read_stream_join(response);
    const body = buffer.toString('utf8');

    let blobs;
    let dirs;
    let next_marker;
    try {
        const parsed = await parse_xml_to_js(body);
        if (status_code !== 200) {
            if (parsed.Error) {
                const code = parsed.Error.Code && parsed.Error.Code[0];
                const faulty_query_param = parsed.Error.QueryParameterName &&
                    parsed.Error.QueryParameterName[0];
                if (code === 'OutOfRangeQueryParameterValue' &&
                    faulty_query_param === 'maxresults' && params.limit === 0) {
                        return { blobs: [], dirs: [], next_marker: '' };
                    }
            }
            throw new Error(`Could not get blobs and diresctories list, (status code: ${status_code}) got ${body}`);
        }
        blobs = parsed.EnumerationResults.Blobs[0].Blob;
        dirs = parsed.EnumerationResults.Blobs[0].BlobPrefix;
        next_marker = parsed.EnumerationResults.NextMarker[0];
        let parse_blobs = key => {
            const props = key.Properties[0];
            let obj = Object.keys(props).reduce((acc, p) => {
                acc[(_.lowerFirst(_.camelCase(p)))] = props[p][0];
                return acc;
            }, { name: key.Name[0] });
            return obj;
        };
        blobs = _.map(blobs, obj => parse_blobs(obj));
    } catch (err) {
        throw new Error(`could not parse body ${body} got error ${err}`);
    }
    return { blobs, dirs, next_marker };
}


exports.list_objects = list_objects;
exports.set_response_object_md = set_response_object_md;
exports.get_request_xattr = get_request_xattr;
exports.set_response_xattr = set_response_xattr;
exports.parse_etag = parse_etag;
exports.parse_copy_source = parse_copy_source;
