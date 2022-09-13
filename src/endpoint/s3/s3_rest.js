/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const dbg = require('../../util/debug_module')(__filename);
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

    http_utils.set_response_headers(req, res, { expose_headers: 'ETag,X-Amz-Version-Id' });

    if (req.method === 'OPTIONS') {
        dbg.log1('OPTIONS!');
        res.statusCode = 200;
        res.end();
        return;
    }

    const headers_options = {
        ErrorClass: S3Error,
        error_invalid_argument: S3Error.InvalidArgument,
        error_access_denied: S3Error.AccessDenied,
        error_bad_request: S3Error.BadRequest,
        error_invalid_digest: S3Error.InvalidDigest,
        error_request_time_too_skewed: S3Error.RequestTimeTooSkewed,
        error_missing_content_length: S3Error.MissingContentLength,
        error_invalid_token: S3Error.InvalidToken,
        error_token_expired: S3Error.ExpiredToken,
        auth_token: () => signature_utils.make_auth_token_from_request(req)
    };
    http_utils.check_headers(req, headers_options);

    const redirect = await populate_request_additional_info_or_redirect(req);
    if (redirect) {
        res.setHeader('Location', redirect);
        res.statusCode = 301;
        res.end();
        return;
    }

    const op_name = parse_op_name(req);
    req.op_name = op_name;

    http_utils.authorize_session_token(req, headers_options);
    authenticate_request(req);
    await authorize_request(req);

    dbg.log1('S3 REQUEST', req.method, req.originalUrl, 'op', op_name, 'request_id', req.request_id, req.headers);
    usage_report.s3_usage_info.total_calls += 1;
    usage_report.s3_usage_info[op_name] = (usage_report.s3_usage_info[op_name] || 0) + 1;



    if (req.query && req.query.versionId) {
        const caching = await req.object_sdk.read_bucket_sdk_caching_info(req.params.bucket);
        if (caching) {
            dbg.error('S3 Version request not (NotImplemented) for buckets with caching', op_name, req.method, req.originalUrl);
            throw new S3Error(S3Error.NotImplemented);
        }
    }

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

function authenticate_request(req) {
    try {
        const auth_token = signature_utils.make_auth_token_from_request(req);
        if (auth_token) {
            auth_token.client_ip = http_utils.parse_client_ip(req);
        }
        if (req.session_token) {
            auth_token.access_key = req.session_token.assumed_role_access_key;
            auth_token.temp_access_key = req.session_token.access_key;
            auth_token.temp_secret_key = req.session_token.secret_key;
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
        req.object_sdk.authorize_request_account(req),
        // authorize_request_policy(req) is supposed to
        // allow owners access unless there is an explicit DENY policy
        authorize_request_policy(req)
    ]);
}

async function authorize_request_policy(req) {
    if (!req.params.bucket) return;
    if (req.op_name === 'put_bucket') return;

    const { s3_policy, system_owner, bucket_owner } = await req.object_sdk.read_bucket_sdk_policy_info(req.params.bucket);
    const auth_token = req.object_sdk.get_auth_token();
    const arn_path = _get_arn_from_req_path(req);
    const method = _get_method_from_req(req);

    const is_anon = !(auth_token && auth_token.access_key);
    if (is_anon) {
        authorize_anonymous_access(s3_policy, method, arn_path);
        return;
    }

    const account = await req.object_sdk.rpc_client.account.read_account({});
    const is_system_owner = account.email.unwrap() === system_owner.unwrap();

    // @TODO: System owner as a construct should be removed - Temporary
    if (is_system_owner) return;

    const is_owner = (function() {
        if (account.bucket_claim_owner && account.bucket_claim_owner.unwrap() === req.params.bucket) return true;
        if (account.email.unwrap() === bucket_owner.unwrap()) return true;
        return false;
    }());

    if (!s3_policy) {
        if (is_owner) return;
        throw new S3Error(S3Error.AccessDenied);
    }

    const permission = s3_utils.has_bucket_policy_permission(s3_policy, account.email.unwrap(), method, arn_path);
    if (permission === "DENY") throw new S3Error(S3Error.AccessDenied);
    if (permission === "ALLOW" || is_owner) return;

    throw new S3Error(S3Error.AccessDenied);
}

