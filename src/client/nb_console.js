/* global angular */
'use strict';

var _ = require('lodash');

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
            .when('/resource', {
                templateUrl: 'console/resource_view.html',
                reloadOnSearch: false,
            })
            .when('/data', {
                templateUrl: 'console/data_view.html',
                reloadOnSearch: false,
            })
            .when('/tier/:tier_name', {
                templateUrl: 'console/tier_view.html',
                reloadOnSearch: false,
            })
            .when('/tier/:tier_name/:node_name', {
                templateUrl: 'console/node_view.html',
                reloadOnSearch: false,
            })
            .when('/bucket/:bucket_name', {
                templateUrl: 'console/bucket_view.html',
                reloadOnSearch: false,
            })
            .when('/bucket/:bucket_name/:file_name', {
                templateUrl: 'console/file_view.html',
                reloadOnSearch: false,
            })
            .when('/support', {
                templateUrl: 'console/support.html',
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

        $scope.nav = {
            active: 'overview',
        };
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
            return nbSystem.init_system
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
            scope.create = function() {
                return $q.when(nbClient.client.account.create_account({
                    name: scope.name,
                    email: scope.email,
                    password: scope.password
                })).then(reload_accounts);
            };
            scope.modal = nbModal({
                template: 'console/account_create_dialog.html',
                scope: scope,
            });
        }
    }
]);



nb_console.controller('OverviewCtrl', [
    '$scope', '$q', '$location', '$timeout',
    function($scope, $q, $location, $timeout) {
        $scope.nav.active = 'overview';
        $scope.nav.reload_view = reload_view;
        $scope.upload = upload;
        $scope.add_node = add_node;

        return $scope.nbSystem.init_system
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

        function add_node() {
            var tier_name = $scope.nbSystem.system.tiers[0].name;
            $location.path('tier/' + tier_name);
        }
    }
]);



nb_console.controller('SystemResourceCtrl', [
    '$scope', '$q', 'nbSystem',
    function($scope, $q, nbSystem) {
        $scope.nav.active = 'resource';
        $scope.nav.reload_view = reload_view;

        reload_view(true);

        function reload_view(init_only) {
            return init_only ? nbSystem.init_system : nbSystem.reload_system();
        }
    }
]);



nb_console.controller('SystemDataCtrl', [
    '$scope', '$q', 'nbSystem',
    function($scope, $q, nbSystem) {
        $scope.nav.active = 'data';
        $scope.nav.reload_view = reload_view;

        reload_view(true);

        function reload_view(init_only) {
            return init_only ? nbSystem.init_system : nbSystem.reload_system();
        }
    }
]);



nb_console.controller('TierViewCtrl', [
    '$scope', '$q', '$timeout', '$window', '$location', '$routeParams',
    'nbSystem', 'nbNodes', 'nbHashRouter',
    function($scope, $q, $timeout, $window, $location, $routeParams,
        nbSystem, nbNodes, nbHashRouter) {
        $scope.nav.active = 'tier';
        $scope.nav.reload_view = reload_view;
        $scope.nodes_num_pages = 0;
        $scope.nodes_page_size = 10;
        $scope.nodes_query = {};

        var tier_router = $scope.tier_router =
            nbHashRouter($scope)
            .when('overview', {
                templateUrl: 'console/tier_overview.html',
            })
            .when('nodes', {
                templateUrl: 'console/tier_nodes.html',
                pagination: true,
                reload: reload_nodes
            })
            .when('stats', {
                templateUrl: 'console/tier_stats.html',
            })
            .when('settings', {
                templateUrl: 'console/tier_settings.html',
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
                    $scope.tier = _.find(nbSystem.system.tiers, function(tier) {
                        return tier.name === $routeParams.tier_name;
                    });
                    if (!$scope.tier) {
                        $location.path('/tier/');
                        return;
                    }
                    $scope.nodes_num_pages = Math.ceil(
                        $scope.tier.nodes.count / $scope.nodes_page_size);
                    $scope.nodes_pages = _.times(Math.min(15, $scope.nodes_num_pages), _.identity);
                    tier_router.set_num_pages('nodes', $scope.nodes_num_pages);
                    tier_router.done();
                });
        }

        function reload_nodes(hash_query) {
            $scope.nodes_query = _.clone(hash_query);
            var query = {
                tier: $routeParams.tier_name
            };
            if ($scope.nodes_query.search) {
                query.name = $scope.nodes_query.search;
            }
            return nbNodes.list_nodes({
                query: query,
                skip: $scope.nodes_query.page * $scope.nodes_page_size,
                limit: $scope.nodes_page_size,
            }).then(function(res) {
                $scope.nodes = res;
            });
        }
    }
]);



