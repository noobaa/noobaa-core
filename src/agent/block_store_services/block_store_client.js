/* Copyright (C) 2016 NooBaa */
'use strict';

const AWS = require('aws-sdk');
const _ = require('lodash');

const Storage = require('../../util/google_storage_wrap');
const azure_storage = require('../../util/azure_storage_wrap');
const P = require('../../util/promise');
const promise_utils = require('../../util/promise_utils');
const dbg = require('../../util/debug_module')(__filename);
const buffer_utils = require('../../util/buffer_utils');
const http_utils = require('../../util/http_utils');
const LRUCache = require('../../util/lru_cache');
const config = require('../../../config');
const { RPC_BUFFERS, RpcError } = require('../../rpc');
const { get_block_internal_dir } = require('../../agent/block_store_services/block_store_base');

const block_store_info_cache = new LRUCache({
    name: 'BlockStoreInfoCache',
    max_usage: 1000,
    expiry_ms: 2 * 60 * 1000,
    make_key: params => params.options.address,
    load: async ({ rpc_client, options }) => rpc_client.block_store.get_block_store_info(null, options),
});
class BlockStoreClient {

    static instance() {
        if (!BlockStoreClient._instance) {
            BlockStoreClient._instance = new BlockStoreClient();
        }
        return BlockStoreClient._instance;
    }

    constructor() {
        this.report_interval = setTimeout(async () => {
            await this.send_usage_stats();
        }, config.BLOCK_STORE_USAGE_INTERVAL);
        this.io_stats = new Map();
    }

    write_block(rpc_client, params, options) {
        const { block_md } = params;
        switch (block_md.node_type) {
            case 'BLOCK_STORE_S3':
                return this._delegate_write_block_s3(rpc_client, params, options);
            case 'BLOCK_STORE_AZURE':
                return this._delegate_write_block_azure(rpc_client, params, options);
            case 'BLOCK_STORE_GOOGLE':
                return this._delegate_write_block_google(rpc_client, params, options);
            default:
                return rpc_client.block_store.write_block(params, options);
        }
    }

    read_block(rpc_client, params, options) {
        const { block_md } = params;
        switch (block_md.node_type) {
            case 'BLOCK_STORE_S3':
                return this._delegate_read_block_s3(rpc_client, params, options);
            case 'BLOCK_STORE_AZURE':
                return this._delegate_read_block_azure(rpc_client, params, options);
            case 'BLOCK_STORE_GOOGLE':
                return this._delegate_read_block_google(rpc_client, params, options);
            default:
                return rpc_client.block_store.read_block(params, options);
        }
    }

    async _delegate_write_block_google(rpc_client, params, options) {
        const { timeout = config.IO_WRITE_BLOCK_TIMEOUT } = options;
        const { block_md } = params;
        const data = params[RPC_BUFFERS].data;
        let bs_info;
        let bucket;
        return promise_utils.timeout(async () => {
            try {
                bs_info = await block_store_info_cache.get_with_cache({ options, rpc_client });
                if (!bs_info) throw new Error('couldn\'t resolve cloud credentials');
                const google_params = bs_info.connection_params;
                const block_id = block_md.id;
                const block_dir = get_block_internal_dir(block_id);
                const google = new Storage({
                    projectId: google_params.project_id,
                    credentials: {
                        client_email: google_params.client_email,
                        private_key: google_params.private_key
                    }
                });
                bucket = google.bucket(bs_info.target_bucket);
                const block_key = `${bs_info.blocks_path}/${block_dir}/${block_id}`;
                const target_file = bucket.file(block_key);
                const encoded_md = Buffer.from(JSON.stringify(block_md)).toString('base64');
                const write_stream = target_file.createWriteStream({
                    metadata: {
                        metadata: {
                            noobaablockmd: encoded_md
                        }
                    },
                });
                await buffer_utils.write_to_stream(write_stream, data);
                write_stream.end();
                const data_length = data.length;
                const usage = data_length ? {
                    size: (block_md.is_preallocated ? 0 : data_length) + encoded_md.length,
                    count: block_md.is_preallocated ? 0 : 1
                } : { size: 0, count: 0 };
                this._update_usage_stats(rpc_client, usage, options.address, 'WRITE');
            } catch (err) {
                dbg.error('Google operation failed:', bs_info && bs_info.target_bucket, err.code, err);
                if (err.code === 403) {
                    block_store_info_cache.invalidate_key(options.address);
                    throw new RpcError('AUTH_FAILED', `access denied to the google cloud bucket ${bs_info.target_bucket}. got error ${err}`);
                } else if (err.code === 404) {
                    dbg.error('got 404 error when trying to write block. checking if bucket exists');
                    try {
                        await bucket.getMetadata();
                        throw new RpcError('NOT_FOUND', `block not found`);
                    } catch (bucket_err) {
                        if (bucket_err.code === 404) {
                            block_store_info_cache.invalidate_key(options.address);
                            throw new RpcError('STORAGE_NOT_EXIST', `google cloud bucket ${bs_info.target_bucket} not found. got error ${err}`);
                        }
                    }
                }
                throw new Error(err.message || 'unknown error');
            }
        }, timeout);
    }

