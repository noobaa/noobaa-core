/* global angular */
'use strict';

var _ = require('lodash');
var api = require('../api');

var nb_api = angular.module('nb_api', [
    'nb_util',
    'ngRoute',
    'ngCookies',
    'ngAnimate',
    'ngSanitize',
    'ngTouch',
]);


nb_api.factory('nbAuth', [
    '$q', '$timeout', '$window', '$location', '$rootScope', 'nbModal', 'nbAlertify',
    function($q, $timeout, $window, $location, $rootScope, nbModal, nbAlertify) {
        var $scope = {};

        var win_storage = $window.sessionStorage;
        $scope.client = new api.Client();
        $scope.new_client = new_client;
        $scope.save_token = save_token;
        $scope.init_token = init_token;
        $scope.create_auth = create_auth;
        $scope.login = login;
        $scope.logout = logout;
        $scope.init_promise = $q.when().then(init_token);

        // return a new client based on mine - inherits auth token unless overriden
        function new_client() {
            return new api.Client($scope.client);
        }

        function save_token(token) {
            console.log('save_token', token ? token.slice(0, 15) + '...' : '\'\'');
            win_storage.nb_token = token || '';
        }

        function init_token() {
            var token = win_storage.nb_token;
            console.log('init_token', token ? token.slice(0, 15) + '...' : '\'\'');

            // TODO get rid of this global headers?
            api.rest_api.global_client_headers.set_auth_token(token);
            // $scope.client.headers.set_auth_token(token);

            if (!token) return $timeout(login, 10);

            return $q.when()
                .then(function() {
                    return $scope.client.auth.read_auth();
                })
                .then(function(res) {
                    if (!res) return;
                    $scope.account = res.account;
                    $scope.system = res.system;
                    $scope.role = res.role;
                    $scope.extra = res.extra;
                }, function(err) {
                    // handle unauthorized response
                    console.error(err);
                    if (err.status === 401) return $timeout(login, 10);
                    var q = 'Oy, there\'s a problem. Would you like to reload?';
                    nbAlertify.confirm(q).then(logout);
                });
        }

        function create_auth(params) {
            return $q.when()
                .then(function() {
                    return $scope.client.create_auth_token(params);
                })
                .then(function(res) {
                    save_token(res.token);
                    return init_token();
                });
        }

        function login() {
            var scope = $rootScope.$new();
            scope.modal = nbModal({
                template: 'login_dialog.html',
                scope: scope,
            });
        }

        function logout() {
            save_token('');
            $window.location.href = '/';
        }

        return $scope;
    }
]);


nb_api.controller('LoginCtrl', [
    '$scope', '$http', '$q', '$timeout', '$window', 'nbAlertify', 'nbAuth',
    function($scope, $http, $q, $timeout, $window, nbAlertify, nbAuth) {
        var alert_class_rotate = ['alert-warning', 'alert-danger'];

        $scope.login = function() {
            if (!$scope.email || !$scope.password) return;
            $scope.alert_text = '';
            $scope.alert_class = '';
            $scope.form_disabled = true;
            return nbAuth.create_auth({
                    email: $scope.email,
                    password: $scope.password,
                })
                .then(function(res) {
                    $scope.alert_text = '';
                    $scope.alert_class = '';
                    $window.location.href = '/';
                }, function(err) {
                    $scope.alert_text = err.data || 'failed. hard to say why';
                    $scope.alert_class = alert_class_rotate.shift();
                    alert_class_rotate.push($scope.alert_class);
                    $scope.form_disabled = false;
                });
        };

        $scope.create = function() {
            if (!$scope.email || !$scope.password) return;
            $scope.alert_text = '';
            $scope.alert_class = '';
            $scope.form_disabled = true;
            return nbAlertify.prompt_password('Verify your password')
                .then(function(str) {
                    if (str !== $scope.password) {
                        throw 'the passwords don\'t match  :O';
                    }
                    // to simplify the form, we just use the email as a name
                    // and will allow to update it later from the account settings.
                    return nbAuth.client.account.create_account({
                        name: $scope.email,
                        email: $scope.email,
                        password: $scope.password,
                    }).then(null, function(err) {
                        // server errors in this case are descriptive enough to show in ui
                        throw err.data;
                    });
                })
                .then(function(res) {
                    nbAuth.save_token(res.token);
                    $scope.alert_text = '';
                    $scope.alert_class = '';
                    $window.location.href = '/';
                }, function(err) {
                    $scope.alert_text = err || 'failed. hard to say why';
                    $scope.alert_class = alert_class_rotate.shift();
                    alert_class_rotate.push($scope.alert_class);
                    $scope.form_disabled = false;
                });
        };
    }
]);
