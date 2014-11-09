/* global angular */
'use strict';

var _ = require('lodash');
var util = require('util');
var moment = require('moment');
var mgmt_api = require('../api/mgmt_api');
var mgmt_client = new mgmt_api.Client({
    path: '/api/mgmt_api/',
});

var ng_app = angular.module('ng_app', [
    'ng_util',
    'ngRoute',
    'ngCookies',
    'ngAnimate',
    'ngSanitize',
    'ngTouch',
]);

require('./ng_nodes');
require('./ng_files');


ng_app.config(['$routeProvider', '$locationProvider', '$compileProvider',
    function($routeProvider, $locationProvider, $compileProvider) {
        // allow blob urls
        $compileProvider.imgSrcSanitizationWhitelist(/^\s*(blob):/);
        // routes
        $locationProvider.html5Mode(true);
        $routeProvider.when('/status', {
            templateUrl: 'status.html',
        }).when('/nodes', {
            templateUrl: 'nodes.html',
        }).when('/upload', {
            templateUrl: 'upload.html',
        }).when('/download', {
            templateUrl: 'download.html',
        }).otherwise({
            redirectTo: '/status'
        });
    }
]);


ng_app.controller('AppCtrl', [
    '$scope', '$http', '$q', '$window',
    'nbMgmt', 'nbNodes', 'nbFiles',
    'nbAlertify', '$location', 'nbServerData',
    function($scope, $http, $q, $window,
        nbMgmt, nbNodes, nbFiles,
        nbAlertify, $location, nbServerData) {

        $scope.nbMgmt = nbMgmt;
        $scope.nbNodes = nbNodes;
        $scope.nbFiles = nbFiles;
        $scope.nbAlertify = nbAlertify;

        $scope.account_email = nbServerData.account_email;

        $scope.nav = {
            active: 'status',
            order: ['status', 'nodes', 'upload', 'download'],
            items: {
                status: {
                    text: 'Status',
                    href: 'status',
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


ng_app.controller('StatusCtrl', [
    '$scope', '$http', '$q', '$window', '$timeout',
    function($scope, $http, $q, $window, $timeout) {
        $scope.nav.active = 'status';
        $scope.refresh_view = function() {
            return $q.all([
                $scope.nbMgmt.refresh_status(),
                $scope.nbNodes.refresh_nodes()
            ]);
        };
        $scope.refresh_view();
    }
]);


ng_app.factory('nbMgmt', [
    '$q', '$timeout', '$rootScope',
    function($q, $timeout, $rootScope) {
        var $scope = {};

        $scope.refresh_status = refresh_status;

        function refresh_status() {
            return $q.when(mgmt_client.system_status()).then(
                function(res) {
                    console.log('STATUS', res);
                    $scope.status = res;
                    $scope.total_space = $rootScope.human_size(res.allocated_storage);
                    var free_storage = res.allocated_storage - res.used_storage;
                    var free_percent = 100 * free_storage / res.allocated_storage;
                    $scope.free_space_percent = free_percent.toFixed(1) + '%';
                    $scope.total_nodes = res.total_nodes;
                    $scope.online_nodes = res.online_nodes;
                },
                function(err) {
                    console.error('STATS FAILED', err);
                }
            );
        }

        return $scope;
    }
]);
