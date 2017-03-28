/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const fs = require('fs');
const AWS = require('aws-sdk');
const argv = require('minimist')(process.argv);
const mime = require('mime');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const stream = require('stream');
const moment = require('moment');
const size_utils = require('../util/size_utils');
const RandStream = require('../util/rand_stream');

http.globalAgent.keepAlive = true;
https.globalAgent.keepAlive = true;

if (argv.presign && !_.isNumber(argv.presign)) {
    argv.presign = 3600;
}

if (argv.endpoint) {
    if (argv.endpoint === true) argv.endpoint = 'http://127.0.0.1';
    argv.access_key = argv.access_key || '123';
    argv.secret_key = argv.secret_key || 'abc';
    argv.bucket = argv.bucket || 'files';
}

const s3 = new AWS.S3({
    endpoint: argv.endpoint,
    accessKeyId: argv.access_key,
    secretAccessKey: argv.secret_key,
    s3ForcePathStyle: true,
    signatureVersion: argv.sig, // s3 or v4
    computeChecksums: argv.checksum || false, // disabled by default for performance
    s3DisableBodySigning: !argv.signing || true, // disabled by default for performance
    region: argv.region || 'us-east-1',
    params: {
        Bucket: argv.bucket
    },
});

// AWS config does not use https.globalAgent
// so for https we need to set the agent manually
if (s3.endpoint.protocol === 'https:') {
    s3.config.update({
        httpOptions: {
            agent: new https.Agent({
                keepAlive: true,
                rejectUnauthorized: !argv.selfsigned,
            })
        }
    });
    if (!argv.selfsigned) {
        AWS.events.on('error', err => {
            if (err.message === 'self signed certificate') {
                setTimeout(() => console.log(
                    '\n*** You can accept self signed certificates with: --selfsigned\n'
                ), 10);
            }
        });
    }
}

if (argv.help) {
    print_usage();
} else if (argv.lb) {
    list_buckets();
} else if (argv.ls || argv.ll) {
    list_objects();
} else if (argv.head) {
    if (_.isString(argv.head)) {
        head_object();
    } else {
        head_bucket();
    }
} else if (argv.get) {
    get_object();
} else if (argv.upload || argv.put) {
    upload_object();
} else if (argv.rm) {
    delete_objects();
} else if (argv.mb) {
    create_bucket();
} else if (argv.rb) {
    delete_bucket();
} else {
    list_buckets();
}


function make_simple_request(op, params) {
    const req = s3.makeRequest(op, params);
    if (argv.presign) {
        return console.log(req.presign(argv.presign));
    }
    return req.promise()
        .then(data => console.log('DONE', op, data))
        .catch(err => console.error('ERROR:', op, params, _.omit(err, 'stack')));
}


function list_objects() {
    const params = {
        Prefix: argv.prefix,
        Delimiter: argv.delimiter,
        MaxKeys: argv.maxkeys,
        Marker: argv.marker,
    };
    const req = s3.listObjects(params);
    if (argv.presign) return console.log(req.presign(argv.presign));
    return req.promise()
        .then(data => {
            let contents = data.Contents;
            let prefixes = data.CommonPrefixes;
            delete data.Contents;
            delete data.CommonPrefixes;
            if (argv.ll) {
                console.log('List:', JSON.stringify(data));
            }
            _.each(prefixes, prefix => {
                console.log('Prefix:', prefix.Prefix);
            });
            _.each(contents, obj => {
                let key = obj.Key;
                let size = size_utils.human_size(obj.Size);
                size = '        '.slice(size.length) + size;
                let mtime = moment(new Date(obj.LastModified)).format('MMM D HH:mm');
                let owner = (obj.Owner && (obj.Owner.DisplayName || obj.Owner.ID)) || '?';
                if (argv.ll) {
                    delete obj.Key;
                    delete obj.Size;
                    delete obj.Owner;
                    delete obj.LastModified;
                    console.log(owner, size, mtime, key, JSON.stringify(obj));
                } else {
                    console.log(owner, size, mtime, key);
                }
            });
        })
        .catch(err => console.error('LIST ERROR:', _.omit(err, 'stack')));
}

function list_buckets() {
    const req = s3.listBuckets();
    if (argv.presign) return console.log(req.presign(argv.presign));
    return req.promise()
        .then(data => {
            _.each(data.Buckets, bucket => {
                console.log(bucket.Name);
            });
        })
        .catch(err => console.error('LIST BUCKETS ERROR:', _.omit(err, 'stack')));
}

function create_bucket() {
    return make_simple_request('createBucket', {
        Bucket: argv.mb
    });
}