    async _delegate_read_block_google(rpc_client, params, options) {
        const { timeout = config.IO_WRITE_BLOCK_TIMEOUT } = options;
        const { block_md } = params;
        let bs_info;
        let bucket;
        return promise_utils.timeout(async () => {
            try {
                bs_info = await block_store_info_cache.get_with_cache({ options, rpc_client });
                if (!bs_info) throw new Error('couldn\'t resolve cloud credentials');
                const google_params = bs_info.connection_params;
                const block_id = block_md.id;
                const block_dir = get_block_internal_dir(block_id);
                const google = new Storage({
                    projectId: google_params.project_id,
                    credentials: {
                        client_email: google_params.client_email,
                        private_key: google_params.private_key
                    }
                });
                bucket = google.bucket(bs_info.target_bucket);
                const block_key = `${bs_info.blocks_path}/${block_dir}/${block_id}`;
                const file = bucket.file(block_key);
                const [data, md_res] = await P.join(
                    buffer_utils.read_stream_join(file.createReadStream()),
                    file.getMetadata());
                const block_md_b64 =
                    _.get(md_res[0], 'metadata.noobaablockmd') ||
                    _.get(md_res[0], 'metadata.noobaa_block_md');
                this._update_usage_stats(rpc_client, { size: params.block_md.size, count: 1 }, options.address, 'READ');
                return {
                    [RPC_BUFFERS]: { data },
                    block_md: JSON.parse(Buffer.from(block_md_b64, 'base64').toString()),
                };
            } catch (err) {
                dbg.error('Google operation failed:', bs_info && bs_info.target_bucket, err.code, err);
                if (err.code === 403) {
                    block_store_info_cache.invalidate_key(options.address);
                    throw new RpcError('AUTH_FAILED', `access denied to the google cloud bucket ${bs_info.target_bucket}. got error ${err}`);
                } else if (err.code === 404) {
                    dbg.error('got 404 error when trying to read block. checking if bucket exists');
                    try {
                        await bucket.getMetadata();
                        throw new RpcError('NOT_FOUND', `block not found`);
                    } catch (bucket_err) {
                        if (bucket_err.code === 404) {
                            block_store_info_cache.invalidate_key(options.address);
                            throw new RpcError('STORAGE_NOT_EXIST', `google cloud bucket ${bs_info.target_bucket} not found. got error ${err}`);
                        }
                    }
                }
            }
        }, timeout);
    }

    async _delegate_write_block_azure(rpc_client, params, options) {
        const { timeout = config.IO_WRITE_BLOCK_TIMEOUT } = options;
        const { block_md } = params;
        const data = params[RPC_BUFFERS].data;
        let bs_info;
        return promise_utils.timeout(async () => {
            try {
                bs_info = await block_store_info_cache.get_with_cache({ options, rpc_client });
                if (!bs_info) throw new Error('couldn\'t resolve cloud credentials');
                const azure_params = bs_info.connection_params;
                const block_id = block_md.id;
                const block_dir = get_block_internal_dir(block_id);
                const blob = azure_storage.createBlobService(azure_params.connection_string);
                const container = bs_info.target_bucket;
                const block_key = `${bs_info.blocks_path}/${block_dir}/${block_id}`;
                const encoded_md = Buffer.from(JSON.stringify(block_md)).toString('base64');
                await P.fromCallback(callback => blob.createBlockBlobFromText(
                    container,
                    block_key,
                    data, {
                        metadata: {
                            noobaablockmd: encoded_md
                        }
                    },
                    callback));
                const data_length = data.length;
                const usage = data_length ? {
                    size: (block_md.is_preallocated ? 0 : data_length) + encoded_md.length,
                    count: block_md.is_preallocated ? 0 : 1
                } : { size: 0, count: 0 };
                this._update_usage_stats(rpc_client, usage, options.address, 'WRITE');
            } catch (err) {
                dbg.error('Azure operation failed:', bs_info && bs_info.target_bucket, err.code, err);
                if (err.code === 'ContainerNotFound') {
                    block_store_info_cache.invalidate_key(options.address);
                    throw new RpcError('STORAGE_NOT_EXIST', `azure container ${bs_info.target_bucket} not found. got error ${err}`);
                } else if (err.code === 'AuthenticationFailed') {
                    block_store_info_cache.invalidate_key(options.address);
                    throw new RpcError('AUTH_FAILED', `access denied to the azure container ${bs_info.target_bucket}. got error ${err}`);
                }
                throw new Error(err.message || 'unknown error');
            }
        }, timeout);
    }


