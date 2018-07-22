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

    constructor(ip, accessKeyDefault = '123', secretKeyDefault = 'abc') {
        this.accessKeyDefault = accessKeyDefault;
        this.secretKeyDefault = secretKeyDefault;

        const rest_endpoint = 'http://' + ip + ':' + port;
        this._s3 = new AWS.S3({
            endpoint: rest_endpoint,
            accessKeyId: this.accessKeyDefault,
            secretAccessKey: this.secretKeyDefault,
            s3ForcePathStyle: true,
            sslEnabled: false,
        });
    }

    validate_multiplier(multiplier) {
        if (multiplier % 1024 !== 0) throw new Error(`multiplier must be in multiples of 1024`);
    }

    put_file_with_md5(bucket, file_name, data_size, multiplier) {
        this.validate_multiplier(multiplier);
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
        return P.ninvoke(this._s3, 'putObject', params)
            .then(res => {
                console.log('Upload object took', (Date.now() - start_ts) / 1000, 'seconds');
                return md5;
            })
            .catch(err => {
                console.error(`Put failed ${file_name}!`, err);
                throw err;
            });
    }

    server_side_copy_file_with_md5(bucket, source, destination, versionid) {
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
        return P.ninvoke(this._s3, 'copyObject', params)
            .then(res => {
                console.log('SS Copy object took', (Date.now() - start_ts) / 1000, 'seconds');
            })
            .catch(err => {
                console.error(`SS Copy failed from ${source} to ${destination}!`, err);
                throw err;
            });
    }

    client_side_copy_file_with_md5(bucket, source, destination, versionid) {
        const psource = source + (versionid ? ' v' + versionid : '');
        console.log('>>> CS COPY - About to copy object... from: ' + psource + ' to: ' + destination);

        return this.get_file_check_md5(bucket, source, {
                return_data: true,
                versionid: versionid ? versionid : undefined
            })
            .then(res => {
                const TEN_MB = 10 * 1024 * 1024;
                return this._multipart_upload_internal(bucket, destination, res.data, TEN_MB);
            });
    }

    upload_file_with_md5(bucket, file_name, data_size, parts_num, multiplier, overlook_error) {
        this.validate_multiplier(multiplier);
        data_size = data_size || 50;
        const actual_size = data_size * multiplier;
        let data = crypto.randomBytes(actual_size);
        let size = Math.ceil(actual_size / parts_num);

        return P.resolve()
            .then(() => this._multipart_upload_internal(bucket, file_name, data, size, overlook_error));
    }

    get_file_check_md5(bucket, file_name, options) {
        const return_data = options && options.return_data;
        const versionid = options && options.versionid;

        let params = {
            Bucket: bucket,
            Key: file_name,
        };

        if (versionid) {
            params.VersionId = versionid;
        }

        console.log('>>> DOWNLOAD - About to download object...' + file_name);
        let start_ts = Date.now();
        return P.ninvoke(this._s3, 'getObject', params)
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

    get_file_ranges_check_md5(bucket, file_name, parts, options) {
        const versionid = options && options.versionid;

        let params = {
            Bucket: bucket,
            Key: file_name,
        };

        if (versionid) {
            params.VersionId = versionid;
        }

        return P.ninvoke(this._s3, 'headObject', params)
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
                        this.get_object_range(bucket, file_name, start_byte, finish_byte, versionid)
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

    check_MD5_all_objects(bucket, prefix) {
        let params = {
            Bucket: bucket,
            Prefix: prefix,
        };

        let stop = false;
        promise_utils.pwhile(
            () => !stop,
            () => P.ninvoke(this._s3, 'listObjects', params)
            .then(res => {
                let list = res.Contents;
                if (list.length === 0) {
                    stop = true;
                } else {
                    params.Marker = list[list.length - 1].Key;
                    stop = true;
                    return P.each(list, obj => this.get_file_check_md5(bucket, obj.Key));
                }
            }));
    }

    get_a_random_file(bucket, prefix) {
        let params = {
            Bucket: bucket,
            Prefix: prefix,
        };

        return P.ninvoke(this._s3, 'listObjects', params)
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

    get_a_random_version_file(bucket, prefix) {
        let params = {
            Bucket: bucket,
            Prefix: prefix,
        };

        return P.ninvoke(this._s3, 'listObjectVersions', params)
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

    get_list_files(bucket, prefix, param = { supress_logs: false, maxKeys: 1000, version: false }) {
        const supress_logs = param.supress_logs;
        const MaxKeys = param.maxKeys;
        let ops = 'listObjects';
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
        return P.ninvoke(this._s3, ops, params)
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
                    list.forEach(file => {
                        listFiles.push(_.omitBy(_.pick(file, ['Key', 'VersionId']), !_.isUndefined));
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

    get_list_multipart_uploads(bucket) {
        let params = {
            Bucket: bucket,
        };
        let list = [];
        let listFiles = [];
        return P.ninvoke(this._s3, 'listMultipartUploads', params)
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

    get_list_multipart_uploads_filters(bucket, delimiter, key_marker, max_uploads, prefix, uploadIdMarker) {
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
        return P.ninvoke(this._s3, 'listMultipartUploads', params)
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

    get_list_prefixes(bucket) {
        let params = {
            Bucket: bucket,
            Delimiter: "/"
        };
        let list = [];
        let listPrefixes = [];
        return P.ninvoke(this._s3, 'listObjects', params)
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

    get_file_number(bucket, prefix) {
        let params = {
            Bucket: bucket,
            Prefix: prefix,
        };

        return P.ninvoke(this._s3, 'listObjects', params)
            .then(res => {
                let list = res.Contents;
                return list.length;
            })
            .catch(err => {
                console.error(`get_file_number:: listObjects ${params} failed!`, err);
                throw err;
            });
    }

    delete_file(bucket, file_name, versionid) {
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
        return P.ninvoke(this._s3, 'deleteObject', params)
            .then(() => {
                console.log('Delete object took', (Date.now() - start_ts) / 1000, 'seconds');
                console.log('file ' + file_name + ' successfully deleted');
            })
            .catch(err => {
                console.error(`Delete file ${file_name} failed!`, err);
                throw err;
            });
    }

    delete_multiple_files(bucket, files) {
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
        console.log(`>>> MULTI DELETE - About to delete multiple objects... ${files.length}`);
        return P.ninvoke(this._s3, 'deleteObjects', params)
            .then(() => {
                console.log('Multi delete took', (Date.now() - start_ts) / 1000, 'seconds');
                console.log(`${files.length} files successfully deleted`);
            })
            .catch(err => {
                console.error(`Multi delete failed! ${util.inspect(files)}`, err);
                throw err;
            });
    }

    delete_all_objects_in_bucket(bucket, is_versioning) {
        let run_list = true;
        console.log(`cleaning all files from ${bucket}`);
        promise_utils.pwhile(
            () => run_list,
            () => this.get_list_files(bucket, '', { maxKeys: 1000, version: is_versioning, supress_logs: true })
            .then(list => {
                console.log(`Partial list_files.length is ${list.length}`);
                if (list.length < 1000) {
                    run_list = false;
                }
                return this.delete_multiple_files(bucket, _.map(list, item => {
                    let i = { filename: item.Key };
                    if (item.VersionId) {
                        i.versionid = item.VersionId;
                    }
                    return i;
                }));
            })
        );
    }

    get_file_size(bucket, file_name) {
        let params = {
            Bucket: bucket,
            Key: file_name,
        };

        return P.ninvoke(this._s3, 'headObject', params)
            .then(res => res.ContentLength / 1024 / 1024)
            .catch(err => {
                console.error(`get file size ${file_name} failed!`, err);
                throw err;
            });
    }

    set_file_attribute(bucket, file_name, versionid) {
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

        return P.ninvoke(this._s3, 'putObjectTagging', params)
            .catch(err => {
                console.error(`set file attribute failed! ${file_name}`, err);
                throw err;
            });
    }

    set_file_attribute_with_copy(bucket, file_name, versionid) {
        let params = {
            Bucket: bucket,
            Key: file_name,
        };

        if (versionid) {
            params.VersionId = versionid;
        }

        const psource = file_name + (versionid ? ' v' + versionid : '');
        console.log(`>>> SS SET FILE ATTR WITH COPY - on ${psource}`);

        return P.ninvoke(this._s3, 'getObject', params)
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
            .then(() => P.ninvoke(this._s3, 'copyObject', params))
            .catch(err => {
                console.error(`set file attribute failed ${file_name}!`, err);
                throw err;
            });
    }

    get_list_buckets(accessKeyId = this.accessKeyDefault, secretAccessKey = this.secretKeyDefault) {
        let params = {};
        let list = [];
        let listBuckets = [];
        return P.ninvoke(this._s3, 'listBuckets', params)
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

    create_bucket(bucket_name) {
        let params = {
            Bucket: bucket_name,
        };

        return P.ninvoke(this._s3, 'createBucket', params)
            .then(res => console.log("Created bucket ", res))
            .catch(err => {
                console.error(`creating bucket ${bucket_name} is failed!`, err);
                throw err;
            });
    }

    delete_bucket(bucket_name) {
        let params = {
            Bucket: bucket_name,
        };
        return P.ninvoke(this._s3, 'deleteBucket', params)
            .then(res => console.log("Deleted bucket ", res))
            .catch(err => {
                console.error(`Deleting bucket ${bucket_name} is failed!`, err);
                throw err;
            });
    }

    get_object_uploadId(bucket, object_name) {
        let params = {
            Bucket: bucket,
        };
        let list = [];
        let dataObject = [];
        let uploadObjectId;
        return P.ninvoke(this._s3, 'listMultipartUploads', params)
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

    get_bucket_uploadId(bucket) {
        let params = {};
        let list = [];
        let dataBucket = [];
        let uploadBucketId;
        return P.ninvoke(this._s3, 'listBuckets', params)
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

    is_bucket_exist(bucket) {
        let params = {
            Bucket: bucket
        };
        let existBucket = true;
        return P.ninvoke(this._s3, 'headBucket', params)
            .catch(err => {
                console.log('Bucket is not exist', err);
                existBucket = false;
                return existBucket;
            });
    }

    get_object(bucket, key) {
        let params = {
            Bucket: bucket,
            Key: key
        };
        console.log('Reading object ', key);
        return P.ninvoke(this._s3, 'getObject', params)
            .catch(err => {
                console.error(`get_object:: getObject ${JSON.stringify(params)} failed!`, err);
                throw err;
            });
    }

    get_object_range(bucket, key, start_byte, finish_byte, versionid) {
        let params = {
            Bucket: bucket,
            Key: key,
            Range: `bytes=${start_byte}-${finish_byte}`
        };

        if (versionid) {
            params.VersionId = versionid;
        }

        console.log(`Reading object ${key} ${versionid ? versionid : ''} from ${start_byte} to ${finish_byte}`);
        return P.ninvoke(this._s3, 'getObject', params)
            .then(res => res.Body)
            .catch(err => {
                console.error(`get_object_range:: getObject ${JSON.stringify(params)} failed!`, err);
                throw err;
            });
    }

    abort_multipart_upload(bucket, file_name, uploadId) {
        bucket = bucket || 'first.bucket';

        const params = {
            Bucket: bucket,
            Key: file_name,
            UploadId: uploadId
        };


        return P.ninvoke(this._s3, 'abortMultipartUpload', params)
            .then(res => {
                console.log(`Upload ${uploadId} of filename: ${file_name} was aborted successfully`);
            })
            .catch(err => {
                console.error(`Abort failed ${file_name}, UploadId: ${uploadId}!`, err);
                throw err;
            });
    }

    create_multipart_upload(bucket, file_name) {
        const params = {
            Bucket: bucket,
            Key: file_name,
        };

        return P.ninvoke(this._s3, 'createMultipartUpload', params)
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
    _multipart_upload_internal(bucket, file_name, data, size, overlook_error) {
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

        return P.ninvoke(this._s3, 'upload', params, options)
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
