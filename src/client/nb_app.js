/* global angular */
'use strict';

var _ = require('lodash');
var util = require('util');
var moment = require('moment');
var api = require('../api');
var system_client = new api.system_api.Client();

var nb_app = angular.module('nb_app', [
    'nb_util',
    'ngRoute',
    'ngCookies',
    'ngAnimate',
    'ngSanitize',
    'ngTouch',
]);

require('./nb_nodes');
require('./nb_files');


nb_app.config(['$routeProvider', '$locationProvider', '$compileProvider',
    function($routeProvider, $locationProvider, $compileProvider) {
        // allow blob urls
        $compileProvider.imgSrcSanitizationWhitelist(/^\s*(blob):/);
        // routes
        $locationProvider.html5Mode(true);
        $routeProvider.when('/dashboard', {
            templateUrl: 'dashboard.html',
        }).when('/nodes', {
            templateUrl: 'nodes_list.html',
        }).when('/nodes/geo/:geo', {
            templateUrl: 'nodes_list.html',
        }).when('/nodes/n/:name', {
            templateUrl: 'node_details.html',
        }).when('/stats', {
            templateUrl: 'stats.html',
        }).when('/upload', {
            templateUrl: 'upload.html',
        }).when('/download', {
            templateUrl: 'download.html',
        }).otherwise({
            redirectTo: '/dashboard'
        });
    }
]);


nb_app.controller('AppCtrl', [
    '$scope', '$http', '$q', '$window',
    'nbSystem', 'nbNodes', 'nbFiles',
    'nbAlertify', '$location', 'nbAuth',
    function($scope, $http, $q, $window,
        nbSystem, nbNodes, nbFiles,
        nbAlertify, $location, nbAuth) {

        $scope.nbAuth = nbAuth;
        $scope.nbSystem = nbSystem;
        $scope.nbNodes = nbNodes;
        $scope.nbFiles = nbFiles;
        $scope.nbAlertify = nbAlertify;

        $scope.nav = {
            active: 'dashboard',
            order: ['dashboard', 'nodes', 'stats', 'upload', 'download'],
            items: {
                dashboard: {
                    text: 'Dashboard',
                    href: 'dashboard',
                },
                nodes: {
                    text: 'Nodes',
                    href: 'nodes',
                },
                stats: {
                    text: 'Stats',
                    href: 'stats',
                },
                upload: {
                    text: 'Upload',
                    href: 'upload',
                },
                download: {
                    text: 'Download',
                    href: 'download',
                },
            }
        };
    }
]);


nb_app.controller('DashboardCtrl', [
    '$scope', '$http', '$q', '$window', '$timeout',
    function($scope, $http, $q, $window, $timeout) {

        $scope.nav.active = 'dashboard';

        $scope.refresh_view = function() {
            return $q.all([
                $scope.nbSystem.refresh_system(),
                $scope.nbNodes.refresh_nodes_groups()
            ]);
        };

        $scope.refresh_view();
    }
]);


nb_app.controller('StatsCtrl', [
    '$scope', '$http', '$q', '$window', '$timeout',
    function($scope, $http, $q, $window, $timeout) {

        $scope.nav.active = 'stats';

        $scope.refresh_view = function() {
            return $scope.nbSystem.refresh_system();
        };

        $scope.refresh_view();
    }
]);


nb_app.factory('nbSystem', [
    '$q', '$timeout', '$rootScope', 'nbAlertify', 'nbAuth',
    function($q, $timeout, $rootScope, nbAlertify, nbAuth) {
        var $scope = {};

        $scope.refresh_systems = refresh_systems;
        $scope.new_system = new_system;
        $scope.create_system = create_system;
        $scope.connect_system = connect_system;
        $scope.refresh_system = refresh_system;

        nbAuth.init_promise.then(refresh_systems);

        function refresh_systems() {
            return nbAuth.init_promise.then(
                function() {
                    return system_client.list_systems();
                }
            ).then(
                function(res) {
                    console.log('SYSTEMS', res);
                    $scope.systems = res;
                }
            );
        }

        function refresh_system() {
            return nbAuth.init_promise.then(
                function() {
                    return system_client.read_system();
                }
            ).then(
                function(res) {
                    console.log('STATS', res);
                    $scope.system = res;
                    // TODO handle bigint type (defined at system_api) for sizes > petabyte
                    var s = $scope.system.storage;
                    s.free = s.alloc - s.used;
                    s.free_percent = !s.alloc ? 0 : 100 * (s.free / s.alloc);
                },
                function(err) {
                    console.error('STATS FAILED', err);
                }
            );
        }

        function new_system() {
            nbAlertify.prompt('Enter name for new system').then(
                function(str) {
                    if (str) {
                        return create_system(str);
                    }
                }
            );
        }

        function create_system(name) {
            return $q.when().then(
                function() {
                    return system_client.create_system({
                        name: name
                    });
                }
            ).then(refresh_systems);
        }

        function connect_system(system_id) {
            return nbAuth.update_auth({
                system: system_id
            }).then(refresh_system);
        }

        return $scope;
    }
]);
