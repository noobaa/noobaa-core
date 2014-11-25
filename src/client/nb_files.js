/* global angular */
'use strict';

var _ = require('lodash');
var util = require('util');
var moment = require('moment');
var size_utils = require('../util/size_utils');
var ObjectClient = require('../api/object_client');
var SliceReader = require('../util/slice_reader');
var concat_stream = require('concat-stream');
var EventEmitter = require('events').EventEmitter;
var object_client = new ObjectClient();

var nb_app = angular.module('nb_app');




nb_app.controller('UploadCtrl', [
    '$scope', '$http', '$q', '$window', '$timeout',
    'nbAlertify', '$sce', 'nbFiles', 'nbNetworkMonitor',
    function($scope, $http, $q, $window, $timeout,
        nbAlertify, $sce, nbFiles, nbNetworkMonitor) {

        $scope.nav.active = 'upload';
        $scope.refresh_view = refresh_view;
        $scope.click_upload = click_upload;
        $scope.click_browse = click_browse;
        refresh_view();


        function refresh_view() {
            return nbFiles.load_buckets();
        }

        function click_browse(event) {
            var chooser = angular.element('<input type="file">');
            chooser.on('change', function(e) {
                $scope.file = e.target.files[0];
                $scope.safe_apply();
            });
            chooser.click();
        }

        function click_upload(event) {
            var bucket = nbFiles.bucket;
            if (!bucket || !$scope.file) {
                return;
            }

            return $q.when(true, function() {

                $scope.uploading = true;
                $scope.parts = [];
                var nodes = $scope.nodes = {};
                var apply_timeout;

                object_client.events().on('part', function(part) {
                    // $scope.parts.push(part); // unneeded for now
                    var block_size = (part.chunk_size / part.kblocks) | 0;
                    _.each(part.indexes, function(blocks, index) {
                        var start = part.start + (block_size * index);
                        var end = start + block_size;
                        _.each(blocks, function(block) {
                            var node = nodes[block.node.id];
                            if (!node) {
                                node = nodes[block.node.id] = _.clone(block.node);
                                node.blocks = {};
                            }
                            node.blocks[block.id] = {
                                start: start,
                                end: end,
                            };
                        });
                    });

                    // throttled scope apply
                    if (!apply_timeout) {
                        apply_timeout = $timeout(function() {
                            apply_timeout = null;
                        }, 300);
                    }
                });

                // report outgoing bytes
                object_client.events().on('send', function(len) {
                    nbNetworkMonitor.report_outgoing(len);
                });


                return nbFiles.upload_file($scope.file, bucket);
            }).then(
                function() {
                    // $scope.uploading = false;
                },
                function() {
                    $scope.uploading = false;
                }
            );
        }

    }
]);



nb_app.controller('DownloadCtrl', [
    '$scope', '$http', '$q', '$window', '$timeout', 'nbAlertify', '$sce', 'nbFiles',
    function($scope, $http, $q, $window, $timeout, nbAlertify, $sce, nbFiles) {

        $scope.nav.active = 'download';
        $scope.refresh_view = refresh_view;
        $scope.click_object = click_object;
        refresh_view();

        $scope.$watch('nbFiles.bucket', function(bucket) {
            nbFiles.load_bucket_objects(bucket);
        });

        function refresh_view() {
            return nbFiles.load_buckets();
        }

        function click_object(object) {
            console.log('click_object', object);
            $scope.video_src = $scope.object_src = null;
            var url = nbFiles.read_as_media_stream(object);
            if (url) {
                $scope.video_src = $sce.trustAsResourceUrl(url);
                return;
            }
            return $q.when(nbFiles.read_entire_object(object)).then(
                function(data) {
                    console.log('OBJECT DATA', data.length);
                    var blob = new $window.Blob([data]);
                    var url = $window.URL.createObjectURL(blob);
                    $scope.object_src = $sce.trustAsResourceUrl(url);
                }
            );
        }


    }
]);



nb_app.factory('nbFiles', [
    '$http', '$q', '$window', '$timeout', '$sce', 'nbAlertify', '$rootScope',
    function($http, $q, $window, $timeout, $sce, nbAlertify, $rootScope) {
        var $scope = {};

        $scope.load_buckets = load_buckets;
        $scope.load_bucket_objects = load_bucket_objects;
        $scope.create_bucket = create_bucket;
        $scope.upload_file = upload_file;
        $scope.read_entire_object = read_entire_object;
        $scope.read_as_media_stream = read_as_media_stream;

        function load_buckets() {
            return $q.when(object_client.list_buckets()).then(
                function(res) {
                    if (res.buckets && res.buckets.length) {
                        return res;
                    }
                    // create a first bucket if none
                    return object_client.create_bucket({
                        bucket: 'Default'
                    }).then(function() {
                        return object_client.list_buckets();
                    });
                }
            ).then(
                function(res) {
                    $scope.buckets = _.sortBy(res.buckets, 'name');
                    $scope.buckets_by_name = _.indexBy($scope.buckets, 'name');
                    $scope.bucket =
                        $scope.bucket && $scope.buckets_by_name[$scope.bucket.name] ||
                        $scope.buckets[0];
                }
            );
        }

        function load_bucket_objects(bucket) {
            if (!bucket) return;

            return $q.when(object_client.list_bucket_objects({
                bucket: bucket.name
            })).then(
                function(res) {
                    console.log('load_bucket_objects', bucket.name, res);
                    bucket.objects = res.objects;
                    _.each(bucket.objects, function(object) {
                        object.bucket = bucket;
                    });
                }
            );
        }


        function create_bucket() {
            return nbAlertify.prompt('Enter name for new bucket').then(
                function(str) {
                    if (!str) {
                        return;
                    }
                    return $q.when(object_client.create_bucket({
                        bucket: str
                    })).then(load_buckets).then(
                        function() {
                            // choose the created bucket
                            $scope.bucket = $scope.buckets_by_name[str];
                        }
                    );
                }
            );
        }


        function upload_file(file, bucket) {
            console.log('upload', file);
            var object_path = {
                bucket: bucket.name,
                key: file.name + '_' + Date.now().toString(),
            };
            var create_params = _.clone(object_path);
            create_params.size = file.size;
            var start_time = Date.now();
            return $q.when(object_client.create_multipart_upload(create_params)).then(
                function() {
                    var defer = $q.defer();
                    var reader = new SliceReader(file, {
                        highWaterMark: size_utils.MEGABYTE,
                        FileReader: $window.FileReader,
                    });
                    var writer = object_client.open_write_stream(object_path);
                    var stream = reader.pipe(writer);
                    stream.once('error', defer.reject);
                    stream.once('finish', defer.resolve);
                    return defer.promise;
                }
            ).then(
                function() {
                    return object_client.complete_multipart_upload(object_path);
                }
            ).then(
                function() {
                    var duration = (Date.now() - start_time) / 1000;
                    var elapsed = duration.toFixed(1) + 'sec';
                    var speed = $rootScope.human_size(file.size / duration) + '/sec';
                    console.log('upload completed', elapsed, speed);
                    nbAlertify.success('upload completed ' + elapsed + ' ' + speed);
                },
                function(err) {
                    console.error('upload failed', err);
                    nbAlertify.error('upload failed. ' + err.toString());
                }
            );
        }


        function read_entire_object(object) {
            var object_path = {
                bucket: object.bucket.name,
                key: object.key,
            };
            var defer = $q.defer();
            var stream = concat_stream(defer.resolve);
            stream.once('error', defer.reject);
            object_client.open_read_stream(object_path).pipe(stream);
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
                var stream = object_client.open_read_stream(object_path);
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
