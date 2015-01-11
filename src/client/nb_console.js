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
        $routeProvider
            .when('/overview', {
                templateUrl: 'console/overview.html',
            })
            .when('/tier', {
                templateUrl: 'console/tier_list.html',
            })
            .when('/tier/:tier_name', {
                templateUrl: 'console/tier_view.html',
            })
            .when('/tier/:tier_name/:node_name', {
                templateUrl: 'console/node_view.html',
            })
            .when('/bucket', {
                templateUrl: 'console/bucket_list.html',
            })
            .when('/bucket/:bucket_name', {
                templateUrl: 'console/bucket_view.html',
            })
            .when('/bucket/:bucket_name/:file_name', {
                templateUrl: 'console/file_view.html',
            })
            .otherwise({
                redirectTo: '/overview'
            });
    }
]);


nb_console.controller('ConsoleCtrl', [
    '$scope', '$http', '$q', '$window',
    'nbSystem', 'nbNodes', 'nbFiles',
    'nbAlertify', '$location', 'nbClient',
    function($scope, $http, $q, $window,
        nbSystem, nbNodes, nbFiles,
        nbAlertify, $location, nbClient) {

        $scope.nbClient = nbClient;
        $scope.nbSystem = nbSystem;
        $scope.nbNodes = nbNodes;
        $scope.nbFiles = nbFiles;
        $scope.nbAlertify = nbAlertify;

        $scope.nav = {
            active: 'overview',
            order: ['overview', 'tiers', 'buckets'],
            items: {
                overview: {
                    text: 'Overview',
                    href: 'overview',
                },
                tiers: {
                    text: 'Tiers',
                    href: 'tier',
                },
                buckets: {
                    text: 'Buckets',
                    href: 'bucket',
                }
            }
        };
    }
]);


nb_console.controller('OverviewCtrl', ['$scope', '$q', function($scope, $q) {
    $scope.nav.active = 'overview';
    $scope.nav.refresh_view = refresh_view;
    if (!$scope.nbSystem.system) {
        refresh_view();
    }

    function refresh_view() {
        return $q.all([
            $scope.nbSystem.refresh_system(),
            $scope.nbNodes.refresh_node_groups()
        ]);
    }
}]);

nb_console.controller('TierListCtrl', ['$scope', '$q', function($scope, $q) {
    $scope.nav.active = 'tiers';
    $scope.nav.refresh_view = refresh_view;
    if (!$scope.nbSystem.system) {
        refresh_view();
    }

    function refresh_view() {
        return $scope.nbSystem.refresh_system();
    }
}]);

nb_console.controller('TierViewCtrl', [
    '$scope', '$q', '$routeParams', 'nbSystem', 'nbNodes',
    function($scope, $q, $routeParams, nbSystem, nbNodes) {
        $scope.nav.active = 'tiers';
        $scope.nav.refresh_view = refresh_view;
        $scope.refresh_nodes = refresh_nodes;
        $scope.goto_nodes_page = goto_nodes_page;
        $scope.nodes_active_page = 0;
        $scope.nodes_page_size = 10;
        $scope.nodes_query = {};
        refresh_view(true);

        function refresh_view(init_only) {
            return $q.when()
                .then(function() {
                    if (init_only && nbSystem.system) return;
                    return nbSystem.refresh_system();
                })
                .then(function() {
                    $scope.tier = _.find(nbSystem.system.tiers, function(tier) {
                        return tier.name === $routeParams.tier_name;
                    });
                    $scope.nodes_count = $scope.tier.nodes.count;
                    $scope.nodes_num_pages = Math.ceil($scope.nodes_count / $scope.nodes_page_size);
                    $scope.nodes_pages = _.times($scope.nodes_num_pages, _.identity);
                });
        }

        function refresh_nodes() {
            var query = {
                tier: $scope.tier.name
            };
            if ($scope.nodes_query.search) {
                query.name = $scope.nodes_query.search;
            }
            return nbNodes.list_nodes({
                query: query,
                skip: $scope.nodes_active_page * $scope.nodes_page_size,
                limit: $scope.nodes_page_size,
            }).then(function(res) {
                $scope.nodes = res;
            });
        }

        function goto_nodes_page(page) {
            page = parseInt(page, 10);
            if (page < 0) {
                page = 0;
            }
            if (page >= $scope.nodes_num_pages) {
                page = $scope.nodes_num_pages - 1;
            }
            if ($scope.nodes_active_page !== page) {
                $scope.nodes_active_page = page;
                return refresh_nodes();
            }
        }
    }
]);

nb_console.controller('BucketListCtrl', ['$scope', '$q', function($scope, $q) {
    $scope.nav.active = 'buckets';
    $scope.nav.refresh_view = refresh_view;
    if (!$scope.nbSystem.system) {
        refresh_view();
    }

    function refresh_view() {
        return $scope.nbSystem.refresh_system();
    }
}]);

