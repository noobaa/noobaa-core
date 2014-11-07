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
                    $q.when(object_client.create_bucket({
                        bucket: str
                    })).then(load_buckets);
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
            var object_path = {
                bucket: $scope.bucket.name,
                key: object.key,
            };
            var ms = new $window.MediaSource();
            ms.addEventListener('sourceopen', function(e) {
                var sourceBuffer = ms.addSourceBuffer('video/webm; codecs="vorbis,vp8"');
                var stream = object_client.open_read_stream(object_path);
                stream.on('data', function(data) {
                    console.log('STREAM DATA', data);
                    sourceBuffer.appendBuffer(data);
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
            $scope.object_src = $sce.trustAsResourceUrl($window.URL.createObjectURL(ms));
        }


        function upload_file(file, bucket) {
            console.log('upload', file);
            var object_path = {
                bucket: bucket.name,
                key: file.name
            };
            var create_params = _.merge({
                size: file.size
            }, object_path);
            $q.when(object_client.create_multipart_upload(create_params)).then(
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
                    $scope.buckets = res.buckets;
                    if ($scope.buckets && $scope.buckets.length) {
                        $scope.bucket = $scope.buckets[0];
                        return load_bucket_objects($scope.bucket);
                    }
                }
            );
        }

        function load_bucket_objects(bucket) {
            return $q.when(object_client.list_bucket_objects({
                bucket: bucket.name
            })).then(
                function(res) {
                    console.log('load_bucket_objects', bucket.name, res);
                    bucket.objects = res.objects;
                }
            );
        }

    }
]);
