'use strict';
require('../util/panic');

var _ = require('lodash');
var Q = require('q');
var fs = require('fs');
var util = require('util');
var http = require('http');
var https = require('https');
var express = require('express');
var dbg = require('noobaa-util/debug_module')(__filename);
var argv = require('minimist')(process.argv);
var pem = require('../util/pem');
var api = require('../api');
var s3app = require('./app');

var params = argv;
var certificate;
var app = express();

// copied from s3rver. not sure why. but copy.
app.disable('x-powered-by');

Q.nfcall(fs.readFile, 'agent_conf.json')
    .then(function(data) {
        var agent_conf = JSON.parse(data);
        dbg.log0('using agent_conf.json', util.inspect(agent_conf));
        params = _.defaults(params, agent_conf);
        return;
    }).then(null, function(err) {
        dbg.log0('cannot find configuration file. Using defaults.' + err);
        params = _.defaults(params, {
            port: 80,
            ssl_port: 443,
        });
        return;
    }).then(function() {
        //Just in case part of the information is missing, add default params.
        params = _.defaults(params, {
            port: 80,
            ssl_port: 443,
        });
        if (params.address) {
            api.rpc.base_address = params.address;
        }
        return api.rpc.register_n2n_transport();
    })
    .then(function() {
        return Q.nfcall(pem.createCertificate.bind(pem), {
            days: 365 * 100,
            selfSigned: true
        });
    })
    .then(function(certificate_arg) {
        certificate = certificate_arg;

        app.use('/s3', s3app(params));
        app.use('/', function(req, res) {
            res.redirect('/s3');
        });

        return Q.Promise(function(resolve, reject) {
            dbg.log0('Starting HTTP', params.port);
            http.createServer(app)
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
                }, app)
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
        dbg.log0('S3RVER ERROR', err.stack || err);
    });
