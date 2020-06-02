/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const fs = require('fs');
const path = require('path');

const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const S3Error = require('./s3_errors').S3Error;
const js_utils = require('../../util/js_utils');
const time_utils = require('../../util/time_utils');
const http_utils = require('../../util/http_utils');
const s3_utils = require('./s3_utils');
const net = require('net');
const signature_utils = require('../../util/signature_utils');

const S3_MAX_BODY_LEN = 4 * 1024 * 1024;

const S3_XML_ROOT_ATTRS = Object.freeze({
    xmlns: 'http://s3.amazonaws.com/doc/2006-03-01/'
});

const BUCKET_SUB_RESOURCES = Object.freeze({
    'accelerate': 'accelerate',
    'acl': 'acl',
    'analytics': 'analytics',
    'cors': 'cors',
    'delete': 'delete',
    'inventory': 'inventory',
    'lifecycle': 'lifecycle',
    'location': 'location',
    'logging': 'logging',
    'metrics': 'metrics',
    'notification': 'notification',
    'policy': 'policy',
    'replication': 'replication',
    'requestPayment': 'requestPayment',
    'tagging': 'tagging',
    'uploads': 'uploads',
    'versioning': 'versioning',
    'versions': 'versions',
    'website': 'website',
    'encryption': 'encryption',
    'object-lock': 'object_lock',
    'legal-hold': 'legal_hold',
    'retention': 'retention'
});

const OBJECT_SUB_RESOURCES = Object.freeze({
    'acl': 'acl',
    'restore': 'restore',
    'tagging': 'tagging',
    'torrent': 'torrent',
    'uploads': 'uploads',
    'uploadId': 'uploadId',
    'legal-hold': 'legal_hold',
    'retention': 'retention'
});

const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';
const STREAMING_PAYLOAD = 'STREAMING-AWS4-HMAC-SHA256-PAYLOAD';

const RPC_ERRORS_TO_S3 = Object.freeze({
    UNAUTHORIZED: S3Error.AccessDenied,
    BAD_REQUEST: S3Error.BadRequest,
    FORBIDDEN: S3Error.AccessDenied,
    NO_SUCH_BUCKET: S3Error.NoSuchBucket,
    NO_SUCH_OBJECT: S3Error.NoSuchKey,
    INVALID_BUCKET_NAME: S3Error.InvalidBucketName,
    NOT_EMPTY: S3Error.BucketNotEmpty,
    BUCKET_ALREADY_EXISTS: S3Error.BucketAlreadyExists,
    BUCKET_ALREADY_OWNED_BY_YOU: S3Error.BucketAlreadyOwnedByYou,
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
    INVALID_BUCKET_STATE: S3Error.InvalidBucketState,
    NOT_ENOUGH_SPACE: S3Error.InvalidBucketState,
    MALFORMED_POLICY: S3Error.MalformedPolicy,
    NO_SUCH_OBJECT_LOCK_CONFIGURATION: S3Error.NoSuchObjectLockConfiguration,
    OBJECT_LOCK_CONFIGURATION_NOT_FOUND_ERROR: S3Error.ObjectLockConfigurationNotFoundError,
    INVALID_REQUEST: S3Error.InvalidRequest,
    NOT_IMPLEMENTED: S3Error.NotImplemented,
    INVALID_ACCESS_KEY_ID: S3Error.InvalidAccessKeyId,
    SIGNATURE_DOES_NOT_MATCH: S3Error.SignatureDoesNotMatch,
});

const S3_OPS = load_ops();

let usage_report = new_usage_report();

async function s3_rest(req, res) {
    try {
        await handle_request(req, res);
    } catch (err) {
        if (req.bucket_website_info) {
            await handle_website_error(req, res, err);
        } else {
            handle_error(req, res, err);
        }
    }
}

