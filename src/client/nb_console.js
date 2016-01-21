/* global angular */
'use strict';

var _ = require('lodash');
var P = require('../util/promise');
var url = require('url');
var pkg = require('../../package.json');

require('./nb_util');
require('./nb_api');
require('./nb_nodes');
require('./nb_files');


var nb_console = angular.module('nb_console', [
    'nb_util',
    'nb_api',
    'ngRoute',
    'ngCookies',
    'ngAnimate',
    'ngSanitize',
    'ngTouch',
]);



nb_console.config(['$routeProvider', '$locationProvider', '$compileProvider',
    function($routeProvider, $locationProvider, $compileProvider) {
        // allow blob urls
        $compileProvider.imgSrcSanitizationWhitelist(/^\s*(https?|file|blob|filesystem):/);
        $compileProvider.aHrefSanitizationWhitelist(/^\s*(https?|file|blob|filesystem):/);
        // routes
        $locationProvider.html5Mode(true);
        // using reloadOnSearch=false to ignore hash changes for the sake of nbHashRouter
        $routeProvider
            .when('/overview', {
                templateUrl: 'console/overview.html',
                reloadOnSearch: false,
            })
            // .when('/resource', {
            //     templateUrl: 'console/resource_view.html',
            //     reloadOnSearch: false,
            // })
            .when('/buckets', {
                templateUrl: 'console/buckets_view.html',
                reloadOnSearch: false,
            })
            .when('/pools', {
                templateUrl: 'console/pools_view.html',
                reloadOnSearch: false,
            })
            .when('/pool/:pool_name', {
                templateUrl: 'console/pool_view.html',
                reloadOnSearch: false,
            })
            .when('/pool/:pool_name/:node_name*', {
                templateUrl: 'console/node_view.html',
                reloadOnSearch: false,
            })
            .when('/bucket/:bucket_name', {
                templateUrl: 'console/bucket_view.html',
                reloadOnSearch: false,
            })
            .when('/bucket/:bucket_name/:file_name*', {
                templateUrl: 'console/file_view.html',
                reloadOnSearch: false,
            })
            .when('/support', {
                templateUrl: 'console/support.html',
                reloadOnSearch: false,
            })
            .when('/config', {
                templateUrl: 'console/config_view.html',
                reloadOnSearch: false,
            })
            .otherwise({
                redirectTo: '/overview'
            });
    }
]);



nb_console.controller('ConsoleCtrl', [
    '$scope', '$http', '$q', '$window', '$location',
    'nbSystem', 'nbNodes', 'nbFiles', 'nbClient', 'nbAlertify',
    function($scope, $http, $q, $window, $location,
        nbSystem, nbNodes, nbFiles, nbClient, nbAlertify) {

        $scope.nbClient = nbClient;
        $scope.nbSystem = nbSystem;
        $scope.nbNodes = nbNodes;
        $scope.nbFiles = nbFiles;
        $scope.nbAlertify = nbAlertify;
        $scope.version = pkg.version;
        $scope.$location = $location;
        $scope.nav = {
            active: 'overview',
        };
    }
]);


nb_console.controller('ConfigViewCtrl', [
    '$scope', '$http', '$q', '$window', '$location', '$rootScope', '$timeout',
    'nbSystem', 'nbNodes', 'nbFiles', 'nbClient', 'nbAlertify', 'nbModal',
    function($scope, $http, $q, $window, $location, $rootScope, $timeout,
        nbSystem, nbNodes, nbFiles, nbClient, nbAlertify, nbModal) {
        $scope.nav.active = 'cog';
        $scope.nav.reload_view = reload_view;
        $scope.apply_n2n_config = apply_n2n_config;
        $scope.apply_dns_config = apply_dns_config;
        $scope.apply_system_certificate = apply_system_certificate;

        reload_view(true);

        function reload_view(init_only) {
            return $q.when()
                .then(function() {
                    if (init_only) {
                        return nbSystem.init_system;
                    } else {
                        return nbSystem.reload_system();
                    }
                })
                .then(function() {
                    var n2n_config = nbSystem.system.n2n_config;
                    var tcp_ports = '';
                    if (n2n_config.tcp_permanent_passive) {
                        tcp_ports =
                            n2n_config.tcp_permanent_passive.port ||
                            (n2n_config.tcp_permanent_passive.min + '-' +
                                n2n_config.tcp_permanent_passive.max);
                    }
                    console.log('n2n_config', n2n_config);
                    $scope.n2n_form = $scope.n2n_form || {};
                    $scope.n2n_form.proto = n2n_config.tcp_active ?
                        (n2n_config.udp_port ? 'tcp_and_udp' : 'tcp') : 'udp';
                    $scope.n2n_form.tcp_ports = tcp_ports.toString();
                    $scope.n2n_form.tcp_tls = !!n2n_config.tcp_tls;
                    console.log('n2n_form', $scope.n2n_form);
                    $scope.dns_form = $scope.dns_form || {};
                    $scope.dns_form.ip_address = nbSystem.system.ip_address;
                    var addr_url = url.parse(nbSystem.system.base_address);
                    if (addr_url.hostname === nbSystem.system.ip_address) {
                        $scope.dns_form.dns_type = 'ip';
                        $scope.dns_form.dns_name = 'noobaa.local';
                    } else {
                        $scope.dns_form.dns_type = 'dns';
                        $scope.dns_form.dns_name = addr_url.hostname;
                    }
                });
        }

        function apply_n2n_config() {
            var n2n_form = $scope.n2n_form;
            console.log('apply_n2n_config: n2n_form', n2n_form);
            n2n_form.state = '';
            n2n_form.error = '';
            n2n_form.reply = null;
            var tcp_ports;
            if (n2n_form.proto !== 'udp') {
                tcp_ports = parse_port_range_config_string(n2n_form.tcp_ports);
                if (!tcp_ports) {
                    n2n_form.state = 'error';
                    n2n_form.error = 'Invalid TCP port/range';
                    return;
                }
            }
            var n2n_config = {};
            if (n2n_form.proto === 'tcp_and_udp' || n2n_form.proto === 'tcp') {
                n2n_config.tcp_active = true;
                n2n_config.tcp_permanent_passive = tcp_ports;
            } else {
                n2n_config.tcp_active = false;
                n2n_config.tcp_permanent_passive = false;
            }
            if (n2n_form.proto === 'tcp_and_udp' || n2n_form.proto === 'udp') {
                n2n_config.udp_port = true;
                // parse_port_range_config_string(n2n_form.udp_ports);
            } else {
                n2n_config.udp_port = false;
            }
            n2n_config.tcp_tls = !!n2n_form.tcp_tls;
            console.log('apply_n2n_config: n2n_config', n2n_config);
            return $q.when()
                .then(function() {
                    n2n_form.state = 'saving';
                    return nbClient.client.system.update_n2n_config(n2n_config);
                })
                .then(function(res) {
                    n2n_form.state = 'saved';
                    n2n_form.reply = res;
                }, function(err) {
                    n2n_form.state = 'error';
                    n2n_form.error = err;
                })
                .then(reload_view);
        }

        function parse_port_range_config_string(s) {
            if (!s) return;
            var sp = s.split('-');
            if (sp.length !== 1 && sp.length !== 2) return;
            var min = parseInt(sp[0], 10);
            var max = parseInt(sp[1], 10);
            if (max) {
                if (min <= max && min >= 1024 && max <= 64 * 1024) {
                    return {
                        min: min,
                        max: max
                    };
                }
            } else if (min) {
                if (min >= 1024 && min <= 64 * 1024) {
                    return {
                        port: min
                    };
                }
            }
        }

        function apply_dns_config() {
            var dns_form = $scope.dns_form;
            console.log('apply_dns_config', dns_form);
            dns_form.state = '';
            dns_form.error = '';
            dns_form.reply = null;
            var base_addr_url = url.parse(nbSystem.system.base_address);
            base_addr_url.host = '';
            if (dns_form.dns_type === 'dns') {
                if (!dns_form.dns_name) {
                    dns_form.state = 'error';
                    dns_form.error = 'Missing name';
                    return;
                }
                base_addr_url.hostname = dns_form.dns_name;
            } else {
                base_addr_url.hostname = nbSystem.system.ip_address;
            }
            var base_address = url.format(base_addr_url);
            console.log('update_base_address', base_addr_url);
            return $q.when()
                .then(function() {
                    dns_form.state = 'saving';
                    return nbClient.client.system.update_base_address({
                        base_address: base_address
                    }, {
                        // send this request over the new address
                        // to make sure it is indeed working
                        address: base_address
                    });
                })
                .then(function(res) {
                    dns_form.state = 'saved';
                    dns_form.reply = res;
                }, function(err) {
                    dns_form.state = 'error';
                    dns_form.error = err;
                })
                .then(reload_view);
        }

        function apply_system_certificate() {
            console.log('apply_system_certificate');
        }

    }
]);


