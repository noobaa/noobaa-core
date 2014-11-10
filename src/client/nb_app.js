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
        }).when('/account', {
            templateUrl: 'account.html',
        }).when('/nodes', {
            templateUrl: 'nodes.html',
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
    'nbMgmt', 'nbNodes', 'nbFiles', 'nbAccount',
    'nbAlertify', '$location', 'nbServerData',
    function($scope, $http, $q, $window,
        nbMgmt, nbNodes, nbFiles, nbAccount,
        nbAlertify, $location, nbServerData) {

        $scope.nbMgmt = nbMgmt;
        $scope.nbAccount = nbAccount;
        $scope.nbNodes = nbNodes;
        $scope.nbFiles = nbFiles;
        $scope.nbAlertify = nbAlertify;

        $scope.account_email = nbServerData.account_email;

        $scope.nav = {
            active: 'dashboard',
            order: ['dashboard', 'account', 'nodes', 'upload', 'download'],
            items: {
                dashboard: {
                    text: 'Dashboard',
                    href: 'dashboard',
                },
                account: {
                    text: 'Account',
                    href: 'account',
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
                $scope.nbMgmt.refresh_status(),
                $scope.nbNodes.refresh_nodes()
            ]);
        };

        $scope.refresh_view();
    }
]);


nb_app.controller('AccountCtrl', [
    '$scope', '$http', '$q', '$window', '$timeout',
    function($scope, $http, $q, $window, $timeout) {

        $scope.nav.active = 'account';

        $scope.refresh_view = function() {
            return $scope.nbAccount.refresh_usage();
        };

        $scope.refresh_view();
    }
]);


nb_app.factory('nbMgmt', [
    '$q', '$timeout', '$rootScope',
    function($q, $timeout, $rootScope) {
        var $scope = {};

        $scope.refresh_status = refresh_status;

        function refresh_status() {
            return $q.when(mgmt_client.system_status()).then(
                function(res) {
                    console.log('SYSTEM STATUS', res);
                    $scope.status = res;
                    $scope.total_nodes = res.total_nodes;
                    $scope.online_nodes = res.online_nodes;
                    $scope.total_space = $rootScope.human_size(res.allocated_storage);
                    // TODO handle bigint type (defined at account_api) for sizes > petabyte
                    var free_storage = res.allocated_storage - res.used_chunks_storage;
                    var free_percent = 100 * free_storage / res.allocated_storage;
                    $scope.free_space_percent = free_percent.toFixed(1) + '%';
                },
                function(err) {
                    console.error('SYSTEM STATUS FAILED', err);
                }
            );
        }

        return $scope;
    }
]);

nb_app.factory('nbAccount', [
    '$q', '$timeout', '$rootScope',
    function($q, $timeout, $rootScope) {
        var $scope = {};

        $scope.refresh_usage = refresh_usage;

        function refresh_usage() {
            return $q.when(account_client.usage_stats()).then(
                function(res) {
                    console.log('ACCOUNT USAGE', res);
                    $scope.usage = res;
                    $scope.allocated_storage = $rootScope.human_size(res.allocated_storage);
                    $scope.used_storage = $rootScope.human_size(res.used_storage);
                },
                function(err) {
                    console.error('ACCOUNT USAGE FAILED', err);
                }
            );
        }

        return $scope;
    }
]);
