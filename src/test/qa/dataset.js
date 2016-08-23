'use strict';

const s3ops = require('../qa/s3ops');
const promise_utils = require('../util/promise_utils');

var low_file_size = 20; // minimum 20MB
var high_file_size = 200; // maximum 200Mb
var size_of_ds = 1024; // DS of 5GB
var low_num_parts = 5; // minimum 20MB
var high_num_parts = 50; // maximum 200Mb
var dataset_name = 'DataSet' + (Math.floor(Date.now() / 1000)) + '/';
var current_size = 0;
var i = 0;

// load
promise_utils.pwhile(() => current_size < size_of_ds, () => {
    var rand_size = Math.floor(Math.random() * (high_file_size - low_file_size) + low_file_size);
    var rand_action = Math.floor(Math.random() * 2);
    console.log("Loading... currently uploaded " + current_size + " MB from desired " + size_of_ds + " MB");
    current_size += rand_size;
    switch (rand_action) {
        case 0: // put
            return s3ops.put_file_with_md5('127.0.0.1', 'files', dataset_name + 'file' + (i++), rand_size)
                .then(res => console.log("file uploaded was " + dataset_name + 'file' + (i)));
        default: // multipart upload
            var rand_parts = Math.floor(Math.random() * (high_num_parts - low_num_parts) + low_num_parts);
            return s3ops.upload_file_with_md5('127.0.0.1', 'files', dataset_name + 'file' + (i++), rand_size, rand_parts)
                .then(res => console.log("file muli-part uploaded was " + dataset_name + 'file' + (i) + " with " + rand_parts + " parts"));
    }
    // aging
}).then(() =>
    promise_utils.pwhile(() => true, () => {
        var rand_action = Math.floor(Math.random() * 5);
        console.log("Aging... currently uploaded " + current_size + " MB from desired " + size_of_ds + " MB");
        switch (rand_action) {
            case 0: // put - 20%
                var rand_size = Math.floor(Math.random() * (high_file_size - low_file_size) + low_file_size);
                if (current_size < size_of_ds) {
                    return s3ops.put_file_with_md5('127.0.0.1', 'files', dataset_name + 'file' + (i++), rand_size)
                        .then(function(result) {
                            console.log("file uploaded was " + dataset_name + 'file' + (i));
                            current_size += rand_size;
                        });
                }
                break;
            case 1: // upload - multi-part - 20%
                var rand_size2 = Math.floor(Math.random() * (high_file_size - low_file_size) + low_file_size);
                var rand_parts = Math.floor(Math.random() * (high_num_parts - low_num_parts) + low_num_parts);
                if (current_size < size_of_ds) {
                    return s3ops.put_file_with_md5('127.0.0.1', 'files', dataset_name + 'file' + (i++), rand_size2, rand_parts)
                        .then(function(result) {
                            console.log("file multi-part uploaded was " + dataset_name + 'file' + (i) + " with " + rand_parts + " parts");
                            current_size += rand_size2;
                        });
                }
                break;
            case 2: // read - 20%
                return s3ops.get_a_random_file('127.0.0.1', 'files', dataset_name)
                    .then(res => s3ops.get_file_check_MD5('127.0.0.1', 'files', res.Key));
            default: // delete - 40%
                return s3ops.get_a_random_file('127.0.0.1', 'files', dataset_name)
                    .then(function(res) {
                        if (current_size > Math.floor(res.Size / 1024 / 1024)) {
                            current_size -= Math.floor(res.Size / 1024 / 1024);
                            return s3ops.delete_file('127.0.0.1', 'files', res.Key);
                        }
                    });
        }
    })
);
