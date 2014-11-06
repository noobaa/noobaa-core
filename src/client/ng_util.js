/* global angular, google */
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
    $rootScope.safe_apply = safe_apply;
    $rootScope.safe_callback = safe_callback;
    $rootScope.moment = moment;
}]);



ng_util.controller('NavCtrl', [
    '$scope', 'nbServerData',
    function($scope, nbServerData) {
        $scope.account_email = nbServerData.account_email;
    }
]);




ng_util.factory('nbGoogle', [
    '$q', '$window',
    function($q, $window) {
        var defer = $q.defer();
        try {
            $window.google.load("visualization", "1.1", {
                packages: ["geochart"],
                // must pass callback to make the loader use document.append
                // instead of document.write which will delete all the document.
                callback: function() {
                    defer.resolve($window.google);
                }
            });
        } catch (err) {
            console.log('GOOGLE FAILED TO LOAD', err);
            defer.reject(err);
        }
        return defer.promise;
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


ng_util.factory('nbAlertify', [
    '$window', '$q',
    function($window, $q) {

        var alertify = $window.alertify;
        var $scope = {};
        $scope.log = wrap_alertify_promise('log', -1);
        $scope.error = wrap_alertify_promise('error', -1);
        $scope.success = wrap_alertify_promise('success', -1);
        $scope.alert = wrap_alertify_promise('alert', -1);
        $scope.confirm = wrap_alertify_promise('confirm', 1);
        $scope.prompt = wrap_alertify_promise('prompt', 1);

        $scope.prompt_password = function() {
            var promise = $scope.prompt.apply(null, arguments);
            $window.document.getElementById('alertify-text').setAttribute('type','password');
            // setTimeout(function() {}, 1);
            return promise;
        };

        function wrap_alertify_promise(func_name, callback_index) {
            var func = alertify[func_name];
            return function() {
                var defer = $q.defer();
                var args = _.toArray(arguments);
                if (callback_index >= 0) {
                    args.splice(callback_index, 0, function(e) {
                        if (!e) {
                            defer.reject();
                            return;
                        }
                        if (arguments.length <= 1) {
                            defer.resolve();
                        } else if (arguments.length === 2) {
                            defer.resolve(arguments[1]);
                        } else {
                            var res = _.toArray(arguments).slice(1);
                            defer.resolve(res);
                        }
                    });
                }
                func.apply(alertify, args);
                return defer.promise;
            };
        }
        return $scope;
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
                $compile(angular.element(element.children()[0]).contents())(scope);

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


// safe apply handles cases when apply may fail with:
// "$apply already in progress" error

function safe_apply(func) {
    /* jshint validthis:true */
    var phase = this.$root.$$phase;
    if (phase === '$apply' || phase === '$digest') {
        return this.$eval(func);
    } else {
        return this.$apply(func);
    }
}

// safe_callback returns a function callback that performs the safe_apply
// while propagating arguments to the given func.

function safe_callback(func) {
    /* jshint validthis:true */
    var self = this;
    return function() {
        // build the args array to have null for 'this'
        // and rest is taken from the callback arguments
        var args = new Array(arguments.length + 1);
        args[0] = null;
        for (var i = 0; i < arguments.length; i++) {
            args[i + 1] = arguments[i];
        }
        // the following is in fact calling func.bind(null, a1, a2, ...)
        var fn = Function.prototype.bind.apply(func, args);
        return self.safe_apply(fn);
    };
}
