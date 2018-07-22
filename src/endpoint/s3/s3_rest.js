/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const fs = require('fs');
const path = require('path');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const S3Error = require('./s3_errors').S3Error;
const js_utils = require('../../util/js_utils');
const time_utils = require('../../util/time_utils');
const http_utils = require('../../util/http_utils');
const net = require('net');
const signature_utils = require('../../util/signature_utils');

const S3_MAX_BODY_LEN = 4 * 1024 * 1024;

const S3_XML_ROOT_ATTRS = Object.freeze({
    xmlns: 'http://s3.amazonaws.com/doc/2006-03-01'
});

const BUCKET_SUB_RESOURCES = Object.freeze({
    accelerate: 1,
    acl: 1,
    analytics: 1,
    cors: 1,
    delete: 1,
    inventory: 1,
    lifecycle: 1,
    location: 1,
    logging: 1,
    metrics: 1,
    notification: 1,
    policy: 1,
    replication: 1,
    requestPayment: 1,
    tagging: 1,
    uploads: 1,
    versioning: 1,
    versions: 1,
    website: 1,
});

const OBJECT_SUB_RESOURCES = Object.freeze({
    acl: 1,
    restore: 1,
    tagging: 1,
    torrent: 1,
    uploads: 1,
    uploadId: 1,
});

const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';
const STREAMING_PAYLOAD = 'STREAMING-AWS4-HMAC-SHA256-PAYLOAD';

const RPC_ERRORS_TO_S3 = Object.freeze({
    UNAUTHORIZED: S3Error.AccessDenied,
    FORBIDDEN: S3Error.AccessDenied,
    NO_SUCH_BUCKET: S3Error.NoSuchBucket,
    NO_SUCH_OBJECT: S3Error.NoSuchKey,
    INVALID_BUCKET_NAME: S3Error.InvalidBucketName,
    NOT_EMPTY: S3Error.BucketNotEmpty,
    BUCKET_ALREADY_EXISTS: S3Error.BucketAlreadyExists,
    NO_SUCH_UPLOAD: S3Error.NoSuchUpload,
    BAD_DIGEST_MD5: S3Error.BadDigest,
    BAD_DIGEST_SHA256: S3Error.XAmzContentSHA256Mismatch,
    BAD_SIZE: S3Error.IncompleteBody,
    IF_MODIFIED_SINCE: S3Error.NotModified,
    IF_UNMODIFIED_SINCE: S3Error.PreconditionFailed,
    IF_MATCH_ETAG: S3Error.PreconditionFailed,
    IF_NONE_MATCH_ETAG: S3Error.NotModified,
    OBJECT_IO_STREAM_ITEM_TIMEOUT: S3Error.SlowDown,
    INVALID_PART: S3Error.InvalidPart,
    INVALID_PORT_ORDER: S3Error.InvalidPartOrder,
});

const S3_OPS = load_ops();

let usage_report = new_usage_report();

function s3_rest(req, res) {
    return P.try(() => handle_request(req, res))
        .catch(err => handle_error(req, res, err));
}

function handle_request(req, res) {

    // fill up standard amz response headers
    res.setHeader('x-amz-request-id', req.request_id);
    res.setHeader('x-amz-id-2', req.request_id);

    // note that browsers will not allow origin=* with credentials
    // but anyway we allow it by the agent server.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers',
        'Content-Type,Content-MD5,Authorization,X-Amz-User-Agent,X-Amz-Date,ETag,X-Amz-Content-Sha256');
    res.setHeader('Access-Control-Expose-Headers', 'ETag,X-Amz-Version-Id');

    if (req.method === 'OPTIONS') {
        dbg.log0('OPTIONS!');
        res.statusCode = 200;
        res.end();
        return;
    }

    check_headers(req);
    const op_name = parse_op_name(req);
    authenticate_request(req);

    dbg.log0('S3 REQUEST', req.method, req.originalUrl, 'op', op_name, 'request_id', req.request_id, req.headers);
    usage_report.s3_usage_info.total_calls += 1;
    usage_report.s3_usage_info[op_name] = (usage_report.s3_usage_info[op_name] || 0) + 1;
    const op = S3_OPS[op_name];
    if (!op || !op.handler) {
        dbg.error('S3 TODO (NotImplemented)', op_name, req.method, req.originalUrl);
        throw new S3Error(S3Error.NotImplemented);
    }

    const options = {
        body: op.body,
        reply: op.reply,
        MAX_BODY_LEN: S3_MAX_BODY_LEN,
        XML_ROOT_ATTRS: S3_XML_ROOT_ATTRS,
        ErrorClass: S3Error,
        error_max_body_len_exceeded: S3Error.MaxMessageLengthExceeded,
        error_missing_body: S3Error.MissingRequestBodyError,
        error_invalid_body: op.body.invalid_error || (op.body.type === 'xml' ? S3Error.MalformedXML : S3Error.InvalidRequest),
        error_body_sha256_mismatch: S3Error.XAmzContentSHA256Mismatch,
    };

    return P.resolve()
        .then(() => http_utils.read_and_parse_body(req, options))
        .then(() => op.handler(req, res))
        .then(reply => http_utils.send_reply(req, res, reply, options))
        .then(() => submit_usage_report(op, req, res));
}

