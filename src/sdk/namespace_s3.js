/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const util = require('util');

const dbg = require('../util/debug_module')(__filename);
const config = require('../../config');
const s3_utils = require('../endpoint/s3/s3_utils');
const cloud_utils = require('../util/cloud_utils');
const stream_utils = require('../util/stream_utils');
const blob_translator = require('./blob_translator');
const S3Error = require('../endpoint/s3/s3_errors').S3Error;
const noobaa_s3_client = require('../sdk/noobaa_s3_client/noobaa_s3_client');
const { PutObjectCommand } = require('@aws-sdk/client-s3');

/**
 * @implements {nb.Namespace}
 */
class NamespaceS3 {

    /**
     * @param {{
     *      namespace_resource_id: any,
     *      s3_params: import("@aws-sdk/client-s3").S3ClientConfig & {
     *          access_mode?: string,
     *          aws_sts_arn?: string,
     *      },
     *      bucket?: string,
     *      stats: import('./endpoint_stats_collector').EndpointStatsCollector,
     * }} args 
     */
    constructor({ namespace_resource_id, s3_params, bucket, stats }) {
        this.namespace_resource_id = namespace_resource_id;
        this.s3_params = s3_params;
        this.access_key = s3_params.credentials?.accessKeyId;
        this.endpoint = s3_params.endpoint;
        this.s3 = noobaa_s3_client.get_s3_client_v3_params(s3_params);
        if (!bucket) {
            throw new Error('NamespaceS3: bucket is required');
        }
        this.bucket = String(bucket);
        this.access_mode = s3_params.access_mode;
        this.stats = stats;
    }

    get_write_resource() {
        return this;
    }

    // check if copy can be done server side on AWS.
    // for now we only send copy to AWS if both source and target are using the same access key
    // to aboid ACCESS_DENIED errors. a more complete solution is to always perform the server side copy
    // and fall back to read\write copy if access is denied
    is_server_side_copy(other, other_md, params) {
        return other instanceof NamespaceS3 &&
            this.endpoint === other.endpoint &&
            this.access_key === other.access_key;
    }

    get_bucket() {
        return this.bucket;
    }

    is_readonly_namespace() {
        return this.access_mode === 'READ_ONLY';
    }

    async _prepare_sts_client() {
        if (this.s3_params.aws_sts_arn) {
            const additionalParams = {
                RoleSessionName: 'block_store_operations',
            };
            this.s3 = await cloud_utils.createSTSS3SDKv3Client(this.s3_params, additionalParams);
        }
    }


    /////////////////
    // OBJECT LIST //
    /////////////////

    async list_objects(params, object_sdk) {
        dbg.log0('NamespaceS3.list_objects:', this.bucket, inspect(params));
        await this._prepare_sts_client();

        const res = await this.s3.listObjects({
            Bucket: this.bucket,
            Prefix: params.prefix,
            Delimiter: params.delimiter,
            Marker: params.key_marker,
            MaxKeys: params.limit,
        });

        dbg.log0('NamespaceS3.list_objects:', this.bucket, inspect(params),
            'list', inspect(res));

        return {
            objects: _.map(res.Contents, obj => this._get_s3_object_info(obj, params.bucket)),
            common_prefixes: _.map(res.CommonPrefixes, 'Prefix'),
            is_truncated: res.IsTruncated,
            next_marker: res.NextMarker
        };
    }

    /**
     * _get_object_owner in the future we will return object owner
     * currently not implemented because ACLs are not implemented as well
     */
    _get_object_owner() {
        return undefined;
    }

