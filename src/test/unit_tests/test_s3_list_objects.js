'use strict';

let _ = require('lodash');
let P = require('../../util/promise');
let mocha = require('mocha');
let promise_utils = require('../../util/promise_utils');
let coretest = require('./coretest');
let ObjectIO = require('../../api/object_io');
var util = require('util');
let dbg = require('../../util/debug_module')(__filename);
dbg.set_level(5, 'core');

mocha.describe('s3_list_objects', function() {

    let client = coretest.new_test_client();
    let object_io = new ObjectIO();
    object_io.set_verification_mode();

    const SYS = 'test-list-objects-system';
    const BKT = 'files'; // the default bucket name
    const EMAIL = 'test-list-objects-email@mail.mail';
    const PASSWORD = 'test-list-objects-password';

    mocha.before(function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(30000);

        return P.resolve()
            .then(() => {
                return client.system.create_system({
                    activation_code: 'rainbow',
                    name: SYS,
                    email: EMAIL,
                    password: PASSWORD
                });
            })
            .then(res => {
                client.options.auth_token = res.token;
            })
            .then(() => client.create_auth_token({
                email: EMAIL,
                password: PASSWORD,
                system: SYS,
            }))
            .delay(2000)
            .then(() => coretest.init_test_nodes(client, SYS, 5));
    });

    mocha.after(function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(30000);

        return coretest.clear_test_nodes();
    });


    mocha.it('works', function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(30000);

        var files_without_folders_to_upload = [];
        var folders_to_upload = [];
        var files_in_folders_to_upload = [];
        var files_in_utf_diff_delimiter = [];

        var i = 0;
        for (i = 0; i < 9; i++) {
            folders_to_upload.push(`folder${i}/`);
        }
        for (i = 0; i < 9; i++) {
            files_in_folders_to_upload.push(`folder1/file${i}`);
        }
        for (i = 0; i < 9; i++) {
            files_without_folders_to_upload.push(`file_without_folder${i}`);
        }
        for (i = 0; i < 9; i++) {
            files_in_utf_diff_delimiter.push(`תיקיה#קובץ${i}`);
        }

        // Uploading zero size objects from the key arrays that were provided
        return upload_multiple_files(_.concat(folders_to_upload,
                files_in_folders_to_upload,
                files_without_folders_to_upload,
                files_in_utf_diff_delimiter
            ))
            .then(function() {
                return client.object.list_objects_s3({
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
                                !list_reply.is_truncated)) {
                            throw new Error(`Delimiter Test Failed! Got list: ${util.inspect(list_reply)}
                                Wanted list: ${_.concat(folders_to_upload, files_in_folders_to_upload,
                                    files_without_folders_to_upload)},תיקיה#`);
                        }
                    });
            })
            .then(function() {
                return client.object.list_objects_s3({
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
                                !list_reply.is_truncated)) {
                            throw new Error(`Partial Prefix Failed! Got list: ${util.inspect(list_reply)}
                                Wanted list: ${folders_to_upload}`);
                        }
                    });
            })
            .then(function() {
                return client.object.list_objects_s3({
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
                                !list_reply.is_truncated)) {
                            throw new Error(`Delimiter Test Failed! Got list: ${util.inspect(list_reply)}
                                Wanted list: ${folders_to_upload}, ${files_without_folders_to_upload}`);
                        }
                    });
            })
            .then(function() {
                return client.object.list_objects_s3({
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
                                !list_reply.is_truncated)) {
                            throw new Error(`Folder Test Failed! Got list: ${util.inspect(list_reply)}
                                Wanted list: ${files_in_folders_to_upload}`);
                        }
                    });
            })
            .then(function() {
                return client.object.list_objects_s3({
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
                                _.difference(files_without_folders_to_upload.slice(0, 5),
                                    _.map(list_reply.objects, obj => obj.key)).length === 0 &&
                                list_reply.is_truncated)) {
                            throw new Error(`Limit Test Failed! Got list: ${util.inspect(list_reply)}
                                Wanted list: ${files_without_folders_to_upload.slice(0, 5)}`);
                        }
                    });
            })
            .then(function() {
                return client.object.list_objects_s3({
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
                                !list_reply.is_truncated)) {
                            throw new Error(`Limit Test Failed! Got list: ${util.inspect(list_reply)}
                                Wanted list: ${files_without_folders_to_upload.slice(0, 5)}`);
                        }
                    });
            })
            .then(function() {
                // Initialization of IsTruncated in order to perform the first while cycle
                var listObjectsResponse = {
                    is_truncated: true,
                    objects: [],
                    common_prefixes: [],
                    key_marker: ''
                };

                return promise_utils.pwhile(
                        function() {
                            return listObjectsResponse.is_truncated;
                        },
                        function() {
                            listObjectsResponse.is_truncated = false;
                            return client.object.list_objects_s3({
                                    bucket: BKT,
                                    delimiter: '/',
                                    limit: 1,
                                    key_marker: listObjectsResponse.key_marker
                                })
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
                                });
                        })
                    .then(() => {
                        // Should be like the first check, but because of limit 1
                        // We loop and ask to list several times to get all of the objects/common_prefixes
                        // This checks the correctness of max-keys/next-marker/sort
                        if (!(listObjectsResponse &&
                                _.difference(folders_to_upload, listObjectsResponse.common_prefixes).length === 0 &&
                                _.difference(files_without_folders_to_upload,
                                    _.map(listObjectsResponse.objects, obj => obj.key)).length === 0 &&
                                !listObjectsResponse.is_truncated)) {
                            throw new Error(`Marker Test Failed! Got list: ${util.inspect(listObjectsResponse)}
                                Wanted list: ${folders_to_upload}, ${files_without_folders_to_upload}`);
                        }
                    });
            });
    });

    //TODO Method that will upload an array of strings with size 0
    function upload_multiple_files(array_of_names) {
        var array_index = -1;
        return promise_utils.loop(array_of_names.length, function() {
            array_index++;
            return P.fcall(function() {
                return client.object.create_object_upload({
                    bucket: BKT,
                    key: array_of_names[array_index],
                    size: 0,
                    content_type: 'application/octet-stream',
                });
            }).then(function(create_reply) {
                return client.object.complete_object_upload({
                    bucket: BKT,
                    key: array_of_names[array_index],
                    upload_id: create_reply.upload_id,
                    fix_parts_size: true
                });
            });
        });
    }
});
