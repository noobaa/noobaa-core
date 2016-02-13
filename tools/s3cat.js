'use strict';

let fs = require('fs');
let util = require('util');
let mime = require('mime');
let AWS = require('aws-sdk');
var argv = require('minimist')(process.argv);
let size_utils = require('../src/util/size_utils');
let RandStream = require('../src/util/rand_stream');


let s3 = new AWS.S3({
    accessKeyId: argv.access_key || '123',
    secretAccessKey: argv.secret_key || 'abc',
    endpoint: argv.endpoint || 'http://127.0.0.1',
    s3ForcePathStyle: true,
    sslEnabled: false,
    computeChecksums: false,
});

if (argv.upload) {
    upload_file();
} else {
    list_objects();
}

function list_objects() {
    s3.listObjects({
        Bucket: argv.bucket || 'files'
    }, function(err, data) {
        console.log('results:', util.inspect(data, {
            depth: null
        }));
    });
}

function upload_file() {
    let bucket = argv.bucket || 'files';
    let file_path = argv.file || '';
    let upload_key;
    let data_source;
    let data_size;
    if (file_path) {
        upload_key = file_path + '-' + Date.now().toString(36);
        data_source = fs.createReadStream(file_path);
        data_size = fs.statSync(file_path).size;
    } else {
        upload_key = 'upload-' + Date.now().toString(36);
        data_size = argv.size || 1024 * 1024 * 1024;
        data_source = new RandStream(data_size);
    }

    let start_time = Date.now();
    let progress_time = Date.now();
    s3.upload({
        Key: upload_key,
        Bucket: bucket,
        Body: data_source,
        ContentType: mime.lookup(file_path),
        ContentLength: data_size
    }, {
        partSize: argv.part_size || 50 * 1024 * 1024,
        queueSize: argv.concur || 20
    }, function(err, data) {
        let end_time = Date.now();
        let total_seconds = (end_time - start_time) / 1000;
        let speed_str = size_utils.human_size(data_size / total_seconds);
        if (err) {
            console.error('UPLOAD FAILED', err.stack);
        } else {
            console.log('upload done.', speed_str + '/sec');
        }
    }).on('httpUploadProgress', function(progress) {
        let now = Date.now();
        if (now - progress_time >= 500) {
            progress_time = now;
            let percents = Math.round(progress.loaded / data_size * 100);
            let passed_seconds = (now - start_time) / 1000;
            let speed_str = size_utils.human_size(progress.loaded / passed_seconds);
            console.log(percents + '% done.', speed_str + '/sec');
        }
    });
}
