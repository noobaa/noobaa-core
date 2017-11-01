/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const AWS = require('aws-sdk');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const http_utils = require('../../util/http_utils');
const BlockStoreBase = require('./block_store_base').BlockStoreBase;
const { RpcError } = require('../../rpc');

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
        // upload copy to s3 cloud storage.
        if (this.cloud_info.endpoint === 'https://s3.amazonaws.com') {
            const httpOptions = this.proxy ? {
                agent: http_utils.get_unsecured_http_agent(this.cloud_info.endpoint, this.proxy)
            } : undefined;
            this.s3cloud = new AWS.S3({
                endpoint: this.cloud_info.endpoint,
                accessKeyId: this.cloud_info.access_keys.access_key,
                secretAccessKey: this.cloud_info.access_keys.secret_key,
                httpOptions,
                region: 'us-east-1'
            });
        } else {
            this.s3cloud = new AWS.S3({
                endpoint: this.cloud_info.endpoint,
                s3ForcePathStyle: true,
                accessKeyId: this.cloud_info.access_keys.access_key,
                secretAccessKey: this.cloud_info.access_keys.secret_key,
                httpOptions: {
                    agent: http_utils.get_unsecured_http_agent(this.cloud_info.endpoint, this.proxy)
                }
            });
        }
    }

    init() {
        let params = {
            Bucket: this.cloud_info.target_bucket,
            Key: this.usage_path
        };
        return P.ninvoke(this.s3cloud, 'headObject', params)
            .then(head => {
                let usage_data = head.Metadata[this.usage_md_key];
                if (usage_data) {
                    this._usage = this._decode_block_md(usage_data);
                    dbg.log0('found usage data in', this.usage_path, 'usage_data = ', this._usage);
                }
            }, err => {
                if (err.code === 'NotFound') {
                    // first time init, continue without usage info
                    dbg.log0('BlockStoreS3 init: no usage path');
                } else {
                    dbg.error('got error on init:', err);
                }
            });
    }

    get_storage_info() {
        const PETABYTE = 1024 * 1024 * 1024 * 1024 * 1024;
        return P.resolve(this._get_usage())
            .then(usage => ({
                total: PETABYTE + usage.size,
                free: PETABYTE,
                used: usage.size
            }));
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
        return {
            signed_url: this.s3cloud.getSignedUrl('getObject', params),
            proxy: this.proxy
        };
    }

    _delegate_write_block(block_md, data_length) {
        dbg.log0(`DZDZ: got bolck_md=${block_md}, data_length=${data_length}`);
        const encoded_md = this._encode_block_md(block_md);
        const block_key = this._block_key(block_md.id);
        const metadata = {
            noobaa_block_md: encoded_md
        };

        const usage = data_length ? {
            size: data_length + encoded_md.length,
            count: 1
        } : { size: 0, count: 0 };
        if (data_length) {
            this._update_usage(usage);
        }

        return {
            usage,
            signed_url: this.s3cloud.getSignedUrl('putObject', {
                Bucket: this.cloud_info.target_bucket,
                Key: block_key,
                Metadata: metadata
            }),
            proxy: this.proxy
        };
    }


    _read_block(block_md) {
        return P.ninvoke(this.s3cloud, 'getObject', {
                Bucket: this.cloud_info.target_bucket,
                Key: this._block_key(block_md.id),
            })
            .then(data => ({
                data: data.Body,
                block_md: this._decode_block_md(data.Metadata.noobaa_block_md)
            }))
            .catch(err => {
                if (this._try_change_region(err)) {
                    return this._read_block(block_md);
                }
                dbg.error('_read_block failed:', err, _.omit(this.cloud_info, 'secret_key'));
                if (err.code === 'NoSuchBucket') {
                    throw new RpcError('STORAGE_NOT_EXIST', `s3 bucket ${this.cloud_info.target_bucket} not found. got error ${err}`);
                } else if (err.code === 'AccessDenied') {
                    throw new RpcError('AUTH_FAILED', `access denied to the s3 bucket ${this.cloud_info.target_bucket}. got error ${err}`);
                }
                throw err;
            });
    }

    _write_block(block_md, data, options) {
        let encoded_md;
        let params = {
            Bucket: this.cloud_info.target_bucket,
            Key: this._block_key(block_md.id),
        };
        dbg.log3('writing block id to cloud: ', params.Key);
        //  write block + md to cloud
        encoded_md = this._encode_block_md(block_md);
        params.Metadata = {
            noobaa_block_md: encoded_md
        };
        params.Body = data;
        return this._put_object(params)
            .then(() => {
                if (options && options.ignore_usage) return;
                // return usage count for the object
                let usage = {
                    size: data.length + encoded_md.length,
                    count: 1
                };
                return this._update_usage(usage);
            })
            .catch(err => {
                dbg.error('_write_block failed:', err, _.omit(this.cloud_info, 'secret_key'));
                if (err.code === 'NoSuchBucket') {
                    throw new RpcError('STORAGE_NOT_EXIST', `s3 bucket ${this.cloud_info.target_bucket} not found. got error ${err}`);
                } else if (err.code === 'AccessDenied') {
                    throw new RpcError('AUTH_FAILED', `access denied to the s3 bucket ${this.cloud_info.target_bucket}. got error ${err}`);
                }
                throw err;
            });
    }

    _handle_delegator_error(err, usage) {
        if (usage) {
            this._update_usage({ size: -usage.size, count: -usage.count });
        }
        this._try_change_region(err);
        dbg.error('BlockStoreS3 operation failed:', err, this.cloud_info);
        if (err.code === 'NoSuchBucket') {
            throw new RpcError('STORAGE_NOT_EXIST', `s3 bucket ${this.cloud_info.target_bucket} not found. got error ${err}`);
        } else if (err.code === 'AccessDenied') {
            throw new RpcError('AUTH_FAILED', `access denied to the s3 bucket ${this.cloud_info.target_bucket}. got error ${err}`);
        }
        throw err;
    }

    _write_usage_internal() {
        let usage_data = this._encode_block_md(this._usage);
        let params = {
            Bucket: this.cloud_info.target_bucket,
            Key: this.usage_path,
            Metadata: {}
        };
        params.Metadata[this.usage_md_key] = usage_data;
        return this._put_object(params);
    }

    _put_object(params) {
        return P.ninvoke(this.s3cloud, 'putObject', params)
            .catch(err => {
                if (this._try_change_region(err)) {
                    return this._put_object(params);
                }
                dbg.error('_write_block failed:', err, _.omit(this.cloud_info, 'secret_key'));
                throw err;
            });
    }

    _delete_blocks(block_ids) {
        let deleted_storage = {
            size: 0,
            count: 0
        };
        // Todo: Assuming that all requested blocks were deleted, which a bit naive
        return this._get_blocks_usage(block_ids)
            .then(ret_usage => {
                deleted_storage.size -= ret_usage.size;
                deleted_storage.count -= ret_usage.count;
                return P.ninvoke(this.s3cloud, 'deleteObjects', {
                        Bucket: this.cloud_info.target_bucket,
                        Delete: {
                            Objects: _.map(block_ids, block_id => ({
                                Key: this._block_key(block_id)
                            }))
                        }
                    })
                    .catch(err => {
                        if (this._try_change_region(err)) {
                            return this._delete_blocks(block_ids);
                        }
                        dbg.error('_delete_blocks failed:', err, _.omit(this.cloud_info, 'secret_key'));
                        throw err;
                    });
            })
            .then(() => this._update_usage(deleted_storage));
    }


    _get_blocks_usage(block_ids) {
        let usage = {
            size: 0,
            count: 0
        };
        return P.map(block_ids, block_id => {
                let params = {
                    Bucket: this.cloud_info.target_bucket,
                    Key: this._block_key(block_id),
                };
                return P.ninvoke(this.s3cloud, 'headObject', params)
                    .then(head => {
                        let deleted_size = Number(head.ContentLength);
                        let md_size = head.Metadata.noobaa_block_md ? head.Metadata.noobaa_block_md.length : 0;
                        deleted_size += md_size;
                        usage.size += deleted_size;
                        usage.count += 1;
                    }, err => {
                        dbg.warn('_get_blocks_usage:', err);
                    });
            }, {
                // limit concurrency to 10
                concurrency: 10
            })
            .then(() => usage);
    }

    _block_key(block_id) {
        let block_dir = this._get_block_internal_dir(block_id);
        return `${this.blocks_path}/${block_dir}/${block_id}`;
    }

    _encode_block_md(block_md) {
        return Buffer.from(JSON.stringify(block_md)).toString('base64');
    }

    _decode_block_md(noobaa_block_md) {
        return JSON.parse(Buffer.from(noobaa_block_md, 'base64'));
    }

    _try_change_region(err) {
        // try to change default region from US to EU
        // due to restricted signature of v4 and end point
        if ((err.statusCode === 400 || err.statusCode === 301) &&
            this.s3cloud.config.signatureVersion !== 'v4') {
            dbg.log0('Resetting signature type and region to eu-central-1 and v4');
            this.s3cloud.config.signatureVersion = 'v4';
            this.s3cloud.config.region = 'eu-central-1';
            return true;
        }
        return false;
    }

}

// EXPORTS
exports.BlockStoreS3 = BlockStoreS3;