function delete_bucket() {
    return make_simple_request('deleteBucket', {
        Bucket: argv.rb
    });
}

function head_bucket() {
    return make_simple_request('headBucket', {});
}

function head_object() {
    return make_simple_request('headObject', {
        Key: argv.head
    });
}

function delete_objects() {
    if (typeof(argv.rm) !== 'string') {
        console.error('missing keys to delete, for example: --rm "key1,/path/to/key2"');
        return;
    }
    return make_simple_request('deleteObjects', {
        Delete: {
            Objects: argv.rm.split(',').map(obj => ({
                Key: obj.trim(),
            }))
        }
    });
}

function upload_object() {
    let file_path = argv.file || '';
    let upload_key =
        (_.isString(argv.upload) && argv.upload) ||
        (_.isString(argv.put) && argv.put) ||
        '';
    argv.size = argv.size || 1024;
    argv.concur = argv.concur || 32;
    argv.part_size = argv.part_size || 32;
    let data_source;
    let data_size;
    let part_size = argv.part_size * 1024 * 1024;
    if (file_path) {
        upload_key = upload_key || file_path + '-' + Date.now().toString(36);
        data_source = fs.createReadStream(file_path, {
            highWaterMark: part_size
        });
        data_size = fs.statSync(file_path).size;
        console.log('Uploading', upload_key, 'from file', file_path,
            'of size', size_utils.human_size(data_size));
    } else {
        upload_key = upload_key || 'upload-' + Date.now().toString(36);
        data_size = argv.size * 1024 * 1024;
        data_source = argv.buf ?
            crypto.randomBytes(data_size) :
            new RandStream(data_size, {
                highWaterMark: part_size,
            });
        console.log('Uploading', upload_key, 'from generated data of size',
            size_utils.human_size(data_size));
    }

    let start_time = Date.now();
    let progress_time = Date.now();
    let progress_bytes = 0;

    function on_progress(progress) {
        // console.log('on_progress', progress);
        let now = Date.now();
        if (now - progress_time >= 500) {
            let percents = Math.round(progress.loaded / data_size * 100);
            let current_speed_str = (
                (progress.loaded - progress_bytes) /
                (now - progress_time) * 1000 / 1024 / 1024).toFixed(0);
            let avg_speed_str = (
                progress.loaded /
                (now - start_time) * 1000 / 1024 / 1024).toFixed(0);
            progress_time = now;
            progress_bytes = progress.loaded;
            console.log(percents + '% progress.',
                current_speed_str, 'MB/sec',
                '(~', avg_speed_str, 'MB/sec)');
        }
    }

    function on_finish(err) {
        if (err) {
            console.error('UPLOAD ERROR:', err);
            return;
        }
        let end_time = Date.now();
        let total_seconds = (end_time - start_time) / 1000;
        let speed_str = (data_size / total_seconds / 1024 / 1024).toFixed(0);
        console.log('upload done.', speed_str, 'MB/sec');
    }

    if (argv.copy) {
        const params = {
            Key: upload_key,
            CopySource: argv.bucket + '/' + argv.copy,
            ContentType: mime.lookup(upload_key) || '',
        };
        if (argv.presign) {
            console.log(s3.getSignedUrl('copyObject', params));
        } else {
            s3.copyObject(params, on_finish);
        }
        return;
    }

    if (argv.put) {
        const params = {
            Key: upload_key,
            Body: data_source,
            ContentType: mime.lookup(file_path) || '',
            ContentLength: data_size
        };
        if (argv.presign) {
            console.log(s3.getSignedUrl('putObject', params));
        } else {
            s3.putObject(params, on_finish)
                .on('httpUploadProgress', on_progress);
        }
        return;
    }

    if (!argv.perf) {
        s3.upload({
                Key: upload_key,
                Body: data_source,
                ContentType: mime.lookup(file_path),
                ContentLength: data_size
            }, {
                partSize: part_size,
                queueSize: argv.concur
            }, on_finish)
            .on('httpUploadProgress', on_progress);
        return;
    }

    if (argv.perf) {
        let progress = {
            loaded: 0
        };
        s3.createMultipartUpload({
            Key: upload_key,
            ContentType: mime.lookup(file_path),
        }, (err, create_res) => {
            if (err) {
                console.error('s3.createMultipartUpload ERROR', err);
                return;
            }
            let next_part_num = 0;
            let concur = 0;
            let finished = false;
            let latency_avg = 0;

            function complete() {
                s3.completeMultipartUpload({
                    Key: upload_key,
                    UploadId: create_res.UploadId,
                    // MultipartUpload: {
                    //     Parts: [{
                    //         ETag: etag,
                    //         PartNumber: part_num
                    //     }]
                    // }
                }, function(err2, complete_res) {
                    if (err2) {
                        console.error('s3.completeMultipartUpload ERROR', err2);
                        return;
                    }
                    console.log('uploadPart average latency',
                        (latency_avg / next_part_num).toFixed(0), 'ms');
                    on_finish();
                });
            }

            data_source.on('data', data => {
                next_part_num += 1;
                concur += 1;
                if (concur >= argv.concur) {
                    //console.log('=== pause source stream ===');
                    data_source.pause();
                }
                //console.log('uploadPart');
                let data_start_time = Date.now();
                let part_num = next_part_num;
                s3.uploadPart({
                    Key: upload_key,
                    PartNumber: part_num,
                    UploadId: create_res.UploadId,
                    Body: data,
                }, (err2, res) => {
                    concur -= 1;
                    if (err2) {
                        data_source.close();
                        console.error('s3.uploadPart ERROR', err2);
                        return;
                    }
                    let took = Date.now() - data_start_time;
                    // console.log('Part', part_num, 'Took', took, 'ms');
                    latency_avg += took;
                    data_source.resume();
                    progress.loaded += data.length;
                    if (finished && !concur) {
                        complete();
                    } else {
                        on_progress(progress);
                    }
                });
            });
            data_source.on('end', () => {
                finished = true;
                if (!concur) {
                    complete();
                }
            });
        });
        return;
    }
}

