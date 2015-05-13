/* jshint node:true */
'use strict';

var _ = require('lodash');
var Q = require('q');
var http = require('http');
var moment = require('moment');
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
                var html_arrays = [
                    '<html>',
                    '<head>',
                    ' <style>th, td { padding: 5px 10px; }</style>',
                    '</head>',
                    '<body>',
                    ' <h1>' + bucket + '</h1>',
                    ' <table>',
                    '  <thead><tr>',
                    '   <th>File</th>',
                    '   <th>Size</th>',
                    '   <th>Type</th>',
                    '   <th>Created</th>',
                    '   <th></th>',
                    '  </thead>',
                    '  <tbody>',
                    _.map(reply.objects, function(o) {
                        var href = '/b/' + encodeURIComponent(bucket);
                        if (/^video\//.test(o.info.content_type)) {
                            href += '/video/' + encodeURIComponent(o.key);
                        } else {
                            href += '/o/' + encodeURIComponent(o.key);
                        }
                        var create_time = new Date(o.info.create_time);
                        return [
                            '<tr>',
                            ' <td><a href="' + href + '">' + o.key + '</a></td>',
                            ' <td>' + size_utils.human_size(o.info.size) + '</td>',
                            ' <td>' + o.info.content_type + '</td>',
                            ' <td title="' + create_time.toLocaleString() + '">' +
                            moment(create_time).fromNow() + '</td>',
                            ' <td>' + (_.isNumber(o.info.upload_size) ?
                                'uploading ' +
                                (100 * o.info.upload_size / o.info.size).toFixed(0) +
                                '% ...' :
                                '') + '</td>',
                            '</tr>'
                        ];
                    }),
                    '  </tbody>',
                    ' </table>',
                    '</body>',
                    '</html>'
                ];
                var html = _.flattenDeep(html_arrays).join('\n');
                res.status(200).send(html);
            })
            .then(null, function(err) {
                console.error('ERROR objects page', err.stack);
                res.status(500).send(err);
            });
    });

    app.get('/b/:bucket/video/:key', function(req, res) {
        var bucket = req.params.bucket;
        var key = req.params.key;
        client.object_driver_lazy().get_object_md({
                bucket: bucket,
                key: key,
            })
            .then(function(md) {
                var href = '/b/' + encodeURIComponent(bucket) + '/o/' + encodeURIComponent(key);
                var html_arrays = [
                    '<html>',
                    '<head>',
                    ' <link href="/video.js/video-js.css" rel="stylesheet" />',
                    ' <script src="/video.js/video.js"></script>',
                    ' <script' + '>', // hack to make jshint happy
                    '  /* global videojs */',
                    '  videojs.options.flash.swf = "/video.js/video-js.swf";',
                    ' </script>',
                    ' <style>',
                    '   html, body { width: 100%; height: 100%; margin: 0; padding: 0; }',
                    '   .video-js {',
                    '     position: relative !important;',
                    '     width: 100% !important;',
                    '     height: 100% !important; }',
                    ' </style>',
                    '</head>',
                    '<body>',
                    ' <video controls preload="auto"',
                    '   class="video-js vjs-default-skin vjs-big-play-centered"',
                    '   data-setup=\'{"example_option":true}\'>',
                    '   <source type="' + md.content_type + '" src="' + href + '" />',
                    ' </video>',
                    '</body>',
                    '</html>'
                ];
                var html = _.flattenDeep(html_arrays).join('\n');
                res.status(200).send(html);
            })
            .then(null, function(err) {
                console.error('ERROR video page', err.stack);
                res.status(500).send(err);
            });
    });

    // using a strict encoding to also handle the remaining special chars
    function rfc3986EncodeURIComponent(str) {
        return encodeURIComponent(str).replace(/[!'()*]/g, global.escape);
    }

    function name_to_content_dispos(name, download) {
        return (download ? 'attachment;' : 'inline;') +
            'filename="' + rfc3986EncodeURIComponent(name) + '"';
    }

    app.get('/b/:bucket/o/:key', function(req, res) {
        console.log('read', req.path);
        res.header('content-disposition',
            name_to_content_dispos(req.param('key'), req.query.download));
        client.object_driver_lazy().serve_http_stream(req, res, _.pick(req.params, 'bucket', 'key'));
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
