'use strict';

var _ = require('lodash');
var Q = require('q');
var fs = require('fs');
var https = require('https');
var http = require('http');
var dbg = require('noobaa-util/debug_module')(__filename);
var pem = require('pem');
var s3_auth = require('aws-sdk/lib/signers/s3');
var _ = require('lodash');
var s3_util = require('../util/s3_utils');
var templateBuilder = require('./xml-template-builder');

module.exports = s3_app;



function s3_app(params) {


    var express = require('express');
    var app = express();
    //logger = require('./logger')(false),
    var Controllers = require('./controllers');
    var controllers = new Controllers(params);

    app.use(function(req, res, next) {

        return Q.fcall(function() {

            dbg.log0('S3 request. Time:', Date.now(), req.originalUrl, req.headers, req.query, req.query.prefix, req.query.delimiter);


            if (req.headers.authorization) {

                var s3 = new s3_auth(req);

                params.string_to_sign = s3_util.noobaa_string_to_sign(req, res.headers);

                // The original s3 code doesn't work well with express and query string.
                // It expects to see query string as part of the request.path.
                // debug code:
                // var awsSecretKey = 'abc';
                // var awsAccessKey = '123';
                // var s3_internal_signature = s3.sign(awsSecretKey, params.string_to_sign);
                // dbg.log0('s3 internal:::' + params.string_to_sign);
                // if (req.headers.authorization === 'AWS ' + awsAccessKey + ':' + s3_internal_signature) {
                //     dbg.log0('s3 internal authentication test passed!!!',s3_internal_signature);
                // } else {
                //     dbg.error('s3 internal authentication test failed!!! Computed signature is ',s3_internal_signature, 'while the expected signature is:',req.headers.authorization);
                // }


                var end_of_aws_key = req.headers.authorization.indexOf(':');
                var req_access_key = req.headers.authorization.substring(4, end_of_aws_key);
                params.access_key = req_access_key;
                params.signature = req.headers.authorization.substring(end_of_aws_key + 1, req.headers.authorization.lenth);

                return Q.fcall(function() {
                    return controllers.is_system_client_exists(params.access_key);
                }).then(function(is_exists) {
                    if (!is_exists) {
                        return controllers.add_new_system_client(params);
                    }else{
                        controllers.update_system_auth(params.access_key,params);
                    }

                });

            } else {
                //unauthorized...
                dbg.error('UNAUTHORIZED!!!!');
                var template = templateBuilder.buildSignatureDoesNotMatch('');
                res = controllers.buildXmlResponse(res, 401, template);
            }
        }).then(function() {
            if (req.headers.host) {
                if (req.headers.host.indexOf(params.bucket) === 0) {
                    req.url = req.url.replace('/', '/' + params.bucket + '/');
                    dbg.log0('update path with bucket name', req.url, req.path, params.bucket);
                }
                if (req.query.prefix && req.query.delimiter) {
                    if (req.query.prefix.indexOf(req.query.delimiter) < 0) {
                        req.url = req.url.replace(req.query.prefix, req.query.prefix + req.query.delimiter);
                        dbg.log0('updated prefix', req.url, req.query.prefix);
                        req.query.prefix = req.query.prefix + req.query.delimiter;

                    }
                }
                if (req.url.indexOf('/' + params.bucket + '?') >= 0) {
                    //req.url = req.url.replace(params.bucket,params.bucket+'/');
                    dbg.log0('updated bucket name with delimiter', req.url);
                }


            }
            next();

        })
        .then (null,function(err){
            dbg.error('Failure during new request handling',err,err.stack);
            return controllers.build_unauthorized_response(res,params.string_to_sign);
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
            return Q.nfcall(pem.createCertificate.bind(pem), {
                    days: 365 * 100,
                    selfSigned: true
                })
                .then(function(certificate_arg) {
                    certificate = certificate_arg;
                    return Q.Promise(function(resolve, reject) {
                        dbg.log0('Starting HTTP', params.port);
                        http.createServer(app.handle.bind(app))
                            .listen(params.port, function(err) {
                                if (err) {
                                    dbg.log0('HTTP listen', err);
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
                                    dbg.log0('HTTPS listen', err);
                                    reject(err);
                                } else {
                                    resolve();
                                }
                            });
                    });
                })
                .then(function() {
                    return Q.Promise(function(resolve, reject) {
                        dbg.log0('Starting Streamer', 5005);
                        http.createServer(app.handle.bind(app))
                            .listen(5005, function(err) {
                                if (err) {
                                    dbg.log0('Streamer listen', err);
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
