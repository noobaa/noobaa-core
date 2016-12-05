/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const AWS = require('aws-sdk');
const dbg = require('../util/debug_module')(__filename);
const url = require('url');
const path = require('path');

/**
 *
 * Calculates AWS signature based on auth_server request
 *
 */
function signature(params) {
    const access_key = params.access_key;
    const secret_key = params.secret_key;
    const string_to_sign = params.string_to_sign;
    const noobaa_v4 = params.noobaa_v4;

    // using S3 signer unless V4
    if (!noobaa_v4) {
        const s3 = new AWS.Signers.S3();
        return s3.sign(secret_key, string_to_sign);
    }

    const aws_request = {
        region: noobaa_v4.region,
    };
    const aws_credentials = {
        accessKeyId: access_key,
        secretAccessKey: secret_key,
    };
    const v4 = new AWS.Signers.V4(
        aws_request,
        noobaa_v4.service,
        'signatureCache');

    // string_to_sign is already calculated in the proxy,
    // we override the signer function to just return the calculated string
    v4.stringToSign = () => string_to_sign;

    return v4.signature(aws_credentials, noobaa_v4.xamzdate);
}

/**
 *
 * Prepare HTTP request (express) authentication for sending to auth_server
 *
 */
function authenticate_request(req) {
    if (req.headers.authorization) {
        if (req.headers.authorization.startsWith('AWS4-HMAC-SHA256')) {
            _authenticate_header_v4(req);
        } else if (req.headers.authorization.startsWith('AWS ')) {
            _authenticate_header_s3(req);
        } else {
            throw new Error('Invalid Authorization Header: ' + req.headers.authorization);
        }
    } else if (req.query['X-Amz-Algorithm'] === 'AWS4-HMAC-SHA256') {
        _authenticate_query_v4(req);
    } else if (req.query.AWSAccessKeyId && req.query.Signature) {
        _authenticate_query_s3(req);
    } else {
        throw new Error('No Authorization');
    }
    dbg.log0('authenticate_request:', _.pick(req,
        'access_key', 'signature', 'string_to_sign', 'noobaa_v4'));
}

////////
// V4 //
////////

/**
 * See: http://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-auth-using-authorization-header.html
 * Example:
 *      Authorization: AWS4-HMAC-SHA256
 *          Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,
 *          SignedHeaders=host;range;x-amz-date,
 *          Signature=fe5f80f77d5fa3beca038a248ff027d0445342fe2855ddc963176630326f1024
 * Notes:
 * - Cyberduck does not include spaces after the commas
 */
function _authenticate_header_v4(req) {
    const v4 = req.headers.authorization.match(/^AWS4-HMAC-SHA256 Credential=(\S*),\s*SignedHeaders=(\S*),\s*Signature=(\S*)$/);
    if (!v4) {
        throw new Error('Invalid AWS V4 Authorization: ' + req.headers.authorization);
    }
    const credentials = v4[1].split('/', 5);
    const signed_headers = v4[2];
    req.access_key = credentials[0];
    req.signature = v4[3];
    req.noobaa_v4 = {
        xamzdate: req.headers['x-amz-date'],
        region: credentials[2],
        service: credentials[3],
    };
    req.string_to_sign = _string_to_sign_v4(req, signed_headers);
}

/**
 * See: http://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
 * Example:
 *      https://s3.amazonaws.com/examplebucket/test.txt
 *          ?X-Amz-Algorithm=AWS4-HMAC-SHA256
 *          &X-Amz-Credential=<your-access-key-id>/20130721/us-east-1/s3/aws4_request
 *          &X-Amz-Date=20130721T201207Z
 *          &X-Amz-Expires=86400
 *          &X-Amz-SignedHeaders=host
 *          &X-Amz-Signature=<signature-value>
 */
function _authenticate_query_v4(req) {
    _expiry_query_v4(req.query['X-Amz-Date'], req.query['X-Amz-Expires']);
    const credentials = req.query['X-Amz-Credential'].split('/', 5);
    const signed_headers = req.query['X-Amz-SignedHeaders'];
    req.access_key = credentials[0];
    req.signature = req.query['X-Amz-Signature'];
    req.noobaa_v4 = {
        xamzdate: req.query['X-Amz-Date'],
        region: credentials[2],
        service: credentials[3],
    };
    req.string_to_sign = _string_to_sign_v4(req, signed_headers);
}

