/* global angular */
'use strict';

var _ = require('lodash');
var util = require('util');
var moment = require('moment');

var ng_templates = angular.module('templates', []);
var ng_agent = angular.module('ng_agent', [
    'templates',
    'ngRoute',
    'ngCookies',
    'ngAnimate',
    'ngSanitize',
    'ngTouch',
]);

ng_agent.config(['$routeProvider', '$locationProvider',
    function($routeProvider, $locationProvider) {
        $locationProvider.html5Mode(true);
        $routeProvider.when('/log', {
            // templateUrl: 'agent_log.html',
            controller: 'LogCtrl'
        }).otherwise({
            redirectTo: '/log'
        });
    }
]);

ng_agent.controller('AgentCtrl', [
    '$scope', '$http',
    function($scope, $http) {

        $scope.account_email = 'stam@bla.yuck';

    }
]);

ng_agent.controller('LogCtrl', [
    '$scope', '$http',
    function($scope, $http) {

    }
]);
