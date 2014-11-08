/* global angular */
'use strict';

var _ = require('lodash');
var util = require('util');
var moment = require('moment');
var size_utils = require('../util/size_utils');
var mgmt_api = require('../api/mgmt_api');
var edge_node_api = require('../api/edge_node_api');
var ObjectClient = require('../api/object_client');
var file_reader_stream = require('filereader-stream');
var concat_stream = require('concat-stream');
var mgmt_client = new mgmt_api.Client({
    path: '/api/mgmt_api/',
});
var edge_node_client = new edge_node_api.Client({
    path: '/api/edge_node_api/',
});
var object_client = new ObjectClient({
    path: '/api/object_api/',
});

var ng_app = angular.module('ng_app');


ng_app.factory('nbFiles', [
    function() {
        var $scope = {};
        return $scope;
    }
]);


ng_app.controller('FilesCtrl', [
    '$scope', '$http', '$q', '$window', '$timeout', 'nbAlertify', '$sce',
    function($scope, $http, $q, $window, $timeout, nbAlertify, $sce) {

        $scope.nav.active = 'files';

        $scope.refresh = refresh;
        $scope.create_bucket = create_bucket;
        $scope.click_upload = click_upload;
        $scope.click_object = click_object;

        $scope.$watch('bucket', function() {
            if ($scope.bucket) {
                load_bucket_objects($scope.bucket);
            }
        });

        refresh();

        function refresh() {
            return load_buckets();
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

                        }
                    );
                }
            );
        }

        function click_upload() {
            if (!$scope.bucket) {
                return;
            }
            var bucket = $scope.bucket;
            var chooser = angular.element('<input type="file">');
            chooser.on('change', function(e) {
                var file = e.target.files[0];
                upload_file(file, bucket);
            });
            chooser.click();
        }

        function click_object(object) {
            console.log('click_object', object);
            var url = read_as_media_stream(object);
            if (url) {
                $scope.object_src = $sce.trustAsResourceUrl(url);
                return;
            }
            return $q.when(read_entire_object(object)).then(
                function(data) {
                    console.log('OBJECT DATA', data.length);
                    var blob = new $window.Blob([data]);
                    var url = $window.URL.createObjectURL(blob);
                    $scope.object_src = $sce.trustAsResourceUrl(url);
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
                high_water_mark: 16*1024,
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

        function upload_file(file, bucket) {
            console.log('upload', file);
            var object_path = {
                bucket: bucket.name,
                key: file.name
            };
            var create_params = _.clone(object_path);
            create_params.size = file.size;

            return $q.when(object_client.create_multipart_upload(create_params)).then(
                function() {
                    var defer = $q.defer();
                    var write_stream = object_client.open_write_stream(object_path);
                    var stream = file_reader_stream(file).pipe(write_stream);
                    stream.once('finish', defer.resolve);
                    stream.once('error', defer.reject);
                    return defer.promise;
                }
            ).then(
                function() {
                    return object_client.complete_multipart_upload(object_path);
                }
            ).then(
                function() {
                    nbAlertify.log('upload completed');
                    return load_bucket_objects(bucket);
                }
            ).then(null,
                function(err) {
                    nbAlertify.error('upload failed. ' + err.toString());
                }
            );
        }

        function load_buckets() {
            return $q.when(object_client.list_buckets()).then(
                function(res) {
                    $scope.buckets = _.sortBy(res.buckets, 'name');
                    $scope.buckets_by_name = _.indexBy($scope.buckets, 'name');
                    $scope.bucket =
                        $scope.bucket && $scope.buckets_by_name[$scope.bucket.name] ||
                        $scope.buckets[0];
                    return load_bucket_objects($scope.bucket);
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

    }
]);
