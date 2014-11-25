/* global angular */
'use strict';

var _ = require('lodash');
var util = require('util');
var account_api = require('../api/account_api');
var account_client = new account_api.Client();


var nb_login = angular.module('nb_login', [
    'nb_util',
    'ngRoute',
    'ngCookies',
    'ngAnimate',
    'ngSanitize',
    'ngTouch',
]);


nb_login.controller('LoginCtrl', [
    '$scope', '$http', '$q', '$timeout', '$window', 'nbAlertify', 'nbAuth',
    function($scope, $http, $q, $timeout, $window, nbAlertify,nbAuth) {

        $scope.nav = {
            root: '/'
        };

        $scope.login = function() {
            if (!$scope.email || !$scope.password) {
                return;
            }
            $scope.alert_text = '';
            $scope.form_disabled = true;
            return nbAuth.create_auth({
                email: $scope.email,
                password: $scope.password,
            }).then(function(res) {
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
                    // to simplify the form, we just use the email as a name
                    // and will allow to update it later from the account settings.
                    return account_client.create_account({
                        name: $scope.email,
                        email: $scope.email,
                        password: $scope.password,
                    }).then(null, function(err) {
                        // server errors in this case are descriptive enough to show in ui
                        throw err.data;
                    });
                }
            ).then(
                function() {
                    return nbAuth.create_auth({
                        email: $scope.email,
                        password: $scope.password,
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
