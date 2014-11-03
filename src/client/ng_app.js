/* global angular, alertify */
'use strict';

var _ = require('lodash');
var util = require('util');
var moment = require('moment');
var mgmt_api = require('../api/mgmt_api');
var ObjectClient = require('../api/object_client');
var file_reader_stream = require('filereader-stream');

var ng_app = angular.module('ng_app', [
    'ng_util',
    'ngRoute',
    'ngCookies',
    'ngAnimate',
    'ngSanitize',
    'ngTouch',
]);

ng_app.config(['$routeProvider', '$locationProvider',
    function($routeProvider, $locationProvider) {
        $locationProvider.html5Mode(true);
        $routeProvider.when('/nodes', {
            templateUrl: 'nodes.html',
        }).when('/files', {
            templateUrl: 'files.html',
        }).otherwise({
            redirectTo: '/nodes'
        });
    }
]);


ng_app.controller('AppCtrl', [
    '$scope', '$http', '$q', '$window',
    function($scope, $http, $q, $window) {

        $scope.breadcrumbs = [{
            text: 'Files',
            href: 'files',
            dropdown: [{
                text: 'Haha',
                href: '',
            }],
        }, {
            text: 'Buckets',
            href: 'files'
        }, {
            text: 'Buckets',
            href: 'files'
        }, {
            text: 'Buckets',
            href: 'files'
        }, {
            text: 'Buckets',
            href: 'files'
        }];

    }
]);


ng_app.controller('NodesCtrl', [
    '$scope', '$http', '$q', '$window', '$timeout',
    function($scope, $http, $q, $window, $timeout) {

        var mgmt = new mgmt_api.Client({
            path: '/api/mgmt_api/',
        });

        $scope.refresh_status = refresh_status;
        $scope.add_nodes = add_nodes;
        $scope.reset_nodes = reset_nodes;

        refresh_status();

        function refresh_status() {
            $scope.refreshing = true;
            return $q.when().then(
                function() {
                    // TODO
                    /*
                    return $q.when(mgmt.system_stats(), function(res) {
                        console.log('STATS', res);
                        $scope.stats = res;
                    });
                    */
                }
            ).then(
                function() {
                    return $q.when(mgmt.list_nodes(), function(res) {
                        console.log('NODES', res);
                        $scope.nodes = res.nodes;
                    });
                }
            )['finally'](
                function() {
                    return $timeout(function() {
                        $scope.refreshing = false;
                    }, 1000);
                }
            );
        }

        function add_nodes() {
            alertify.prompt('Enter number of nodes', function(e, res) {
                if (!e) {
                    return;
                }
                var count = Number(res);
                if (!count) {
                    return;
                }
                mgmt.add_nodes({
                    count: count
                }).then(refresh_status);
            }, '10');
        }

        function reset_nodes() {
            alertify.confirm('Really reset nodes?', function(e) {
                if (!e) {
                    return;
                }
                mgmt.reset_nodes().then(refresh_status);
            });
        }

    }
]);


ng_app.controller('FilesCtrl', [
    '$scope', '$http', '$q', '$window', '$timeout',
    function($scope, $http, $q, $window, $timeout) {

        var object_client = new ObjectClient({
            path: '/api/object_api/',
        });

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
            $q.when(
                object_client.create_multipart_upload(
                    _.defaults(object_path, {
                        size: file.size
                    })
                )
            ).then(
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
                    alertify.log('upload completed');
                    return load_bucket_objects(bucket);
                }
            ).then(null,
                function(err) {
                    alertify.error('upload failed. ' + err.toString());
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
            alertify.prompt('Enter name for new bucket', function(e, str) {
                if (!e) {
                    return;
                }
                $q.when(object_client.create_bucket({
                    bucket: str
                })).then(load_buckets);
            });
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
