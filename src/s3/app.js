'use strict';

var _ = require('lodash');
var Q = require('q');
var fs = require('fs');
var https = require('https');
var http = require('http');
var dbg = require('noobaa-util/debug_module')(__filename);
var pem = require('pem');


module.exports = s3_app;


function s3_app(params) {


    var express = require('express'),
        app = express(),
        //logger = require('./logger')(false),
        Controllers = require('./controllers'),
        controllers = new Controllers(params),
        concat = require('concat-stream');



    // app.use(function(req, res, next) {
    //
    //     req.pipe(concat(function(data) {
    //         req.body = data;
    //         next();
    //     }));
    // });

    app.use(function(req, res, next) {
        dbg.log0('Time:', Date.now(), req.headers, req.query, req.query.prefix, req.query.delimiter);
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
                                dbg.log0('HTTP listen', err);
                                if (err) {
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
                                dbg.log0('HTTPS listen', err);
                                if (err) {
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


};
