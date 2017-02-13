/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const moment = require('moment');
const express = require('express');

const P = require('../util/promise');
const dbg = require('../util/debug_module')(__filename);
const config = require('../../config');
const s3_errors = require('./s3_errors');
const xml_utils = require('../util/xml_utils');
const xml2js = require('xml2js');
const signature_utils = require('../util/signature_utils');

//const S3Auth = require('aws-sdk/lib/signers/s3');
//const s3_auth = new S3Auth();

const S3_XML_ATTRS = Object.freeze({
    xmlns: 'http://s3.amazonaws.com/doc/2006-03-01'
});

const S3_REQ_XML_BODY = 'xml';
const S3_REQ_JSON_BODY = 'json';
// Limit body to 4 megabytes
const S3_MAX_REQ_CONTENT_LEN = 4 * 1024 * 1024;


// http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUT.html
const S3_REQ_PUT_BUCKET = {
    body_type: S3_REQ_XML_BODY,
    schema: {},
    required: false
};

// http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTaccelerate.html
const S3_REQ_PUT_BUCKET_ACCELERATE = {
    body_type: S3_REQ_XML_BODY,
    schema: {},
    required: true
};

// http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTacl.html
const S3_REQ_PUT_BUCKET_ACL = {
    body_type: S3_REQ_XML_BODY,
    schema: {},
    required: false
};

// http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTAnalyticsConfig.html
const S3_REQ_PUT_BUCKET_ANALYTICS_CONFIG = {
    body_type: S3_REQ_XML_BODY,
    schema: {},
    required: true
};

// http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTcors.html
const S3_REQ_PUT_BUCKET_CORS = {
    body_type: S3_REQ_XML_BODY,
    schema: {},
    required: true
};

// http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTInventoryConfig.html
const S3_REQ_PUT_BUCKET_INVENTORY_CONFIG = {
    body_type: S3_REQ_XML_BODY,
    schema: {},
    required: true
};

// http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTlifecycle.html
const S3_REQ_PUT_BUCKET_LIFECYCLE = {
    body_type: S3_REQ_XML_BODY,
    schema: {},
    required: true
};

// http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTpolicy.html
const S3_REQ_PUT_BUCKET_POLICY = {
    body_type: S3_REQ_JSON_BODY,
    schema: {},
    required: true,
    error: s3_errors.InvalidPolicyDocument
};

// http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTlogging.html
const S3_REQ_PUT_BUCKET_LOGGING = {
    body_type: S3_REQ_XML_BODY,
    schema: {},
    required: true
};

// http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTnotification.html
const S3_REQ_PUT_BUCKET_NOTIFICATION = {
    body_type: S3_REQ_XML_BODY,
    schema: {},
    required: true
};

// http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTreplication.html
const S3_REQ_PUT_BUCKET_REPLICATION = {
    body_type: S3_REQ_XML_BODY,
    schema: {},
    required: true
};

// http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTtagging.html
const S3_REQ_PUT_BUCKET_TAGGING = {
    body_type: S3_REQ_XML_BODY,
    schema: {},
    required: true
};

// http://docs.aws.amazon.com/AmazonS3/latest/API/RESTrequestPaymentPUT.html
const S3_REQ_PUT_BUCKET_REQUEST_PAYMENT = {
    body_type: S3_REQ_XML_BODY,
    schema: {},
    required: true
};

// http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTVersioningStatus.html
const S3_REQ_PUT_BUCKET_VERSIONING = {
    body_type: S3_REQ_XML_BODY,
    schema: {},
    required: true
};

// http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTwebsite.html
const S3_REQ_PUT_BUCKET_WEBSITE = {
    body_type: S3_REQ_XML_BODY,
    schema: {},
    required: true
};

// http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTMetricConfiguration.html
const S3_REQ_PUT_BUCKET_METRIC_CONFIGURATION = {
    body_type: S3_REQ_XML_BODY,
    schema: {},
    required: true
};

