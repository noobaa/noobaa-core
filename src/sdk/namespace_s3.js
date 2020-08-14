/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const AWS = require('aws-sdk');
const util = require('util');

const P = require('../util/promise');
const dbg = require('../util/debug_module')(__filename);
const stream_utils = require('../util/stream_utils');
const s3_utils = require('../endpoint/s3/s3_utils');
const blob_translator = require('./blob_translator');
const stats_collector = require('./endpoint_stats_collector');
const config = require('../../config');

class NamespaceS3 {

    constructor({ namespace_resource_id, rpc_client, s3_params }) {
        this.namespace_resource_id = namespace_resource_id;
        this.access_key = s3_params.accessKeyId;
        this.endpoint = s3_params.endpoint;
        this.s3 = new AWS.S3(s3_params);
        this.bucket = this.s3.config.params.Bucket;
        this.rpc_client = rpc_client;
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
            objects: _.map(res.Contents, obj => this._get_s3_object_info(obj, params.bucket)),
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
            KeyMarker: params.key_marker,
            UploadIdMarker: params.upload_id_marker,
            MaxUploads: params.limit,
        }).promise();

        dbg.log0('NamespaceS3.list_uploads:', this.bucket, inspect(params),
            'list', inspect(res));

        return {
            objects: _.map(res.Uploads, obj => this._get_s3_object_info(obj, params.bucket)),
            common_prefixes: _.map(res.CommonPrefixes, 'Prefix'),
            is_truncated: res.IsTruncated,
            next_marker: res.NextMarker,
            next_upload_id_marker: res.UploadIdMarker,
        };
    }

    async list_object_versions(params, object_sdk) {
        dbg.log0('NamespaceS3.list_object_versions:', this.bucket, inspect(params));

        const res = await this.s3.listObjectVersions({
            Prefix: params.prefix,
            Delimiter: params.delimiter,
            KeyMarker: params.key_marker,
            VersionIdMarker: params.version_id_marker,
            MaxKeys: params.limit,
        }).promise();

        dbg.log0('NamespaceS3.list_object_versions:', this.bucket, inspect(params),
            'list', inspect(res));

        return {
            objects: _.concat(
                _.map(res.Versions, obj => this._get_s3_object_info(obj, params.bucket)),
                _.map(res.DeleteMarkers, obj => this._get_s3_object_info(
                    _.assign(obj, { DeleteMarker: true }), params.bucket))
            ),
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
            const request = { Key: params.key, Range: `bytes=0-${config.INLINE_MAX_SIZE - 1}` };
            this._assign_encryption_to_request(params, request);
            const res = await this.s3.getObject(request).promise();
            dbg.log0('NamespaceS3.read_object_md:', this.bucket, inspect(params), 'res', inspect(res));
            return this._get_s3_object_info(res, params.bucket);
        } catch (err) {
            this._translate_error_code(err);
            dbg.warn('NamespaceS3.read_object_md:', inspect(err));
            throw err;
        }
    }

    async read_object_stream(params, object_sdk) {
        dbg.log0('NamespaceS3.read_object_stream:', this.bucket, inspect(_.omit(params, 'object_md.ns')));
        return new P((resolve, reject) => {
            const request = {
                Key: params.key,
                Range: params.end ? `bytes=${params.start}-${params.end - 1}` : undefined,
                IfMatch: params.if_match_etag,
            };
            this._assign_encryption_to_request(params, request);
            const req = this.s3.getObject(request)
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
                    let count = 1;
                    const count_stream = stream_utils.get_tap_stream(data => {
                        stats_collector.instance(this.rpc_client).update_namespace_read_stats({
                            namespace_resource_id: this.namespace_resource_id,
                            size: data.length,
                            count
                        });
                        // clear count for next updates
                        count = 0;
                    });
                    const read_stream = res.httpResponse.createUnbufferedStream();
                    return resolve(read_stream.pipe(count_stream));
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
        const Tagging = params.tagging && params.tagging.map(tag => tag.key + '=' + tag.value).join('&');
        if (params.copy_source) {
            const { copy_source } = s3_utils.format_copy_source(params.copy_source);
            if (copy_source.ranges) {
                // note that CopySourceRange is only supported by s3.uploadPartCopy()
                throw new Error('NamespaceS3.upload_object: CopySourceRange not supported by s3.copyObject()');
            }

            const request = {
                Key: params.key,
                CopySource: copy_source,
                ContentType: params.content_type,
                Metadata: params.xattr,
                MetadataDirective: params.xattr_copy ? 'COPY' : 'REPLACE',
                Tagging,
                TaggingDirective: params.tagging_copy ? 'COPY' : 'REPLACE',
            };

            this._assign_encryption_to_request(params, request);

            res = await this.s3.copyObject(request).promise();
        } else {
            let count = 1;
            const count_stream = stream_utils.get_tap_stream(data => {
                stats_collector.instance(this.rpc_client).update_namespace_write_stats({
                    namespace_resource_id: this.namespace_resource_id,
                    size: data.length,
                    count
                });
                // clear count for next updates
                count = 0;
            });

            const request = {
                Key: params.key,
                Body: params.source_stream.pipe(count_stream),
                ContentLength: params.size,
                ContentType: params.content_type,
                ContentMD5: params.md5_b64,
                Metadata: params.xattr,
                Tagging,
            };

            this._assign_encryption_to_request(params, request);

            res = await this.s3.putObject(request).promise();
        }
        dbg.log0('NamespaceS3.upload_object:', this.bucket, inspect(params), 'res', inspect(res));
        const etag = s3_utils.parse_etag(res.ETag);
        return { etag, version_id: res.VersionId };
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
        const Tagging = params.tagging && params.tagging.map(tag => tag.key + '=' + tag.value).join('&');
        const request = {
            Key: params.key,
            ContentType: params.content_type,
            Metadata: params.xattr,
            Tagging
        };
        this._assign_encryption_to_request(params, request);
        const res = await this.s3.createMultipartUpload(request).promise();

        dbg.log0('NamespaceS3.create_object_upload:', this.bucket, inspect(params), 'res', inspect(res));
        return { obj_id: res.UploadId };
    }

    async upload_multipart(params, object_sdk) {
        dbg.log0('NamespaceS3.upload_multipart:', this.bucket, inspect(params));
        let res;
        if (params.copy_source) {
            const { copy_source, copy_source_range } = s3_utils.format_copy_source(params.copy_source);
            const request = {
                Key: params.key,
                UploadId: params.obj_id,
                PartNumber: params.num,
                CopySource: copy_source,
                CopySourceRange: copy_source_range,
            };

            this._assign_encryption_to_request(params, request);

            res = await this.s3.uploadPartCopy(request).promise();
        } else {
            let count = 1;
            const count_stream = stream_utils.get_tap_stream(data => {
                stats_collector.instance(this.rpc_client).update_namespace_write_stats({
                    namespace_resource_id: this.namespace_resource_id,
                    size: data.length,
                    count
                });
                // clear count for next updates
                count = 0;
            });

            const request = {
                Key: params.key,
                UploadId: params.obj_id,
                PartNumber: params.num,
                Body: params.source_stream.pipe(count_stream),
                ContentMD5: params.md5_b64,
                ContentLength: params.size,
            };

            this._assign_encryption_to_request(params, request);

            res = await this.s3.uploadPart(request).promise();
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
        return { etag, version_id: res.VersionId };
    }

    async abort_object_upload(params, object_sdk) {
        dbg.log0('NamespaceS3.abort_object_upload:', this.bucket, inspect(params));
        const res = await this.s3.abortMultipartUpload({
            Key: params.key,
            UploadId: params.obj_id,
        }).promise();

        dbg.log0('NamespaceS3.abort_object_upload:', this.bucket, inspect(params), 'res', inspect(res));
    }

    ////////////////////
    // OBJECT TAGGING //
    ////////////////////

    async put_object_tagging(params, object_sdk) {
        dbg.log0('NamespaceS3.put_object_tagging:', this.bucket, inspect(params));

        const TagSet = params.tagging.map(tag => ({
            Key: tag.key,
            Value: tag.value
        }));

        const res = await this.s3.putObjectTagging({
            Key: params.key,
            VersionId: params.version_id,
            Tagging: { TagSet }
        }).promise();

        dbg.log0('NamespaceS3.put_object_tagging:', this.bucket, inspect(params), 'res', inspect(res));

        return {
            version_id: res.VersionId
        };
    }

    async delete_object_tagging(params, object_sdk) {
        dbg.log0('NamespaceS3.delete_object_tagging:', this.bucket, inspect(params));
        const res = await this.s3.deleteObjectTagging({
            Key: params.key,
            VersionId: params.version_id
        }).promise();

        dbg.log0('NamespaceS3.delete_object_tagging:', this.bucket, inspect(params), 'res', inspect(res));

        return {
            version_id: res.VersionId
        };
    }

    async get_object_tagging(params, object_sdk) {
        dbg.log0('NamespaceS3.get_object_tagging:', this.bucket, inspect(params));
        const res = await this.s3.getObjectTagging({
            Key: params.key,
            VersionId: params.version_id
        }).promise();

        dbg.log0('NamespaceS3.get_object_tagging:', this.bucket, inspect(params), 'res', inspect(res));

        const TagSet = res.TagSet.map(tag => ({
            key: tag.Key,
            value: tag.Value
        }));

        return {
            version_id: res.VersionId,
            tagging: TagSet
        };
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

        if (params.version_id) {
            return {
                deleted_delete_marker: res.DeleteMarker
            };
        } else {
            return {
                created_version_id: res.VersionId,
                created_delete_marker: res.DeleteMarker
            };
        }
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

        return _.map(params.objects, obj => {
            const deleted = _.find(res.Deleted, del_rec =>
                (del_rec.VersionId === obj.version_id && del_rec.Key === obj.key)
            );
            if (deleted) {
                if (deleted.VersionId) {
                    return {
                        deleted_version_id: deleted.DeleteMarkerVersionId,
                        deleted_delete_marker: deleted.DeleteMarker,
                    };
                } else {
                    return {
                        created_version_id: deleted.DeleteMarkerVersionId,
                        created_delete_marker: deleted.DeleteMarker,
                    };
                }
            } else {
                const error = _.find(res.Errors, err_rec =>
                    (err_rec.VersionId === obj.version_id && err_rec.Key === obj.key)
                );
                return {
                    err_code: error.Code,
                    err_message: error.Message,
                };
            }
        });
    }

    _get_s3_object_info(res, bucket) {
        const etag = s3_utils.parse_etag(res.ETag);
        const xattr = _.extend(res.Metadata, {
            'noobaa-namespace-s3-bucket': this.bucket,
        });
        const ranges = res.ContentRange ? Number(res.ContentRange.split('/')[1]) : 0;
        return {
            obj_id: res.UploadId || etag,
            bucket: bucket,
            key: res.Key,
            size: ranges || res.ContentLength || res.Size || 0,
            etag,
            create_time: new Date(res.LastModified),
            version_id: res.VersionId,
            is_latest: res.IsLatest,
            delete_marker: res.DeleteMarker,
            content_type: res.ContentType,
            xattr,
            tag_count: res.TagCount,
            first_range_data: res.Body,
        };
    }

    _translate_error_code(err) {
        if (err.code === 'NoSuchKey') err.rpc_code = 'NO_SUCH_OBJECT';
        if (err.code === 'NotFound') err.rpc_code = 'NO_SUCH_OBJECT';
        if (err.code === 'PreconditionFailed') err.rpc_code = 'IF_MATCH_ETAG';
    }

    _assign_encryption_to_request(params, request) {
        if (params.copy_source && params.copy_source.encryption) {
            const { algorithm, key_b64 } = params.copy_source.encryption;
            request.CopySourceSSECustomerAlgorithm = algorithm;
            // TODO: There is a bug in the AWS S3 JS SDK that he encodes to base64 once again
            // This will generate an error of non correct key, this is why we decode and send as ascii string
            // Also the key_md5_b64 will be populated by the SDK.
            request.CopySourceSSECustomerKey = Buffer.from(key_b64, 'base64').toString('ascii');
        }

        if (params.encryption) {
            // TODO: How should we pass the context ('x-amz-server-side-encryption-context' var context_b64) if at all?
            const { algorithm, key_b64, kms_key_id } = params.encryption;
            if (key_b64) {
                request.SSECustomerAlgorithm = algorithm;
                // TODO: There is a bug in the AWS S3 JS SDK that he encodes to base64 once again
                // This will generate an error of non correct key, this is why we decode and send as ascii string
                // Also the key_md5_b64 will be populated by the SDK.
                request.SSECustomerKey = Buffer.from(key_b64, 'base64').toString('ascii');
            } else {
                request.ServerSideEncryption = algorithm;
                request.SSEKMSKeyId = kms_key_id;
            }
        }
    }

}

function inspect(x) {
    return util.inspect(_.omit(x, 'source_stream'), true, 5, true);
}

module.exports = NamespaceS3;
