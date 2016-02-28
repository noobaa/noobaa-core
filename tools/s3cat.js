'use strict';

let _ = require('lodash');
let fs = require('fs');
// let util = require('util');
let moment = require('moment');
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

if (argv.help) {
    print_usage();
} else if (argv.upload) {
    upload_file();
} else if (argv.list || argv.ls || argv.ll || true) {
    list_objects();
}

function list_objects() {
    s3.listObjects({
        Bucket: argv.bucket || 'files',
        Prefix: argv.prefix || '',
        Delimiter: argv.delimiter || ''
    }, function(err, data) {
        if (err) {
            console.error('ERROR:', err);
            return;
        }
        let contents = data.Contents;
        delete data.Contents;
        if (argv.long) {
            console.log('List:', JSON.stringify(data));
        }
        _.each(contents, obj => {
            let key = obj.Key;
            let size = size_utils.human_size(obj.Size);
            size = '        '.slice(size.length) + size;
            let mtime = moment(new Date(obj.LastModified)).format('MMM D HH:mm');
            let owner = obj.Owner && (obj.Owner.DisplayName || obj.Owner.ID) || '?';
            if (argv.long || argv.ll) {
                delete obj.Key;
                delete obj.Size;
                delete obj.Owner;
                delete obj.LastModified;
                console.log(owner, size, mtime, key, JSON.stringify(obj));
            } else {
                console.log(owner, size, mtime, key);
            }
        });
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
        console.log('Uploading file', file_path, 'of size',
            size_utils.human_size(data_size));
    } else {
        upload_key = 'upload-' + Date.now().toString(36);
        data_size = argv.size || 1024 * 1024 * 1024;
        data_source = new RandStream(data_size);
        console.log('Uploading generated data of size',
            size_utils.human_size(data_size));
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

function print_usage() {
    console.log(
        'Usage: \n' +
        '  --help               show this usage \n' +
        'General S3 Flags: \n' +
        '  --endpoint <host>    (default is 127.0.0.1)  \n' +
        '  --access_key <key>   (default is 123)        \n' +
        '  --secret_key <key>   (default is abc)        \n' +
        '  --bucket <name>      (default is "files")    \n' +
        'List Objects Flags: \n' +
        '  --list/ls            run list objects \n' +
        '  --long/ll            run list objects with long output \n' +
        '  --prefix <path>      prefix used for list objects \n' +
        '  --delimiter <key>    delimiter used for list objects \n' +
        'Upload Flags: \n' +
        '  --upload             run upload file \n' +
        '  --file <path>        use source file from local path \n' +
        '  --size <num>         if no file is given, generate a file of this size \n' +
        '  --part_size <num>    multipart size \n' +
        '  --concur <num>       multipart concurrency \n' +
        '');
}
