'use strict';

let _ = require('lodash');
let P = require('../util/promise');
let dbg = require('../util/debug_module')(__filename);
let s3_util = require('../util/s3_utils');
let s3_errors = require('./s3_errors');
let express = require('express');
let jstoxml = require('jstoxml');

const S3_XML_ATTRS = Object.freeze({
    xmlns: 'http://doc.s3.amazonaws.com/2006-03-01'
});
const XML_OPTIONS = Object.freeze({
    header: true,
    indent: false
});
const BUCKET_QUERIES = Object.freeze([
    'acl',
    'cors',
    'lifecycle',
    'policy',
    'location',
    'logging',
    'notification',
    'replication',
    'tagging',
    'requestPayment',
    'versioning',
    'website',
]);
const GET_BUCKET_QUERIES = Object.freeze([
    'versions',
    'uploads'
].concat(BUCKET_QUERIES));
const RPC_ERRORS_TO_S3 = Object.freeze({
    UNAUTHORIZED: s3_errors.AccessDenied,
    FORBIDDEN: s3_errors.AccessDenied,
    NO_SUCH_BUCKET: s3_errors.NoSuchBucket,
    NO_SUCH_OBJECT: s3_errors.NoSuchKey,
    INVALID_BUCKET_NAME: s3_errors.InvalidBucketName,
    BUCKET_NOT_EMPTY: s3_errors.BucketNotEmpty,
    BUCKET_ALREADY_EXISTS: s3_errors.BucketAlreadyExists,
    NO_SUCH_UPLOAD: s3_errors.NoSuchUpload,
    IF_MODIFIED_SINCE: s3_errors.NotModified,
    IF_UNMODIFIED_SINCE: s3_errors.PreconditionFailed,
    IF_MATCH_ETAG: s3_errors.PreconditionFailed,
    IF_NONE_MATCH_ETAG: s3_errors.PreconditionFailed,
});

module.exports = s3_rest;