nb_console.controller('BucketViewCtrl', [
    '$scope', '$q', '$routeParams', 'nbSystem', 'nbFiles',
    function($scope, $q, $routeParams, nbSystem, nbFiles) {
        $scope.nav.active = 'buckets';
        $scope.nav.refresh_view = refresh_view;
        $scope.refresh_files = refresh_files;
        $scope.goto_files_page = goto_files_page;
        $scope.files_active_page = 0;
        $scope.files_page_size = 10;
        $scope.files_query = {};
        refresh_view(true);

        function refresh_view(init_only) {
            return $q.when()
                .then(function() {
                    if (init_only && nbSystem.system) return;
                    return nbSystem.refresh_system();
                })
                .then(function() {
                    $scope.bucket = _.find(nbSystem.system.buckets, function(bucket) {
                        return bucket.name === $routeParams.bucket_name;
                    });
                });
        }

        function refresh_files() {
            var params = {
                bucket: $scope.bucket.name,
                skip: $scope.files_active_page * $scope.files_page_size,
                limit: $scope.files_page_size,
            };
            if ($scope.files_query.search) {
                params.key = $scope.files_query.search;
            }
            return nbFiles.list_objects(params)
                .then(function(res) {
                    $scope.files = res;
                });
        }

        function goto_files_page(page) {
            page = parseInt(page, 10);
            if (page < 0) {
                page = 0;
            }
            if (page >= $scope.files_num_pages) {
                page = $scope.files_num_pages - 1;
            }
            if ($scope.files_active_page !== page) {
                $scope.files_active_page = page;
                return refresh_files();
            }
        }
    }
]);



///// TODO unused code -


nb_console.controller('NodesListCtrl', [
    '$scope', '$http', '$q', '$window', '$timeout', 'nbNodes', '$routeParams', '$location',
    function($scope, $http, $q, $window, $timeout, nbNodes, $routeParams, $location) {

        $scope.nav.active = 'nodes';

        $scope.refresh_view = refresh_view;
        $scope.open_node = open_node;
        $scope.select_node = select_node;
        $scope.is_selected_node = is_selected_node;
        $scope.prev_page = prev_page;
        $scope.next_page = next_page;
        $scope.toggle_node_started = toggle_node_started;
        $scope.add_nodes = add_nodes;
        $scope.geo = $routeParams.geo;
        $scope.skip = 0;
        $scope.limit = 10;
        $scope.nodes_count = 0;

        $scope.$watch('nbNodes.node_groups_by_geo', function() {
            if ($scope.geo && nbNodes.node_groups_by_geo) {
                $scope.geo_stats = nbNodes.node_groups_by_geo[$scope.geo];
                $scope.nodes_count = $scope.geo_stats.count;
            } else {
                $scope.nodes_count = nbNodes.nodes_count;
            }
        });

        $scope.refresh_view();


        function refresh_view() {
            return $q.all([
                nbNodes.refresh_node_groups($scope.geo),
                refresh_list(),
            ]);
        }

        function refresh_list() {
            var query = {};
            if ($scope.geo) {
                // the query takes a regexp string
                query.geolocation = '^' + $scope.geo + '$';
            }
            return nbNodes.list_nodes({
                query: query,
                skip: $scope.skip,
                limit: $scope.limit,
            }).then(
                function(nodes) {
                    $scope.nodes = nodes;
                }
            );
        }

        function open_node(node) {
            $location.path('nodes/n/' + node.name);
        }

        function select_node(node) {
            $scope.selected_node = node;
        }

        function is_selected_node(node) {
            return $scope.selected_node === node;
        }

        function prev_page() {
            $scope.skip -= $scope.limit;
            if ($scope.skip < 0) {
                $scope.skip = 0;
                return;
            }
            return refresh_list();
        }

        function next_page() {
            $scope.skip += $scope.limit;
            if ($scope.skip >= $scope.nodes_count) {
                $scope.skip -= $scope.limit;
                return;
            }
            return refresh_list();
        }

        function toggle_node_started(node) {
            if (node.started) {
                return nbNodes.stop_node(node).then(refresh_view);
            } else {
                return nbNodes.start_node(node).then(refresh_view);
            }
        }

        function add_nodes() {
            return nbNodes.add_nodes().then(refresh_view);
        }

    }
]);



nb_console.controller('NodeDetailsCtrl', [
    '$scope', '$http', '$q', '$window', '$timeout',
    'nbNodes', '$routeParams', '$location', 'nbAlertify',
    function($scope, $http, $q, $window, $timeout,
        nbNodes, $routeParams, $location, nbAlertify) {

        $scope.nav.active = 'nodes';

        $scope.node_name = $routeParams.name;
        $scope.refresh_view = refresh_view;
        $scope.start_node = start_node;
        $scope.stop_node = stop_node;
        $scope.refresh_view();

        function refresh_view() {
            return nbNodes.read_node($scope.node_name).then(
                function(node) {
                    $scope.node = node;
                },
                function(err) {
                    if (err.status === 404) {
                        nbAlertify.error('node not found...');
                        $location.path('nodes/');
                        return;
                    }
                    throw err;
                }
            );
        }

        function start_node(node) {
            return nbNodes.start_node(node).then(refresh_view);
        }

        function stop_node(node) {
            return nbNodes.stop_node(node).then(refresh_view);
        }
    }
]);
