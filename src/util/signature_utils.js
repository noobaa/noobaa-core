/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const AWS = require('aws-sdk');
const dbg = require('../util/debug_module')(__filename);
const url = require('url');
const path = require('path');
const crypto = require('crypto');


///////////////////////////////////////
//                V4                 //
///////////////////////////////////////


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
    const v4 = req.headers.authorization.match(
        /^AWS4-HMAC-SHA256 Credential=(\S*),\s*SignedHeaders=(\S*),\s*Signature=(\S*)$/
    );
    if (!v4) {
        dbg.warn('Could not match AWS V4 Authorization:', req.headers.authorization);
        return;
    }
    const credentials = v4[1].split('/', 5);
    const signed_headers = v4[2];
    const xamzdate = req.headers['x-amz-date'];
    const region = credentials[2];
    const service = credentials[3];
    return {
        access_key: credentials[0],
        signature: v4[3],
        string_to_sign: _string_to_sign_v4(req, signed_headers, xamzdate, region, service),
        extra: {
            xamzdate,
            region,
            service,
        },
    };
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
    const credentials = req.query['X-Amz-Credential'].split('/', 5);
    const signed_headers = req.query['X-Amz-SignedHeaders'];
    const xamzdate = req.query['X-Amz-Date'];
    const region = credentials[2];
    const service = credentials[3];
    return {
        access_key: credentials[0],
        signature: req.query['X-Amz-Signature'],
        string_to_sign: _string_to_sign_v4(req, signed_headers, xamzdate, region, service),
        extra: {
            xamzdate,
            region,
            service,
        },
    };
}

const EMPTY_SHA256 = crypto.createHash('sha256').digest('hex');

function _string_to_sign_v4(req, signed_headers, xamzdate, region, service) {
    const aws_request = _aws_request(req, region);
    const v4 = new AWS.Signers.V4(aws_request, service, 'signatureCache');

    // If Signed Headers param doesn't exist we sign everything in order to support
    // chunked upload: http://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-streaming.html
    const signed_headers_set = signed_headers ?
        new Set(signed_headers.split(';')) : null;

    v4.isSignableHeader = key =>
        !signed_headers_set ||
        signed_headers_set.has(key.toLowerCase());

    v4.hexEncodedBodyHash = () => {
        if (req.query['X-Amz-Signature'] && service === 's3') {
            return 'UNSIGNED-PAYLOAD';
        }
        if (req.content_sha256) {
            return req.content_sha256.toString('hex');
        }
        return EMPTY_SHA256;
    };

    const canonical_str = v4.canonicalString();
    const string_to_sign = v4.stringToSign(xamzdate);
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

function _check_expiry_query_v4(request_date, expires_seconds) {
    const now = Date.now();
    const expires = (new Date(request_date).getTime()) + (Number(expires_seconds) * 1000);
    if (now > expires) {
        throw new Error('Authentication Expired (V4)');
    }
}



///////////////////////////////////////
//                S3                 //
///////////////////////////////////////


function _authenticate_header_s3(req) {
    const s3 = req.headers.authorization.match(
        /^AWS (\w+):(\S+)$/
    );
    if (!s3) {
        dbg.warn('Could not match AWS S3 Authorization:', req.headers.authorization);
        return;
    }
    return {
        access_key: s3[1],
        signature: s3[2],
        string_to_sign: _string_to_sign_s3(req),
    };
}

function _authenticate_query_s3(req) {
    return {
        access_key: req.query.AWSAccessKeyId,
        signature: req.query.Signature,
        string_to_sign: _string_to_sign_s3(req),
    };
}

function _string_to_sign_s3(req) {
    const aws_request = _aws_request(req);
    const s3 = new AWS.Signers.S3(aws_request);
    aws_request.headers['presigned-expires'] = req.query.Expires || req.headers.date;
    const string_to_sign = s3.stringToSign();
    console.log('_string_to_sign_s3',
        'method', aws_request.method,
        'pathname', aws_request.pathname(),
        'search', aws_request.search(),
        'headers', aws_request.headers,
        'string_to_sign', '\n' + string_to_sign + '\n');
    return string_to_sign;
}

function _check_expiry_query_s3(expires_epoch) {
    const now = Date.now();
    const expires = Number(expires_epoch) * 1000;
    if (now > expires) {
        throw new Error('Authentication Expired (S3)');
    }
}


// GENERAL

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

function _aws_request(req, region) {
    const u = url.parse(req.originalUrl);
    const pathname = path.normalize(decodeURI(u.pathname));
    const search_string = u.search ?
        AWS.util.queryParamsToString(
            _.omit(AWS.util.queryStringParse(
                    decodeURI(u.search.slice(1))),
                'X-Amz-Signature', 'Signature', 'Expires', 'AWSAccessKeyId')) :
        '';
    const headers_for_sdk = {};
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const key = req.rawHeaders[i].toLowerCase();
        const value = req.rawHeaders[i + 1];
        // mapping the headers from nodejs lowercase keys to AWS SDK capilization
        // using predefined map for specific cases used by the signers
        const sdk_key =
            HEADERS_MAP_FOR_AWS_SDK[key] ||
            (key.split('-')
                .map(_.capitalize)
                .join('-'));
        if (headers_for_sdk[sdk_key]) {
            headers_for_sdk[sdk_key] += ',' + value;
        } else {
            headers_for_sdk[sdk_key] = value;
        }
    }
    const aws_request = {
        region: region,
        method: req.method,
        path: decodeURI(req.originalUrl),
        headers: headers_for_sdk,
        search: () => search_string,
        pathname: () => pathname,
    };
    return aws_request;
}