nb_console.controller('NodeViewCtrl', [
    '$scope', '$q', '$timeout', '$window', '$location', '$routeParams',
    'nbClient', 'nbSystem', 'nbNodes', 'nbHashRouter',
    function($scope, $q, $timeout, $window, $location, $routeParams,
        nbClient, nbSystem, nbNodes, nbHashRouter) {
        $scope.nav.active = 'tier';
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
                    $scope.tier = _.find(nbSystem.system.tiers, function(tier) {
                        return tier.name === $routeParams.tier_name;
                    });
                    if (!$scope.tier) {
                        $location.path('/tier/');
                        return;
                    }
                    return nbNodes.read_node($routeParams.node_name);
                })
                .then(function(res) {
                    $scope.node = res;
                    $scope.my_host = 'http://' + $scope.node.ip + ':' + $scope.node.port;

                    var used = $scope.node.storage.used;
                    var unused = $scope.node.storage.alloc - used;
                    var operating_sys = 4 * 1024 * 1024 * 1024;
                    var free_disk = 100 * 1024 * 1024 * 1024;
                    $scope.pie_chart = {
                        options: {
                            is3D: true,
                            legend: {
                                position: 'right',
                                alignment: 'start',
                                maxLines: 10,
                                textStyle: {
                                    color: 'white'
                                }
                            },
                            backgroundColor: {
                                fill: 'transparent',
                            },
                            sliceVisibilityThreshold: 0,
                            slices: [{
                                color: '#03a9f4'
                            }, {
                                color: '#ff008b'
                            }, {
                                color: '#ffa0d3'
                            }, {
                                color: '#81d4fa'
                            }]
                        },
                        data: [
                            ['Storage', 'Capacity'],
                            ['Operating system', {
                                v: operating_sys,
                                f: $scope.human_size(operating_sys)
                            }],
                            ['Noobaa used', {
                                v: used,
                                f: $scope.human_size(used)
                            }],
                            ['Noobaa unused', {
                                v: unused,
                                f: $scope.human_size(unused)
                            }],
                            ['Free disk', {
                                v: free_disk,
                                f: $scope.human_size(free_disk)
                            }],
                        ]
                    };

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
                            var frag_size = part.chunk_size / part.kfrag;
                            _.each(part.fragments, function(fragment, fragment_index) {
                                fragment.start = part.start + (frag_size * fragment_index);
                                fragment.size = frag_size;
                            });
                            part.file = object.key;
                            $scope.parts.push(part);
                        });
                    });
                });
        }
    }
]);



nb_console.controller('BucketViewCtrl', [
    '$scope', '$q', '$timeout', '$window', '$location', '$routeParams',
    'nbSystem', 'nbFiles', 'nbHashRouter',
    function($scope, $q, $timeout, $window, $location, $routeParams,
        nbSystem, nbFiles, nbHashRouter) {
        $scope.nav.active = 'bucket';
        $scope.nav.reload_view = reload_view;
        $scope.upload = upload;
        $scope.files_num_pages = 0;
        $scope.files_page_size = 10;
        $scope.files_query = {};

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
            .otherwise({
                redirectTo: 'files'
            });

        reload_view(true);

        function reload_view(init_only) {
            return $q.when()
                .then(function() {
                    return init_only ? nbSystem.init_system : nbSystem.reload_system();
                })
                .then(function() {
                    $scope.bucket = _.find(nbSystem.system.buckets, function(bucket) {
                        return bucket.name === $routeParams.bucket_name;
                    });
                    if (!$scope.bucket) {
                        $location.path('/bucket/');
                        return;
                    }
                    $scope.files_num_pages = Math.ceil(
                        $scope.bucket.num_objects / $scope.files_page_size);
                    $scope.files_pages = _.times(Math.min(15, $scope.files_num_pages), _.identity);
                    bucket_router.set_num_pages('files', $scope.files_num_pages);
                    bucket_router.done();
                });
        }

        function reload_files(hash_query) {
            $scope.files_query = _.clone(hash_query);
            var params = {
                bucket: $routeParams.bucket_name,
                skip: $scope.files_query.page * $scope.files_page_size,
                limit: $scope.files_page_size,
            };
            if ($scope.files_query.search) {
                params.key = $scope.files_query.search;
            }
            return nbFiles.list_files(params)
                .then(function(res) {
                    $scope.files = res;
                });
        }

        function upload() {
            return nbFiles.upload_file($routeParams.bucket_name);
        }
    }
]);



nb_console.controller('FileViewCtrl', [
    '$scope', '$q', '$timeout', '$window', '$location', '$routeParams', '$sce',
    'nbClient', 'nbSystem', 'nbFiles', 'nbNodes', 'nbHashRouter', 'nbModal',
    function($scope, $q, $timeout, $window, $location, $routeParams, $sce,
        nbClient, nbSystem, nbFiles, nbNodes, nbHashRouter, nbModal) {
        $scope.nav.active = 'bucket';
        $scope.nav.reload_view = reload_view;
        $scope.download = download;
        $scope.play = play;
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

                    $scope.download_url = $sce.trustAsResourceUrl(
                        'http://localhost:5006/b/' +
                        $routeParams.bucket_name + '/o/' +
                        $routeParams.file_name + '?download=1');
                    $scope.play_url = $sce.trustAsResourceUrl(
                        'http://localhost:5006/b/' +
                        $routeParams.bucket_name + '/' +
                        (/^video\//.test($scope.file.content_type) ? 'video/' : 'o/') +
                        $routeParams.file_name);

                    // TODO handle file parts pages
                    $scope.parts_num_pages = 9;
                    // Math.ceil($scope.bucket.num_objects / $scope.parts_page_size);
                    $scope.parts_pages = _.times(Math.min(15, $scope.parts_num_pages), _.identity);
                    file_router.set_num_pages('parts', $scope.parts_num_pages);
                    file_router.done();
                });
        }

        function reload_parts(hash_query) {
            $scope.parts_query = _.clone(hash_query);
            var params = {
                bucket: $routeParams.bucket_name,
                key: $routeParams.file_name,
                skip: $scope.parts_query.page * $scope.parts_page_size,
                limit: $scope.parts_page_size,
                details: true
            };
            return nbFiles.list_file_parts(params)
                .then(function(res) {
                    $scope.parts = res.parts;
                });
        }

        function download() {
            return nbFiles.download_file($routeParams.bucket_name, $scope.file)
                .then(function(tx) {
                    $scope.dl = tx;
                    tx.promise.then(null, function() {
                        $scope.dl = null;
                    });
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

    }
]);
