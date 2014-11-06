/* global angular */
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
    '$scope', '$http', '$q', '$timeout', '$window', 'nbAlertify',
    function($scope, $http, $q, $timeout, $window, nbAlertify) {

        $scope.nav = {
            root: '/'
        };

        var account_client = new account_api.Client({
            path: '/api/account_api/',
        });

        $scope.login = function() {
            if ($scope.login_running || $scope.create_running) {
                return;
            }
            if (!$scope.email || !$scope.password) {
                return;
            }
            $scope.alert_text = '';
            $scope.login_running = true;
            return $q.when(account_client.login_account({
                email: $scope.email,
                password: $scope.password,
            })).then(function() {
                $scope.alert_text = '';
                $scope.form_done = true;
                return $timeout(function() {
                    $window.location.href = '/';
                }, 500);
            }, function(err) {
                return $timeout(function() {
                    $scope.alert_text = err.data || 'failed. hard to say why.';
                    $scope.login_running = false;
                }, 500);
            });
        };

        $scope.create = function() {
            if ($scope.login_running || $scope.create_running) {
                return;
            }
            if (!$scope.email || !$scope.password) {
                return;
            }
            $scope.alert_text = '';
            $scope.create_running = true;
            nbAlertify.prompt_password('Verify your password').then(
                function(str) {
                    if (str !== $scope.password) {
                        throw 'the passwords don\'t match :O';
                    }
                    return $q.when(account_client.create_account({
                        email: $scope.email,
                        password: $scope.password,
                    })).then(null, function(err) {
                        throw err.data;
                    });
                }
            ).then(
                function() {
                    $scope.alert_text = '';
                    $scope.form_done = true;
                    return $timeout(function() {
                        $window.location.href = '/';
                    }, 500);
                },
                function(err) {
                    return $timeout(function() {
                        $scope.alert_text = err || '';
                        $scope.create_running = false;
                    }, 500);
                }
            );
        };
    }
]);