    async _delegate_read_block_azure(rpc_client, params, options) {
        const { timeout = config.IO_READ_BLOCK_TIMEOUT } = options;
        const writable = buffer_utils.write_stream();
        const { block_md } = params;
        let bs_info;
        // get signed access signature from the agent
        return promise_utils.timeout(async () => {
            try {
                bs_info = await block_store_info_cache.get_with_cache({ options, rpc_client });
                if (!bs_info) throw new Error('couldn\'t resolve cloud credentials');
                const azure_params = bs_info.connection_params;
                const block_id = block_md.id;
                const block_dir = get_block_internal_dir(block_id);
                const blob = azure_storage.createBlobService(azure_params.connection_string);
                const container = bs_info.target_bucket;
                const block_key = `${bs_info.blocks_path}/${block_dir}/${block_id}`;
                const info = await P.fromCallback(callback => blob.getBlobToStream(container, block_key, writable, {
                        disableContentMD5Validation: true
                    },
                    callback));
                const noobaablockmd = info.metadata.noobaablockmd || info.metadata.noobaa_block_md;
                const store_block_md = JSON.parse(Buffer.from(noobaablockmd, 'base64').toString());
                this._update_usage_stats(rpc_client, { size: params.block_md.size, count: 1 }, options.address, 'READ');
                return {
                    [RPC_BUFFERS]: { data: buffer_utils.join(writable.buffers, writable.total_length) },
                    block_md: store_block_md,
                };
            } catch (err) {
                dbg.error('Azure operation failed:', bs_info && bs_info.target_bucket, err.code, err);
                if (err.code === 'ContainerNotFound') {
                    block_store_info_cache.invalidate_key(options.address);
                    throw new RpcError('STORAGE_NOT_EXIST', `azure container ${bs_info.target_bucket} not found. got error ${err}`);
                } else if (err.code === 'AuthenticationFailed') {
                    block_store_info_cache.invalidate_key(options.address);
                    throw new RpcError('AUTH_FAILED', `access denied to the azure container ${bs_info.target_bucket}. got error ${err}`);
                }
                throw new Error(err.message || 'unknown error');
            }
        }, timeout);
    }

    async _delegate_write_block_s3(rpc_client, params, options) {
        const { timeout = config.IO_WRITE_BLOCK_TIMEOUT } = options;
        const { block_md } = params;
        const data = params[RPC_BUFFERS].data;
        let bs_info;

        return promise_utils.timeout(async () => {
            try {
                bs_info = await block_store_info_cache.get_with_cache({ options, rpc_client });
                if (!bs_info) throw new Error('couldn\'t resolve cloud credentials');
                const s3_params = bs_info.connection_params;
                const block_id = block_md.id;
                const block_dir = get_block_internal_dir(block_id);
                const disable_metadata = bs_info.disable_metadata;
                const encoded_md = disable_metadata ? '' : Buffer.from(JSON.stringify(block_md)).toString('base64');
                const write_params = {
                    Bucket: bs_info.target_bucket,
                    Key: `${bs_info.blocks_path}/${block_dir}/${block_id}`,
                    Metadata: disable_metadata ? undefined : { noobaablockmd: encoded_md },
                };
                dbg.log1('got s3_params from block_store. writing using S3 sdk. s3_params =',
                    _.omit(s3_params, 'secretAccessKey'));
                s3_params.httpOptions = _.omitBy({ agent: http_utils.get_unsecured_http_agent(s3_params.endpoint) },
                    _.isUndefined);
                const s3 = new AWS.S3(s3_params);
                write_params.Body = data;
                await s3.putObject(write_params).promise();
                const data_length = data.length;
                const usage = data_length ? {
                    size: (block_md.is_preallocated ? 0 : data_length) + encoded_md.length,
                    count: block_md.is_preallocated ? 0 : 1
                } : { size: 0, count: 0 };
                this._update_usage_stats(rpc_client, usage, options.address, 'WRITE');
            } catch (err) {
                dbg.error('S3 operation failed:', err, bs_info && _.omit(bs_info[options.address], 'access_keys'));
                if (err.code === 'NoSuchBucket') {
                    block_store_info_cache.invalidate_key(options.address);
                    throw new RpcError('STORAGE_NOT_EXIST', `s3 bucket ${bs_info[options.address].target_bucket} not found. got error ${err}`);
                } else if (err.code === 'AccessDenied') {
                    block_store_info_cache.invalidate_key(options.address);
                    throw new RpcError('AUTH_FAILED', `access denied to the s3 bucket ${bs_info[options.address].target_bucket}. got error ${err}`);
                }
                throw new Error(err.message || 'unknown error');
            }
        }, timeout);
    }