async function handle_request(req, res) {

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

    const redirect = await populate_request_additional_info_or_redirect(req);
    if (redirect) {
        res.setHeader('Location', redirect);
        res.statusCode = 301;
        res.end();
        return;
    }

    const op_name = parse_op_name(req);
    req.op_name = op_name;
    authenticate_request(req);
    await authorize_request(req);

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
        error_missing_body: op.body.type === 'xml' ? S3Error.MalformedXML : S3Error.MissingRequestBodyError,
        error_invalid_body: op.body.invalid_error || (op.body.type === 'xml' ? S3Error.MalformedXML : S3Error.InvalidRequest),
        error_body_sha256_mismatch: S3Error.XAmzContentSHA256Mismatch,
    };

    await http_utils.read_and_parse_body(req, options);
    const reply = await op.handler(req, res);
    http_utils.send_reply(req, res, reply, options);
    collect_bucket_usage(op, req, res);
}

async function populate_request_additional_info_or_redirect(req) {
    if ((req.method === 'HEAD' || req.method === 'GET') && _.isEmpty(req.query)) {
        const { bucket } = parse_bucket_and_key(req);
        if (bucket) return _get_redirection_bucket(req, bucket);
    }
}

async function _get_redirection_bucket(req, bucket) {
    const bucket_website_info = await req.object_sdk.read_bucket_sdk_website_info(bucket);
    if (!bucket_website_info) return;
    req.bucket_website_info = bucket_website_info;
    const redirect = bucket_website_info.website_configuration.redirect_all_requests_to;
    if (redirect) {
        const dest = redirect.host_name;
        const protocol = redirect.protocol || (req.secure ? 'https' : 'http');
        return `${protocol.toLowerCase()}://${dest}`;
    }
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
            if (key !== 'expect' && key !== 'user-agent') {
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
        throw new S3Error(S3Error.BadRequest);
    }

    if (req.method === 'POST' || req.method === 'PUT') s3_utils.parse_content_length(req);

    const content_md5_b64 = req.headers['content-md5'];
    if (typeof content_md5_b64 === 'string') {
        req.content_md5 = Buffer.from(content_md5_b64, 'base64');
        if (req.content_md5.length !== 16) {
            throw new S3Error(S3Error.InvalidDigest);
        }
    }

    const content_sha256_hdr = req.headers['x-amz-content-sha256'];
    req.content_sha256_sig = req.query['X-Amz-Signature'] ?
        UNSIGNED_PAYLOAD :
        content_sha256_hdr;
    if (typeof content_sha256_hdr === 'string' &&
        content_sha256_hdr !== UNSIGNED_PAYLOAD &&
        content_sha256_hdr !== STREAMING_PAYLOAD) {
        req.content_sha256_buf = Buffer.from(content_sha256_hdr, 'hex');
        if (req.content_sha256_buf.length !== 32) {
            throw new S3Error(S3Error.InvalidDigest);
        }
    }

    const content_encoding = req.headers['content-encoding'] || '';
    req.chunked_content =
        content_encoding.split(',').includes('aws-chunked') ||
        content_sha256_hdr === STREAMING_PAYLOAD;

    const req_time =
        time_utils.parse_amz_date(req.headers['x-amz-date'] || req.query['X-Amz-Date']) ||
        time_utils.parse_http_header_date(req.headers.date);

    // In case of presigned urls we shouldn't fail on non provided time.
    if (isNaN(req_time) && !req.query.Expires) {
        throw new S3Error(S3Error.AccessDenied);
    }

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
        if (err.code) {
            throw err;
        } else {
            throw new S3Error(S3Error.AccessDenied);
        }
    }
}

async function authorize_request(req) {
    await Promise.all([
        req.object_sdk.authorize_request_account(req.params.bucket),
        authorize_request_policy(req)
    ]);
}