nb_console.controller('SupportViewCtrl', [
    '$scope', '$q', '$timeout', '$window', '$location', '$routeParams',
    'nbClient', 'nbSystem', 'nbNodes', 'nbHashRouter', 'nbAlertify', 'nbModal',
    function($scope, $q, $timeout, $window, $location, $routeParams,
        nbClient, nbSystem, nbNodes, nbHashRouter, nbAlertify, nbModal) {
        $scope.nav.active = 'support';
        $scope.nav.reload_view = reload_view;
        $scope.create_account = create_account;

        var support_router = $scope.support_router =
            nbHashRouter($scope)
            .when('accounts', {
                templateUrl: 'console/support_accounts.html',
                reload: reload_accounts
            })
            .when('stats', {
                templateUrl: 'console/support_stats.html',
            })
            .when('settings', {
                templateUrl: 'console/support_settings.html',
            })
            .otherwise({
                redirectTo: 'accounts'
            });

        reload_view(true);

        function reload_view(init_only) {
            return $q.when()
                .then(function() {
                    if (init_only) {
                        return nbSystem.init_system;
                    } else {
                        return nbSystem.reload_system();
                    }
                })
                .then(function() {
                    if (!nbClient.account || !nbClient.account.is_support) {
                        $location.path('/');
                        return;
                    }
                    support_router.done();
                });
        }

        function reload_accounts() {
            return $q.when(nbClient.client.account.list_accounts())
                .then(function(res) {
                    console.log('ACCOUNTS', res);
                    $scope.accounts = res.accounts;
                });
        }

        function create_account() {
            var scope = $scope.$new();
            scope.system_name = '';
            scope.email = '';
            scope.password = '';


            scope.update_email_message = function() {
                scope.email_message = '';
            };
            scope.create = function() {
                return $q.when(nbClient.client.account.create_account({
                        name: scope.system_name,
                        email: scope.email,
                        password: scope.password
                    }))
                    .then(function() {
                        scope.modal.modal('hide');
                        return reload_accounts();
                    }, function(err) {
                        console.error('CREATE ACCOUNT ERROR:', err.stack, err);
                        if (err.rpc_code) {
                            nbAlertify.error(err.message);
                        } else {
                            nbAlertify.error('Failed: ' + JSON.stringify(err));
                        }
                        return reload_accounts();
                    });
            };
            scope.modal = nbModal({
                template: 'console/account_create_dialog.html',
                scope: scope,
            });
        }
    }
]);

