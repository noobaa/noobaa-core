/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const AWS = require('aws-sdk');
const util = require('util');

const P = require('../util/promise');
const dbg = require('../util/debug_module')(__filename);
const s3_utils = require('../endpoint/s3/s3_utils');
const blob_translator = require('./blob_translator');

class NamespaceS3 {

    constructor(options) {
        this.access_key = options.accessKeyId;
        this.proxy = options.proxy;
        this.endpoint = options.endpoint;
        this.s3 = new AWS.S3(options);
        this.bucket = this.s3.config.params.Bucket;
    }

    // check if copy can be done server side on AWS. 
    // for now we only send copy to AWS if both source and target are using the same access key
    // to aboid ACCESS_DENIED errors. a more complete solution is to always perform the server side copy
    // and fall back to read\write copy if access is denied
    is_same_namespace(other) {
        return other instanceof NamespaceS3 &&
            this.endpoint === other.endpoint &&
            this.access_key === other.access_key;
    }

    get_bucket() {
        return this.bucket;
    }


    /////////////////
    // OBJECT LIST //
    /////////////////

    async list_objects(params, object_sdk) {
        dbg.log0('NamespaceS3.list_objects:', this.bucket, inspect(params));

        const res = await this.s3.listObjects({
            Prefix: params.prefix,
            Delimiter: params.delimiter,
            Marker: params.key_marker,
            MaxKeys: params.limit,
        }).promise();

        dbg.log0('NamespaceS3.list_objects:', this.bucket, inspect(params),
            'list', inspect(res));

        return {
            objects: _.map(res.Contents, obj => this._get_s3_md(obj, params.bucket)),
            common_prefixes: _.map(res.CommonPrefixes, 'Prefix'),
            is_truncated: res.IsTruncated,
            next_marker: res.NextMarker,
        };
    }

    async list_uploads(params, object_sdk) {
        dbg.log0('NamespaceS3.list_uploads:', this.bucket, inspect(params));

        const res = await this.s3.listMultipartUploads({
            Prefix: params.prefix,
            Delimiter: params.delimiter,
            Marker: params.key_marker,
            UploadIdMarker: params.upload_id_marker,
            MaxKeys: params.limit,
        }).promise();

        dbg.log0('NamespaceS3.list_uploads:', this.bucket, inspect(params),
            'list', inspect(res));

        return {
            objects: _.map(res.Uploads, obj => this._get_s3_md(obj, params.bucket)),
            common_prefixes: _.map(res.CommonPrefixes, 'Prefix'),
            is_truncated: res.IsTruncated,
            next_marker: res.NextMarker,
            upload_id_marker: res.UploadIdMarker,
        };
    }

    async list_object_versions(params, object_sdk) {
        dbg.log0('NamespaceS3.list_object_versions:', this.bucket, inspect(params));

        const res = await this.s3.listObjectVersions({
            Prefix: params.prefix,
            Delimiter: params.delimiter,
            Marker: params.key_marker,
            VersionIdMarker: params.version_id_marker,
            MaxKeys: params.limit,
        }).promise();

        dbg.log0('NamespaceS3.list_object_versions:', this.bucket, inspect(params),
            'list', inspect(res));

        return {
            objects: _.map(_.concat(res.Versions, res.DeleteMarkers),
                obj => this._get_s3_md(obj, params.bucket)),
            common_prefixes: _.map(res.CommonPrefixes, 'Prefix'),
            is_truncated: res.IsTruncated,
            next_marker: res.NextMarker,
            next_version_id_marker: res.NextVersionIdMarker,
        };
    }


    /////////////////
    // OBJECT READ //
    /////////////////

    async read_object_md(params, object_sdk) {
        try {
            dbg.log0('NamespaceS3.read_object_md:', this.bucket, inspect(params));
            const res = await this.s3.headObject({ Key: params.key }).promise();
            dbg.log0('NamespaceS3.read_object_md:', this.bucket, inspect(params), 'res', inspect(res));
            return this._get_s3_md(res, params.bucket);
        } catch (err) {
            this._translate_error_code(err);
            dbg.warn('NamespaceS3.read_object_md:', inspect(err));
            throw err;
        }
    }