async function authorize_request_policy(req) {
    if (!req.params.bucket) return;
    if (req.op_name === 'put_bucket') return;
    const policy_info = await req.object_sdk.read_bucket_sdk_policy_info(req.params.bucket);
    const s3_policy = policy_info.s3_policy;
    const system_owner = policy_info.system_owner;
    const bucket_owner = policy_info.bucket_owner;
    if (s3_policy) {
        const arn_path = _get_arn_from_req_path(req);
        const method = _get_method_from_req(req);
        const account = await req.object_sdk.rpc_client.account.read_account({});
        // system owner by design can always change bucket policy
        // bucket owner has FC ACL by design - so no need to check bucket policy
        if (((account.email.unwrap() === system_owner.unwrap()) && req.op_name.endsWith('bucket_policy')) ||
            account.email.unwrap() === bucket_owner.unwrap()) return;
        if (!has_bucket_policy_permission(s3_policy, account.email, method, arn_path)) {
            throw new S3Error(S3Error.AccessDenied);
        }
    }
}

function _get_method_from_req(req) {
    const s3_op = s3_utils.OP_NAME_TO_ACTION[req.op_name];
    if (!s3_op) {
        dbg.error(`Got a not supported S3 op ${req.op_name} - doesn't suppose to happen`);
        throw new S3Error(S3Error.InternalError);
    }
    if (req.query && req.query.versionId && s3_op.versioned) {
        return s3_op.versioned;
    }
    return s3_op.regular;
}

function _get_arn_from_req_path(req) {
    const bucket = req.params.bucket;
    const key = req.params.key;
    let arn_path = `arn:aws:s3:::${bucket}`;
    if (key) {
        arn_path += `/${key}`;
    }
    return arn_path;
}

function has_bucket_policy_permission(policy, account, method, arn_path) {
    const [allow_statements, deny_statements] = _.partition(policy.statement, statement => statement.effect === 'allow');

    // look for explicit denies
    if (is_statements_fit(deny_statements, account, method, arn_path)) return false;

    // look for explicit allows
    if (is_statements_fit(allow_statements, account, method, arn_path)) return true;

    // implicit deny
    return false;
}

function is_statements_fit(statements, account, method, arn_path) {
    for (const statement of statements) {
        let action_fit = false;
        let principal_fit = false;
        let resource_fit = false;
        for (const action of statement.action) {
            dbg.log1('bucket_policy: action fit?', action, method);
            if ((action === '*') || (action === 's3:*') || (action === method)) {
                action_fit = true;
            }
        }
        for (const principal of statement.principal) {
            dbg.log1('bucket_policy: principal fit?', principal, account);
            if ((principal.unwrap() === '*') || (principal.unwrap() === account.unwrap())) {
                principal_fit = true;
            }
        }
        for (const resource of statement.resource) {
            const resource_regex = RegExp(`^${resource.replace(/\?/g, '.?').replace(/\*/g, '.*')}$`);
            dbg.log1('bucket_policy: resource fit?', resource_regex, arn_path);
            if (resource_regex.test(arn_path)) {
                resource_fit = true;
            }
        }
        dbg.log1('bucket_policy: is_statements_fit', action_fit, principal_fit, resource_fit);
        if (action_fit && principal_fit && resource_fit) return true;
    }
    return false;
}

// We removed support for default website hosting (host value is a bucket name)
// after a discussion with [Ohad, Nimrod, Eran, Guy] because it introduced a conflict
// that will be resolved with Bucket Website Configuration
// we will reintreduce it together with bucket site support.
function parse_bucket_and_key(req) {
    const { url, headers, virtual_hosts } = req;
    const host = headers.host.split(':')[0]; // cutting off port

    let virtual_host = null;
    if (host && host !== 'localhost' && !net.isIP(host)) {
        virtual_host = virtual_hosts.find(vhost => host.endsWith(`.${vhost}`));
    }

    let bucket = '';
    let key = '';
    if (virtual_host) {
        bucket = host.slice(0, -(virtual_host.length + 1));
        key = url.slice(1);
    } else {
        // Virtual host was not found falling back to path style.
        const index = url.indexOf('/', 1);
        const pos = index < 0 ? url.length : index;
        bucket = url.slice(1, pos);
        key = url.slice(pos + 1);
    }

    // decode and replace hadoop _$folder$ in key
    return {
        bucket: decodeURIComponent(bucket),
        key: decodeURIComponent(key).replace(/_\$folder\$/, '/'),
        is_virtual_hosted_bucket: Boolean(virtual_host)
    };
}

