/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const AWS = require('aws-sdk');
const util = require('util');
const https = require('https');
const stream = require('stream');
const crypto = require('crypto');
const P = require('../../util/promise');
const RandStream = require('../../util/rand_stream');
const promise_utils = require('../../util/promise_utils');

require('../../util/dotenv').load();

const port = process.env.ENDPOINT_PORT || 80;
const ssl_port = process.env.ENDPOINT_SSL_PORT || 443;

const verify_md5_map = new Map();

class S3OPS {

    constructor({
        ip = '127.0.0.1',
        access_key = '123',
        secret_key = 'abc',
        use_https = true,
        sig_ver = 'v4',
        system_verify_name = 'default',
    }) {
        this.ip = ip;
        this.access_key = access_key;
        this.secret_key = secret_key;
        this.system_verify_name = system_verify_name;

        if (sig_ver === 'v4' && !use_https) {
            throw new Error('You cannot do this: SigV4 requires https to disable body signing and send streams...');
        }
        const rest_endpoint = use_https ? `https://${ip}:${ssl_port}` : `http://${ip}:${port}`;
        this.s3 = new AWS.S3({
            endpoint: rest_endpoint,
            accessKeyId: access_key,
            secretAccessKey: secret_key,
            s3ForcePathStyle: true,
            sslEnabled: false,
            // when using sigv4 we need to disable body sigining to allow sending streams as body,
            // in addition disabling body sigining requires working with https
            s3DisableBodySigning: true,
            signatureVersion: sig_ver,
            httpOptions: use_https ? {
                agent: new https.Agent({
                    keepAlive: true,
                    rejectUnauthorized: false,
                })
            } : undefined,
        });
    }

    validate_multiplier(multiplier) {
        if (multiplier % 1024 !== 0) throw new Error(`multiplier must be in multiples of 1024`);
    }

    async put_file_with_md5(bucket, file_name, data_size, multiplier) {
        try {
            this.validate_multiplier(multiplier);
            bucket = bucket || 'first.bucket';
            data_size = data_size || 50;

            const actual_size = data_size * multiplier;
            const md5_stream = new_md5_stream();
            const input_stream = new RandStream(actual_size, {
                highWaterMark: 1024 * 1024,
            });

            console.log(`>>> UPLOAD - About to upload object... ${file_name}, size: ${actual_size}`);
            let start_ts = Date.now();
            await this.s3.putObject({
                Bucket: bucket,
                Key: file_name,
                Body: input_stream.pipe(md5_stream),
                ContentLength: actual_size, //when doing stream we need to give the size
            }).promise();
            console.log('Upload object took', (Date.now() - start_ts) / 1000, 'seconds');
            const md5_hex = md5_stream.md5.digest('hex');
            console.log(`Uploaded md5: ${md5_hex} size: ${md5_stream.size}`);
            verify_md5_map.set(`${this.system_verify_name}/${bucket}/${file_name}`, md5_hex);
            return md5_hex;
        } catch (err) {
            console.error(`Put failed ${file_name}!`, err);
            throw err;
        }
    }

    async server_side_copy_file_with_md5(bucket, source, destination, versionid) {
        try {
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
            await this.s3.copyObject(params).promise();
            const file_md5 = verify_md5_map.get(`${this.system_verify_name}/${bucket}/${source}`);
            verify_md5_map.set(`${this.system_verify_name}/${bucket}/${destination}`, file_md5);
            console.log('SS Copy object took', (Date.now() - start_ts) / 1000, 'seconds');
        } catch (err) {
            console.error(`SS Copy failed from ${source} to ${destination}!`, err);
            throw err;
        }
    }

    async client_side_copy_file_with_md5(bucket, source, destination, versionid) {
        const psource = source + (versionid ? ' v' + versionid : '');
        console.log(`>>> CS COPY - About to copy object... from: ${psource} to: ${destination}`);

        const part_size = 10 * 1024 * 1024;
        const pass_through = new stream.PassThrough();

        await Promise.all([
            this.get_file_check_md5(bucket, source, {
                versionid: versionid ? versionid : undefined,
                target_stream: pass_through,
            }),
            // This will fail if the part size is less then 5MB, then we need to do putObject insted of upload.
            this._multipart_upload_internal(bucket, destination, pass_through, part_size)
        ]);
    }

