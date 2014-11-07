/* global angular */
'use strict';

var _ = require('lodash');
var util = require('util');
var moment = require('moment');
var size_utils = require('../util/size_utils');
var mgmt_api = require('../api/mgmt_api');
var edge_node_api = require('../api/edge_node_api');

var mgmt_client = new mgmt_api.Client({
    path: '/api/mgmt_api/',
});
var edge_node_client = new edge_node_api.Client({
    path: '/api/edge_node_api/',
});

var ng_app = angular.module('ng_app');


ng_app.controller('NodesCtrl', [
    '$scope', '$http', '$q', '$window', '$timeout',
    function($scope, $http, $q, $window, $timeout) {
        $scope.nav.crumbs = [{
            text: 'Nodes',
            href: 'nodes',
            active: true,
        }];

        $scope.nbNodes.refresh_nodes();

        $scope.click_node = function(node) {

        };
    }
]);



ng_app.factory('nbNodes', [
    '$q', '$timeout', 'nbGoogle', '$window', '$rootScope', '$location', 'nbAlertify', 'nbModal',
    function($q, $timeout, nbGoogle, $window, $rootScope, $location, nbAlertify, nbModal) {
        var $scope = {};
        $scope.refresh_nodes = refresh_nodes;
        $scope.add_nodes = add_nodes;
        $scope.remove_node = remove_node;
        $scope.click_node_status = click_node_status;
        $scope.start_agent = start_agent;
        $scope.stop_agent = stop_agent;
        $scope.reset_nodes = reset_nodes;
        $scope.detailed_nodes = {};

        load_node_vendors();
        refresh_nodes();

        function refresh_nodes() {
            if ($scope.refreshing) {
                return;
            }
            $scope.refreshing = true;
            return $q.when(edge_node_client.list_nodes()).then(
                function(res) {
                    console.log('NODES', res);
                    $scope.nodes = res.nodes;
                    $scope.nodes_by_geo = _.groupBy($scope.nodes, 'geolocation');
                    update_detailed_nodes();
                    nbGoogle.then(draw_nodes_map);
                    return $timeout(function() {
                        $scope.refreshing = false;
                    }, 500);
                }
            );
        }

        function load_node_vendors(force) {
            if ($scope.node_vendors && $scope.node_vendors.length && force !== 'force') {
                return;
            }
            return $q.when(edge_node_client.get_node_vendors()).then(
                function(res) {
                    $scope.node_vendors = res.vendors;
                    $scope.node_vendors_by_id = _.indexBy(res.vendors, 'id');
                    console.log('NODE VENDORS', $scope.node_vendors);
                }
            );
        }

        function add_nodes() {
            $q.when(load_node_vendors()).then(
                function() {
                    if (!$scope.node_vendors || !$scope.node_vendors.length) {
                        nbAlertify.alert(
                            'In order to add nodes you need to ' +
                            'setup node-vendors for your account. ' +
                            'Please seek professional help.');
                        return;
                    }
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
                    scope.num_created = 0;
                    scope.add_nodes = function() {
                        console.log('ADD NODES');
                        if (!scope.count || !scope.selected_vendor.id || !scope.allocate_gb) {
                            return;
                        }
                        var node_name_to_number = function(node) {
                            return Number(node.name) || 0;
                        };
                        var max_node = _.max($scope.nodes, node_name_to_number);
                        var next_node_name = max_node ? (node_name_to_number(max_node) + 1) : 0;
                        scope.num_created = 0;
                        return $q.all(_.times(scope.count, function(i) {
                            return $q.when(edge_node_client.create_node({
                                name: '' + (next_node_name + i),
                                geolocation: _.sample([
                                    'United States', 'Germany', 'China',
                                    'Israel', 'Brazil', 'Canada', 'Korea'
                                ]),
                                allocated_storage: scope.allocate_gb * size_utils.GIGABYTE,
                                vendor: scope.selected_vendor.id,
                            })).then(function() {
                                scope.num_created += 1;
                            });
                        })).then(refresh_nodes);
                    };
                    scope.run = function() {
                        return $q.when(scope.add_nodes()).then(
                            function() {
                                scope.modal.modal('hide');
                            },
                            function(err) {
                                nbAlertify.error(err);
                            }
                        );
                    };
                    scope.modal = nbModal({
                        template: 'add_nodes_dialog.html',
                        scope: scope,
                    });
                }
            );
        }

        function remove_node(node) {
            nbAlertify.confirm('Really remove node ' +
                node.name + ' @ ' + node.geolocation + ' ?').then(
                function() {
                    $q.when(edge_node_client.delete_node({
                        name: node.name
                    })).then(refresh_nodes);
                }
            );
        }

        function click_node_status(node) {
            node.get_status_running = true;
            return $q.when(edge_node_client.get_agents_status({
                nodes: [node.name]
            })).then(
                function(res) {
                    console.log('get_agents_status', res);
                    node.is_online = res.nodes[0].status;
                    node.get_status_running = false;
                },
                function(err) {
                    node.get_status_running = false;
                }
            );
        }

        function start_agent(node) {
            return $q.when(edge_node_client.start_agents({
                nodes: [node.name]
            })).then(refresh_nodes);
        }

        function stop_agent(node) {
            return $q.when(edge_node_client.stop_agents({
                nodes: [node.name]
            })).then(refresh_nodes);
        }

        function reset_nodes() {
            nbAlertify.confirm('Really reset nodes?').then(
                function() {
                    nbAlertify.log('TODO');
                    // $q.when(mgmt_client.reset_nodes()).then(refresh_nodes);
                    return;
                }
            );
        }


        function update_detailed_nodes() {
            $scope.detailed_nodes.nodes = $scope.nodes_by_geo[$scope.detailed_nodes.geo];
        }

        function draw_nodes_map(google) {
            var element = $window.document.getElementById('nodes_map');
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
            _.each($scope.nodes_by_geo, function(nodes, geo) {
                var geo_alloc = 0;
                _.each(nodes, function(node) {
                    geo_alloc += node.allocated_storage;
                });
                if (geo_alloc > max_alloc) {
                    max_alloc = geo_alloc;
                }
                if (geo_alloc < min_alloc) {
                    min_alloc = geo_alloc;
                }
                if (nodes.length > max_num_nodes) {
                    max_num_nodes = nodes.length;
                }
                if (nodes.length < min_num_nodes) {
                    min_num_nodes = nodes.length;
                }
                data.addRow([geo, {
                    v: geo_alloc,
                    f: $rootScope.human_size(geo_alloc)
                }, nodes.length]);
            });
            var options = {
                displayMode: 'markers',
                enableRegionInteractivity: true,
                keepAspectRatio: true,
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
            };
            var chart = new google.visualization.GeoChart(element);
            google.visualization.events.addListener(chart, 'select', function() {
                var selection = chart.getSelection();
                $scope.detailed_nodes.geo = data.getValue(selection[0].row, 0);
                update_detailed_nodes();
                if (selection.length) {
                    $location.path('nodes');
                }
                $rootScope.safe_apply();
            });
            chart.draw(data, options);
        }

        return $scope;
    }
]);