// http://docs.aws.amazon.com/AmazonS3/latest/API/multiobjectdeleteapi.html
const S3_REQ_POST_BUCKET_OBJECTS_DELETE = {
    body_type: S3_REQ_XML_BODY,
    schema: {},
    required: true
};

// http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectPOSTrestore.html
const S3_REQ_POST_OBJECT_RESTORE = {
    body_type: S3_REQ_XML_BODY,
    schema: {},
    required: true
};

// http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadComplete.html
const S3_REQ_POST_OBJECT_UPLOAD_COMPLETE = {
    body_type: S3_REQ_XML_BODY,
    schema: {},
    required: true
};

// http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectPUTacl.html
const S3_REQ_PUT_OBJECT_ACL = {
    body_type: S3_REQ_XML_BODY,
    schema: {},
    required: true
};

// http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectPUTtagging.html
const S3_REQ_PUT_OBJECT_TAGGING = {
    body_type: S3_REQ_XML_BODY,
    schema: {},
    required: true
};


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
const UNSIGNED_PAYLOADS = Object.freeze([
    'UNSIGNED-PAYLOAD',
    'STREAMING-AWS4-HMAC-SHA256-PAYLOAD'
]);
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
    BAD_DIGEST: s3_errors.BadDigest,
    BAD_SIZE: s3_errors.IncompleteBody,
});


