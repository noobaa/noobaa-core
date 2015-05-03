'use strict';

var Q = require('q');
var https = require('https');
var http = require('http');
var api = require('../api');
var rpc_nudp = require('../rpc/rpc_nudp');
var dbg = require('noobaa-util/debug_module')(__filename);
var pem = require('./pem');
var s3_util = require('../util/s3_utils');

module.exports = s3_app;


function s3_app(params) {

    var express = require('express');
    var app = express();
    var Controllers = require('./controllers');
    var controllers = new Controllers(params);
    var allowCrossDomain = function(req, res, next) {
        res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Amz-User-Agent,X-Amz-Date,ETag');
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Expose-Headers', 'ETag');
        if (req.method === 'OPTIONS') {
            dbg.log3('OPTIONS!');
            res.sendStatus(200);
        } else {
            next();
        }
    };
    app.use(allowCrossDomain);
    app.use(function(req, res, next) {

        return Q.fcall(function() {

                dbg.log0('S3 request information. Time:', Date.now(), 'url:', req.originalUrl, 'headers:', req.headers, 'query string:', req.query, 'query prefix', req.query.prefix, 'query delimiter', req.query.delimiter);

                res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
                res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization,ETag');
                res.header('Access-Control-Allow-Origin', '*');
                // note that browsers will not allow origin=* with credentials
                // but anyway we allow it by the agent server.
                res.header('Access-Control-Allow-Credentials', true);
                res.header('ETag', '1');
                var authenticated_request = false;

                if (req.headers.authorization) {

                    //Using noobaa's extraction function, due to compatibility problem in aws library with express.

                    var end_of_aws_key = req.headers.authorization.indexOf(':');
                    var req_access_key = req.headers.authorization.substring(4, end_of_aws_key);
                    params.access_key = req_access_key;
                    params.signature = req.headers.authorization.substring(end_of_aws_key + 1, req.headers.authorization.lenth);
                    authenticated_request = true;
                } else if (req.query.AWSAccessKeyId && req.query.Signature) {
                    params.access_key = req.query.AWSAccessKeyId;
                    params.signature = req.query.Signature;
                    authenticated_request = true;
                    dbg.log0('signed url');
                }
                if (authenticated_request) {
                    // var s3 = new s3_auth(req);
                    params.string_to_sign = s3_util.noobaa_string_to_sign(req, res.headers);
                    // debug code.
                    // use it for faster detection of a problem in the signature calculation and verification
                    //
                    //
                    //  var s3_internal_signature = s3.sign(params.access_key, params.string_to_sign);
                    //  dbg.log0('s3 internal:::' + params.string_to_sign,req.query.Signature,req.headers.authorization);
                    //  if ((req.headers.authorization === 'AWS ' + params.access_key + ':' + s3_internal_signature) ||
                    //      (req.query.Signature === s3_internal_signature))
                    //  {
                    //      dbg.log0('s3 internal authentication test passed!!!',s3_internal_signature);
                    //  } else {
                    //
                    //      dbg.error('s3 internal authentication test failed!!! Computed signature is ',s3_internal_signature, 'while the expected signature is:',req.headers.authorization || req.query.Signature);
                    //  }

                    return Q.fcall(function() {
                        return controllers.is_system_client_exists(params.access_key);
                    }).then(function(is_exists) {
                        if (!is_exists) {
                            return controllers.add_new_system_client(params);
                        } else {
                            controllers.update_system_auth(params.access_key, params);
                        }

                    });

                } else {
                    //unauthorized...
                    dbg.error('Unauthorized request!');
                    throw (new Error('Unauthorized request!'));
                }
            }).then(function() {
                if (req.headers.host) {
                    //compatiblity update for various clients.
                    if (req.headers.host.indexOf(params.bucket) === 0) {
                        req.url = req.url.replace('/', '/' + params.bucket + '/');
                        dbg.log0('update path with bucket name', req.url, req.path, params.bucket);
                    }
                    // if (req.query.prefix && req.query.delimiter) {
                    //     if (req.query.prefix.indexOf(req.query.delimiter) < 0) {
                    //         req.url = req.url.replace(req.query.prefix, req.query.prefix + req.query.delimiter);
                    //         dbg.log0('updated prefix', req.url, req.query.prefix);
                    //         req.query.prefix = req.query.prefix + req.query.delimiter;
                    //
                    //     }
                    // }
                }
                next();

            })
            .then(null, function(err) {
                dbg.error('Failure during new request handling', err, err.stack);
                controllers.build_unauthorized_response(res, params.string_to_sign);
            });

    });

    app.disable('x-powered-by');

    /**
     * Routes for the application
     */
    app.get('/', controllers.getBuckets);
    app.get('/:bucket', controllers.bucketExists, controllers.getBucket);
    app.delete('/:bucket', controllers.bucketExists, controllers.deleteBucket);
    app.put('/:bucket', controllers.putBucket);
    app.put('/:bucket/:key(*)', controllers.bucketExists, controllers.putObject);
    app.get('/:bucket/:key(*)', controllers.bucketExists, controllers.getObject);
    app.head('/:bucket/:key(*)', controllers.getObject);
    app.delete('/:bucket/:key(*)', controllers.bucketExists, controllers.deleteObject);
    app.post('/:bucket/:key(*)', controllers.bucketExists, controllers.postMultipartObject);

    return {
        serve: function() {
            var certificate;
            return Q.fcall(function() {
                    // setup nudp socket
                    return rpc_nudp.listen(api.rpc, 0);
                })
                .then(function(nudp_socket) {
                    params.nudp_socket = nudp_socket;
                    return Q.nfcall(pem.createCertificate.bind(pem), {
                        days: 365 * 100,
                        selfSigned: true
                    });
                })
                .then(function(certificate_arg) {
                    certificate = certificate_arg;
                    return Q.Promise(function(resolve, reject) {
                        dbg.log0('Starting HTTP', params.port);
                        http.createServer(app.handle.bind(app))
                            .listen(params.port, function(err) {
                                if (err) {
                                    dbg.error('HTTP listen', err);
                                    reject(err);
                                } else {
                                    resolve();
                                }
                            });
                    });
                })
                .then(function() {
                    return Q.Promise(function(resolve, reject) {
                        dbg.log0('Starting HTTPS', params.ssl_port);
                        https.createServer({
                                key: certificate.serviceKey,
                                cert: certificate.certificate
                            }, app.handle.bind(app))
                            .listen(params.ssl_port, function(err) {
                                if (err) {
                                    dbg.error('HTTPS listen', err);
                                    reject(err);
                                } else {
                                    resolve();
                                }
                            });
                    });
                })
                .then(null, function(err) {
                    dbg.log0('SERVE ERROR', err.stack || err);
                });
        }
    };


}
