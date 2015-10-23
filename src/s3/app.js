'use strict';

var P = require('../util/promise');
var dbg = require('../util/debug_module')(__filename);
var s3_util = require('../util/s3_utils');
var express = require('express');

module.exports = s3app;

function s3app(params) {

    var app = express.Router();
    var Controllers = require('./controllers');
    var controllers = new Controllers(params);

    app.use(function allow_cross_domain(req, res, next) {

        res.header('Access-Control-Allow-Methods',
            'GET,POST,PUT,DELETE,OPTIONS');
        res.header('Access-Control-Allow-Headers',
            'Content-Type,Authorization,X-Amz-User-Agent,X-Amz-Date,ETag');
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Expose-Headers', 'ETag');
        // note that browsers will not allow origin=* with credentials
        // but anyway we allow it by the agent server.
        res.header('Access-Control-Allow-Credentials', true);
        res.header('ETag', '1');

        if (req.method === 'OPTIONS') {
            dbg.log0('OPTIONS!');
            res.status(200).end();
        } else {
            next();
        }
    });
    app.use(function(req, res, next) {
        if (req.method === 'POST') {
            var data = '';
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
    });
    app.use(function(req, res, next) {
        if (req.headers.host === 'testme') {
            dbg.log0('LB test page hit');
            return res.status(200).end();
        } else {

            return P.fcall(function() {

                    dbg.log0('S3 request information. Time:', Date.now(), 'url:', req.originalUrl, 'method:', req.method, 'headers:', req.headers, 'query string:', req.query, 'query prefix', req.query.prefix, 'query delimiter', req.query.delimiter);
                    var authenticated_request = false;

                    if (req.headers.authorization) {

                        //Using noobaa's extraction function, due to compatibility problem in aws library with express.
                        dbg.log0('authorization header exists', req.headers.authorization);

                        var end_of_aws_key = req.headers.authorization.indexOf(':');
                        var req_access_key = req.headers.authorization.substring(4, end_of_aws_key);
                        if (req_access_key === 'AWS4'){
                            //authorization: 'AWS4-HMAC-SHA256 Credential=wwwwwwwwwwwww123aaaa/20151023/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=0b04a57def200559b3353551f95bce0712e378c703a97d58e13a6eef41a20877',

                            var credentials_location = req.headers.authorization.indexOf('Credential')+11;

                            req_access_key = req.headers.authorization.substring(credentials_location, req.headers.authorization.indexOf('/'));
                        }
                        dbg.log0('req_access_key',req_access_key);

                        req.access_key = req_access_key;
                        req.signature = req.headers.authorization.substring(end_of_aws_key + 1, req.headers.authorization.lenth);
                        authenticated_request = true;
                    } else if (req.query.AWSAccessKeyId && req.query.Signature) {
                        req.access_key = req.query.AWSAccessKeyId;
                        req.signature = req.query.Signature;
                        authenticated_request = true;
                        dbg.log0('signed url');
                    }
                    if (authenticated_request) {
                        // var s3 = new s3_auth(req);
                        dbg.log0('authenticated request with signature', req.signature);
                        req.string_to_sign = s3_util.noobaa_string_to_sign(req, res.headers);
                        // debug code.
                        // use it for faster detection of a problem in the signature calculation and verification
                        //
                        //
                        //  var s3_internal_signature = s3.sign(req.access_key, req.string_to_sign);
                        //  dbg.log0('s3 internal:::' + req.string_to_sign,req.query.Signature,req.headers.authorization);
                        //  if ((req.headers.authorization === 'AWS ' + req.access_key + ':' + s3_internal_signature) ||
                        //      (req.query.Signature === s3_internal_signature))
                        //  {
                        //      dbg.log0('s3 internal authentication test passed!!!',s3_internal_signature);
                        //  } else {
                        //
                        //      dbg.error('s3 internal authentication test failed!!! Computed signature is ',s3_internal_signature, 'while the expected signature is:',req.headers.authorization || req.query.Signature);
                        //  }

                        return P.fcall(function() {
                            return controllers.is_system_client_exists(req.access_key);
                        }).then(function(is_exists) {
                            if (!is_exists) {
                                return controllers.add_new_system_client(req);
                            }
                        });

                    } else {
                        //unauthorized...
                        dbg.error('Unauthorized request!');
                        throw (new Error('Unauthorized request!'));
                    }
                }).then(function() {
                    next();
                })
                .then(null, function(err) {
                    dbg.error('Failure during new request handling', err, err.stack);
                    controllers.build_unauthorized_response(res, req.string_to_sign);
                });
        }

    });

    /**
     * Routes for the application
     *
     * We will authenticate the signatures on the following methods:
     * getBuckets (listBuckets)
     * bucketExists (listBuckets)
     * putBucket (listBuckets)
     *
     */
    app.get('/', controllers.getBuckets);
    app.get('/:bucket', controllers.bucketExists, controllers.getBucket);
    app.delete('/:bucket', controllers.bucketExists, controllers.deleteBucket);
    app.put('/:bucket', controllers.putBucket);
    app.put('/:bucket/:key(*)', controllers.bucketExistsInCache, controllers.putObject);
    app.get('/:bucket/:key(*)', controllers.bucketExists, controllers.getObject);
    app.head('/:bucket/:key(*)', controllers.bucketExists, controllers.getObject);
    app.delete('/:bucket/:key(*)', controllers.bucketExists, controllers.deleteObject);
    app.post('/:bucket', controllers.bucketExists, controllers.deleteObjects);
    app.post('/:bucket/:key(*)', controllers.bucketExistsInCache, controllers.postMultipartObject);

    return app;
}
