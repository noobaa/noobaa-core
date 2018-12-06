/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const AWS = require('aws-sdk');

const config = require('../../../config');
const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const http_utils = require('../../util/http_utils');
const cloud_utils = require('../../util/cloud_utils');
const BlockStoreBase = require('./block_store_base').BlockStoreBase;
const { RpcError } = require('../../rpc');


const DEFAULT_REGION = 'us-east-1';

class BlockStoreS3 extends BlockStoreBase {

    constructor(options) {
        super(options);
        this.cloud_info = options.cloud_info;
        this.proxy = options.proxy;
        this.base_path = options.cloud_path;
        this.blocks_path = this.base_path + '/blocks_tree';
        this.usage_path = this.base_path + '/usage';
        this.usage_md_key = 'noobaa_usage';
        this._usage = {
            size: 0,
            count: 0
        };

        const endpoint = this.cloud_info.endpoint;
        // upload copy to s3 cloud storage.
        if (cloud_utils.is_aws_endpoint(endpoint)) {
            const httpOptions = this.proxy ? {
                agent: http_utils.get_unsecured_http_agent(endpoint, this.proxy)
            } : undefined;
            this.s3cloud = new AWS.S3({
                endpoint: endpoint,
                accessKeyId: this.cloud_info.access_keys.access_key,
                secretAccessKey: this.cloud_info.access_keys.secret_key,
                s3ForcePathStyle: true,
                httpOptions,
                signatureVersion: cloud_utils.get_s3_endpoint_signature_ver(endpoint, this.cloud_info.auth_method),
                region: DEFAULT_REGION
            });
        } else {
            this.disable_delegation = config.EXPERIMENTAL_DISABLE_S3_COMPATIBLE_DELEGATION[this.cloud_info.endpoint_type] ||
                config.EXPERIMENTAL_DISABLE_S3_COMPATIBLE_DELEGATION.DEFAULT;
            this.disable_metadata = config.EXPERIMENTAL_DISABLE_S3_COMPATIBLE_METADATA[this.cloud_info.endpoint_type] ||
                config.EXPERIMENTAL_DISABLE_S3_COMPATIBLE_METADATA.DEFAULT;
            this.s3cloud = new AWS.S3({
                endpoint: endpoint,
                s3ForcePathStyle: true,
                accessKeyId: this.cloud_info.access_keys.access_key,
                secretAccessKey: this.cloud_info.access_keys.secret_key,
                signatureVersion: cloud_utils.get_s3_endpoint_signature_ver(endpoint, this.cloud_info.auth_method),
                s3DisableBodySigning: cloud_utils.disable_s3_compatible_bodysigning(endpoint),
                httpOptions: {
                    agent: http_utils.get_unsecured_http_agent(endpoint, this.proxy)
                }
            });
        }

    }

    async init() {
        try {
            const res = await this.s3cloud.getObject({
                Bucket: this.cloud_info.target_bucket,
                Key: this.usage_path,
            }).promise();

            const usage_data = this.disable_metadata ?
                res.Body.toString() :
                res.Metadata[this.usage_md_key];
            if (usage_data && usage_data.length) {
                this._usage = this._decode_block_md(usage_data);
                dbg.log0('found usage data in', this.usage_path, 'usage_data = ', this._usage);
            }

        } catch (err) {
            if (err.code === 'NoSuchKey') {
                // first time init, continue without usage info
                dbg.log0('BlockStoreS3 init: no usage path');
            } else {
                dbg.error('got error on init:', err);
            }
        }
    }

    async _read_block_md(block_md) {
        const res = await this.s3cloud.headObject({
            Bucket: this.cloud_info.target_bucket,
            Key: this._block_key(block_md.id),
        }).promise();
        return {
            block_md: this._get_store_block_md(block_md, res),
            store_md5: res.ETag.toUpperCase(),
        };
    }

    async get_storage_info() {
        const PETABYTE = 1024 * 1024 * 1024 * 1024 * 1024;
        const usage = await this._get_usage();
        return {
            total: PETABYTE + usage.size,
            free: PETABYTE,
            used: usage.size
        };
    }

    _get_usage() {
        return this._usage || this._count_usage();
    }

    _count_usage() {
        // TODO: count usage from cloud
        return this._usage || {
            size: 0,
            count: 0
        };
    }

