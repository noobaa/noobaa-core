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

module.exports = s3_app;


function s3_app(params) {


    var express = require('express');
    var app = express();
    //logger = require('./logger')(false),
    var Controllers = require('./controllers');
    var controllers = new Controllers(params);

    app.use(function(req, res, next) {

        Q.fcall(function() {

            dbg.log0('S3 request. Time:', Date.now(), req.originalUrl, req.headers, req.query, req.query.prefix, req.query.delimiter);


            if (req.headers.authorization) {

                var awsSecretKey = 'abc';
                var awsAccessKey = '123';

                var s3 = new s3_auth(req);
                dbg.log0('s3 string:', s3.stringToSign());
                var s3_signature = s3.sign(awsSecretKey, s3.stringToSign());
                dbg.log0('s3:::' + s3_signature);
                if (req.headers.authorization === 'AWS ' + awsAccessKey + ':' + s3_signature) {
                    dbg.log0('s3 authentication test passed!!!');
                } else {
                    dbg.log0('s3 authentication test failed!!!');
                }
                var end_of_aws_key = req.headers.authorization.indexOf(':');
                var req_access_key = req.headers.authorization.substring(4, end_of_aws_key);
                req.params.aws_access_key = req_access_key;
                params.aws_access_key = req_access_key;

                dbg.log0('controller?', controllers, ' req - aws', req.params.aws_access_key, ' param - aws', params.aws_access_key, ' key ', req_access_key, end_of_aws_key);
                return Q.fcall(function() {
                    return controllers.is_system_client_exists(req_access_key);
                }).then(function(is_exists) {
                    if (!is_exists) {
                        return controllers.add_new_system_client(params);
                    }

                });

            } else {
                req.unauthorized(403, 'unauthorized');
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
