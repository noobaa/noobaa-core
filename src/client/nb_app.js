/* global angular */
'use strict';

var _ = require('lodash');
var util = require('util');
var moment = require('moment');
var system_api = require('../api/system_api');
var system_client = new system_api.Client({
    path: '/api/system_api/',
});

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
    'nbAccount', 'nbNodes', 'nbFiles',
    'nbAlertify', '$location', 'nbServerData',
    function($scope, $http, $q, $window,
        nbAccount, nbNodes, nbFiles,
        nbAlertify, $location, nbServerData) {

        $scope.nbAccount = nbAccount;
        $scope.nbNodes = nbNodes;
        $scope.nbFiles = nbFiles;
        $scope.nbAlertify = nbAlertify;

        $scope.account = nbServerData.account;

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
                $scope.nbAccount.refresh_stats(),
                $scope.nbNodes.refresh_nodes_stats()
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
            return $scope.nbAccount.refresh_stats();
        };

        $scope.refresh_view();
    }
]);


nb_app.factory('nbAccount', [
    '$q', '$timeout', '$rootScope',
    function($q, $timeout, $rootScope) {
        var $scope = {};

        $scope.refresh_stats = refresh_stats;

        function refresh_stats() {
            return $q.when(system_client.get_stats({})).then(
                function(res) {
                    console.log('STATS', res);
                    $scope.stats = res;
                    // TODO handle bigint type (defined at system_api) for sizes > petabyte
                    $scope.stats.free_storage = res.allocated_storage - res.used_storage;
                    $scope.stats.free_storage_percent =
                        !res.allocated_storage ? 0 :
                        100 * ($scope.stats.free_storage / res.allocated_storage);
                },
                function(err) {
                    console.error('STATS FAILED', err);
                }
            );
        }

        return $scope;
    }
]);
