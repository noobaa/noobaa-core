/* Copyright (C) 2016 NooBaa */
'use strict';

const AWS = require('aws-sdk');
const _ = require('lodash');

const Storage = require('../../util/google_storage_wrap');
const azure_storage = require('../../util/new_azure_storage_wrap');
const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const buffer_utils = require('../../util/buffer_utils');
const http_utils = require('../../util/http_utils');
const LRUCache = require('../../util/lru_cache');
const config = require('../../../config');
const { RPC_BUFFERS, RpcError } = require('../../rpc');
const { get_block_internal_dir } = require('../../agent/block_store_services/block_store_base');
const util = require('util');
const cloud_utils = require('../../util/cloud_utils');


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
        this.io_stats = new Map();
        this.send_usage_stats();
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
        return P.timeout(timeout, (async () => {
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
                dbg.error('Google write operation failed for block:', util.inspect(block_md, { depth: 4 }), err);
                if (err.code === 403) {
                    block_store_info_cache.invalidate_key(options.address);
                    throw new RpcError('AUTH_FAILED', `access denied to the google cloud bucket for block ${block_md.id}. got error ${err}`);
                } else if (err.code === 404) {
                    dbg.error('got 404 error when trying to write block. checking if bucket exists');
                    try {
                        await bucket.getMetadata();
                        throw new RpcError('NOT_FOUND', `block not found`);
                    } catch (bucket_err) {
                        if (bucket_err.code === 404) {
                            block_store_info_cache.invalidate_key(options.address);
                            throw new RpcError('STORAGE_NOT_EXIST', `google cloud bucket not found for block ${block_md.id}. got error ${err}`);
                        }
                    }
                }
                throw new Error(err.message || 'unknown error');
            }
        })());
    }

    async _delegate_read_block_google(rpc_client, params, options) {
        const { timeout = config.IO_WRITE_BLOCK_TIMEOUT } = options;
        const { block_md } = params;
        let bs_info;
        let bucket;
        return P.timeout(timeout, (async () => {
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
                const [data, md_res] = await Promise.all([
                    buffer_utils.read_stream_join(file.createReadStream()),
                    file.getMetadata(),
                ]);
                const block_md_b64 =
                    _.get(md_res[0], 'metadata.noobaablockmd') ||
                    _.get(md_res[0], 'metadata.noobaa_block_md');
                this._update_usage_stats(rpc_client, { size: params.block_md.size, count: 1 }, options.address, 'READ');
                return {
                    [RPC_BUFFERS]: { data },
                    block_md: JSON.parse(Buffer.from(block_md_b64, 'base64').toString()),
                };
            } catch (err) {
                dbg.error('Google read operation failed for block: ', util.inspect(block_md, { depth: 4 }), err);
                if (err.code === 403) {
                    block_store_info_cache.invalidate_key(options.address);
                    throw new RpcError('AUTH_FAILED', `access denied to the google cloud bucket for block ${block_md.id}. got error ${err}`);
                } else if (err.code === 404) {
                    dbg.error('got 404 error when trying to read block. checking if bucket exists');
                    try {
                        await bucket.getMetadata();
                        throw new RpcError('NOT_FOUND', `block not found`);
                    } catch (bucket_err) {
                        if (bucket_err.code === 404) {
                            block_store_info_cache.invalidate_key(options.address);
                            throw new RpcError('STORAGE_NOT_EXIST', `google cloud bucket not found for block ${block_md.id}. got error ${err}`);
                        }
                    }
                }
            }
        })());
    }

    async _delegate_write_block_azure(rpc_client, params, options) {
        const { timeout = config.IO_WRITE_BLOCK_TIMEOUT } = options;
        const { block_md } = params;
        const data = params[RPC_BUFFERS].data;
        let bs_info;
        return P.timeout(timeout, (async () => {
            try {
                bs_info = await block_store_info_cache.get_with_cache({ options, rpc_client });
                if (!bs_info) throw new Error('couldn\'t resolve cloud credentials');
                const azure_params = bs_info.connection_params;
                const block_id = block_md.id;
                const block_dir = get_block_internal_dir(block_id);
                const blob = azure_storage.BlobServiceClient.fromConnectionString(azure_params.connection_string);
                const container = bs_info.target_bucket;
                const block_key = `${bs_info.blocks_path}/${block_dir}/${block_id}`;
                const encoded_md = Buffer.from(JSON.stringify(block_md)).toString('base64');
                const container_client = azure_storage.get_container_client(blob, container);
                const blob_client = azure_storage.get_blob_client(container_client, block_key);
                dbg.log1('block_store_client._delegate_write_block_azure uploading block_key:', block_key, ' container: ', container, 'data_length: ', data.length);

                await blob_client.upload(
                    data, data.length, {
                        metadata: {
                            noobaablockmd: encoded_md
                        }
                    });
                dbg.log1('block_store_client._delegate_write_block_azure uploaded succefully block_key:', block_key, ' container: ', container);
                const data_length = data.length;
                const usage = data_length ? {
                    size: (block_md.is_preallocated ? 0 : data_length) + encoded_md.length,
                    count: block_md.is_preallocated ? 0 : 1
                } : { size: 0, count: 0 };
                this._update_usage_stats(rpc_client, usage, options.address, 'WRITE');
            } catch (err) {
                dbg.error('Azure write operation failed for block:', util.inspect(block_md, { depth: 4 }), err);
                if (err.details && err.details.code === 'ContainerNotFound') {
                    block_store_info_cache.invalidate_key(options.address);
                    throw new RpcError('STORAGE_NOT_EXIST', `azure container not found for block ${block_md.id}. got error ${err}`);
                } else if (err.details && err.details.code === 'AuthenticationFailed') {
                    block_store_info_cache.invalidate_key(options.address);
                    throw new RpcError('AUTH_FAILED', `access denied to the azure container for block ${block_md.id}. got error ${err}`);
                }
                throw err;
            }
        })());
    }


    async _delegate_read_block_azure(rpc_client, params, options) {
        const { timeout = config.IO_READ_BLOCK_TIMEOUT } = options;
        const { block_md } = params;
        let bs_info;
        // get signed access signature from the agent
        return P.timeout(timeout, (async () => {
            try {
                bs_info = await block_store_info_cache.get_with_cache({ options, rpc_client });
                if (!bs_info) throw new Error('couldn\'t resolve cloud credentials');
                const azure_params = bs_info.connection_params;
                const block_id = block_md.id;
                const block_dir = get_block_internal_dir(block_id);
                const blob = azure_storage.BlobServiceClient.fromConnectionString(azure_params.connection_string);
                const container = bs_info.target_bucket;
                const block_key = `${bs_info.blocks_path}/${block_dir}/${block_id}`;
                const container_client = azure_storage.get_container_client(blob, container);
                const blob_client = azure_storage.get_blob_client(container_client, block_key);
                dbg.log1('block_store_client._delegate_read_block_azure starting download block_key:', block_key, ' container: ', container);

                const response = await blob_client.download(0, undefined);
                dbg.log1('block_store_client._delegate_read_block_azure downloaded succefully block_key:', block_key, ' container: ', container);

                const noobaablockmd = response.metadata.noobaablockmd || response.metadata.noobaa_block_md;
                const store_block_md = JSON.parse(Buffer.from(noobaablockmd, 'base64').toString());
                this._update_usage_stats(rpc_client, { size: params.block_md.size, count: 1 }, options.address, 'READ');
                return {
                    [RPC_BUFFERS]: { data: await buffer_utils.read_stream_join(response.readableStreamBody) },
                    block_md: store_block_md,
                };
            } catch (err) {
                dbg.error('Azure read operation failed for block:', util.inspect(block_md, { depth: 4 }), err);
                if (err.details && err.details.code === 'ContainerNotFound') {
                    block_store_info_cache.invalidate_key(options.address);
                    throw new RpcError('STORAGE_NOT_EXIST', `azure container not found for block ${block_md.id}. got error ${err}`);
                } else if (err.details && err.details.code === 'AuthenticationFailed') {
                    block_store_info_cache.invalidate_key(options.address);
                    throw new RpcError('AUTH_FAILED', `access denied to the azure container for block ${block_md.id}. got error ${err}`);
                }
                throw err;
            }
        })());
    }

    async _delegate_write_block_s3(rpc_client, params, options) {
        const { timeout = config.IO_WRITE_BLOCK_TIMEOUT } = options;
        const { block_md } = params;
        const data = params[RPC_BUFFERS].data;
        let bs_info;

        return P.timeout(timeout, (async () => {
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
                s3_params.httpOptions = {
                    agent: http_utils.get_unsecured_agent(s3_params.endpoint)
                };
                if (bs_info.aws_sts_arn) {
                    const creds = await cloud_utils.generate_aws_sts_creds(s3_params, "_delegate_write_block_s3_session");
                    s3_params.accessKeyId = creds.accessKeyId;
                    s3_params.secretAccessKey = creds.secretAccessKey;
                    s3_params.sessionToken = creds.sessionToken;
                }
                dbg.log1('got s3_params from block_store. writing using S3 sdk. s3_params =',
                    _.omit(s3_params, 'secretAccessKey'));
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
                dbg.error('S3 write operation failed for block:', util.inspect(block_md, { depth: 4 }), err);
                if (err.code === 'NoSuchBucket') {
                    block_store_info_cache.invalidate_key(options.address);
                    throw new RpcError('STORAGE_NOT_EXIST', `s3 bucket not found for block ${block_md.id}. got error ${err}`);
                } else if (err.code === 'AccessDenied') {
                    block_store_info_cache.invalidate_key(options.address);
                    throw new RpcError('AUTH_FAILED', `access denied to the s3 bucket for block ${block_md.id}. got error ${err}`);
                }
                throw err;
            }
        })());
    }


    async _delegate_read_block_s3(rpc_client, params, options) {
        const { timeout = config.IO_READ_BLOCK_TIMEOUT } = options;
        let bs_info;
        const { block_md } = params;
        return P.timeout(timeout, (async () => {
            try {
                bs_info = await block_store_info_cache.get_with_cache({ options, rpc_client });
                if (!bs_info) throw new Error('couldn\'t resolve cloud credentials');
                const s3_params = bs_info.connection_params;
                const block_id = block_md.id;
                const block_dir = get_block_internal_dir(block_id);
                const read_params = {
                    Bucket: bs_info.target_bucket,
                    Key: `${bs_info.blocks_path}/${block_dir}/${block_id}`
                };
                const disable_metadata = bs_info.disable_metadata;
                s3_params.httpOptions = {
                    agent: http_utils.get_unsecured_agent(s3_params.endpoint)
                };
                if (bs_info.aws_sts_arn) {
                    const creds = await cloud_utils.generate_aws_sts_creds(s3_params, "_delegate_read_block_s3_session");
                    s3_params.accessKeyId = creds.accessKeyId;
                    s3_params.secretAccessKey = creds.secretAccessKey;
                    s3_params.sessionToken = creds.sessionToken;
                }
                dbg.log1('got s3_params from block_store. writing using S3 sdk. s3_params =',
                    _.omit(s3_params, 'secretAccessKey'));
                const s3 = new AWS.S3(s3_params);
                const data = await s3.getObject(read_params).promise();
                const noobaablockmd = data.Metadata.noobaablockmd || data.Metadata.noobaa_block_md;
                const store_block_md = disable_metadata ? block_md :
                    JSON.parse(Buffer.from(noobaablockmd, 'base64').toString());
                this._update_usage_stats(rpc_client, { size: block_md.size, count: 1 }, options.address, 'READ');
                return {
                    [RPC_BUFFERS]: { data: data.Body },
                    block_md: store_block_md,
                };
            } catch (err) {
                dbg.error('S3 read operation failed for block:', util.inspect(block_md, { depth: 4 }), err);
                if (err.code === 'NoSuchBucket') {
                    block_store_info_cache.invalidate_key(options.address);
                    throw new RpcError('STORAGE_NOT_EXIST', `s3 bucket not found for block ${block_md.id}. got error ${err}`);
                } else if (err.code === 'AccessDenied') {
                    block_store_info_cache.invalidate_key(options.address);
                    throw new RpcError('AUTH_FAILED', `access denied to the s3 bucket for block ${block_md.id}. got error ${err}`);
                }
                throw err;
            }
        })());

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
        for (;;) {
            await P.delay_unblocking(config.BLOCK_STORE_USAGE_INTERVAL);

            const updates = Array.from(this.io_stats.entries());
            this.io_stats = new Map();

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
        }
    }
}

/** @type {BlockStoreClient} */
BlockStoreClient._instance = undefined;

exports.instance = BlockStoreClient.instance;
