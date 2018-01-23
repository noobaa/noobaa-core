/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const AWS = require('aws-sdk');
const util = require('util');

const P = require('../util/promise');
const dbg = require('../util/debug_module')(__filename);
const s3_utils = require('../endpoint/s3/s3_utils');

class NamespaceS3 {

    constructor(options) {
        this.proxy = options.proxy;
        this.s3 = new AWS.S3(options);
        this.bucket = this.s3.config.params.Bucket;
    }

    /////////////////
    // OBJECT LIST //
    /////////////////

    list_objects(params, object_sdk) {
        dbg.log0('NamespaceS3.list_objects:', this.bucket, inspect(params));
        // TODO list uploads
        if (params.upload_mode) {
            return {
                objects: [],
                common_prefixes: [],
                is_truncated: false,
            };
        }
        return this.s3.listObjects({
                Prefix: params.prefix,
                Delimiter: params.delimiter,
                Marker: params.key_marker,
                MaxKeys: params.limit,
            })
            .promise()
            .then(res => {
                dbg.log0('NamespaceS3.list_objects:', this.bucket, inspect(params), 'list', inspect(res));
                return {
                    objects: _.map(res.Contents, obj => this._get_s3_md(obj, params.bucket)),
                    common_prefixes: _.map(res.CommonPrefixes, 'Prefix'),
                    is_truncated: res.IsTruncated,
                    next_marker: res.NextMarker,
                };
            });
    }

    /////////////////
    // OBJECT READ //
    /////////////////

    read_object_md(params, object_sdk) {
        dbg.log0('NamespaceS3.read_object_md:', this.bucket, inspect(params));
        return this.s3.headObject({
                Key: params.key,
            })
            .promise()
            .then(res => {
                dbg.log0('NamespaceS3.read_object_md:', this.bucket, inspect(params), 'res', inspect(res));
                return this._get_s3_md(res, params.bucket);
            })
            .catch(err => {
                this._translate_error_code(err);
                dbg.warn('NamespaceS3.read_object_md:', inspect(err));
                throw err;
            });
    }

    read_object_stream(params, object_sdk) {
        dbg.log0('NamespaceS3.read_object_stream:', this.bucket, inspect(_.omit(params, 'object_md.ns')));
        return new P((resolve, reject) => {
            const req = this.s3.getObject({
                    Key: params.key,
                    Range: params.end ? `bytes=${params.start}-${params.end - 1}` : undefined,
                })
                .on('error', err => {
                    this._translate_error_code(err);
                    dbg.warn('NamespaceS3.read_object_stream:', inspect(err));
                    reject(err);
                })
                .on('httpHeaders', (statusCode, headers, res) => {
                    dbg.log0('NamespaceS3.read_object_stream:',
                        this.bucket,
                        inspect(_.omit(params, 'object_md.ns')),
                        'statusCode', statusCode,
                        'headers', headers
                    );
                    if (statusCode >= 300) return; // will be handled by error event
                    req.removeListener('httpData', AWS.EventListeners.Core.HTTP_DATA);
                    req.removeListener('httpError', AWS.EventListeners.Core.HTTP_ERROR);
                    const read_stream = res.httpResponse.createUnbufferedStream();
                    return resolve(read_stream);
                });
            req.send();
        });
    }

    ///////////////////
    // OBJECT UPLOAD //
    ///////////////////

    upload_object(params, object_sdk) {
        dbg.log0('NamespaceS3.upload_object:', this.bucket, inspect(params));
        if (params.copy_source) {
            // this.s3.copyObject({
            //     Key: params.key,
            //     CopySource: params.copy_source, // TODO get the original source url
            // });
            throw new Error('NamespaceS3.upload_object: copy object not yet supported');
        }
        return this.s3.putObject({
                Key: params.key,
                Body: params.source_stream,
                ContentLength: params.size,
                ContentType: params.content_type,
                ContentMD5: params.md5_b64,
                Metadata: params.xattr,
            })
            .promise()
            .then(res => {
                dbg.log0('NamespaceS3.upload_object:', this.bucket, inspect(params), 'res', inspect(res));
                const etag = s3_utils.parse_etag(res.ETag);
                return {
                    etag,
                };
            });
    }

    /////////////////////////////
    // OBJECT MULTIPART UPLOAD //
    /////////////////////////////