nb_console.controller('UserManagementViewCtrl', [
    '$scope', '$q', '$timeout', '$window', '$location', '$routeParams',
    'nbClient', 'nbSystem', 'nbNodes', 'nbHashRouter', 'nbAlertify', 'nbModal',
    function($scope, $q, $timeout, $window, $location, $routeParams,
        nbClient, nbSystem, nbNodes, nbHashRouter, nbAlertify, nbModal) {
        $scope.add_new_user = add_new_user;
        $scope.delete_user = delete_user;
        $scope.reset_password = reset_password;
        $scope.set_email = set_email;

        reload_accounts();
        console.log('accounts:' + $scope.accounts);

        function reload_accounts() {
            return $q.when(nbClient.client.account.list_system_accounts())
                .then(function(res) {
                    $scope.accounts = res.accounts;
                });
        }

        function reset_password(user_email) {
            var scope = $scope.$new();
            scope.system_name = '';
            scope.password = '';
            scope.email = '';
            scope.update_password = true;
            scope.update = function() {
                return $q.when(nbClient.client.account.update_account({
                        name: nbSystem.system.name,
                        email: user_email,
                        password: scope.password,
                        original_email: user_email,
                    }))
                    .then(function() {
                        nbAlertify.success('Password for ' + user_email + ' has been set');
                        scope.modal.modal('hide');
                    }, function(err) {
                        console.error('Reset password failure:', err.stack, err);
                        if (err.rpc_code) {
                            nbAlertify.error(err.message);
                        } else {
                            nbAlertify.error('Failed: ' + JSON.stringify(err));
                        }
                    });
            };
            scope.modal = nbModal({
                template: 'console/reset_user_info_dialog.html',
                scope: scope,
            });
        }

        function set_email(user_email) {
            var scope = $scope.$new();
            scope.system_name = '';
            scope.password = '';
            scope.email = user_email;
            scope.update_email = true;
            scope.update = function() {
                console.log('scope.email:' + scope.email);
                return $q.when(nbClient.client.account.update_account({
                        name: nbSystem.system.name,
                        email: scope.email,
                        original_email: user_email,
                    }))
                    .then(function() {
                        if (scope.email) {
                            scope.modal.modal('hide');
                            nbAlertify.success('Email ' + scope.email + ' has been set');
                            reload_accounts();
                        }
                    }, function(err) {
                        console.error('Reset email failure:', err.stack, err);
                        if (err.rpc_code) {
                            nbAlertify.error(err.message);
                        } else {
                            nbAlertify.error('Failed: ' + JSON.stringify(err));
                        }
                    });
            };
            scope.modal = nbModal({
                template: 'console/reset_user_info_dialog.html',
                scope: scope,
            });
        }

        function delete_user(user_email) {
            console.log('attempt to delete ' + user_email);
            var user_info = _.find($scope.accounts, function(account) {
                console.log('attempt to delete acc:' + account.email);

                return account.email === user_email;
            });
            if (user_info) {
                if ($scope.accounts.length === 1) {
                    nbAlertify.error('System must have at least one account');
                } else {
                    if (nbClient.account.email === user_email) {
                        nbAlertify.error('Cannot delete current logged in user');
                    } else {

                        nbAlertify.confirm('Are you sure that you want to delete ' + user_email + '?')
                            .then(function(result) {
                                console.log('in confirm user deletion');

                                return $q.when(nbClient.client.account.delete_account(user_email))
                                    .then(function() {
                                        nbAlertify.success('User ' + user_email + ' has been deleted');
                                        reload_accounts();
                                    });

                            })
                            .then(null, function(err) {
                                if (err.message !== "canceled") {
                                    nbAlertify.error('Error while trying to delete user. ERROR:' + err.message);
                                }
                            });
                    }

                }

            } else {
                nbAlertify.error('User does not exist any more.');
                reload_accounts();
            }
        }

        function add_new_user() {
            var scope = $scope.$new();
            scope.system_name = '';
            scope.password = '';
            scope.email = '';
            console.log('system:', JSON.stringify(nbSystem.system));

            scope.copy_to_clipboard = function() {
                var copyFrom = $window.document.getElementById('copy-text-area');
                var selection = $window.getSelection();
                selection.removeAllRanges();
                var range = $window.document.createRange();
                range.selectNodeContents(copyFrom);
                selection.addRange(range);
                try {
                    var success = $window.document.execCommand('copy', false, null);
                    if (success) {
                        nbAlertify.success('Email details copied to clipboard');
                    } else {
                        nbAlertify.error('Cannot copy email details to clipboard, please copy manually');
                    }
                    selection.removeAllRanges();
                } catch (err) {
                    console.error('err while copy', err);
                    nbAlertify.error('Cannot copy email details to clipboard, please copy manually');
                }
            };

            scope.update_email_message = function() {
                scope.email_message = 'Hi,\r\n' +
                    'I created a noobaa user for you\r\n' +
                    'To use NooBaa, go to ' + $location.protocol() + '://' + $location.host() + ':' + $location.port() + '\r\n' +
                    'User name: ' + scope.email + '\r\n' +
                    'password:' + scope.password + '\r\n' +
                    'you can change the password on your login or later on';
            };
            scope.update_email_message();
            scope.create = function() {

                return $q.when(nbClient.client.account.create_account({
                        name: nbSystem.system.name,
                        email: scope.email,
                        password: scope.password
                    }))
                    .then(function() {
                        scope.modal.modal('hide');
                        return reload_accounts();
                    }, function(err) {
                        console.error('CREATE ACCOUNT ERROR:', err.stack, err);
                        if (err.rpc_code) {
                            nbAlertify.error(err.message);
                        } else {
                            nbAlertify.error('Failed: ' + JSON.stringify(err));
                        }
                        return reload_accounts();
                    });
            };
            scope.modal = nbModal({
                template: 'console/account_create_dialog.html',
                scope: scope,
            });
        }

    }
]);




nb_console.controller('OverviewCtrl', [
    '$scope', '$q', '$location', '$timeout', '$window', 'nbSystem', 'nbModal',
    function($scope, $q, $location, $timeout, $window, nbSystem, nbModal) {
        $scope.nav.active = 'overview';
        $scope.nav.reload_view = reload_view;
        $scope.upload = upload;
        $scope.rest_server_information = rest_server_information;
        $scope.download_rest_server_package = download_rest_server_package;


        return $scope.nbSystem.init_system
            .then(function() {
                if (!$scope.nbNodes.node_groups) {
                    return $scope.nbNodes.refresh_node_groups();
                }
            })
            .then(function() {
                return $scope.nbNodes.draw_nodes_map();
            });

        function reload_view() {
            return $q.all([
                $scope.nbSystem.reload_system(),
                $scope.nbNodes.refresh_node_groups()
            ]);
        }

        function upload() {
            var bucket_name = $scope.nbSystem.system.buckets[0].name;
            $location.path('bucket/' + bucket_name);
            $timeout(function() {
                return $scope.nbFiles.upload_file(bucket_name);
            }, 1);
        }

        function rest_server_information() {
            var scope = $scope.$new();
            scope.access_keys = nbSystem.system.access_keys;

            var rest_host = ($window.location.host).replace(':' + nbSystem.system.web_port, '').replace(':' + nbSystem.system.ssl_port, ':443');
            console.log('SYS3:' + nbSystem.system.web_port + ' host:' + rest_host);
            scope.rest_endpoint = rest_host;
            scope.bucket_name = $scope.nbSystem.system.buckets[0].name;
            scope.rest_package = download_rest_server_package;
            console.log('rest_server_information', scope.rest_endpoint);
            console.log('rest_server_information', $window.location, $location);
            scope.modal = nbModal({
                template: 'console/rest_server_information.html',
                scope: scope,
            });
        }

        function download_rest_server_package() {
            console.log('rest_package1');
            var link = $window.document.createElement("a");
            link.id = 'noobaa_link_rest_package';
            $window.document.body.appendChild(link);
            link.download = '';
            link.href = nbSystem.system.web_links.s3rest_installer;
            link.click();
            return P.delay(2000).then(function() {
                $window.document.body.removeChild(link);
            });
        }


    }
]);



