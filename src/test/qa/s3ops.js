'use strict';

const promise_utils = require('../../util/promise_utils');
let crypto = require('crypto');
let AWS = require('aws-sdk');
let P = require('../../util/promise');

const accessKeyDefault = '123';
const secretKeyDefault = 'abc';

// copy_file_with_md5('127.0.0.1', 'files', 'DataSet1470756819/file1', 'DataSet1470756819/file45');

function put_file_with_md5(ip, bucket, file_name, data_size) {
    var rest_endpoint = 'http://' + ip + ':80';
    var s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        accessKeyId: accessKeyDefault,
        secretAccessKey: secretKeyDefault,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });
    bucket = bucket || 'files';
    data_size = data_size || 50;

    var actual_size = data_size * 1024 * 1024;

    var data = crypto.randomBytes(actual_size);
    let md5 = crypto.createHash('md5').update(data).digest('hex');

    var params = {
        Bucket: bucket,
        Key: file_name,
        Body: data,
        Metadata: {
            md5: md5
        },
    };
    console.log('>>> UPLOAD - About to upload object... ' + file_name);
    var start_ts = Date.now();
    return P.ninvoke(s3bucket, 'putObject', params)
        .then(res => {
            console.log('Upload object took', (Date.now() - start_ts) / 1000, 'seconds');
            return md5;
        }).catch(err => {
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
    bucket = bucket || 'files';

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
        }).catch(err => {
            console.error('Copy failed!', err);
            throw err;
        });
}

function upload_file_with_md5(ip, bucket, file_name, data_size, parts_num) {
    var rest_endpoint = 'http://' + ip + ':80';
    var s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        accessKeyId: accessKeyDefault,
        secretAccessKey: secretKeyDefault,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });
    bucket = bucket || 'files';
    data_size = data_size || 50;

    var actual_size = data_size * 1024 * 1024;

    var data = crypto.randomBytes(actual_size);
    let md5 = crypto.createHash('md5').update(data).digest('hex');

    console.log('>>> MultiPart UPLOAD - About to multipart upload object...' + file_name);
    var start_ts = Date.now();
    var offset = 0;
    var size = Math.ceil(actual_size / parts_num);
    var uploadID = 0;
    return P.ninvoke(s3bucket, 'createMultipartUpload', {
            Bucket: bucket,
            Key: file_name,
            Metadata: {
                md5: md5,
            },
        })
        .then(function(res) {
            var promises = [];
            uploadID = res.UploadId;
            for (var i = 0; i < parts_num; i++) {
                var part_data = data.slice(offset, offset + size);
                offset += size;
                promises[i] = P.ninvoke(s3bucket, 'uploadPart', {
                    Key: file_name,
                    Bucket: bucket,
                    PartNumber: i,
                    UploadId: uploadID,
                    Body: part_data,
                });
            }
            return P.all(promises);
        }).then(() => {
            console.log('Upload object took', (Date.now() - start_ts) / 1000, 'seconds');
            P.ninvoke(s3bucket, 'completeMultipartUpload', {
                Key: file_name,
                Bucket: bucket,
                UploadId: uploadID,
            });
            return md5;
        }).catch(err => {
            console.error('Multipart upload failed!', err);
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
            var md5 = crypto.createHash('md5').update(res.Body).digest('hex');
            var file_md5 = res.Metadata.md5;
            if (md5 === file_md5) {
                console.log("uploaded MD5: " + file_md5 + " and downloaded MD5: " + md5 + " - they are same :)");
            } else {
                console.error("uploaded MD5: " + file_md5 + " and downloaded MD5: " + md5 + " - they are different :(");
                throw new Error('Bad MD5 from download');
            }
        }).catch(err => {
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
        () => {
            return P.ninvoke(s3bucket, 'listObjects', params)
                .then(function(res) {
                    let list = res.Contents;
                    if (list.length === 0) {
                        stop = true;
                    } else {
                        params.Marker = list[list.length - 1].Key;
                        stop = true;
                        return P.each(list, obj => get_file_check_md5(ip, bucket, obj.Key));
                    }
                });
        }
    );
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
        .then(function(res) {
            let list = res.Contents;
            if (list.length === 0) {
                throw new Error('No files with prefix in bucket');
            }
            let rand = Math.floor(Math.random() * list.length);
            return list[rand];
        }).catch(err => {
            console.error('Get random file failed!', err);
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
        .then(function(res) {
            let list = res.Contents;
            return list.length;
        }).catch(err => {
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
        .then(function() {
            console.log('Delete object took', (Date.now() - start_ts) / 1000, 'seconds');
            console.log('file ' + file_name + ' successfully deleted');
        }).catch(err => {
            console.error('Delete file failed!', err);
            throw err;
        });
}

exports.get_file_number = get_file_number;
exports.put_file_with_md5 = put_file_with_md5;
exports.upload_file_with_md5 = upload_file_with_md5;
exports.copy_file_with_md5 = copy_file_with_md5;
exports.get_file_check_md5 = get_file_check_md5;
exports.check_MD5_all_objects = check_MD5_all_objects;
exports.get_a_random_file = get_a_random_file;
exports.delete_file = delete_file;
