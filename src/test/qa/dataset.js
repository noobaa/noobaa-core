/* Copyright (C) 2016 NooBaa */
'use strict';

const s3ops = require('../qa/s3ops');
const promise_utils = require('../../util/promise_utils');
const argv = require('minimist')(process.argv);

var server = argv.server || '127.0.0.1';
var bucket = argv.bucket || 'files';
var low_file_size = argv.file_size_low || 50; // minimum 50MB
var high_file_size = argv.file_size_high || 200; // maximum 200Mb
var size_of_ds = argv.dataset_size || 10240; // DS of 10GB
var low_num_parts = argv.part_num_low || 2; // minimum 2 part - up to 100MB
var high_num_parts = argv.part_num_high || 10; // maximum 10 parts - down to 5MB - s3 minimum
var timeout = argv.aging_timeout || 0; // time running in minutes
var dataset_name = 'DataSet' + (Math.floor(Date.now() / 1000)) + '/';
var current_size = 0;
var i = 0;

// load
promise_utils.pwhile(() => current_size < size_of_ds, () => {
        console.log("Loading... currently uploaded " + current_size + " MB from desired " + size_of_ds + " MB");
        var rand_size = Math.floor((Math.random() * (high_file_size - low_file_size)) + low_file_size);
        var rand_action = Math.floor(Math.random() * 2);
        current_size += rand_size;
        switch (rand_action) {
            case 0: // put
                return s3ops.put_file_with_md5(server, bucket, dataset_name + 'file' + (i++), rand_size)
                    .then(res => console.log("file uploaded was " + dataset_name + 'file' + (i)));
            default: // multipart upload
                var rand_parts = Math.floor((Math.random() * (high_num_parts - low_num_parts)) + low_num_parts);
                return s3ops.upload_file_with_md5(server, bucket, dataset_name + 'file' + (i++), rand_size, rand_parts)
                    .then(res => console.log("file muli-part uploaded was " + dataset_name + 'file' + (i) + " with " + rand_parts + " parts"));
        }
        // aging
    }).then(() => {
        var start = Date.now();
        if (timeout !== 0) {
            console.log('will run aging for ', timeout, 'minutes');
        }
        return promise_utils.pwhile(() => (timeout === 0 || ((Date.now() - start) / (60 * 1000)) < timeout), () => {
            console.log("Aging... currently uploaded " + current_size + " MB from desired " + size_of_ds + " MB");
            var read_or_change = Math.floor(Math.random() * 2) === 0; // true - read / false - change
            var rand_size = Math.floor(Math.random() * (high_file_size - low_file_size) + low_file_size);
            var rand_parts = Math.floor(Math.random() * (high_num_parts - low_num_parts) + low_num_parts);
            if (read_or_change) { // 50% reads
                return s3ops.get_a_random_file(server, bucket, dataset_name)
                    .then(res => s3ops.get_file_check_md5(server, bucket, res.Key));
            } else { // all other options
                var action_type = Math.floor(Math.random() * 8);
                switch (action_type) {
                    case 0: // put new - 12.5%
                        return s3ops.put_file_with_md5(server, bucket, dataset_name + 'file' + (i++), rand_size)
                            .then(function(res) {
                                console.log("file uploaded was " + dataset_name + 'file' + (i));
                                current_size += rand_size;
                            });
                    case 1: // upload new - multi-part - 12.5%
                        return s3ops.upload_file_with_md5(server, bucket, dataset_name + 'file' + (i++), rand_size, rand_parts)
                            .then(function(res) {
                                console.log("file multi-part uploaded was " + dataset_name + 'file' + (i) + " with " + rand_parts + " parts");
                                current_size += rand_size;
                            });
                    case 2: // copy object - 12.5%
                        return s3ops.get_a_random_file(server, bucket, dataset_name)
                            .then(function(res) {
                                console.log("file copying from: " + res.Key);
                                return s3ops.copy_file_with_md5(server, bucket, res.Key, dataset_name + 'file' + (i++));
                            }).then(function(res) {
                                console.log("file copied to: " + dataset_name + 'file' + (i));
                                current_size += rand_size;
                            });
                    case 3: // upload overwrite - regular - 12.5%
                        return s3ops.get_a_random_file(server, bucket, dataset_name)
                            .then(function(res) {
                                current_size -= Math.floor(res.Size / 1024 / 1024);
                                return s3ops.put_file_with_md5(server, bucket, res.Key, rand_size);
                            })
                            .then(function(res) {
                                console.log("file upload overwritten was " + dataset_name + 'file' + (i) + " with " + rand_parts + " parts");
                                current_size += rand_size;
                            });
                    case 4: // upload overwrite - multi-part - 12.5%
                        return s3ops.get_a_random_file(server, bucket, dataset_name)
                            .then(function(res) {
                                current_size -= Math.floor(res.Size / 1024 / 1024);
                                return s3ops.upload_file_with_md5(server, bucket, res.Key, rand_size, rand_parts);
                            })
                            .then(function(res) {
                                console.log("file upload overwritten was " + dataset_name + 'file' + (i) + " with " + rand_parts + " parts");
                                current_size += rand_size;
                            });
                    default: // delete - 37.5%
                        return s3ops.get_file_number(server, bucket, dataset_name)
                            .then(object_number => {
                                if (object_number > 1) { // won't delete the last file in the bucket
                                    return s3ops.get_a_random_file(server, bucket, dataset_name)
                                        .then(function(res) {
                                            current_size -= Math.floor(res.Size / 1024 / 1024);
                                            return s3ops.delete_file(server, bucket, res.Key);
                                        });
                                }
                            });
                }
            }
        });
    })
    .then(() => {
        console.log(':) :) :) Everything finished with success! (: (: (:');
        process.exit(0);
    })
    .catch(err => {
        console.error(':( :( Errors during test ): ):', err);
        process.exit(1);
    });