nb_console.controller('PoolsViewCtrl', [
    '$scope', '$q', 'nbSystem', 'nbAlertify', 'nbNodes',
    function($scope, $q, nbSystem, nbAlertify, nbNodes) {
        $scope.nav.active = 'pool';
        $scope.nav.reload_view = reload_view;
        $scope.add_new_pool = add_new_pool;

        reload_view(true);

        function reload_view(init_only) {
            return init_only ? nbSystem.init_system : nbSystem.reload_system();
        }

        function add_new_pool() {
            return nbAlertify.prompt('Enter name for the new pool')
                .then(function(str) {
                    if (!str) return;
                    return nbNodes.create_pool(str)
                        .then(function() {
                            return reload_view();
                        });
                });
        }
    }
]);



nb_console.controller('BucketsViewCtrl', [
    '$scope', '$q', 'nbSystem', '$rootScope', '$location', 'nbModal', 'nbClient', 'nbAlertify',
    function($scope, $q, nbSystem, $rootScope, $location, nbModal, nbClient, nbAlertify) {

        $scope.nav.active = 'bucket';
        $scope.nav.reload_view = reload_view;
        $scope.add_new_bucket = add_new_bucket;
        $scope.delete_bucket = delete_bucket;
        $scope.sync_bucket = sync_bucket;


        reload_view(true);

        function delete_bucket(bucket_name) {
            console.log('attempt to delete ' + bucket_name);
            var current_bucket = _.find(nbSystem.system.buckets, function(bucket) {
                return bucket.name === bucket_name;
            });
            if (current_bucket) {
                if (current_bucket.num_objects > 0) {
                    nbAlertify.error('Bucket contains ' + current_bucket.num_objects + ' objects. Only empty bucket can be deleted.');
                } else {

                    nbAlertify.confirm('Are you sure that you want to delete bucket "' + bucket_name + '"?')
                        .then(function(result) {
                            console.log('in confirm');
                            $q.when(nbClient.client.bucket.delete_bucket({
                                    name: bucket_name,
                                }))
                                .then(function() {
                                    nbAlertify.success('Bucket ' + bucket_name + ' has been deleted');
                                    reload_view();
                                });

                        })
                        .then(null, function(err) {
                            if (err.message !== "canceled") {
                                nbAlertify.error('Error while trying to delete bucket. ERROR:' + err.message);
                            }
                        });

                }

            } else {
                nbAlertify.error('Bucket does not exist any more.');
                reload_view();
            }
        }

        function sync_bucket(bucket_name) {
            var scope = $rootScope.$new();
            scope.done_disabled = 'disabled';
            scope.status = "Loading...";
            if (bucket_name.length > 10) {
                scope.bucket_name = bucket_name.substring(0, 10) + '...';
            } else {
                scope.bucket_name = bucket_name;
            }
            scope.full_bucket_name = bucket_name;
            scope.$location = $location;
            scope.accessKeys = [];
            scope.sync_deleted = false;
            scope.show_additions_only = false;

            console.log('Account:::' + JSON.stringify(nbClient.account));

            $q.when(nbClient.client.bucket.get_cloud_sync_policy({
                    name: bucket_name
                }))
                .then(function(cloud_sync_policy) {
                    console.log('cloud policy' + JSON.stringify(cloud_sync_policy));
                    if (_.isEmpty(cloud_sync_policy)) {
                        scope.status = "No policy defined";
                        scope.aws_target = "None";
                        scope.has_policy = false;
                        scope.arrow_type = '';
                        scope.interval_options = [15, 30, 45];
                        scope.unit_options = ['Minutes', 'Hours', 'Days'];
                        scope.selected_scheduling_interval = scope.interval_options[0];
                        scope.selected_scheduling_unit = scope.unit_options[0];
                        scope.sync_types = ['BI-Directional', 'NooBaa to AWS', 'AWS to NooBaa'];
                        scope.selected_sync_type = scope.sync_types[0];
                        scope.sync_deleted = true;
                        scope.show_additions_only = false;

                    } else {
                        scope.status = cloud_sync_policy.status;
                        if (cloud_sync_policy.policy.endpoint.length > 10) {
                            scope.aws_target = cloud_sync_policy.policy.endpoint.substring(0, 10) + '...';
                        } else {
                            scope.aws_target = cloud_sync_policy.policy.endpoint;
                        }
                        scope.full_target_name = cloud_sync_policy.policy.endpoint;
                        scope.has_policy = true;
                        console.log('cloud policy c2n:' + cloud_sync_policy.policy.c2n_enabled + ' n2c:' + cloud_sync_policy.policy.n2c_enabled + ' ' + JSON.stringify(cloud_sync_policy));
                        if (cloud_sync_policy.policy.c2n_enabled &&
                            cloud_sync_policy.policy.n2c_enabled) {
                            scope.arrow_type = 'bi-arrow';
                            scope.arrow_tooltip = 'Bi-directional synchornization';
                        } else {
                            if (cloud_sync_policy.policy.c2n_enabled) {
                                scope.arrow_type = 'arrow-left';
                                scope.arrow_tooltip = 'Synchornization from AWS to NooBaa';
                            } else {
                                scope.arrow_type = 'arrow';
                                scope.arrow_tooltip = 'Synchornization from NooBaa to AWS';
                            }
                        }
                        console.log('arrow_type:' + scope.arrow_type);
                    }

                });
            $q.when(nbClient.client.account.get_account_sync_credentials_cache())
                .then(function(cached_access_key) {
                    // TODO: Test, remove
                    // AKIAJOP7ZFXOOPGL5BOA knaTbOnT9F3Afk+lfbWDSAUACAqsfoWj1FnHMaDz
                    // AKIAIKFRM4EAAO5TAXJA nntw4SsW60qUUldKiLH99SJnUe2c+rsVlmSyQWHF


                    console.log('Cached keys :::' + JSON.stringify(cached_access_key));
                    scope.accessKeys.push({
                        access_key: 'Choose Access Key',
                        secret_key: '',
                        _id: ''
                    });
                    scope.selected_key = scope.accessKeys[0];
                    if (!_.isEmpty(cached_access_key)) {
                        scope.accessKeys = (_(scope.accessKeys).concat(cached_access_key)).value();

                        console.log('keys', scope.accessKeys);
                        scope.select_key();
                    }
                    scope.enable_new_key = false;
                    scope.access_key = '';
                    scope.secret_key = '';
                    scope.buckets = [];
                    scope.has_error = false;
                    scope.modal = nbModal({
                        template: 'console/sync_bucket.html',
                        scope: scope,
                    });
                });
            scope.add_new_key = function() {
                scope.enable_new_key = true;
                scope.access_key = '';
                scope.secret_key = '';
            };
            scope.set_cloud_sync_policy = function() {
                scope.has_policy = false;
                scope.interval_options = [15, 30, 45];
                scope.unit_options = ['Minutes', 'Hours', 'Days'];
                scope.selected_scheduling_interval = scope.interval_options[0];
                scope.selected_scheduling_unit = scope.unit_options[0];
                scope.sync_types = ['BI-Directional', 'NooBaa to AWS', 'AWS to NooBaa'];
                scope.selected_sync_type = scope.sync_types[0];
                scope.sync_deleted = true;
                scope.show_additions_only = false;
            };
            scope.select_sync_type = function() {
                console.log('select sync type' + scope.selected_sync_type);
                if (scope.selected_sync_type !== scope.sync_types[0]) {
                    scope.show_additions_only = true;
                    scope.sync_deleted = true;
                } else {
                    scope.show_additions_only = false;
                }
            };
            scope.delete_cloud_sync_policy = function() {
                nbAlertify.confirm('Are you sure that you want to delete the sync policy?')
                    .then(function(result) {
                        console.log('in confirm sync policy deletion');
                        $q.when(nbClient.client.bucket.delete_cloud_sync({
                            name: bucket_name
                        }));
                    })
                    .then(function() {
                        scope.status = "No policy defined";
                        scope.arrow_type = 'arrow-inverse';
                        scope.has_policy = false;
                        scope.aws_target = '';
                        scope.modal.modal('hide');
                        nbAlertify.success('Sync policy for ' + bucket_name + ' has been removed');
                        reload_view();
                    })
                    .then(null, function(err) {
                        console.log('err:' + err.message);
                        if (err.message !== 'canceled') {
                            scope.error_message = err.message;
                            scope.has_error = true;
                        }
                    });
            };
            scope.select_key = function() {
                console.log("selected:" + scope.selected_key.access_key);
                if (scope.selected_key.access_key === scope.accessKeys[0].access_key) {
                    console.log("empty bucket list");
                    scope.buckets = [];
                } else {

                    scope.buckets = ["Loading..."];
                    scope.selected_bucket = scope.buckets[0];
                    $q.when(nbClient.client.bucket.get_cloud_buckets({
                        access_key: scope.selected_key.access_key,
                        secret_key: scope.selected_key.secret_key
                    })).then(function(buckets_list) {
                        console.log('got list1' + JSON.stringify(buckets_list));
                        buckets_list.push('Choose Bucket for sync');
                        scope.buckets = buckets_list;
                        console.log('got list2' + JSON.stringify(scope.buckets));
                        scope.selected_bucket = scope.buckets[buckets_list.length - 1];

                    }).then(null, function(err) {
                        scope.error_message = 'Error:' + err.message + ',' + err.stack;
                        scope.has_error = true;

                    });
                }

            };

            scope.select_bucket = function() {
                console.log("selected1:" + scope.selected_bucket);
                if (scope.selected_bucket !== scope.buckets[scope.buckets.length - 1]) {
                    scope.done_disabled = '';
                } else {
                    scope.done_disabled = 'disabled';
                }
            };

            scope.done = function() {
                if (!scope.done_disabled) {

                    var scheduling_in_minutes = 0;
                    if (scope.selected_scheduling_unit === 'Minutes') {
                        scheduling_in_minutes = scope.selected_scheduling_interval;
                    } else {
                        if (scope.selected_scheduling_unit === 'Hours') {
                            scheduling_in_minutes = scope.selected_scheduling_interval * 60;
                        } else { //Days
                            scheduling_in_minutes = scope.selected_scheduling_interval * 60 * 24;
                        }
                    }
                    console.log('done scheduling_in_minutes:' + scheduling_in_minutes);
                    $q.when(nbClient.client.bucket.set_cloud_sync({
                        name: bucket_name,
                        policy: {
                            endpoint: scope.selected_bucket,
                            access_keys: [{
                                access_key: scope.selected_key.access_key,
                                secret_key: scope.selected_key.secret_key
                            }],
                            schedule: scheduling_in_minutes,
                            paused: false,
                            c2n_enabled: scope.selected_sync_type === scope.sync_types[0] ||
                                scope.selected_sync_type === scope.sync_types[2],
                            n2c_enabled: scope.selected_sync_type === scope.sync_types[0] ||
                                scope.selected_sync_type === scope.sync_types[1],
                            //TODO:: Change to this once direction can be chosen additions_only: scope.sync_deleted,
                            additions_only: !scope.sync_deleted
                        }
                    })).then(function() {
                        scope.modal.modal('hide');
                        nbAlertify.success('Congrats! ' + bucket_name + ' sync set');
                        reload_view();
                    }).then(null, function(err) {
                        scope.error_message = err.message;
                        scope.has_error = true;
                    });
                }

            };
            scope.cancel_new_key = function() {
                console.log('cancel done key:', scope.access_key, ' secret: ', scope.secret_key);
                scope.enable_new_key = false;
                scope.error_message = '';
                scope.has_error = false;
                scope.select_key();

            };
            scope.save_new_key = function() {
                console.log('save done key:', scope.access_key, ' secret: ', scope.secret_key);
                if (!_.isEmpty(scope.access_key) && !_.isEmpty(scope.secret_key)) {
                    if (_.findIndex(scope.accessKeys, {
                            'access_key': scope.access_key
                        }) > 0) {
                        scope.error_message = "Key already exists";
                        scope.has_error = true;
                    } else {

                        scope.buckets = ["Loading..."];
                        scope.selected_bucket = scope.buckets[0];
                        $q.when(nbClient.client.bucket.get_cloud_buckets({
                            access_key: scope.access_key,
                            secret_key: scope.secret_key
                        })).then(function(buckets_list) {
                            console.log('got list' + JSON.stringify(buckets_list));
                            scope.enable_new_key = false;
                            scope.error_message = '';
                            scope.has_error = false;

                            scope.buckets = _(['Choose Bucket for sync']).concat(buckets_list);
                            scope.selected_bucket = scope.buckets[0];

                        }).then(function() {

                            scope.accessKeys.push({
                                access_key: scope.access_key,
                                secret_key: scope.secret_key
                            });
                            return $q.when(nbClient.client.account.add_account_sync_credentials_cache({
                                access_key: scope.access_key,
                                secret_key: scope.secret_key
                            }));
                        }).then(function() {
                            console.log('done save');
                            scope.enable_new_key = false;
                            nbAlertify.success('Added AWS credentials to the cache!');
                            scope.selected_key = scope.accessKeys[scope.accessKeys.length - 1];
                            scope.select_key();
                        }).then(null, function(err) {
                            scope.error_message = err.message;
                            scope.has_error = true;

                        });
                    }
                } else {
                    scope.error_message = "Empty keys. Please enter access key and secret key.";
                    scope.has_error = true;
                }

            };
            scope.select_scheduling_unit = function() {
                if (scope.selected_scheduling_unit === 'Minutes') {
                    scope.interval_options = [15, 30, 45];
                } else {

                    if (scope.selected_scheduling_unit === 'Hours') {
                        scope.interval_options = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
                    } else { //Days
                        scope.interval_options = [1, 7, 30];
                    }
                }
                scope.selected_scheduling_interval = scope.interval_options[0];
            };
        }

        function add_new_bucket() {
            var scope = $rootScope.$new();
            scope.$location = $location;
            scope.has_error = false;
            scope.modal = nbModal({
                template: 'console/add_new_bucket.html',
                scope: scope,
            });
            scope.done = function() {
                console.log('name:' + scope.new_bucket_name);
                var bucket_name = scope.new_bucket_name.toLowerCase();
                var return_value = validate_bucket_name(bucket_name);
                if (return_value === "ok") {
                    $q.when(nbClient.client.bucket.create_bucket({
                        name: bucket_name,
                        tiering: [{
                            tier: 'default_tier'
                        }]
                    })).then(function() {
                        console.log('created new bucket');
                        scope.modal.modal('hide');
                        nbAlertify.success('Congrats! ' + bucket_name + ' bucket is ready');
                        reload_view();
                    }).then(null, function(err) {
                        scope.error_message = 'Error:' + err.message + ',' + err.stack;
                        scope.has_error = true;

                    });

                } else {
                    scope.error_message = return_value;
                    scope.has_error = true;
                }
            };
        }

        function check_is_IPv4(entry) {
            var blocks = entry.split(".");
            if (blocks.length === 4) {
                return blocks.every(function(block) {
                    return parseInt(block, 10) >= 0 && parseInt(block, 10) <= 255;
                });
            }
            return false;
        }

        //Copied from amazon java sdk
        function validate_bucket_name(bucket_name) {
            var error_message = '';
            if (bucket_name.length < 3 || bucket_name.length > 63) {
                error_message = ('The bucket name must be between 3 and 63 characters.');
                return error_message;
            }
            if (check_is_IPv4(bucket_name)) {
                return "Bucket name should not contain IP address";
            }
            var previous = '\0';

            for (var i = 0; i < bucket_name.length; ++i) {
                var next = bucket_name.charAt(i);
                if (next >= 'A' && next <= 'Z') {
                    return "Bucket name should not contain uppercase characters";
                }

                if (next === ' ' || next === '\t' || next === '\r' || next === '\n') {
                    return "Bucket name should not contain white space";
                }

                if (next === '.') {
                    if (previous === '\0') {
                        return "Bucket name should not begin with a period";
                    }
                    if (previous === '.') {
                        return "Bucket name should not contain two adjacent periods";
                    }
                    if (previous === '-') {
                        return "Bucket name should not contain dashes next to periods";
                    }
                } else if (next === '-') {
                    if (previous === '.') {
                        return "Bucket name should not contain dashes next to periods";
                    }
                } else if ((next < '0') || (next > '9' && next < 'a') || (next > 'z')) {

                    return "Bucket name should not contain '" + next + "'";
                }

                previous = next;
            }

            if (previous === '.' || previous === '-') {
                return "Bucket name should not end with '-' or '.'";
            }


            var bucket_exists = _.find(nbSystem.system.buckets, function(bucket) {
                return bucket.name === bucket_name;
            });
            if (bucket_exists) {
                error_message = ('The bucket already exists.');
                return error_message;
            }

            return "ok";

        }

        function reload_view(init_only) {
            return init_only ? nbSystem.init_system : nbSystem.reload_system();
        }
    }
]);