    async read_object_stream(params, object_sdk) {
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

    async upload_object(params, object_sdk) {
        dbg.log0('NamespaceS3.upload_object:', this.bucket, inspect(params));
        let res;
        if (params.copy_source) {
            const { copy_source } = s3_utils.format_copy_source(params.copy_source);
            if (copy_source.ranges) {
                // note that CopySourceRange is only supported by s3.uploadPartCopy()
                throw new Error('NamespaceS3.upload_object: CopySourceRange not supported by s3.copyObject()');
            }
            res = await this.s3.copyObject({
                Key: params.key,
                CopySource: copy_source,
                ContentType: params.content_type,
                Metadata: params.xattr,
                MetadataDirective: params.xattr_copy ? 'COPY' : 'REPLACE',
            }).promise();
        } else {
            res = await this.s3.putObject({
                Key: params.key,
                Body: params.source_stream,
                ContentLength: params.size,
                ContentType: params.content_type,
                ContentMD5: params.md5_b64,
                Metadata: params.xattr,
            }).promise();
        }
        dbg.log0('NamespaceS3.upload_object:', this.bucket, inspect(params), 'res', inspect(res));
        const etag = s3_utils.parse_etag(res.ETag);
        return { etag };
    }

    ////////////////////////
    // BLOCK BLOB UPLOADS //
    ////////////////////////

    upload_blob_block(params, object_sdk) {
        return blob_translator.upload_blob_block(params, object_sdk);
    }

    commit_blob_block_list(params, object_sdk) {
        return blob_translator.commit_blob_block_list(params, object_sdk);
    }

    get_blob_block_lists(params, object_sdk) {
        return blob_translator.get_blob_block_lists(params, object_sdk);
    }

    /////////////////////////////
    // OBJECT MULTIPART UPLOAD //
    /////////////////////////////

    async create_object_upload(params, object_sdk) {
        dbg.log0('NamespaceS3.create_object_upload:', this.bucket, inspect(params));
        const res = await this.s3.createMultipartUpload({
            Key: params.key,
            ContentType: params.content_type,
            Metadata: params.xattr,
        }).promise();

        dbg.log0('NamespaceS3.create_object_upload:', this.bucket, inspect(params), 'res', inspect(res));
        return { obj_id: res.UploadId };
    }

    async upload_multipart(params, object_sdk) {
        dbg.log0('NamespaceS3.upload_multipart:', this.bucket, inspect(params));
        let res;
        if (params.copy_source) {
            const { copy_source, copy_source_range } = s3_utils.format_copy_source(params.copy_source);
            res = await this.s3.uploadPartCopy({
                Key: params.key,
                UploadId: params.obj_id,
                PartNumber: params.num,
                CopySource: copy_source,
                CopySourceRange: copy_source_range,
            }).promise();
        } else {
            res = await this.s3.uploadPart({
                Key: params.key,
                UploadId: params.obj_id,
                PartNumber: params.num,
                Body: params.source_stream,
                ContentLength: params.size
            }).promise();
        }
        dbg.log0('NamespaceS3.upload_multipart:', this.bucket, inspect(params), 'res', inspect(res));
        const etag = s3_utils.parse_etag(res.ETag);
        return { etag };
    }

    async list_multiparts(params, object_sdk) {
        dbg.log0('NamespaceS3.list_multiparts:', this.bucket, inspect(params));
        const res = await this.s3.listParts({
            Key: params.key,
            UploadId: params.obj_id,
            MaxParts: params.max,
            PartNumberMarker: params.num_marker,
        }).promise();

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
    }

    async complete_object_upload(params, object_sdk) {
        dbg.log0('NamespaceS3.complete_object_upload:', this.bucket, inspect(params));
        const res = await this.s3.completeMultipartUpload({
            Key: params.key,
            UploadId: params.obj_id,
            MultipartUpload: {
                Parts: _.map(params.multiparts, p => ({
                    PartNumber: p.num,
                    ETag: `"${p.etag}"`,
                }))
            }
        }).promise();

        dbg.log0('NamespaceS3.complete_object_upload:', this.bucket, inspect(params), 'res', inspect(res));
        const etag = s3_utils.parse_etag(res.ETag);
        return { etag };
    }

    async abort_object_upload(params, object_sdk) {
        dbg.log0('NamespaceS3.abort_object_upload:', this.bucket, inspect(params));
        const res = await this.s3.abortMultipartUpload({
            Key: params.key,
            UploadId: params.obj_id,
        }).promise();

        dbg.log0('NamespaceS3.abort_object_upload:', this.bucket, inspect(params), 'res', inspect(res));
    }

    ///////////////////
    // OBJECT DELETE //
    ///////////////////

    async delete_object(params, object_sdk) {
        dbg.log0('NamespaceS3.delete_object:', this.bucket, inspect(params));

        const res = await this.s3.deleteObject({
            Key: params.key,
            VersionId: params.version_id,
        }).promise();

        dbg.log0('NamespaceS3.delete_object:',
            this.bucket,
            inspect(params),
            'res', inspect(res)
        );

        return {
            version_id: params.version_id,
            delete_marker: res.DeleteMarker,
            delete_marker_version_id: res.VersionId,
        };
    }

    async delete_multiple_objects(params, object_sdk) {
        dbg.log0('NamespaceS3.delete_multiple_objects:', this.bucket, inspect(params));

        const res = await this.s3.deleteObjects({
            Delete: {
                Objects: _.map(params.objects, obj => ({
                    Key: obj.key,
                    VersionId: obj.version_id,
                }))
            }
        }).promise();

        dbg.log0('NamespaceS3.delete_multiple_objects:',
            this.bucket,
            inspect(params),
            'res', inspect(res)
        );

        return [
            ...(res.Deleted ? res.Deleted.map(obj => ({
                key: obj.Key,
                version_id: obj.VersionId,
                delete_marker: obj.DeleteMarker,
                delete_marker_version_id: obj.DeleteMarkerVersionId,
            })) : []),
            ...(res.Errors ? res.Errors.map(err => ({
                key: err.Key,
                version_id: err.VersionId,
                err_code: err.Code,
                err_message: err.Message,
            })) : [])
        ];
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
            create_time: new Date(res.LastModified),
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