    create_object_upload(params, object_sdk) {
        dbg.log0('NamespaceS3.create_object_upload:', this.bucket, inspect(params));
        return this.s3.createMultipartUpload({
                Key: params.key,
                ContentType: params.content_type,
                Metadata: params.xattr,
            })
            .promise()
            .then(res => {
                dbg.log0('NamespaceS3.create_object_upload:', this.bucket, inspect(params), 'res', inspect(res));
                return {
                    obj_id: res.UploadId,
                };
            });
    }

    upload_multipart(params, object_sdk) {
        dbg.log0('NamespaceS3.upload_multipart:', this.bucket, inspect(params));
        if (params.copy_source) {
            throw new Error('NamespaceS3.upload_multipart: copy part not yet supported');
        }
        return this.s3.uploadPart({
                Key: params.key,
                UploadId: params.obj_id,
                PartNumber: params.num,
                Body: params.source_stream,
                ContentLength: params.size,
            })
            .promise()
            .then(res => {
                dbg.log0('NamespaceS3.upload_multipart:', this.bucket, inspect(params), 'res', inspect(res));
                const etag = s3_utils.parse_etag(res.ETag);
                return {
                    etag,
                };
            });
    }

    list_multiparts(params, object_sdk) {
        dbg.log0('NamespaceS3.list_multiparts:', this.bucket, inspect(params));
        return this.s3.listParts({
                Key: params.key,
                UploadId: params.obj_id,
                MaxParts: params.max,
                PartNumberMarker: params.num_marker,
            })
            .promise()
            .then(res => {
                dbg.log0('NamespaceS3.list_multiparts:', this.bucket, inspect(params), 'res', inspect(res));
                return {
                    is_truncated: res.IsTruncated,
                    next_num_marker: res.NextPartNumberMarker,
                    multiparts: _.map(res.Parts, p => ({
                        num: p.PartNumber,
                        size: p.Size,
                        etag: s3_utils.parse_etag(p.ETag),
                        last_modified: p.LastModified,
                    }))
                };
            });
    }

    complete_object_upload(params, object_sdk) {
        dbg.log0('NamespaceS3.complete_object_upload:', this.bucket, inspect(params));
        return this.s3.completeMultipartUpload({
                Key: params.key,
                UploadId: params.obj_id,
                MultipartUpload: {
                    Parts: _.map(params.multiparts, p => ({
                        PartNumber: p.num,
                        ETag: `"${p.etag}"`,
                    }))
                }
            })
            .promise()
            .then(res => {
                dbg.log0('NamespaceS3.complete_object_upload:', this.bucket, inspect(params), 'res', inspect(res));
                const etag = s3_utils.parse_etag(res.ETag);
                return {
                    etag,
                };
            });
    }

    abort_object_upload(params, object_sdk) {
        dbg.log0('NamespaceS3.abort_object_upload:', this.bucket, inspect(params));
        return this.s3.abortMultipartUpload({
                Key: params.key,
                UploadId: params.obj_id,
            })
            .promise()
            .then(res => {
                dbg.log0('NamespaceS3.abort_object_upload:', this.bucket, inspect(params), 'res', inspect(res));
            });
    }

    ///////////////////
    // OBJECT DELETE //
    ///////////////////

    delete_object(params, object_sdk) {
        dbg.log0('NamespaceS3.delete_object:', this.bucket, inspect(params));
        return this.s3.deleteObject({
                Key: params.key
            })
            .promise()
            .then(res => {
                dbg.log0('NamespaceS3.delete_object:', this.bucket, inspect(params), 'res', inspect(res));
            });
    }

    delete_multiple_objects(params, object_sdk) {
        dbg.log0('NamespaceS3.delete_multiple_objects:', this.bucket, inspect(params));
        return this.s3.deleteObjects({
                Delete: { Objects: _.map(params.keys, Key => ({ Key })) }
            })
            .promise()
            .then(res => {
                dbg.log0('NamespaceS3.delete_multiple_objects:', this.bucket, inspect(params), 'res', inspect(res));
            });
    }

    _get_s3_md(res, bucket) {
        const etag = s3_utils.parse_etag(res.ETag);
        const xattr = _.extend(res.Metadata, {
            'noobaa-namespace-s3-bucket': this.bucket,
        });
        return {
            obj_id: etag,
            bucket: bucket,
            key: res.Key,
            size: res.ContentLength || res.Size || 0,
            etag,
            create_time: res.LastModified,
            content_type: res.ContentType,
            xattr,
        };
    }

    _translate_error_code(err) {
        if (err.code === 'NotFound') err.rpc_code = 'NO_SUCH_OBJECT';
    }

}

function inspect(x) {
    return util.inspect(x, true, 5, true);
}

module.exports = NamespaceS3;
