/* global angular */
'use strict';

var _ = require('lodash');
var util = require('util');
var moment = require('moment');

// include the generated templates from ngview
// require('../../build/templates');

var nb_agent = angular.module('nb_agent', [
    'templates',
    'ngRoute',
    'ngCookies',
    'ngAnimate',
    'ngSanitize',
    'ngTouch',
]);

nb_agent.config(['$routeProvider', '$locationProvider',
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

nb_agent.controller('AgentCtrl', [
    '$scope', '$http',
    function($scope, $http) {

        $scope.account_email = 'stam@bla.yuck';

    }
]);

nb_agent.controller('LogCtrl', [
    '$scope', '$http',
    function($scope, $http) {

    }
]);
