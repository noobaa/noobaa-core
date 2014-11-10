/* global angular */
'use strict';

var _ = require('lodash');
var util = require('util');
var moment = require('moment');
var account_api = require('../api/account_api');
var account_client = new account_api.Client({
    path: '/api/account_api/',
});
var mgmt_api = require('../api/mgmt_api');
var mgmt_client = new mgmt_api.Client({
    path: '/api/mgmt_api/',
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
            templateUrl: 'nodes.html',
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

        $scope.account_email = nbServerData.account_email;

        $scope.nav = {
            active: 'dashboard',
            order: ['dashboard', 'stats', 'nodes', 'upload', 'download'],
            items: {
                dashboard: {
                    text: 'Dashboard',
                    href: 'dashboard',
                },
                stats: {
                    text: 'Stats',
                    href: 'stats',
                },
                nodes: {
                    text: 'Nodes',
                    href: 'nodes',
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
                $scope.nbNodes.refresh_nodes()
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
            return $q.when(account_client.get_stats({})).then(
                function(res) {
                    console.log('STATS', res);
                    $scope.stats = res;
                    // TODO handle bigint type (defined at account_api) for sizes > petabyte
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