function authorize_anonymous_access(s3_policy, method, arn_path) {
    if (!s3_policy) throw new S3Error(S3Error.AccessDenied);

    const permission = s3_utils.has_bucket_policy_permission(s3_policy, undefined, method, arn_path);
    if (permission === "ALLOW") return;

    throw new S3Error(S3Error.AccessDenied);
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
    const { bucket, key, is_virtual_hosted_bucket } = get_bucket_and_key(req);

    req.params = { bucket, key };
    if (is_virtual_hosted_bucket) {
        req.virtual_hosted_bucket = bucket;
    }

    // service url
    if (!bucket) {
        return `${method}_service`;
    }

    const query_keys = Object.keys(req.query);

    // bucket url
    if (!key) {
        for (let i = 0; i < query_keys.length; ++i) {
            if (BUCKET_SUB_RESOURCES[query_keys[i]]) {
                return `${method}_bucket_${BUCKET_SUB_RESOURCES[query_keys[i]]}`;
            }
        }
        return `${method}_bucket`;
    }

    // object url
    for (let i = 0; i < query_keys.length; ++i) {
        if (OBJECT_SUB_RESOURCES[query_keys[i]]) {
            return `${method}_object_${OBJECT_SUB_RESOURCES[query_keys[i]]}`;
        }
    }
    return `${method}_object`;
}

