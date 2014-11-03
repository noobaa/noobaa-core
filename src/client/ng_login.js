/* global angular, alertify */
'use strict';

var _ = require('lodash');
var util = require('util');
var account_api = require('../api/account_api');

var ng_login = angular.module('ng_login', [
    'ng_util',
    'ngRoute',
    'ngCookies',
    'ngAnimate',
    'ngSanitize',
    'ngTouch',
]);




ng_login.controller('LoginCtrl', [
    '$scope', '$http', '$q', '$timeout', '$window',
    function($scope, $http, $q, $timeout, $window) {

        $scope.nav = {
            root: '/'
        };

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
