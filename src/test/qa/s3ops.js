/* Copyright (C) 2016 NooBaa */
'use strict';

const promise_utils = require('../../util/promise_utils');
let crypto = require('crypto');
let AWS = require('aws-sdk');
let P = require('../../util/promise');

const accessKeyDefault = '123';
const secretKeyDefault = 'abc';

function validate_multiplier(multiplier) {
    if (!multiplier % 1024) throw new Error(`multiplier must be in multiples of 1024`);
}

// copy_file_with_md5('127.0.0.1', 'first.bucket', 'DataSet1470756819/file1', 'DataSet1470756819/file45');

function put_file_with_md5(ip, bucket, file_name, data_size, multiplier) {
    validate_multiplier(multiplier);
    var rest_endpoint = 'http://' + ip + ':80';
    var s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        accessKeyId: accessKeyDefault,
        secretAccessKey: secretKeyDefault,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });
    bucket = bucket || 'first.bucket';
    data_size = data_size || 50;

    var actual_size = data_size * multiplier;

    var data = crypto.randomBytes(actual_size);
    let md5 = crypto.createHash('md5').update(data)
        .digest('hex');

    var params = {
        Bucket: bucket,
        Key: file_name,
        Body: data,
        Metadata: {
            md5: md5
        },
    };
    console.log(`>>> UPLOAD - About to upload object... ${file_name}, md5: ${md5}, size: ${data.length}`);
    var start_ts = Date.now();
    return P.ninvoke(s3bucket, 'putObject', params)
        .then(res => {
            console.log('Upload object took', (Date.now() - start_ts) / 1000, 'seconds');
            return md5;
        })
        .catch(err => {
            console.error('Put failed!', err);
            throw err;
        });
}

function copy_file_with_md5(ip, bucket, source, destination) {
    var rest_endpoint = 'http://' + ip + ':80';
    var s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        accessKeyId: accessKeyDefault,
        secretAccessKey: secretKeyDefault,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });
    bucket = bucket || 'first.bucket';

    var params = {
        Bucket: bucket,
        CopySource: bucket + '/' + source,
        Key: destination,
        MetadataDirective: 'COPY'
    };
    console.log('>>> COPY - About to copy object... from: ' + source + ' to: ' + destination);
    var start_ts = Date.now();
    return P.ninvoke(s3bucket, 'copyObject', params)
        .then(res => {
            console.log('Copy object took', (Date.now() - start_ts) / 1000, 'seconds');
        })
        .catch(err => {
            console.error('Copy failed!', err);
            throw err;
        });
}

function upload_file_with_md5(ip, bucket, file_name, data_size, parts_num, multiplier) {
    validate_multiplier(multiplier);
    var rest_endpoint = 'http://' + ip + ':80';
    var s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        accessKeyId: accessKeyDefault,
        secretAccessKey: secretKeyDefault,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });
    bucket = bucket || 'first.bucket';
    data_size = data_size || 50;

    var actual_size = data_size * multiplier;

    var data = crypto.randomBytes(actual_size);
    let md5 = crypto.createHash('md5').update(data)
        .digest('hex');

    var start_ts = Date.now();
    var size = Math.ceil(actual_size / parts_num);

    console.log(`>>> MultiPart UPLOAD - About to multipart upload object... ${
        file_name}, md5: ${md5}, size: ${data.length}`);
    var params = {
        Bucket: bucket,
        Key: file_name,
        Body: data,
        Metadata: {
            md5: md5
        },
    };
    var options = {
        partSize: size
    };
    return P.ninvoke(s3bucket, 'upload', params, options)
        .then(res => {
            console.log('Upload object took', (Date.now() - start_ts) / 1000, 'seconds');
            return md5;
        })
        .catch(err => {
            console.error('Put failed!', err);
            throw err;
        });
}

function get_file_check_md5(ip, bucket, file_name) {
    var rest_endpoint = 'http://' + ip + ':80';
    var s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        accessKeyId: accessKeyDefault,
        secretAccessKey: secretKeyDefault,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });

    var params = {
        Bucket: bucket,
        Key: file_name,
    };

    console.log('>>> DOWNLOAD - About to download object...' + file_name);
    var start_ts = Date.now();
    return P.ninvoke(s3bucket, 'getObject', params)
        .then(res => {
            console.log('Download object took', (Date.now() - start_ts) / 1000, 'seconds');
            var md5 = crypto.createHash('md5').update(res.Body)
                .digest('hex');
            var file_md5 = res.Metadata.md5;
            if (md5 === file_md5) {
                console.log(`uploaded MD5: ${file_md5} and downloaded MD5: ${
                    md5} - they are same, size: ${res.ContentLength}`);
            } else {
                console.error(`uploaded MD5: ${file_md5} and downloaded MD5: ${
                    md5} - they are different, size: ${res.ContentLength}`);
                throw new Error('Bad MD5 from download');
            }
        })
        .catch(err => {
            console.error('Download failed!', err);
            throw err;
        });
}

