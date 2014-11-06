/* global angular, alertify */
'use strict';

var _ = require('lodash');
var util = require('util');
var moment = require('moment');
var size_utils = require('../util/size_utils');
var mgmt_api = require('../api/mgmt_api');
var edge_node_api = require('../api/edge_node_api');
var ObjectClient = require('../api/object_client');
var file_reader_stream = require('filereader-stream');

var mgmt_client = new mgmt_api.Client({
    path: '/api/mgmt_api/',
});
var edge_node_client = new edge_node_api.Client({
    path: '/api/edge_node_api/',
});
var object_client = new ObjectClient({
    path: '/api/object_api/',
});



var ng_app = angular.module('ng_app', [
    'ng_util',
    'ngRoute',
    'ngCookies',
    'ngAnimate',
    'ngSanitize',
    'ngTouch',
]);

ng_app.config(['$routeProvider', '$locationProvider',
    function($routeProvider, $locationProvider) {
        $locationProvider.html5Mode(true);
        $routeProvider.when('/', {
            templateUrl: 'status.html',
        }).when('/nodes', {
            templateUrl: 'nodes.html',
        }).when('/files', {
            templateUrl: 'files.html',
        }).otherwise({
            redirectTo: '/'
        });
    }
]);


ng_app.controller('AppCtrl', [
    '$scope', '$http', '$q', '$window', 'nbMgmt', 'nbNodes', 'nbFiles',
    function($scope, $http, $q, $window, nbMgmt, nbNodes, nbFiles) {
        $scope.nbMgmt = nbMgmt;
        $scope.nbNodes = nbNodes;
        $scope.nbFiles = nbFiles;

        $scope.nav = {
            root: '/app/'
        };
    }
]);


ng_app.controller('StatusCtrl', [
    '$scope', '$http', '$q', '$window', '$timeout',
    function($scope, $http, $q, $window, $timeout) {
        $scope.nav.crumbs = [];
        $scope.nbMgmt.refresh_status();
        $scope.nbNodes.refresh_nodes();
    }
]);


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


ng_app.factory('nbMgmt', [
    '$q', '$timeout',
    function($q, $timeout) {
        var $scope = {};
        $scope.refresh_status = refresh_status;
        refresh_status();

        function refresh_status() {
            if ($scope.refreshing) {
                return;
            }
            $scope.refreshing = true;
            return $q.when(mgmt_client.system_stats()).then(
                function(res) {
                    console.log('STATS', res);
                    $scope.stats = res;
                    return $timeout(function() {
                        $scope.refreshing = false;
                    }, 500);
                }
            );
        }

        return $scope;
    }
]);


