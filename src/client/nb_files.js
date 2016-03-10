/* global angular */
'use strict';

var _ = require('lodash');
var moment = require('moment');
var AWS = require('aws-sdk');
var nb_api = angular.module('nb_api');


nb_api.factory('nbFiles', [
    '$http', '$q', '$window', '$timeout', '$sce', 'nbAlertify', '$rootScope', 'nbClient', '$location', 'nbSystem',
    function($http, $q, $window, $timeout, $sce, nbAlertify, $rootScope, nbClient, $location, nbSystem) {
        var $scope = {};

        $scope.list_files = list_files;
        $scope.get_file = get_file;
        $scope.list_file_parts = list_file_parts;
        $scope.create_bucket = create_bucket;
        $scope.upload_file = upload_file;
        $scope.clear_upload = clear_upload;
        $scope.set_access_keys = set_access_keys;
        $scope.delete_file = delete_file;

        $scope.uploads = [];
        $scope.transfers = [];
        $scope.s3 = null;
        $scope.web_port = 0;
        $scope.ssl_port = 0;
        // call first time with empty keys to initialize s3
        set_access_keys();

        angular.element($window).on('beforeunload', function() {
            var num_uploads = 0;
            var num_downloads = 0;
            _.each($scope.transfers, function(tx) {
                if (tx.running) {
                    if (tx.type === 'upload') {
                        num_uploads += 1;
                    } else {
                        num_downloads += 1;
                    }
                }
            });
            var warning = 'Leaving this page will interrupt the transfers';
            if (num_uploads && num_downloads) {
                return 'Uploads and Downloads are in progress. ' + warning;
            } else if (num_uploads) {
                return 'Uploads are in progress. ' + warning;
            } else if (num_downloads) {
                return 'Downloads are in progress. ' + warning;
            }
        });

        //update access keys.
        //TODO: find more secured approach
        function set_access_keys(access_keys, web_port, ssl_port) {
            $scope.web_port = web_port;
            $scope.ssl_port = ssl_port;
            if (!_.isEmpty(access_keys)) {
                AWS.config.update({
                    accessKeyId: access_keys[0].access_key,
                    secretAccessKey: access_keys[0].secret_key,
                    sslEnabled: false
                });
                console.log('updated keys', access_keys[0].access_key, $location);
            }
            /*
            //TODO: move to ssl. disable certificate validation.
            var ep = new AWS.Endpoint({
                protocol: 'http',
                port: 80,
                hostname: '127.0.0.1'
            });
            */
            //var access_key_id = 'd36e02598bf347148752';
            //var secret_access_key = 'f25cd46a-e105-4518-ac75-0d033745b4e1';

            // var rest_port = 80;
            // var rest_ssl_port = 443;
            // var http_endpoint = 'http://127.0.0.1' +
            //     (rest_port ? ':' + rest_port : '')+'/s3';
            // var https_endpoint = 'https://127.0.0.1' +
            //     (rest_ssl_port ? ':' + rest_ssl_port : '')+'/s3';
            //var rest_host = ($window.location.host).replace(':'+web_port,'').replace(':'+ssl_port,':443');
            var rest_host = ($window.location.host).replace(':' + web_port, '').replace(':' + ssl_port, '');

            console.log('SYS1:' + web_port + ' host:' + rest_host);

            var rest_endpoint = $window.location.protocol + '//' + rest_host;
            rest_endpoint = rest_endpoint.replace('https', 'http');
            console.log('win:', $window.location, ":", rest_endpoint);
            $scope.s3 = new AWS.S3({
                // endpoint: $window.location.protocol === 'https:' ?
                //     https_endpoint : http_endpoint,
                endpoint: rest_endpoint,
                s3ForcePathStyle: true,
                sslEnabled: false,

            });
        }

        function list_files(params) {
            return $q.when()
                .then(function() {
                    return nbClient.client.object.list_objects(params);
                })
                .then(function(res) {
                    var files = _.map(res.objects, make_file_info);
                    console.log('FILES', res);
                    return {
                        total_count: res.total_count,
                        files: files,
                    };
                });
        }

        function get_file(params) {
            return $q.when()
                .then(function() {
                    return nbClient.client.object.read_object_md(params);
                })
                .then(function(res) {
                    console.log('FILE', res, params.key);
                    var file_info = make_file_info({
                        key: params.key,
                        info: res
                    });

                    var url = $scope.s3.getSignedUrl('getObject', {
                        Bucket: params.bucket,
                        Key: params.key
                    });
                    url = url.replace(':' + $scope.web_port, '').replace(':' + $scope.ssl_port, ':443');

                    console.log('urlll:', url);
                    file_info.url = url;
                    return file_info;
                });
        }

        function make_file_info(obj) {
            var file = obj.info;
            file.create_time = moment(new Date(file.create_time));
            file.name = obj.key;
            return file;
        }

        function list_file_parts(params) {
            return $q.when()
                .then(function() {
                    return nbClient.client.object.read_object_mappings(params);
                })
                .then(function(res) {
                    _.each(res.parts, function(part) {
                        // TODO handle parity frags
                        var frag_size = part.chunk.size / part.chunk.data_frags;
                        _.each(part.chunk.frags, function(fragment) {
                            fragment.start = part.start + (frag_size * fragment.frag);
                            fragment.size = frag_size;
                        });
                    });
                    console.log('LIST FILE PARTS', res);
                    return res;
                });
        }

        function create_bucket() {
            return nbAlertify.prompt('Enter name for new bucket')
                .then(function(str) {
                    if (!str) return;
                    return $q.when(nbClient.client.object.create_bucket({
                        bucket: str
                    }));
                });
        }

        function upload_file(bucket_name) {
            return input_file_chooser()
                .then(function(file) {
                    if (!file) return;
                    return run_upload(file, bucket_name);
                });
        }

        function input_file_chooser() {
            return $q(function(resolve, reject) {
                var chooser = angular.element('<input type="file">');
                chooser.on('change', function(e) {
                    var file = e.target.files[0];
                    resolve(file);
                });
                chooser.click();
            });
        }

        function run_upload(input_file, bucket_name, use_object_client) {
            var ext_match = input_file.name.match(/^(.*)(\.[^\.]*)$/);
            var serial = (((Date.now() / 1000) % 10000000) | 0).toString();
            var tx = {
                type: 'upload',
                input_file: input_file,
                bucket: bucket_name,
                name: ext_match ?
                    (ext_match[1] + '_' + serial + ext_match[2]) : (input_file.name + '_' + serial),
                size: input_file.size,
                content_type: input_file.type,
                start_time: Date.now(),
                progress: 0,
                running: true,
            };
            console.log('upload', tx);

            tx.promise = $q(function(resolve, reject, notify) {
                console.log('starting');
                // var s3req =
                $scope.s3.upload({
                    Key: tx.name,
                    Bucket: tx.bucket,
                    Body: tx.input_file,
                    ContentType: tx.content_type
                }, {
                    partSize: 10 * 1024 * 1024,
                    queueSize: 10
                }, function(err, data) {
                    if (err) {
                        console.error('upload failed (s3)', err, err.stack);
                        _.pull($scope.transfers, tx);
                        tx.error = err;
                        tx.running = false;
                        nbAlertify.error('upload failed (s3). ' + err.toString());
                        reject(new Error('upload failed'));
                        $rootScope.safe_apply();
                    } else {
                        // Success!
                        console.log('upload done!!!!');
                        _.pull($scope.transfers, tx);
                        tx.done = true;
                        tx.progress = 100;
                        tx.running = false;
                        tx.end_time = Date.now();
                        var duration = (tx.end_time - tx.start_time) / 1000;
                        var elapsed = duration.toFixed(1) + 'sec';
                        var speed = $rootScope.human_size(tx.size / duration) + '/sec';
                        console.log('upload completed', elapsed, speed);
                        nbAlertify.success('upload completed');
                        resolve();
                        $rootScope.safe_apply();
                    }
                }).on('httpUploadProgress', function(progress) {
                    // Log Progress Information
                    console.log(Math.round(progress.loaded / progress.total * 100) + '% done');
                    console.log('prog info');
                    // var pos = progress.loaded && progress.total || 0;
                    tx.progress = Math.round(progress.loaded / progress.total * 100);
                    $rootScope.safe_apply();
                });

            });

            $scope.uploads.push(tx);
            $scope.transfers.push(tx);
            return tx.promise;
        }

        function clear_upload(tx) {
            _.pull($scope.uploads, tx);
        }

        function delete_file(bucket, key) {
            return $q(function(resolve, reject, notify) {
                $scope.s3.deleteObject({
                    Bucket: bucket,
                    Key: key
                }, function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(err);
                    }
                });
            });
        }

        return $scope;
    }
]);
