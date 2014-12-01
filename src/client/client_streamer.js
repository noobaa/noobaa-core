/* jshint node:true */
'use strict';

var _ = require('lodash');
var Q = require('q');
var fs = require('fs');
var os = require('os');
var http = require('http');
var path = require('path');
var util = require('util');
var repl = require('repl');
var assert = require('assert');
var express = require('express');
var express_morgan_logger = require('morgan');
var express_body_parser = require('body-parser');
var express_method_override = require('method-override');
var express_compress = require('compression');
var size_utils = require('../util/size_utils');

module.exports = client_streamer;

/**
 *
 * CLIENT STREAMER
 *
 * an http server that serves requests on objects by streaming their data
 *
 */
function client_streamer(client, port) {
    var app = express();
    app.use(express_morgan_logger('dev'));
    app.use(express_body_parser.json());
    app.use(express_body_parser.raw({
        // size limit on raw requests
        limit: 16 * size_utils.MEGABYTE
    }));
    app.use(express_body_parser.text());
    app.use(express_body_parser.urlencoded({
        extended: false
    }));
    app.use(express_method_override());
    app.use(express_compress());

    app.get('/', function(req, res) {
        client.bucket.list_buckets()
            .then(function(reply) {
                console.log('list_buckets', reply);
                var h = '<html><body>';
                h += '<h1>Buckets</h1>';
                _.each(reply.buckets, function(b) {
                    var href = '/bucket/' + encodeURIComponent(b.name);
                    h += '<h3><a href="' + href + '">' + b.name + '</a></h3>';
                });
                h += '</body></html>';
                res.status(200).send(h);
            });
    });

    app.get('/bucket/:bucket', function(req, res) {
        var bucket = req.params.bucket;
        client.object.list_objects({
                bucket: bucket
            })
            .then(function(reply) {
                console.log('list_objects', bucket, reply);
                var h = '<html><body>';
                h += '<h1>Bucket ' + bucket + '</h1>';
                _.each(reply.objects, function(o) {
                    var href = '/bucket/' + encodeURIComponent(bucket) +
                        '/object/' + encodeURIComponent(o.key);
                    h += '<h3><a href="' + href + '">' + o.key +
                        ' <small>' + o.info.size + ' bytes</small></a></h3>';
                });
                h += '</body></html>';
                res.status(200).send(h);
            });
    });

    app.get('/bucket/:bucket/object/:key', function(req, res) {
        var bucket = req.params.bucket;
        var key = req.params.key;
        console.log('read', bucket, key);
        client.object.open_read_stream({
            bucket: bucket,
            key: key,
        }).pipe(res);
    });

    var defer = Q.defer();
    var server = http.createServer(app);
    server.once('error', defer.reject);
    server.listen(port, function() {
        console.log('streamer ready at: http://localhost:' + server.address().port);
        defer.resolve(server);
    });
    return defer.promise;
}