function s3_rest(controller) {

    let app = new express.Router();
    app.use(handle_options);
    app.use(check_headers);
    app.use(handle_testme);
    app.use(authenticate_s3_request);
    app.get('/', s3_handler('list_buckets'));
    app.head('/:bucket', s3_handler('head_bucket'));
    app.get('/:bucket', s3_handler('get_bucket', GET_BUCKET_QUERIES));
    app.put('/:bucket', post_put_body_handler(parse_put_bucket_method), s3_handler('put_bucket', BUCKET_QUERIES));
    app.post('/:bucket', post_put_body_handler(parse_post_bucket_method), s3_handler('post_bucket', ['delete']));
    app.delete('/:bucket', s3_handler('delete_bucket', BUCKET_QUERIES));
    app.head('/:bucket/:key(*)', s3_handler('head_object'));
    app.get('/:bucket/:key(*)', s3_handler('get_object', ['uploadId', 'acl']));
    app.put('/:bucket/:key(*)', post_put_body_handler(parse_put_object_method), s3_handler('put_object', ['uploadId', 'acl']));
    app.post('/:bucket/:key(*)', post_put_body_handler(parse_post_object_method), s3_handler('post_object', ['uploadId', 'uploads']));
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
        dbg.log0('S3 REQUEST', func_name, req.method, req.originalUrl, req.headers);
        let func = controller[func_name];
        if (!func) {
            dbg.error('S3 TODO (NotImplemented)', func_name, req.method, req.originalUrl);
            next(s3_errors.NotImplemented);
            return;
        }
        P.fcall(() => func.call(controller, req, res))
            .then(reply => {
                if (reply === false) {
                    // in this case the controller already replied
                    return;
                }
                dbg.log1('S3 REPLY', func_name, req.method, req.originalUrl, reply);
                if (reply) {
                    let xml_root = _.mapValues(reply, val => ({
                        _attr: S3_XML_ATTRS,
                        _content: val
                    }));
                    let xml_reply = xml_utils.encode_xml(xml_root);
                    dbg.log0('S3 XML REPLY', func_name, req.method, req.originalUrl,
                        JSON.stringify(req.headers), xml_reply);
                    res.status(200).send(xml_reply);
                } else {
                    dbg.log0('S3 EMPTY REPLY', func_name, req.method, req.originalUrl,
                        JSON.stringify(req.headers));
                    if (req.method === 'DELETE') {
                        res.status(204).end();
                    } else {
                        res.status(200).end();
                    }
                }
            })
            .catch(err => next(err));
    }

    function check_headers(req, res, next) {
        try {
            _.each(req.headers, (val, key) => {
                // test for non printable characters
                // 403 is required for unreadable headers
                // eslint-disable-next-line no-control-regex
                if ((/[\x00-\x1F]/).test(val) || (/[\x00-\x1F]/).test(key)) {
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

            const content_md5_b64 = req.headers['content-md5'];
            if (content_md5_b64) {
                req.content_md5 = new Buffer(content_md5_b64, 'base64');
                if (req.content_md5.length !== 16) {
                    throw s3_errors.InvalidDigest;
                }
            }

            const content_sha256_hex = req.headers['x-amz-content-sha256'];
            if (content_sha256_hex && !UNSIGNED_PAYLOADS.includes(content_sha256_hex)) {
                req.content_sha256 = new Buffer(content_sha256_hex, 'hex');
                if (req.content_sha256.length !== 32) {
                    throw s3_errors.InvalidDigest;
                }
            }

            // using moment to parse x-amz-date from string iso8601 or iso822.
            // When using a signedURL we give an expiry of 7days, which will cover
            // up the skew between the times, so we don't check it
            const req_date = moment(
                req.headers.date ||
                req.headers['x-amz-date'] ||
                req.query['X-Amz-Date']
            );
            if (Math.abs(moment().diff(req_date, 'seconds')) > config.TIME_SKEW_MAX_SECONDS) {
                throw s3_errors.RequestTimeTooSkewed;
            }

            return next();
        } catch (err) {
            return next(err);
        }
    }

    /**
     * handle s3 errors and send the response xml
     */
    function handle_common_s3_errors(err, req, res, next) {
        if (!err) {
            dbg.log0('S3 InvalidURI.', req.method, req.originalUrl);
            err = s3_errors.InvalidURI;
        }
        let s3err =
            ((err instanceof s3_errors.S3Error) && err) ||
            RPC_ERRORS_TO_S3[err.rpc_code] ||
            s3_errors.InternalError;
        let reply = s3err.reply(req.originalUrl, req.request_id);
        dbg.error('S3 ERROR', reply,
            JSON.stringify(req.headers),
            err.stack || err);
        // This doesn't need to affect response if we fail to register
        controller.register_s3_error(req, s3err);
        res.status(s3err.http_code).send(reply);
    }

    /**
     * check the signature of the request
     */
    function authenticate_s3_request(req, res, next) {
        P.fcall(function() {
                req.auth_token = signature_utils.authenticate_request(req);
                signature_utils.check_expiry(req);
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

    // replace hadoop _$folder$
    if (req.params.key) {
        req.params.key = req.params.key.replace(/_\$folder\$/, '/');
    }

    next();
}

function read_request_body(req) {
    return new P((resolve, reject) => {
        let data = '';
        let content_len = 0;
        req.on('data', chunk => {
            content_len += chunk.length;
            if (content_len > S3_MAX_REQ_CONTENT_LEN) {
                return reject(s3_errors.MaxMessageLengthExceeded);
            }
            // Parse the data after the length check
            data += chunk.toString('utf8');
        });
        req.once('error', reject);
        req.once('end', () => {
            req.body = data;
            return resolve(data);
        });
    });
}

function parse_request_body(req, method) {
    if (method.body_type === S3_REQ_XML_BODY) {
        return P.fromCallback(callback => xml2js.parseString(req.body, callback))
            .then(data => {
                req.body = data;
            })
            .catch(err => {
                console.error('parse_request_body: XML parse problem', err);
                return P.reject(method.error || s3_errors.MalformedXML);
            });
    }

    if (method.body_type === S3_REQ_JSON_BODY) {
        return P.fcall(() => {
                req.body = JSON.parse(req.body);
            })
            .catch(err => {
                console.error('parse_request_body: JSON parse problem', err);
                // TODO: JEN What is the default error for JSON?!
                return P.reject(method.error || s3_errors.InvalidPolicyDocument);
            });
    }

    console.log(`parse_request_body (req_id:${req.request_id}): Body type ${method.body_type} not supported`);
    return P.reject(new Error(`Body type parsing not supported ${method.body_type}`));
}

function parse_put_bucket_method(req) {
    if (_.isEmpty(req.query)) {
        return S3_REQ_PUT_BUCKET;
    }

    if (_.has(req.query, 'accelerate')) {
        return S3_REQ_PUT_BUCKET_ACCELERATE;
    }

    if (_.has(req.query, 'acl')) {
        return S3_REQ_PUT_BUCKET_ACL;
    }

    if (_.has(req.query, 'analytics') && _.has(req.query, 'id')) {
        return S3_REQ_PUT_BUCKET_ANALYTICS_CONFIG;
    }

    if (_.has(req.query, 'cors')) {
        return S3_REQ_PUT_BUCKET_CORS;
    }

    if (_.has(req.query, 'inventory') && _.has(req.query, 'id')) {
        return S3_REQ_PUT_BUCKET_INVENTORY_CONFIG;
    }

    if (_.has(req.query, 'lifecycle')) {
        return S3_REQ_PUT_BUCKET_LIFECYCLE;
    }

    if (_.has(req.query, 'policy')) {
        return S3_REQ_PUT_BUCKET_POLICY;
    }

    if (_.has(req.query, 'logging')) {
        return S3_REQ_PUT_BUCKET_LOGGING;
    }

    if (_.has(req.query, 'notification')) {
        return S3_REQ_PUT_BUCKET_NOTIFICATION;
    }

    if (_.has(req.query, 'replication')) {
        return S3_REQ_PUT_BUCKET_REPLICATION;
    }

    if (_.has(req.query, 'tagging')) {
        return S3_REQ_PUT_BUCKET_TAGGING;
    }

    if (_.has(req.query, 'requestPayment')) {
        return S3_REQ_PUT_BUCKET_REQUEST_PAYMENT;
    }

    if (_.has(req.query, 'versioning')) {
        return S3_REQ_PUT_BUCKET_VERSIONING;
    }

    if (_.has(req.query, 'metrics') && _.has(req.query, 'id')) {
        return S3_REQ_PUT_BUCKET_METRIC_CONFIGURATION;
    }

    if (_.has(req.query, 'website')) {
        return S3_REQ_PUT_BUCKET_WEBSITE;
    }
}

function parse_post_bucket_method(req) {
    if (_.has(req.query, 'delete')) {
        return S3_REQ_POST_BUCKET_OBJECTS_DELETE;
    }
}

function parse_put_object_method(req) {
    if (_.has(req.query, 'acl')) {
        return S3_REQ_PUT_OBJECT_ACL;
    }

    if (_.has(req.query, 'tagging')) {
        return S3_REQ_PUT_OBJECT_TAGGING;
    }
}

function parse_post_object_method(req) {
    if (_.has(req.query, 'restore')) {
        return S3_REQ_POST_OBJECT_RESTORE;
    }

    if (_.has(req.query, 'uploadId')) {
        return S3_REQ_POST_OBJECT_UPLOAD_COMPLETE;
    }
}


function post_put_body_handler(method_func) {
    return function(req, res, next) {
        let method = method_func(req);
        if (!method) {
            // We should not read the body when uploading objects
            return next();
        }

        return read_request_body(req)
            .then(body_data => {
                if (!body_data) {
                    if (method.required) {
                        return P.reject(s3_errors.MissingRequestBodyError);
                    }

                    return P.resolve();
                }

                return parse_request_body(req, method.body_type);
            })
            .asCallback(next);
    };
}

function handle_testme(req, res, next) {
    if (req.headers.host === 'testme') {
        dbg.log0('LB test page hit');
        res.status(200).end();
    } else {
        return next();
    }
}

// EXPORTS
module.exports = s3_rest;