function handle_error(req, res, err) {
    var s3err =
        ((err instanceof S3Error) && err) ||
        new S3Error(S3Error.RPC_ERRORS_TO_S3[err.rpc_code] || S3Error.InternalError);

    if (s3err.code === 'MalformedPolicy') {
        s3err.message = err.message;
        s3err.detail = err.rpc_data.detail;
    }

    if (s3err.rpc_data) {
        if (s3err.rpc_data.etag) {
            if (res.headersSent) {
                dbg.log0('Sent reply in body, bit too late for Etag header');
            } else {
                res.setHeader('ETag', s3err.rpc_data.etag);
            }
        }
        if (s3err.rpc_data.last_modified) {
            if (res.headersSent) {
                dbg.log0('Sent reply in body, bit too late for Last-Modified header');
            } else {
                res.setHeader('Last-Modified', time_utils.format_http_header_date(new Date(s3err.rpc_data.last_modified)));
            }
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
    if (res.headersSent) {
        dbg.log0('Sending error xml in body, but too late for headers...');
    } else {
        res.statusCode = s3err.http_code;
        res.setHeader('Content-Type', 'application/xml');
        res.setHeader('Content-Length', Buffer.byteLength(reply));
    }
    res.end(reply);
}

async function _handle_html_response(req, res, err) {
    var s3err =
        ((err instanceof S3Error) && err) ||
        new S3Error(S3Error.RPC_ERRORS_TO_S3[err.rpc_code] || S3Error.InternalError);

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
    /* eslint-disable global-require */
    return js_utils.deep_freeze({
        delete_bucket: require('./ops/s3_delete_bucket'),
        delete_bucket_analytics: require('./ops/s3_delete_bucket_analytics'),
        delete_bucket_cors: require('./ops/s3_delete_bucket_cors'),
        delete_bucket_encryption: require('./ops/s3_delete_bucket_encryption'),
        delete_bucket_inventory: require('./ops/s3_delete_bucket_inventory'),
        delete_bucket_lifecycle: require('./ops/s3_delete_bucket_lifecycle'),
        delete_bucket_metrics: require('./ops/s3_delete_bucket_metrics'),
        delete_bucket_policy: require('./ops/s3_delete_bucket_policy'),
        delete_bucket_replication: require('./ops/s3_delete_bucket_replication'),
        delete_bucket_tagging: require('./ops/s3_delete_bucket_tagging'),
        delete_bucket_website: require('./ops/s3_delete_bucket_website'),
        delete_object: require('./ops/s3_delete_object'),
        delete_object_tagging: require('./ops/s3_delete_object_tagging'),
        delete_object_uploadId: require('./ops/s3_delete_object_uploadId'),
        get_bucket: require('./ops/s3_get_bucket'),
        get_bucket_accelerate: require('./ops/s3_get_bucket_accelerate'),
        get_bucket_acl: require('./ops/s3_get_bucket_acl'),
        get_bucket_analytics: require('./ops/s3_get_bucket_analytics'),
        get_bucket_cors: require('./ops/s3_get_bucket_cors'),
        get_bucket_encryption: require('./ops/s3_get_bucket_encryption'),
        get_bucket_inventory: require('./ops/s3_get_bucket_inventory'),
        get_bucket_lifecycle: require('./ops/s3_get_bucket_lifecycle'),
        get_bucket_location: require('./ops/s3_get_bucket_location'),
        get_bucket_logging: require('./ops/s3_get_bucket_logging'),
        get_bucket_metrics: require('./ops/s3_get_bucket_metrics'),
        get_bucket_notification: require('./ops/s3_get_bucket_notification'),
        get_bucket_object_lock: require('./ops/s3_get_bucket_object_lock'),
        get_bucket_policy: require('./ops/s3_get_bucket_policy'),
        get_bucket_replication: require('./ops/s3_get_bucket_replication'),
        get_bucket_requestPayment: require('./ops/s3_get_bucket_requestPayment'),
        get_bucket_tagging: require('./ops/s3_get_bucket_tagging'),
        get_bucket_uploads: require('./ops/s3_get_bucket_uploads'),
        get_bucket_versioning: require('./ops/s3_get_bucket_versioning'),
        get_bucket_versions: require('./ops/s3_get_bucket_versions'),
        get_bucket_website: require('./ops/s3_get_bucket_website'),
        get_object: require('./ops/s3_get_object'),
        get_object_acl: require('./ops/s3_get_object_acl'),
        get_object_legal_hold: require('./ops/s3_get_object_legal_hold'),
        get_object_retention: require('./ops/s3_get_object_retention'),
        get_object_tagging: require('./ops/s3_get_object_tagging'),
        get_object_uploadId: require('./ops/s3_get_object_uploadId'),
        get_service: require('./ops/s3_get_service'),
        head_bucket: require('./ops/s3_head_bucket'),
        head_object: require('./ops/s3_head_object'),
        post_bucket: require('./ops/s3_post_bucket'),
        post_bucket_delete: require('./ops/s3_post_bucket_delete'),
        post_object_uploadId: require('./ops/s3_post_object_uploadId'),
        post_object_uploads: require('./ops/s3_post_object_uploads'),
        put_bucket: require('./ops/s3_put_bucket'),
        put_bucket_accelerate: require('./ops/s3_put_bucket_accelerate'),
        put_bucket_acl: require('./ops/s3_put_bucket_acl'),
        put_bucket_analytics: require('./ops/s3_put_bucket_analytics'),
        put_bucket_cors: require('./ops/s3_put_bucket_cors'),
        put_bucket_encryption: require('./ops/s3_put_bucket_encryption'),
        put_bucket_inventory: require('./ops/s3_put_bucket_inventory'),
        put_bucket_lifecycle: require('./ops/s3_put_bucket_lifecycle'),
        put_bucket_logging: require('./ops/s3_put_bucket_logging'),
        put_bucket_metrics: require('./ops/s3_put_bucket_metrics'),
        put_bucket_notification: require('./ops/s3_put_bucket_notification'),
        put_bucket_object_lock: require('./ops/s3_put_bucket_object_lock'),
        put_bucket_policy: require('./ops/s3_put_bucket_policy'),
        put_bucket_replication: require('./ops/s3_put_bucket_replication'),
        put_bucket_requestPayment: require('./ops/s3_put_bucket_requestPayment'),
        put_bucket_tagging: require('./ops/s3_put_bucket_tagging'),
        put_bucket_versioning: require('./ops/s3_put_bucket_versioning'),
        put_bucket_website: require('./ops/s3_put_bucket_website'),
        put_object: require('./ops/s3_put_object'),
        put_object_acl: require('./ops/s3_put_object_acl'),
        put_object_legal_hold: require('./ops/s3_put_object_legal_hold'),
        put_object_retention: require('./ops/s3_put_object_retention'),
        put_object_tagging: require('./ops/s3_put_object_tagging'),
        put_object_uploadId: require('./ops/s3_put_object_uploadId'),
    });
}

// EXPORTS
module.exports.handler = s3_rest;
module.exports.consume_usage_report = consume_usage_report;
