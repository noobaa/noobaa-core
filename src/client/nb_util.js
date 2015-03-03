/* global angular, google */
'use strict';

var _ = require('lodash');
var moment = require('moment');
var querystring = require('querystring');
var size_utils = require('../util/size_utils');

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
    $('body').tooltip({
        selector: '[rel=tooltip]'
    });
    $('body').popover({
        selector: '[rel=popover]'
    });
    $.material.init();
}]);



nb_util.factory('nbNetworkMonitor', [
    '$q', '$window', '$interval',
    function($q, $window, $interval) {
        var self = {};

        self.data = [];
        self.count = 0;
        var curr = {
            out: 0,
            inn: 0,
        };
        var last_time = Date.now();

        $interval(function() {
            if (!curr.inn && !curr.out) {
                return;
            }
            self.count += 1;
            curr.time = new Date();
            var time = curr.time.getTime();
            var elapsed = (time - last_time) / 1000;
            last_time = time;
            curr.out /= elapsed;
            curr.inn /= elapsed;
            // push and keep under size limit
            self.data.push(curr);
            if (self.data.length > 60) {
                self.data.shift();
            }
            curr = {
                out: 0,
                inn: 0,
            };
        }, 3000);

        self.report_incoming = function(bytes) {
            curr.inn += bytes;
        };
        self.report_outgoing = function(bytes) {
            curr.out += bytes;
        };

        return self;
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


nb_util.directive('nbPieChart', [
    'nbGoogle', '$rootScope',
    function(nbGoogle, $rootScope) {
        return {
            restrict: 'A',
            link: function(scope, element, attrs) {
                var google;
                scope.$watch(attrs.nbPieChart, redraw, true);

                function redraw(pie_chart) {
                    if (!google) {
                        return nbGoogle.then(function(google_arg) {
                            google = google_arg;
                            redraw(pie_chart);
                        });
                    }
                    var table = google.visualization.arrayToDataTable(pie_chart.data);
                    var chart = new google.visualization.PieChart(element[0]);
                    chart.draw(table, pie_chart.options);
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



nb_util.factory('nbHashRouter', [
    '$location', '$window', '$timeout', '$q',
    function($location, $window, $timeout, $q) {

        function HashRouter(scope) {
            this.scope = scope;
            this.routes = {};
            this.route = '';
            this.route_options = {};
            this.routes[this.route] = this.route_options;
        }

        /**
         * route options:
         * - templateURL (string)
         * - redirectTo (string)
         * - pagination (boolean)
         * - reload (function)
         */
        HashRouter.prototype.when = function(route, options) {
            this.routes[route] = options || {};
            return this;
        };

        HashRouter.prototype.otherwise = function(options) {
            this.routes[''] = options || {};
            return this;
        };

        HashRouter.prototype.done = function() {
            var self = this;
            if (self.watch_scope) {
                self.reload();
                return self;
            }
            self.watch_scope = self.scope.$new();
            self.watch_scope.$location = $location;
            self.watch_scope.$watch('$location.hash()', function(hash) {
                self.load(hash);
            });
            return self;
        };

        HashRouter.prototype.set = function(route, query) {
            var self = this;
            var opt = self.routes[route];
            if (!opt) {
                console.error('no such route', route);
                return;
            }
            var hash = encodeURIComponent(route);
            // compact the query by removing empty values
            var hash_query = _.pick(query, function(val, key) {
                return !!val;
            });
            // handle pagination - translate the page number from 0-based to 1-based
            if (opt.pagination) {
                if (hash_query.page) {
                    hash_query.page = hash_query.page + 1;
                } else {
                    delete hash_query.page;
                }
            }
            if (!_.isEmpty(hash_query)) {
                hash += '&' + querystring.stringify(hash_query);
            }
            // console.log('nbHashRouter.set', hash);
            if ($location.hash() !== hash) {
                $location.hash(hash);
            }
        };

        HashRouter.prototype.set_num_pages = function(route, num_pages) {
            var opt = this.routes[route];
            opt.num_pages = num_pages;
            if (route === this.route) {
                // set the same page to check bounds
                var page = opt.query && opt.query.page || 0;
                this.set_page(page);
            }
        };

        HashRouter.prototype.set_page = function(page) {
            var opt = this.route_options;
            var query = opt.query || {};
            var num_pages = opt.num_pages || 0;
            if (page >= num_pages && num_pages >= 0) {
                page = num_pages - 1;
            }
            if (page < 0) {
                page = 0;
            }
            if (page !== query.page) {
                query.page = page;
                this.set(this.route, query);
            }
        };

        HashRouter.prototype.set_query = function(key, val) {
            var opt = this.route_options;
            var query = opt.query || {};
            if (query[key] !== val) {
                delete query.page;
                query[key] = val;
                this.set(this.route, query);
            }
        };

        HashRouter.prototype.load = function(hash) {
            var self = this;
            // console.log('nbHashRouter.load', hash);
            hash = hash || '';
            var matches = hash.match(/^(\w*)&?(.*)$/) || [];
            var route = matches[1] || '';
            var opt = self.routes[route];
            if (!opt) {
                route = '';
                opt = self.routes[route];
            }
            while (opt.redirectTo) {
                route = opt.redirectTo;
                opt = self.routes[route];
            }
            opt.query = querystring.parse(matches[2]) || {};
            // handle pagination - convert back from 1-based to 0-based
            if (opt.pagination) {
                opt.query.page = (parseInt(opt.query.page, 10) - 1) || 0;
            }
            self.route = route;
            self.route_options = opt;
            self.reload();
            return self;
        };

        HashRouter.prototype.reload = function() {
            var self = this;
            var opt = self.route_options;
            if (opt.reload) {
                return opt.reload(opt.query);
            }
        };

        return function(scope) {
            return new HashRouter(scope);
        };
    }
]);



nb_util.directive('nbHashRouterView', [
    '$compile', '$q', '$timeout',
    function($compile, $q, $timeout) {
        return {
            link: function(scope, element, attrs) {
                var html = '<div ng-include="' +
                    attrs.nbHashRouterView +
                    '.route_options.templateUrl"></div>';
                element.append($compile(html)(scope));
            }
        };
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
                    if (event.preventDefault) event.preventDefault();
                    if (event.stopPropagation) event.stopPropagation();
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
        var self = {};
        self.log = wrap_alertify_promise('log', -1);
        self.error = wrap_alertify_promise('error', -1);
        self.success = wrap_alertify_promise('success', -1);
        self.alert = wrap_alertify_promise('alert', -1);
        self.confirm = wrap_alertify_promise('confirm', 1);
        self.prompt = wrap_alertify_promise('prompt', 1);

        self.prompt_password = function() {
            var promise = self.prompt.apply(null, arguments);
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
        return self;
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


function human_percent(fraction) {
    var percent = 100 * (Number(fraction) || 0);
    return percent < 10 ? percent.toFixed(1) : percent.toFixed(0);
}
