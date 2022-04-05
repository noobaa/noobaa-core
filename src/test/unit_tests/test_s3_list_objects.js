/* Copyright (C) 2016 NooBaa */
/*eslint max-lines-per-function: ["error", 550]*/
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup();

const _ = require('lodash');
const util = require('util');
const mocha = require('mocha');

const P = require('../../util/promise');
const ObjectIO = require('../../sdk/object_io');

const { rpc_client } = coretest;
let object_io = new ObjectIO();
object_io.set_verification_mode();
const assert = require('assert');

const BKT = 'first.bucket'; // the default bucket name

mocha.describe('s3_list_objects', function() {

    let files_without_folders_to_upload = [];
    let folders_to_upload = [];
    let files_in_folders_to_upload = [];
    let files_in_utf_diff_delimiter = [];
    let max_keys_objects = [];
    let files_in_multipart_folders_to_upload = [];
    let same_multipart_file1 = [];
    let same_multipart_file2 = [];
    let small_folder_with_multipart = [];
    let prefix_infinite_loop_test = [];

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
    for (i = 0; i < 1; i++) {
        prefix_infinite_loop_test.push(`d/d/d/`);
        prefix_infinite_loop_test.push(`d/d/f`);
        prefix_infinite_loop_test.push(`d/f`);
    }

    mocha.it('issue use case', function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(10 * 60 * 1000);
        let issue_files_folders_to_upload = ['20220323/99/test.txt', '20220323/990/test.txt'];
        let expected_files_uploaded = ['20220323/99/', '20220323/990/'];

        return run_case(issue_files_folders_to_upload,
            async function(server_upload_response) {
                // Uploading zero size objects from the key arrays that were provide
                const list_reply = await rpc_client.object.list_objects({
                    bucket: BKT,
                    delimiter: '/',
                    prefix: '20220323/'
                });
                // We should get the folder names in common_prefixes
                // And we should get no objects inside objects
                // Also we check that the response is not truncated
                assert.strictEqual(_.difference(expected_files_uploaded, list_reply.common_prefixes).length, 0,
                    'prefixes: ' + list_reply.common_prefixes);
                assert.strictEqual(_.map(list_reply.objects, obj => obj.key).length, 0, 'objects: ' + list_reply.objects);
                assert(is_sorted_array(list_reply.objects), 'not sorted objects');
                assert(is_sorted_array(list_reply.common_prefixes), 'not sorted prefixes');
                assert(!list_reply.is_truncated, 'truncated');
            });
    });

    mocha.it('general use case', function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(10 * 60 * 1000);

        return run_case(_.concat(folders_to_upload,
                files_in_folders_to_upload,
                files_without_folders_to_upload,
            ),
            async function(server_upload_response) {
                // Uploading zero size objects from the key arrays that were provided
                let list_reply = await rpc_client.object.list_objects({
                    bucket: BKT,
                    delimiter: '/',
                    prefix: 'folder'
                });
                // In case we don't fully spell the name of the common prefix
                // We should get all the common prefixes that begin with that prefix
                assert.strictEqual(_.difference(folders_to_upload, list_reply.common_prefixes).length, 0,
                    'prefixes: ' + list_reply.common_prefixes);
                assert.strictEqual(list_reply.objects.length, 0, 'objects: ' + list_reply.objects);
                assert(is_sorted_array(list_reply.objects), 'not sorted objects');
                assert(is_sorted_array(list_reply.common_prefixes), 'not sorted prefixes');
                assert(!list_reply.is_truncated, 'truncated');

                list_reply = await rpc_client.object.list_objects({
                    bucket: BKT,
                    delimiter: '/',
                });
                // We should get the folder names in common_prefixes
                // And we should get the objects without folders inside objects
                // Also we check that the response is not truncated
                let objects = _.map(list_reply.objects, obj => obj.key);
                assert.strictEqual(_.difference(folders_to_upload, list_reply.common_prefixes).length, 0,
                    'prefixes: ' + list_reply.common_prefixes);
                assert.strictEqual(_.difference(files_without_folders_to_upload, objects).length, 0, 'objects: ' + objects);
                assert(is_sorted_array(objects), 'objcets not sorted' + objects);
                assert(is_sorted_array(list_reply.common_prefixes), 'prefixes not sorted');
                assert(!list_reply.is_truncated, 'truncated');

                list_reply = await rpc_client.object.list_objects({
                    bucket: BKT,
                    delimiter: '/',
                    prefix: 'folder1/'
                });
                // We should get nothing in common_prefixes
                // And we should get the objects inside folder1 in objects
                // Also we check that the response is not truncated
                objects = _.map(list_reply.objects, obj => obj.key);
                assert.strictEqual(list_reply.common_prefixes.length, 0, 'prefixes: ' + list_reply.common_prefixes);
                assert.strictEqual(_.difference(files_in_folders_to_upload, objects).length, 0, 'objects: ' + objects);
                assert(is_sorted_array(objects), 'objcets not sorted' + objects);
                assert(is_sorted_array(list_reply.common_prefixes), 'prefixes not sorted');
                assert(!list_reply.is_truncated, 'truncated');

                list_reply = await rpc_client.object.list_objects({
                    bucket: BKT,
                    delimiter: '/',
                    limit: 5
                });
                // Should be like the first check, but because of limit 5 we should only
                // Receive the first 5 files without folders under root and not all the folders
                // Which means that the common_prefixes should be zero, and only 5 objects
                // This tests the sorting algorithm of the response, and also the max-keys limit
                objects = _.map(list_reply.objects, obj => obj.key);
                assert.strictEqual(list_reply.common_prefixes.length, 0, 'prefixes: ' + list_reply.common_prefixes);
                assert.strictEqual(_.difference([
                    'file_without_folder0',
                    'file_without_folder1',
                    'file_without_folder10',
                    'file_without_folder100',
                    'file_without_folder101',
                ], objects).length, 0, 'objects:' + objects);
                assert(is_sorted_array(objects), 'objcets not sorted' + objects);
                assert(is_sorted_array(list_reply.common_prefixes), 'prefixes not sorted');
                assert(list_reply.is_truncated, 'not truncated');
            });

    });

    mocha.it('general use case 2', function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(10 * 60 * 1000);
        return run_case(_.concat(folders_to_upload,
            files_in_folders_to_upload,
            files_without_folders_to_upload,
            files_in_utf_diff_delimiter,
            ),
            async function(server_upload_response) {
                let list_reply = await rpc_client.object.list_objects({
                    bucket: BKT,
                    delimiter: '#',
                });
                let objects = _.map(list_reply.objects, obj => obj.key);
                // We should get the folder names in common_prefixes
                // And we should get the objects without folders inside objects
                // Also we check that the response is not truncated
                assert.strictEqual(_.difference(['תיקיה#'], list_reply.common_prefixes).length, 0,
                    'prefixes: ' + list_reply.common_prefixes);
                assert.strictEqual(_.difference(_.concat(folders_to_upload, files_in_folders_to_upload,
                    files_without_folders_to_upload), objects).length, 0, 'objects:' + objects);
                assert(is_sorted_array(list_reply.objects), 'objects not sorted');
                assert(is_sorted_array(list_reply.common_prefixes), 'prefixes not sorted');
                assert(!list_reply.is_truncated, 'truncated');

                list_reply = await rpc_client.object.list_objects({
                    bucket: BKT,
                    prefix: 'file_without',
                });
                // Should be like the first check, but because of limit 5 we should only
                // Receive the first 5 files without folders under root and not all the folders
                // Which means that the common_prefixes should be zero, and only 5 objects
                // This tests the sorting algorithm of the response, and also the max-keys limit
                objects = _.map(list_reply.objects, obj => obj.key);
                assert.strictEqual(list_reply.common_prefixes.length, 0, 'prefixes: ' + list_reply.common_prefixes);
                assert.strictEqual(_.difference(files_without_folders_to_upload, objects).length, 0, 'objects:' + objects);
                assert(is_sorted_array(objects), 'objects not sorted' + objects);
                assert(is_sorted_array(list_reply.common_prefixes), 'prefixes not sorted');
                assert(!list_reply.is_truncated, 'truncated');

                list_reply = await rpc_client.object.list_objects({
                    bucket: BKT,
                    prefix: 'file_without_folder0',
                });
                // Checking that we return object that complies fully to the prefix and don't skip it
                // This test was added after Issue #2600
                objects = _.map(list_reply.objects, obj => obj.key);
                assert.strictEqual(list_reply.common_prefixes.length, 0, 'prefixes: ' + list_reply.common_prefixes);
                assert.strictEqual(files_without_folders_to_upload[0], objects[0], 'objects:' + objects);
                assert(is_sorted_array(objects), 'objcets not sorted' + objects);
                assert(is_sorted_array(list_reply.common_prefixes), 'prefixes not sorted');
                assert(!list_reply.is_truncated, 'truncated');

                list_reply = await rpc_client.object.list_objects({
                    bucket: BKT,
                    limit: 0
                });
                assert.strictEqual(list_reply.common_prefixes.length, 0, 'prefixes: ' + list_reply.common_prefixes);
                assert.strictEqual(list_reply.objects.length, 0, 'objects:' + list_reply.objects);
                assert(is_sorted_array(objects), 'objcets not sorted' + objects);
                assert(is_sorted_array(list_reply.common_prefixes), 'prefixes not sorted');
                assert(!list_reply.is_truncated, 'truncated');

                list_reply = await truncated_listing({
                    bucket: BKT,
                    delimiter: '/',
                    limit: 1,
                });
                // Should be like the first check, but because of limit 1
                // We loop and ask to list several times to get all of the objects/common_prefixes
                // This checks the correctness of max-keys/next-marker/sort
                objects = _.map(list_reply.objects, obj => obj.key);
                assert.strictEqual(_.difference(folders_to_upload, list_reply.common_prefixes).length, 0,
                    'prefixes: ' + list_reply.common_prefixes);
                assert.strictEqual(_.difference(_.concat(files_without_folders_to_upload, files_in_utf_diff_delimiter), objects).length, 0,
                    'objects:' + list_reply.objects);
                assert(is_sorted_array(objects), 'objcets not sorted' + objects);
                assert(is_sorted_array(list_reply.common_prefixes), 'prefixes not sorted');
                assert(!list_reply.is_truncated, 'truncated');
            });
    });

    mocha.it('max keys test', function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(10 * 60 * 1000);

        return run_case(max_keys_objects, async function(server_upload_response) {
            // Uploading zero size objects from the key arrays that were provided
            let list_reply = await rpc_client.object.list_objects({
                bucket: BKT,
                limit: 2604
            });
            let objects = _.map(list_reply.objects, obj => obj.key);
            assert.strictEqual(list_reply.common_prefixes.length, 0, 'prefixes: ' + list_reply.common_prefixes);
            assert.strictEqual(objects.length, 1000, 'objects:' + objects);
            assert(is_sorted_array(objects), 'objcets not sorted' + objects);
            assert(is_sorted_array(list_reply.common_prefixes), 'prefixes not sorted');
            assert(list_reply.is_truncated, 'not truncated');

            // Note that in case of S3Controller we return an appropriate error value to the client
            try {
                list_reply = await rpc_client.object.list_objects({
                    bucket: BKT,
                    limit: -2604
                });
                throw new Error(`Limit Test Failed! Got list: ${util.inspect(list_reply)},
                Wanted to receive an error`);
            } catch (err) {
                console.error(err);
                if (String(err.message) !== 'Limit must be a positive Integer') {
                    throw new Error(`Limit Test Failed! Got error: ${err},
                        Wanted to receive an error`);
                }
            }
            list_reply = await truncated_listing({
                bucket: BKT,
                delimiter: '/',
                limit: 1,
            });
            // Should be like the first check, but because of limit 1
            // We loop and ask to list several times to get all of the objects/common_prefixes
            // This checks the correctness of max-keys/next-marker/sort
            objects = _.map(list_reply.objects, obj => obj.key);
            assert.strictEqual(list_reply.common_prefixes.length, 0, 'prefixes: ' + list_reply.common_prefixes);
            assert.strictEqual(_.difference(max_keys_objects, objects).length, 0, 'objects:' + list_reply.objects);
            assert(is_sorted_array(list_reply.objects), 'objcets not sorted' + list_reply.objects);
            assert(is_sorted_array(list_reply.common_prefixes), 'prefixes not sorted');
            assert(!list_reply.is_truncated, 'truncated');
        });
    });

    mocha.it('multipart uploads id-marker', function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(10 * 60 * 1000);

        return run_case(files_in_multipart_folders_to_upload, async function(server_upload_response) {
            // Uploading zero size objects from the key arrays that were provided
            let list_reply = await rpc_client.object.list_uploads({
                bucket: BKT,
                delimiter: '/',
                prefix: 'multipart/'
            });
            let objects = _.map(list_reply.objects, obj => obj.key);
            assert.strictEqual(list_reply.common_prefixes.length, 0, 'prefixes: ' + list_reply.common_prefixes);
            assert.strictEqual(_.difference(server_upload_response.map(obj => obj.key),
                objects).length, 0, 'objects:' + objects);
            assert(is_sorted_array(list_reply.objects), 'objcets not sorted' + list_reply.objects);
            assert(is_sorted_array(list_reply.common_prefixes), 'prefixes not sorted');
            assert(!list_reply.is_truncated, 'truncated');

            list_reply = await rpc_client.object.list_uploads({
                bucket: BKT,
                delimiter: '/',
                prefix: 'multipart/',
                limit: 1
            });
            objects = _.map(list_reply.objects, obj => obj.key);
            assert.strictEqual(list_reply.common_prefixes.length, 0, 'prefixes: ' + list_reply.common_prefixes);
            assert.strictEqual(_.difference([server_upload_response[0].key], objects).length, 0, 'objects:' + objects);
            assert(is_sorted_array(objects), 'objcets not sorted' + objects);
            assert(is_sorted_array(list_reply.common_prefixes), 'prefixes not sorted');
            assert.strictEqual(String(server_upload_response[0].obj_id), String(list_reply.next_upload_id_marker));
            assert(list_reply.is_truncated, 'not truncated');

            list_reply = await truncated_listing({
                bucket: BKT,
                limit: 1,
            }, /* use_upload_id_marker = */ true, /* upload_mode = */ true);
            objects = _.map(list_reply.objects, obj => obj.key);
            assert.strictEqual(list_reply.common_prefixes.length, 0, 'prefixes: ' + list_reply.common_prefixes);
            assert.strictEqual(_.difference(server_upload_response.map(obj => obj.key), objects).length, 0, 'objects:' + objects);
            assert(is_sorted_array(objects), 'objcets not sorted' + objects);
            assert(is_sorted_array(list_reply.common_prefixes), 'prefixes not sorted');
            assert(!list_reply.is_truncated, 'truncated');
        }, /* only_initiate = */ true);
    });

    mocha.it('multipart uploads id-marker breakage test', function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(10 * 60 * 1000);

        return run_case(
            _.concat(small_folder_with_multipart,
                same_multipart_file1,
                same_multipart_file2),
            async function(server_upload_response) {
                // Uploading zero size objects from the key arrays that were provided
                let list_reply = await rpc_client.object.list_uploads({
                    bucket: BKT,
                    delimiter: '/',
                    limit: 25
                });
                let objects = _.map(list_reply.objects, obj => obj.key);
                assert.strictEqual(_.difference(['multipart2/'], list_reply.common_prefixes).length, 0,
                    'prefixes: ' + list_reply.common_prefixes);
                assert.strictEqual(_.difference(_.concat(same_multipart_file1, same_multipart_file2),
                         objects).length, 0, 'objects:' + objects);
                assert.strictEqual(list_reply.common_prefixes.length + objects.length, 21, util.inspect(list_reply));
                assert(is_sorted_array(objects), 'objcets not sorted');
                assert(is_sorted_array(list_reply.common_prefixes), 'prefixes not sorted');
                assert(!list_reply.is_truncated, 'truncated');
            }, /* only_initiate = */ true);
    });

    mocha.it('prefix with delimiter infinite infinite loop listing', function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(10 * 60 * 1000);

        return run_case(
            prefix_infinite_loop_test,
            async function(server_upload_response) {
                // Uploading zero size objects from the key arrays that were provided
                let list_reply = await truncated_listing({
                    bucket: BKT,
                    prefix: 'd/',
                    delimiter: '/',
                    limit: 1,
                }, /* use_upload_id_marker = */ false, /* upload_mode = */ false);
                let objects = _.map(list_reply.objects, obj => obj.key);
                assert.strictEqual(_.difference(['d/d/'], list_reply.common_prefixes).length, 0, 'prefixes: ' + list_reply.common_prefixes);
                assert.strictEqual(_.difference(['d/f'], objects).length, 0, 'objects:' + objects);
                assert.strictEqual((list_reply.common_prefixes.length + objects.length), 2);
                assert(is_sorted_array(objects), 'objcets not sorted' + objects);
                assert(is_sorted_array(list_reply.common_prefixes), 'prefixes not sorted');
                assert(!list_reply.is_truncated, 'truncated');
            }, /* only_initiate = */ false);
    });
});

