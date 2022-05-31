/* Copyright (C) 2016 NooBaa */
'use strict';


const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const size_utils = require('../../util/size_utils');
const buffer_utils = require('../../util/buffer_utils');
const azure_storage = require('../../util/new_azure_storage_wrap');
const BlockStoreBase = require('./block_store_base').BlockStoreBase;
const { RpcError } = require('../../rpc');
const _ = require('lodash');

class BlockStoreAzure extends BlockStoreBase {

    constructor(options) {
        super(options);
        this.cloud_info = options.cloud_info;
        this.base_path = options.cloud_path;
        this.blocks_path = this.base_path + '/blocks_tree';
        this.usage_path = this.base_path + '/usage';
        this.usage_md_key = 'noobaa_usage';
        this.blob = azure_storage.BlobServiceClient.fromConnectionString(this.cloud_info.azure.connection_string);
        this.container_name = this.cloud_info.azure.container;
        this.container_client = azure_storage.get_container_client(this.blob, this.container_name);
    }

    init() {
        return this._read_usage();
    }

    async get_storage_info(external_info = {}) {
        const { free = size_utils.PETABYTE } = external_info;
        const usage = await this._get_usage();
        return {
            total: size_utils.sum_bigint_json(free, usage.size),
            free: free,
            used: usage.size
        };
    }

    _get_block_store_info() {
        const connection_params = {
            connection_string: this.cloud_info.azure.connection_string,
        };
        return {
            connection_params,
            target_bucket: this.cloud_info.target_bucket,
            blocks_path: this.blocks_path,
        };
    }

    async _read_block(block_md) {

        const block_key = this._block_key(block_md.id);
        const blob_client = azure_storage.get_blob_client(this.container_client, block_key);
        dbg.log1('block_store_azure._read_block downloading: ', block_key, block_md);

        try {
            const response = await blob_client.download(0, undefined);
            dbg.log1('block_store_azure._read_block download response: ', response);
            return ({
                data: await buffer_utils.read_stream_join(response.readableStreamBody),
                block_md: this._decode_block_md(response.metadata.noobaablockmd || response.metadata.noobaa_block_md)
            });
        } catch (err) {
            dbg.error('BlockStoreAzure _read_block failed:',
                this.container_name, block_key, err, err.details && err.details.code);
            if (err.details && err.details.code === 'ContainerNotFound') {
                throw new RpcError('STORAGE_NOT_EXIST', `azure container ${this.container_name} not found. got error ${err}`);
            } else if (err.details && err.details.code === 'AuthenticationFailed') {
                throw new RpcError('AUTH_FAILED', `access denied to the azure container ${this.container_name}. got error ${err}`);
            }
            throw err;
        }
    }



    async _read_block_md(block_md) {
        const blob_client = azure_storage.get_blob_client(this.container_client, this._block_key(block_md.id));
        const block_info = await blob_client.getProperties();
        dbg.log1('block_store_azure._read_block_md block_info: ', block_info);

        const store_block_md = this._decode_block_md(block_info.metadata.noobaablockmd || block_info.metadata.noobaa_block_md);
        const store_md5 = block_info.contentMD5;
        dbg.log1('block_store_azure._read_block_md store_block_md: ', store_block_md, ' store_md5: ', store_md5);

        return {
            block_md: store_block_md,
            store_md5
        };
    }

    async _write_block(block_md, data, options) {
        const encoded_md = this._encode_block_md(block_md);
        const block_key = this._block_key(block_md.id);
        // check to see if the object already exists
        const blob_client = azure_storage.get_blob_client(this.container_client, block_key);
        dbg.log1('block_store_azure._write_block upload: data.length: ', data.length, ' md: ', block_md);

        try {
            await blob_client.upload(
                data, data.length, {
                    metadata: {
                        noobaablockmd: encoded_md
                    }
                });

            dbg.log1('block_store_azure._write_block finished upload YAY');

            if (options && options.ignore_usage) return;
            // return usage count for the object
            const usage = {
                size: (block_md.is_preallocated ? 0 : data.length) + encoded_md.length,
                count: block_md.is_preallocated ? 0 : 1
            };
            return this._update_usage(usage);

        } catch (err) {
            dbg.error('BlockStoreAzure _write_block failed:',
                this.container_name, block_key, err.details && err.details.code, err);
            if (err.details && err.details.code === 'ContainerNotFound') {
                throw new RpcError('STORAGE_NOT_EXIST', `azure container ${this.container_name} not found. got error ${err}`);
            } else if (err.details && err.details.code === 'AuthenticationFailed') {
                throw new RpcError('AUTH_FAILED', `access denied to the azure container ${this.container_name}. got error ${err}`);
            }
            throw err;
        }
    }