function check_MD5_all_objects(ip, bucket, prefix) {
    var rest_endpoint = 'http://' + ip + ':80';
    var s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        accessKeyId: accessKeyDefault,
        secretAccessKey: secretKeyDefault,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });

    var params = {
        Bucket: bucket,
        Prefix: prefix,
    };

    let stop = false;
    promise_utils.pwhile(
        () => !stop,
        () => P.ninvoke(s3bucket, 'listObjects', params)
            .then(res => {
                let list = res.Contents;
                if (list.length === 0) {
                    stop = true;
                } else {
                    params.Marker = list[list.length - 1].Key;
                    stop = true;
                    return P.each(list, obj => get_file_check_md5(ip, bucket, obj.Key));
                }
            }));
}

function get_a_random_file(ip, bucket, prefix) {
    var rest_endpoint = 'http://' + ip + ':80';
    var s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        accessKeyId: accessKeyDefault,
        secretAccessKey: secretKeyDefault,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });

    var params = {
        Bucket: bucket,
        Prefix: prefix,
    };

    return P.ninvoke(s3bucket, 'listObjects', params)
        .then(res => {
            let list = res.Contents;
            if (list.length === 0) {
                throw new Error('No files with prefix in bucket');
            }
            let rand = Math.floor(Math.random() * list.length);
            return list[rand];
        })
        .catch(err => {
            console.error('Get random file failed!', err);
            throw err;
        });
}
function get_list_files(ip, bucket, prefix) {
    let rest_endpoint = 'http://' + ip + ':80';
    let s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        accessKeyId: accessKeyDefault,
        secretAccessKey: secretKeyDefault,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });
    var params = {
        Bucket: bucket,
        Prefix: prefix,
    };
    var list = [];
    var listFiles = [];
    return P.ninvoke(s3bucket, 'listObjects', params)
        .then(res => {
            list = res.Contents;
            if (list.length === 0) {
                console.warn('No files with prefix in bucket');
            } else {
                list.forEach(function(file) {
                    listFiles.push({Key: file.Key});
                    console.log('files key is: ' + file.Key);
                });
            }
            return listFiles;
        })
        .catch(err => {
            console.error('Get files list failed!', err);
            throw err;
        });
}
function get_list_prefixes(ip, bucket) {
    let rest_endpoint = 'http://' + ip + ':80';
    let s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        accessKeyId: accessKeyDefault,
        secretAccessKey: secretKeyDefault,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });
    var params = {
        Bucket: bucket,
        Delimiter: "/"
    };
    var list = [];
    var listPrefixes = [];
    return P.ninvoke(s3bucket, 'listObjects', params)
        .then(res => {
            list = res.CommonPrefixes;
            if (list.length === 0) {
                console.warn('No folders in bucket');
            } else {
                list.forEach(function(prefix) {
                    listPrefixes.push(prefix.Prefix);
                    console.log('prefix is : ' + prefix.Prefix);
                });
            }
            return listPrefixes;
        })
        .catch(err => {
            console.error('Get files list failed!', err);
            throw err;
        });
}
function get_file_number(ip, bucket, prefix) {
    var rest_endpoint = 'http://' + ip + ':80';
    var s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        accessKeyId: accessKeyDefault,
        secretAccessKey: secretKeyDefault,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });

    var params = {
        Bucket: bucket,
        Prefix: prefix,
    };

    return P.ninvoke(s3bucket, 'listObjects', params)
        .then(res => {
            let list = res.Contents;
            return list.length;
        })
        .catch(err => {
            console.error('Get number of files failed!', err);
            throw err;
        });
}

