/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const P = require('../../util/promise');
const promise_utils = require('../../util/promise_utils');
const dbg = require('../../util/debug_module')(__filename);
const buffer_utils = require('../../util/buffer_utils');
const BlockStoreBase = require('./block_store_base').BlockStoreBase;
const { RpcError } = require('../../rpc');
const Storage = require('@google-cloud/storage');


class BlockStoreGoogle extends BlockStoreBase {

    constructor(options) {
        dbg.log0(`creating new BlockStoreGoogle with base_path ${options.cloud_path}`);
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

        this.cloud = new Storage({
            projectId: this.cloud_info.google.project_id,
            credentials: {
                client_email: this.cloud_info.google.client_email,
                private_key: this.cloud_info.google.private_key
            }
        });
        this.bucket = this.cloud.bucket(this.cloud_info.target_bucket);
        this.usage_file = this.bucket.file(this.usage_path);
    }

    async init() {
        try {
            const md_res = await this.usage_file.getMetadata();
            const usage_data = _.get(md_res[0], `metadata.${this.usage_md_key}`);
            if (usage_data) {
                this._usage = this._decode_block_md(usage_data);
                dbg.log0('found usage data in', this.usage_path, 'usage_data = ', this._usage);
            }
        } catch (err) {
            if (err.code === 404) {
                dbg.log0('BlockStoreGoogle init: no usage path');
            } else {
                dbg.error('got error on init:', err);
            }
        }
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

    async _read_block(block_md) {
        const MAX_RETRIES = 5;
        let block_data;
        try {
            block_data = await promise_utils.retry(MAX_RETRIES, 500, async () => this._try_read_block(block_md));
        } catch (err) {
            await this._handle_error(err, block_md.id);
        }
        return block_data;
    }

    async _try_read_block(block_md) {
        try {
            const block_key = this._block_key(block_md.id);
            const file = this.bucket.file(block_key);
            const [data, md_res] = await P.join(
                buffer_utils.read_stream_join(file.createReadStream()),
                file.getMetadata());
            const block_md_b64 = _.get(md_res[0], 'metadata.noobaa_block_md');
            if (!data || !block_md_b64) {
                throw new RpcError('NOT_FOUND', 'data or block_md are missing');
            }
            return {
                data,
                block_md: this._decode_block_md(block_md_b64)
            };
        } catch (err) {
            // from: https://cloud.google.com/nodejs/docs/reference/storage/1.6.x/File#createReadStream
            // If you receive this error, the best recourse is to try downloading the file again
            if (err.code === 'CONTENT_DOWNLOAD_MISMATCH') {
                dbg.warn('got CONTENT_DOWNLOAD_MISMATCH error, retrying');
            } else {
                err.DO_NOT_RETRY = true;
            }
            throw err;
        }
    }

    async _write_block(block_md, data, options) {
        let encoded_md;
        const key = this._block_key(block_md.id);
        const target_file = this.bucket.file(key);
        encoded_md = this._encode_block_md(block_md);
        const write_stream = target_file.createWriteStream({
            metadata: {
                metadata: {
                    noobaa_block_md: encoded_md
                }
            },

        });
        dbg.log3('writing block id to cloud: ', key);
        try {
            await this._write_to_stream(write_stream, data);
            write_stream.end();
            const usage = {
                size: data.length + encoded_md.length,
                count: 1
            };
            if (!options || !options.ignore_usage) {
                return this._update_usage(usage);
            }
        } catch (err) {
            await this._handle_error(err, block_md.id);
        }
    }

    _write_to_stream(writable, buf) {
        return new P((resolve, reject) => {
            writable.once('error', reject);
            writable.write(buf, err => {
                if (err) {
                    return reject(err);
                }
                return resolve();
            });
        });
    }

    async _handle_error(err, block_id) {
        dbg.error('got error on read\\write operation', err);
        if (err.code === 403) {
            throw new RpcError('AUTH_FAILED', `access denied to the google cloud bucket ${this.cloud_info.target_bucket}. got error ${err}`);
        } else if (err.code === 404) {
            dbg.error('got 404 error when trying to read block. checking if bucket exists');
            try {
                await this.bucket.getMetadata();
                throw new RpcError('NOT_FOUND', `block ${this._block_key(block_id.id)} not found`);
            } catch (bucket_err) {
                if (bucket_err.code === 404) {
                    throw new RpcError('STORAGE_NOT_EXIST', `google cloud bucket ${this.cloud_info.target_bucket} not found. got error ${err}`);
                }
            }
        }
        throw err;
    }

    async _write_usage_internal() {
        const metadata = {};
        metadata[this.usage_md_key] = this._encode_block_md(this._usage);
        await this.bucket.upload('/dev/null', {
            destination: this.usage_path,
            metadata: { metadata }
        });
    }

    async _delete_blocks(block_ids) {
        // Todo: Assuming that all requested blocks were deleted, which a bit naive
        let deleted_storage = {
            size: 0,
            count: 0
        };
        let failed_to_delete_block_ids = [];
        await P.map(block_ids, async block_id => {
            const block_key = this._block_key(block_id);
            const file = this.bucket.file(block_key);
            try {
                const md_res = await file.getMetadata();
                await file.delete();
                const size = Number(md_res[0].size) + md_res[0].metadata.noobaa_block_md.length;
                deleted_storage.size -= size;
                deleted_storage.count -= 1;
            } catch (err) {
                dbg.error(`failed to delete block ${block_key}`, err);
                // Should all failures be reported as failed_block_ids?
                failed_to_delete_block_ids.push(block_id);
            }
        }, {
            // limit concurrency to 10
            concurrency: 10
        });
        this._update_usage(deleted_storage);
        return {
            failed_block_ids: failed_to_delete_block_ids,
            succeeded_block_ids: _.difference(block_ids, failed_to_delete_block_ids)
        };
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

}

// EXPORTS
exports.BlockStoreGoogle = BlockStoreGoogle;