nb_console.controller('PoolViewCtrl', [
    '$scope', '$q', '$timeout', '$window', '$location', '$routeParams',
    'nbSystem', 'nbNodes', 'nbHashRouter', 'nbModal',
    function($scope, $q, $timeout, $window, $location, $routeParams,
        nbSystem, nbNodes, nbHashRouter, nbModal) {
        $scope.nav.active = 'pool';
        $scope.nav.reload_view = reload_view;
        $scope.nodes_num_pages = 0;
        $scope.nodes_page_size = 10;
        $scope.nodes_query = {};

        var pool_router = $scope.pool_router =
            nbHashRouter($scope)
            .when('overview', {
                templateUrl: 'console/pool_overview.html',
            })
            .when('nodes', {
                templateUrl: 'console/pool_nodes.html',
                pagination: true,
                reload: reload_nodes
            })
            .when('stats', {
                templateUrl: 'console/pool_stats.html',
            })
            .when('settings', {
                templateUrl: 'console/pool_settings.html',
            })
            .otherwise({
                redirectTo: 'overview'
            });

        reload_view(true);

        function reload_view(init_only) {
            return $q.when()
                .then(function() {
                    return init_only ? nbSystem.init_system : nbSystem.reload_system();
                })
                .then(function() {
                    $scope.pool = _.find(nbSystem.system.pools, function(pool) {
                        return pool.name === $routeParams.pool_name;
                    });
                    if (!$scope.pool) {
                        $location.path('/pools/');
                        return;
                    }
                    $scope.pie_chart = storage_pie_chart($scope, $scope.pool.storage);
                    pool_router.done();
                });
        }

        function reload_nodes(hash_query) {
            $scope.nodes_query = _.clone(hash_query);
            var query = {
                pool: [$scope.pool.name]
            };
            if ($scope.nodes_query.search) {
                query.name = $scope.nodes_query.search;
            }
            if ($scope.nodes_query.geo) {
                query.geolocation = $scope.nodes_query.geo;
            }
            if ($scope.nodes_query.state) {
                // online/offline
                query.state = $scope.nodes_query.state;
            }
            return nbNodes.list_nodes({
                query: query,
                skip: $scope.nodes_query.page * $scope.nodes_page_size,
                limit: $scope.nodes_page_size,
                pagination: true
            }).then(function(res) {
                $scope.nodes = res.nodes;
                set_number_of_nodes(res.total_count);
            });
        }

        function set_number_of_nodes(count) {
            $scope.nodes_num_pages = Math.ceil(
                count / $scope.nodes_page_size);
            $scope.nodes_pages = _.times(Math.min(15, $scope.nodes_num_pages), _.identity);
            pool_router.set_num_pages('nodes', $scope.nodes_num_pages);
        }

    }
]);



