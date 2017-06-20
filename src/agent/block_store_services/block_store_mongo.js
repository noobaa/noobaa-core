/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const mongodb = require('mongodb');
const mongo_client = require('../../util/mongo_client');
const P = require('../../util/promise');
// const RpcError = require('../../rpc/rpc_error');
const dbg = require('../../util/debug_module')(__filename);
const buffer_util = require('../../util/buffer_util');
const BlockStoreBase = require('./block_store_base').BlockStoreBase;
const GRID_FS_BUCKET_NAME = 'mongo_internal_agent';
const GRID_FS_BUCKET_NAME_FILES = 'mongo_internal_agent.files';
const GRID_FS_BUCKET_NAME_CHUNKS = 'mongo_internal_agent.chunks';
// TODO: Should decide the chunk size, currently using 8 MB
const GRID_FS_CHUNK_SIZE = 8 * 1024 * 1024;


class BlockStoreMongo extends BlockStoreBase {

    constructor(options) {
        super(options);
        this.base_path = options.mongo_path;
        this.blocks_path = this.base_path + '/blocks_tree';
    }

    _gridfs() {
        if (!this._internal_gridfs) {
            this._internal_gridfs = new mongodb.GridFSBucket(mongo_client.instance().db, {
                bucketName: GRID_FS_BUCKET_NAME,
                chunkSizeBytes: GRID_FS_CHUNK_SIZE
            });
        }
        return this._internal_gridfs;
    }

    read_usage_gridfs() {
        // Notice that I do not worry about PETABYTES because this is for local use only
        // We should not write PETABYTES to mongo so there should be no problems
        const files_collection = mongo_client.instance().collection(GRID_FS_BUCKET_NAME_FILES);
        const chunks_collection = mongo_client.instance().collection(GRID_FS_BUCKET_NAME_CHUNKS);
        return P.join(files_collection.stats(), chunks_collection.stats())
            .spread((files_res, chunks_res) => (
                // Notice that storageSize includes actual storage size and not only block sizes
                {
                    size: ((files_res && files_res.storageSize) || 0) + ((chunks_res && chunks_res.storageSize) || 0),
                    count: (files_res && files_res.count) || 0
                }
            ))
            // You will always see errors on initialization when there was no GridFS collection prior
            .catch(err => {
                console.error('read_usage_gridfs had error: ', err);
                return {
                    size: 0,
                    count: 0
                };
            });
    }

    init() {
        return mongo_client.instance().connect()
            .then(() => this.read_usage_gridfs()
                .then(usage_metadata => {
                    if (usage_metadata) {
                        this._usage = usage_metadata;
                        dbg.log0('found usage data usage_data = ', this._usage);
                    }
                }, err => {
                    dbg.error('got error on init:', err);
                })
            );
    }

    get_storage_info() {
        // Actually will be used 30GB since we have 10GB reserve
        const GIGABYTE_40 = 40 * 1024 * 1024 * 1024;
        return P.resolve(this._get_usage())
            .then(usage => ({
                total: Math.max(GIGABYTE_40, usage.size),
                free: Math.max(GIGABYTE_40 - usage.size, 0),
                used: usage.size
            }));
    }

    _get_usage() {
        return this._count_usage();
    }

    _count_usage() {
        return P.resolve(this.read_usage_gridfs());
    }

    _read_block(block_md) {
        const block_name = this._block_key(block_md.id);
        return P.join(
                buffer_util.read_stream_join(this._gridfs().openDownloadStreamByName(block_name)),
                this.head_block(block_name)
            )
            .spread((block_buffer, block_metadata) => ({
                block_data: block_buffer,
                block_metadata: block_metadata.metadata
            }))
            .then(reply => ({
                data: reply.block_data,
                block_md: this._decode_block_md(reply.block_metadata)
            }))
            .catch(err => {
                dbg.error('_read_block failed:', err, this.base_path);
                throw err;
            });
    }

    _write_block(block_md, data) {
        const block_name = this._block_key(block_md.id);
        const block_metadata = this._encode_block_md(block_md);
        const block_data = data;
        // check to see if the object already exists
        return this.head_block(block_name)
            .then(head => {
                console.warn('block already found in mongo, will overwrite. id =', block_md.id);
                return this._gridfs().delete(head._id);
            }, err => {
                if (err.code === 'NOT_FOUND') {
                    dbg.log0('_head_block: Block ', block_name, ' was not found');
                } else {
                    dbg.error('got error on _head_block:', err);
                    throw err;
                }
            })
            .then(() => {
                dbg.log3('writing block id to mongo: ', block_name);
                return new P((resolve, reject) => {
                    const upload_stream = this._gridfs().openUploadStream(block_name, {
                        metadata: block_metadata
                    });
                    upload_stream
                        .once('error', reject)
                        .once('finish', () => resolve({
                            id: upload_stream.id,
                        }));
                    upload_stream.end(block_data);
                });
            })
            .catch(err => {
                dbg.error('_write_block failed:', err, this.base_path);
                throw err;
            });
    }

    _write_usage_internal() {
        // We currently do not need to write the storage since the mongo handles it
        // Just a filler for the base class to call
        return P.resolve();
    }

    _delete_blocks(block_ids) {
        const block_names = _.map(block_ids, block_id => this._block_key(block_id));
        return P.map(block_names, block_name => this._gridfs().find({
                    filename: block_name
                })
                .toArray()
                .then(blocks => P.map(blocks, block => this._gridfs().delete(block._id), {
                    concurrency: 10
                })), {
                    concurrency: 10
                })
            .catch(err => {
                dbg.error('_delete_blocks failed:', err);
                throw err;
            });
    }

    _block_key(block_id) {
        const block_dir = this._get_block_internal_dir(block_id);
        return `${this.blocks_path}/${block_dir}/${block_id}`;
    }

    _encode_block_md(block_md) {
        return Buffer.from(JSON.stringify(block_md)).toString('base64');
    }

    _decode_block_md(noobaa_block_md) {
        return JSON.parse(Buffer.from(noobaa_block_md, 'base64'));
    }

    head_block(block_name) {
        return P.resolve(this._gridfs().find({
                    filename: block_name
                }, {
                    limit: 1
                })
                .toArray()
            )
            .then(usage_file_res => {
                if (usage_file_res && usage_file_res[0]) {
                    return usage_file_res[0];
                }
                const err = new Error('head_block: Block ', block_name, ' response ', usage_file_res);
                err.code = 'NOT_FOUND';
                throw err;
                // throw new RpcError('NOT_FOUND', `head_block: Block ${block_name} response ${usage_file_res}`);
            });
    }

}

// EXPORTS
exports.BlockStoreMongo = BlockStoreMongo;