function upload_multiple_files(array_of_names) {
    return P.map(array_of_names, async name => {
        const create_reply = await rpc_client.object.create_object_upload({
            bucket: BKT,
            key: name,
            content_type: 'application/octet-stream',
        });
        return rpc_client.object.complete_object_upload({
            obj_id: create_reply.obj_id,
            bucket: BKT,
            key: name,
        });
    });
}

function initiate_upload_multiple_files(array_of_names) {
    return P.map(array_of_names, async name => {
        const create_reply = await rpc_client.object.create_object_upload({
            bucket: BKT,
            key: name,
            content_type: 'application/octet-stream',
        });
        return {
            obj_id: create_reply.obj_id,
            key: name,
        };
    });
}

function is_sorted_array(arr) {
    return _.every(arr, (value, index, array) => {
        if (index === 0) return true;
        // either it is the first element, or otherwise this element should
        // not be smaller than the previous element.
        // spec requires string conversion
        const equal_key = index && String(array[index - 1].key) === String(value.key);
        return equal_key ?
            // We should not worry in this case regarding prefix and obj
            // since they will not have the same key
            // TODO GUY this check is incomplete, can't use String(obj_id) ...
            true : // String(array[index - 1].obj_id) <= String(value.obj_id) :
            String(array[index - 1].key) <= String(value.key);
    });
}

