/* global angular, alertify */
'use strict';

var _ = require('lodash');
var util = require('util');
var moment = require('moment');
var size_utils = require('../util/size_utils');

// include the generated templates from ngview
require('../../build/templates');

var ng_util = angular.module('ng_util', [
    'templates',
]);


ng_util.run(['$rootScope', function($rootScope) {
    $rootScope.human_size = size_utils.human_size;
}]);



ng_util.controller('NavCtrl', [
    '$scope', 'nbServerData',
    function($scope, nbServerData) {
        $scope.account_email = nbServerData.account_email;
    }
]);




ng_util.factory('nbServerData', [
    '$window',
    function($window) {
        var server_data_element = $window.document.getElementById('server_data');
        var server_data = JSON.parse(server_data_element.innerHTML);
        return server_data;
    }
]);



ng_util.directive('nbShowAnimated', [
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

ng_util.directive('nbLadda', [
    '$compile',
    function($compile) {
        return {
            restrict: 'A',
            link: function(scope, element, attrs) {
                element.addClass('ladda-button');
                if (angular.isUndefined(element.attr('data-style'))) {
                    element.attr('data-style', 'zoom-out');
                }
                /* global Ladda */
                var ladda = Ladda.create(element[0]);
                $compile(element.contents())(scope);

                scope.$watch(attrs.nbLadda, function(loading) {
                    var is_number = angular.isNumber(loading);
                    if (loading || is_number) {
                        if (!ladda.isLoading()) {
                            ladda.start();
                        }
                        if (is_number) {
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

ng_util.directive('nbActiveLocation', [
    '$location',
    function($location) {
        return {
            restrict: 'A',
            link: function(scope, element, attrs) {
                var location = attrs.nbActiveLocation || '/';
                if (location[0] !== '/') {
                    location = '/' + location;
                }
                var check_location = function() {
                    if ($location.path() === location) {
                        element.addClass('active');
                    } else {
                        element.removeClass('active');
                    }
                };
                scope.$on('$routeChangeSuccess', check_location);
                scope.$on('$locationChangeSuccess', check_location);
                check_location();
            }
        };
    }
]);