    _delegate_read_block(block_md) {
        const params = {
            Bucket: this.cloud_info.target_bucket,
            Key: this._block_key(block_md.id),
        };

        if (this.disable_delegation) {
            // if S3 compatible does not support signed urls we return access\secret instead
            const endpoint = this.cloud_info.endpoint;
            return {
                disable_delegation: this.disable_delegation,
                disable_metadata: this.disable_metadata,
                s3_params: {
                    endpoint: endpoint,
                    s3ForcePathStyle: true,
                    accessKeyId: this.cloud_info.access_keys.access_key,
                    secretAccessKey: this.cloud_info.access_keys.secret_key,
                    signatureVersion: cloud_utils.get_s3_endpoint_signature_ver(endpoint, this.cloud_info.auth_method),
                    s3DisableBodySigning: cloud_utils.disable_s3_compatible_bodysigning(endpoint),
                },
                read_params: params,
                proxy: this.proxy
            };
        }

        this._update_read_stats(block_md.size);

        return {
            disable_delegation: this.disable_delegation,
            disable_metadata: this.disable_metadata,
            signed_url: this.s3cloud.getSignedUrl('getObject', params),
            proxy: this.proxy
        };
    }

    _delegate_write_block(block_md, data_length) {
        const encoded_md = this.disable_metadata ? '' : this._encode_block_md(block_md);
        const block_key = this._block_key(block_md.id);

        const usage = data_length ? {
            size: (block_md.preallocated ? 0 : data_length) + encoded_md.length,
            count: block_md.preallocated ? 0 : 1
        } : { size: 0, count: 0 };
        if (data_length) {
            this._update_usage(usage);
        }
        this._update_write_stats(usage.size);
        const params = {
            Bucket: this.cloud_info.target_bucket,
            Key: block_key,
            Metadata: this.disable_metadata ? undefined : { noobaablockmd: encoded_md },
        };

        if (this.disable_delegation) {
            // if S3 compatible does not support signed urls we return access\secret instead
            const endpoint = this.cloud_info.endpoint;
            return {
                disable_delegation: this.disable_delegation,
                disable_metadata: this.disable_metadata,
                s3_params: {
                    endpoint: endpoint,
                    s3ForcePathStyle: true,
                    accessKeyId: this.cloud_info.access_keys.access_key,
                    secretAccessKey: this.cloud_info.access_keys.secret_key,
                    signatureVersion: cloud_utils.get_s3_endpoint_signature_ver(endpoint, this.cloud_info.auth_method),
                    s3DisableBodySigning: cloud_utils.disable_s3_compatible_bodysigning(endpoint),
                },
                write_params: params,
                proxy: this.proxy
            };
        }

        const signed_url = this.s3cloud.getSignedUrl('putObject', params);

        return {
            disable_delegation: this.disable_delegation,
            disable_metadata: this.disable_metadata,
            usage,
            signed_url,
            proxy: this.proxy
        };
    }


    async _read_block(block_md) {
        try {
            const res = await this.s3cloud.getObject({
                Bucket: this.cloud_info.target_bucket,
                Key: this._block_key(block_md.id),
            }).promise();
            return {
                data: res.Body,
                block_md: this._get_store_block_md(block_md, res),
            };
        } catch (err) {
            dbg.error('_read_block failed:', err, _.omit(this.cloud_info, 'access_keys'));
            if (err.code === 'NoSuchBucket') {
                throw new RpcError('STORAGE_NOT_EXIST', `s3 bucket ${this.cloud_info.target_bucket} not found. got error ${err}`);
            } else if (err.code === 'AccessDenied') {
                throw new RpcError('AUTH_FAILED', `access denied to the s3 bucket ${this.cloud_info.target_bucket}. got error ${err}`);
            }
            throw err;
        }
    }

    async _write_block(block_md, data, options) {
        try {
            const block_key = this._block_key(block_md.id);
            const encoded_md = this.disable_metadata ? '' : this._encode_block_md(block_md);
            dbg.log3('writing block id to cloud:', block_key);
            await this.s3cloud.putObject({
                Bucket: this.cloud_info.target_bucket,
                Key: block_key,
                Body: data,
                Metadata: this.disable_metadata ? undefined : { noobaablockmd: encoded_md },
            }).promise();
            if (options && options.ignore_usage) return;
            // return usage count for the object
            return this._update_usage({
                size: (block_md.preallocated ? 0 : data.length) + encoded_md.length,
                count: block_md.preallocated ? 0 : 1
            });
        } catch (err) {
            dbg.error('_write_block failed:', err, _.omit(this.cloud_info, 'access_keys'));
            if (err.code === 'NoSuchBucket') {
                throw new RpcError('STORAGE_NOT_EXIST', `s3 bucket ${this.cloud_info.target_bucket} not found. got error ${err}`);
            } else if (err.code === 'AccessDenied') {
                throw new RpcError('AUTH_FAILED', `access denied to the s3 bucket ${this.cloud_info.target_bucket}. got error ${err}`);
            }
            throw err;
        }
    }