ng_app.factory('nbNodes', [
    '$q', '$timeout', 'nbGoogle', '$window', '$rootScope', '$location',
    function($q, $timeout, nbGoogle, $window, $rootScope, $location) {
        var $scope = {};
        $scope.refresh_nodes = refresh_nodes;
        $scope.add_nodes = add_nodes;
        $scope.remove_node = remove_node;
        $scope.start_agent = start_agent;
        $scope.stop_agent = stop_agent;
        $scope.reset_nodes = reset_nodes;
        $scope.detailed_nodes = {};

        get_node_vendors();
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

        function get_node_vendors() {
            return $q.when(edge_node_client.get_node_vendors()).then(
                function(res) {
                    console.log('NODE VENDORS', res.vendors);
                    $scope.node_vendors_by_id = _.indexBy(res.vendors, 'id');
                    $scope.node_vendors_by_kind = _.groupBy(res.vendors, 'kind');
                    var center = $scope.node_vendors_by_kind['noobaa-center'];
                    if (center && center[0]) {
                        $scope.noobaa_center_vendor_id = center[0].id;
                    }
                }
            );
        }

        function add_nodes() {
            alertify.prompt('Enter number of nodes', function(e, res) {
                if (!e) {
                    return;
                }
                var count = Number(res);
                if (!count) {
                    return;
                }
                var node_name_to_number = function(node) {
                    return Number(node.name) || 0;
                };
                var max_node = _.max($scope.nodes, node_name_to_number);
                var next_node_name = max_node ? (node_name_to_number(max_node) + 1) : 0;
                $q.all(_.times(count, function(i) {
                    return $q.when(edge_node_client.create_node({
                        name: '' + (next_node_name + i),
                        geolocation: _.sample([
                            'United States', 'Germany', 'China',
                            'Israel', 'Brazil', 'Canada', 'Korea'
                        ]),
                        allocated_storage: size_utils.GIGABYTE,
                        vendor: $scope.noobaa_center_vendor_id,
                    }));
                })).then(refresh_nodes);
            }, '10');
        }

        function remove_node(node) {
            alertify.confirm('Really remove node ' +
                node.name + ' @ ' + node.geolocation + ' ?',
                function(e) {
                    if (!e) {
                        return;
                    }
                    $q.when(edge_node_client.delete_node({
                        name: node.name
                    })).then(refresh_nodes);
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
            alertify.confirm('Really reset nodes?', function(e) {
                if (!e) {
                    return;
                }
                alertify.log('TODO');
                // $q.when(mgmt_client.reset_nodes()).then(refresh_nodes);
                return;
            });
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
            data.addColumn('number', 'Allocated');
            data.addColumn('number', 'Count');
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
                backgroundColor: '#70c0ee',
                datalessRegionColor: '#cccccc',
                colorAxis: {
                    colors: ['gray', 'lime'],
                    minValue: Number(min_alloc),
                    maxValue: Number(max_alloc),
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


ng_app.factory('nbFiles', [

    function() {
        var $scope = {};
        return $scope;
    }
]);




ng_app.controller('FilesCtrl', [
    '$scope', '$http', '$q', '$window', '$timeout',
    function($scope, $http, $q, $window, $timeout) {

        $scope.nav.crumbs = [{
            text: 'Files',
            href: 'files',
            active: true,
        }];

        $scope.click_upload = click_upload;
        $scope.load_bucket_objects = load_bucket_objects;
        $scope.click_bucket = click_bucket;
        $scope.create_bucket = create_bucket;
        $scope.load_buckets = load_buckets;

        load_buckets();

        function play_video_file() {
            var ms = new $window.MediaSource();
            var video = $window.document.querySelector('video');
            video.src = $window.URL.createObjectURL(ms);
            ms.addEventListener('sourceopen', function(e) {
                var sourceBuffer = ms.addSourceBuffer('video/webm; codecs="vorbis,vp8"');
                // sourceBuffer.appendBuffer(oneVideoWebMChunk);
            }, false);
        }

        function upload_file(file, bucket) {
            console.log('upload', file);
            var object_path = {
                bucket: bucket.name,
                key: file.name
            };
            $q.when(object_client.create_multipart_upload(
                _.defaults(object_path, {
                    size: file.size
                })
            )).then(
                function() {
                    var defer = $q.defer();
                    var write_stream = object_client.open_write_stream(object_path);
                    var stream = file_reader_stream(file).pipe(write_stream);
                    stream.once('finish', defer.resolve);
                    stream.once('error', defer.reject);
                    return defer.promise;
                }
            ).then(
                function() {
                    return object_client.complete_multipart_upload(object_path);
                }
            ).then(
                function() {
                    alertify.log('upload completed');
                    return load_bucket_objects(bucket);
                }
            ).then(null,
                function(err) {
                    alertify.error('upload failed. ' + err.toString());
                }
            );
        }

        function click_upload() {
            if (!$scope.curr_bucket) {
                return;
            }
            var bucket = $scope.curr_bucket;
            var chooser = angular.element('<input type="file">');
            chooser.on('change', function(e) {
                var file = e.target.files[0];
                upload_file(file, bucket);
            });
            chooser.click();
        }

        function load_bucket_objects(bucket) {
            return $q.when(object_client.list_bucket_objects({
                bucket: bucket.name
            })).then(
                function(res) {
                    console.log('load_bucket_objects', bucket.name, res);
                    bucket.objects = res.objects;
                }
            );
        }

        function click_bucket(bucket) {
            $scope.curr_bucket = bucket;
            load_bucket_objects(bucket);
        }

        function create_bucket() {
            alertify.prompt('Enter name for new bucket', function(e, str) {
                if (!e) {
                    return;
                }
                $q.when(object_client.create_bucket({
                    bucket: str
                })).then(load_buckets);
            });
        }

        function load_buckets() {
            return $q.when(object_client.list_buckets()).then(
                function(res) {
                    $scope.buckets = res.buckets;
                }
            );
        }

    }
]);
