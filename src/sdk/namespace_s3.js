/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const AWS = require('aws-sdk');
const util = require('util');

const dbg = require('../util/debug_module')(__filename);
const stream_utils = require('../util/stream_utils');
const s3_utils = require('../endpoint/s3/s3_utils');
const cloud_utils = require('../util/cloud_utils');
const blob_translator = require('./blob_translator');
const stats_collector = require('./endpoint_stats_collector');
const config = require('../../config');

/**
 * @implements {nb.Namespace}
 */
class NamespaceS3 {


    constructor({ namespace_resource_id, rpc_client, s3_params }) {
        this.namespace_resource_id = namespace_resource_id;
        this.s3_params = s3_params;
        this.access_key = s3_params.accessKeyId;
        this.endpoint = s3_params.endpoint;
        this.s3 = new AWS.S3(s3_params);
        this.bucket = String(this.s3.config.params.Bucket);
        this.rpc_client = rpc_client;
        this.access_mode = s3_params.access_mode;

        if (this.s3_params.aws_sts_arn) {
            this.additionalS3Params = {
                RoleSessionName: 'block_store_operations'
            };
        }
    }

    get_write_resource() {
        return this;
    }

    // check if copy can be done server side on AWS.
    // for now we only send copy to AWS if both source and target are using the same access key
    // to aboid ACCESS_DENIED errors. a more complete solution is to always perform the server side copy
    // and fall back to read\write copy if access is denied
    is_server_side_copy(other, params) {
        return other instanceof NamespaceS3 &&
            this.endpoint === other.endpoint &&
            this.access_key === other.access_key;
    }

    get_bucket() {
        return this.bucket;
    }

    is_readonly_namespace() {
        if (this.access_mode && this.access_mode === 'READ_ONLY') {
            return true;
        }
        return false;
    }


    /////////////////
    // OBJECT LIST //
    /////////////////

