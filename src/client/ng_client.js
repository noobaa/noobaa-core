/* global angular */
'use strict';

var _ = require('lodash');
var util = require('util');
var moment = require('moment');
// var account_api = require('../api/account_api');
// var object_client_module = require('./object_client');

var ng_templates = angular.module('templates', []);
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
    '$scope', '$http',
    function($scope, $http) {

        $scope.account_email = 'stam@bla.yuck';

        /*
        var account_client = new account_api.Client({
            path: '/account_api/',
        });

        var object_client = new object_client_module.ObjectClient({
            path: '/object_api/',
        });

        $scope.login = function(email, password) {
            account_client.login({
                email: email,
                password: password,
            }).then(function() {
                $scope.email = email;
                $scope.apply();
            });
        };
        */
    }
]);

ng_client.controller('AccountCtrl', [
    '$scope', '$http',
    function($scope, $http) {

    }
]);
