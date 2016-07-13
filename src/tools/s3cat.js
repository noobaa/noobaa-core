'use strict';

let _ = require('lodash');
let fs = require('fs');
let stream = require('stream');
let moment = require('moment');
let mime = require('mime');
let http = require('http');
let crypto = require('crypto');
let AWS = require('aws-sdk');
var argv = require('minimist')(process.argv);
let size_utils = require('../util/size_utils');
let RandStream = require('../util/rand_stream');

argv.bucket = argv.bucket || 'files';

let s3_config = {
    accessKeyId: argv.access_key || process.env.AWS_ACCESS_KEY_ID || '123',
    secretAccessKey: argv.secret_key || process.env.AWS_SECRET_ACCESS_KEY || 'abc',
    sslEnabled: argv.ssl || false,
    computeChecksums: argv.checksum || false,
    region: argv.region || 'us-east-1',
    httpOptions: {
        agent: new http.Agent({
            keepAlive: true
        })
    }
};
if (argv.aws) {
    s3_config.signatureVersion = argv.sigver || 'v4';
    // s3_config.s3ForcePathStyle = false;
} else {
    s3_config.endpoint = argv.endpoint || 'http://127.0.0.1';
    s3_config.signatureVersion = argv.sigver || 's3'; // use s3/v4, v2 seems irrelevant
    s3_config.s3ForcePathStyle = true;
}
let s3 = new AWS.S3(s3_config);

if (argv.help) {
    print_usage();
} else if (argv.upload || argv.put) {
    upload_file();
} else if (argv.delete) {
    delete_objects();
} else if (argv.get) {
    get_file();
} else if (argv.head) {
    if (_.isString(argv.head)) {
        head_file();
    } else {
        head_bucket();
    }
} else if (argv.lb || argv.buckets) {
    list_buckets();
} else if (argv.mb) {
    create_bucket();
} else if (argv.rb) {
    delete_bucket();
} else if (argv.list || argv.ls || argv.ll || true) {
    list_objects();
}

