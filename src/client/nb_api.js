/* global angular */
'use strict';

var _ = require('lodash');
var moment = require('moment');
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
    '$q', '$http', '$timeout', '$window', '$location', '$rootScope', 'nbModal', 'nbAlertify',
    function($q, $http, $timeout, $window, $location, $rootScope, nbModal, nbAlertify) {
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


        // TODO this manual hack allows https websites to call regular http to agents
        // we need to support https in the agents.
        setTimeout(function() {
            console.log('******************************************' +
                '*********************************');
            console.log('***** click the shield icon on the browser' +
                ' and allow insecure scripts *****');
            console.log('******************************************' +
                '*********************************');
            $http({
                method: 'GET',
                url: 'http://localhost'
            });
        }, 1000);

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
                    if (!res.account) return $timeout(login, 10);
                    $scope.account = res.account;
                    $scope.system = res.system;
                    $scope.role = res.role;
                    $scope.extra = res.extra;
                }, function(err) {
                    console.error(err);
                    // handle unauthorized response
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

        $scope.read_activity_log = read_activity_log;
        $scope.read_activity_log_newest = read_activity_log_newest;
        $scope.read_activity_log_newer = read_activity_log_newer;
        $scope.read_activity_log_older = read_activity_log_older;
        $scope.read_activity_log_by_date = read_activity_log_by_date;
        $scope.read_activity_log_subject = read_activity_log_subject;
        $scope.activity_log_params = {
            limit: 10
        };

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
                .then(function(sys) {
                    console.log('READ SYSTEM', sys);
                    $scope.system = sys;
                    // TODO handle bigint type (defined at system_api) for sizes > petabyte
                    _.each(sys.tiers, function(tier) {
                        tier.used_percent = Math.ceil(100 * tier.storage.used / tier.storage.alloc);
                    });
                    return read_activity_log();
                }, function(err) {
                    console.error('READ SYSTEM FAILED', err);
                    return $scope.init_systems.then(function() {
                        var sys = $scope.systems[0];
                        return connect_system(sys.name);
                    });
                });
        }

        function read_activity_log() {
            return nbClient.init_promise
                .then(function() {
                    return nbClient.client.system.read_activity_log($scope.activity_log_params);
                })
                .then(function(res) {
                    if (!res.logs.length) {
                        console.log('ACTIVITY LOG EMPTY REPLY', $scope.activity_log_params);
                        if ($scope.activity_log_params.since) {
                            $scope.activity_log_params.till = $scope.activity_log_params.since;
                            delete $scope.activity_log_params.since;
                            return read_activity_log();
                        } else if ($scope.activity_log_params.till) {
                            return read_activity_log_newest();
                        }
                    }
                    var day_format = 'MMM DD';
                    var time_format = 'HH:mm:ss';
                    // var now_moment = moment();
                    // var today = now_moment.format(day_format);
                    // var yesterday = now_moment.subtract(1, 'day').format(day_format);
                    $scope.activity_log = _.filter(res.logs, function(l) {
                        l.time = new Date(l.time);
                        l.time_moment = moment(l.time);
                        l.day_of_year = l.time_moment.format(day_format);
                        /*
                        if (l.day_of_year === today) {
                            l.day_of_year = 'Today';
                        } else if (l.day_of_year === yesterday) {
                            l.day_of_year = 'Yesterday';
                        }
                        */
                        l.time_of_day = l.time_moment.format(time_format);
                        switch (l.event) {
                            case 'node.create':
                                l.category = 'nodes';
                                l.text = 'Added node ' + l.node.name;
                                break;
                            case 'obj.uploaded':
                                l.category = 'files';
                                l.text = 'Upload completed ' + l.obj.key;
                                break;
                            default:
                                console.log('filtered unrecognized event', l.event);
                                return false;
                        }
                        return true;
                    });
                    console.log('ACTIVITY LOG', $scope.activity_log_params, $scope.activity_log);
                });
        }

        function read_activity_log_newest() {
            delete $scope.activity_log_params.since;
            delete $scope.activity_log_params.till;
            return read_activity_log();
        }

        function read_activity_log_newer() {
            if ($scope.activity_log && $scope.activity_log.length) {
                var last = $scope.activity_log[$scope.activity_log.length - 1];
                $scope.activity_log_params.since = last.time.getTime();
                delete $scope.activity_log_params.till;
            }
            return read_activity_log()
                .then(function() {
                    if ($scope.activity_log.length < $scope.activity_log_params.limit) {
                        return read_activity_log_newest();
                    }
                });
        }

        function read_activity_log_older() {
            if ($scope.activity_log && $scope.activity_log.length) {
                var first = $scope.activity_log[0];
                $scope.activity_log_params.till = first.time.getTime();
                delete $scope.activity_log_params.since;
            }
            return read_activity_log();
        }

        function read_activity_log_by_date(date) {
            $scope.activity_log_params.since = (new Date(date)).getTime();
            delete $scope.activity_log_params.till;
            return read_activity_log();
        }

        function read_activity_log_subject(subject) {
            if (subject === 'files') {
                $scope.activity_log_params.event = '^bucket\\.|^obj\\.';
            } else if (subject === 'nodes') {
                $scope.activity_log_params.event = '^node\\.';
            } else if (subject === 'pools') {
                $scope.activity_log_params.event = '^tier\\.';
            } else if (subject === 'repos') {
                $scope.activity_log_params.event = '^bucket\\.';
            } else {
                delete $scope.activity_log_params.event;
            }
            return read_activity_log().then(function() {
                $scope.activity_log_subject = subject;
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
            nbClient.save_token('');

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
            nbClient.save_token('');

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
