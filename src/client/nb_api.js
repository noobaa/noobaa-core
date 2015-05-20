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
        /*
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
        */

        // return a new client based on mine - inherits auth token unless overriden
        function new_client() {
            return new api.Client($scope.client.options);
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
                    if (err.statusCode === 401) return $timeout(login, 10);
                    var q = 'Oy, there\'s a problem. Would you like to reload?';
                    return nbAlertify.confirm(q).then(logout);
                });
        }

        function save_token(token) {
            win_storage.nb_token = token || '';
            $scope.client.options.auth_token = token;
        }

        function init_token() {
            var token = win_storage.nb_token;
            $scope.client.options.auth_token = token;
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
    '$q', '$timeout', '$rootScope', '$location', 'nbAlertify', 'nbClient',
    function($q, $timeout, $rootScope, $location, nbAlertify, nbClient) {
        var $scope = {};

        $scope.reload_system = reload_system;
        $scope.new_system = new_system;
        $scope.create_system = create_system;
        $scope.connect_system = connect_system;
        $scope.toggle_system = toggle_system;
        $scope.get_agent_installer = get_agent_installer;
        $scope.get_s3_rest_installer = get_s3_rest_installer;
        $scope.read_activity_log = read_activity_log;
        $scope.read_activity_log_newest = read_activity_log_newest;
        $scope.read_activity_log_newer = read_activity_log_newer;
        $scope.read_activity_log_older = read_activity_log_older;
        $scope.read_activity_log_by_date = read_activity_log_by_date;
        $scope.read_activity_log_subject = read_activity_log_subject;
        $scope.activity_log_params = {
            limit: 10
        };

        $scope.init_system = reload_system();

        function reload_system() {
            return nbClient.init_promise
                .then(function() {
                    if (!nbClient.account) return;

                    return nbClient.client.system.list_systems()
                        .then(function(res) {
                            console.log('SYSTEMS', res.systems);
                            $scope.systems = res.systems;

                            // if we are already connected to a system then read it
                            if (nbClient.system) {
                                return nbClient.client.system.read_system();
                            }

                            // for support account - go to list of systems
                            if (nbClient.account.is_support) {
                                // TODO this service shouldn't really mess with app locations
                                $location.path('support');
                                return;
                            }

                            // if not then just connect to the first one
                            var sys = $scope.systems[0];
                            if (!sys) {
                                // TODO this service shouldn't really mess with app locations
                                // $location.path('new_system');
                                return;
                            }
                            return nbClient.create_auth({
                                    system: sys.name
                                })
                                .then(function() {
                                    return nbClient.client.system.read_system();
                                });
                        });
                })
                .then(function(sys) {
                    $scope.system = sys;
                    if (!sys) {
                        console.log('NO SYSTEM', nbClient.account);
                        return;
                    }
                    console.log('READ SYSTEM', sys);

                    // TODO handle bigint type (defined at system_api) for sizes > petabyte
                    _.each(sys.tiers, function(tier) {
                        tier.used_percent = Math.ceil(100 * tier.storage.used / tier.storage.alloc);
                    });
                    return read_activity_log();
                })
                .then(null, function(err) {
                    console.error('RELOAD SYSTEM FAILED', err);
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
                .then(reload_system);
        }

        function connect_system(system_name) {
            return nbClient.create_auth({
                    system: system_name
                })
                .then(reload_system);
        }

        function toggle_system(system_name) {
            if ($scope.system && $scope.system.name === system_name) {
                return connect_system('');
            } else {
                return connect_system(system_name);
            }
        }

        function get_agent_installer() {
            return $q.when()
                .then(function() {
                    return nbClient.client.system.get_system_resource_info({});
                })
                .then(function(res) {
                    return res.agent_installer || '';
                });
        }

        function get_s3_rest_installer() {
            return $q.when()
                .then(function() {
                    return nbClient.client.system.get_system_resource_info({});
                })
                .then(function(res) {
                    return res.s3rest_installer || '';
                });
        }
        // ACTIVITY LOG

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
                        try {
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
                                    if (!l.node) {
                                        console.log('filtered event with missing node info', l.event);
                                        return false;
                                    }
                                    l.category = 'nodes';
                                    l.text = 'Added node ' + l.node.name;
                                    break;
                                case 'obj.uploaded':
                                    if (!l.obj) {
                                        console.log('filtered event with missing obj info', l.event);
                                        return false;
                                    }
                                    l.category = 'files';
                                    l.text = 'Upload completed ' + l.obj.key;
                                    break;
                                default:
                                    console.log('filtered unrecognized event', l.event);
                                    return false;
                            }
                            return true;
                        } catch (err) {
                            console.log('filtered event on exception', err, l);
                            return false;
                        }
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
