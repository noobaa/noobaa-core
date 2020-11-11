/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const size_utils = require('../../util/size_utils');
const mongo_client = require('../../util/mongo_client');
const buffer_utils = require('../../util/buffer_utils');
const BlockStoreBase = require('./block_store_base').BlockStoreBase;
const Semaphore = require('../../util/semaphore');

// limiting the IO concurrency on mongo
// we use a very low limit since this is used only for temporary internal storage
// which is meant for quick onboarding, and not for performance/production.
const sem_head = new Semaphore(3);
const sem_read = new Semaphore(1);
const sem_write = new Semaphore(1);
const sem_delete = new Semaphore(1);

const GRID_FS_BUCKET_NAME = 'mongo_internal_agent';
const GRID_FS_BUCKET_NAME_FILES = `${GRID_FS_BUCKET_NAME}.files`;
const GRID_FS_BUCKET_NAME_CHUNKS = `${GRID_FS_BUCKET_NAME}.chunks`;
const GRID_FS_CHUNK_SIZE = 8 * 1024 * 1024;

// The rational behind that configuration was to limit the cache of GridFS Chunks collection
// On low spec servers we had a problem of memory choke on low work loads (5GB)
// Since mongodb cached the chunk collection with all of it's data
// Currently with the new configuration we minimize the cache and write it to the hard drive
// Link to wiredTiger configuration:
// http://source.wiredtiger.com/mongodb-3.4/struct_w_t___s_e_s_s_i_o_n.html#a358ca4141d59c345f401c58501276bbb
const GRID_FS_CHUNK_COLLECTION_OPTIONS = {
    storageEngine: {
        wiredTiger: {
            configString: "memory_page_max=512,os_cache_dirty_max=1,os_cache_max=1"
        }
    }
};

class BlockStoreMongo extends BlockStoreBase {

    constructor(options) {
        super(options);
        this.base_path = options.mongo_path;
        this.blocks_path = this.base_path + '/blocks_tree';
        this._blocks_fs = mongo_client.instance().define_gridfs({
            name: GRID_FS_BUCKET_NAME,
            chunk_size: GRID_FS_CHUNK_SIZE
        });
        this.usage_limit = 5 * size_utils.GIGABYTE;
    }

    _init_chunks_collection() {
        return P.resolve()
            .then(() => mongo_client.instance().db().createCollection(GRID_FS_BUCKET_NAME_CHUNKS, GRID_FS_CHUNK_COLLECTION_OPTIONS))
            .catch(err => {
                if (!mongo_client.instance().is_err_namespace_exists(err)) throw err;
            })
            .then(() => dbg.log0('_init_chunks_collection: created collection', GRID_FS_BUCKET_NAME_CHUNKS))
            .catch(err => {
                dbg.error('_init_chunks_collection: FAILED', GRID_FS_BUCKET_NAME_CHUNKS, err);
                throw err;
            });
    }

    read_usage_gridfs() {
        // Notice that I do not worry about PETABYTES because this is for local use only
        // We should not write PETABYTES to mongo so there should be no problems
        return P.resolve()
            .then(() => Promise.all([
                mongo_client.instance().collection(GRID_FS_BUCKET_NAME_FILES).stats(),
                mongo_client.instance().collection(GRID_FS_BUCKET_NAME_CHUNKS).stats()
            ]))
            .then(([files_res, chunks_res]) => ({
                // Notice that storageSize includes actual storage size and not only block sizes
                size: ((files_res && files_res.storageSize) || 0) + ((chunks_res && chunks_res.storageSize) || 0),
                count: (files_res && files_res.count) || 0
            }))
            // You will always see errors on initialization when there was no GridFS collection prior
            .catch(err => {
                dbg.error('read_usage_gridfs had error: ', err);
                return {
                    size: 0,
                    count: 0
                };
            });
    }

    init() {
        return mongo_client.instance().connect()
            .then(() => this._init_chunks_collection())
            .then(() => this.read_usage_gridfs())
            .then(usage_metadata => {
                if (usage_metadata) {
                    this._usage = usage_metadata;
                    dbg.log0('found usage data usage_data = ', this._usage);
                }
            })
            .catch(err => {
                dbg.error('got error on init:', err);
                throw err;
            });
    }

    get_storage_info() {
        return P.resolve(this._get_usage())
            .then(usage => ({
                total: Math.max(this.usage_limit, usage.size),
                free: Math.max(this.usage_limit - usage.size, 0),
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
        return sem_read.surround(() =>
            Promise.all([
                buffer_utils.read_stream_join(this._blocks_fs.gridfs().openDownloadStreamByName(block_name)),
                this.head_block(block_name)
            ])
            .then(([data, head]) => ({
                data,
                block_md: this._decode_block_md(head.metadata)
            }))
            .catch(err => {
                dbg.error('_read_block failed:', err, this.base_path);
                throw err;
            })
        );
    }

    _write_block(block_md, data) {
        const block_name = this._block_key(block_md.id);
        const block_metadata = this._encode_block_md(block_md);
        const block_data = data || Buffer.alloc(0);
        // check to see if the object already exists
        return sem_write.surround(() =>
            this.head_block(block_name)
            .then(head => {
                if (block_md.id !== '_test_store_perf') {
                    dbg.warn('block already found in mongo, will overwrite. id =', block_md.id);
                }
                return this._blocks_fs.gridfs().delete(head._id);
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
                return new Promise((resolve, reject) => {
                    const upload_stream = this._blocks_fs.gridfs().openUploadStream(block_name, {
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
            })
        );
    }

    _write_usage_internal() {
        // We currently do not need to write the storage since the mongo handles it
        // Just a filler for the base class to call
        return P.resolve();
    }

    _delete_blocks(block_ids) {
        let failed_to_delete_block_ids = [];
        const block_names = _.map(block_ids, block_id => this._block_key(block_id));
        return sem_delete.surround(() =>
            P.map_with_concurrency(10, block_names, block_name =>
                this._blocks_fs.gridfs().find({ filename: block_name })
                .toArray()
                .then(blocks => P.map_with_concurrency(10, blocks, block =>
                    this._blocks_fs.gridfs().delete(block._id)
                    .catch(err => {
                        dbg.error('_delete_blocks: could not delete', block, err);
                        failed_to_delete_block_ids.push(this._block_id_from_key(block.filename));
                        throw err;
                    })
                ))
            )
            .catch(err => {
                dbg.error('_delete_blocks failed:', err);
            })
            .then(() => ({
                failed_block_ids: failed_to_delete_block_ids,
                succeeded_block_ids: _.difference(block_ids, failed_to_delete_block_ids)
            }))
        );
    }

    head_block(block_name) {
        return sem_head.surround(() =>
            P.resolve(this._blocks_fs.gridfs().find({
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

                const err = new Error(`head_block: Block ${block_name} response ${usage_file_res}`);
                Object.assign(err, { code: 'NOT_FOUND' });
                throw err;
                // throw new RpcError('NOT_FOUND', `head_block: Block ${block_name} response ${usage_file_res}`);
            })
        );
    }

}

// EXPORTS
exports.BlockStoreMongo = BlockStoreMongo;
