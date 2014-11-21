/* global angular */
'use strict';

var _ = require('lodash');
var util = require('util');
var system_api = require('../api/system_api');

var nb_login = angular.module('nb_login', [
    'nb_util',
    'ngRoute',
    'ngCookies',
    'ngAnimate',
    'ngSanitize',
    'ngTouch',
]);




nb_login.controller('LoginCtrl', [
    '$scope', '$http', '$q', '$timeout', '$window', 'nbAlertify',
    function($scope, $http, $q, $timeout, $window, nbAlertify) {

        $scope.nav = {
            root: '/'
        };

        var system_client = new system_api.Client({
            path: '/api/system_api/',
        });

        $scope.login = function() {
            if (!$scope.email || !$scope.password) {
                return;
            }
            $scope.alert_text = '';
            $scope.form_disabled = true;
            return $q.when(system_client.login_account({
                email: $scope.email,
                password: $scope.password,
            })).then(function() {
                $scope.alert_text = '';
                $window.location.href = '/';
            }, function(err) {
                $scope.alert_text = err.data || 'failed. hard to say why.';
                $scope.form_disabled = false;
            });
        };

        $scope.create = function() {
            if (!$scope.email || !$scope.password) {
                return;
            }
            $scope.alert_text = '';
            $scope.form_disabled = true;
            return nbAlertify.prompt_password('Verify your password').then(
                function(str) {
                    if (str !== $scope.password) {
                        throw 'the passwords don\'t match :O';
                    }
                    return $q.when(system_client.create_account({
                        email: $scope.email,
                        password: $scope.password,
                    })).then(null, function(err) {
                        throw err.data;
                    });
                }
            ).then(
                function() {
                    $scope.alert_text = '';
                    $window.location.href = '/';
                },
                function(err) {
                    $scope.alert_text = err || '';
                    $scope.form_disabled = false;
                }
            );
        };
    }
]);
