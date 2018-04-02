/* Copyright (C) 2016 NooBaa */
'use strict';

const promise_utils = require('../../util/promise_utils');
const crypto = require('crypto');
const AWS = require('aws-sdk');
const P = require('../../util/promise');

const accessKeyDefault = '123';
const secretKeyDefault = 'abc';

function validate_multiplier(multiplier) {
    if (!multiplier % 1024) throw new Error(`multiplier must be in multiples of 1024`);
}

function put_file_with_md5(ip, bucket, file_name, data_size, multiplier) {
    validate_multiplier(multiplier);
    const rest_endpoint = 'http://' + ip + ':80';
    const s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        accessKeyId: accessKeyDefault,
        secretAccessKey: secretKeyDefault,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });
    bucket = bucket || 'first.bucket';
    data_size = data_size || 50;

    const actual_size = data_size * multiplier;

    let data = crypto.randomBytes(actual_size);
    let md5 = crypto.createHash('md5').update(data)
        .digest('hex');

    let params = {
        Bucket: bucket,
        Key: file_name,
        Body: data,
        Metadata: {
            md5: md5
        },
    };
    console.log(`>>> UPLOAD - About to upload object... ${file_name}, md5: ${md5}, size: ${data.length}`);
    let start_ts = Date.now();
    return P.ninvoke(s3bucket, 'putObject', params)
        .then(res => {
            console.log('Upload object took', (Date.now() - start_ts) / 1000, 'seconds');
            return md5;
        })
        .catch(err => {
            console.error(`Put failed ${file_name}!`, err);
            throw err;
        });
}

function server_side_copy_file_with_md5(ip, bucket, source, destination) {
    const rest_endpoint = 'http://' + ip + ':80';
    const s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        accessKeyId: accessKeyDefault,
        secretAccessKey: secretKeyDefault,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });
    bucket = bucket || 'first.bucket';

    let params = {
        Bucket: bucket,
        CopySource: bucket + '/' + source,
        Key: destination,
        MetadataDirective: 'COPY'
    };
    console.log('>>> SS COPY - About to copy object... from: ' + source + ' to: ' + destination);
    let start_ts = Date.now();
    return P.ninvoke(s3bucket, 'copyObject', params)
        .then(res => {
            console.log('SS Copy object took', (Date.now() - start_ts) / 1000, 'seconds');
        })
        .catch(err => {
            console.error(`SS Copy failed from ${source} to ${destination}!`, err);
            throw err;
        });
}

function client_side_copy_file_with_md5(ip, bucket, source, destination) {
    console.log('>>> CS COPY - About to copy object... from: ' + source + ' to: ' + destination);

    return get_file_check_md5(ip, bucket, source, true)
        .then(res => {
            const TEN_MB = 10 * 1024 * 1024;
            return _multipart_upload_internal(ip, bucket, destination, res.data, TEN_MB);
        });
}

function upload_file_with_md5(ip, bucket, file_name, data_size, parts_num, multiplier, overlook_error) {
    validate_multiplier(multiplier);
    data_size = data_size || 50;
    const actual_size = data_size * multiplier;
    let data = crypto.randomBytes(actual_size);
    let size = Math.ceil(actual_size / parts_num);

    return P.resolve()
        .then(() => _multipart_upload_internal(ip, bucket, file_name, data, size, overlook_error));
}

