'use strict';

const s3ops = require('../qa/s3ops');
const promise_utils = require('../../util/promise_utils');
const argv = require('minimist')(process.argv);
const ops = require('../system_tests/basic_server_ops');

var server = argv.server || '127.0.0.1';
var bucket = argv.bucket || 'files';
var low_file_size = argv.file_size_low || 20; // minimum 20MB
var high_file_size = argv.file_size_high || 200; // maximum 200Mb
var size_of_ds = argv.dataset_size || 102; // DS of 10GB
var low_num_parts = argv.part_num_low || 5; // minimum 20MB
var high_num_parts = argv.part_num_high || 50; // maximum 200Mb
var dataset_name = 'Upgrade-Data' + (Math.floor(Date.now() / 1000)) + '/';
var upgrade_file = argv.upgrade_file;
var current_size = 0;
var i = 0;

// load
promise_utils.pwhile(() => current_size < size_of_ds, () => {
        console.log("Loading... currently uploaded " + current_size + " MB from desired " + size_of_ds + " MB");
        var rand_size = Math.floor(Math.random() * (high_file_size - low_file_size) + low_file_size);
        var rand_action = Math.floor(Math.random() * 2);
        current_size += rand_size;
        switch (rand_action) {
            // case 0: // put
            //     return s3ops.put_file_with_md5(server, bucket, dataset_name + 'file' + (i++), rand_size)
            //         .then(res => console.log("file uploaded was " + dataset_name + 'file' + (i)));
            default: // multipart upload
                var rand_parts = Math.floor(Math.random() * (high_num_parts - low_num_parts) + low_num_parts);
            return s3ops.upload_file_with_md5(server, bucket, dataset_name + 'file' + (i++), rand_size, rand_parts)
                .then(res => console.log("file muli-part uploaded was " + dataset_name + 'file' + (i) + " with " + rand_parts + " parts"));
        }
        // upgrade
    }).then(() => ops.upload_and_upgrade(server, upgrade_file))
    .then(() => s3ops.check_MD5_all_objects(server, bucket, dataset_name)); // verfiy dataset
