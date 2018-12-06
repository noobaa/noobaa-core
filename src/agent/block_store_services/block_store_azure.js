/* Copyright (C) 2016 NooBaa */
'use strict';


const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const buffer_utils = require('../../util/buffer_utils');
const azure_storage = require('../../util/azure_storage_wrap');
const BlockStoreBase = require('./block_store_base').BlockStoreBase;
const { RpcError } = require('../../rpc');
const url = require('url');
const _ = require('lodash');

class BlockStoreAzure extends BlockStoreBase {

    constructor(options) {
        super(options);
        this.proxy = options.proxy;
        this.cloud_info = options.cloud_info;
        this.base_path = options.cloud_path;
        this.blocks_path = this.base_path + '/blocks_tree';
        this.usage_path = this.base_path + '/usage';
        this.usage_md_key = 'noobaa_usage';
        this.blob = azure_storage.createBlobService(this.cloud_info.azure.connection_string);
        this.blob.setProxy(this.proxy ? url.parse(this.proxy) : null);
        this.container_name = this.cloud_info.azure.container;
    }

    init() {
        return this._read_usage();
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

    _get_shared_access_signature(block_key, permission) {
        // set start and expiry dates to -10 minutes till 10 minutes from now
        const start_date = new Date();
        const expiry_date = new Date(start_date);
        expiry_date.setMinutes(start_date.getMinutes() + 10);
        start_date.setMinutes(start_date.getMinutes() - 10);
        const shared_access_policy = {
            AccessPolicy: {
                Permissions: permission,
                Start: start_date,
                Expiry: expiry_date
            },
        };
        return this.blob.generateSharedAccessSignature(this.container_name, block_key, shared_access_policy);
    }

    _delegate_read_block(block_md) {
        const block_key = this._block_key(block_md.id);

        this._update_read_stats(block_md.size);

        return {
            host: this.blob.host,
            container: this.container_name,
            block_key,
            blob_sas: this._get_shared_access_signature(block_key, azure_storage.BlobUtilities.SharedAccessPermissions.READ),
            proxy: this.proxy
        };
    }

    _read_block(block_md) {
        const block_key = this._block_key(block_md.id);
        const writable = buffer_utils.write_stream();
        return P.fromCallback(callback => this.blob.getBlobToStream(
                this.container_name,
                block_key,
                writable, {
                    disableContentMD5Validation: true
                },
                callback
            ))
            .then(info => ({
                data: buffer_utils.join(writable.buffers, writable.total_length),
                block_md: this._decode_block_md(info.metadata.noobaablockmd || info.metadata.noobaa_block_md)
            }))
            .catch(err => {
                dbg.error('BlockStoreAzure _read_block failed:',
                    this.container_name, block_key, err);
                if (err.code === 'ContainerNotFound') {
                    throw new RpcError('STORAGE_NOT_EXIST', `azure container ${this.container_name} not found. got error ${err}`);
                } else if (err.code === 'AuthenticationFailed') {
                    throw new RpcError('AUTH_FAILED', `access denied to the azure container ${this.container_name}. got error ${err}`);
                }
                throw err;
            });
    }


    async _read_block_md(block_md) {
        const block_info = await P.fromCallback(callback => this.blob.getBlobProperties(
            this.container_name,
            this._block_key(block_md.id),
            callback
        ));
        const store_block_md = this._decode_block_md(block_info.metadata.noobaablockmd || block_info.metadata.noobaa_block_md);
        const store_md5 = block_info.contentSettings.contentMD5;
        return {
            block_md: store_block_md,
            store_md5
        };
    }

    _delegate_write_block(block_md, data_length) {
        const encoded_md = this._encode_block_md(block_md);
        const block_key = this._block_key(block_md.id);
        // update usage optimistically. if delegator will fail it should rollback the change
        // only increment usage if we got data_length
        const usage = data_length ? {
            size: (block_md.preallocated ? 0 : data_length) + encoded_md.length,
            count: block_md.preallocated ? 0 : 1
        } : { size: 0, count: 0 };
        if (data_length) {
            this._update_usage(usage);
        }
        this._update_write_stats(usage.size);

        return {
            host: this.blob.host,
            container: this.container_name,
            block_key,
            blob_sas: this._get_shared_access_signature(block_key, azure_storage.BlobUtilities.SharedAccessPermissions.WRITE),
            metadata: {
                noobaablockmd: encoded_md
            },
            usage,
            proxy: this.proxy
        };
    }

    _write_block(block_md, data, options) {
        const encoded_md = this._encode_block_md(block_md);
        const block_key = this._block_key(block_md.id);
        // check to see if the object already exists

        return P.fromCallback(callback => this.blob.createBlockBlobFromText(
                this.container_name,
                block_key,
                data, {
                    metadata: {
                        noobaablockmd: encoded_md
                    }
                },
                callback))
            .then(() => {
                if (options && options.ignore_usage) return;
                // return usage count for the object
                const usage = {
                    size: (block_md.preallocated ? 0 : data.length) + encoded_md.length,
                    count: block_md.preallocated ? 0 : 1
                };
                return this._update_usage(usage);
            })
            .catch(err => {
                dbg.error('BlockStoreAzure _write_block failed:',
                    this.container_name, block_key, err.code, err);
                if (err.code === 'ContainerNotFound') {
                    throw new RpcError('STORAGE_NOT_EXIST', `azure container ${this.container_name} not found. got error ${err}`);
                } else if (err.code === 'AuthenticationFailed') {
                    throw new RpcError('AUTH_FAILED', `access denied to the azure container ${this.container_name}. got error ${err}`);
                }

                throw err;
            });
    }


    _delete_blocks(block_ids) {
        // Todo: Assuming that all requested blocks were deleted, which a bit naive
        let deleted_storage = {
            size: 0,
            count: 0
        };
        let failed_to_delete_block_ids = [];
        return P.map(block_ids, block_id => {
                const block_key = this._block_key(block_id);
                let info;
                return P.fromCallback(callback =>
                        this.blob.getBlobProperties(
                            this.container_name,
                            block_key,
                            callback)
                    )
                    .then(info_arg => {
                        info = info_arg;
                    })
                    .then(() => P.fromCallback(callback =>
                        this.blob.deleteBlob(
                            this.container_name,
                            block_key,
                            callback)
                    ))
                    .then(() => {
                        const data_size = Number(info.contentLength);
                        const noobaablockmd = info.metadata.noobaablockmd || info.metadata.noobaa_block_md;
                        const md_size = (noobaablockmd && noobaablockmd.length) || 0;
                        deleted_storage.size -= (data_size + md_size);
                        deleted_storage.count -= 1;
                    })
                    .catch(err => {
                        if (err.code !== 'BlobNotFound') {
                            failed_to_delete_block_ids.push(block_id);
                        }
                        dbg.warn('BlockStoreAzure _delete_blocks failed for block',
                            this.container_name, block_key, err);
                    });
            }, {
                // limit concurrency to 10
                concurrency: 10
            })
            .then(() => this._update_usage(deleted_storage))
            .then(() => ({
                failed_block_ids: failed_to_delete_block_ids,
                succeeded_block_ids: _.difference(block_ids, failed_to_delete_block_ids)
            }));
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
        dbg.error('BlockStoreAzure operation failed:',
            this.container_name, err.code, err);
        if (err.code === 'ContainerNotFound') {
            throw new RpcError('STORAGE_NOT_EXIST', `azure container ${this.container_name} not found. got error ${err}`);
        } else if (err.code === 'AuthenticationFailed') {
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

    _read_usage() {
        return P.fromCallback(callback =>
                this.blob.getBlobProperties(
                    this.container_name,
                    this.usage_path,
                    callback)
            )
            .then(info => {
                const usage_data = info.metadata[this.usage_md_key];
                if (usage_data) {
                    this._usage = this._decode_block_md(usage_data);
                    dbg.log0('BlockStoreAzure init: found usage data in',
                        this.usage_path, 'usage_data = ', this._usage);
                }
            }, err => {
                if (err.code === 'NotFound') {
                    // first time init, continue without usage info
                    dbg.log0('BlockStoreAzure init: no usage path');
                } else {
                    dbg.error('got error on _read_usage:', err);
                }

            });
    }

    _write_usage_internal() {
        const metadata = {};
        metadata[this.usage_md_key] = this._encode_block_md(this._usage);

        return P.fromCallback(callback =>
            this.blob.createBlockBlobFromText(
                this.container_name,
                this.usage_path,
                '', // no data, only metadata is used on the usage object
                {
                    metadata: metadata
                },
                callback)
        );
    }

}

// EXPORTS
exports.BlockStoreAzure = BlockStoreAzure;