function get_file_check_md5(ip, bucket, file_name, return_data) {
    const rest_endpoint = 'http://' + ip + ':80';
    const s3bucket = new AWS.S3({
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

    console.log('>>> DOWNLOAD - About to download object...' + file_name);
    let start_ts = Date.now();
    return P.ninvoke(s3bucket, 'getObject', params)
        .then(res => {
            console.log('Download object took', (Date.now() - start_ts) / 1000, 'seconds');
            let md5 = crypto.createHash('md5').update(res.Body)
                .digest('hex');
            let file_md5 = res.Metadata.md5;
            if (md5 === file_md5) {
                console.log(`uploaded ${file_name} MD5: ${file_md5} and downloaded MD5: ${
                    md5} - they are same, size: ${res.ContentLength}`);
            } else {
                console.error(`uploaded ${file_name} MD5: ${file_md5} and downloaded MD5: ${
                    md5} - they are different, size: ${res.ContentLength}`);
                throw new Error('Bad MD5 from download');
            }
            if (return_data) {
                return {
                    data: res.Body,
                    length: res.ContentLength
                };
            }
        })
        .catch(err => {
            console.error(`Download failed for ${file_name}!`, err);
            throw err;
        });
}

function get_file_ranges_check_md5(ip, bucket, file_name, parts) {
    const rest_endpoint = 'http://' + ip + ':80';
    const s3bucket = new AWS.S3({
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
        .then(res => {
            let start_byte = 0;
            let file_md5;
            let md5 = crypto.createHash('md5');
            file_md5 = res.Metadata.md5;
            const file_size = res.ContentLength;
            const jump = Math.floor(file_size / parts);
            let finish_byte = start_byte + jump;
            console.log(`>>> READ_RANGE - About to read object... ${file_name}, md5: ${file_md5}, parts: ${parts}`);
            return promise_utils.pwhile(() => start_byte < file_size, () =>
                    get_object_range(ip, bucket, file_name, start_byte, finish_byte)
                    .then(data => {
                        md5.update(data);
                        start_byte = finish_byte + 1;
                        finish_byte = (start_byte + jump) > file_size ? file_size : (start_byte + jump);
                    })
                )
                .then(() => {
                    const md5_digest = md5.digest('hex');
                    if (md5_digest === file_md5) {
                        console.log(`uploaded ${file_name} MD5: ${file_md5} and downloaded MD5:
                        ${md5_digest} - they are same, size: ${file_size}`);
                    } else {
                        console.error(`uploaded ${file_name} MD5: ${file_md5} and downloaded MD5:
                        ${md5_digest} - they are different, size: ${file_size}`);
                        throw new Error('Bad MD5 from download');
                    }
                })
                .catch(err => {
                    console.error(`Download failed for ${file_name}!`, err);
                    throw err;
                });
        });
}

function check_MD5_all_objects(ip, bucket, prefix) {
    const rest_endpoint = 'http://' + ip + ':80';
    const s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        accessKeyId: accessKeyDefault,
        secretAccessKey: secretKeyDefault,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });

    let params = {
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
    const rest_endpoint = 'http://' + ip + ':80';
    const s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        accessKeyId: accessKeyDefault,
        secretAccessKey: secretKeyDefault,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });

    let params = {
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
            console.error(`get_a_random_file:: listObjects ${params} failed!`, err);
            throw err;
        });
}

function get_list_files(ip, bucket, prefix) {
    const rest_endpoint = 'http://' + ip + ':80';
    const s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        accessKeyId: accessKeyDefault,
        secretAccessKey: secretKeyDefault,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });
    let params = {
        Bucket: bucket,
        Prefix: prefix,
    };
    let list = [];
    let listFiles = [];
    return P.ninvoke(s3bucket, 'listObjects', params)
        .then(res => {
            list = res.Contents;
            if (list.length === 0) {
                console.warn('No files with prefix in bucket');
            } else {
                list.forEach(function(file) {
                    listFiles.push({ Key: file.Key });
                    console.log('files key is: ' + file.Key);
                });
            }
            return listFiles;
        })
        .catch(err => {
            console.error(`get_list_files:: listObjects ${params} failed!`, err);
            throw err;
        });
}

function get_list_multipart_uploads(ip, bucket) {
    const rest_endpoint = 'http://' + ip + ':80';
    const s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        accessKeyId: accessKeyDefault,
        secretAccessKey: secretKeyDefault,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });
    let params = {
        Bucket: bucket,
    };
    let list = [];
    let listFiles = [];
    return P.ninvoke(s3bucket, 'listMultipartUploads', params)
        .then(res => {
            list = res.Uploads;
            if (list.length === 0) {
                console.warn('No objects in bucket');
            } else {
                list.forEach(function(file) {
                    listFiles.push({ Key: file.Key });
                    console.log('files key is: ' + file.Key);
                });
            }
            return listFiles;
        })
        .catch(err => {
            console.error(`get_list_multipart_uploads:: listMultipartUploads ${params} failed!`, err);
            throw err;
        });
}

