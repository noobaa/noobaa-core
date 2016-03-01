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


argv.bucket = argv.bucket || 'files';

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
} else if (argv.get) {
    get_file();
} else if (argv.list || argv.ls || argv.ll || true) {
    list_objects();
}

function list_objects() {
    s3.listObjects({
        Bucket: argv.bucket,
        Prefix: argv.prefix || '',
        Delimiter: argv.delimiter || ''
    }, function(err, data) {
        if (err) {
            console.error('LIST ERROR:', err);
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
    let bucket = argv.bucket;
    let file_path = argv.file || '';
    let upload_key = argv.upload === true ? '' : argv.upload;
    let data_source;
    let data_size;
    let part_size = (argv.part_size || 64) * 1024 * 1024;
    if (file_path) {
        upload_key = upload_key || file_path + '-' + Date.now().toString(36);
        data_source = fs.createReadStream(file_path);
        data_size = fs.statSync(file_path).size;
        console.log('Uploading file', file_path, 'of size',
            size_utils.human_size(data_size));
    } else {
        upload_key = upload_key || 'upload-' + Date.now().toString(36);
        data_size = (argv.size || 10 * 1024) * 1024 * 1024;
        data_source = new RandStream(data_size, {
            highWaterMark: part_size,
            no_crypto: true
        });
        console.log('Uploading generated data of size',
            size_utils.human_size(data_size));
    }

    let start_time = Date.now();
    let progress_time = Date.now();
    let progress_bytes = 0;
    s3.upload({
        Key: upload_key,
        Bucket: bucket,
        Body: data_source,
        ContentType: mime.lookup(file_path),
        ContentLength: data_size
    }, {
        partSize: part_size,
        queueSize: argv.concur || 4
    }, function(err, data) {
        if (err) {
            console.error('UPLOAD ERROR:', err);
            return;
        }
        let end_time = Date.now();
        let total_seconds = (end_time - start_time) / 1000;
        let speed_str = size_utils.human_size(data_size / total_seconds);
        console.log('upload done.', speed_str + '/sec');
    }).on('httpUploadProgress', function(progress) {
        let now = Date.now();
        if (now - progress_time >= 500) {
            let percents = Math.round(progress.loaded / data_size * 100);
            let current_speed_str = size_utils.human_size(
                (progress.loaded - progress_bytes) /
                (now - progress_time) * 1000);
            let avg_speed_str = size_utils.human_size(
                progress.loaded / (now - start_time) * 1000);
            progress_time = now;
            progress_bytes = progress.loaded;
            console.log(percents + '% progress.',
                current_speed_str + '/sec',
                '(~', avg_speed_str + '/sec)');
        }
    });
}

function get_file() {
    let start_time = Date.now();
    let progress_time = Date.now();
    s3.headObject({
        Bucket: argv.bucket,
        Key: argv.get || '',
    }, function(err, data) {
        if (err) {
            console.error('HEAD ERROR:', err);
            return;
        }
        let data_size = parseInt(data.ContentLength, 10);
        console.log('object size', size_utils.human_size(data_size));
        s3.getObject({
            Bucket: argv.bucket,
            Key: argv.get || '',
        }, function(err, data) {
            if (err) {
                console.error('GET ERROR:', err);
                return;
            }
            let end_time = Date.now();
            let total_seconds = (end_time - start_time) / 1000;
            let speed_str = size_utils.human_size(data_size / total_seconds);
            console.log('get done.', speed_str + '/sec');
        }).on('httpDownloadProgress', function(progress) {
            let now = Date.now();
            if (now - progress_time >= 500) {
                progress_time = now;
                let percents = Math.round(progress.loaded / data_size * 100);
                let passed_seconds = (now - start_time) / 1000;
                let speed_str = size_utils.human_size(progress.loaded / passed_seconds);
                console.log(percents + '% progress.', speed_str + '/sec');
            }
        });
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
        '  --upload <key>       run upload file to key (key can be omited)\n' +
        '  --file <path>        use source file from local path \n' +
        '  --size <MB>          if no file path, generate random data of size (default 10 GB) \n' +
        '  --part_size <MB>     multipart size \n' +
        '  --concur <num>       multipart concurrency \n' +
        'Get Flags: \n' +
        '  --get <key>          get key name \n' +
        '');
}
