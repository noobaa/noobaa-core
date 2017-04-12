/* Copyright (C) 2016 NooBaa */
'use strict';

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const js_utils = require('../../util/js_utils');
const BlobError = require('./blob_errors').BlobError;
const http_utils = require('../../util/http_utils');

// temporary - until we implement authentication
const auth_server = require('../../server/common_services/auth_server');
const system_store = require('../../server/system_services/system_store').get_instance();

const BLOB_MAX_BODY_LEN = 4 * 1024 * 1024;

const RPC_ERRORS_TO_BLOB = Object.freeze({
    NO_SUCH_BUCKET: BlobError.ContainerNotFound,
    BUCKET_ALREADY_EXISTS: BlobError.ContainerAlreadyExists,
});

const BLOB_OPS = load_ops();

function blob_rest(req, res) {
    return P.try(() => handle_request(req, res))
        .catch(err => handle_error(req, res, err));
}

function handle_request(req, res) {

    // fill up standard response headers
    res.setHeader('x-ms-request-id', req.request_id);

    // note that browsers will not allow origin=* with credentials
    // but anyway we allow it by the agent server.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers',
        'Content-Type,Date,ETag,Authorization,x-ms-version,x-ms-date');
    res.setHeader('Access-Control-Expose-Headers', 'ETag');

    if (req.method === 'OPTIONS') {
        dbg.log0('OPTIONS!');
        res.statusCode = 200;
        res.end();
        return;
    }

    res.setHeader('ETag', '"1"');
    res.setHeader('Content-Type', 'application/xml');
    // res.setHeader('Date', (new Date()).toUTCString());
    check_headers(req);
    res.setHeader('x-ms-version', req.headers['x-ms-version']);

    authenticate_request(req);

    // resolve the op to call
    const op_name = parse_op_name(req);
    dbg.log0('BLOB REQUEST', req.method, req.originalUrl,
        'op', op_name, 'request_id', req.request_id, req.headers);
    const op = BLOB_OPS[op_name];
    if (!op || !op.handler) {
        dbg.error('BLOB TODO (NotImplemented)', op_name, req.method, req.originalUrl);
        throw new BlobError(BlobError.InternalError);
    }

    const options = {
        body: op.body,
        reply: op.reply,
        MAX_BODY_LEN: BLOB_MAX_BODY_LEN,
        XML_ROOT_ATTRS: {
            ServiceEndpoint: `https://${req.headers.host}/`,
        },
        ErrorClass: BlobError,
        error_max_body_len_exceeded: BlobError.InternalError,
        error_missing_body: BlobError.InternalError,
        error_invalid_body: op.body.invalid_error || BlobError.InternalError,
    };

    return P.resolve()
        .then(() => http_utils.read_and_parse_body(req, options))
        .then(() => op.handler(req, res))
        .then(reply => http_utils.send_reply(req, res, reply, options));
    // .then(() => submit_usage_report(req));
}

function check_headers(req) {
    if (!req.headers['x-ms-version']) {
        throw new Error('X-MS-VERSION MISSING');
    }
}

function authenticate_request(req) {
    try {
        // TODO: fix authentication. currently autherizes everything.
        let system = system_store.data.systems[0];
        const auth_token = auth_server.make_auth_token({
            system_id: system._id,
            account_id: system.owner._id,
            role: 'admin',
            client_ip: http_utils.parse_client_ip(req),
        });
        req.rpc_client.options.auth_token = auth_token;
    } catch (err) {
        dbg.error('authenticate_request: ERROR', err.stack || err);
        throw new BlobError(BlobError.InternalError);
    }
}

function parse_op_name(req) {
    const m = req.method.toLowerCase();
    const u = req.url;

    // account url
    if (u === '/') {
        req.params = {};
        if (req.query.comp) return `${m}_account_${req.query.comp}`;
        return `${m}_account`;
    }

    const index = u.indexOf('/', 1);
    const pos = index < 0 ? u.length : index;
    const bucket = decodeURIComponent(u.slice(1, pos));
    // replace hadoop _$folder$ in key
    const key = decodeURIComponent(u.slice(pos + 1)).replace(/_\$folder\$/, '/');

    if (key) {
        // blob url
        req.params = {
            bucket,
            key,
        };
        if (req.query.comp) return `${m}_blob_${req.query.comp}`;
        return `${m}_blob`;
    } else {
        // container url
        req.params = { bucket };
        if (req.query.comp) return `${m}_container_${req.query.comp}`;
        return `${m}_container`;
    }
}

/**
 * handle s3 errors and send the response xml
 */
function handle_error(req, res, err) {
    const blob_err =
        ((err instanceof BlobError) && err) ||
        new BlobError(RPC_ERRORS_TO_BLOB[err.rpc_code] || BlobError.InternalError);

    // usage_report.s3_errors_info.total_errors += 1;
    // usage_report.s3_errors_info[blob_err.code] = (usage_report.s3_errors_info[blob_err.code] || 0) + 1;

    const reply = blob_err.reply();
    dbg.error('BLOB ERROR', reply,
        req.method, req.originalUrl,
        JSON.stringify(req.headers),
        err.stack || err);
    res.statusCode = blob_err.http_code;
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Length', reply.length);
    res.end(reply);
}

function load_ops() {
    const r = x => require(x); // eslint-disable-line global-require
    return js_utils.deep_freeze({
        get_account_list: r('./ops/blob_list_containers'),
        get_account_properties: r('./ops/blob_get_account_properties'),
        get_account_stats: r('./ops/blob_get_account_stats'),
        get_blob_blocklist: r('./ops/blob_get_blob_blocklist'),
        get_blob: r('./ops/blob_get_blob'),
        get_container_acl: r('./ops/blob_get_container_acl'),
        get_container_list: r('./ops/blob_list_blobs'),
        head_blob: r('./ops/blob_head_blob'),
        head_container: r('./ops/blob_head_container'),
        put_blob_lease: r('./ops/blob_put_blob_lease'),
        put_blob: r('./ops/blob_put_blob'),
        put_container_lease: r('./ops/blob_put_container_lease'),
        put_container: r('./ops/blob_create_container'),
    });
}


// EXPORTS
module.exports = blob_rest;