    async upload_file_with_md5(bucket, file_name, data_size, parts_num, multiplier, overlook_error) {
        this.validate_multiplier(multiplier);
        data_size = data_size || 50;
        const actual_size = data_size * multiplier;
        let part_size = Math.ceil(actual_size / parts_num);
        //Making sure that the part size is not less then 5MB.
        if (part_size < 5242880) {
            part_size = actual_size;
        }
        const input_stream = new RandStream(actual_size, {
            highWaterMark: 1024 * 1024,
        });
        return this._multipart_upload_internal(bucket, file_name, input_stream, part_size, overlook_error);
    }

    async get_file_check_md5(bucket, file_name, options) {
        try {
            const versionid = options && options.versionid;
            const target_stream = (options && options.target_stream) ||
                new stream.Writable({
                    write(buf, encoding, next) {
                        next();
                    }
                });

            console.log('>>> DOWNLOAD - About to download object...' + file_name);
            const start_ts = Date.now();
            const req = this.s3.getObject({
                Bucket: bucket,
                Key: file_name,
                VersionId: versionid ? versionid : undefined,
            });
            const read_stream = req.createReadStream();
            const md5_stream = new_md5_stream();
            read_stream.pipe(md5_stream).pipe(target_stream);
            await new Promise((resolve, reject) => {
                read_stream.once('error', reject);
                read_stream.once('finish', resolve);
            });
            const md5_hex = md5_stream.md5.digest('hex');
            const res = req.response.httpResponse;

            console.log('Download object took', (Date.now() - start_ts) / 1000, 'seconds');
            const file_md5 = verify_md5_map.get(`${this.system_verify_name}/${bucket}/${file_name}`);
            const file_size = Number(res.headers['content-length']);
            if (md5_hex === file_md5) {
                console.log(`file ${file_name} MD5 is: ${file_md5} on upload and download, size: ${file_size}`);
            } else {
                console.error(`uploaded ${file_name} MD5: ${file_md5} and downloaded MD5: ${
                    md5_hex} - they are different, size: ${file_size}`);
                throw new Error('Bad MD5 from download');
            }
        } catch (err) {
            console.error(`Download failed for ${file_name}!`, err);
            throw err;
        }
    }

    async get_file_ranges_check_md5(bucket, file_name, parts, options) {
        const versionid = options && options.versionid;
        const res = await this.s3.headObject({
            Bucket: bucket,
            Key: file_name,
            VersionId: versionid ? versionid : undefined,
        }).promise();
        let start_byte = 0;
        let file_md5;
        let md5 = crypto.createHash('md5');
        // file_md5 = res.Metadata.md5;
        file_md5 = verify_md5_map.get(`${this.system_verify_name}/${bucket}/${file_name}`);
        const file_size = res.ContentLength;
        const jump = Math.floor(file_size / parts);
        let finish_byte = start_byte + jump;
        console.log(`>>> READ_RANGE - About to read object... ${file_name}, md5: ${file_md5}, parts: ${parts}`);
        try {
            await promise_utils.pwhile(() => start_byte < file_size, () =>
                this.get_object_range(bucket, file_name, start_byte, finish_byte, versionid)
                .then(data => {
                    md5.update(data);
                    start_byte = finish_byte + 1;
                    finish_byte = (start_byte + jump) > file_size ? file_size : (start_byte + jump);
                })
            );
            const md5_digest = md5.digest('hex');
            if (md5_digest === file_md5) {
                console.log(`file ${file_name} MD5 is: ${file_md5} on upload and download, size: ${file_size}`);
            } else {
                console.error(`uploaded ${file_name} MD5: ${file_md5} and downloaded MD5:
                        ${md5_digest} - they are different, size: ${file_size}`);
                throw new Error('Bad MD5 from download');
            }
        } catch (err) {
            console.error(`Download failed for ${file_name}!`, err);
            throw err;
        }
    }

    async check_MD5_all_objects(bucket, prefix) {

        let params = {
            Bucket: bucket,
            Prefix: prefix,
        };
        const { Contents: list } = await this.s3.listObjects(params).promise();
        if (list.length !== 0) {
            params.Marker = list[list.length - 1].Key;
            for (const obj of list) {
                await this.get_file_check_md5(bucket, obj.Key);
            }
        }
    }

    async get_a_random_file(bucket, prefix) {
        try {
            const { Contents: list } = await this.s3.listObjects({
                Bucket: bucket,
                Prefix: prefix,
            }).promise();
            if (list.length === 0) {
                throw new Error('No files with prefix in bucket');
            }
            let rand = Math.floor(Math.random() * list.length);
            return list[rand];
        } catch (err) {
            console.error(`get_a_random_file:: listObjects - Bucket: ${bucket}, Prefix: ${prefix} failed!`, err);
            throw err;
        }
    }