    _handle_delegator_error(err, usage, op_type) {
        if (usage) {
            if (op_type === 'WRITE') {
                this._update_usage({ size: -usage.size, count: -usage.count });
                this._update_write_stats(usage.size, /*is_err =*/ true);
            } else if (op_type === 'READ') {
                this._update_read_stats(usage.size, /*is_err =*/ true);
            }
        }

        dbg.error('BlockStoreS3 operation failed:', err, _.omit(this.cloud_info, 'access_keys'));
        if (err.code === 'NoSuchBucket') {
            throw new RpcError('STORAGE_NOT_EXIST', `s3 bucket ${this.cloud_info.target_bucket} not found. got error ${err}`);
        } else if (err.code === 'AccessDenied') {
            throw new RpcError('AUTH_FAILED', `access denied to the s3 bucket ${this.cloud_info.target_bucket}. got error ${err}`);
        }
        throw new Error(err.message || 'unknown error');
    }

    async _write_usage_internal() {
        const usage_data = this._encode_block_md(this._usage);
        const res = await this.s3cloud.putObject({
            Bucket: this.cloud_info.target_bucket,
            Key: this.usage_path,
            Body: this.disable_metadata ? usage_data : undefined,
            Metadata: this.disable_metadata ? undefined : {
                [this.usage_md_key]: usage_data
            },
        }).promise();
        // if our target bucket returns version ids that means versioning is enabled
        // and for the usage file that we keep replacing we want to keep only the latest
        // so we delete the past versions of the usage file.
        if (res.VersionId) await this._delete_past_versions(this.usage_path);
    }

    /**
     * This is used for cleanup in BlockStoreBase.test_store_perf()
     * to keep only the latest versions of the test block.
     */
    async _delete_block_past_versions(block_md) {
        return this._delete_past_versions(this._block_key(block_md.id));
    }

    async _delete_past_versions(key) {
        if (this.cloud_info.endpoint_type !== 'AWS') return;
        let is_truncated = true;
        let key_marker;
        let version_marker;
        while (is_truncated) {
            const res = await this.s3cloud.listObjectVersions({
                Bucket: this.cloud_info.target_bucket,
                Prefix: key,
                Delimiter: '/',
                KeyMarker: key_marker,
                VersionIdMarker: version_marker,
            }).promise();
            is_truncated = res.IsTruncated;
            key_marker = res.NextKeyMarker;
            version_marker = res.NextVersionIdMarker;
            const delete_list = res.Versions.concat(res.DeleteMarkers)
                .filter(it => it.Key === key && !it.IsLatest)
                .map(it => ({ Key: it.Key, VersionId: it.VersionId }));
            if (delete_list.length) {
                dbg.log0('BlockStoreS3._delete_past_versions: target_bucket',
                    this.cloud_info.target_bucket, 'delete_list', delete_list);
                await this.s3cloud.deleteObjects({
                    Bucket: this.cloud_info.target_bucket,
                    Delete: { Objects: delete_list },
                }).promise();
            }
        }
    }

    async _delete_blocks(block_ids) {
        let deleted_storage = {
            size: 0,
            count: 0
        };
        let failed_block_ids = [];
        // Todo: Assuming that all requested blocks were deleted, which a bit naive
        try {
            const usage = await this._get_blocks_usage(block_ids);
            deleted_storage.size -= usage.size;
            deleted_storage.count -= usage.count;
            const res = await this.s3cloud.deleteObjects({
                Bucket: this.cloud_info.target_bucket,
                Delete: {
                    Objects: _.map(block_ids, block_id => ({
                        Key: this._block_key(block_id)
                    }))
                }
            }).promise();
            if (res.Errors) {
                for (const delete_error of res.Errors) {
                    const block_id = this._block_id_from_key(delete_error.Key);
                    failed_block_ids.push(block_id);
                }
            }
        } catch (err) {
            dbg.error('_delete_blocks failed:', err, _.omit(this.cloud_info, 'access_keys'));
            failed_block_ids.push(...block_ids);
        }
        this._update_usage(deleted_storage);
        return {
            failed_block_ids,
            succeeded_block_ids: _.difference(block_ids, failed_block_ids)
        };
    }

    async _get_blocks_usage(block_ids) {
        const usage = {
            size: 0,
            count: 0
        };
        await P.map(block_ids, async block_id => {
            try {
                const res = await this.s3cloud.headObject({
                    Bucket: this.cloud_info.target_bucket,
                    Key: this._block_key(block_id),
                }).promise();
                const noobaablockmd = res.Metadata.noobaablockmd || res.Metadata.noobaa_block_md;
                const md_size = (noobaablockmd && noobaablockmd.length) || 0;
                usage.size += Number(res.ContentLength) + md_size;
                usage.count += 1;
            } catch (err) {
                dbg.warn('_get_blocks_usage:', err);
            }
        }, { concurrency: 10 });
        return usage;
    }

    _get_store_block_md(block_md, res) {
        if (this.disable_metadata) return block_md;
        const noobaablockmd = res.Metadata.noobaablockmd || res.Metadata.noobaa_block_md;
        return this._decode_block_md(noobaablockmd);
    }

}

// EXPORTS
exports.BlockStoreS3 = BlockStoreS3;
