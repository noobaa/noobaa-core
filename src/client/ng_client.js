/* global angular, alertify */
'use strict';

var _ = require('lodash');
var util = require('util');
var moment = require('moment');
var account_api = require('../api/account_api');
var mgmt_api = require('../api/mgmt_api');
var ObjectClient = require('./object_client');
var file_reader_stream = require('filereader-stream');

// include the generated templates from ngview
require('../../build/templates');

var nb_common = angular.module('nb_common', [
    'templates',
    'ngRoute',
    'ngCookies',
    'ngAnimate',
    'ngSanitize',
    'ngTouch',
]);
var nb_client = angular.module('nb_client', ['nb_common']);
var nb_login = angular.module('nb_login', ['nb_common']);


nb_client.config(['$routeProvider', '$locationProvider',
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


nb_common.factory('nbServerData', [
    '$window',
    function($window) {
        var server_data_element = $window.document.getElementById('server_data');
        var server_data = JSON.parse(server_data_element.innerHTML);
        return server_data;
    }
]);


nb_common.controller('NavCtrl', [
    '$scope', 'nbServerData',
    function($scope, nbServerData) {
        $scope.account_email = nbServerData.account_email;
    }
]);


nb_client.controller('AppCtrl', [
    '$scope', '$http', '$q', '$window',
    function($scope, $http, $q, $window) {

    }
]);


nb_client.controller('NodesCtrl', [
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


nb_client.controller('FilesCtrl', [
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



nb_login.controller('LoginCtrl', [
    '$scope', '$http', '$q', '$timeout', '$window',
    function($scope, $http, $q, $timeout, $window) {
        var account_client = new account_api.Client({
            path: '/api/account_api/',
        });

        $scope.login = function() {
            if ($scope.running_login || $scope.running_create) {
                return;
            }
            if (!$scope.email || !$scope.password) {
                return;
            }
            $scope.running_login = true;
            $scope.alert_text = '';
            return $q.when(account_client.login_account({
                email: $scope.email,
                password: $scope.password,
            })).then(function() {
                $scope.alert_text = '';
                return $timeout(function() {
                    $window.location.href = '/';
                }, 500);
            }, function(err) {
                $scope.alert_text = err.data || 'failed. hard to say why.';
                $scope.running_login = false;
            });
        };

        $scope.create = function() {
            if ($scope.running_login || $scope.running_create) {
                return;
            }
            if (!$scope.email || !$scope.password) {
                return;
            }
            $scope.running_create = true;
            $scope.alert_text = '';
            return $q.when(account_client.create_account({
                email: $scope.email,
                password: $scope.password,
            })).then(function() {
                $scope.alert_text = '';
                return $timeout(function() {
                    $window.location.href = '/';
                }, 500);
            }, function(err) {
                $scope.alert_text = err.data || 'failed. hard to say why.';
                $scope.running_create = false;
            });
        };
    }
]);







/////////////////////////////////////////////////////////////////
// UTILS ////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////


nb_common.directive('nbShowAnimated', [
    function() {
        return {
            restrict: 'A',
            link: function(scope, element, attrs) {
                var showing = false;
                var opt = scope.$eval(attrs.nbShowAnimated);
                scope.$watch(opt.show, function(show) {
                    element.removeClass('animated');
                    element.removeClass(opt.in);
                    element.removeClass(opt.out);
                    element.stop();
                    var show_bool = !!show;
                    var changed = show_bool !== showing;
                    showing = !!show;
                    if (!changed) {
                        if (showing) {
                            element.show();
                        } else {
                            element.hide();
                        }
                    } else {
                        if (showing) {
                            element.addClass('animated');
                            element.addClass(opt.in);
                            element.show();
                        } else {
                            element.addClass('animated');
                            element.addClass(opt.out);
                            element.one(
                                'webkitAnimationEnd ' +
                                'mozAnimationEnd ' +
                                'MSAnimationEnd ' +
                                'oanimationend ' +
                                'animationend',
                                function() {
                                    if (!showing) {
                                        element.hide();
                                    }
                                }
                            );
                        }
                    }
                }, true /*watch deep*/ );
            }
        };
    }
]);

nb_common.directive('nbLadda', [
    '$compile',
    function($compile) {
        return {
            restrict: 'A',
            link: function(scope, element, attrs) {
                element.addClass('ladda-button');
                if (angular.isUndefined(element.attr('data-style'))) {
                    element.attr('data-style', 'zoom-out');
                }
                /* global Ladda */
                var ladda = Ladda.create(element[0]);
                $compile(angular.element(element).contents())(scope);

                scope.$watch(attrs.nbLadda, function(loading) {
                    var is_number = angular.isNumber(loading);
                    if (loading || is_number) {
                        if (!ladda.isLoading()) {
                            ladda.start();
                        }
                        if (is_number) {
                            ladda.setProgress(loading);
                        }
                    } else {
                        ladda.stop();
                    }
                });
            }
        };
    }
]);

nb_common.directive('nbActiveLocation', [
    '$location',
    function($location) {
        return {
            restrict: 'A',
            link: function(scope, element, attrs) {
                var location = attrs.nbActiveLocation || '/';
                if (location[0] !== '/') {
                    location = '/' + location;
                }
                var check_location = function() {
                    if ($location.path() === location) {
                        element.addClass('active');
                    } else {
                        element.removeClass('active');
                    }
                };
                scope.$on('$routeChangeSuccess', check_location);
                scope.$on('$locationChangeSuccess', check_location);
                check_location();
            }
        };
    }
]);
