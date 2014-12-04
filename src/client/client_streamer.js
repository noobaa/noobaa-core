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
        console.log('read', req.path);

        var object_key = {
            bucket: bucket,
            key: key,
        };

        client.object
            .read_object_md(object_key)
            .then(function(res_md) {
                serve_content(req, res, res_md.size, res_md.content_type, function(options) {
                    var params = _.extend({}, options, object_key);
                    return client.object.open_read_stream(params);
                });
            }).then(null, function(err) {
                res.status(500).send(err);
            });
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


/**
 *
 * serve_content
 *
 */
function serve_content(req, res, file_size, content_type, open_read_stream) {
    res.header('Content-Length', file_size);
    res.header('Content-Type', content_type);
    res.header('Accept-Ranges', 'bytes');

    var range_header = req.header('Range');
    if (!range_header) {
        console.log('serve_content: send all');
        open_read_stream().pipe(res);
        return;
    }

    /*
     * split regexp examples:
     *
     * input: bytes=100-200
     * output: [null, 100, 200, null]
     *
     * input: bytes=-200
     * output: [null, null, 200, null]
     */
    var range_array = range_header.split(/bytes=([0-9]*)-([0-9]*)/);
    var start_arg = range_array[1];
    var end_arg = range_array[2];
    var start = parseInt(start_arg) || 0;
    var end = (parseInt(end_arg) + 1) || file_size;
    if (!start_arg && end_arg) start = file_size - end;
    var valid_range = (start >= 0) && (end <= file_size) && (start <= end);

    if (!valid_range) {
        // indicate the acceptable range.
        res.header('Content-Range', 'bytes */' + file_size);
        // return the 416 'Requested Range Not Satisfiable'.
        console.log('serve_content: invalid range, send all', start, end, range_header);
        res.status(416);
        return;
    }

    res.header('Content-Range', 'bytes ' + start + '-' + (end - 1) + '/' + file_size);
    res.header('Content-Length', end - start);
    res.header('Cache-Control', 'no-cache');
    console.log('serve_content: send range', '[', start, ',', end, ']', range_header);

    // return the 206 'Partial Content'.
    res.status(206);
    open_read_stream({
        start: start,
        end: end,
    }).pipe(res);
}