function delete_file(ip, bucket, file_name) {
    var rest_endpoint = 'http://' + ip + ':80';
    var s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        accessKeyId: accessKeyDefault,
        secretAccessKey: secretKeyDefault,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });

    var params = {
        Bucket: bucket,
        Key: file_name,
    };

    var start_ts = Date.now();
    console.log('>>> DELETE - About to delete object...' + file_name);
    return P.ninvoke(s3bucket, 'deleteObject', params)
        .then(() => {
            console.log('Delete object took', (Date.now() - start_ts) / 1000, 'seconds');
            console.log('file ' + file_name + ' successfully deleted');
        })
        .catch(err => {
            console.error('Delete file failed!', err);
            throw err;
        });
}

function delete_folder(ip, bucket, ...list) {
    let rest_endpoint = 'http://' + ip + ':80';
    let s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        accessKeyId: accessKeyDefault,
        secretAccessKey: secretKeyDefault,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });
            var params = {
                Bucket: bucket,
                Delete: {Objects: list},
            };
            return P.ninvoke(s3bucket, 'deleteObjects', params)
                .catch(err => console.error('deleting objects with error' + err));
}

function get_file_size(ip, bucket, file_name) {
    let rest_endpoint = 'http://' + ip + ':80';
    let s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        accessKeyId: accessKeyDefault,
        secretAccessKey: secretKeyDefault,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });

    let params = {
        Bucket: bucket,
        Key: file_name,
    };

    return P.ninvoke(s3bucket, 'headObject', params)
        .then(res => res.ContentLength / 1024 / 1024)
        .catch(err => {
            console.error('get file size failed!', err);
            throw err;
        });
}

function set_file_attribute(ip, bucket, file_name) {
    let rest_endpoint = 'http://' + ip + ':80';
    let s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        accessKeyId: accessKeyDefault,
        secretAccessKey: secretKeyDefault,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });

    let params = {
        Bucket: bucket,
        Key: file_name,
        Tagging: {
            TagSet: [
                {
                    Key: 's3ops',
                    Value: 'set_file_attribute'
                }
            ]
        }
    };

    return P.ninvoke(s3bucket, 'putObjectTagging', params)
        .catch(err => {
            console.error('set file attribute failed!', err);
            throw err;
        });
}

function set_file_attribute_with_copy(ip, bucket, file_name) {
    let rest_endpoint = 'http://' + ip + ':80';
    let s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        accessKeyId: accessKeyDefault,
        secretAccessKey: secretKeyDefault,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });

    let params = {
        Bucket: bucket,
        Key: file_name,
    };

    return P.ninvoke(s3bucket, 'getObject', params)
        .then(res => {
            params = {
                Bucket: bucket,
                CopySource: bucket + '/' + file_name,
                Key: file_name,
                MetadataDirective: 'REPLACE',
                Metadata: {
                    md5: crypto.createHash('md5').update(res.Body)
                        .digest('hex'),
                    s3ops: 's3ops_set_file_attribute_with_copy'
                }
            };
        })
        .then(() => P.ninvoke(s3bucket, 'copyObject', params))
        .catch(err => {
            console.error('set file attribute failed!', err);
            throw err;
        });
}

function get_list_buckets(ip, accessKey, secretKey) {
    let rest_endpoint = 'http://' + ip + ':80';
    let s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });
    var params = {};
    var list = [];
    var listBuckets = [];
    return P.ninvoke(s3bucket, 'listBuckets', params)
        .then(res => {
            list = res.Buckets;
            if (list.length === 0) {
                console.warn('No buckets access');
            } else {
                list.forEach(function(bucket) {
                    listBuckets.push(bucket.Name);
                    console.log('Account has access to bucket: ' + bucket.Name);
                });
            }
            return listBuckets;
        })
        .catch(err => {
            console.error('Getting list of buckets return error: ', err);
            throw err;
        });
}
exports.put_file_with_md5 = put_file_with_md5;
exports.copy_file_with_md5 = copy_file_with_md5;
exports.upload_file_with_md5 = upload_file_with_md5;
exports.get_file_check_md5 = get_file_check_md5;
exports.check_MD5_all_objects = check_MD5_all_objects;
exports.get_a_random_file = get_a_random_file;
exports.get_file_number = get_file_number;
exports.get_list_files = get_list_files;
exports.get_list_prefixes = get_list_prefixes;
exports.get_list_buckets = get_list_buckets;
exports.delete_file = delete_file;
exports.delete_folder = delete_folder;
exports.get_file_size = get_file_size;
exports.set_file_attribute = set_file_attribute;
exports.set_file_attribute_with_copy = set_file_attribute_with_copy;