nb_console.controller('NodeViewCtrl', [
    '$scope', '$q', '$timeout', '$window', '$location', '$routeParams',
    'nbClient', 'nbSystem', 'nbNodes', 'nbHashRouter',
    function($scope, $q, $timeout, $window, $location, $routeParams,
        nbClient, nbSystem, nbNodes, nbHashRouter) {
        $scope.nav.active = 'pool';
        $scope.nav.reload_view = reload_view;
        $scope.parts_num_pages = 0;
        $scope.parts_page_size = 10;
        $scope.parts_query = {};

        var node_router = $scope.node_router =
            nbHashRouter($scope)
            .when('parts', {
                templateUrl: 'console/node_parts.html',
                pagination: true,
                reload: reload_parts
            })
            .when('properties', {
                templateUrl: 'console/node_properties.html',
            })
            .when('stats', {
                templateUrl: 'console/node_stats.html',
            })
            .when('settings', {
                templateUrl: 'console/node_settings.html',
            })
            .when('overview', {
                templateUrl: 'console/node_overview.html',
            })
            .otherwise({
                redirectTo: 'overview'
            });

        reload_view(true);

        function reload_view(init_only) {
            return $q.when()
                .then(function() {
                    return init_only ? nbSystem.init_system : nbSystem.reload_system();
                })
                .then(function() {
                    $scope.pool = _.find(nbSystem.system.pools, function(pool) {
                        return pool.name === $routeParams.pool_name;
                    });
                    if (!$scope.pool) {
                        $location.path('/pools/');
                        return;
                    }
                    return nbNodes.read_node($routeParams.node_name);
                })
                .then(function(node) {
                    $scope.node = node;
                    $scope.pie_chart = storage_pie_chart($scope, node.storage);

                    // TODO handle node parts pages
                    $scope.parts_num_pages = 9;
                    // Math.ceil($scope.bucket.num_objects / $scope.parts_page_size);
                    $scope.parts_pages = _.times(Math.min(15, $scope.parts_num_pages), _.identity);
                    node_router.set_num_pages('parts', $scope.parts_num_pages);
                    node_router.done();
                });
        }

        function reload_parts(hash_query) {
            $scope.parts_query = _.clone(hash_query);
            var query = {
                name: $routeParams.node_name,
                skip: $scope.parts_query.page * $scope.parts_page_size,
                limit: $scope.parts_page_size,
            };
            return $q.when(nbClient.client.node.read_node_maps(query))
                .then(function(res) {
                    $scope.parts = [];
                    _.each(res.objects, function(object) {
                        _.each(object.parts, function(part) {
                            // TODO handle parity frags
                            var frag_size = part.chunk.size / part.chunk.data_frags;
                            _.each(part.frags, function(fragment) {
                                fragment.start = part.start + (frag_size * fragment.frag);
                                fragment.size = frag_size;
                            });
                            part.file = object.key;
                            part.bucket = object.bucket;
                            $scope.parts.push(part);
                        });
                    });
                });
        }
    }
]);