function get_list_multipart_uploads_filters(ip, bucket, delimiter, key_marker, max_uploads, prefix, uploadIdMarker) {
    const rest_endpoint = 'http://' + ip + ':80';
    const s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        accessKeyId: accessKeyDefault,
        secretAccessKey: secretKeyDefault,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });
    let params = {
        Bucket: bucket,
        Delimiter: delimiter,
        KeyMarker: key_marker,
        MaxUploads: max_uploads,
        Prefix: prefix,
        UploadIdMarker: uploadIdMarker
    };
    let list = [];
    let listFiles = [];
    return P.ninvoke(s3bucket, 'listMultipartUploads', params)
        .then(res => {
            console.log(JSON.stringify(res));
            list = res.Uploads;
            if (list.length === 0) {
                console.warn('No objects in bucket with filters: ' + JSON.stringify(params));
            } else {
                list.forEach(function(file) {
                    listFiles.push({ Key: file.Key });
                    console.log('files key is: ' + file.Key);
                });
            }
            return listFiles;
        })
        .catch(err => {
            console.error(`get_list_multipart_uploads:: listMultipartUploads ${params} failed!`, err);
            throw err;
        });
}

function get_list_prefixes(ip, bucket) {
    const rest_endpoint = 'http://' + ip + ':80';
    const s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        accessKeyId: accessKeyDefault,
        secretAccessKey: secretKeyDefault,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });
    let params = {
        Bucket: bucket,
        Delimiter: "/"
    };
    let list = [];
    let listPrefixes = [];
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
            console.error(`get_list_prefixes:: listObjects ${params} failed!`, err);
            throw err;
        });
}

function get_file_number(ip, bucket, prefix) {
    const rest_endpoint = 'http://' + ip + ':80';
    const s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        accessKeyId: accessKeyDefault,
        secretAccessKey: secretKeyDefault,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });

    let params = {
        Bucket: bucket,
        Prefix: prefix,
    };

    return P.ninvoke(s3bucket, 'listObjects', params)
        .then(res => {
            let list = res.Contents;
            return list.length;
        })
        .catch(err => {
            console.error(`get_file_number:: listObjects ${params} failed!`, err);
            throw err;
        });
}

function delete_file(ip, bucket, file_name) {
    const rest_endpoint = 'http://' + ip + ':80';
    const s3bucket = new AWS.S3({
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

    let start_ts = Date.now();
    console.log('>>> DELETE - About to delete object...' + file_name);
    return P.ninvoke(s3bucket, 'deleteObject', params)
        .then(() => {
            console.log('Delete object took', (Date.now() - start_ts) / 1000, 'seconds');
            console.log('file ' + file_name + ' successfully deleted');
        })
        .catch(err => {
            console.error(`Delete file ${file_name} failed!`, err);
            throw err;
        });
}

function delete_folder(ip, bucket, ...list) {
    const rest_endpoint = 'http://' + ip + ':80';
    const s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        accessKeyId: accessKeyDefault,
        secretAccessKey: secretKeyDefault,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });
    let params = {
        Bucket: bucket,
        Delete: { Objects: list },
    };
    return P.ninvoke(s3bucket, 'deleteObjects', params)
        .catch(err => console.error(`deleting objects ${params} with error ` + err));
}

function get_file_size(ip, bucket, file_name) {
    const rest_endpoint = 'http://' + ip + ':80';
    const s3bucket = new AWS.S3({
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
            console.error(`get file size ${file_name} failed!`, err);
            throw err;
        });
}

function set_file_attribute(ip, bucket, file_name) {
    const rest_endpoint = 'http://' + ip + ':80';
    const s3bucket = new AWS.S3({
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
            TagSet: [{
                Key: 's3ops',
                Value: 'set_file_attribute'
            }]
        }
    };

    return P.ninvoke(s3bucket, 'putObjectTagging', params)
        .catch(err => {
            console.error(`set file attribute failed! ${file_name}`, err);
            throw err;
        });
}

function set_file_attribute_with_copy(ip, bucket, file_name) {
    const rest_endpoint = 'http://' + ip + ':80';
    const s3bucket = new AWS.S3({
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
            console.error(`set file attribute failed ${file_name}!`, err);
            throw err;
        });
}

