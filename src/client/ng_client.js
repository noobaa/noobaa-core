/* global angular */
'use strict';

var _ = require('lodash');
var util = require('util');
var moment = require('moment');
var account_api = require('../api/account_api');
var mgmt_api = require('../api/mgmt_api');
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
        $routeProvider.when('/status', {
            templateUrl: 'status.html',
            // controller: 'AccountCtrl'
        }).when('/object/:id*', {
            templateUrl: 'object.html',
            // controller: 'ObjectCtrl'
        }).otherwise({
            redirectTo: '/status'
        });
    }
]);


nb_common.factory('nbServerData', [
    '$window',
    function($window) {
        var server_data_element = $window.document.getElementById('server_data');
        var server_data = JSON.parse(server_data_element.innerHTML);
        return server_data;
    }
]);


nb_common.controller('NavCtrl', [
    '$scope', 'nbServerData',
    function($scope, nbServerData) {
        $scope.account_email = nbServerData.account_email;
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
            })['finally'](function() {
                $scope.running_create = false;
            });
        };
    }
]);



nb_client.controller('AppCtrl', [
    '$scope', '$http', '$q', '$window',
    function($scope, $http, $q, $window) {
        /*
        var account_client = new account_api.Client({
            path: '/api/account_api/',
        });
        var object_client = new ObjectClient({
            path: '/api/object_api/',
        });
        */
    }
]);


nb_client.controller('StatusCtrl', [
    '$scope', '$http', '$q', '$window',
    function($scope, $http, $q, $window) {

        console.log('StatusCtrl');

        var mgmt = new mgmt_api.Client({
            path: '/api/mgmt_api/',
        });

        $q.when().then(
            function() {
                console.log('StatusCtrl when1');
                return $q.when(mgmt.list_nodes(), function(res) {
                    console.log('NODES', res);
                    $scope.nodes = res.nodes;
                });
            }
        ).then(
            function() {
                return $q.when(mgmt.system_stats(), function(res) {
                    console.log('STATS', res);
                    $scope.stats = res;
                });
            }
        );

    }
]);








/////////////////////////////////////////////////////////////////
// UTILS ////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////


nb_common.directive('nbShowAnimated', [
    function() {
        return {
            restrict: 'A',
            link: function(scope, element, attrs) {
                var showing = false;
                var opt = scope.$eval(attrs.nbShowAnimated);
                scope.$watch(opt.show, function(show) {
                    element.removeClass('animated');
                    element.removeClass(opt.in);
                    element.removeClass(opt.out);
                    element.stop();
                    var show_bool = !!show;
                    var changed = show_bool !== showing;
                    showing = !!show;
                    if (!changed) {
                        if (showing) {
                            element.show();
                        } else {
                            element.hide();
                        }
                    } else {
                        if (showing) {
                            element.addClass('animated');
                            element.addClass(opt.in);
                            element.show();
                        } else {
                            element.addClass('animated');
                            element.addClass(opt.out);
                            element.one(
                                'webkitAnimationEnd ' +
                                'mozAnimationEnd ' +
                                'MSAnimationEnd ' +
                                'oanimationend ' +
                                'animationend',
                                function() {
                                    if (!showing) {
                                        element.hide();
                                    }
                                }
                            );
                        }
                    }
                }, true /*watch deep*/ );
            }
        };
    }
]);

nb_common.directive('nbLadda', [
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

                scope.$watch(attrs.nbLadda, function(loading) {
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
