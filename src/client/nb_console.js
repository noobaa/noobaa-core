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
            .when('/tier/:tier_name/:node_id', {
                templateUrl: 'console/node_view.html',
            })
            .when('/bucket', {
                templateUrl: 'console/bucket_list.html',
            })
            .when('/bucket/:bucket_name', {
                templateUrl: 'console/bucket_view.html',
            })
            .when('/bucket/:bucket_name/:file_id', {
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
    '$scope', '$q', '$routeParams',
    function($scope, $q, $routeParams) {
        $scope.nav.active = 'tiers';
        $scope.nav.refresh_view = refresh_view;
        refresh_view(true);

        function refresh_view(init_only) {
            return $q.when()
                .then(function() {
                    if (init_only && $scope.nbSystem.system) return;
                    return $scope.nbSystem.refresh_system();
                })
                .then(function() {
                    $scope.tier = _.find($scope.nbSystem.system.tiers, function(tier) {
                        return tier.name === $routeParams.tier_name;
                    });
                });
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

nb_console.controller('BucketViewCtrl', ['$scope', '$q', function($scope, $q) {
    $scope.nav.active = 'buckets';
    $scope.nav.refresh_view = refresh_view;
    if (!$scope.nbSystem.system) {
        refresh_view();
    }

    function refresh_view() {
        return $scope.nbSystem.refresh_system();
    }
}]);


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
