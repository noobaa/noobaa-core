/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const AWS = require('aws-sdk');
const util = require('util');
const crypto = require('crypto');
const P = require('../../util/promise');
const promise_utils = require('../../util/promise_utils');


require('../../util/dotenv').load();
const port = process.env.ENDPOINT_PORT || 80;

class S3OPS {

    constructor(accessKeyDefault = '123', secretKeyDefault = 'abc') {
        this.accessKeyDefault = accessKeyDefault;
        this.secretKeyDefault = secretKeyDefault;
    }

    validate_multiplier(multiplier) {
        if (multiplier % 1024 !== 0) throw new Error(`multiplier must be in multiples of 1024`);
    }

    put_file_with_md5(ip, bucket, file_name, data_size, multiplier) {
        this.validate_multiplier(multiplier);
        const rest_endpoint = 'http://' + ip + ':' + port;
        const s3bucket = new AWS.S3({
            endpoint: rest_endpoint,
            accessKeyId: this.accessKeyDefault,
            secretAccessKey: this.secretKeyDefault,
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

    server_side_copy_file_with_md5(ip, bucket, source, destination, versionid) {
        const rest_endpoint = 'http://' + ip + ':' + port;
        const s3bucket = new AWS.S3({
            endpoint: rest_endpoint,
            accessKeyId: this.accessKeyDefault,
            secretAccessKey: this.secretKeyDefault,
            s3ForcePathStyle: true,
            sslEnabled: false,
        });
        bucket = bucket || 'first.bucket';

        let params = {
            Bucket: bucket,
            CopySource: bucket + '/' + source + (versionid ? `?versionId=${versionid}` : ''),
            Key: destination,
            MetadataDirective: 'COPY'
        };
        const psource = source + (versionid ? ' v' + versionid : '');
        console.log('>>> SS COPY - About to copy object... from: ' + psource + ' to: ' + destination);
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

    client_side_copy_file_with_md5(ip, bucket, source, destination, versionid) {
        const psource = source + (versionid ? ' v' + versionid : '');
        console.log('>>> CS COPY - About to copy object... from: ' + psource + ' to: ' + destination);

        return this.get_file_check_md5(ip, bucket, source, {
                return_data: true,
                versionid: versionid ? versionid : undefined
            })
            .then(res => {
                const TEN_MB = 10 * 1024 * 1024;
                return this._multipart_upload_internal(ip, bucket, destination, res.data, TEN_MB);
            });
    }

    upload_file_with_md5(ip, bucket, file_name, data_size, parts_num, multiplier, overlook_error) {
        this.validate_multiplier(multiplier);
        data_size = data_size || 50;
        const actual_size = data_size * multiplier;
        let data = crypto.randomBytes(actual_size);
        let size = Math.ceil(actual_size / parts_num);

        return P.resolve()
            .then(() => this._multipart_upload_internal(ip, bucket, file_name, data, size, overlook_error));
    }

    get_file_check_md5(ip, bucket, file_name, options) {
        const return_data = options && options.return_data;
        const versionid = options && options.versionid;
        const rest_endpoint = 'http://' + ip + ':' + port;
        const s3bucket = new AWS.S3({
            endpoint: rest_endpoint,
            accessKeyId: this.accessKeyDefault,
            secretAccessKey: this.secretKeyDefault,
            s3ForcePathStyle: true,
            sslEnabled: false,
        });

        let params = {
            Bucket: bucket,
            Key: file_name,
        };

        if (versionid) {
            params.VersionId = versionid;
        }

        console.log('>>> DOWNLOAD - About to download object...' + file_name);
        let start_ts = Date.now();
        return P.ninvoke(s3bucket, 'getObject', params)
            .then(res => {
                console.log('Download object took', (Date.now() - start_ts) / 1000, 'seconds');
                let md5 = crypto.createHash('md5').update(res.Body)
                    .digest('hex');
                let file_md5 = res.Metadata.md5;
                if (md5 === file_md5) {
                    console.log(`file ${file_name} MD5 is: ${file_md5} on upload and download, size: ${res.ContentLength}`);
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

    get_file_ranges_check_md5(ip, bucket, file_name, parts, options) {
        const rest_endpoint = 'http://' + ip + ':' + port;
        const versionid = options && options.versionid;
        const s3bucket = new AWS.S3({
            endpoint: rest_endpoint,
            accessKeyId: this.accessKeyDefault,
            secretAccessKey: this.secretKeyDefault,
            s3ForcePathStyle: true,
            sslEnabled: false,
        });

        let params = {
            Bucket: bucket,
            Key: file_name,
        };

        if (versionid) {
            params.VersionId = versionid;
        }

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
                        this.get_object_range(ip, bucket, file_name, start_byte, finish_byte, versionid)
                        .then(data => {
                            md5.update(data);
                            start_byte = finish_byte + 1;
                            finish_byte = (start_byte + jump) > file_size ? file_size : (start_byte + jump);
                        })
                    )
                    .then(() => {
                        const md5_digest = md5.digest('hex');
                        if (md5_digest === file_md5) {
                            console.log(`file ${file_name} MD5 is: ${file_md5} on upload and download, size: ${file_size}`);
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

    check_MD5_all_objects(ip, bucket, prefix) {
        const rest_endpoint = 'http://' + ip + ':' + port;
        const s3bucket = new AWS.S3({
            endpoint: rest_endpoint,
            accessKeyId: this.accessKeyDefault,
            secretAccessKey: this.secretKeyDefault,
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
                    return P.each(list, obj => this.get_file_check_md5(ip, bucket, obj.Key));
                }
            }));
    }

    get_a_random_file(ip, bucket, prefix) {
        const rest_endpoint = 'http://' + ip + ':' + port;
        const s3bucket = new AWS.S3({
            endpoint: rest_endpoint,
            accessKeyId: this.accessKeyDefault,
            secretAccessKey: this.secretKeyDefault,
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

    get_a_random_version_file(ip, bucket, prefix) {
        const rest_endpoint = 'http://' + ip + ':' + port;
        const s3bucket = new AWS.S3({
            endpoint: rest_endpoint,
            accessKeyId: this.accessKeyDefault,
            secretAccessKey: this.secretKeyDefault,
            s3ForcePathStyle: true,
            sslEnabled: false,
        });

        let params = {
            Bucket: bucket,
            Prefix: prefix,
        };

        return P.ninvoke(s3bucket, 'listObjectVersions', params)
            .then(res => {
                let list = res.Versions;
                if (list.length === 0) {
                    throw new Error('No files with prefix in bucket');
                }
                let rand = Math.floor(Math.random() * list.length); //Take a random version , not delete marker and return key and versionid
                return list[rand];
            })
            .catch(err => {
                console.error(`get_a_random_file:: listObjectVersions ${params} failed!`, err);
                throw err;
            });
    }

    get_list_files(ip, bucket, prefix, param = { supress_logs: false, maxKeys: 1000, version: false }) {
        const supress_logs = param.supress_logs;
        const MaxKeys = param.maxKeys;
        let ops = 'listObjects';
        const rest_endpoint = 'http://' + ip + ':' + port;
        const s3bucket = new AWS.S3({
            endpoint: rest_endpoint,
            accessKeyId: this.accessKeyDefault,
            secretAccessKey: this.secretKeyDefault,
            s3ForcePathStyle: true,
            sslEnabled: false,
        });
        let params = {
            Bucket: bucket,
            Prefix: prefix,
            MaxKeys,
        };
        let list = [];
        let listFiles = [];
        if (param.version) {
            ops = 'listObjectVersions';
        }
        return P.ninvoke(s3bucket, ops, params)
            .then(res => {
                if (param.version) {
                    list = res.Versions;
                    list = list.concat(res.DeleteMarkers);
                } else {
                    list = res.Contents;
                }
                if (list.length === 0) {
                    if (!supress_logs) {
                        console.warn('No files with prefix in bucket');
                    }
                } else {
                    list.forEach(function(file) {
                        listFiles.push({ Key: file.Key, VersionId: file.VersionId });
                        if (!supress_logs) {
                            console.log('files key is: ' + file.Key);
                        }
                    });
                }
                return listFiles;
            })
            .catch(err => {
                console.error(`get_list_files:: ${ops} ${params} failed!`, err);
                throw err;
            });
    }

    get_list_multipart_uploads(ip, bucket) {
        const rest_endpoint = 'http://' + ip + ':' + port;
        const s3bucket = new AWS.S3({
            endpoint: rest_endpoint,
            accessKeyId: this.accessKeyDefault,
            secretAccessKey: this.secretKeyDefault,
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

    get_list_multipart_uploads_filters(ip, bucket, delimiter, key_marker, max_uploads, prefix, uploadIdMarker) {
        const rest_endpoint = 'http://' + ip + ':' + port;
        const s3bucket = new AWS.S3({
            endpoint: rest_endpoint,
            accessKeyId: this.accessKeyDefault,
            secretAccessKey: this.secretKeyDefault,
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

    get_list_prefixes(ip, bucket) {
        const rest_endpoint = 'http://' + ip + ':' + port;
        const s3bucket = new AWS.S3({
            endpoint: rest_endpoint,
            accessKeyId: this.accessKeyDefault,
            secretAccessKey: this.secretKeyDefault,
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

    get_file_number(ip, bucket, prefix) {
        const rest_endpoint = 'http://' + ip + ':' + port;
        const s3bucket = new AWS.S3({
            endpoint: rest_endpoint,
            accessKeyId: this.accessKeyDefault,
            secretAccessKey: this.secretKeyDefault,
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

    delete_file(ip, bucket, file_name, versionid) {
        const rest_endpoint = 'http://' + ip + ':' + port;
        const s3bucket = new AWS.S3({
            endpoint: rest_endpoint,
            accessKeyId: this.accessKeyDefault,
            secretAccessKey: this.secretKeyDefault,
            s3ForcePathStyle: true,
            sslEnabled: false,
        });

        let params = {
            Bucket: bucket,
            Key: file_name,
        };

        if (versionid) {
            params.VersionId = versionid;
        }

        let start_ts = Date.now();
        const psource = file_name + (versionid ? 'v' + versionid : '');
        console.log('>>> DELETE - About to delete object...' + psource);
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

    delete_multiple_files(ip, bucket, files) {
        const rest_endpoint = 'http://' + ip + ':' + port;
        const s3bucket = new AWS.S3({
            endpoint: rest_endpoint,
            accessKeyId: this.accessKeyDefault,
            secretAccessKey: this.secretKeyDefault,
            s3ForcePathStyle: true,
            sslEnabled: false,
        });

        let params = {
            Bucket: bucket,
            Delete: {
                Objects: []
            }
        };

        for (const f of files) {
            let item = {
                Key: f.filename,
            };
            if (f.versionid) {
                item.VersionId = f.versionid;
            }
            params.Delete.Objects.push(item);
        }

        let start_ts = Date.now();
        console.log(`>>> MULTI DELETE - About to delete multiple objects... ${util.inspect(files)}`);
        return P.ninvoke(s3bucket, 'deleteObjects', params)
            .then(() => {
                console.log('Multi delete took', (Date.now() - start_ts) / 1000, 'seconds');
                console.log(`files ${util.inspect(files)} successfully deleted`);
            })
            .catch(err => {
                console.error(`Multi delete failed! ${util.inspect(files)}`, err);
                throw err;
            });
    }

    delete_folder(ip, bucket, ...list) {
        const rest_endpoint = 'http://' + ip + ':' + port;
        const s3bucket = new AWS.S3({
            endpoint: rest_endpoint,
            accessKeyId: this.accessKeyDefault,
            secretAccessKey: this.secretKeyDefault,
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

    delete_all_objects_in_bucket(ip, bucket, is_version) {
        let run_list = true;
        console.log(`cleaning all files from ${bucket} in ${ip}`);
        promise_utils.pwhile(
            () => run_list,
            () => this.get_list_files(ip, bucket, '', { maxKeys: 1000, version: is_version })
            .then(list => {
                console.log(`Partial list_files.length is ${list.length}`);
                if (list.length < 1000) {
                    run_list = false;
                }
                return this.delete_multiple_files(ip, bucket, _.map(list, item => {
                    let i = { filename: item.Key };
                    if (item.VersionId) {
                        i.versionid = item.VersionId;
                    }
                }));
            })
        );
    }

    get_file_size(ip, bucket, file_name) {
        const rest_endpoint = 'http://' + ip + ':' + port;
        const s3bucket = new AWS.S3({
            endpoint: rest_endpoint,
            accessKeyId: this.accessKeyDefault,
            secretAccessKey: this.secretKeyDefault,
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

    set_file_attribute(ip, bucket, file_name, versionid) {
        const rest_endpoint = 'http://' + ip + ':' + port;
        const s3bucket = new AWS.S3({
            endpoint: rest_endpoint,
            accessKeyId: this.accessKeyDefault,
            secretAccessKey: this.secretKeyDefault,
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

        if (versionid) {
            params.VersionId = versionid;
        }

        const psource = file_name + (versionid ? ' v' + versionid : '');
        console.log('>>> SS SET FILE ATTR - on' + psource);

        return P.ninvoke(s3bucket, 'putObjectTagging', params)
            .catch(err => {
                console.error(`set file attribute failed! ${file_name}`, err);
                throw err;
            });
    }

    set_file_attribute_with_copy(ip, bucket, file_name, versionid) {
        const rest_endpoint = 'http://' + ip + ':' + port;
        const s3bucket = new AWS.S3({
            endpoint: rest_endpoint,
            accessKeyId: this.accessKeyDefault,
            secretAccessKey: this.secretKeyDefault,
            s3ForcePathStyle: true,
            sslEnabled: false,
        });

        let params = {
            Bucket: bucket,
            Key: file_name,
        };

        if (versionid) {
            params.VersionId = versionid;
        }

        const psource = file_name + (versionid ? ' v' + versionid : '');
        console.log(`>>> SS SET FILE ATTR WITH COPY - on ${psource}`);

        return P.ninvoke(s3bucket, 'getObject', params)
            .then(res => {
                params = {
                    Bucket: bucket,
                    CopySource: bucket + '/' + file_name + (versionid ? `?versionId=${versionid}` : ''),
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

    get_list_buckets(ip, accessKeyId = this.accessKeyDefault, secretAccessKey = this.secretKeyDefault) {
        const rest_endpoint = 'http://' + ip + ':' + port;
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

    create_bucket(ip, bucket_name) {
        const rest_endpoint = 'http://' + ip + ':' + port;
        const s3bucket = new AWS.S3({
            endpoint: rest_endpoint,
            accessKeyId: this.accessKeyDefault,
            secretAccessKey: this.secretKeyDefault,
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

    delete_bucket(ip, bucket_name) {
        const rest_endpoint = 'http://' + ip + ':' + port;
        const s3bucket = new AWS.S3({
            endpoint: rest_endpoint,
            accessKeyId: this.accessKeyDefault,
            secretAccessKey: this.secretKeyDefault,
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

    get_object_uploadId(ip, bucket, object_name) {
        const rest_endpoint = 'http://' + ip + ':' + port;
        const s3bucket = new AWS.S3({
            endpoint: rest_endpoint,
            accessKeyId: this.accessKeyDefault,
            secretAccessKey: this.secretKeyDefault,
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
                    console.warn('No uploads for bucket ', bucket);
                    throw new Error('No upload for buckets' + bucket);
                } else {
                    //TODO:: What happends if find does not find anything
                    dataObject = list.find(content => content.Key === object_name);
                    if (!dataObject) throw new Error('Object key wasn\'t found');
                    console.log(`Object ${dataObject.Key} UploadId is: ${dataObject.UploadId}`);
                    uploadObjectId = dataObject.UploadId;
                }
                return uploadObjectId;
            })
            .catch(err => {
                //console.error('get_object_uploadId:: listMultipart failed!', err);
                throw err;
            });
    }

    get_bucket_uploadId(ip, bucket) {
        const rest_endpoint = 'http://' + ip + ':' + port;
        const s3bucket = new AWS.S3({
            endpoint: rest_endpoint,
            accessKeyId: this.accessKeyDefault,
            secretAccessKey: this.secretKeyDefault,
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

    is_bucket_exist(ip, bucket) {
        const rest_endpoint = 'http://' + ip + ':' + port;
        const s3bucket = new AWS.S3({
            endpoint: rest_endpoint,
            accessKeyId: this.accessKeyDefault,
            secretAccessKey: this.secretKeyDefault,
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

    get_object(ip, bucket, key) {
        const rest_endpoint = 'http://' + ip + ':' + port;
        const s3bucket = new AWS.S3({
            endpoint: rest_endpoint,
            accessKeyId: this.accessKeyDefault,
            secretAccessKey: this.secretKeyDefault,
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
                console.error(`get_object:: getObject ${JSON.stringify(params)} failed!`, err);
                throw err;
            });
    }

    get_object_range(ip, bucket, key, start_byte, finish_byte, versionid) {
        const rest_endpoint = 'http://' + ip + ':' + port;
        const s3bucket = new AWS.S3({
            endpoint: rest_endpoint,
            accessKeyId: this.accessKeyDefault,
            secretAccessKey: this.secretKeyDefault,
            s3ForcePathStyle: true,
            sslEnabled: false,
        });

        let params = {
            Bucket: bucket,
            Key: key,
            Range: `bytes=${start_byte}-${finish_byte}`
        };

        if (versionid) {
            params.VersionId = versionid;
        }

        console.log(`Reading object ${key} ${versionid ? versionid : ''} from ${start_byte} to ${finish_byte}`);
        return P.ninvoke(s3bucket, 'getObject', params)
            .then(res => res.Body)
            .catch(err => {
                console.error(`get_object_range:: getObject ${JSON.stringify(params)} failed!`, err);
                throw err;
            });
    }

    abort_multipart_upload(ip, bucket, file_name, uploadId) {
        const rest_endpoint = 'http://' + ip + ':' + port;
        const s3bucket = new AWS.S3({
            endpoint: rest_endpoint,
            accessKeyId: this.accessKeyDefault,
            secretAccessKey: this.secretKeyDefault,
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

    create_multipart_upload(ip, bucket, file_name) {
        const rest_endpoint = 'http://' + ip + ':' + port;
        const s3bucket = new AWS.S3({
            endpoint: rest_endpoint,
            accessKeyId: this.accessKeyDefault,
            secretAccessKey: this.secretKeyDefault,
            s3ForcePathStyle: true,
            sslEnabled: false,
        });

        const params = {
            Bucket: bucket,
            Key: file_name,
        };

        return P.ninvoke(s3bucket, 'createMultipartUpload', params)
            .then(res => {
                console.log(`Initiated multipart upload filename: ${file_name} uploadId ${res.UploadId}`);
                return res.UploadId;
            })
            .catch(err => {
                console.error(`Initiating multipart upload failed ${file_name}`, err);
                throw err;
            });
    }

    /*
     * Internal Utils
     */
    _multipart_upload_internal(ip, bucket, file_name, data, size, overlook_error) {
        const rest_endpoint = 'http://' + ip + ':' + port;
        const s3bucket = new AWS.S3({
            endpoint: rest_endpoint,
            accessKeyId: this.accessKeyDefault,
            secretAccessKey: this.secretKeyDefault,
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

}

exports.S3OPS = S3OPS;