nb_console.controller('BucketViewCtrl', [
    '$scope', '$q', '$timeout', '$window', '$location', '$routeParams',
    'nbSystem', 'nbFiles', 'nbHashRouter', 'nbModal',
    function($scope, $q, $timeout, $window, $location, $routeParams,
        nbSystem, nbFiles, nbHashRouter, nbModal) {
        $scope.nav.active = 'bucket';
        $scope.nav.reload_view = reload_view;
        $scope.upload = upload;
        $scope.files_num_pages = 0;
        $scope.files_page_size = 10;
        $scope.files_query = {};
        $scope.rest_server_information = rest_server_information;
        $scope.download_rest_server_package = download_rest_server_package;

        var bucket_router = $scope.bucket_router =
            nbHashRouter($scope)
            .when('files', {
                templateUrl: 'console/bucket_files.html',
                pagination: true,
                reload: reload_files
            })
            // .when('transfers', {
            // templateUrl: 'console/bucket_transfers.html',
            // })
            .when('stats', {
                templateUrl: 'console/bucket_stats.html',
            })
            .when('settings', {
                templateUrl: 'console/bucket_settings.html',
            })
            .when('tiering', {
                templateUrl: 'console/bucket_tiering.html',
            })
            .when('link', {
                templateUrl: 'console/bucket_link.html',
            })
            .when('overview', {
                templateUrl: 'console/bucket_overview.html',
            })
            .otherwise({
                redirectTo: 'overview'
            });

        reload_view(true);

        function reload_view(init_only) {
            return $q.when()
                .then(function() {
                    return init_only ? nbSystem.init_system : nbSystem.reload_system();
                })
                .then(function() {
                    nbFiles.set_access_keys(nbSystem.system.access_keys, nbSystem.system.web_port, nbSystem.system.ssl_port);
                    $scope.bucket = _.find(nbSystem.system.buckets, function(bucket) {
                        return bucket.name === $routeParams.bucket_name;
                    });
                    if (!$scope.bucket) {
                        $location.path('/bucket/');
                        return;
                    }
                    $scope.pie_chart = storage_pie_chart($scope, $scope.bucket.storage, 0.4);
                    bucket_router.done();
                });
        }

        function reload_files(hash_query) {
            $scope.files_query = _.clone(hash_query);
            console.log('$scope.files_query', $scope.files_query);
            var params = {
                bucket: $routeParams.bucket_name,
                skip: $scope.files_query.page * $scope.files_page_size,
                limit: $scope.files_page_size,
                pagination: true
            };
            if ($scope.files_query.search) {
                params.key_query = $scope.files_query.search;
            }
            return nbFiles.list_files(params)
                .then(function(res) {
                    $scope.files = res.files.map(function(f) {
                        f.escapedName = encodeURIComponent(f.name);
                        return f;
                    });

                    set_number_of_files(res.total_count);
                });
        }

        function set_number_of_files(count) {
            $scope.files_num_pages = Math.ceil(
                count / $scope.files_page_size);
            $scope.files_pages = _.times(Math.min(15, $scope.files_num_pages), _.identity);
            bucket_router.set_num_pages('files', $scope.files_num_pages);
        }

        function upload() {
            return nbFiles.upload_file($routeParams.bucket_name)
                .then(function() {
                    return reload_view();
                });
        }

        function rest_server_information() {
            var scope = $scope.$new();
            scope.access_keys = nbSystem.system.access_keys;
            var rest_host = ($window.location.host).replace(':' + nbSystem.system.web_port, '').replace(':' + nbSystem.system.ssl_port, ':443');
            console.log('SYS2:' + nbSystem.system.web_port + ' host:' + rest_host);

            scope.rest_endpoint = rest_host;
            scope.bucket_name = $routeParams.bucket_name;
            scope.rest_package = download_rest_server_package;
            console.log('rest_server_information', scope.rest_package, scope.rest_endpoint);
            console.log('rest_server_information', $window.location, $location);
            scope.modal = nbModal({
                template: 'console/rest_server_information.html',
                scope: scope,
            });
        }

        function download_rest_server_package() {
            console.log('rest_package2');
            var link = $window.document.createElement("a");
            link.download = '';
            link.href = nbSystem.system.web_links.s3rest_installer;
            $window.document.body.appendChild(link);
            link.click();
            return P.delay(2000).then(function() {
                $window.document.body.removeChild(link);
            });
        }

    }
]);



