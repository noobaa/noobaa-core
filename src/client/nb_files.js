/* global angular */
'use strict';

var _ = require('lodash');
var util = require('util');
var moment = require('moment');
var size_utils = require('../util/size_utils');
var api = require('../api');
var SliceReader = require('../util/slice_reader');
var BrowserFileWriter = require('../util/browser_file_writer');
var concat_stream = require('concat-stream');

var nb_api = angular.module('nb_api');


nb_api.factory('nbFiles', [
    '$http', '$q', '$window', '$timeout', '$sce', 'nbAlertify', '$rootScope', 'nbClient',
    function($http, $q, $window, $timeout, $sce, nbAlertify, $rootScope, nbClient) {
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

        $scope.uploads = [];
        $scope.downloads = [];
        $scope.transfers = [];

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

        function list_files(params) {
            return $q.when()
                .then(function() {
                    return nbClient.client.object.list_objects(params);
                })
                .then(function(res) {
                    var objects = _.map(res.objects, make_file_info);
                    console.log('FILES', res);
                    return objects;
                });
        }

        function get_file(params, cache_miss) {
            return $q.when()
                .then(function() {
                    return nbClient.client.object_client.get_object_md(params, cache_miss);
                })
                .then(function(res) {
                    console.log('FILE', res);
                    return make_file_info({
                        key: params.key,
                        info: res,
                    });
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
                        var frag_size = part.chunk_size / part.kfrag;
                        _.each(part.fragments, function(fragment, fragment_index) {
                            fragment.start = part.start + (frag_size * fragment_index);
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

        function run_upload(input_file, bucket_name) {
            var tx = {
                type: 'upload',
                input_file: input_file,
                bucket: bucket_name,
                name: input_file.name,
                size: input_file.size,
                content_type: input_file.type,
                start_time: Date.now(),
                progress: 0,
                running: true,
            };
            console.log('upload', tx);
            tx.promise = $q.when(nbClient.client.object_client.upload_stream({
                    bucket: tx.bucket,
                    key: tx.name,
                    size: tx.size,
                    add_suffix: true,
                    content_type: tx.content_type,
                    source_stream: new SliceReader(tx.input_file, {
                        highWaterMark: size_utils.MEGABYTE,
                        FileReader: $window.FileReader,
                    }),
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
                    console.error('upload failed', err);
                    nbAlertify.error('upload failed. ' + err.toString());
                }, function(progress) {
                    if (progress.event === 'part:after') {
                        var pos = progress.part && progress.part.end || 0;
                        tx.progress = 100 * pos / tx.size;
                    }
                    return progress;
                });
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

        function download_file(bucket_name, file) {
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

                        var reader = nbClient.client.object_client.open_read_stream({
                                bucket: bucket_name,
                                key: file.name,
                            })
                            .once('error', on_error);

                        reader.pipe(res.writer)
                            .on('progress', function(pos) {

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
                    console.log('DOWNLOAD', tx);
                    $scope.downloads.push(tx);
                    $scope.transfers.push(tx);
                    $rootScope.safe_apply();
                    return tx;
                });
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
            var source = nbClient.client.object_client.open_read_stream(object_path);
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
                var stream = nbClient.client.object_client.open_read_stream(object_path);
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
