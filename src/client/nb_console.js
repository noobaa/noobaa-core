/* global angular */
'use strict';

var _ = require('lodash');

require('./nb_util');
require('./nb_api');
require('./nb_nodes');
require('./nb_files');

var nb_console = angular.module('nb_console', [
    'nb_util',
    'nb_api',
    'ngRoute',
    'ngCookies',
    'ngAnimate',
    'ngSanitize',
    'ngTouch',
]);


nb_console.config(['$routeProvider', '$locationProvider', '$compileProvider',
    function($routeProvider, $locationProvider, $compileProvider) {
        // allow blob urls
        $compileProvider.imgSrcSanitizationWhitelist(/^\s*(blob):/);
        // routes
        $locationProvider.html5Mode(true);
        $routeProvider.when('/overview', {
            templateUrl: 'console/overview.html',
        }).when('/tier', {
            // templateUrl: 'console/tier_list.html',
        }).when('/tier/:tier_name', {
            // templateUrl: 'console/tier_view.html',
        }).when('/tier/:tier_name/:node_id', {
            templateUrl: 'console/node_view.html',
        }).when('/bucket', {
            // templateUrl: 'console/bucket_list.html',
        }).when('/bucket/:bucket_name', {
            // templateUrl: 'console/bucket_view.html',
        }).otherwise({
            redirectTo: '/overview'
        });
    }
]);


nb_console.controller('ConsoleCtrl', [
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
            active: 'overview',
            order: ['overview', 'tiers', 'buckets'],
            items: {
                overview: {
                    text: 'Overview',
                    href: 'overview',
                },
                tiers: {
                    text: 'Tiers',
                    href: 'tier',
                },
                buckets: {
                    text: 'Buckets',
                    href: 'bucket',
                }
            }
        };
    }
]);


nb_console.controller('OverviewCtrl', [
    '$scope', '$http', '$q', '$window', '$timeout',
    function($scope, $http, $q, $window, $timeout) {

        $scope.nav.active = 'overview';
        $scope.nav.refresh_view = refresh_view;

        function refresh_view() {
            return $q.all([
                $scope.nbSystem.refresh_system(),
                $scope.nbNodes.refresh_node_groups()
            ]);
        }

        refresh_view();
    }
]);


nb_console.controller('StatsCtrl', [
    '$scope', '$http', '$q', '$window', '$timeout',
    function($scope, $http, $q, $window, $timeout) {

        $scope.nav.active = 'stats';
        $scope.nav.refresh_view = refresh_view;

        function refresh_view() {
            return $scope.nbSystem.refresh_system();
        }

        refresh_view();
    }
]);
