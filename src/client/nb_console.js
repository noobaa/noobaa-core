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
        $compileProvider.imgSrcSanitizationWhitelist(/^\s*(blob):/);
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



nb_console.controller('OverviewCtrl', ['$scope', '$q', function($scope, $q) {
    $scope.nav.active = 'overview';
    $scope.nav.reload_view = reload_view;
    if (!$scope.nbSystem.system) {
        $scope.nbSystem.refresh_system()
            .then(function() {
                return $scope.nbNodes.refresh_node_groups();
            });
    } else {
        $scope.nbNodes.draw_nodes_map();
    }

    function reload_view() {
        return $q.all([
            $scope.nbSystem.refresh_system(),
            $scope.nbNodes.refresh_node_groups()
        ]);
    }
}]);



nb_console.controller('SystemResourceCtrl', ['$scope', '$q', function($scope, $q) {
    $scope.nav.active = 'resource';
    $scope.nav.reload_view = reload_view;
    if (!$scope.nbSystem.system) {
        reload_view();
    }

    function reload_view() {
        return $scope.nbSystem.refresh_system();
    }
}]);



nb_console.controller('SystemDataCtrl', ['$scope', '$q', function($scope, $q) {
    $scope.nav.active = 'data';
    $scope.nav.reload_view = reload_view;
    if (!$scope.nbSystem.system) {
        reload_view();
    }

    function reload_view() {
        return $scope.nbSystem.refresh_system();
    }
}]);



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
                redirectTo: 'nodes'
            });

        reload_view(true);

        function reload_view(init_only) {
            return $q.when()
                .then(function() {
                    if (init_only && nbSystem.system) return;
                    return nbSystem.refresh_system();
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
                    $scope.nodes_pages = _.times($scope.nodes_num_pages, _.identity);
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
    'nbSystem', 'nbNodes', 'nbHashRouter',
    function($scope, $q, $timeout, $window, $location, $routeParams,
        nbSystem, nbNodes, nbHashRouter) {
        $scope.nav.active = 'tier';
        $scope.nav.reload_view = reload_view;
        $scope.files_num_pages = 0;
        $scope.files_page_size = 10;
        $scope.files_query = {};

        var node_router = $scope.node_router =
            nbHashRouter($scope)
            .when('files', {
                templateUrl: 'console/node_files.html',
                pagination: true,
                reload: reload_files
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
            .otherwise({
                redirectTo: 'files'
            });

        reload_view(true);

        function reload_view(init_only) {
            return $q.when()
                .then(function() {
                    if (init_only && nbSystem.system) return;
                    return nbSystem.refresh_system();
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

                    // TODO handle node files list
                    /*
                    $scope.files_num_pages = Math.ceil(
                        $scope.tier.files.count / $scope.files_page_size);
                    $scope.files_pages = _.times($scope.files_num_pages, _.identity);
                    */
                    node_router.set_num_pages('files', $scope.files_num_pages);
                    node_router.done();
                });
        }

        function reload_files(hash_query) {
            $scope.files_query = _.clone(hash_query);
            var query = {
                tier: $routeParams.tier_name
            };
            if ($scope.files_query.search) {
                query.name = $scope.files_query.search;
            }
            /* TODO list node files
            return nbNodes.list_files({
                query: query,
                skip: $scope.files_query.page * $scope.files_page_size,
                limit: $scope.files_page_size,
            }).then(function(res) {
                $scope.files = res;
            });
            */
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
                    if (init_only && nbSystem.system) return;
                    return nbSystem.refresh_system();
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
                    $scope.files_pages = _.times($scope.files_num_pages, _.identity);
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
        $scope.goto_block = goto_block;
        $scope.download = download;
        $scope.play = play;
        $scope.parts_num_pages = 0;
        $scope.parts_page_size = 10;
        $scope.parts_query = {};
        $scope.download_url = $sce.trustAsResourceUrl(
            'http://localhost:5006/b/' +
            $routeParams.bucket_name + '/o/' +
            $routeParams.file_name + '?download=1');

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
                    if (init_only && nbSystem.system) return;
                    return nbSystem.refresh_system();
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
                    });
                })
                .then(function(res) {
                    $scope.file = res;

                    $scope.play_url = $sce.trustAsResourceUrl(
                        'http://localhost:5006/b/' +
                        $routeParams.bucket_name + '/' +
                        (/^video\//.test($scope.file.content_type) ? 'video/' : 'o/') +
                        $routeParams.file_name);

                    // TODO handle file parts list
                    $scope.parts_num_pages = 10;
                    // Math.ceil($scope.bucket.num_objects / $scope.parts_page_size);
                    $scope.parts_pages = _.times($scope.parts_num_pages, _.identity);
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
            };
            return nbFiles.list_file_parts(params)
                .then(function(res) {
                    $scope.parts = res.parts;
                });
        }

        function goto_block(block) {
            return nbNodes.lookup_node({
                    ip: block.node.ip,
                    port: block.node.port
                })
                .then(function(node) {
                    $location.path('/tier/' + node.tier + '/' + node.name);
                });
        }

        function download() {
            $window.location = $scope.download_url;
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