function _string_to_sign_v4(req, signed_headers) {
    const aws_request = _aws_request(req);
    const v4 = new AWS.Signers.V4(
        aws_request,
        req.noobaa_v4.service,
        'signatureCache');

    // If Signed Headers param doesn't exist we sign everything in order to support
    // chunked upload: http://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-streaming.html
    const signed_headers_set = signed_headers ?
        new Set(signed_headers.split(';')) : null;

    v4.isSignableHeader = key =>
        !signed_headers_set ||
        signed_headers_set.has(key.toLowerCase());

    v4.hexEncodedBodyHash = () => (
        req.content_sha256 ?
        req.content_sha256.toString('hex') :
        require('crypto')
        .createHash('sha256')
        .digest('hex')
    );

    const canonical_str = v4.canonicalString();
    const string_to_sign = v4.stringToSign(req.noobaa_v4.xamzdate);
    console.log('_string_to_sign_v4',
        'method', aws_request.method,
        'pathname', aws_request.pathname(),
        'search', aws_request.search(),
        'headers', aws_request.headers,
        'region', aws_request.region,
        'canonical_str', '\n' + canonical_str + '\n',
        'string_to_sign', '\n' + string_to_sign + '\n');

    return string_to_sign;
}

function _expiry_query_v4(request_date, expires_seconds) {
    const now = Date.now();
    const expires = (new Date(request_date).getTime()) + (Number(expires_seconds) * 1000);
    if (now > expires) {
        throw new Error('Authentication Expired (V4)');
    }
}


////////
// S3 //
////////

function _authenticate_header_s3(req) {
    const s3 = req.headers.authorization.match(/^AWS (\w+):(\S+)$/);
    if (!s3) {
        throw new Error('Invalid AWS S3 Authorization: ' + req.headers.authorization);
    }
    req.access_key = s3[1];
    req.signature = s3[2];
    req.string_to_sign = _string_to_sign_s3(req);
}

function _authenticate_query_s3(req) {
    _expiry_query_s3(req.query.Expires);
    req.access_key = req.query.AWSAccessKeyId;
    req.signature = req.query.Signature;
    req.string_to_sign = _string_to_sign_s3(req);
}

function _string_to_sign_s3(req) {
    const aws_request = _aws_request(req);
    const s3 = new AWS.Signers.S3(aws_request);
    aws_request.headers['presigned-expires'] = req.headers.date;
    return s3.stringToSign();
}

function _expiry_query_s3(expires_epoch) {
    const now = Date.now();
    const expires = Number(expires_epoch) * 1000;
    if (now > expires) {
        throw new Error('Authentication Expired (S3)');
    }
}


const HEADERS_MAP_FOR_AWS_SDK = {
    'authorization': 'Authorization',
    'content-md5': 'Content-MD5',
    'content-type': 'Content-Type',
    'cache-control': 'Cache-Control',
    'x-amz-date': 'X-Amz-Date',
    'x-amz-content-sha256': 'X-Amz-Content-Sha256',
    'x-amz-security-token': 'x-amz-security-token',
    'presigned-expires': 'presigned-expires',
};

function _aws_request(req) {
    const u = url.parse(req.originalUrl);
    const pathname = path.normalize(decodeURI(u.pathname));
    const search_string = u.search ?
        AWS.util.queryParamsToString(
            AWS.util.queryStringParse(
                decodeURI(u.search.slice(1)))) :
        '';
    const headers_for_sdk = {};
    _.each(req.headers, (value, key) => {
        // mapping the headers from nodejs lowercase keys to AWS SDK capilization
        // using predefined map for specific cases used by the signers
        const sdk_key =
            HEADERS_MAP_FOR_AWS_SDK[key] ||
            (key.split('-')
                .map(_.capitalize)
                .join('-'));
        // for headers that were coalesced by nodejs http library
        // the values were joined with ', ' however we need to join only with ','
        const sdk_value = value.replace(/, /g, ',');
        headers_for_sdk[sdk_key] = sdk_value;
    });
    const aws_request = {
        region: req.noobaa_v4 && req.noobaa_v4.region,
        method: req.method,
        path: decodeURI(req.originalUrl),
        headers: headers_for_sdk,
        search: () => search_string,
        pathname: () => pathname,
    };
    return aws_request;
}


exports.signature = signature;
exports.authenticate_request = authenticate_request;
