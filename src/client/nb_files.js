/* global angular */
'use strict';

var _ = require('lodash');
var util = require('util');
var moment = require('moment');
var size_utils = require('../util/size_utils');
var api = require('../api');
var SliceReader = require('../util/slice_reader');
var concat_stream = require('concat-stream');
var object_client = new api.ObjectClient();

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
        $scope.get_download_url = get_download_url;
        $scope.read_entire_object = read_entire_object;
        $scope.read_as_media_stream = read_as_media_stream;

        $scope.transfers = [];

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

        function get_file(params) {
            return $q.when()
                .then(function() {
                    return nbClient.client.object.get_object_md(params);
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
                    console.log('LIST FILE PARTS', res);
                    return res;
                });
        }

        function create_bucket() {
            return nbAlertify.prompt('Enter name for new bucket')
                .then(function(str) {
                    if (!str) return;
                    return $q.when(object_client.create_bucket({
                        bucket: str
                    }));
                });
        }

        function upload_file(bucket_name) {
            return input_file_chooser()
                .then(function(file) {
                    if (!file) return;
                    var tx = {
                        type: 'upload',
                        input_file: file,
                        bucket: bucket_name,
                    };
                    $scope.transfers.push(tx);
                    return run_upload(tx);
                });
        }

        function input_file_chooser() {
            return $q(function(resolve, reject, notify) {
                var chooser = angular.element('<input type="file">');
                chooser.on('change', function(e) {
                    var file = e.target.files[0];
                    resolve(file);
                });
                chooser.click();
            });
        }

        function run_upload(tx) {
            console.log('upload', tx);
            tx.name = tx.input_file.name + '_' + Date.now().toString();
            tx.size = tx.input_file.size;
            tx.content_type = tx.input_file.type;
            tx.start_time = Date.now();
            tx.progress = 0;
            return $q.when(object_client.upload_stream({
                    bucket: tx.bucket,
                    key: tx.name,
                    size: tx.size,
                    content_type: tx.content_type,
                    source_stream: new SliceReader(tx.input_file, {
                        highWaterMark: size_utils.MEGABYTE,
                        FileReader: $window.FileReader,
                    }),
                }))
                .then(function() {
                    tx.done = true;
                    tx.progress = 100;
                    tx.end_time = Date.now();
                    var duration = (tx.end_time - tx.start_time) / 1000;
                    var elapsed = duration.toFixed(1) + 'sec';
                    var speed = $rootScope.human_size(tx.size / duration) + '/sec';
                    console.log('upload completed', elapsed, speed);
                    nbAlertify.success('upload completed ' + elapsed + ' ' + speed);
                }, function(err) {
                    tx.error = err;
                    console.error('upload failed', err);
                    nbAlertify.error('upload failed. ' + err.toString());
                }, function(progress) {
                    if (progress.event === 'part:after') {
                        var pos = progress.part && progress.part.end || 0;
                        tx.progress = 100 * pos / tx.size;
                    }
                });
        }

        function get_download_url(object) {
            console.log('click_object', object);
            $scope.video_src = $scope.object_src = null;
            var url = read_as_media_stream(object);
            if (url) {
                return $sce.trustAsResourceUrl(url);
            }
            return $q.when(read_entire_object(object))
                .then(function(data) {
                    console.log('OBJECT DATA', data.length);
                    var blob = new $window.Blob([data]);
                    var url = $window.URL.createObjectURL(blob);
                    return $sce.trustAsResourceUrl(url);
                });
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