    async list_uploads(params, object_sdk) {
        dbg.log0('NamespaceS3.list_uploads:', this.bucket, inspect(params));
        await this._prepare_sts_client();

        const res = await this.s3.listMultipartUploads({
            Bucket: this.bucket,
            Prefix: params.prefix,
            Delimiter: params.delimiter,
            KeyMarker: params.key_marker,
            UploadIdMarker: params.upload_id_marker,
            MaxUploads: params.limit,
        });

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
        await this._prepare_sts_client();

        const res = await this.s3.listObjectVersions({
            Bucket: this.bucket,
            Prefix: params.prefix,
            Delimiter: params.delimiter,
            KeyMarker: params.key_marker,
            VersionIdMarker: params.version_id_marker,
            MaxKeys: params.limit,
        });

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
            await this._prepare_sts_client();

            /** @type {import("@aws-sdk/client-s3").HeadObjectRequest | import("@aws-sdk/client-s3").GetObjectRequest} */
            const request = {
                Bucket: this.bucket,
                Key: params.key,
                PartNumber: params.part_number,
                VersionId: params.version_id,
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
                    await this.s3.getObject(request) :
                    await this.s3.headObject(request);
            } catch (err) {
                // catch invalid range error for objects of size 0 and try head object instead
                const httpCode = err?.$metadata?.httpStatusCode;
                const isInvalidRange = err?.name === 'InvalidRange' || httpCode === 416;
                if (!isInvalidRange) {
                    throw err;
                }
                res = await this.s3.headObject({ ...request, Range: undefined });
            }
            dbg.log0('NamespaceS3.read_object_md:', this.bucket, inspect(params), 'metadata', inspect(res.$metadata));
            return this._get_s3_object_info(res, params.bucket, params.part_number);
        } catch (err) {
            this._translate_error_code(params, err);
            dbg.warn('NamespaceS3.read_object_md:', inspect(err));

            // It's totally expected to issue `HeadObject` against an object that doesn't exist
            // this shouldn't be counted as an issue for the namespace store
            //
            // @TODO: Another error to tolerate is 'InvalidObjectState'. This shouldn't also
            // result in IO_ERROR for the namespace however that means we can not do `getObject`
            // even when `can_use_get_inline` is true.
            if (err.rpc_code !== 'NO_SUCH_OBJECT') {
                object_sdk.rpc_client.pool.update_issues_report({
                    namespace_resource_id: this.namespace_resource_id,
                    error_code: String(err.code),
                    time: Date.now(),
                });
            }

            throw err;
        }
    }

    async read_object_stream(params, object_sdk) {
        dbg.log0('NamespaceS3.read_object_stream:', this.bucket, inspect(_.omit(params, 'object_md.ns')));
        await this._prepare_sts_client();

        /** @type {import("@aws-sdk/client-s3").HeadObjectRequest & import("@aws-sdk/client-s3").GetObjectRequest | import("@aws-sdk/client-s3").CopyObjectRequest} */
        const request = {
            Bucket: this.bucket,
            Key: params.key,
            Range: params.end ? `bytes=${params.start}-${params.end - 1}` : undefined,
            PartNumber: params.part_number,
        };
        this._set_md_conditions(params, request);
        this._assign_encryption_to_request(params, request);
        try {
            const obj_out = await this.s3.getObject(request);
            dbg.log0('NamespaceS3.read_object_stream:',
                        this.bucket,
                        inspect(_.omit(params, 'object_md.ns')),
                    );
            // In v3, non-2xx typically throws; keep this guard harmless.
            if (obj_out.$metadata.httpStatusCode >= 300) throw new Error(`S3 getObject failed with status ${obj_out.$metadata.httpStatusCode}`);
            let count = 1;
            // S3 read_object_md might not return tag count, get TagCount from response
            params.tag_count = obj_out.TagCount;
            const count_stream = stream_utils.get_tap_stream(data => {
                this.stats?.update_namespace_read_stats({
                    namespace_resource_id: this.namespace_resource_id,
                    bucket_name: params.bucket,
                    size: data.length,
                    count
                });
                // clear count for next updates
                count = 0;
            });
            const read_stream = /** @type {import('stream').Readable} */ (obj_out.Body);
            // Bridge errors from source to the returned stream
            read_stream.on('error', err => count_stream.emit('error', err));
            // Return a live stream to be piped by the caller (endpoint)
            return read_stream.pipe(count_stream);
        } catch (err) {
            this._translate_error_code(params, err);
            dbg.warn('NamespaceS3.read_object_stream:', inspect(err));
            throw err;
        }
    }


    ///////////////////
    // OBJECT UPLOAD //
    ///////////////////

    async upload_object(params, object_sdk) {
        dbg.log0('NamespaceS3.upload_object:', this.bucket, inspect(params));
        await this._prepare_sts_client();

        let res;
        let date;
        const Tagging = params.tagging && params.tagging.map(tag => tag.key + '=' + tag.value).join('&');
        if (params.copy_source) {
            const { copy_source, copy_source_range } = s3_utils.format_copy_source(params.copy_source);
            if (copy_source_range) {
                // note that CopySourceRange is only supported by s3.uploadPartCopy()
                throw new Error('NamespaceS3.upload_object: CopySourceRange not supported by s3.copyObject()');
            }

            /** @type {import("@aws-sdk/client-s3").CopyObjectRequest} */
            const request = {
                Bucket: this.bucket,
                Key: params.key,
                CopySource: copy_source,
                ContentType: params.content_type,
                StorageClass: params.storage_class,
                Metadata: params.xattr,
                MetadataDirective: params.xattr_copy ? 'COPY' : 'REPLACE',
                Tagging,
                TaggingDirective: params.tagging_copy ? 'COPY' : 'REPLACE',
            };

            this._assign_encryption_to_request(params, request);

            res = await this.s3.copyObject(request);
        } else {
            let count = 1;
            const count_stream = stream_utils.get_tap_stream(data => {
                this.stats?.update_namespace_write_stats({
                    namespace_resource_id: this.namespace_resource_id,
                    bucket_name: params.bucket,
                    size: data.length,
                    count
                });
                // clear count for next updates
                count = 0;
            });

            /** @type {import("@aws-sdk/client-s3").PutObjectRequest} */
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
                const cmd = new PutObjectCommand(request);
                // Capture Date header on this command only
                cmd.middlewareStack.add(
                    (next, context) => async args => {
                        const result = await next(args);
                        const hdrs = result?.response?.headers || {};
                        if (hdrs.date) date = new Date(hdrs.date);
                        return result;
                    }, {
                        step: "deserialize",
                        name: "saveDateMiddleware" }
                );
                res = await this.s3.send(cmd);
            } catch (err) {
                dbg.error(`upload_object: Object upload failed for bucket ${this.bucket} and 
                    key : ${params.key}, with erro : `, err);
                object_sdk.rpc_client.pool.update_issues_report({
                    namespace_resource_id: this.namespace_resource_id,
                    error_code: String(err.code),
                    time: Date.now(),
                });
                throw err;
            }
        }
        dbg.log0('NamespaceS3.upload_object:', this.bucket, inspect(params), 'res', inspect(res), 'Date', date);
        const etag = s3_utils.parse_etag(res.ETag || res.CopyObjectResult?.ETag);
        return { etag, version_id: res.VersionId, date };
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
        await this._prepare_sts_client();

        const Tagging = params.tagging && params.tagging.map(tag => tag.key + '=' + tag.value).join('&');
        /** @type {import("@aws-sdk/client-s3").CreateMultipartUploadRequest} */
        const request = {
            Bucket: this.bucket,
            Key: params.key,
            ContentType: params.content_type,
            StorageClass: params.storage_class,
            Metadata: params.xattr,
            Tagging
        };
        this._assign_encryption_to_request(params, request);
        const res = await this.s3.createMultipartUpload(request);

        dbg.log0('NamespaceS3.create_object_upload:', this.bucket, inspect(params), 'res', inspect(res));
        return { obj_id: res.UploadId };
    }

    async upload_multipart(params, object_sdk) {
        dbg.log0('NamespaceS3.upload_multipart:', this.bucket, inspect(params));
        await this._prepare_sts_client();

        let res;
        let etag;
        if (params.copy_source) {
            const { copy_source, copy_source_range } = s3_utils.format_copy_source(params.copy_source);

            /** @type {import("@aws-sdk/client-s3").UploadPartCopyRequest} */
            const request = {
                Bucket: this.bucket,
                Key: params.key,
                UploadId: params.obj_id,
                PartNumber: params.num,
                CopySource: copy_source,
                CopySourceRange: copy_source_range,
            };

            this._assign_encryption_to_request(params, request);

            res = await this.s3.uploadPartCopy(request);
            dbg.log0('NamespaceS3.upload_multipart uploadPartCopy:', this.bucket, inspect(params), 'res', inspect(res));
            etag = s3_utils.parse_etag(res.CopyPartResult.ETag);
        } else {
            let count = 1;
            const count_stream = stream_utils.get_tap_stream(data => {
                this.stats?.update_namespace_write_stats({
                    namespace_resource_id: this.namespace_resource_id,
                    size: data.length,
                    count
                });
                // clear count for next updates
                count = 0;
            });

            /** @type {import("@aws-sdk/client-s3").UploadPartRequest} */
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
                res = await this.s3.uploadPart(request);
            } catch (err) {
                object_sdk.rpc_client.pool.update_issues_report({
                    namespace_resource_id: this.namespace_resource_id,
                    error_code: String(err.code),
                    time: Date.now(),
                });
                throw err;
            }
            dbg.log0('NamespaceS3.upload_multipart uploadPart:', this.bucket, inspect(params), 'res', inspect(res));
            etag = s3_utils.parse_etag(res.ETag);
        }
        return { etag };
    }

    async list_multiparts(params, object_sdk) {
        dbg.log0('NamespaceS3.list_multiparts:', this.bucket, inspect(params));
        await this._prepare_sts_client();
        /** @type {import("@aws-sdk/client-s3").ListPartsRequest} */
        const req = {
            Bucket: this.bucket,
            Key: params.key,
            UploadId: params.obj_id,
            MaxParts: params.max,
            PartNumberMarker: params.num_marker?.toString(),
        };
        const res = await this.s3.listParts(req);
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
        await this._prepare_sts_client();

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
        });

        dbg.log0('NamespaceS3.complete_object_upload:', this.bucket, inspect(params), 'res', inspect(res));
        const etag = s3_utils.parse_etag(res.ETag);
        return { etag, version_id: res.VersionId };
    }

    async abort_object_upload(params, object_sdk) {
        dbg.log0('NamespaceS3.abort_object_upload:', this.bucket, inspect(params));
        await this._prepare_sts_client();

        const res = await this.s3.abortMultipartUpload({
            Bucket: this.bucket,
            Key: params.key,
            UploadId: params.obj_id,
        });

        dbg.log0('NamespaceS3.abort_object_upload:', this.bucket, inspect(params), 'res', inspect(res));
    }

    ////////////////////
    // OBJECT TAGGING //
    ////////////////////

    async put_object_tagging(params, object_sdk) {
        dbg.log0('NamespaceS3.put_object_tagging:', this.bucket, inspect(params));
        await this._prepare_sts_client();

        const TagSet = params.tagging.map(tag => ({
            Key: tag.key,
            Value: tag.value
        }));

        const res = await this.s3.putObjectTagging({
            Bucket: this.bucket,
            Key: params.key,
            VersionId: params.version_id,
            Tagging: { TagSet }
        });

        dbg.log0('NamespaceS3.put_object_tagging:', this.bucket, inspect(params), 'res', inspect(res));

        return {
            version_id: res.VersionId
        };
    }

    async delete_object_tagging(params, object_sdk) {
        dbg.log0('NamespaceS3.delete_object_tagging:', this.bucket, inspect(params));
        await this._prepare_sts_client();

        const res = await this.s3.deleteObjectTagging({
            Bucket: this.bucket,
            Key: params.key,
            VersionId: params.version_id
        });

        dbg.log0('NamespaceS3.delete_object_tagging:', this.bucket, inspect(params), 'res', inspect(res));

        return {
            version_id: res.VersionId
        };
    }

    async get_object_tagging(params, object_sdk) {
        dbg.log0('NamespaceS3.get_object_tagging:', this.bucket, inspect(params));
        await this._prepare_sts_client();

        const res = await this.s3.getObjectTagging({
            Bucket: this.bucket,
            Key: params.key,
            VersionId: params.version_id
        });

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
        await this._prepare_sts_client();

        const res = await this.s3.getObjectAcl({
            Bucket: this.bucket,
            Key: params.key,
            VersionId: params.version_id
        });

        dbg.log0('NamespaceS3.get_object_acl:', this.bucket, inspect(params), 'res', inspect(res));

        return {
            owner: res.Owner,
            access_control_list: res.Grants
        };
    }

    async put_object_acl(params, object_sdk) {
        dbg.log0('NamespaceS3.put_object_acl:', this.bucket, inspect(params));
        await this._prepare_sts_client();

        const res = await this.s3.putObjectAcl({
            Bucket: this.bucket,
            Key: params.key,
            VersionId: params.version_id,
            ACL: params.acl
        });

        dbg.log0('NamespaceS3.put_object_acl:', this.bucket, inspect(params), 'res', inspect(res));
    }

    ///////////////////
    // OBJECT DELETE //
    ///////////////////

    async delete_object(params, object_sdk) {
        dbg.log0('NamespaceS3.delete_object:', this.bucket, inspect(params));
        await this._prepare_sts_client();

        const res = await this.s3.deleteObject({
            Bucket: this.bucket,
            Key: params.key,
            VersionId: params.version_id,
        });

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
        await this._prepare_sts_client();

        const res = await this.s3.deleteObjects({
            Bucket: this.bucket,
            Delete: {
                Objects: _.map(params.objects, obj => ({
                    Key: obj.key,
                    VersionId: obj.version_id,
                }))
            }
        });

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

    ////////////////////
    // OBJECT RESTORE //
    ////////////////////

    async restore_object(params, object_sdk) {
        throw new S3Error(S3Error.NotImplemented);
    }

    //////////////////////////
    //  OBJECT ATTRIBUTES   //
    //////////////////////////

    async get_object_attributes(params, object_sdk) {
        dbg.log0('NamespaceS3.get_object_attributes:', this.bucket, inspect(params));
        await this._prepare_sts_client();

        /** @type {import("@aws-sdk/client-s3").GetObjectAttributesRequest} */
        const request = {
            Bucket: this.bucket,
            Key: params.key,
            VersionId: params.version_id,
            ObjectAttributes: params.attributes,
        };
        this._set_md_conditions(params, request);
        this._assign_encryption_to_request(params, request);
        try {
            const res = await this.s3.getObjectAttributes(request);
            dbg.log0('NamespaceS3.get_object_attributes:', this.bucket, inspect(params), 'res', inspect(res));
            return this._get_s3_object_info(res, params.bucket);
        } catch (err) {
            this._translate_error_code(params, err);
            dbg.warn('NamespaceS3.get_object_attributes:', inspect(err));
            // It's totally expected to issue `HeadObject` against an object that doesn't exist
            // this shouldn't be counted as an issue for the namespace store
            if (err.rpc_code !== 'NO_SUCH_OBJECT') {
                object_sdk.rpc_client.pool.update_issues_report({
                    namespace_resource_id: this.namespace_resource_id,
                    error_code: String(err.code),
                    time: Date.now(),
                });
            }
            throw err;
        }
    }

    ///////////////
    // INTERNALS //
    ///////////////

    /**
     * 
     * @param {Omit<Partial<
     *   import("@aws-sdk/client-s3")._Object &
     *   import("@aws-sdk/client-s3").ObjectVersion &
     *   import("@aws-sdk/client-s3").DeleteMarkerEntry &
     *   import("@aws-sdk/client-s3").MultipartUpload &
     *   import("@aws-sdk/client-s3").GetObjectOutput &
     *   import("@aws-sdk/client-s3").GetObjectAttributesOutput
     * >, 'ChecksumAlgorithm'>} res 
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
        const size = ranges || res.ContentLength || res.Size || res.ObjectSize || 0;
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
            storage_class: s3_utils.parse_storage_class(res.StorageClass),
            xattr,
            tag_count: res.TagCount,
            first_range_data: Buffer.isBuffer(res.Body) ? res.Body : undefined,
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
            object_owner: this._get_object_owner(),
            checksum: res.Checksum,
            // @ts-ignore // See note in GetObjectAttributesParts in file nb.d.ts
            object_parts: res.ObjectParts,
        };
    }

    _translate_error_code(params, err) {
        const err_code = err.code || err.Code;
        if (err_code === 'NoSuchKey') err.rpc_code = 'NO_SUCH_OBJECT';
        else if (err_code === 'NotFound') err.rpc_code = 'NO_SUCH_OBJECT';
        else if (err_code === 'InvalidRange') err.rpc_code = 'INVALID_RANGE';
        else if (params.md_conditions) {
            const md_conditions = params.md_conditions;
            if (err_code === 'PreconditionFailed') {
                if (md_conditions.if_match_etag) err.rpc_code = 'IF_MATCH_ETAG';
                else if (md_conditions.if_unmodified_since) err.rpc_code = 'IF_UNMODIFIED_SINCE';
            } else if (err_code === 'NotModified') {
                if (md_conditions.if_modified_since) err.rpc_code = 'IF_MODIFIED_SINCE';
                else if (md_conditions.if_none_match_etag) err.rpc_code = 'IF_NONE_MATCH_ETAG';
            }
        }
    }

    /** 
     * @param {Partial<{
     *   ServerSideEncryption: AWS.S3.ServerSideEncryption,
     *   SSEKMSKeyId: AWS.S3.SSEKMSKeyId,
     *   SSECustomerKey: AWS.S3.SSECustomerKey,
     *   SSECustomerAlgorithm: AWS.S3.SSECustomerAlgorithm,
     *   CopySourceSSECustomerKey: AWS.S3.CopySourceSSECustomerKey,
     *   CopySourceSSECustomerAlgorithm: AWS.S3.CopySourceSSECustomerAlgorithm,
     *  }>} request
     */
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