function check_headers(req, res) {
    _.each(req.headers, (val, key) => {
        // test for non printable characters
        // 403 is required for unreadable headers
        // eslint-disable-next-line no-control-regex
        if ((/[\x00-\x1F]/).test(val) || (/[\x00-\x1F]/).test(key)) {
            dbg.warn('Invalid header characters', key, val);
            if (key.startsWith('x-amz-meta-')) {
                throw new S3Error(S3Error.InvalidArgument);
            }
            if (key !== 'expect') {
                throw new S3Error(S3Error.AccessDenied);
            }
        }
    });
    _.each(req.query, (val, key) => {
        // test for non printable characters
        // 403 is required for unreadable query
        // eslint-disable-next-line no-control-regex
        if ((/[\x00-\x1F]/).test(val) || (/[\x00-\x1F]/).test(key)) {
            dbg.warn('Invalid query characters', key, val);
            if (key !== 'marker') {
                throw new S3Error(S3Error.InvalidArgument);
            }
        }
    });

    if (req.headers['content-length'] === '') {
        throw new S3Error(S3Error.BadRequestWithoutCode);
    }

    const content_md5_b64 = req.headers['content-md5'];
    if (typeof content_md5_b64 === 'string') {
        req.content_md5 = Buffer.from(content_md5_b64, 'base64');
        if (req.content_md5.length !== 16) {
            throw new S3Error(S3Error.InvalidDigest);
        }
    }

    req.content_sha256 = req.query['X-Amz-Signature'] ?
        UNSIGNED_PAYLOAD :
        req.headers['x-amz-content-sha256'];
    if (typeof req.content_sha256 === 'string' &&
        req.content_sha256 !== UNSIGNED_PAYLOAD &&
        req.content_sha256 !== STREAMING_PAYLOAD) {
        req.content_sha256_buf = Buffer.from(req.content_sha256, 'hex');
        if (req.content_sha256_buf.length !== 32) {
            throw new S3Error(S3Error.InvalidDigest);
        }
    }

    const req_time =
        time_utils.parse_amz_date(req.headers['x-amz-date'] || req.query['X-Amz-Date']) ||
        time_utils.parse_http_header_date(req.headers.date);
    if (Math.abs(Date.now() - req_time) > config.AMZ_DATE_MAX_TIME_SKEW_MILLIS) {
        throw new S3Error(S3Error.RequestTimeTooSkewed);
    }
}

function authenticate_request(req, res) {
    try {
        const auth_token = signature_utils.make_auth_token_from_request(req);
        if (auth_token) {
            auth_token.client_ip = http_utils.parse_client_ip(req);
        }
        req.object_sdk.set_auth_token(auth_token);
        signature_utils.check_request_expiry(req);
    } catch (err) {
        dbg.error('authenticate_request: ERROR', err.stack || err);
        throw new S3Error(S3Error.AccessDenied);
    }
}

function parse_op_name(req) {
    const virtual_host_suffix = req.virtual_host_suffix;
    const method = req.method.toLowerCase();
    const host = req.headers.host.split(':')[0]; // cutting off port
    const url = req.url;

    var bucket = '';
    var key = '';
    var i;

    // see http://docs.aws.amazon.com/AmazonS3/latest/dev/VirtualHosting.html
    const is_path_style = !host ||
        !virtual_host_suffix || // added case for when no DNS name is defined - if we work with IP always using path-style
        virtual_host_suffix === '.' + host ||
        net.isIP(host) ||
        host === 'localhost'; // we added this case on top of the S3 doc cases to handle requests with IP host

    const is_bucket_subdomain =
        virtual_host_suffix &&
        host.endsWith(virtual_host_suffix) &&
        host !== virtual_host_suffix; // non empty bucket name

    if (is_path_style) {
        const index = url.indexOf('/', 1);
        const pos = index < 0 ? url.length : index;
        bucket = url.slice(1, pos);
        key = url.slice(pos + 1);
    } else if (is_bucket_subdomain) {
        bucket = host.slice(0, -virtual_host_suffix.length);
        key = url.slice(1);
        req.virtual_hosted_bucket = bucket;
    } else { // bucket is host - assume DNS points that name to us
        bucket = host;
        key = url.slice(1);
        req.virtual_hosted_bucket = bucket;
    }

    // decode and replace hadoop _$folder$ in key
    bucket = decodeURIComponent(bucket);
    key = decodeURIComponent(key).replace(/_\$folder\$/, '/');
    req.params = { bucket, key };

    // service url
    if (!bucket) return `${method}_service`;

    // bucket url
    if (!key) {
        const query_keys = Object.keys(req.query);
        for (i = 0; i < query_keys.length; ++i) {
            if (BUCKET_SUB_RESOURCES[query_keys[i]]) return `${method}_bucket_${query_keys[i]}`;
        }
        return `${method}_bucket`;
    }

    // object url
    const query_keys = Object.keys(req.query);
    for (i = 0; i < query_keys.length; ++i) {
        if (OBJECT_SUB_RESOURCES[query_keys[i]]) return `${method}_object_${query_keys[i]}`;
    }
    return `${method}_object`;
}

