/* global angular */
'use strict';

var _ = require('lodash');

require('./nb_util');
require('./nb_api');
require('./nb_nodes');
require('./nb_files');

var nb_sudo = angular.module('nb_sudo', [
    'nb_util',
    'nb_api',
    'ngRoute',
    'ngCookies',
    'ngAnimate',
    'ngSanitize',
    'ngTouch',
]);


nb_sudo.config(['$routeProvider', '$locationProvider', '$compileProvider',
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


nb_sudo.controller('SudoCtrl', [
    '$scope', '$http', '$q', '$window',
    'nbSystem', 'nbNodes', 'nbFiles',
    'nbAlertify', '$location', 'nbClient',
    function($scope, $http, $q, $window,
        nbSystem, nbNodes, nbFiles,
        nbAlertify, $location, nbClient) {

        $scope.nbClient = nbClient;
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


nb_sudo.controller('DashboardCtrl', [
    '$scope', '$http', '$q', '$window', '$timeout',
    function($scope, $http, $q, $window, $timeout) {

        $scope.nav.active = 'dashboard';

        $scope.refresh_view = function() {
            return $q.all([
                $scope.nbSystem.refresh_system(),
                $scope.nbNodes.refresh_node_groups()
            ]);
        };

        $scope.refresh_view();
    }
]);


nb_sudo.controller('StatsCtrl', [
    '$scope', '$http', '$q', '$window', '$timeout',
    function($scope, $http, $q, $window, $timeout) {

        $scope.nav.active = 'stats';

        $scope.refresh_view = function() {
            return $scope.nbSystem.refresh_system();
        };

        $scope.refresh_view();
    }
]);