function get_bucket_and_key(req) {
    let { bucket, key, is_virtual_hosted_bucket } = parse_bucket_and_key(req);
    if (req.bucket_website_info) {
        const suffix = req.bucket_website_info.website_configuration.index_document.suffix;
        if (key) {
            key = key.endsWith('/') ? key.concat(suffix) : key;
        } else {
            key = suffix;
        }
    }
    return {
        bucket,
        // decode and replace hadoop _$folder$ in key
        key,
        is_virtual_hosted_bucket
    };
}

function parse_op_name(req) {
    const method = req.method.toLowerCase();

    let { bucket, key, is_virtual_hosted_bucket } = get_bucket_and_key(req);
    req.params = { bucket, key };
    if (is_virtual_hosted_bucket) {
        req.virtual_hosted_bucket = bucket;
    }

    // service url
    if (!bucket) {
        return `${method}_service`;
    }

    // bucket url
    if (!key) {
        const query_keys = Object.keys(req.query);
        for (let i = 0; i < query_keys.length; ++i) {
            if (BUCKET_SUB_RESOURCES[query_keys[i]]) return `${method}_bucket_${BUCKET_SUB_RESOURCES[query_keys[i]]}`;
        }
        return `${method}_bucket`;
    }

    // object url
    const query_keys = Object.keys(req.query);
    for (let i = 0; i < query_keys.length; ++i) {
        if (OBJECT_SUB_RESOURCES[query_keys[i]]) return `${method}_object_${OBJECT_SUB_RESOURCES[query_keys[i]]}`;
    }
    return `${method}_object`;
}

function handle_error(req, res, err) {
    var s3err =
        ((err instanceof S3Error) && err) ||
        new S3Error(RPC_ERRORS_TO_S3[err.rpc_code] || S3Error.InternalError);

    if (s3err.code === 'MalformedPolicy') {
        s3err.message = err.message;
        s3err.detail = err.rpc_data.detail;
    }

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

async function _handle_html_response(req, res, err) {
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

    const reply = `<html> \
        <head><title>${s3err.http_code} ${s3err.code}</title></head> \
        <body> \
        <h1>${s3err.http_code} ${s3err.code}</h1> \
        <ul> \
        <li>Code: ${s3err.code}</li> \
        <li>Message: ${s3err.message}</li> \
        <li>RequestId: ${req.request_id}</li> \
        </ul> \
        <hr/> \
        </body> \
        </html>`;
    res.statusCode = s3err.http_code;
    dbg.error('S3 ERROR', reply,
        req.method, req.originalUrl,
        JSON.stringify(req.headers),
        err.stack || err);
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Length', Buffer.byteLength(reply));
    res.end(reply);
}

async function handle_website_error(req, res, err) {
    const error_document = _.get(req, 'bucket_website_info.website_configuration.error_document');
    if (error_document) {
        try {
            const object_md = await req.object_sdk.read_object_md({
                bucket: req.params.bucket,
                key: error_document.key,
            });
            const params = {
                object_md,
                obj_id: object_md.obj_id,
                bucket: req.params.bucket,
                key: error_document.key,
                content_type: object_md.content_type,
            };
            const read_stream = await req.object_sdk.read_object_stream(params);
            res.setHeader('Content-Type', 'text/html');
            read_stream.pipe(res);
        } catch (error) {
            await _handle_html_response(req, res, error);
        }
    } else {
        await _handle_html_response(req, res, err);
    }
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
    };
}

function collect_bucket_usage(op, req, res) {
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
        const bucket_and_access_key = `${bucket}#${access_key}`;
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
}

function consume_usage_report() {
    const report = usage_report;
    usage_report = new_usage_report();
    return report;
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
module.exports.handler = s3_rest;
module.exports.consume_usage_report = consume_usage_report;
