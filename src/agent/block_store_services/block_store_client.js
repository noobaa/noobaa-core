/* Copyright (C) 2016 NooBaa */
'use strict';

const AWS = require('aws-sdk');
const _ = require('lodash');

const Storage = require('../../util/google_storage_wrap');
const azure_storage = require('../../util/azure_storage_wrap');
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
    load: async ({ rpc_client, options }) => rpc_client.block_store.get_block_store_info({}, options),
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

    /**
     * @param {Object} rpc_client
     * @param {nb.BlockMD[]} block_mds
     * @param {Object} options
     */
    delete_blocks(rpc_client, block_mds, options) {
        const node_type = block_mds[0] && block_mds[0].node_type;
        switch (node_type) {
            case 'BLOCK_STORE_S3':
                return this._delegate_delete_blocks_s3(rpc_client, block_mds, options);
            case 'BLOCK_STORE_AZURE':
                return this._delegate_delete_blocks_azure(rpc_client, block_mds, options);
            case 'BLOCK_STORE_GOOGLE':
                return this._delegate_delete_blocks_google(rpc_client, block_mds, options);
            default: {
                const block_ids = block_mds.map(md => md.id);
                return rpc_client.block_store.delete_blocks({ block_ids }, options);
            }
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
                dbg.log3('writing block id to gcp: ', block_id);
                await buffer_utils.write_to_stream(write_stream, data);
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
                const container_client = blob.getContainerClient(container);
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
                const container_client = blob.getContainerClient(container);
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
                if (bs_info.connection_params.aws_sts_arn) {
                    const creds = await cloud_utils.generate_aws_sdkv3_sts_creds(s3_params, "_delegate_write_block_s3_session");
                    s3_params.accessKeyId = creds.accessKeyId;
                    s3_params.secretAccessKey = creds.secretAccessKey;
                    s3_params.sessionToken = creds.sessionToken;
                }
                dbg.log1('_delegate_write_block_s3:',
                    'got s3_params from block_store. writing using S3 sdk. s3_params =',
                    _.omit(s3_params, 'secretAccessKey'),
                    'aws_sts_arn', bs_info.connection_params.aws_sts_arn);
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
                if (bs_info.connection_params.aws_sts_arn) {
                    const creds = await cloud_utils.generate_aws_sdkv3_sts_creds(s3_params, "_delegate_read_block_s3_session");
                    s3_params.accessKeyId = creds.accessKeyId;
                    s3_params.secretAccessKey = creds.secretAccessKey;
                    s3_params.sessionToken = creds.sessionToken;
                }
                dbg.log1('_delegate_read_block_s3:',
                    'got s3_params from block_store. writing using S3 sdk. s3_params =',
                    _.omit(s3_params, 'secretAccessKey'),
                    'aws_sts_arn', bs_info.connection_params.aws_sts_arn);
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

    async _delegate_delete_blocks_s3(rpc_client, block_mds, options) {
        const { timeout = config.IO_DELETE_BLOCK_TIMEOUT } = options;
        return P.timeout(timeout, (async () => {
            const block_ids = block_mds.map(md => md.id);
            try {
                const bs_info = await block_store_info_cache.get_with_cache({ options, rpc_client });
                if (!bs_info) throw new Error('couldn\'t resolve cloud credentials');
                const s3_params = bs_info.connection_params;
                s3_params.httpOptions = {
                    agent: http_utils.get_unsecured_agent(s3_params.endpoint)
                };
                if (bs_info.connection_params.aws_sts_arn) {
                    const creds = await cloud_utils.generate_aws_sdkv3_sts_creds(s3_params, "_delegate_delete_blocks_s3_session");
                    s3_params.accessKeyId = creds.accessKeyId;
                    s3_params.secretAccessKey = creds.secretAccessKey;
                    s3_params.sessionToken = creds.sessionToken;
                }
                const s3 = new AWS.S3(s3_params);
                const objects = block_ids.map(id => {
                    const block_dir = get_block_internal_dir(id);
                    return { Key: `${bs_info.blocks_path}/${block_dir}/${id}` };
                });
                dbg.log1('_delegate_delete_blocks_s3: deleting', objects.length, 'blocks from', bs_info.target_bucket);
                const res = await s3.deleteObjects({
                    Bucket: bs_info.target_bucket,
                    Delete: { Objects: objects }
                }).promise();

                // S3 deleteObjects does not throw on partial failures - it returns successfully
                // with an Errors array listing keys that failed (e.g. due to throttling or permissions).
                // Keys that don't exist are silently treated as successful deletions by S3.
                // We must inspect res.Errors to identify blocks that were NOT actually deleted.
                const failed_block_ids = [];
                const failed_keys = new Set();
                if (res.Errors && res.Errors.length) {
                    for (const err of res.Errors) {
                        const block_id = block_ids.find(id => {
                            const block_dir = get_block_internal_dir(id);
                            return err.Key === `${bs_info.blocks_path}/${block_dir}/${id}`;
                        });
                        if (block_id) {
                            failed_block_ids.push(block_id);
                            failed_keys.add(block_id);
                        }
                    }
                    dbg.warn('_delegate_delete_blocks_s3: partial failures',
                        failed_block_ids.length, 'of', block_ids.length);
                }

                const disable_metadata = bs_info.disable_metadata;
                let deleted_size = 0;
                let deleted_count = 0;
                for (const block_md of block_mds) {
                    if (failed_keys.has(block_md.id)) continue;
                    const encoded_md = disable_metadata ? '' :
                        Buffer.from(JSON.stringify(block_md)).toString('base64');
                    deleted_size += (block_md.is_preallocated ? 0 : block_md.size) + encoded_md.length;
                    deleted_count += block_md.is_preallocated ? 0 : 1;
                }
                if (deleted_size || deleted_count) {
                    this._update_usage_stats(rpc_client, {
                        size: -deleted_size,
                        count: -deleted_count
                    }, options.address, 'WRITE');
                }

                const succeeded_block_ids = block_ids.filter(id => !failed_keys.has(id));
                return { succeeded_block_ids, failed_block_ids };
            } catch (err) {
                dbg.error('_delegate_delete_blocks_s3: ERROR', err);
                // NoSuchBucket: the underlying storage bucket was deleted or misconfigured -
                // this is an infrastructure error, invalidate cache and signal to caller.
                if (err.code === 'NoSuchBucket') {
                    block_store_info_cache.invalidate_key(options.address);
                    throw new RpcError('STORAGE_NOT_EXIST', `s3 bucket not found. got error ${err}`);
                } else if (err.code === 'AccessDenied') {
                    // AccessDenied: credentials are invalid or revoked - invalidate cache
                    // so next attempt will re-fetch credentials from the agent.
                    block_store_info_cache.invalidate_key(options.address);
                    throw new RpcError('AUTH_FAILED', `access denied to s3 bucket. got error ${err}`);
                }
                // Any other error (network, timeout, SDK error) - propagate as-is for retry.
                throw err;
            }
        })());
    }

    async _delegate_delete_blocks_azure(rpc_client, block_mds, options) {
        const { timeout = config.IO_DELETE_BLOCK_TIMEOUT } = options;
        return P.timeout(timeout, (async () => {
            const block_ids = block_mds.map(md => md.id);
            const succeeded_block_ids = [];
            const failed_block_ids = [];
            try {
                const bs_info = await block_store_info_cache.get_with_cache({ options, rpc_client });
                if (!bs_info) throw new Error('couldn\'t resolve cloud credentials');
                const azure_params = bs_info.connection_params;
                /** @type {import('../../util/azure_storage_wrap').BlobServiceClient} */
                const blob = cloud_utils.create_azure_blob_client({
                    endpoint: azure_params.endpoint,
                    connection_string: azure_params.connection_string,
                    access_key: azure_params.access_key,
                    azure_client_id: azure_params.azure_client_id,
                    azure_tenant_id: azure_params.azure_tenant_id,
                });
                const container = bs_info.target_bucket;
                const container_client = blob.getContainerClient(container);
                dbg.log1('_delegate_delete_blocks_azure: deleting', block_ids.length, 'blocks from', container);

                await P.map_with_concurrency(10, block_mds, async block_md => {
                    try {
                        const block_dir = get_block_internal_dir(block_md.id);
                        const block_key = `${bs_info.blocks_path}/${block_dir}/${block_md.id}`;
                        const blob_client = azure_storage.get_blob_client(container_client, block_key);
                        await blob_client.delete();
                        succeeded_block_ids.push(block_md.id);
                    } catch (err) {
                        if (err.details && err.details.code === 'ContainerNotFound') {
                            // ContainerNotFound: the entire Azure container is missing - this is an
                            // infrastructure error (not a per-block issue). Rethrow to abort the batch
                            // and let the outer catch translate it to STORAGE_NOT_EXIST.
                            throw err;
                        } else if (err.details && err.details.code === 'BlobNotFound') {
                            // BlobNotFound: the specific block object doesn't exist in Azure.
                            // This is an idempotent success - the block is already gone (e.g. previous
                            // partial deletion or external cleanup). Treat as successfully deleted.
                            succeeded_block_ids.push(block_md.id);
                        } else {
                            // Any other per-block error (transient network issue, throttling, etc.) -
                            // mark as failed so the block can be retried in a future reclaim cycle.
                            dbg.warn('_delegate_delete_blocks_azure: failed to delete block', block_md.id, err);
                            failed_block_ids.push(block_md.id);
                        }
                    }
                });

                let deleted_size = 0;
                let deleted_count = 0;
                for (const block_md of block_mds) {
                    if (failed_block_ids.includes(block_md.id)) continue;
                    const encoded_md = Buffer.from(JSON.stringify(block_md)).toString('base64');
                    deleted_size += (block_md.is_preallocated ? 0 : block_md.size) + encoded_md.length;
                    deleted_count += block_md.is_preallocated ? 0 : 1;
                }
                this._update_usage_stats(rpc_client, {
                    size: -deleted_size,
                    count: -deleted_count
                }, options.address, 'WRITE');

                return { succeeded_block_ids, failed_block_ids };
            } catch (err) {
                dbg.error('_delegate_delete_blocks_azure: ERROR', err);
                // ContainerNotFound: the Azure container backing this pool no longer exists -
                // invalidate cached credentials/info and signal infrastructure failure to caller.
                if (err.details && err.details.code === 'ContainerNotFound') {
                    block_store_info_cache.invalidate_key(options.address);
                    throw new RpcError('STORAGE_NOT_EXIST', `azure container not found. got error ${err}`);
                } else if (err.details && err.details.code === 'AuthenticationFailed') {
                    // AuthenticationFailed: credentials are invalid or expired - invalidate cache
                    // so next attempt will re-fetch credentials from the agent.
                    block_store_info_cache.invalidate_key(options.address);
                    throw new RpcError('AUTH_FAILED', `access denied to azure container. got error ${err}`);
                }
                // Any other error (network, timeout, SDK error) - propagate as-is for retry.
                throw err;
            }
        })());
    }

    async _delegate_delete_blocks_google(rpc_client, block_mds, options) {
        const { timeout = config.IO_DELETE_BLOCK_TIMEOUT } = options;
        return P.timeout(timeout, (async () => {
            const block_ids = block_mds.map(md => md.id);
            const succeeded_block_ids = [];
            const failed_block_ids = [];
            try {
                const bs_info = await block_store_info_cache.get_with_cache({ options, rpc_client });
                if (!bs_info) throw new Error('couldn\'t resolve cloud credentials');
                const google_params = bs_info.connection_params;
                const google = new Storage({
                    projectId: google_params.project_id,
                    credentials: {
                        client_email: google_params.client_email,
                        private_key: google_params.private_key
                    }
                });
                const bucket = google.bucket(bs_info.target_bucket);
                dbg.log1('_delegate_delete_blocks_google: deleting', block_ids.length, 'blocks from', bs_info.target_bucket);

                await P.map_with_concurrency(10, block_mds, async block_md => {
                    try {
                        const block_dir = get_block_internal_dir(block_md.id);
                        const block_key = `${bs_info.blocks_path}/${block_dir}/${block_md.id}`;
                        const file = bucket.file(block_key);
                        await file.delete();
                        succeeded_block_ids.push(block_md.id);
                    } catch (err) {
                        if (err.code === 404 && err.errors && err.errors[0] &&
                                err.errors[0].reason === 'notFound') {
                            // Object-level 404 with reason 'notFound': the specific block file doesn't
                            // exist in the bucket. This is an idempotent success - the block is already
                            // gone (e.g. previous partial deletion or external cleanup).
                            succeeded_block_ids.push(block_md.id);
                        } else if (err.code === 404) {
                            // Other 404 without the object-level 'notFound' reason: indicates the bucket
                            // itself doesn't exist. Rethrow to abort the batch and let the outer catch
                            // translate it to STORAGE_NOT_EXIST.
                            throw err;
                        } else {
                            // Any other per-block error (transient network issue, throttling, etc.) -
                            // mark as failed so the block can be retried in a future reclaim cycle.
                            dbg.warn('_delegate_delete_blocks_google: failed to delete block', block_md.id, err);
                            failed_block_ids.push(block_md.id);
                        }
                    }
                });

                let deleted_size = 0;
                let deleted_count = 0;
                for (const block_md of block_mds) {
                    if (failed_block_ids.includes(block_md.id)) continue;
                    const encoded_md = Buffer.from(JSON.stringify(block_md)).toString('base64');
                    deleted_size += (block_md.is_preallocated ? 0 : block_md.size) + encoded_md.length;
                    deleted_count += block_md.is_preallocated ? 0 : 1;
                }
                this._update_usage_stats(rpc_client, {
                    size: -deleted_size,
                    count: -deleted_count
                }, options.address, 'WRITE');

                return { succeeded_block_ids, failed_block_ids };
            } catch (err) {
                dbg.error('_delegate_delete_blocks_google: ERROR', err);
                if (err.code === 403) {
                    // 403 Forbidden: credentials are invalid or lack required permissions -
                    // invalidate cache so next attempt will re-fetch credentials from the agent.
                    block_store_info_cache.invalidate_key(options.address);
                    throw new RpcError('AUTH_FAILED', `access denied to google cloud bucket. got error ${err}`);
                } else if (err.code === 404) {
                    // Bucket-level 404: the GCS bucket backing this pool no longer exists -
                    // invalidate cached info and signal infrastructure failure to caller.
                    block_store_info_cache.invalidate_key(options.address);
                    throw new RpcError('STORAGE_NOT_EXIST', `google cloud bucket not found. got error ${err}`);
                }
                // Any other error (network, timeout, SDK error) - propagate as-is for retry.
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