    async get_a_random_version_file(bucket, prefix) {
        try {
            const { Versions: list } = await this.s3.listObjectVersions({
                Bucket: bucket,
                Prefix: prefix,
            }).promise();
            if (list.length === 0) {
                throw new Error('No files with prefix in bucket');
            }
            let rand = Math.floor(Math.random() * list.length); //Take a random version , not delete marker and return key and versionid
            return list[rand];
        } catch (err) {
            console.error(`get_a_random_file:: listObjectVersions - Bucket: ${bucket}, Prefix: ${prefix} failed!`, err);
            throw err;
        }
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
        return P.ninvoke(this.s3, ops, params)
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

    async get_list_multipart_uploads(bucket) {
        let listFiles = [];
        try {
            const { Uploads: list } = await this.s3.listMultipartUploads({ Bucket: bucket }).promise();
            if (list.length === 0) {
                console.warn('No objects in bucket');
            } else {
                for (const file of list) {
                    listFiles.push({ Key: file.Key });
                    console.log('files key is: ' + file.Key);
                }
            }
            return listFiles;
        } catch (err) {
            console.error(`get_list_multipart_uploads:: listMultipartUploads - Bucket: ${bucket} failed!`, err);
            throw err;
        }
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
        return P.ninvoke(this.s3, 'listMultipartUploads', params)
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

    async get_list_prefixes(bucket) {
        let listPrefixes = [];
        try {
            const { CommonPrefixes: list } = await this.s3.listObjects({
                Bucket: bucket,
                Delimiter: "/"
            }).promise();
            if (list.length === 0) {
                console.warn('No folders in bucket');
            } else {
                for (const prefix of list) {
                    listPrefixes.push(prefix.Prefix);
                    console.log('prefix is : ' + prefix.Prefix);
                }
            }
            return listPrefixes;
        } catch (err) {
            console.error(`get_list_prefixes:: listObjects - Bucket: ${bucket},  Delimiter: "/" failed!`, err);
            throw err;
        }
    }

    async get_file_number(bucket, prefix) {
        try {
            const { Contents: list } = await this.s3.listObjects({
                Bucket: bucket,
                Prefix: prefix,
            }).promise();
            return list.length;
        } catch (err) {
            console.error(`get_file_number:: listObjects - Bucket: ${bucket}, Prefix: ${prefix} failed!`, err);
            throw err;
        }
    }

    async delete_file(bucket, file_name, versionid) {
        try {
            let start_ts = Date.now();
            const psource = file_name + (versionid ? 'v' + versionid : '');
            console.log('>>> DELETE - About to delete object...' + psource);
            await this.s3.deleteObject({
                Bucket: bucket,
                Key: file_name,
                VersionId: versionid ? versionid : undefined,
            }).promise();
            console.log('Delete object took', (Date.now() - start_ts) / 1000, 'seconds');
            console.log('file ' + file_name + ' successfully deleted');
        } catch (err) {
            console.error(`Delete file ${file_name} failed!`, err);
            throw err;
        }
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
        return P.ninvoke(this.s3, 'deleteObjects', params)
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
        console.log(`cleaning all files from ${bucket} in ${this.ip}`);
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

        return P.ninvoke(this.s3, 'headObject', params)
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

        return P.ninvoke(this.s3, 'putObjectTagging', params)
            .catch(err => {
                console.error(`set file attribute failed! ${file_name}`, err);
                throw err;
            });
    }

    async set_file_attribute_with_copy(bucket, file_name, versionid) {
        try {
            const psource = file_name + (versionid ? ' v' + versionid : '');
            console.log(`>>> SS SET FILE ATTR WITH COPY - on ${psource}`);
            const head = await this.s3.headObject({
                Bucket: bucket,
                Key: file_name,
                VersionId: versionid ? versionid : undefined,
            }).promise();
            await this.s3.copyObject({
                Bucket: bucket,
                CopySource: bucket + '/' + file_name + (versionid ? `?versionId=${versionid}` : ''),
                Key: file_name,
                MetadataDirective: 'REPLACE',
                Metadata: Object.assign(head.Metadata, {
                    s3ops: 's3ops_set_file_attribute_with_copy'
                })
            }).promise();
        } catch (err) {
            console.error(`set file attribute failed ${file_name}!`, err);
            throw err;
        }
    }

    get_list_buckets() {
        let params = {};
        let list = [];
        let listBuckets = [];
        return P.ninvoke(this.s3, 'listBuckets', params)
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

        return P.ninvoke(this.s3, 'createBucket', params)
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
        return P.ninvoke(this.s3, 'deleteBucket', params)
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
        return P.ninvoke(this.s3, 'listMultipartUploads', params)
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
        return P.ninvoke(this.s3, 'listBuckets', params)
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
        return P.ninvoke(this.s3, 'headBucket', params)
            .catch(err => {
                console.log('Bucket is not exist', err);
                existBucket = false;
                return existBucket;
            });
    }

    async get_object(bucket, key) {
        const params = {
            Bucket: bucket,
            Key: key
        };
        console.log('Reading object ', key);
        try {
            //There can be an issue if the object size (length) is too large
            const obj = await this.s3.getObject(params).promise();
            return obj;
        } catch (err) {
            console.error(`get_object:: getObject ${JSON.stringify(params)} failed!`, err);
            throw err;
        }
    }

    async get_object_range(bucket, key, start_byte, finish_byte, versionid) {
        const params = {
            Bucket: bucket,
            Key: key,
            Range: `bytes=${start_byte}-${finish_byte}`,
            VersionId: versionid ? versionid : undefined,
        };
        try {
            console.log(`Reading object ${key} ${versionid ? versionid : ''} from ${start_byte} to ${finish_byte}`);
            const obj = await this.s3.getObject(params).promise();
            return obj.Body;
        } catch (err) {
            console.error(`get_object_range:: getObject ${JSON.stringify(params)} failed!`, err);
            throw err;
        }
    }

    get_file_md5(bucket, file_name) {
        return verify_md5_map.get(`${this.system_verify_name}/${bucket}/${file_name}`);
    }

    async abort_multipart_upload(bucket, file_name, uploadId) {
        bucket = bucket || 'first.bucket';
        try {
            await this.s3.abortMultipartUpload({
                Bucket: bucket,
                Key: file_name,
                UploadId: uploadId
            }).promise();
            console.log(`Upload ${uploadId} of filename: ${file_name} was aborted successfully`);
        } catch (err) {
            console.error(`Abort failed ${file_name}, UploadId: ${uploadId}!`, err);
            throw err;
        }
    }

    async create_multipart_upload(bucket, file_name) {
        try {
            const multipartUpload = await this.s3.createMultipartUpload({
                Bucket: bucket,
                Key: file_name,
            }).promise();
            console.log(`Initiated multipart upload filename: ${file_name} uploadId ${multipartUpload.UploadId}`);
            return multipartUpload.UploadId;
        } catch (err) {
            console.error(`Initiating multipart upload failed ${file_name}`, err);
            throw err;
        }
    }

    /*
     * Internal Utils
     */
    async _multipart_upload_internal(bucket, file_name, data, part_size, overlook_error) {
        try {
            bucket = bucket || 'first.bucket';
            const md5_stream = new_md5_stream();
            const start_ts = Date.now();

            let body;
            let ContentLength;
            if (data instanceof stream.Stream) {
                body = data.pipe(md5_stream);
            } else {
                md5_stream.md5.update(data);
                body = data;
                ContentLength = data.length;
            }
            console.log(`>>> MultiPart UPLOAD - About to multipart upload object... ${
                file_name}`, ContentLength ? `size: ${ContentLength}` : ``);

            //Check for min size of parts. if we use stream we assume that it is larger then 5MB.
            if (data instanceof stream.Stream || ContentLength > 5242880) {
                await this.s3.upload({
                    Bucket: bucket,
                    Key: file_name,
                    Body: body,
                }, {
                    partSize: part_size
                }).promise();
            } else {
                await this.s3.putObject({
                    Bucket: bucket,
                    Key: file_name,
                    Body: body,
                    ContentLength, //when doing stream we need to give the size
                }).promise();
            }

            console.log('Upload object took', (Date.now() - start_ts) / 1000, 'seconds');
            const md5_hex = md5_stream.md5.digest('hex');
            console.log(`${file_name} md5 is: ${md5_hex}`);
            verify_md5_map.set(`${this.system_verify_name}/${bucket}/${file_name}`, md5_hex);
            return md5_hex;

        } catch (err) {
            if (overlook_error) return;
            console.error(`Upload failed ${file_name}!`, err);
            throw err;
        }
    }

}

function new_md5_stream() {
    const md5_stream = new stream.Transform({
        transform(buf, encoding, next) {
            this.md5.update(buf);
            this.size += buf.length;
            this.push(buf);
            next();
        }
    });
    md5_stream.md5 = crypto.createHash('md5');
    md5_stream.size = 0;
    return md5_stream;
}

exports.S3OPS = S3OPS;
