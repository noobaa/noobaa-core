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


nb_api.factory('nbClient', [
    '$q', '$timeout', '$window', '$location', '$rootScope', 'nbModal', 'nbAlertify',
    function($q, $timeout, $window, $location, $rootScope, nbModal, nbAlertify) {
        var $scope = {};

        var win_storage = $window.localStorage; // or sessionStorage ?
        $scope.client = new api.Client();
        $scope.new_client = new_client;
        $scope.refresh = refresh;
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

        function refresh() {
            return $q.when()
                .then(function() {
                    return $scope.client.auth.read_auth();
                })
                .then(function(res) {
                    console.log('nbClient.refresh', res);
                    res = res || {};
                    $scope.account = res.account;
                    $scope.system = res.system;
                    $scope.role = res.role;
                    $scope.extra = res.extra;
                }, function(err) {
                    // handle unauthorized response
                    console.error(err);
                    if (err.status === 401) return $timeout(login, 10);
                    var q = 'Oy, there\'s a problem. Would you like to reload?';
                    return nbAlertify.confirm(q).then(logout);
                })
                .then(function() {
                    if ($scope.system) {
                        $scope.client.system.read_system().then(function(res) {
                            _.merge($scope.system, res);
                        });
                    }
                });
        }

        function save_token(token) {
            win_storage.nb_token = token || '';
            api.rest_api.global_client_headers.set_auth_token(token);
        }

        function init_token() {
            var token = win_storage.nb_token;
            api.rest_api.global_client_headers.set_auth_token(token);
            if (!token) return $timeout(login, 10);
            return refresh();
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




nb_api.factory('nbSystem', [
    '$q', '$timeout', '$rootScope', 'nbAlertify', 'nbClient',
    function($q, $timeout, $rootScope, nbAlertify, nbClient) {
        var $scope = {};

        $scope.refresh_systems = refresh_systems;
        $scope.new_system = new_system;
        $scope.create_system = create_system;
        $scope.connect_system = connect_system;
        $scope.refresh_system = refresh_system;

        $scope.init_systems = refresh_systems();

        function refresh_systems() {
            return nbClient.init_promise
                .then(function() {
                    return nbClient.client.system.list_systems();
                })
                .then(function(res) {
                    console.log('SYSTEMS', res);
                    $scope.systems = res;
                });
        }

        function refresh_system() {
            return nbClient.init_promise
                .then(function() {
                    return nbClient.client.system.read_system();
                })
                .then(function(res) {
                    console.log('READ SYSTEM', res);
                    $scope.system = res;
                    // TODO handle bigint type (defined at system_api) for sizes > petabyte
                    var s = $scope.system.storage;
                    s.free = s.alloc - s.used;
                    s.free_percent = !s.alloc ? 0 : 100 * (s.free / s.alloc);
                }, function(err) {
                    console.error('READ SYSTEM FAILED', err);
                    return $scope.init_systems.then(function() {
                        var sys = $scope.systems[0];
                        return connect_system(sys.name);
                    });
                });
        }

        function new_system() {
            nbAlertify.prompt('Enter name for new system')
                .then(function(str) {
                    if (str) {
                        return create_system(str);
                    }
                });
        }

        function create_system(name) {
            return $q.when()
                .then(function() {
                    return nbClient.client.system.create_system({
                        name: name
                    });
                })
                .then(refresh_systems);
        }

        function connect_system(system_name) {
            return nbClient.create_auth({
                    system: system_name
                })
                .then(refresh_system);
        }

        return $scope;
    }
]);


nb_api.controller('LoginCtrl', [
    '$scope', '$http', '$q', '$timeout', '$window', 'nbAlertify', 'nbClient',
    function($scope, $http, $q, $timeout, $window, nbAlertify, nbClient) {
        var alert_class_rotate = ['alert-warning', 'alert-danger'];

        $scope.login = function() {
            if (!$scope.email || !$scope.password) return;
            $scope.alert_text = '';
            $scope.alert_class = '';
            $scope.form_disabled = true;

            return nbClient.create_auth({
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
                    return nbClient.client.account.create_account({
                            name: $scope.email,
                            email: $scope.email,
                            password: $scope.password,
                        })
                        .then(null, function(err) {
                            // server errors in this case are descriptive enough to show in ui
                            throw err.data;
                        });
                })
                .then(function(res) {
                    nbClient.save_token(res.token);
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