function clean_up_after_case(array_of_names, abort_upload) {
    return abort_upload ?
        P.map(array_of_names, async obj => {
            await rpc_client.object.abort_object_upload({
                bucket: BKT,
                key: obj.key,
                obj_id: obj.obj_id,
            });
        }) :
        rpc_client.object.delete_multiple_objects({
            bucket: BKT,
            objects: array_of_names.map(key => ({ key })),
        });
}

async function run_case(array_of_names, case_func, only_initiate) {
    const response = only_initiate ? await initiate_upload_multiple_files(array_of_names) :
                await upload_multiple_files(array_of_names);
    const response_array = response;
    await case_func(response);
    await clean_up_after_case(only_initiate ? response_array : array_of_names, only_initiate);
}

async function truncated_listing(params, use_upload_id_marker, upload_mode) {
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

        if (use_upload_id_marker) {
            listObjectsResponse.upload_id_marker = '';
            query_obj.upload_id_marker = listObjectsResponse.upload_id_marker;
        }

        while (listObjectsResponse.is_truncated) {
            listObjectsResponse.is_truncated = false;
            const func_params = _.defaults(query_obj, params);
            const res = upload_mode ?
                await rpc_client.object.list_uploads(func_params) :
                await rpc_client.object.list_objects(func_params);

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
            if (use_upload_id_marker) {
                listObjectsResponse.upload_id_marker = res.next_upload_id_marker;
                query_obj.upload_id_marker = res.next_upload_id_marker;
            }
        }
        return listObjectsResponse;
}
