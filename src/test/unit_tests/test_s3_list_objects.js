/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup();

const _ = require('lodash');
const util = require('util');
const mocha = require('mocha');

const P = require('../../util/promise');
const ObjectIO = require('../../sdk/object_io');
const promise_utils = require('../../util/promise_utils');

mocha.describe('s3_list_objects', function() {

    const { rpc_client } = coretest;
    let object_io = new ObjectIO();
    object_io.set_verification_mode();

    const BKT = 'first.bucket'; // the default bucket name

    let files_without_folders_to_upload = [];
    let folders_to_upload = [];
    let files_in_folders_to_upload = [];
    let files_in_utf_diff_delimiter = [];
    let max_keys_objects = [];
    let files_in_multipart_folders_to_upload = [];
    let same_multipart_file1 = [];
    let same_multipart_file2 = [];
    let small_folder_with_multipart = [];

    var i = 0;
    for (i = 0; i < 264; i++) {
        folders_to_upload.push(`folder${i}/`);
    }
    for (i = 0; i < 264; i++) {
        files_in_folders_to_upload.push(`folder1/file${i}`);
    }
    for (i = 0; i < 264; i++) {
        files_without_folders_to_upload.push(`file_without_folder${i}`);
    }
    for (i = 0; i < 264; i++) {
        files_in_utf_diff_delimiter.push(`תיקיה#קובץ${i}`);
    }
    for (i = 0; i < 2604; i++) {
        max_keys_objects.push(`max_keys_test${i}`);
    }
    for (i = 0; i < 264; i++) {
        files_in_multipart_folders_to_upload.push(`multipart/file${i}`);
    }
    for (i = 0; i < 10; i++) {
        same_multipart_file1.push(`multipart1`);
    }
    for (i = 0; i < 10; i++) {
        same_multipart_file2.push(`multipart3`);
    }
    for (i = 0; i < 10; i++) {
        small_folder_with_multipart.push(`multipart2/file${i}`);
    }

    mocha.it('general use case', function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(10 * 60 * 1000);

        return run_case(_.concat(folders_to_upload,
                files_in_folders_to_upload,
                files_without_folders_to_upload,
                files_in_utf_diff_delimiter
            ),
            function(server_upload_response) {
                // Uploading zero size objects from the key arrays that were provided
                return P.resolve()
                    .then(function() {
                        return rpc_client.object.list_objects_s3({
                                bucket: BKT,
                                delimiter: '#',
                            })
                            .then(function(list_reply) {
                                // We should get the folder names in common_prefixes
                                // And we should get the objects without folders inside objects
                                // Also we check that the response is not truncated
                                if (!(list_reply &&
                                        _.difference(['תיקיה#'], list_reply.common_prefixes).length === 0 &&
                                        _.difference(_.concat(folders_to_upload,
                                                files_in_folders_to_upload,
                                                files_without_folders_to_upload),
                                            _.map(list_reply.objects, obj => obj.key)).length === 0 &&
                                        is_sorted_array(list_reply.objects) &&
                                        is_sorted_array(list_reply.common_prefixes) &&
                                        !list_reply.is_truncated)) {
                                    throw new Error(`Delimiter Test Failed! Got list: ${util.inspect(list_reply)}
                                            Wanted list: ${_.concat(folders_to_upload, files_in_folders_to_upload,
                                                files_without_folders_to_upload)},תיקיה#`);
                                }
                            });
                    })
                    .then(function() {
                        return rpc_client.object.list_objects_s3({
                                bucket: BKT,
                                delimiter: '/',
                                prefix: 'folder'
                            })
                            .then(function(list_reply) {
                                // In case we don't fully spell the name of the common prefix
                                // We should get all the common prefixes that begin with that prefix
                                if (!(list_reply &&
                                        _.difference(folders_to_upload, list_reply.common_prefixes).length === 0 &&
                                        list_reply.objects.length === 0 &&
                                        is_sorted_array(list_reply.objects) &&
                                        is_sorted_array(list_reply.common_prefixes) &&
                                        !list_reply.is_truncated)) {
                                    throw new Error(`Partial Prefix Failed! Got list: ${util.inspect(list_reply)}
                            Wanted list: ${folders_to_upload}`);
                                }
                            });
                    })
                    .then(function() {
                        return rpc_client.object.list_objects_s3({
                                bucket: BKT,
                                delimiter: '/',
                            })
                            .then(function(list_reply) {
                                // We should get the folder names in common_prefixes
                                // And we should get the objects without folders inside objects
                                // Also we check that the response is not truncated
                                if (!(list_reply &&
                                        _.difference(folders_to_upload, list_reply.common_prefixes).length === 0 &&
                                        _.difference(files_without_folders_to_upload,
                                            _.map(list_reply.objects, obj => obj.key)).length === 0 &&
                                        is_sorted_array(list_reply.objects) &&
                                        is_sorted_array(list_reply.common_prefixes) &&
                                        !list_reply.is_truncated)) {
                                    throw new Error(`Delimiter Test Failed! Got list: ${util.inspect(list_reply)}
                                Wanted list: ${folders_to_upload}, ${files_without_folders_to_upload}`);
                                }
                            });
                    })
                    .then(function() {
                        return rpc_client.object.list_objects_s3({
                                bucket: BKT,
                                delimiter: '/',
                                prefix: 'folder1/'
                            })
                            .then(function(list_reply) {
                                // We should get nothing in common_prefixes
                                // And we should get the objects inside folder1 in objects
                                // Also we check that the response is not truncated
                                if (!(list_reply &&
                                        list_reply.common_prefixes.length === 0 &&
                                        _.difference(files_in_folders_to_upload,
                                            _.map(list_reply.objects, obj => obj.key)).length === 0 &&
                                        is_sorted_array(list_reply.objects) &&
                                        is_sorted_array(list_reply.common_prefixes) &&
                                        !list_reply.is_truncated)) {
                                    throw new Error(`Folder Test Failed! Got list: ${util.inspect(list_reply)}
                                Wanted list: ${files_in_folders_to_upload}`);
                                }
                            });
                    })
                    .then(function() {
                        return rpc_client.object.list_objects_s3({
                                bucket: BKT,
                                delimiter: '/',
                                limit: 5
                            })
                            .then(function(list_reply) {
                                // Should be like the first check, but because of limit 5 we should only
                                // Receive the first 5 files without folders under root and not all the folders
                                // Which means that the common_prefixes should be zero, and only 5 objects
                                // This tests the sorting algorithm of the response, and also the max-keys limit
                                if (!(list_reply &&
                                        list_reply.common_prefixes.length === 0 &&
                                        _.difference([
                                                'file_without_folder0',
                                                'file_without_folder1',
                                                'file_without_folder10',
                                                'file_without_folder100',
                                                'file_without_folder101',
                                            ],
                                            _.map(list_reply.objects, obj => obj.key)).length === 0 &&
                                        is_sorted_array(list_reply.objects) &&
                                        is_sorted_array(list_reply.common_prefixes) &&
                                        list_reply.is_truncated)) {
                                    throw new Error(`Limit Test Failed! Got list: ${util.inspect(list_reply)}
                                Wanted list: ${files_without_folders_to_upload.slice(0, 5)}`);
                                }
                            });
                    })
                    .then(function() {
                        return rpc_client.object.list_objects_s3({
                                bucket: BKT,
                                prefix: 'file_without',
                            })
                            .then(function(list_reply) {
                                // Should be like the first check, but because of limit 5 we should only
                                // Receive the first 5 files without folders under root and not all the folders
                                // Which means that the common_prefixes should be zero, and only 5 objects
                                // This tests the sorting algorithm of the response, and also the max-keys limit
                                if (!(list_reply &&
                                        list_reply.common_prefixes.length === 0 &&
                                        _.difference(files_without_folders_to_upload,
                                            _.map(list_reply.objects, obj => obj.key)).length === 0 &&
                                        is_sorted_array(list_reply.objects) &&
                                        is_sorted_array(list_reply.common_prefixes) &&
                                        !list_reply.is_truncated)) {
                                    throw new Error(`Limit Test Failed! Got list: ${util.inspect(list_reply)}
                                Wanted list: ${files_without_folders_to_upload.slice(0, 5)}`);
                                }
                            });
                    })
                    .then(function() {
                        return rpc_client.object.list_objects_s3({
                                bucket: BKT,
                                prefix: 'file_without_folder0',
                            })
                            .then(function(list_reply) {
                                // Checking that we return object that complies fully to the prefix and don't skip it
                                // This test was added after Issue #2600
                                if (!(list_reply &&
                                        list_reply.common_prefixes.length === 0 &&
                                        _.isEqual([files_without_folders_to_upload[0]],
                                            _.map(list_reply.objects, obj => obj.key)) &&
                                        is_sorted_array(list_reply.objects) &&
                                        is_sorted_array(list_reply.common_prefixes) &&
                                        !list_reply.is_truncated)) {
                                    throw new Error(`Limit Test Failed! Got list: ${util.inspect(list_reply)}
                                        Wanted list: ${files_without_folders_to_upload[0]}`);
                                }
                            });
                    })
                    .then(function() {
                        return rpc_client.object.list_objects_s3({
                                bucket: BKT,
                                limit: 0
                            })
                            .then(function(list_reply) {
                                if (!(list_reply &&
                                        list_reply.common_prefixes.length === 0 &&
                                        list_reply.objects.length === 0 &&
                                        is_sorted_array(list_reply.objects) &&
                                        is_sorted_array(list_reply.common_prefixes) &&
                                        !list_reply.is_truncated)) {
                                    throw new Error(`Limit Test Failed! Got list: ${util.inspect(list_reply)}
                            Wanted list: ${files_without_folders_to_upload[0]}`);
                                }
                            });
                    })
                    .then(() => truncated_listing({
                        bucket: BKT,
                        delimiter: '/',
                        limit: 1,
                    }))
                    .then(listObjectsResponse => {
                        // Should be like the first check, but because of limit 1
                        // We loop and ask to list several times to get all of the objects/common_prefixes
                        // This checks the correctness of max-keys/next-marker/sort
                        if (!(listObjectsResponse &&
                                _.difference(folders_to_upload, listObjectsResponse.common_prefixes).length === 0 &&
                                _.difference(_.concat(files_without_folders_to_upload, files_in_utf_diff_delimiter),
                                    _.map(listObjectsResponse.objects, obj => obj.key)).length === 0 &&
                                is_sorted_array(listObjectsResponse.objects) &&
                                is_sorted_array(listObjectsResponse.common_prefixes) &&
                                !listObjectsResponse.is_truncated)) {
                            throw new Error(`Marker Test Failed! Got list: ${util.inspect(listObjectsResponse)}
                                                Wanted list: ${folders_to_upload}, ${files_without_folders_to_upload}`);
                        }
                    });
            });
    });

    mocha.it('max keys test', function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(10 * 60 * 1000);

        return run_case(max_keys_objects, function(server_upload_response) {
            // Uploading zero size objects from the key arrays that were provided
            return P.resolve()
                .then(function() {
                    return rpc_client.object.list_objects_s3({
                            bucket: BKT,
                            limit: 2604
                        })
                        .then(function(list_reply) {
                            if (!(list_reply &&
                                    list_reply.common_prefixes.length === 0 &&
                                    list_reply.objects.length === 1000 &&
                                    is_sorted_array(list_reply.objects) &&
                                    is_sorted_array(list_reply.common_prefixes) &&
                                    list_reply.is_truncated)) {
                                throw new Error(`Limit Test Failed! Got list: ${util.inspect(list_reply)}
                                Wanted list: Includes only 1000 objects`);
                            }
                        });
                })
                .then(function() {
                    // Note that in case of S3Controller we return an appropriate error value to the client
                    return rpc_client.object.list_objects_s3({
                            bucket: BKT,
                            limit: -2604
                        })
                        .then(function(list_reply) {
                            throw new Error(`Limit Test Failed! Got list: ${util.inspect(list_reply)},
                            Wanted to receive an error`);
                        })
                        .catch(function(err) {
                            console.error(err);
                            if (String(err.message) !== 'Limit must be a positive Integer') {
                                throw new Error(`Limit Test Failed! Got error: ${err},
                                Wanted to receive an error`);
                            }
                        });
                })
                .then(() => truncated_listing({
                    bucket: BKT,
                    delimiter: '/',
                    limit: 1,
                }))
                .then(listObjectsResponse => {
                    // Should be like the first check, but because of limit 1
                    // We loop and ask to list several times to get all of the objects/common_prefixes
                    // This checks the correctness of max-keys/next-marker/sort
                    if (!(listObjectsResponse &&
                            listObjectsResponse.common_prefixes.length === 0 &&
                            _.difference(max_keys_objects,
                                _.map(listObjectsResponse.objects, obj => obj.key)).length === 0 &&
                            is_sorted_array(listObjectsResponse.objects) &&
                            is_sorted_array(listObjectsResponse.common_prefixes) &&
                            !listObjectsResponse.is_truncated)) {
                        throw new Error(`Max keys truncated Test Failed! Got list: ${util.inspect(listObjectsResponse)}
                                                Wanted list: ${folders_to_upload}, ${max_keys_objects}`);
                    }
                });
        });
    });

    mocha.it('multipart uploads id-marker', function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(10 * 60 * 1000);

        return run_case(files_in_multipart_folders_to_upload, function(server_upload_response) {
            // Uploading zero size objects from the key arrays that were provided
            return P.resolve()
                .then(function() {
                    return rpc_client.object.list_objects_s3({
                            bucket: BKT,
                            upload_mode: true,
                            delimiter: '/',
                            prefix: 'multipart/'
                        })
                        .then(function(list_reply) {
                            if (!(list_reply &&
                                    list_reply.common_prefixes.length === 0 &&
                                    _.difference(server_upload_response.map(obj => obj.key),
                                        _.map(list_reply.objects, obj => obj.key)).length === 0 &&
                                    is_sorted_array(list_reply.objects) &&
                                    is_sorted_array(list_reply.common_prefixes) &&
                                    !list_reply.is_truncated)) {
                                throw new Error(`Multipart uploads failed on basic list`);
                            }
                        });
                })
                .then(function() {
                    return rpc_client.object.list_objects_s3({
                            bucket: BKT,
                            delimiter: '/',
                            upload_mode: true,
                            prefix: 'multipart/',
                            limit: 1
                        })
                        .then(function(list_reply) {
                            if (!(list_reply &&
                                    list_reply.common_prefixes.length === 0 &&
                                    _.difference([server_upload_response[0].key],
                                        _.map(list_reply.objects, obj => obj.key)).length === 0 &&
                                    is_sorted_array(list_reply.objects) &&
                                    is_sorted_array(list_reply.common_prefixes) &&
                                    String(server_upload_response[0].obj_id) === String(list_reply.next_version_id_marker) &&
                                    list_reply.is_truncated)) {
                                throw new Error(`Multipart uploads failed on next_version_id_marker`);
                            }
                        });
                })
                .then(() => truncated_listing({
                    bucket: BKT,
                    upload_mode: true,
                    limit: 1,
                }, /* use_version_id_marker = */ true))
                .then(listObjectsResponse => {
                    if (!(listObjectsResponse &&
                            listObjectsResponse.common_prefixes.length === 0 &&
                            _.difference(server_upload_response.map(obj => obj.key),
                                _.map(listObjectsResponse.objects, obj => obj.key)).length === 0 &&
                            is_sorted_array(listObjectsResponse.objects) &&
                            is_sorted_array(listObjectsResponse.common_prefixes) &&
                            !listObjectsResponse.is_truncated)) {
                        throw new Error(`Multipart uploads failed list with markers`);
                    }
                });
        }, /* only_initiate = */ true);
    });

    mocha.it('multipart uploads id-marker breakage test', function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(10 * 60 * 1000);

        return run_case(
            _.concat(small_folder_with_multipart,
                same_multipart_file1,
                same_multipart_file2),
            function(server_upload_response) {
                // Uploading zero size objects from the key arrays that were provided
                return P.resolve()
                    .then(function() {
                        return rpc_client.object.list_objects_s3({
                                bucket: BKT,
                                upload_mode: true,
                                delimiter: '/',
                                limit: 25
                            })
                            .then(function(list_reply) {
                                if (!(list_reply &&
                                        _.difference(['multipart2/'], list_reply.common_prefixes).length === 0 &&
                                        _.difference(_.concat(same_multipart_file1, same_multipart_file2),
                                            _.map(list_reply.objects, obj => obj.key)).length === 0 &&
                                        (list_reply.common_prefixes.length + list_reply.objects.length === 21) &&
                                        is_sorted_array(list_reply.objects) &&
                                        is_sorted_array(list_reply.common_prefixes) &&
                                        !list_reply.is_truncated)) {
                                    throw new Error(`Multipart uploads failed on basic list`);
                                }
                            });
                    });
            }, /* only_initiate = */ true);
    });

    function upload_multiple_files(array_of_names) {
        return P.map(array_of_names, name => P.resolve()
            .then(() => rpc_client.object.create_object_upload({
                bucket: BKT,
                key: name,
                content_type: 'application/octet-stream',
            }))
            .then(create_reply => rpc_client.object.complete_object_upload({
                obj_id: create_reply.obj_id,
                bucket: BKT,
                key: name,
            })));
    }

    function initiate_upload_multiple_files(array_of_names) {
        return P.map(array_of_names, name => P.resolve()
            .then(() => rpc_client.object.create_object_upload({
                bucket: BKT,
                key: name,
                content_type: 'application/octet-stream',
            }))
            .then(create_reply => ({
                obj_id: create_reply.obj_id,
                key: name,
            })));
    }

    function is_sorted_array(arr) {
        return _.every(arr, function(value, index, array) {
            if (index === 0) return true;
            // either it is the first element, or otherwise this element should
            // not be smaller than the previous element.
            // spec requires string conversion
            const equal_key = index && String(array[index - 1].key) === String(value.key);
            return equal_key ?
                // We should not worry in this case regarding prefix and obj
                // since they will not have the same key
                String(array[index - 1].obj_id) <= String(value.obj_id) :
                String(array[index - 1].key) <= String(value.key);
        });
    }

    function clean_up_after_case(array_of_names, abort_upload) {
        return abort_upload ?
            P.map(array_of_names, obj => P.resolve()
                .then(() => rpc_client.object.abort_object_upload({
                    bucket: BKT,
                    key: obj.key,
                    obj_id: obj.obj_id,
                }))) :
            rpc_client.object.delete_multiple_objects({
                bucket: BKT,
                objects: array_of_names.map(key => ({ key })),
            });
    }

    function run_case(array_of_names, case_func, only_initiate) {
        let response_array = [];
        return P.resolve()
            .then(function() {
                return only_initiate ?
                    initiate_upload_multiple_files(array_of_names) :
                    upload_multiple_files(array_of_names);
            })
            .tap(response => {
                response_array = response;
            })
            .then(response => case_func(response))
            .then(() => clean_up_after_case(only_initiate ? response_array : array_of_names, only_initiate));
    }

    function truncated_listing(params, use_version_id_marker) {
        return P.resolve()
            .then(function() {
                // Initialization of IsTruncated in order to perform the first while cycle
                var listObjectsResponse = {
                    is_truncated: true,
                    objects: [],
                    common_prefixes: [],
                    key_marker: ''
                };

                var query_obj = {
                    key_marker: listObjectsResponse.key_marker
                };

                if (use_version_id_marker) {
                    listObjectsResponse.version_id_marker = '';
                    query_obj.version_id_marker = listObjectsResponse.version_id_marker;
                }

                return promise_utils.pwhile(
                        function() {
                            return listObjectsResponse.is_truncated;
                        },
                        function() {
                            listObjectsResponse.is_truncated = false;
                            return rpc_client.object.list_objects_s3(_.defaults(query_obj, params))
                                .then(function(res) {
                                    listObjectsResponse.is_truncated = res.is_truncated;
                                    let res_list = {
                                        objects: res.objects,
                                        common_prefixes: res.common_prefixes
                                    };
                                    if (res_list.objects.length) {
                                        listObjectsResponse.objects = _.concat(listObjectsResponse.objects, res_list.objects);
                                    }
                                    if (res_list.common_prefixes.length) {
                                        listObjectsResponse.common_prefixes =
                                            _.concat(listObjectsResponse.common_prefixes, res_list.common_prefixes);
                                    }
                                    listObjectsResponse.key_marker = res.next_marker;
                                    query_obj.key_marker = res.next_marker;
                                    if (use_version_id_marker) {
                                        listObjectsResponse.version_id_marker = res.next_version_id_marker;
                                        query_obj.version_id_marker = res.next_version_id_marker;
                                    }

                                });
                        })
                    .return(listObjectsResponse);
            });
    }
});