function s3_rest(controller) {

    let app = new express.Router();
    app.use(handle_options);
    app.use(check_headers);
    app.use(handle_testme);
    app.use(read_post_body);
    app.use(authenticate_s3_request);
    app.get('/', s3_handler('list_buckets'));
    app.head('/:bucket', s3_handler('head_bucket'));
    app.get('/:bucket', s3_handler('get_bucket', GET_BUCKET_QUERIES));
    app.put('/:bucket', s3_handler('put_bucket', BUCKET_QUERIES));
    app.post('/:bucket', s3_handler('post_bucket', ['delete']));
    app.delete('/:bucket', s3_handler('delete_bucket'));
    app.head('/:bucket/:key(*)', s3_handler('head_object'));
    app.get('/:bucket/:key(*)', s3_handler('get_object', ['uploadId', 'acl']));
    app.put('/:bucket/:key(*)', s3_handler('put_object', ['uploadId', 'acl']));
    app.post('/:bucket/:key(*)', s3_handler('post_object', ['uploadId', 'uploads']));
    app.delete('/:bucket/:key(*)', s3_handler('delete_object', ['uploadId']));
    app.use(handle_common_s3_errors);
    return app;


    /**
     * returns a route handler for the given function
     * the queries are optional list of sub queries that
     * will be checked in the req.query and change the
     * called function accordingly.
     */
    function s3_handler(func_name, queries) {
        return function(req, res, next) {
            let found_query = queries && _.find(queries, q => {
                if (q in req.query) {
                    s3_call(func_name + '_' + q, req, res, next);
                    return true; // break from _.find
                }
            });
            if (!found_query) {
                s3_call(func_name, req, res, next);
            }
        };
    }

    /**
     * call a function in the controller, and prepare the result
     * to send as xml.
     */
    function s3_call(func_name, req, res, next) {
        dbg.log0('S3 REQUEST', func_name, req.method, req.url);
        let func = controller[func_name];
        if (!func) {
            dbg.error('S3 TODO (NotImplemented)', func_name, req.method, req.url);
            next(s3_errors.NotImplemented);
            return;
        }
        P.fcall(() => func.call(controller, req, res))
            .then(reply => {
                if (reply === false) {
                    // in this case the controller already replied
                    return;
                }
                dbg.log1('S3 REPLY', func_name, req.method, req.url, reply);
                if (!reply) {
                    dbg.log0('S3 EMPTY REPLY', func_name, req.method, req.url,
                        JSON.stringify(req.headers));
                    if (req.method === 'DELETE') {
                        res.status(204).end();
                    } else {
                        res.status(200).end();
                    }
                } else {
                    let xml_root = _.map(reply, (val, key) => ({
                        _name: key,
                        _attrs: S3_XML_ATTRS,
                        _content: val
                    }));
                    let xml_reply = jstoxml.toXML(xml_root, XML_OPTIONS);
                    dbg.log0('S3 XML REPLY', func_name, req.method, req.url,
                        JSON.stringify(req.headers), xml_reply);
                    res.status(200).send(xml_reply);
                }
            })
            .catch(err => next(err));
    }

    function check_headers(req, res, next) {
        try {
            _.each(req.headers, (val, key) => {
                // test for non printable characters
                // 403 is required for unreadable headers
                if (/[\x00-\x1F]/.test(val) || /[\x00-\x1F]/.test(key)) {
                    if (key.startsWith('x-amz-meta-')) {
                        throw s3_errors.InvalidArgument;
                    }
                    if (key !== 'expect') {
                        throw s3_errors.AccessDenied;
                    }
                }
            });

            let content_length_str = req.headers['content-length'];
            req.content_length = parseInt(content_length_str, 10);
            if (req.method === 'PUT') {
                if (content_length_str === '' ||
                    req.content_length < 0) {
                    throw new s3_errors.S3Error({
                        http_code: 400,
                        reply: () => 'bad request'
                    });
                }
                if (_.isNaN(req.content_length)) {
                    throw s3_errors.MissingContentLength;
                }
            }

            let content_md5_b64 = req.headers['content-md5'];
            if (!_.isUndefined(content_md5_b64)) {
                req.content_md5 = new Buffer(content_md5_b64, 'base64');
                if (req.content_md5.length !== 16) {
                    throw s3_errors.InvalidDigest;
                }
            }

            next();
        } catch (err) {
            next(err);
        }
    }

    /**
     * handle s3 errors and send the response xml
     */
    function handle_common_s3_errors(err, req, res, next) {
        if (!err && next) {
            dbg.log0('S3 DONE.', req.method, req.url);
            next();
        }
        let s3err =
            (err instanceof s3_errors.S3Error) && err ||
            RPC_ERRORS_TO_S3[err.rpc_code] ||
            // s3_errors.InternalError;
            s3_errors.AccessDenied;
        let reply = s3err.reply(req.url, req.request_id);
        dbg.error('S3 ERROR', reply,
            JSON.stringify(req.headers),
            err.stack || err);
        res.status(s3err.http_code).send(reply);
    }

    /**
     * check the signature of the request
     */
    function authenticate_s3_request(req, res, next) {
        P.fcall(function() {
                dbg.log1('S3 request information. Time:', Date.now(),
                    'url:', req.originalUrl,
                    'method:', req.method,
                    'headers:', req.headers,
                    'query:', req.query);

                if (req.headers.authorization) {
                    // Using noobaa's extraction function,
                    // due to compatibility problem in aws library with express.
                    dbg.log1('authorization header exists', req.headers.authorization);
                    let end_of_aws_key = req.headers.authorization.indexOf(':');
                    let req_access_key;
                    if (req.headers.authorization.substring(0, 4) === 'AWS4') {
                        //authorization: 'AWS4-HMAC-SHA256 Credential=wwwwwwwwwwwww123aaaa/20151023/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=0b04a57def200559b3353551f95bce0712e378c703a97d58e13a6eef41a20877',
                        let credentials_location = req.headers.authorization.indexOf('Credential') + 11;
                        req_access_key = req.headers.authorization.substring(credentials_location, req.headers.authorization.indexOf('/'));
                    } else {
                        req_access_key = req.headers.authorization.substring(4, end_of_aws_key);
                    }

                    dbg.log1('req_access_key', req_access_key);

                    req.access_key = req_access_key;
                    req.signature = req.headers.authorization.substring(end_of_aws_key + 1, req.headers.authorization.lenth);
                } else if (req.query.AWSAccessKeyId && req.query.Signature) {
                    req.access_key = req.query.AWSAccessKeyId;
                    req.signature = req.query.Signature;
                    dbg.log1('signed url');
                } else if (req.query['X-Amz-Credential']) {
                    req.access_key = req.query['X-Amz-Credential'].substring(0, req.query['X-Amz-Credential'].indexOf('/'));
                    req.signature = req.query['X-Amz-Signature'];
                    dbg.log1('signed url v4', req.access_key);
                } else {
                    // unauthorized...
                    dbg.error('Unauthorized request!');
                    throw new Error('Unauthorized request!');
                }

                // let s3 = new s3_auth(req);
                dbg.log1('authenticated request with signature', req.signature);
                req.string_to_sign = s3_util.noobaa_string_to_sign(req, res.headers);

                // debug code.
                // use it for faster detection of a problem in the signature calculation and verification
                //
                //
                //  let s3_internal_signature = s3.sign(req.access_key, req.string_to_sign);
                //  dbg.log0('s3 internal:::' + req.string_to_sign,req.query.Signature,req.headers.authorization);
                //  if ((req.headers.authorization === 'AWS ' + req.access_key + ':' + s3_internal_signature) ||
                //      (req.query.Signature === s3_internal_signature))
                //  {
                //      dbg.log0('s3 internal authentication test passed!!!',s3_internal_signature);
                //  } else {
                //
                //      dbg.error('s3 internal authentication test failed!!! Computed signature is ',s3_internal_signature, 'while the expected signature is:',req.headers.authorization || req.query.Signature);
                //  }

                return controller.prepare_request(req);

            })
            .then(() => next())
            .catch(err => {
                dbg.error('authenticate_s3_request: ERROR', err.stack || err);
                next(s3_errors.SignatureDoesNotMatch);
            });
    }

}

function handle_options(req, res, next) {
    // note that browsers will not allow origin=* with credentials
    // but anyway we allow it by the agent server.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers',
        'Content-Type,Authorization,X-Amz-User-Agent,X-Amz-Date,ETag,X-Amz-Content-Sha256');
    res.setHeader('Access-Control-Expose-Headers', 'ETag');

    if (req.method === 'OPTIONS') {
        dbg.log0('OPTIONS!');
        res.status(200).end();
        return;
    }

    // these are the default and might get overriden by api's that
    // return actual data in the reply instead of xml
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('ETag', '"1"');

    req.request_id = Date.now().toString(36);
    res.setHeader('x-amz-request-id', req.request_id);
    res.setHeader('x-amz-id-2', req.request_id);

    next();
}

function read_post_body(req, res, next) {
    if (req.method === 'POST' &&
        (req.headers['content-type'] === 'application/xml' ||
            req.headers['content-type'] === 'application/octet-stream')) {
        let data = '';
        req.setEncoding('utf8');
        req.on('data', function(chunk) {
            data += chunk;
        });
        req.on('end', function() {
            req.body = data;
            next();
        });

    } else {
        next();
    }
}

function handle_testme(req, res, next) {
    if (req.headers.host === 'testme') {
        dbg.log0('LB test page hit');
        res.status(200).end();
    } else {
        next();
    }
}