    async list_objects(params, object_sdk) {
        dbg.log0('NamespaceS3.list_objects:', this.bucket, inspect(params));

        if (this.s3_params.aws_sts_arn) this.s3 = await cloud_utils.createSTSS3Client(this.s3_params, this.additionalS3Params);
        const res = await this.s3.listObjects({
            Bucket: this.bucket,
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
        if (this.s3_params.aws_sts_arn) this.s3 = await cloud_utils.createSTSS3Client(this.s3_params, this.additionalS3Params);

        const res = await this.s3.listMultipartUploads({
            Bucket: this.bucket,
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
            next_marker: res.NextKeyMarker,
            next_upload_id_marker: res.UploadIdMarker,
        };
    }

    async list_object_versions(params, object_sdk) {
        dbg.log0('NamespaceS3.list_object_versions:', this.bucket, inspect(params));
        if (this.s3_params.aws_sts_arn) this.s3 = await cloud_utils.createSTSS3Client(this.s3_params, this.additionalS3Params);

        const res = await this.s3.listObjectVersions({
            Bucket: this.bucket,
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
            next_marker: res.NextKeyMarker,
            next_version_id_marker: res.NextVersionIdMarker,
        };
    }


    /////////////////
    // OBJECT READ //
    /////////////////

    _set_md_conditions(params, request) {
        if (params.md_conditions) {
            request.IfMatch = params.md_conditions.if_match_etag;
            request.IfNoneMatch = params.md_conditions.if_none_match_etag;
            if (params.md_conditions.if_modified_since) {
                request.IfModifiedSince = new Date(params.md_conditions.if_modified_since);
            }
            if (params.md_conditions.if_unmodified_since) {
                request.IfUnmodifiedSince = new Date(params.md_conditions.if_unmodified_since);
            }
        }
    }

    async read_object_md(params, object_sdk) {
        try {
            dbg.log0('NamespaceS3.read_object_md:', this.bucket, inspect(params));
            if (this.s3_params.aws_sts_arn) this.s3 = await cloud_utils.createSTSS3Client(this.s3_params, this.additionalS3Params);
            const request = {
                Bucket: this.bucket,
                Key: params.key,
                PartNumber: params.part_number,
            };
            // If set, part_number is positive integer from 1 to 10000.
            // Usually part number is not provided and then we read a small "inline" range
            // to reduce the double latency for small objects.
            // can_use_get_inline - we shouldn't use inline get when part number exist or when heading a directory
            const can_use_get_inline = !params.part_number && !request.Key.endsWith('/');
            if (can_use_get_inline) {
                request.Range = `bytes=0-${config.INLINE_MAX_SIZE - 1}`;
            }
            this._set_md_conditions(params, request);
            this._assign_encryption_to_request(params, request);
            let res;
            try {
                res = can_use_get_inline ?
                    await this.s3.getObject(request).promise() :
                    await this.s3.headObject(request).promise();
            } catch (err) {
                // catch invalid range error for objects of size 0 and trying head object instead
                if (err.code !== 'InvalidRange') {
                    throw err;
                }
                res = await this.s3.headObject({ ...request, Range: undefined }).promise();
            }
            dbg.log0('NamespaceS3.read_object_md:', this.bucket, inspect(params), 'res', inspect(res));
            return this._get_s3_object_info(res, params.bucket, params.part_number);
        } catch (err) {
            this._translate_error_code(params, err);
            dbg.warn('NamespaceS3.read_object_md:', inspect(err));
            object_sdk.rpc_client.pool.update_issues_report({
                namespace_resource_id: this.namespace_resource_id,
                error_code: String(err.code),
                time: Date.now(),
            });
            throw err;
        }
    }

    async read_object_stream(params, object_sdk) {
        dbg.log0('NamespaceS3.read_object_stream:', this.bucket, inspect(_.omit(params, 'object_md.ns')));
        if (this.s3_params.aws_sts_arn) this.s3 = await cloud_utils.createSTSS3Client(this.s3_params, this.additionalS3Params);
        return new Promise((resolve, reject) => {
            const request = {
                Bucket: this.bucket,
                Key: params.key,
                Range: params.end ? `bytes=${params.start}-${params.end - 1}` : undefined,
                PartNumber: params.part_number,
            };
            this._set_md_conditions(params, request);
            this._assign_encryption_to_request(params, request);
            const req = this.s3.getObject(request)
                .on('error', err => {
                    this._translate_error_code(params, err);
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
                            bucket_name: params.bucket,
                            size: data.length,
                            count
                        });
                        // clear count for next updates
                        count = 0;
                    });
                    const read_stream = /** @type {import('stream').Readable} */
                        (res.httpResponse.createUnbufferedStream());
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
        if (this.s3_params.aws_sts_arn) this.s3 = await cloud_utils.createSTSS3Client(this.s3_params, this.additionalS3Params);
        let res;
        const Tagging = params.tagging && params.tagging.map(tag => tag.key + '=' + tag.value).join('&');
        if (params.copy_source) {
            const { copy_source, copy_source_range } = s3_utils.format_copy_source(params.copy_source);
            if (copy_source_range) {
                // note that CopySourceRange is only supported by s3.uploadPartCopy()
                throw new Error('NamespaceS3.upload_object: CopySourceRange not supported by s3.copyObject()');
            }

            const request = {
                Bucket: this.bucket,
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
                    bucket_name: params.bucket,
                    size: data.length,
                    count
                });
                // clear count for next updates
                count = 0;
            });

            const request = {
                Bucket: this.bucket,
                Key: params.key,
                Body: params.source_stream.pipe(count_stream),
                ContentLength: params.size,
                ContentType: params.content_type,
                ContentMD5: params.md5_b64,
                Metadata: params.xattr,
                Tagging,
            };

            this._assign_encryption_to_request(params, request);
            try {
                res = await this.s3.putObject(request).promise();
            } catch (err) {
                object_sdk.rpc_client.pool.update_issues_report({
                    namespace_resource_id: this.namespace_resource_id,
                    error_code: String(err.code),
                    time: Date.now(),
                });
                throw err;
            }
        }
        dbg.log0('NamespaceS3.upload_object:', this.bucket, inspect(params), 'res', inspect(res));
        const etag = s3_utils.parse_etag(res.ETag);
        const last_modified_time = s3_utils.get_http_response_date(res);
        return { etag, version_id: res.VersionId, last_modified_time };
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
        if (this.s3_params.aws_sts_arn) this.s3 = await cloud_utils.createSTSS3Client(this.s3_params, this.additionalS3Params);
        const Tagging = params.tagging && params.tagging.map(tag => tag.key + '=' + tag.value).join('&');
        const request = {
            Bucket: this.bucket,
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
                Bucket: this.bucket,
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
                Bucket: this.bucket,
                Key: params.key,
                UploadId: params.obj_id,
                PartNumber: params.num,
                Body: params.source_stream.pipe(count_stream),
                ContentMD5: params.md5_b64,
                ContentLength: params.size,
            };

            this._assign_encryption_to_request(params, request);
            try {
                res = await this.s3.uploadPart(request).promise();
            } catch (err) {
                object_sdk.rpc_client.pool.update_issues_report({
                    namespace_resource_id: this.namespace_resource_id,
                    error_code: String(err.code),
                    time: Date.now(),
                });
                throw err;
            }
        }
        dbg.log0('NamespaceS3.upload_multipart:', this.bucket, inspect(params), 'res', inspect(res));
        const etag = s3_utils.parse_etag(res.ETag);
        return { etag };
    }