function get_object() {
    const params = {
        Key: argv.get,
    };
    if (argv.presign) {
        console.log(s3.getSignedUrl('getObject', params));
        return;
    }
    s3.headObject(params, function(err, data) {
        if (err) {
            console.error('HEAD ERROR:', err);
            return;
        }
        let data_size = parseInt(data.ContentLength, 10);
        let progress = {
            loaded: 0
        };

        console.log('object size', size_utils.human_size(data_size));
        let start_time = Date.now();
        let progress_time = Date.now();

        function on_progress(progr) {
            let now = Date.now();
            if (now - progress_time >= 500) {
                progress_time = now;
                let percents = Math.round(progr.loaded / data_size * 100);
                let passed_seconds = (now - start_time) / 1000;
                let speed_str = (progr.loaded / passed_seconds / 1024 / 1024).toFixed(0);
                console.log(percents + '% progress.', speed_str, 'MB/sec');
            }
        }

        function on_finish(err2) {
            if (err2) {
                console.error('GET ERROR:', err2);
                return;
            }
            let end_time = Date.now();
            let total_seconds = (end_time - start_time) / 1000;
            let speed_str = (data_size / total_seconds / 1024 / 1024).toFixed(0);
            console.log('get done.', speed_str, 'MB/sec');
        }

        s3.getObject(params)
            .createReadStream()
            .pipe(new stream.Writable({
                highWaterMark: 64 * 1024 * 1024,
                write: function(write_data, enc, next) {
                    progress.loaded += write_data.length;
                    on_progress(progress);
                    next();
                }
            }))
            .on('finish', on_finish)
            .on('error', on_finish);
    });
}



function print_usage() {
    console.log(`
Usage:
  --help               show this usage
List Flags:
  --ls                 list objects
  --ll                 list objects with long output
  --prefix <path>      prefix used for list objects
  --delimiter <key>    delimiter used for list objects
Get Flags:
  --get <key>          get key name
  --head <key>         head key name
Upload Flags:
  --upload <key>       upload (multipart) to key (key can be omited
  --put <key>          put (single) to key (key can be omited
  --copy <key>         copy source key from same bucket
  --file <path>        use source file from local path
  --size <MB>          if no file path, generate random data of size (default 10 GB)
  --part_size <MB>     multipart size
  --concur <num>       multipart concurrency
Delete Flags:
  --rm <key>,<key>     delete key or keys
Buckets Flags:
  --lb/buckets         list buckets
  --mb <name>          create bucket
  --rb <name>          delete bucket
General S3 Flags:
  --endpoint <host>    (default is 127.0.0.1)
  --access_key <key>   (default is env.AWS_ACCESS_KEY_ID || 123)
  --secret_key <key>   (default is env.AWS_SECRET_ACCESS_KEY || abc)
  --bucket <name>      (default is "files")
  --sig v4|s3          (default is v4)
  --ssl                (default is false) Force SSL connection
  --aws                (default is false) Use AWS endpoint and subdomain-style buckets
  --checksum           (default is false) Calculate checksums on data. slower.
  --presign            instead of running the request it prints a presigned url of the request
`);
}