function get_list_buckets(ip, accessKeyId = accessKeyDefault, secretAccessKey = secretKeyDefault) {
    const rest_endpoint = 'http://' + ip + ':80';
    const s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        accessKeyId,
        secretAccessKey,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });
    let params = {};
    let list = [];
    let listBuckets = [];
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

function create_bucket(ip, bucket_name) {
    const rest_endpoint = 'http://' + ip + ':80';
    const s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        accessKeyId: accessKeyDefault,
        secretAccessKey: secretKeyDefault,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });

    let params = {
        Bucket: bucket_name,
    };

    return P.ninvoke(s3bucket, 'createBucket', params)
        .then(res => console.log("Created bucket ", res))
        .catch(err => {
            console.error(`creating bucket ${bucket_name} is failed!`, err);
            throw err;
        });
}

function delete_bucket(ip, bucket_name) {
    const rest_endpoint = 'http://' + ip + ':80';
    const s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        accessKeyId: accessKeyDefault,
        secretAccessKey: secretKeyDefault,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });
    let params = {
        Bucket: bucket_name,
    };
    return P.ninvoke(s3bucket, 'deleteBucket', params)
        .then(res => console.log("Deleted bucket ", res))
        .catch(err => {
            console.error(`Deleting bucket ${bucket_name} is failed!`, err);
            throw err;
        });
}

function get_object_uploadId(ip, bucket, object_name) {
    const rest_endpoint = 'http://' + ip + ':80';
    const s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        accessKeyId: accessKeyDefault,
        secretAccessKey: secretKeyDefault,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });
    let params = {
        Bucket: bucket,
    };
    let list = [];
    let dataObject = [];
    let uploadObjectId;
    return P.ninvoke(s3bucket, 'listMultipartUploads', params)
        .then(res => {
            list = res.Uploads;
            if (list.length === 0) {
                console.warn('No objects in bucket ', bucket);
            } else {
                //TODO:: What happends if find does not find anything
                dataObject = list.find(content => content.Key === object_name);
                if (!dataObject) throw new Error('Object key wasn\'t found');
                console.log('Object has data: ', JSON.stringify(dataObject));
                uploadObjectId = dataObject.UploadId;
            }
            return uploadObjectId;
        })
        .catch(err => {
            //console.error('get_object_uploadId:: listMultipart failed!', err);
            throw err;
        });
}

function get_bucket_uploadId(ip, bucket) {
    const rest_endpoint = 'http://' + ip + ':80';
    const s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        accessKeyId: accessKeyDefault,
        secretAccessKey: secretKeyDefault,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });
    let params = {};
    let list = [];
    let dataBucket = [];
    let uploadBucketId;
    return P.ninvoke(s3bucket, 'listBuckets', params)
        .then(res => {
            list = res.Contents;
            if (list.length === 0) {
                console.warn('No buckets ');
            } else {
                //TODO:: What happends if find does not find anything
                dataBucket = list.find(buckets => buckets.Name === bucket);
                console.log('Bucket data info is ', JSON.stringify(dataBucket));
                uploadBucketId = dataBucket.Owner.ID;
            }
            return uploadBucketId;
        })
        .catch(err => {
            console.error('get_bucket_uploadId:: listBuckets failed!', err);
            throw err;
        });
}

function is_bucket_exist(ip, bucket) {
    const rest_endpoint = 'http://' + ip + ':80';
    const s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        accessKeyId: accessKeyDefault,
        secretAccessKey: secretKeyDefault,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });
    let params = {
        Bucket: bucket
    };
    let existBucket = true;
    return P.ninvoke(s3bucket, 'headBucket', params)
        .catch(err => {
            console.log('Bucket is not exist', err);
            existBucket = false;
            return existBucket;
        });
}

function get_object(ip, bucket, key) {
    const rest_endpoint = 'http://' + ip + ':80';
    const s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        accessKeyId: accessKeyDefault,
        secretAccessKey: secretKeyDefault,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });
    let params = {
        Bucket: bucket,
        Key: key
    };
    console.log('Reading object ', key);
    return P.ninvoke(s3bucket, 'getObject', params)
        .catch(err => {
            console.error(`get_object:: getObject ${params} failed!`, err);
            throw err;
        });
}

