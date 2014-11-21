/* global angular */
'use strict';

var _ = require('lodash');
var util = require('util');
var moment = require('moment');
var size_utils = require('../util/size_utils');
var edge_node_api = require('../api/edge_node_api');

var edge_node_client = new edge_node_api.Client({
    path: '/api/edge_node_api/',
});

var nb_app = angular.module('nb_app');


nb_app.controller('NodesListCtrl', [
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

        $scope.$watch('nbNodes.nodes_stats_by_geo', function() {
            if ($scope.geo && nbNodes.nodes_stats_by_geo) {
                $scope.geo_stats = nbNodes.nodes_stats_by_geo[$scope.geo];
                $scope.nodes_count = $scope.geo_stats.count;
            } else {
                $scope.nodes_count = nbNodes.nodes_count;
            }
        });

        $scope.refresh_view();


        function refresh_view() {
            return $q.all([
                nbNodes.refresh_nodes_stats($scope.geo),
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



nb_app.controller('NodeDetailsCtrl', [
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



nb_app.factory('nbNodes', [
    '$q', '$timeout', 'nbGoogle', '$window', '$rootScope', '$location', 'nbAlertify', 'nbModal',
    function($q, $timeout, nbGoogle, $window, $rootScope, $location, nbAlertify, nbModal) {
        var $scope = {};
        $scope.refresh_nodes_stats = refresh_nodes_stats;
        $scope.list_nodes = list_nodes;
        $scope.read_node = read_node;
        $scope.add_nodes = add_nodes;
        $scope.remove_node = remove_node;
        $scope.start_node = start_node;
        $scope.stop_node = stop_node;


        function refresh_nodes_stats(selected_geo) {
            return $q.when(load_node_vendors()).then(
                function() {
                    return edge_node_client.nodes_stats({
                        group_by: {
                            geolocation: true
                        }
                    });
                }
            ).then(
                function(res) {
                    console.log('NODES STATS', res);
                    $scope.nodes_stats = res.groups;
                    $scope.nodes_stats_by_geo = _.indexBy(res.groups, 'geolocation');
                    $scope.nodes_count = _.reduce(res.groups, function(sum, g) {
                        return sum + g.count;
                    }, 0);
                    if (res.groups.length) {
                        $scope.has_nodes = true;
                        $scope.has_no_nodes = false;
                    } else {
                        $scope.has_nodes = false;
                        $scope.has_no_nodes = true;
                    }
                    return nbGoogle.then(function(google) {
                        return draw_nodes_stats_map(google, selected_geo);
                    });
                }
            );
        }

        function list_nodes(params) {
            return $q.when(load_node_vendors()).then(
                function() {
                    return edge_node_client.list_nodes(params);
                }
            ).then(
                function(res) {
                    console.log('NODES', res);
                    var nodes = res.nodes;
                    _.each(nodes, extend_node_info);
                    return nodes;
                }
            );
        }

        function load_node_vendors() {
            return $q.when(edge_node_client.get_node_vendors()).then(
                function(res) {
                    $scope.node_vendors = res.vendors;
                    $scope.node_vendors_by_id = _.indexBy(res.vendors, 'id');
                    console.log('NODE VENDORS', $scope.node_vendors);
                }
            );
        }

        function read_node(name) {
            return $q.when(load_node_vendors()).then(
                function() {
                    return edge_node_client.read_node({
                        name: name
                    });
                }
            ).then(
                function(res) {
                    console.log('READ NODE', res);
                    var node = res;
                    extend_node_info(node);
                    return node;
                }
            );
        }

        function extend_node_info(node) {
            node.hearbeat_moment = moment(new Date(node.heartbeat));
            node.usage_percent = 100 * node.used_storage / node.allocated_storage;
            node.vendor = $scope.node_vendors_by_id[node.vendor];
        }

        function add_nodes(loaded_vendors) {
            if (!loaded_vendors) {
                return $q.when(load_node_vendors()).then(function() {
                    // call myself again with true to skip loading again
                    return add_nodes(true);
                });
            }
            if (!$scope.node_vendors || !$scope.node_vendors.length) {
                nbAlertify.alert(
                    'In order to add nodes you need to ' +
                    'setup node-vendors for your account. ' +
                    'Please seek professional help.');
                return;
            }

            // make a scope for the modal
            var scope = $rootScope.$new();
            scope.count = 1;
            scope.node_vendors = $scope.node_vendors;
            scope.selected_vendor = $scope.node_vendors[0];
            scope.allocate_gb = 1;

            // in order to allow input[type=range] and input[type=number]
            // to work together, we need to convert the value from string to number
            // because type=range uses strings and type=number does not accept strings.
            Object.defineProperty(scope, 'allocate_gb_str', {
                enumerable: true,
                get: function() {
                    return scope.allocate_gb;
                },
                set: function(val) {
                    scope.allocate_gb = parseInt(val);
                }
            });

            scope.add_nodes = function() {
                console.log('ADD NODES');
                if (typeof(scope.count) !== 'number' ||
                    scope.count < 1 || scope.count > 100) {
                    throw 'Number of nodes should be a number in range 1-100';
                }
                if (typeof(scope.allocate_gb) !== 'number' ||
                    scope.allocate_gb < 1 || scope.allocate_gb > 100) {
                    throw 'Gigabyte per node should be a number in range 1-100';
                }
                if (!scope.selected_vendor.id) {
                    throw 'Missing selection where to run on';
                }
                var next_node_name = $scope.nodes_count + 1;
                var num_created = 0;
                // using manual defer in order to report progress to the ladda button
                var defer = $q.defer();
                $q.all(_.times(scope.count, function(i) {
                    return $q.when(edge_node_client.create_node({
                        name: '' + (next_node_name + i),
                        // TODO these sample geolocations are just for testing
                        geolocation: _.sample([
                            'United States', 'Canada', 'Brazil', 'Mexico',
                            'China', 'Japan', 'Korea', 'India', 'Australia',
                            'Israel', 'Romania', 'Russia',
                            'Germany', 'England', 'France', 'Spain',
                        ]),
                        allocated_storage: scope.allocate_gb * size_utils.GIGABYTE,
                        vendor: scope.selected_vendor.id,
                    })).then(function() {
                        num_created += 1;
                        defer.notify(num_created / scope.count);
                    });
                })).then(refresh_nodes_stats).then(defer.resolve, defer.reject);
                return defer.promise;
            };

            var defer = $q.defer();

            scope.run = function() {
                return $q.when(true,
                    function() {
                        return scope.add_nodes();
                    }
                ).then(
                    function() {
                        nbAlertify.success('The deed is done');
                        scope.modal.modal('hide');
                        defer.resolve();
                    },
                    function(err) {
                        nbAlertify.error(err.data || err.message || err.toString());
                        defer.reject(err);
                    }
                );
            };

            scope.modal = nbModal({
                template: 'add_nodes_dialog.html',
                scope: scope,
            });

            // this promise is a bit fishy, we only resolve/reject it if the
            // modal is run (which can even be multiple times) and we don't
            // do anything if the modal is just closed.
            // this is fine as long as we only need it as a notification for refreshing
            // after the nodes were added.
            return defer.promise;
        }


        function remove_node(node) {
            return nbAlertify.confirm('Really remove node ' +
                node.name + ' @ ' + node.geolocation + ' ?').then(
                function() {
                    return $q.when(edge_node_client.delete_node({
                        name: node.name
                    })).then(refresh_nodes_stats);
                }
            );
        }


        function start_node(node) {
            return $q.when(edge_node_client.start_nodes({
                nodes: [node.name]
            }));
        }

        function stop_node(node) {
            return $q.when(edge_node_client.stop_nodes({
                nodes: [node.name]
            }));
        }


        function draw_nodes_stats_map(google, selected_geo) {
            var element = $window.document.getElementById('nodes_stats_map');
            if (!element) {
                return;
            }
            var min_alloc = Infinity;
            var max_alloc = -Infinity;
            var min_num_nodes = Infinity;
            var max_num_nodes = -Infinity;
            var data = new google.visualization.DataTable();
            data.addColumn('string', 'Location');
            data.addColumn('number', 'Storage Capacity');
            data.addColumn('number', 'Number of Nodes');
            var selected_row = -1;
            _.each($scope.nodes_stats, function(stat, index) {
                if (stat.geolocation === selected_geo) {
                    selected_row = index;
                }
                if (stat.allocated_storage > max_alloc) {
                    max_alloc = stat.allocated_storage;
                }
                if (stat.allocated_storage < min_alloc) {
                    min_alloc = stat.allocated_storage;
                }
                if (stat.count > max_num_nodes) {
                    max_num_nodes = stat.count;
                }
                if (stat.count < min_num_nodes) {
                    min_num_nodes = stat.count;
                }
                data.addRow([stat.geolocation, {
                    v: stat.allocated_storage,
                    f: $rootScope.human_size(stat.allocated_storage)
                }, stat.count]);
            });
            var options = {
                displayMode: 'markers',
                enableRegionInteractivity: true,
                keepAspectRatio: false,
                backgroundColor: '#3a455f',
                datalessRegionColor: '#272e3f',
                colorAxis: {
                    colors: ['#F9FFF4', '76FF00'],
                    minValue: min_alloc,
                    maxValue: max_alloc,
                },
                sizeAxis: {
                    minSize: 12,
                    maxSize: 20,
                    minValue: min_num_nodes,
                    maxValue: max_num_nodes,
                },
                legend: {
                    textStyle: {
                        color: 'black',
                        fontSize: 16
                    }
                },
                magnifyingGlass: {
                    enable: false,
                    zoomFactor: 10
                },
                tooltip: {
                    trigger: 'both' // 'focus' / 'selection'
                },
            };
            var chart = new google.visualization.GeoChart(element);
            google.visualization.events.addListener(chart, 'ready', function() {
                if (selected_row >= 0) {
                    chart.setSelection([{
                        row: selected_row,
                        column: null,
                    }]);
                }
            });
            google.visualization.events.addListener(chart, 'select', function() {
                var selection = chart.getSelection();
                if (selection[0]) {
                    var geo = data.getValue(selection[0].row, 0);
                    $location.path('nodes/geo/' + geo);
                } else {
                    $location.path('nodes');
                }
                $rootScope.safe_apply();
            });
            chart.draw(data, options);
        }

        return $scope;
    }
]);