    async cleanup_target_path() {
        let total = 0;
        let continuation_token;
        try {
            let done = false;
            dbg.log0(`cleaning up all objects with prefix ${this.base_path}`);
            while (!done) {
                const prev_continuation_token = continuation_token;
                const iterator = this.container_client.listBlobsFlat({
                    prefix: this.base_path
                }).byPage({ continuationToken: prev_continuation_token, maxPageSize: 1000 });
                const list_res = (await iterator.next()).value;
                dbg.log1('block_store_azure.cleanup_target_path list_res: ', list_res);

                if (list_res.segment.blobItems.length !== 0) {
                    await P.map_with_concurrency(10, list_res.segment.blobItems, async entry => {
                        try {
                            dbg.log1('block_store_azure.cleanup_target_path deleting blob: ', entry.name);

                            await this.container_client.deleteBlob(entry.name);
                            dbg.log1('block_store_azure.cleanup_target_path deleted blob succefully: ', entry.name);

                        } catch (err) {
                            dbg.warn('BlockStoreAzure _delete_blocks failed for block',
                                this.container_name, entry.name, err);
                        }
                    });
                }
                dbg.log1('block_store_azure.cleanup_target_path deleted blob: list_res.segment.blobItems: ', list_res.segment.blobItems);
                dbg.log1('block_store_azure.cleanup_target_path deleted blob: list_res.continuationToken: ', list_res.continuationToken);

                total += list_res.segment.blobItems.length;
                continuation_token = list_res.continuationToken;

                if (!continuation_token || list_res.segment.blobItems.length === 0) {
                    done = true;
                }
            }
        } catch (err) {
            dbg.error('got error on cleanup_target_path', this.base_path, err);
        }
        dbg.log0(`completed cleanup of ${total} objects with perfix ${this.base_path}`);
    }

    _delete_blocks(block_ids) {
        // Todo: Assuming that all requested blocks were deleted, which a bit naive
        let deleted_storage = {
            size: 0,
            count: 0
        };
        let failed_to_delete_block_ids = [];
        dbg.log1('block_store_azure._delete_blocks block_ids: ', block_ids);

        return P.map_with_concurrency(10, block_ids, async block_id => {
                const block_key = this._block_key(block_id);
                try {
                    const blob_client = azure_storage.get_blob_client(this.container_client, block_key);
                    const info_arg = await blob_client.getProperties();
                    dbg.log1('block_store_azure._delete_blocks info_arg: ', info_arg, 'block_key: ', block_key);

                    await this.container_client.deleteBlob(block_key);
                    dbg.log1('block_store_azure._delete_blocks deleted blob: block_key: ', block_key);

                    const data_size = Number(info_arg.contentLength);
                    const noobaablockmd = info_arg.metadata.noobaablockmd || info_arg.metadata.noobaa_block_md;
                    dbg.log1('block_store_azure._delete_blocks info: data_size: ', data_size, 'noobaablockmd: ', noobaablockmd);

                    const md_size = (noobaablockmd && noobaablockmd.length) || 0;
                    deleted_storage.size -= (data_size + md_size);
                    deleted_storage.count -= 1;

                } catch (err) {
                    dbg.log1('block_store_azure._delete_blocks err.details.code: ', err.details && err.details.code, err);
                    if (err.details && err.details.code !== 'BlobNotFound') {
                        failed_to_delete_block_ids.push(block_id);
                    }
                    dbg.warn('BlockStoreAzure _delete_blocks failed for block',
                        this.container_name, block_key, err);
                }
            })
            .then(() => this._update_usage(deleted_storage))
            .then(() => ({
                failed_block_ids: failed_to_delete_block_ids,
                succeeded_block_ids: _.difference(block_ids, failed_to_delete_block_ids)
            }));
    }