/**
 *
 * Prepare HTTP request (express) authentication for sending to auth_server
 *
 */
function authenticate_request(req) {
    if (req.headers.authorization) {
        if (req.headers.authorization.startsWith('AWS4-HMAC-SHA256')) {
            return _authenticate_header_v4(req);
        }
        if (req.headers.authorization.startsWith('AWS ')) {
            return _authenticate_header_s3(req);
        }
        dbg.warn('Unrecognized Authorization Header:', req.headers.authorization);
    }
    if (req.query['X-Amz-Algorithm'] === 'AWS4-HMAC-SHA256') {
        return _authenticate_query_v4(req);
    }
    if (req.query.AWSAccessKeyId && req.query.Signature) {
        return _authenticate_query_s3(req);
    }
    dbg.warn('Anonymous request:', req.method, req.originalUrl, req.headers);
}


function check_expiry(req) {
    if (req.query['X-Amz-Date'] && req.query['X-Amz-Expires']) {
        _check_expiry_query_v4(req.query['X-Amz-Date'], req.query['X-Amz-Expires']);
    } else if (req.query.Expires) {
        _check_expiry_query_s3(req.query.Expires);
    }
}


/**
 *
 * Calculates AWS signature based on auth_server request
 *
 */
function signature(auth_token, secret_key) {

    // using S3 signer unless V4
    if (!auth_token.extra) {
        const s3 = new AWS.Signers.S3();
        return s3.sign(secret_key, auth_token.string_to_sign);
    }

    const aws_request = {
        region: auth_token.extra.region,
    };
    const aws_credentials = {
        accessKeyId: auth_token.access_key,
        secretAccessKey: secret_key,
    };

    // string_to_sign is already calculated in the proxy,
    // we override the signer function to just return the calculated string
    const v4 = new AWS.Signers.V4(aws_request, auth_token.extra.service, 'signatureCache');
    v4.stringToSign = () => auth_token.string_to_sign;
    return v4.signature(aws_credentials, auth_token.extra.xamzdate);
}


exports.authenticate_request = authenticate_request;
exports.signature = signature;
exports.check_expiry = check_expiry;