function handle_error(req, res, err) {
    var s3err =
        ((err instanceof S3Error) && err) ||
        new S3Error(RPC_ERRORS_TO_S3[err.rpc_code] || S3Error.InternalError);

    if (s3err.rpc_data) {
        if (s3err.rpc_data.etag) {
            res.setHeader('ETag', s3err.rpc_data.etag);
        }
        if (s3err.rpc_data.last_modified) {
            res.setHeader('Last-Modified', time_utils.format_http_header_date(new Date(s3err.rpc_data.last_modified)));
        }
    }

    // md_conditions used for PUT/POST/DELETE should return PreconditionFailed instead of NotModified
    if (s3err.code === 'NotModified' && req.method !== 'HEAD' && req.method !== 'GET') {
        s3err = new S3Error(S3Error.PreconditionFailed);
    }

    usage_report.s3_errors_info.total_errors += 1;
    usage_report.s3_errors_info[s3err.code] = (usage_report.s3_errors_info[s3err.code] || 0) + 1;

    const reply = s3err.reply(req.originalUrl, req.request_id);
    dbg.error('S3 ERROR', reply,
        req.method, req.originalUrl,
        JSON.stringify(req.headers),
        err.stack || err);
    res.statusCode = s3err.http_code;
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Length', Buffer.byteLength(reply));
    res.end(reply);
}

function new_usage_report() {
    return {
        s3_usage_info: {
            total_calls: 0,
        },
        s3_errors_info: {
            total_errors: 0,
        },
        bandwidth_usage_info: new Map(),
        start_time: Date.now(),
    };
}

function submit_usage_report(op, req, res) {
    // We check we've passed authenticate_request and have a valid token.
    // Errors prior to authenticate_request or bad signature will not be reported and even fail on the report call itself
    // TODO use appropriate auth for usage report instead of piggybacking the s3 request
    if (!req.object_sdk.get_auth_token()) return;
    const bucket_usage = op.get_bucket_usage && op.get_bucket_usage(req, res);
    if (bucket_usage) {
        const {
            bucket,
            access_key = '',
            read_bytes = 0,
            write_bytes = 0,
            read_count = 0,
            write_count = 0,
        } = bucket_usage;
        const bucket_and_access_key = bucket + '#' + access_key;
        let bucket_usage_info = usage_report.bandwidth_usage_info.get(bucket_and_access_key);
        if (!bucket_usage_info) {
            bucket_usage_info = {
                bucket,
                access_key,
                read_count: 0,
                read_bytes: 0,
                write_count: 0,
                write_bytes: 0,
            };
            usage_report.bandwidth_usage_info.set(bucket_and_access_key, bucket_usage_info);
        }
        bucket_usage_info.read_bytes += read_bytes;
        bucket_usage_info.read_count += read_count;
        bucket_usage_info.write_bytes += write_bytes;
        bucket_usage_info.write_count += write_count;
    }

    // if there is any information to send, and enough time passed (30 secs), then send report
    const now = Date.now();
    const time_since_last_report = now - usage_report.start_time;
    const num_reports = usage_report.s3_usage_info.total_calls +
        usage_report.s3_errors_info.total_errors +
        usage_report.bandwidth_usage_info.size;

    if (num_reports === 0 || time_since_last_report < 30000) return;

    const report_to_send = usage_report;
    report_to_send.end_time = now;
    usage_report = new_usage_report();

    const map_values = report_to_send.bandwidth_usage_info.values();
    const bandwidth_usage_info = Array.from(map_values);
    // submit to background
    const rpc_req = {
        start_time: report_to_send.start_time,
        end_time: report_to_send.end_time,
        s3_usage_info: report_to_send.s3_usage_info,
        s3_errors_info: report_to_send.s3_errors_info,
        bandwidth_usage_info
    };
    dbg.log0(`sending report`, rpc_req);
    req.object_sdk.rpc_client.object.add_endpoint_usage_report(rpc_req)
        .catch(err => {
            console.log('add_endpoint_usage_report did not succeed:', err);
        });

    // maybe use a different indication that this is endpoint agent?
    // if process.send exist assuming it is an endpoint agent. send stats to agent process
    if (process.send) {
        process.send({
            code: 'STATS',
            stats: bandwidth_usage_info,
            time: report_to_send.end_time
        });
    }
}

function load_ops() {
    return js_utils.deep_freeze(new js_utils.PackedObject(
        _.mapValues(
            _.mapKeys(
                fs.readdirSync(path.join(__dirname, 'ops')),
                file => file.match(/^s3_([a-zA-Z0-9_]+)\.js$/)[1]
            ),
            file => require(`./ops/${file}`) // eslint-disable-line global-require
        )
    ));
}

// EXPORTS
module.exports = s3_rest;
