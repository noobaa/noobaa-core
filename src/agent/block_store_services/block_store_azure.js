/* Copyright (C) 2016 NooBaa */
'use strict';

// const _ = require('lodash');
const azure = require('azure-storage');
const path = require('path');
const stream = require('stream');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const BlockStoreBase = require('./block_store_base').BlockStoreBase;

class BlockStoreAzure extends BlockStoreBase {

    constructor(options) {
        super(options);
        this.cloud_info = options.cloud_info;
        this.blocks_path = this.cloud_info.blocks_path ||
            'noobaa_blocks/' + options.node_name + '/blocks_tree';
        this.usage_path = 'noobaa_blocks/' + options.node_name + '/usage';
        this.usage_md_key = 'noobaa_usage';
        this.blob = azure.createBlobService(this.cloud_info.azure.connection_string);
        this.container_name = this.cloud_info.azure.container;
    }

    init() {
        return this._read_usage();
    }

    get_storage_info() {
        //const PETABYTE = 1024 * 1024 * 1024 * 1024 * 1024;
        const TB450 = 1024 * 1024 * 1024 * 1024 * 450;
        return P.resolve(this._get_usage())
            .then(usage => ({
                total: TB450 + usage.size,
                free: TB450,
                used: usage.size
            }));
    }

    _read_block(block_md) {
        const block_key = this._block_key(block_md.id);
        let buffers = [];
        let datalen = 0;
        let ws = new stream.Writable({
            write(chunk, encoding, callback) {
                buffers.push(chunk);
                datalen += chunk.length;
                callback();
            }
        });
        return P.fromCallback(callback => this.blob.getBlobToStream(
                this.container_name,
                block_key,
                ws, {
                    disableContentMD5Validation: true
                },
                callback
            ))
            .then(info => ({
                data: Buffer.concat(buffers, datalen),
                block_md: this._decode_block_md(info.metadata.noobaa_block_md)
            }))
            .catch(err => {
                dbg.error('BlockStoreAzure _read_block failed:',
                    this.container_name, block_key, err);
                throw err;
            });
    }

    _write_block(block_md, data) {
        let overwrite_size = 0;
        let overwrite_count = 0;
        const encoded_md = this._encode_block_md(block_md);
        const block_key = this._block_key(block_md.id);
        // check to see if the object already exists
        return P.fromCallback(callback =>
                this.blob.getBlobProperties(
                    this.container_name,
                    block_key,
                    callback)
            )
            .then(info => {
                overwrite_size = Number(info.contentLength);
                const md_size = info.metadata.noobaa_block_md ?
                    info.metadata.noobaa_block_md.length : 0;
                overwrite_size += md_size;
                console.warn('block already found in cloud, will overwrite. id =', block_md.id);
                overwrite_count = 1;
            }, err => {
                // noop when missing
            })
            .then(() => dbg.log3('writing block id to cloud: ', block_key))
            .then(() => P.fromCallback(callback =>
                this.blob.createBlockBlobFromText(
                    this.container_name,
                    block_key,
                    data, {
                        metadata: {
                            noobaa_block_md: encoded_md
                        }
                    },
                    callback)
            ))
            .then(() => {
                // return usage count for the object
                const usage = {
                    size: data.length + encoded_md.length - overwrite_size,
                    count: 1 - overwrite_count
                };
                return this._update_usage(usage);
            });
    }


    _delete_blocks(block_ids) {
        // Todo: Assuming that all requested blocks were deleted, which a bit naive
        let deleted_storage = {
            size: 0,
            count: 0
        };
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
                        const md_size = info.metadata.noobaa_block_md ?
                            info.metadata.noobaa_block_md.length : 0;
                        deleted_storage.size -= (data_size + md_size);
                        deleted_storage.count -= 1;
                    })
                    .catch(err => {
                        dbg.warn('BlockStoreAzure _delete_blocks failed for block',
                            this.container_name, block_key, err);
                    });
            }, {
                // limit concurrency to 10
                concurrency: 10
            })
            .then(() => this._update_usage(deleted_storage));
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
                // first time init, continue without usage info
                dbg.log0('BlockStoreAzure init: no usage path', err);
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


    _block_key(block_id) {
        let block_dir = this._get_block_internal_dir(block_id);
        return path.join(this.blocks_path, block_dir, block_id);
    }

    _encode_block_md(block_md) {
        return new Buffer(JSON.stringify(block_md)).toString('base64');
    }

    _decode_block_md(noobaa_block_md) {
        return JSON.parse(new Buffer(noobaa_block_md, 'base64'));
    }

}

// EXPORTS
exports.BlockStoreAzure = BlockStoreAzure;
