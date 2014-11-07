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
    '$scope', '$http', '$q', '$window', '$timeout', 'nbAlertify',
    function($scope, $http, $q, $window, $timeout, nbAlertify) {

        $scope.nav.active = 'files';

        $scope.click_upload = click_upload;
        $scope.load_bucket_objects = load_bucket_objects;
        $scope.click_bucket = click_bucket;
        $scope.create_bucket = create_bucket;
        $scope.load_buckets = load_buckets;

        load_buckets();

        function play_video_file() {
            var ms = new $window.MediaSource();
            var video = $window.document.querySelector('video');
            video.src = $window.URL.createObjectURL(ms);
            ms.addEventListener('sourceopen', function(e) {
                var sourceBuffer = ms.addSourceBuffer('video/webm; codecs="vorbis,vp8"');
                // sourceBuffer.appendBuffer(oneVideoWebMChunk);
            }, false);
        }

        function upload_file(file, bucket) {
            console.log('upload', file);
            var object_path = {
                bucket: bucket.name,
                key: file.name
            };
            $q.when(object_client.create_multipart_upload(
                _.defaults(object_path, {
                    size: file.size
                })
            )).then(
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

        function click_upload() {
            if (!$scope.curr_bucket) {
                return;
            }
            var bucket = $scope.curr_bucket;
            var chooser = angular.element('<input type="file">');
            chooser.on('change', function(e) {
                var file = e.target.files[0];
                upload_file(file, bucket);
            });
            chooser.click();
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

        function click_bucket(bucket) {
            $scope.curr_bucket = bucket;
            load_bucket_objects(bucket);
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

        function load_buckets() {
            return $q.when(object_client.list_buckets()).then(
                function(res) {
                    $scope.buckets = res.buckets;
                }
            );
        }

    }
]);
