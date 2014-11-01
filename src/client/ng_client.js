/* global angular */
'use strict';

var _ = require('lodash');
var util = require('util');
var moment = require('moment');
var account_api = require('../api/account_api');
var ObjectClient = require('./object_client');

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
        $routeProvider.when('/account', {
            templateUrl: 'account.html',
            // controller: 'AccountCtrl'
        }).when('/object/:id*', {
            templateUrl: 'object.html',
            // controller: 'ObjectCtrl'
        }).otherwise({
            redirectTo: '/account'
        });
    }
]);



nb_client.controller('AppCtrl', [
    '$scope', '$http', '$q', '$window',
    function($scope, $http, $q, $window) {
        var server_data_element = $window.document.getElementById('server_data');
        var server_data = JSON.parse(server_data_element.innerHTML);

        $scope.account_email = server_data.account_email;

        var account_client = new account_api.Client({
            path: '/api/account_api/',
        });
        var object_client = new ObjectClient({
            path: '/api/object_api/',
        });

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
            return $q.when(account_client.login_account({
                email: $scope.email,
                password: $scope.password,
            })).then(function() {
                return $timeout(function() {
                    $window.location.href = '/';
                }, 500);
            })['finally'](function() {
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
            return $q.when(account_client.create_account({
                email: $scope.email,
                password: $scope.password,
            })).then(function() {
                return $timeout(function() {
                    $window.location.href = '/';
                }, 500);
            })['finally'](function() {
                $scope.running_create = false;
            });
        };
    }
]);


nb_common.directive('ngLadda', [
    '$compile',
    function($compile) {
        return {
            restrict: 'A',
            link: function(scope, element, attrs) {
                element.addClass('ladda-button');
                if (angular.isUndefined(element.attr('data-style'))) {
                    element.attr('data-style', 'slide-right');
                }
                /* global Ladda */
                var ladda = Ladda.create(element[0]);
                $compile(angular.element(element.children()[0]).contents())(scope);

                scope.$watch(attrs.ngLadda, function(loading) {
                    if (loading || angular.isNumber(loading)) {
                        if (!ladda.isLoading()) {
                            ladda.start();
                        }
                        if (angular.isNumber(loading)) {
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
