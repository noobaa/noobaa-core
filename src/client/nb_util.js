/* global angular, google */
'use strict';

var _ = require('lodash');
var util = require('util');
var moment = require('moment');
var size_utils = require('../util/size_utils');
var account_api = require('../api/account_api');

// include the generated templates from ngview
// require('../../build/templates');

var nb_util = angular.module('nb_util', [
    'templates',
]);


nb_util.run(['$rootScope', function($rootScope) {
    /* jshint jquery:true */
    $rootScope._ = _;
    $rootScope.human_size = size_utils.human_size;
    $rootScope.human_percent = human_percent;
    $rootScope.safe_apply = safe_apply;
    $rootScope.safe_callback = safe_callback;
    $rootScope.moment = moment;
    $.material.init();
}]);



nb_util.factory('nbAuth', [
    '$q', '$window', '$location',
    function($q, $window, $location) {
        var $scope = {};

        var account_client = new account_api.Client();
        var win_storage = $window.sessionStorage;

        $scope.init_promise = init();

        function init() {
            var pathname = $window.location.pathname;
            console.log('nbAuth', pathname, win_storage.nb_auth);

            if (!win_storage.nb_auth) {
                if (!pathname.match(/^\/login/)) {
                    $scope.logout();
                } else {
                    $scope.loaded = true;
                }
                return $q.when();
            }

            account_client.set_global_authorization(win_storage.nb_auth);

            return $q.when().then(
                function() {
                    return account_client.read_account();
                }
            ).then(
                function(res) {
                    $scope.account = res;
                    $scope.system = win_storage.nb_system;
                    $scope.loaded = true;
                },
                function(err) {
                    console.error(err);
                    if (err.status === 401) { // unauthorized
                        $scope.logout();
                    }
                }
            );
        }

        $scope.authenticate = function(params) {
            return $q.when().then(
                function() {
                    return account_client.authenticate(params);
                }
            ).then(
                function(res) {
                    account_client.set_global_authorization(res.token);
                    win_storage.nb_auth = res.token;
                    win_storage.nb_system = params.system;
                    return res;
                }
            );
        };

        $scope.authenticate_update = function(params) {
            return $q.when().then(
                function() {
                    return account_client.authenticate_update(params);
                }
            ).then(
                function(res) {
                    account_client.set_global_authorization(res.token);
                    win_storage.nb_auth = res.token;
                    win_storage.nb_system = params.system;
                    return res;
                }
            );
        };

        $scope.logout = function() {
            account_client.set_global_authorization();
            delete win_storage.nb_auth;
            $window.location.href= '/login';
        };

        return $scope;
    }
]);


nb_util.factory('nbNetworkMonitor', [
    '$q', '$window', '$interval',
    function($q, $window, $interval) {
        var $scope = {};

        $scope.data = [];
        $scope.count = 0;
        var curr = {
            out: 0,
            inn: 0,
        };
        var last_time = Date.now();

        $interval(function() {
            if (!curr.inn && !curr.out) {
                return;
            }
            $scope.count += 1;
            curr.time = new Date();
            var time = curr.time.getTime();
            var elapsed = (time - last_time) / 1000;
            last_time = time;
            curr.out /= elapsed;
            curr.inn /= elapsed;
            // push and keep under size limit
            $scope.data.push(curr);
            if ($scope.data.length > 60) {
                $scope.data.shift();
            }
            curr = {
                out: 0,
                inn: 0,
            };
        }, 3000);

        $scope.report_incoming = function(bytes) {
            curr.inn += bytes;
        };
        $scope.report_outgoing = function(bytes) {
            curr.out += bytes;
        };

        return $scope;
    }
]);

nb_util.directive('nbNetworkChart', [
    'nbNetworkMonitor', 'nbGoogle', '$rootScope',
    function(nbNetworkMonitor, nbGoogle, $rootScope) {
        return {
            restrict: 'A',
            link: function(scope, element, attrs) {
                scope.mon = nbNetworkMonitor; // for watching
                scope.$watch('mon.data', redraw, true);

                var table;
                var last_count;
                var google;

                function redraw() {
                    if (!google) {
                        return nbGoogle.then(function(google_arg) {
                            google = google_arg;
                            redraw();
                        });
                    }
                    if (!table) {
                        table = new google.visualization.DataTable();
                        table.addColumn('datetime', 'Time');
                        table.addColumn('number', 'Incoming');
                        table.addColumn('number', 'Outgoing');
                    }
                    var data = nbNetworkMonitor.data || [];
                    var rows_to_add = nbNetworkMonitor.count - last_count;
                    last_count = nbNetworkMonitor.count;
                    if (rows_to_add > data.length) {
                        rows_to_add = data.length;
                        // in this case we missed some points,
                        // so we want to flatten the graph in the missed area
                        // so we insert two zero points 1 millisecond after/before
                        // the last/next points of the gap.
                        var num_rows_in_table = table.getNumberOfRows();
                        var date_value = table.getCell(num_rows_in_table - 1, 0);
                        date_value.setTime(date_value.getTime() + 1);
                        table.addRow([date_value, 0, 0]);
                        date_value = data[0].time;
                        date_value.setTime(date_value.getTime() - 1);
                        table.addRow([date_value, 0, 0]);
                    }
                    for (var i = 0; i < rows_to_add; i++) {
                        var d = data[data.length - rows_to_add + i];
                        table.addRow([d.time, {
                            v: d.inn,
                            f: $rootScope.human_size(d.inn)
                        }, {
                            v: d.out,
                            f: $rootScope.human_size(d.out)
                        }]);
                    }
                    var extra_rows = table.getNumberOfRows() - 600;
                    if (extra_rows > 0) {
                        table.removeRows(0, extra_rows);
                    }

                    var options = {
                        hAxis: {
                            title: 'Time',
                            titleTextStyle: {
                                color: '#333'
                            }
                        },
                        vAxis: {
                            minValue: 0
                        }
                    };
                    var chart = new google.visualization.AreaChart(element[0]);
                    chart.draw(table, options);
                }
            }
        };
    }
]);