nb_console.controller('FileViewCtrl', [
    '$scope', '$q', '$timeout', '$window', '$location', '$routeParams', '$sce',
    'nbClient', 'nbSystem', 'nbFiles', 'nbNodes', 'nbHashRouter', 'nbModal', 'nbAlertify',
    function($scope, $q, $timeout, $window, $location, $routeParams, $sce,
        nbClient, nbSystem, nbFiles, nbNodes, nbHashRouter, nbModal, nbAlertify) {
        $scope.nav.active = 'bucket';
        $scope.nav.reload_view = reload_view;
        $scope.play = play;
        $scope.delete_file = delete_file;
        $scope.parts_num_pages = 0;
        $scope.parts_page_size = 10;
        $scope.parts_query = {};

        var file_router = $scope.file_router =
            nbHashRouter($scope)
            .when('parts', {
                templateUrl: 'console/file_parts.html',
                pagination: true,
                reload: reload_parts
            })
            .when('properties', {
                templateUrl: 'console/file_properties.html',
            })
            .when('stats', {
                templateUrl: 'console/file_stats.html',
            })
            .when('settings', {
                templateUrl: 'console/file_settings.html',
            })
            .when('link', {
                templateUrl: 'console/file_link.html',
            })
            .otherwise({
                redirectTo: 'parts'
            });

        reload_view(true);


        function reload_view(init_only) {
            return $q.when()
                .then(function() {
                    return init_only ? nbSystem.init_system : nbSystem.reload_system();
                })
                .then(function() {
                    //Setting access keys.
                    //TODO: consider separation to other object with only the keys
                    //      also, check better solution in terms of security.
                    nbFiles.set_access_keys(nbSystem.system.access_keys, nbSystem.system.web_port, nbSystem.system.ssl_port);

                    $scope.bucket = _.find(nbSystem.system.buckets, function(bucket) {
                        return bucket.name === $routeParams.bucket_name;
                    });
                    if (!$scope.bucket) {
                        $location.path('/bucket/');
                        return;
                    }
                    return nbFiles.get_file({
                        bucket: $routeParams.bucket_name,
                        key: $routeParams.file_name,
                    }, 'cache_miss');
                })
                .then(function(res) {
                    $scope.file = res;

                    //now we get s3 rest signed url
                    console.log('url', $scope.file.url, $sce.trustAsResourceUrl($scope.file.url));
                    $scope.file_url = $sce.trustAsResourceUrl($scope.file.url);

                    // TODO handle file parts pages
                    $scope.parts_num_pages = 9;
                    // Math.ceil($scope.bucket.num_objects / $scope.parts_page_size);
                    $scope.parts_pages = _.times(Math.min(15, $scope.parts_num_pages), _.identity);
                    file_router.set_num_pages('parts', $scope.parts_num_pages);
                    file_router.done();
                });
        }

        function reload_parts(hash_query) {
            if ($scope.deleted) {
                console.log('reload_parts: not loading for deleted file');
                return;
            }
            $scope.parts_query = _.clone(hash_query);
            var params = {
                bucket: $routeParams.bucket_name,
                key: $routeParams.file_name,
                skip: $scope.parts_query.page * $scope.parts_page_size,
                limit: $scope.parts_page_size,
                adminfo: true
            };
            return nbFiles.list_file_parts(params)
                .then(function(res) {
                    $scope.parts = res.parts;
                });
        }

        function play() {
            if ($scope.play_modal) {
                $scope.play_modal.modal('hide');
                $scope.play_modal = null;
            }
            $scope.play_modal = nbModal({
                template: 'console/file_play.html',
                size: 'lg',
                scope: $scope,
            });
        }

        function delete_file() {
            return nbAlertify.confirm('Really delete "' + $routeParams.file_name + '"?')
                .then(function() {
                    return nbFiles.delete_file($routeParams.bucket_name, $routeParams.file_name);
                })
                .then(function() {
                    $scope.deleted = true;
                    $timeout(function() {
                        $location.path('/bucket/' + $routeParams.bucket_name);
                        $location.hash('files');
                        nbAlertify.log('Deleted.');
                    }, 1);
                })
                .then(null, function(err) {
                    if (err.message === 'canceled') return;
                    throw err;
                });
        }

    }
]);


function storage_pie_chart($scope, storage, hole) {
    return {
        options: {
            is3D: false,
            legend: {
                position: 'bottom',
                // position: 'labeled',
                alignment: 'center',
                maxLines: 10,
                textStyle: {
                    color: '#eeeeee'
                }
            },
            backgroundColor: {
                fill: 'transparent',
            },
            tooltip: {
                showColorCode: true,
            },
            sliceVisibilityThreshold: 0,
            pieHole: hole || 0,
            pieSliceText: 'value',
            pieSliceTextStyle: {
                color: '#eeeeee'
            },
            slices: [{
                color: '#ff008b',
                // offset: 0.10
            }, {
                color: '#03a9f4',
            }, {
                color: '#666',
            }]
        },
        data: [
            ['Storage', 'Capacity'],
            ['NooBaa Usage', {
                v: storage.used,
                f: $scope.human_size(storage.used)
            }],
            ['OS Usage', {
                v: storage.used_os,
                f: $scope.human_size(storage.used_os)
            }],
            ['Free Space', {
                v: storage.free,
                f: $scope.human_size(storage.free)
            }],
        ]
    };
}
