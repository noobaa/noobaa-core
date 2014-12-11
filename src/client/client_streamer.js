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
var moment = require('moment');
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
                h += '<h1>List of available buckets</h1>';
                _.each(reply.buckets, function(b) {
                    var href = '/b/' + encodeURIComponent(b.name);
                    h += '<h3><a href="' + href + '">' + b.name + '</a></h3>';
                });
                h += '</body></html>';
                res.status(200).send(h);
            }).then(null, function(err) {
                console.error('ERROR buckets page', err.stack);
                res.status(500).send(err);
            });
    });

    app.get('/b/:bucket', function(req, res) {
        var bucket = req.params.bucket;
        client.object.list_objects({
                bucket: bucket
            })
            .then(function(reply) {
                console.log('list_objects', bucket, reply);
                var h = '<html>';
                h += '<head>';
                h += ' <style>th, td { padding: 5px 10px; }</style>';
                h += '</head>';
                h += '<body>';
                h += '<h1>' + bucket + '</h1>';
                h += '<table>';
                h += '<thead><tr>';
                h += ' <th>File</th>';
                h += ' <th>Size</th>';
                h += ' <th>Type</th>';
                h += ' <th>Created</th>';
                h += ' <th></th>';
                h += '</thead>';
                h += '<tbody>';
                _.each(reply.objects, function(o) {
                    var href = '/b/' + encodeURIComponent(bucket);
                    if (/^video\//.test(o.info.content_type)) {
                        href += '/video/' + encodeURIComponent(o.key);
                    } else {
                        href += '/o/' + encodeURIComponent(o.key);
                    }
                    var create_time = new Date(o.info.create_time);
                    h += '<tr>';
                    h += ' <td><a href="' + href + '">' + o.key + '</a></td>';
                    h += ' <td>' + size_utils.human_size(o.info.size) + '</td>';
                    h += ' <td>' + o.info.content_type + '</td>';
                    h += ' <td title="' + create_time.toLocaleString() + '">' +
                        moment(create_time).fromNow() + '</td>';
                    h += ' <td>' + (o.info.upload_mode ? 'uploading...' : '') + '</td>';
                    h += '</tr>';
                });
                h += '</tbody></table></body></html>';
                res.status(200).send(h);
            }).then(null, function(err) {
                console.error('ERROR objects page', err.stack);
                res.status(500).send(err);
            });
    });

    app.get('/b/:bucket/video/:key', function(req, res) {
        Q.fcall(function() {
            var bucket = req.params.bucket;
            var key = req.params.key;
            var href = '/b/' + encodeURIComponent(bucket) + '/o/' + encodeURIComponent(key);
            var h = '<html>';
            h += '<head>';
            h += ' <link href="/video.js/video-js.css" rel="stylesheet">';
            h += ' <script src="/video.js/video.js"></script>';
            h += ' <script>videojs.options.flash.swf = "/video.js/video-js.swf"</script>';
            h += ' <style>';
            h += '   html, body { width: 100%; height: 100%; margin: 0; padding: 0; }';
            h += '   .video-js {';
            h += '     position: relative !important;';
            h += '     width: 100% !important;';
            h += '     height: 100% !important; }';
            h += ' </style>';
            h += '</head>';
            h += '<body>';
            h += ' <video controls preload="auto"';
            h += '   class="video-js vjs-default-skin vjs-big-play-centered"';
            h += '   data-setup=\'{"example_option":true}\'>';
            h += '   <source type="video/mp4" src="' + href + '" />';
            h += ' </video>';
            h += '</body>';
            h += '</html>';
            res.status(200).send(h);
        }).then(null, function(err) {
            console.error('ERROR video page', err.stack);
            res.status(500).send(err);
        });
    });

    app.get('/b/:bucket/o/:key', function(req, res) {
        console.log('read', req.path);
        client.object.serve_http_stream(req, res, _.pick(req.params, 'bucket', 'key'));
    });

    app.use('/video.js/', express.static('./node_modules/video.js/dist/video-js/'));


    var defer = Q.defer();
    var server = http.createServer(app);
    server.once('error', defer.reject);
    server.listen(port, function() {
        console.log('streamer ready at: http://localhost:' + server.address().port);
        defer.resolve(server);
    });
    return defer.promise;
}