function get_object_range(ip, bucket, key, start_byte, finish_byte) {
    const rest_endpoint = 'http://' + ip + ':80';
    const s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        accessKeyId: accessKeyDefault,
        secretAccessKey: secretKeyDefault,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });
    let params = {
        Bucket: bucket,
        Key: key,
        Range: `bytes=${start_byte}-${finish_byte}`
    };
    console.log(`Reading object ${key} from ${start_byte} to ${finish_byte}`, params);
    return P.ninvoke(s3bucket, 'getObject', params)
        .then(res => res.Body)
        .catch(err => {
            console.error(`get_object_range:: getObject ${params} failed!`, err);
            throw err;
        });
}

function abort_multipart_upload(ip, bucket, file_name, uploadId) {
    const rest_endpoint = 'http://' + ip + ':80';
    const s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        accessKeyId: accessKeyDefault,
        secretAccessKey: secretKeyDefault,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });
    bucket = bucket || 'first.bucket';

    const params = {
        Bucket: bucket,
        Key: file_name,
        UploadId: uploadId
    };


    return P.ninvoke(s3bucket, 'abortMultipartUpload', params)
        .then(res => {
            console.log(`Upload ${uploadId} of filename: ${file_name} was aborted successfully`);
        })
        .catch(err => {
            console.error(`Abort failed ${file_name}, UploadId: ${uploadId}!`, err);
            throw err;
        });
}

/*
 * Internal Utils
 */
function _multipart_upload_internal(ip, bucket, file_name, data, size, overlook_error) {
    const rest_endpoint = 'http://' + ip + ':80';
    const s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        accessKeyId: accessKeyDefault,
        secretAccessKey: secretKeyDefault,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });
    bucket = bucket || 'first.bucket';

    let md5 = crypto.createHash('md5').update(data).digest('hex');

    let params = {
        Bucket: bucket,
        Key: file_name,
        Body: data,
        Metadata: {
            md5: md5
        },
    };
    let options;
    if (size) {
        options = {
            partSize: size
        };
    }

    let start_ts = Date.now();
    console.log(`>>> MultiPart UPLOAD - About to multipart upload object... ${
        file_name}, md5: ${md5}, size: ${data.length}`);

    return P.ninvoke(s3bucket, 'upload', params, options)
        .then(res => {
            console.log('Upload object took', (Date.now() - start_ts) / 1000, 'seconds');
            return md5;
        })
        .catch(err => {
            if (overlook_error) return;
            console.error(`Upload failed ${file_name}!`, err);
            throw err;
        });
}


exports.get_list_multipart_uploads = get_list_multipart_uploads;
exports.get_list_multipart_uploads_filters = get_list_multipart_uploads_filters;
exports.delete_bucket = delete_bucket;
exports.get_object_uploadId = get_object_uploadId;
exports.get_bucket_uploadId = get_bucket_uploadId;
exports.is_bucket_exist = is_bucket_exist;
exports.put_file_with_md5 = put_file_with_md5;
exports.server_side_copy_file_with_md5 = server_side_copy_file_with_md5;
exports.client_side_copy_file_with_md5 = client_side_copy_file_with_md5;
exports.upload_file_with_md5 = upload_file_with_md5;
exports.get_file_check_md5 = get_file_check_md5;
exports.get_file_ranges_check_md5 = get_file_ranges_check_md5;
exports.check_MD5_all_objects = check_MD5_all_objects;
exports.get_a_random_file = get_a_random_file;
exports.get_file_number = get_file_number;
exports.get_list_files = get_list_files;
exports.get_list_prefixes = get_list_prefixes;
exports.create_bucket = create_bucket;
exports.get_list_buckets = get_list_buckets;
exports.delete_file = delete_file;
exports.delete_folder = delete_folder;
exports.get_file_size = get_file_size;
exports.set_file_attribute = set_file_attribute;
exports.set_file_attribute_with_copy = set_file_attribute_with_copy;
exports.get_object = get_object;
exports.abort_multipart_upload = abort_multipart_upload;