    async test_store_validity() {
        const block_key = this._block_key(`test-delete-non-existing-key-${Date.now()}`);
        try {
            await this.container_client.deleteBlob(block_key);
        } catch (err) {
            dbg.log1('block_store_azure.test_store_validity: err.details.code', err.details && err.details.code, 'err: ', err);
            if (err.details && err.details.code !== 'BlobNotFound') {
                dbg.error('in _test_cloud_service - deleteBlob failed:', err, _.omit(this.cloud_info, 'access_keys'));
                if (err.details && err.details.code === 'ContainerNotFound') {
                    throw new RpcError('STORAGE_NOT_EXIST', `s3 bucket ${this.cloud_info.target_bucket} not found. got error ${err}`);
                } else if (err.details && err.details.code === 'AuthenticationFailed') {
                    throw new RpcError('AUTH_FAILED', `access denied to the s3 bucket ${this.cloud_info.target_bucket}. got error ${err}`);
                }
                dbg.warn(`unexpected error (code=${err.details && err.details.code}) from deleteBlob during test. ignoring..`);
            }
        }
        dbg.log1('block_store_azure.test_store_validity finished succefully');
    }

    _handle_delegator_error(err, usage, op_type) {
        dbg.log1('block_store_azure._handle_delegator_error: err', err, 'usage: ', usage, 'op_type: ', op_type);
        if (usage) {
            if (op_type === 'WRITE') {
                this._update_usage({ size: -usage.size, count: -usage.count });
                this._update_write_stats(usage.size, /*is_err =*/ true);
            } else if (op_type === 'READ') {
                this._update_read_stats(usage.size, /*is_err =*/ true);
            }
        }
        dbg.error('BlockStoreAzure operation failed:',
            this.container_name, err.details && err.details.code, err);
        if (err.details && err.details.code === 'ContainerNotFound') {
            throw new RpcError('STORAGE_NOT_EXIST', `azure container ${this.container_name} not found. got error ${err}`);
        } else if (err.details && err.details.code === 'AuthenticationFailed') {
            throw new RpcError('AUTH_FAILED', `access denied to the azure container ${this.container_name}. got error ${err}`);
        }
        throw err;
    }

    _get_usage() {
        return this._usage || this._count_usage();
    }

    _count_usage() {
        // TODO: count usage from cloud
        this._usage = {
            size: 0,
            count: 0
        };
        return this._usage;
    }

    async _read_usage() {
        const blob_client = azure_storage.get_blob_client(this.container_client, this.usage_path);
        try {
            const info = await blob_client.getProperties();
            dbg.log1('block_store_azure._read_usage info: ', info);
            const usage_data = info.metadata[this.usage_md_key];
            if (usage_data) {
                this._usage = this._decode_block_md(usage_data);
                dbg.log0('BlockStoreAzure init: found usage data in',
                    this.usage_path, 'usage_data = ', this._usage);
            }
        } catch (err) {
            dbg.log1('block_store_azure._read_usage: err.details.code', err.details && err.details.code, 'err: ', err);
            if (err.details && err.details.errorCode === 'BlobNotFound') {
                // first time init, continue without usage info
                dbg.log0('BlockStoreAzure init: no usage path');
            } else {
                dbg.error('got error on block_store_azure._read_usage:', err);
            }

        }
    }

    _write_usage_internal() {
        const metadata = {
            [this.usage_md_key]: this._encode_block_md(this._usage)
        };
        const blob_client = azure_storage.get_blob_client(this.container_client, this.usage_path);

        return blob_client.upload(
            '', // no data, only metadata is used on the usage object
            0, {
                metadata: metadata
            }
        );
    }

}

// EXPORTS
exports.BlockStoreAzure = BlockStoreAzure;