nb_util.factory('nbGoogle', [
    '$q', '$window',
    function($q, $window) {
        var defer = $q.defer();
        try {
            $window.google.load("visualization", "1.1", {
                packages: ['geochart', 'corechart'],
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


nb_util.factory('nbServerData', [
    '$window',
    function($window) {
        var server_data_element = $window.document.getElementById('server_data');
        var server_data = JSON.parse(server_data_element.innerHTML);
        return server_data;
    }
]);


nb_util.factory('nbModal', [
    '$window', '$q', '$compile', '$rootScope', '$templateCache',
    function($window, $q, $compile, $rootScope, $templateCache) {

        var modal = function(opt) {
            var html = opt.html || $templateCache.get(opt.template);
            var scope = opt.scope || $rootScope.$new();
            var e = $compile(html)(scope);
            // close modal on ESC key
            var keydown_handler = function(event) {
                if (event.which === 27 && !event.defaultPrevented) {
                    event.preventDefault();
                    e.modal('hide');
                }
            };
            $window.addEventListener('keydown', keydown_handler);
            // close modal on mobile back key or browser history back
            var back_unsubscribe;
            e.on('shown.bs.modal', function() {
                back_unsubscribe = scope.$on('$locationChangeStart', function(event) {
                    e.modal('hide');
                    event.preventDefault();
                    event.stopPropagation();
                    return false;
                });
            });
            e.on('hidden.bs.modal', function() {
                if (back_unsubscribe) {
                    back_unsubscribe();
                }
                $window.removeEventListener('keydown', keydown_handler);
                if (!opt.persist) {
                    e.remove();
                }
                $rootScope.safe_apply();
            });
            if (opt.size === 'lg') {
                e.find('.modal-dialog').addClass('modal-lg');
            } else if (opt.size === 'sm') {
                e.find('.modal-dialog').addClass('modal-sm');
            } else if (opt.size === 'fullscreen') {
                e.addClass('modal-fullscreen');
            }
            e.modal({
                show: !opt.noshow
            });
            return e;
        };

        modal.wrap_body = function(opt) {
            return [
                '<div class="modal"',
                opt.controller ? ' ng-controller="' + opt.controller + '"' : '',
                '>',
                '<div class="modal-dialog">',
                '<div class="modal-content">',
                '<div class="modal-body" style="padding: 0">',
                $templateCache.get(opt.template),
                '</div>',
                '</div>',
                '</div>',
                '</div>'
            ].join('\n');
        };

        return modal;
    }
]);


nb_util.factory('nbAlertify', [
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
            $window.document.getElementById('alertify-text').setAttribute('type', 'password');
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


nb_util.directive('nbProgressCanvas', [
    function() {
        return {
            restrict: 'A',
            scope: {
                nbProgressCanvas: '=',
                progressMax: '=',
                progressColor: '=',
            },
            link: function(scope, element, attrs) {
                var d = element[0].getContext('2d'); // expected to be a canvas
                var data;
                var opt = {};

                scope.$watch('nbProgressCanvas', update_data, true);
                scope.$watch('progressMax', update_options.bind(null, 'max'));
                scope.$watch('progressColor', update_options.bind(null, 'color'));

                function update_data(value) {
                    data = value;
                    redraw();
                }

                function update_options(key, value) {
                    opt[key] = value;
                    redraw();
                }

                function redraw() {
                    var w = d.canvas.width;
                    var h = d.canvas.height;
                    var wd = w / opt.max;
                    d.fillStyle = opt.color;
                    d.clearRect(0, 0, w, h);
                    _.each(data, function(p) {
                        var start = p.start * wd;
                        var end = p.end * wd;
                        d.fillRect(start, 0, end - start, h);
                    });
                }
            }
        };
    }
]);


nb_util.directive('nbShowAnimated', [
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


nb_util.directive('nbClickLadda', [
    '$compile', '$q', '$timeout',
    function($compile, $q, $timeout) {
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

                element.on('click', function() {
                    var promise = scope.$eval(attrs.nbClickLadda);
                    if (promise && !ladda.isLoading()) {
                        ladda.start();
                    }
                    $q.when(promise).then(
                        function() {
                            return $timeout(function() {
                                ladda.stop();
                            }, 300); // human delay for fast runs
                        },
                        function() {
                            return $timeout(function() {
                                ladda.stop();
                            }, 300); // human delay for fast runs
                        },
                        function(progress) {
                            ladda.setProgress(progress);
                        }
                    );
                });
            }
        };
    }
]);


// DEPRECATED - prefer to use nbClickLadda which uses promises and easier to use
nb_util.directive('nbLaddaWatch', [
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
                scope.$watch(attrs.nbLaddaWatch, function(loading) {
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

nb_util.directive('nbActiveLocation', [
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


function human_percent(percent) {
    var str = Number(percent || 0).toFixed(1);
    var n = str.length;
    if (str[n - 1] === '0' && str[n - 2] === '.') {
        return str.substr(0, n - 2) + ' %';
    } else {
        return str + ' %';
    }
}