    async _delegate_read_block_s3(rpc_client, params, options) {
        const { timeout = config.IO_READ_BLOCK_TIMEOUT } = options;
        let bs_info;
        return promise_utils.timeout(async () => {
            try {
                bs_info = await block_store_info_cache.get_with_cache({ options, rpc_client });
                if (!bs_info) throw new Error('couldn\'t resolve cloud credentials');
                const s3_params = bs_info.connection_params;
                const block_id = params.block_md.id;
                const block_dir = get_block_internal_dir(block_id);
                const read_params = {
                    Bucket: bs_info.target_bucket,
                    Key: `${bs_info.blocks_path}/${block_dir}/${block_id}`
                };
                const disable_metadata = params.disable_metadata;
                dbg.log1('got s3_params from block_store. reading using S3 sdk. s3_params =',
                    _.omit(s3_params, 'secretAccessKey'));

                s3_params.httpOptions = _.omitBy({ agent: http_utils.get_unsecured_http_agent(s3_params.endpoint) },
                    _.isUndefined);
                const s3 = new AWS.S3(s3_params);

                const data = await s3.getObject(read_params).promise();
                const noobaablockmd = data.Metadata.noobaablockmd || data.Metadata.noobaa_block_md;
                const store_block_md = disable_metadata ? params.block_md :
                    JSON.parse(Buffer.from(noobaablockmd, 'base64').toString());
                this._update_usage_stats(rpc_client, { size: params.block_md.size, count: 1 }, options.address, 'READ');
                return {
                    [RPC_BUFFERS]: { data: data.Body },
                    block_md: store_block_md,
                };
            } catch (err) {
                dbg.error('S3 operation failed:', err, bs_info && _.omit(bs_info, 'access_keys'));
                if (err.code === 'NoSuchBucket') {
                    block_store_info_cache.invalidate_key(options.address);
                    throw new RpcError('STORAGE_NOT_EXIST', `s3 bucket ${bs_info[options.address].target_bucket} not found. got error ${err}`);
                } else if (err.code === 'AccessDenied') {
                    block_store_info_cache.invalidate_key(options.address);
                    throw new RpcError('AUTH_FAILED', `access denied to the s3 bucket ${bs_info[options.address].target_bucket}. got error ${err}`);
                }
                throw new Error(err.message || 'unknown error');
            }
        }, timeout);

    }

    _update_usage_stats(rpc_client, usage, address, read_or_write) {
        if (!this.io_stats.get(address)) {
            this.io_stats.set(address, {
                read_count: 0,
                read_bytes: 0,
                write_count: 0,
                write_bytes: 0,
                rpc_client
            });
        }
        const io_stats = this.io_stats.get(address);
        if (read_or_write === 'WRITE') {
            io_stats.write_count += usage.count;
            io_stats.write_bytes += usage.size;
        } else if (read_or_write === 'READ') {
            io_stats.read_count += usage.count;
            io_stats.read_bytes += usage.size;
        } else if (read_or_write === 'BOTH') {
            io_stats.write_count += usage.write_count;
            io_stats.write_bytes += usage.write_bytes;
            io_stats.read_count += usage.read_count;
            io_stats.read_bytes += usage.read_bytes;
        } else {
            throw new Error('_update_usage_stats should except READ or WRITE only');
        }
    }

    async send_usage_stats() {
        const updates = Array.from(this.io_stats.entries());
        this.io_stats = new Map();
        try {
            await Promise.all(updates.map(async ([address, update]) => {
                try {
                    const rpc_client = update.rpc_client;
                    const io_stats = _.omit(update, 'rpc_client');
                    dbg.log0(`Sending io_stats ${JSON.stringify(io_stats)} to block address ${address}`);
                    await rpc_client.block_store.update_store_usage(io_stats, { address });
                } catch (err) {
                    dbg.error(`Failed sending io_stats update to block address ${address}`, err);
                    this._update_usage_stats(update.rpc_client, _.omit(update, 'rpc_client'), address, 'BOTH');
                }
            }));
        } finally {
            setTimeout(async () => {
                await this.send_usage_stats();
            }, config.BLOCK_STORE_USAGE_INTERVAL);
        }
    }
}

/** @type {BlockStoreClient} */
BlockStoreClient._instance = undefined;

exports.instance = BlockStoreClient.instance;