    async list_multiparts(params, object_sdk) {
        dbg.log0('NamespaceS3.list_multiparts:', this.bucket, inspect(params));
        if (this.s3_params.aws_sts_arn) this.s3 = await cloud_utils.createSTSS3Client(this.s3_params, this.additionalS3Params);
        const res = await this.s3.listParts({
            Bucket: this.bucket,
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
        if (this.s3_params.aws_sts_arn) this.s3 = await cloud_utils.createSTSS3Client(this.s3_params, this.additionalS3Params);
        const res = await this.s3.completeMultipartUpload({
            Bucket: this.bucket,
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
        if (this.s3_params.aws_sts_arn) this.s3 = await cloud_utils.createSTSS3Client(this.s3_params, this.additionalS3Params);
        const res = await this.s3.abortMultipartUpload({
            Bucket: this.bucket,
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
        if (this.s3_params.aws_sts_arn) this.s3 = await cloud_utils.createSTSS3Client(this.s3_params, this.additionalS3Params);

        const TagSet = params.tagging.map(tag => ({
            Key: tag.key,
            Value: tag.value
        }));

        const res = await this.s3.putObjectTagging({
            Bucket: this.bucket,
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
        if (this.s3_params.aws_sts_arn) this.s3 = await cloud_utils.createSTSS3Client(this.s3_params, this.additionalS3Params);
        const res = await this.s3.deleteObjectTagging({
            Bucket: this.bucket,
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
        if (this.s3_params.aws_sts_arn) this.s3 = await cloud_utils.createSTSS3Client(this.s3_params, this.additionalS3Params);
        const res = await this.s3.getObjectTagging({
            Bucket: this.bucket,
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

    //////////
    // ACLs //
    //////////

    async get_object_acl(params, object_sdk) {
        dbg.log0('NamespaceS3.get_object_acl:', this.bucket, inspect(params));
        if (this.s3_params.aws_sts_arn) this.s3 = await cloud_utils.createSTSS3Client(this.s3_params, this.additionalS3Params);

        const res = await this.s3.getObjectAcl({
            Bucket: this.bucket,
            Key: params.key,
            VersionId: params.version_id
        }).promise();

        dbg.log0('NamespaceS3.get_object_acl:', this.bucket, inspect(params), 'res', inspect(res));

        return {
            owner: res.Owner,
            access_control_list: res.Grants
        };
    }

    async put_object_acl(params, object_sdk) {
        dbg.log0('NamespaceS3.put_object_acl:', this.bucket, inspect(params));
        if (this.s3_params.aws_sts_arn) this.s3 = await cloud_utils.createSTSS3Client(this.s3_params, this.additionalS3Params);

        const res = await this.s3.putObjectAcl({
            Bucket: this.bucket,
            Key: params.key,
            VersionId: params.version_id,
            ACL: params.acl
        }).promise();

        dbg.log0('NamespaceS3.put_object_acl:', this.bucket, inspect(params), 'res', inspect(res));
    }

    ///////////////////
    // OBJECT DELETE //
    ///////////////////

    async delete_object(params, object_sdk) {
        dbg.log0('NamespaceS3.delete_object:', this.bucket, inspect(params));
        if (this.s3_params.aws_sts_arn) this.s3 = await cloud_utils.createSTSS3Client(this.s3_params, this.additionalS3Params);

        const res = await this.s3.deleteObject({
            Bucket: this.bucket,
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
        if (this.s3_params.aws_sts_arn) this.s3 = await cloud_utils.createSTSS3Client(this.s3_params, this.additionalS3Params);

        const res = await this.s3.deleteObjects({
            Bucket: this.bucket,
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


    ///////////////////
    //  OBJECT LOCK  //
    ///////////////////

    async get_object_legal_hold() {
        throw new Error('TODO');
    }
    async put_object_legal_hold() {
        throw new Error('TODO');
    }
    async get_object_retention() {
        throw new Error('TODO');
    }
    async put_object_retention() {
        throw new Error('TODO');
    }

    ///////////////////
    //      ULS      //
    ///////////////////

    async create_uls() {
        throw new Error('TODO');
    }
    async delete_uls() {
        throw new Error('TODO');
    }

    ///////////////
    // INTERNALS //
    ///////////////

    /**
     * 
     * @param {AWS.S3.HeadObjectOutput | AWS.S3.GetObjectOutput} res 
     * @param {string} bucket 
     * @param {number} [part_number]
     * @returns {nb.ObjectInfo}
     */
    _get_s3_object_info(res, bucket, part_number) {
        const etag = s3_utils.parse_etag(res.ETag);
        const xattr = _.extend(res.Metadata, {
            'noobaa-namespace-s3-bucket': this.bucket,
        });
        const ranges = res.ContentRange ? Number(res.ContentRange.split('/')[1]) : 0;
        const size = ranges || res.ContentLength || res.Size || 0;
        const last_modified_time = res.LastModified ? res.LastModified.getTime() : Date.now();
        return {
            obj_id: res.UploadId || etag,
            bucket: bucket,
            key: res.Key,
            size,
            etag,
            create_time: last_modified_time,
            last_modified_time,
            version_id: res.VersionId,
            is_latest: res.IsLatest,
            delete_marker: res.DeleteMarker,
            content_type: res.ContentType,
            xattr,
            tag_count: res.TagCount,
            first_range_data: res.Body,
            num_multiparts: res.PartsCount,
            content_range: res.ContentRange,
            content_length: part_number ? res.ContentLength : size,
            encryption: undefined,
            lock_settings: undefined,
            md5_b64: undefined,
            num_parts: undefined,
            sha256_b64: undefined,
            stats: undefined,
            tagging: undefined,
        };
    }

    _translate_error_code(params, err) {
        if (err.code === 'NoSuchKey') err.rpc_code = 'NO_SUCH_OBJECT';
        else if (err.code === 'NotFound') err.rpc_code = 'NO_SUCH_OBJECT';
        else if (err.code === 'InvalidRange') err.rpc_code = 'INVALID_RANGE';
        else if (params.md_conditions) {
            const md_conditions = params.md_conditions;
            if (err.code === 'PreconditionFailed') {
                if (md_conditions.if_match_etag) err.rpc_code = 'IF_MATCH_ETAG';
                else if (md_conditions.if_unmodified_since) err.rpc_code = 'IF_UNMODIFIED_SINCE';
            } else if (err.code === 'NotModified') {
                if (md_conditions.if_modified_since) err.rpc_code = 'IF_MODIFIED_SINCE';
                else if (md_conditions.if_none_match_etag) err.rpc_code = 'IF_NONE_MATCH_ETAG';
            }
        }
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
