/* global angular */
'use strict';

var _ = require('lodash');
var Q = require('q');
var moment = require('moment');
var size_utils = require('../util/size_utils');
var api = require('../api');

var nb_api = angular.module('nb_api');

nb_api.factory('nbNodes', [
    '$q', '$timeout', 'nbGoogle', '$window', '$rootScope',
    '$location', 'nbAlertify', 'nbModal', 'nbClient', 'nbSystem',
    function($q, $timeout, nbGoogle, $window, $rootScope,
        $location, nbAlertify, nbModal, nbClient, nbSystem) {
        var $scope = {};
        $scope.refresh_node_groups = refresh_node_groups;
        $scope.draw_nodes_map = draw_nodes_map;
        $scope.list_nodes = list_nodes;
        $scope.read_node = read_node;
        $scope.goto_node_by_block = goto_node_by_block;
        $scope.reconnect_node = reconnect_node;
        $scope.disable_node = disable_node;
        $scope.decommission_node = decommission_node;
        $scope.remove_node = remove_node;
        $scope.self_test = self_test;


        function refresh_node_groups(selected_geo) {
            return $q.when()
                .then(function() {
                    return nbClient.client.node.group_nodes({
                        group_by: {
                            geolocation: true
                        }
                    });
                })
                .then(function(res) {
                    console.log('NODE GROUPS', res);
                    $scope.node_groups = res.groups;
                    $scope.node_groups_by_geo = _.indexBy(res.groups, 'geolocation');
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
                    return draw_nodes_map(selected_geo);
                });
        }

        function list_nodes(params) {
            return $q.when()
                .then(function() {
                    return nbClient.client.node.list_nodes(params);
                })
                .then(function(res) {
                    console.log('NODES', res);
                    var nodes = res.nodes;
                    _.each(nodes, extend_node_info);
                    return nodes;
                });
        }

        function read_node(name) {
            return $q.when()
                .then(function() {
                    return nbClient.client.node.read_node({
                        name: name
                    });
                })
                .then(function(res) {
                    console.log('READ NODE', res);
                    var node = res;
                    extend_node_info(node);
                    return node;
                });
        }

        function goto_node_by_block(block) {
            var path = '/tier/' + block.details.tier_name + '/' + block.details.node_name;
            console.log('goto', path);
            $location.path(path);
            $location.hash('');
        }

        function extend_node_info(node) {
            node.hearbeat_moment = moment(new Date(node.heartbeat));
            node.usage_percent = 100 * node.storage.used / node.storage.alloc;
        }

        function update_srvmode(node, srvmode) {
            return $q.when()
                .then(function() {
                    return nbClient.client.node.update_node({
                        name: node.name,
                        srvmode: srvmode
                    });
                });
        }

        function reconnect_node(node) {
            return update_srvmode(node, 'connect')
                .then(function() {
                    delete node.srvmode;
                });
        }

        function disable_node(node) {
            return update_srvmode(node, 'disabled')
                .then(function() {
                    node.srvmode = 'disabled';
                });
        }

        function decommission_node(node) {
            return update_srvmode(node, 'decommissioning')
                .then(function() {
                    node.srvmode = 'decommissioning';
                });
        }

        function remove_node(node) {
            return nbAlertify.confirm('Really remove node ' +
                node.name + ' @ ' + node.geolocation + ' ?').then(
                function() {
                    return $q.when(nbClient.client.node.delete_node({
                        name: node.name
                    })).then(refresh_node_groups);
                }
            );
        }

        function self_test(node, options) {
            return list_nodes({
                    limit: 10
                })
                .then(function(nodes) {
                    return _.reduce(nodes, function(promise, target_node) {
                        return promise.then(function() {
                            console.log('SELF TEST', node.name, 'to', target_node.name);
                            var node_host = 'http://' + node.host + ':' + node.port;
                            var target_host = 'http://' + target_node.host + ':' + target_node.port;

                            var agent = new api.agent_api.Client();
                            agent.options.set_address(node_host);
                            agent.options.set_peer(node.peer_id);
                            agent.options.set_p2p_context(nbClient.client.p2p_context);

                            var timestamp = Date.now();
                            return agent.self_test_peer({
                                    target: {
                                        id: target_node.id,
                                        host: target_host,
                                        peer: target_node.peer_id
                                    },
                                    request_length: 100 * 1024,
                                    response_length: 100 * 1024,
                                })
                                .then(function() {
                                    var elapsed = Date.now() - timestamp;
                                    console.log('SELF TEST TOOK', elapsed / 1000, 'sec');
                                }, function(err) {
                                    console.error('SELF TEST FAILED', err);
                                });
                        });
                    }, Q.resolve());
                })
                .then(function() {
                    nbAlertify.log('Self test completed :)');
                }, function(err) {
                    nbAlertify.error('Self test failed :(');
                });
        }



        function draw_nodes_map(selected_geo, google) {
            if (!google) {
                return nbGoogle.then(function(google) {
                    return draw_nodes_map(selected_geo, google);
                });
            }
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
            data.addColumn('number', 'Capacity');
            data.addColumn('number', 'Nodes');
            var selected_row = -1;
            _.each($scope.node_groups, function(stat, index) {
                if (stat.geolocation === selected_geo) {
                    selected_row = index;
                }
                if (stat.storage.alloc > max_alloc) {
                    max_alloc = stat.storage.alloc;
                }
                if (stat.storage.alloc < min_alloc) {
                    min_alloc = stat.storage.alloc;
                }
                if (stat.count > max_num_nodes) {
                    max_num_nodes = stat.count;
                }
                if (stat.count < min_num_nodes) {
                    min_num_nodes = stat.count;
                }
                data.addRow([stat.geolocation, {
                    v: stat.storage.alloc,
                    f: $rootScope.human_size(stat.storage.alloc)
                }, stat.count]);
                console.log(stat, min_alloc, max_alloc);
            });
            var options = {
                displayMode: 'markers',
                enableRegionInteractivity: true,
                keepAspectRatio: true,
                backgroundColor: 'transparent',
                datalessRegionColor: '#283136', // darker than body bg
                // datalessRegionColor: '#cfd8dc', // blue-grey-100
                // datalessRegionColor: '#b2dfdb', // teal-100
                // datalessRegionColor: '#10312D', // ~teal
                colorAxis: {
                    // colors: ['#fff176', '#ffee58'], // yellow 300-400
                    // colors: ['#909688', '#009688'], // teal
                    // colors: ['#F9FFF4', '#76FF00'], // greens
                    // colors: ['#EC407A', '#E91E63'], // pink 400-500
                    colors: ['#7e57c2', '#673ab7'], // deep-purple 400-500
                    // colors: ['#00bcd4', '#00acc1'], // cyan 400-500
                    minValue: min_alloc,
                    maxValue: max_alloc,
                },
                sizeAxis: {
                    minSize: 10,
                    maxSize: 12,
                    minValue: min_num_nodes,
                    maxValue: max_num_nodes,
                },
                legend: 'none' || {
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