function list_objects() {
    s3.listObjects({
        Bucket: argv.bucket,
        Prefix: argv.prefix,
        Delimiter: argv.delimiter,
    }, function(err, data) {
        if (err) {
            console.error('LIST ERROR:', err.stack);
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

function list_buckets() {
    s3.listBuckets(function(err, data) {
        if (err) {
            console.error('LIST BUCKETS ERROR:', err);
            return;
        }
        _.each(data.Buckets, bucket => {
            console.log(bucket.Name);
        });
    });
}

function create_bucket() {
    s3.createBucket({
        Bucket: argv.mb
    }, (err, data) => {
        if (err) {
            console.error('CREATE BUCKET ERROR:', err);
            return;
        }
        console.log('CREATED BUCKET', data);
    });
}

function delete_bucket() {
    s3.deleteBucket({
        Bucket: argv.rb
    }, (err, data) => {
        if (err) {
            console.error('DELETE BUCKET ERROR:', err);
            return;
        }
        console.log('DELETED BUCKET', data);
    });
}

function head_bucket() {
    s3.headBucket({
        Bucket: argv.bucket
    }, (err, data) => {
        if (err) {
            console.error('HEAD BUCKET ERROR:', err);
            return;
        }
        console.log('HEAD BUCKET', data);
    });
}

function head_file() {
    s3.headObject({
        Bucket: argv.bucket,
        Key: argv.head
    }, (err, data) => {
        if (err) {
            console.error('HEAD OBJECT ERROR:', err);
            return;
        }
        console.log('HEAD OBJECT', data);
    });
}

function delete_objects() {
    var arr = argv.keys.split(",");
    var objs = {
        Bucket: argv.bucket,
        Delete: {
            Objects: _.map(arr, obj => ({
                Key: obj,
            }))
        }
    };
    s3.deleteObjects(objs, function(err, data) {
        if (err) {
            console.error('Delete ERROR:', err.stack);
            return;
        }
        console.log(data);
    });
}

function upload_file() {
    let bucket = argv.bucket;
    let file_path = argv.file || '';
    let upload_key =
        _.isString(argv.upload) && argv.upload ||
        _.isString(argv.put) && argv.put ||
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
        s3.copyObject({
            Bucket: bucket,
            Key: upload_key,
            CopySource: bucket + '/' + argv.copy,
            ContentType: mime.lookup(upload_key) || '',
        }, on_finish);
    } else if (argv.put) {
        s3.putObject({
                Key: upload_key,
                Bucket: bucket,
                Body: data_source,
                ContentType: mime.lookup(file_path) || '',
                ContentLength: data_size
            }, on_finish)
            .on('httpUploadProgress', on_progress);
    } else if (argv.perf) {
        let progress = {
            loaded: 0
        };
        s3.createMultipartUpload({
            Key: upload_key,
            Bucket: bucket,
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
                    Bucket: bucket,
                    UploadId: create_res.UploadId,
                    // MultipartUpload: {
                    //     Parts: [{
                    //         ETag: etag,
                    //         PartNumber: part_num
                    //     }]
                    // }
                }, function(err, complete_res) {
                    if (err) {
                        console.error('s3.completeMultipartUpload ERROR', err);
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
                let start_time = Date.now();
                let part_num = next_part_num;
                s3.uploadPart({
                    Key: upload_key,
                    Bucket: bucket,
                    PartNumber: part_num,
                    UploadId: create_res.UploadId,
                    Body: data,
                }, (err, res) => {
                    concur -= 1;
                    if (err) {
                        data_source.close();
                        console.error('s3.uploadPart ERROR', err);
                        return;
                    }
                    let took = Date.now() - start_time;
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
    } else {
        s3.upload({
                Key: upload_key,
                Bucket: bucket,
                Body: data_source,
                ContentType: mime.lookup(file_path),
                ContentLength: data_size
            }, {
                partSize: part_size,
                queueSize: argv.concur
            }, on_finish)
            .on('httpUploadProgress', on_progress);
    }
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
        let progress = {
            loaded: 0
        };

        console.log('object size', size_utils.human_size(data_size));

        function on_progress(progress) {
            let now = Date.now();
            if (now - progress_time >= 500) {
                progress_time = now;
                let percents = Math.round(progress.loaded / data_size * 100);
                let passed_seconds = (now - start_time) / 1000;
                let speed_str = (progress.loaded / passed_seconds / 1024 / 1024).toFixed(0);
                console.log(percents + '% progress.', speed_str, 'MB/sec');
            }
        }

        function on_finish(err) {
            if (err) {
                console.error('GET ERROR:', err);
                return;
            }
            let end_time = Date.now();
            let total_seconds = (end_time - start_time) / 1000;
            let speed_str = (data_size / total_seconds / 1024 / 1024).toFixed(0);
            console.log('get done.', speed_str, 'MB/sec');
        }

        s3.getObject({
                Bucket: argv.bucket,
                Key: argv.get,
            })
            .createReadStream()
            .pipe(new stream.Writable({
                highWaterMark: 64 * 1024 * 1024,
                write: function(data, enc, next) {
                    progress.loaded += data.length;
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
General S3 Flags:
  --endpoint <host>    (default is 127.0.0.1)
  --access_key <key>   (default is 123)
  --secret_key <key>   (default is abc)
  --bucket <name>      (default is "files")
List Objects Flags:
  --list/ls            list objects
  --long/ll            list objects with long output
  --prefix <path>      prefix used for list objects
  --delimiter <key>    delimiter used for list objects
Upload Flags:
  --upload <key>       upload (multipart) to key (key can be omited
  --put <key>          put (single) to key (key can be omited
  --copy <key>         copy source key from same bucket
  --file <path>        use source file from local path
  --size <MB>          if no file path, generate random data of size (default 10 GB)
  --part_size <MB>     multipart size
  --concur <num>       multipart concurrency
Get Flags:
  --get <key>          get key name
  --head <key>         head key name
Delete Flags:
  --delete             delete key or keys
  --keys <key>,<key>   list of keys
Buckets Flags:
  --lb/buckets         list buckets
  --mb <name>          create bucket
  --rb <name>          delete bucket
`);
}
