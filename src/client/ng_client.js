/* global angular */
'use strict';

var _ = require('lodash');
var util = require('util');
var moment = require('moment');
var account_api = require('../api/account_api');
var ObjectClient = require('./object_client');

// include the generated templates from ngview
require('../../build/templates');

var ng_client = angular.module('ng_client', [
    'templates',
    'ngRoute',
    'ngCookies',
    'ngAnimate',
    'ngSanitize',
    'ngTouch',
]);

ng_client.config(['$routeProvider', '$locationProvider',
    function($routeProvider, $locationProvider) {
        $locationProvider.html5Mode(true);
        $routeProvider.when('/account', {
            templateUrl: 'account.html',
            controller: 'AccountCtrl'
        }).when('/object/:id*', {
            templateUrl: 'object.html',
            controller: 'ObjectCtrl'
        }).otherwise({
            redirectTo: '/account'
        });
    }
]);

ng_client.controller('ClientCtrl', [
    '$scope', '$http', '$q',
    function($scope, $http, $q) {

        $scope.account_email = 'stam@bla.yuck';
        $scope.account_password = 'stamyuck';
        $scope.logged_in = false;

        var account_client = new account_api.Client({
            path: '/api/account_api/',
        });

        function create_account(email, password) {
            return account_client.create_account({
                email: email,
                password: password,
            }).then(function() {
                $scope.$apply();
            });
        }

        function login_account(email, password) {
            return account_client.login_account({
                email: email,
                password: password,
            }).then(function() {
                $scope.logged_in = true;
                $scope.$apply();
            });
        }

        $q.when().then(function() {
            return create_account($scope.account_email, $scope.account_password);
        }).then(function() {
            return login_account($scope.account_email, $scope.account_password);
        }).then(null, function() {
            return login_account($scope.account_email, $scope.account_password);
        });
    }
]);

ng_client.controller('AccountCtrl', [
    '$scope', '$http',
    function($scope, $http) {

        var object_client = new ObjectClient({
            path: '/api/object_api/',
        });

    }
]);


ng_client.controller('LoginCtrl', [
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
                    $window.location.reload();
                }, 1000);
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
                    $window.location.reload();
                }, 1000);
            })['finally'](function() {
                $scope.running_create = false;
            });
        };
    }
]);


ng_client.directive('ngLadda', [
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
