/* Copyright (C) 2016 NooBaa */
'use strict';

const querystring = require('querystring');
const http_utils = require('../util/http_utils');
const pkg = require('../../package.json');
const config = require('../../config');

function prepare_rest_request(req) {
    // generate request id, this is lighter than uuid
    req.request_id = `${
        Date.now().toString(36)
    }-${
        process.hrtime()[1].toString(36)
    }-${
        Math.trunc(Math.random() * 65536).toString(36)
    }`;
    http_utils.parse_url_query(req);
}

function parse_source_url(source_url) {
    let query_index = source_url.indexOf('?');
    let query;
    if (query_index < 0) {
        query_index = source_url.length;
    } else {
        query = querystring.parse(source_url.slice(query_index + 1));
    }

    // '/' may be encoded, first decde the bucket/key part
    const decoded_source_url = decodeURIComponent(source_url.slice(0, query_index));
    let slash_index = decoded_source_url.indexOf('/');
    let start_index = 0;
    if (slash_index === 0) {
        start_index = 1;
        slash_index = decoded_source_url.indexOf('/', 1);
    }
    const bucket = decoded_source_url.slice(start_index, slash_index);
    const key = decoded_source_url.slice(slash_index + 1);
    return { query, bucket, key };
}

function set_noobaa_server_header(res) {
    if (!config.NOOBAA_VERSION_AUTH_ENABLED) {
        res.setHeader('Server', `NooBaa/${pkg.version}`);
    }
}

exports.prepare_rest_request = prepare_rest_request;
exports.parse_source_url = parse_source_url;
exports.set_noobaa_server_header = set_noobaa_server_header;
