/* global angular */
'use strict';

var _ = require('lodash');
var moment = require('moment');
var size_utils = require('../util/size_utils');
var SliceReader = require('../util/slice_reader');
var BrowserFileWriter = require('../util/browser_file_writer');
var concat_stream = require('concat-stream');
var AWS = require('aws-sdk');
var nb_api = angular.module('nb_api');
var streams = require('stream');


nb_api.factory('nbFiles', [
    '$http', '$q', '$window', '$timeout', '$sce', 'nbAlertify', '$rootScope', 'nbClient', '$location', 'nbSystem',
    function($http, $q, $window, $timeout, $sce, nbAlertify, $rootScope, nbClient, $location, nbSystem) {
        var $scope = {};

        $scope.list_files = list_files;
        $scope.get_file = get_file;
        $scope.list_file_parts = list_file_parts;
        $scope.create_bucket = create_bucket;
        $scope.upload_file = upload_file;
        $scope.download_file = download_file;
        $scope.clear_upload = clear_upload;
        $scope.clear_download = clear_download;
        $scope.read_entire_object = read_entire_object;
        $scope.read_as_media_stream = read_as_media_stream;
        $scope.set_access_keys = set_access_keys;

        $scope.uploads = [];
        $scope.downloads = [];
        $scope.transfers = [];
        $scope.s3 = null;
        $scope.web_port = 0;
        $scope.ssl_port = 0;
        // call first time with empty keys to initialize s3
        set_access_keys();

        angular.element($window).on('beforeunload', function() {
            var num_uploads = 0;
            var num_downloads = 0;
            _.each($scope.transfers, function(tx) {
                if (tx.running) {
                    if (tx.type === 'upload') {
                        num_uploads += 1;
                    } else {
                        num_downloads += 1;
                    }
                }
            });
            var warning = 'Leaving this page will interrupt the transfers';
            if (num_uploads && num_downloads) {
                return 'Uploads and Downloads are in progress. ' + warning;
            } else if (num_uploads) {
                return 'Uploads are in progress. ' + warning;
            } else if (num_downloads) {
                return 'Downloads are in progress. ' + warning;
            }
        });

        //update access keys.
        //TODO: find more secured approach
        function set_access_keys(access_keys, web_port, ssl_port) {
            $scope.web_port = web_port;
            $scope.ssl_port = ssl_port;
            if (!_.isEmpty(access_keys)) {
                AWS.config.update({
                    accessKeyId: access_keys[0].access_key,
                    secretAccessKey: access_keys[0].secret_key,
                    sslEnabled: false
                });
                console.log('updated keys', access_keys[0].access_key, $location);
            }
            /*
            //TODO: move to ssl. disable certificate validation.
            var ep = new AWS.Endpoint({
                protocol: 'http',
                port: 80,
                hostname: '127.0.0.1'
            });
            */
            //var access_key_id = 'd36e02598bf347148752';
            //var secret_access_key = 'f25cd46a-e105-4518-ac75-0d033745b4e1';

            // var rest_port = 80;
            // var rest_ssl_port = 443;
            // var http_endpoint = 'http://127.0.0.1' +
            //     (rest_port ? ':' + rest_port : '')+'/s3';
            // var https_endpoint = 'https://127.0.0.1' +
            //     (rest_ssl_port ? ':' + rest_ssl_port : '')+'/s3';
            //var rest_host = ($window.location.host).replace(':'+web_port,'').replace(':'+ssl_port,':443');
            var rest_host = ($window.location.host).replace(':' + web_port, '').replace(':' + ssl_port, '');

            console.log('SYS1:' + web_port + ' host:' + rest_host);

            var rest_endpoint = $window.location.protocol + '//' + rest_host;
            rest_endpoint = rest_endpoint.replace('https', 'http');
            console.log('win:', $window.location, ":", rest_endpoint);
            $scope.s3 = new AWS.S3({
                // endpoint: $window.location.protocol === 'https:' ?
                //     https_endpoint : http_endpoint,
                endpoint: rest_endpoint,
                s3ForcePathStyle: true,
                sslEnabled: false,
            });
        }

        function list_files(params) {
            return $q.when()
                .then(function() {
                    return nbClient.client.object.list_objects(params);
                })
                .then(function(res) {
                    var files = _.map(res.objects, make_file_info);
                    console.log('FILES', res);
                    return {
                        total_count: res.total_count,
                        files: files,
                    };
                });
        }

        function get_file(params, cache_miss) {
            return $q.when()
                .then(function() {
                    return nbClient.client.object_driver_lazy().get_object_md(params, cache_miss);
                })
                .then(function(res) {
                    console.log('FILE', res, params.key);
                    var file_info = make_file_info({
                        key: params.key,
                        info: res
                    });

                    var url = $scope.s3.getSignedUrl('getObject', {
                        Bucket: params.bucket,
                        Key: params.key
                    });
                    url = url.replace(':' + $scope.web_port, '').replace(':' + $scope.ssl_port, ':443');

                    console.log('urlll:', url);
                    file_info.url = url;
                    return file_info;
                });
        }

        function make_file_info(obj) {
            var file = obj.info;
            file.create_time = moment(new Date(file.create_time));
            file.name = obj.key;
            return file;
        }

        function list_file_parts(params) {
            return $q.when()
                .then(function() {
                    return nbClient.client.object.read_object_mappings(params);
                })
                .then(function(res) {
                    _.each(res.parts, function(part) {
                        // TODO handle parity frags
                        var frag_size = part.chunk.size / part.chunk.data_frags;
                        _.each(part.frags, function(fragment) {
                            fragment.start = part.start + (frag_size * fragment.frag);
                            fragment.size = frag_size;
                        });
                    });
                    console.log('LIST FILE PARTS', res);
                    return res;
                });
        }

        function create_bucket() {
            return nbAlertify.prompt('Enter name for new bucket')
                .then(function(str) {
                    if (!str) return;
                    return $q.when(nbClient.client.object.create_bucket({
                        bucket: str
                    }));
                });
        }

        function upload_file(bucket_name) {
            return input_file_chooser()
                .then(function(file) {
                    if (!file) return;
                    return run_upload(file, bucket_name);
                });
        }

        function input_file_chooser() {
            return $q(function(resolve, reject) {
                var chooser = angular.element('<input type="file">');
                chooser.on('change', function(e) {
                    var file = e.target.files[0];
                    resolve(file);
                });
                chooser.click();
            });
        }

        function run_upload(input_file, bucket_name, use_object_client) {
            var ext_match = input_file.name.match(/^(.*)(\.[^\.]*)$/);
            var serial = (((Date.now() / 1000) % 10000000) | 0).toString();
            var tx = {
                type: 'upload',
                input_file: input_file,
                bucket: bucket_name,
                name: ext_match ?
                    (ext_match[1] + '_' + serial + ext_match[2]) : (input_file.name + '_' + serial),
                size: input_file.size,
                content_type: input_file.type,
                start_time: Date.now(),
                progress: 0,
                running: true,
            };
            console.log('upload', tx);

            if (use_object_client) {
                tx.promise = $q.when(nbClient.client.object_driver_lazy().upload_stream({
                        bucket: tx.bucket,
                        key: tx.name,
                        size: tx.size,
                        content_type: tx.content_type,
                        source_stream: new SliceReader(tx.input_file, {
                            highWaterMark: size_utils.MEGABYTE,
                            FileReader: $window.FileReader,
                        }),
                        progress: function(part) {
                            tx.progress = 100 * part.end / tx.size;
                        }
                    }))
                    .then(function() {
                        _.pull($scope.transfers, tx);
                        tx.done = true;
                        tx.progress = 100;
                        tx.running = false;
                        tx.end_time = Date.now();
                        var duration = (tx.end_time - tx.start_time) / 1000;
                        var elapsed = duration.toFixed(1) + 'sec';
                        var speed = $rootScope.human_size(tx.size / duration) + '/sec';
                        console.log('upload completed', elapsed, speed);
                        nbAlertify.success('upload completed');
                    }, function(err) {
                        _.pull($scope.transfers, tx);
                        tx.error = err;
                        tx.running = false;
                        console.error('upload failed1', err);
                        nbAlertify.error('upload failed. ' + err.toString());
                    });
            } else {
                tx.promise = $q(function(resolve, reject, notify) {
                    console.log('starting');
                    // var s3req =
                    $scope.s3.upload({
                        Key: tx.name,
                        Bucket: tx.bucket,
                        Body: tx.input_file,
                        ContentType: tx.content_type
                    }, function(err, data) {
                        if (err) {
                            console.error('upload failed (s3)', err, err.stack);
                            _.pull($scope.transfers, tx);
                            tx.error = err;
                            tx.running = false;
                            nbAlertify.error('upload failed (s3). ' + err.toString());
                            reject(new Error('upload failed'));
                            $rootScope.safe_apply();
                        } else {
                            // Success!
                            console.log('upload done!!!!');
                            _.pull($scope.transfers, tx);
                            tx.done = true;
                            tx.progress = 100;
                            tx.running = false;
                            tx.end_time = Date.now();
                            var duration = (tx.end_time - tx.start_time) / 1000;
                            var elapsed = duration.toFixed(1) + 'sec';
                            var speed = $rootScope.human_size(tx.size / duration) + '/sec';
                            console.log('upload completed', elapsed, speed);
                            nbAlertify.success('upload completed');
                            resolve();
                            $rootScope.safe_apply();
                        }
                    }).on('httpUploadProgress', function(progress) {
                        // Log Progress Information
                        console.log(Math.round(progress.loaded / progress.total * 100) + '% done');
                        console.log('prog info');
                        // var pos = progress.loaded && progress.total || 0;
                        tx.progress = Math.round(progress.loaded / progress.total * 100);
                        $rootScope.safe_apply();
                    });

                });
            }

            $scope.uploads.push(tx);
            $scope.transfers.push(tx);
            return tx.promise;
        }

        function clear_upload(tx) {
            _.pull($scope.uploads, tx);
        }

        function clear_download(tx) {
            _.pull($scope.downloads, tx);
        }

        function download_file(bucket_name, file, use_object_client) {
            return open_temp_file_write_stream()
                .then(function(res) {
                    var tx = {
                        type: 'download',
                        bucket: bucket_name,
                        file: file,
                        output_file: res.file_entry,
                        url: res.file_entry.toURL(),
                        name: file.name,
                        size: file.size,
                        content_type: file.type,
                        start_time: Date.now(),
                        progress: 0,
                        running: true
                    };
                    tx.promise = $q(function(resolve, reject, progress) {

                        var reader;
                        if (use_object_client) {
                            reader = nbClient.client.object_driver_lazy().open_read_stream({
                                    bucket: bucket_name,
                                    key: file.name,
                                })
                                .once('error', on_error);
                        } else {
                            var s3req = $scope.s3.getObject({
                                Bucket: bucket_name,
                                Key: file.name,
                            });
                            reader = createReadStream(s3req);
                        }

                        reader.pipe(res.writer)
                            .on('progress', function(pos) {
                                console.log('progress', pos);
                                tx.progress = (100 * pos / file.size);
                                if (progress) {
                                    progress(pos);
                                }
                                $rootScope.safe_apply();
                            })
                            .once('finish', function() {

                                _.pull($scope.transfers, tx);
                                tx.done = true;
                                tx.progress = 100;
                                tx.running = false;
                                tx.end_time = Date.now();
                                var duration = (tx.end_time - tx.start_time) / 1000;
                                var elapsed = duration.toFixed(1) + 'sec';
                                var speed = $rootScope.human_size(tx.size / duration) + '/sec';
                                console.log('download completed', elapsed, speed);

                                var a = $window.document.createElement('a');
                                a.href = tx.url;
                                a.target = '_blank';
                                a.download = tx.name || '';
                                var click = $window.document.createEvent('Event');
                                click.initEvent('click', true, true);
                                a.dispatchEvent(click);

                                nbAlertify.success('download completed');
                                resolve();
                                $rootScope.safe_apply();
                            })
                            .once('error', on_error);

                        function on_error(err) {
                            _.pull($scope.transfers, tx);
                            tx.error = err;
                            tx.running = false;
                            console.error('download failed ' + err + ' ; ' + err.stack);
                            nbAlertify.error('download failed. ' + err.toString());
                            reject(err);
                            $rootScope.safe_apply();
                        }
                    });
                    console.log('DOWNLOAD', tx, tx.promise);
                    $scope.downloads.push(tx);
                    $scope.transfers.push(tx);
                    $rootScope.safe_apply();
                    return tx;
                });
        }


        //copied code.
        //TODO: replace or better understand how to use the standard amazon API
        function createReadStream(req) {
            var stream = null;
            var legacyStreams = false;

            if (AWS.HttpClient.streamsApiVersion === 2) {
                stream = new streams.Readable();
                stream._read = function() {};
            } else {
                stream = new streams.Stream();
                stream.readable = true;
            }

            stream.sent = false;
            stream.on('newListener', function(event) {
                if (!stream.sent && (event === 'data' || event === 'readable')) {
                    if (event === 'data') legacyStreams = true;
                    stream.sent = true;
                    process.nextTick(function() {
                        req.send(function() {});
                    });
                }
            });

            req.on('httpHeaders', function streamHeaders(statusCode, headers, resp) {
                if (statusCode < 300) {
                    req.removeListener('httpData', AWS.EventListeners.Core.HTTP_DATA);
                    req.removeListener('httpError', AWS.EventListeners.Core.HTTP_ERROR);
                    req.on('httpError', function streamHttpError(error) {
                        resp.error = error;
                        resp.error.retryable = false;
                    });

                    var httpStream = resp.httpResponse.createUnbufferedStream();
                    if (legacyStreams) {
                        httpStream.on('data', function(arg) {
                            stream.emit('data', arg);
                        });
                        httpStream.on('end', function() {
                            stream.emit('end');
                        });
                    } else {
                        httpStream.on('readable', function() {
                            var chunk;
                            do {
                                chunk = httpStream.read();
                                if (chunk !== null) stream.push(chunk);
                            } while (chunk !== null);
                            stream.read(0);
                        });
                        httpStream.on('end', function() {
                            stream.push(null);
                        });
                    }

                    httpStream.on('error', function(err) {
                        stream.emit('error', err);
                    });
                }
            });

            req.on('error', function(err) {
                stream.emit('error', err);
            });

            return stream;
        }

        function open_temp_file_write_stream() {
            return $q(function(resolve, reject, progress) {
                var temp_storage =
                    $window.navigator.temporaryStorage ||
                    $window.navigator.webkitTemporaryStorage;
                var request_fs =
                    $window.requestFileSystem ||
                    $window.webkitRequestFileSystem;
                var fssize = 1;
                var temp_fname = Date.now().toString();
                temp_storage.requestQuota(fssize, function() {
                    request_fs($window.TEMPORARY, fssize, function(fs) {
                        fs.root.getFile(temp_fname, {
                            create: true,
                            exclusive: true
                        }, function(file_entry) {
                            file_entry.createWriter(function(file_writer) {
                                resolve({
                                    fs: fs,
                                    file_entry: file_entry,
                                    writer: new BrowserFileWriter(file_writer, $window.Blob, {
                                        highWaterMark: size_utils.MEGABYTE,
                                    })
                                });
                            }, reject);
                        }, reject);
                    }, reject);
                }, reject);
            });
        }

        function read_entire_object(object) {
            var object_path = {
                bucket: object.bucket.name,
                key: object.key,
            };
            var defer = $q.defer();
            var stream = concat_stream(defer.resolve);
            var source = nbClient.client.object_driver_lazy().open_read_stream(object_path);
            source.once('error', defer.reject);
            stream.once('error', defer.reject);
            source.pipe(stream);
            return defer.promise;
        }

        function read_as_media_stream(object) {
            if (!object.key.match(/.*\.(webm)/)) {
                return;
            }
            var object_path = {
                bucket: object.bucket.name,
                key: object.key,
            };
            var ms = new $window.MediaSource();
            ms.addEventListener('sourceopen', function(e) {
                // TODO need to have content type, and check support for types
                var source_buffer = ms.addSourceBuffer('video/webm; codecs="vp8, vorbis"');
                var stream = nbClient.client.object_driver_lazy().open_read_stream(object_path);
                var video = $window.document.getElementsByTagName('video')[0];
                video.addEventListener('progress', function() {
                    stream.resume();
                });
                stream.on('data', function(data) {
                    console.log('STREAM DATA', data.length);
                    if (source_buffer.updating) {
                        stream.pause();
                    }
                    source_buffer.appendBuffer(data.toArrayBuffer());
                });
                stream.once('finish', function() {
                    console.log('STREAM FINISH');
                    ms.endOfStream();
                });
                stream.once('error', function(err) {
                    console.log('STREAM ERROR', err);
                    ms.endOfStream(err);
                });
            }, false);
            return $window.URL.createObjectURL(ms);
        }

        return $scope;
    }
]);
