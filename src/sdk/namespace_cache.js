/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const stream = require('stream');
const assert = require('assert');
const dbg = require('../util/debug_module')(__filename);

class NamespaceCache {

    constructor({ namespace_hub, namespace_nb, rpc_client, caching, active_triggers }) {
        this.namespace_hub = namespace_hub;
        this.namespace_nb = namespace_nb;
        this.active_triggers = active_triggers;
        this.caching = caching;
        this.rpc_client = rpc_client;
    }

    get_write_resource() {
        return this.namespace_hub;
    }

    /////////////////
    // OBJECT LIST //
    /////////////////

    async list_objects(params, object_sdk) {
        // TODO listing from cache only for deevelopment
        return this.namespace_nb.list_objects(params, object_sdk);
    }

    async list_uploads(params, object_sdk) {
        // TODO listing from cache only for deevelopment
        return this.namespace_nb.list_uploads(params, object_sdk);
    }

    async list_object_versions(params, object_sdk) {
        // TODO listing from cache only for deevelopment
        return this.namespace_nb.list_object_versions(params, object_sdk);
    }

    /////////////////
    // OBJECT READ //
    /////////////////

    async read_object_md(params, object_sdk) {
        let object_info_cache = null;
        try {
            const get_from_cache = params.get_from_cache;
            if (get_from_cache) {
                // Remove get_from_cache if exists for maching RPC schema
                params = _.omit(params, 'get_from_cache');
            }
            object_info_cache = await this.namespace_nb.read_object_md(params, object_sdk);
            if (get_from_cache) {
                dbg.log0('NamespaceCache.read_object_md get_from_cache is enabled', object_info_cache);
                return object_info_cache;
            }

            const cache_validation_time = object_info_cache.cache_valid_time;
            const time_since_validation = Date.now() - cache_validation_time;

            // caching.ttl is in seconds
            if (time_since_validation <= this.caching.ttl * 1000) {
                object_info_cache.from_cache = true; // mark it for read_object_stream
                dbg.log0('NamespaceCache.read_object_md use md from cache', object_info_cache);
                return object_info_cache;
            }

        } catch (err) {
            dbg.log0('NamespaceCache.read_object_md: error in cache', err);
        }

        let object_info_hub = null;
        try {
            object_info_hub = await this.namespace_hub.read_object_md(params, object_sdk);
            if (object_info_cache && object_info_hub.etag === object_info_cache.etag) {
                dbg.log0('NamespaceCache.read_object_md: same etags: updating cache valid time', object_info_hub);
                process.nextTick(() => {
                    const update_params = _.pick(_.defaults({ bucket: this.namespace_nb.target_bucket }, params), 'bucket', 'key');
                    update_params.cache_valid_time = (new Date()).getTime();
                    this.rpc_client.object.update_object_md(update_params)
                        .then(() => {
                            dbg.log0('NamespaceCache.read_object_md: updated cache valid time', update_params);
                        })
                        .catch(err => {
                            dbg.error('NamespaceCache.read_object_md: error in updating cache valid time', err);
                        });
                });
            } else {
                dbg.log0('NamespaceCache.read_object_md: etags different',
                    params, {hub_tag: object_info_hub.etag, cache_etag: object_info_cache.etag});
            }
        } catch (err) {
            if (err.code === 'NotFound') {
                if (object_info_cache) {
                    process.nextTick(() => {
                        const delete_params = _.pick(params, 'bucket', 'key', 'obj_id');
                        this.namespace_nb.delete_object(delete_params, object_sdk)
                        .then(() => {
                            dbg.log0('NamespaceCache.read_object_md: deleted object from cache', delete_params);
                        })
                        .catch(errDelete => {
                            dbg.error('NamespaceCache.read_object_md: error in deleting object from cache', params, errDelete);
                        });
                    });
                }
            } else {
                dbg.log0('NamespaceCache.read_object_md: NOT NoSuchKey in hub', err);
            }
            throw (err);
        }
        return object_info_hub;
    }

    async read_object_stream(params, object_sdk) {
        dbg.log0('NamespaceCache.read_object_stream', {params: params});
        const get_from_cache = params.get_from_cache;
        if (get_from_cache) {
            // Remove get_from_cache if exists for maching RPC schema
            params = _.omit(params, 'get_from_cache');
        }
        if (params.object_md.from_cache || get_from_cache) {
            try {
                return this.namespace_nb.read_object_stream(params, object_sdk);
            } catch (err) {
                console.warn('NamespaceCache.read_object_stream: cache error', err);
            }
        }

        const read_stream = await this.namespace_hub.read_object_stream(params, object_sdk);

        // we use a pass through stream here because we have to start piping immediately
        // and the cache upload does not pipe immediately (only after creating the object_md).
        const cache_stream = new stream.PassThrough();
        read_stream.pipe(cache_stream);

        const upload_params = {
            source_stream: cache_stream,
            bucket: params.bucket,
            key: params.key,
            size: params.object_md.size,
            content_type: params.content_type,
            xattr: params.object_md.xattr,
        };

        this.namespace_nb.upload_object(upload_params, object_sdk);

        return read_stream;
    }

    ///////////////////
    // OBJECT UPLOAD //
    ///////////////////

    async upload_object(params, object_sdk) {

        // TODO: Create a config for the max size of object to be cached
        if (params.size > 8 * 1024 * 1024) {
            return this.namespace_hub.upload_object(params, object_sdk);
        }

        const hub_stream = new stream.PassThrough();
        const cache_stream = new stream.PassThrough({
            final(callback) {
                // defer the finalizer of the cache stream until the hub ack
                if (hub_stream.writableFinished) {
                    dbg.log0("NamespaceCache.upload_object: upload hub has been completed",
                        {bucket: params.bucket, xattr: params.xattr, object_sdk: object_sdk.namespace_nb});

                    return callback();
                } else {
                    dbg.log0("NamespaceCache.upload_object: waiting for hub to complete",
                        {bucket: params.bucket, xattr: params.xattr, object_sdk: object_sdk.namespace_nb});
                    hub_stream.on('finish', callback);
                }
            }
        });

        const hub_params = { ...params, source_stream: hub_stream };
        const cache_params = { ...params, source_stream: cache_stream };
        // One important caveat is that if the Readable stream emits an error during processing,
        // the Writable destination is not closed automatically. If an error occurs, it will be
        // necessary to manually close each stream in order to prevent memory leaks.
        params.source_stream.on('error', err => {
            dbg.log0("NamespaceCache.upload_object: error in read source",
                {bucket: params.bucket, xattr: params.xattr, object_sdk: object_sdk.namespace_nb, error: err});
            hub_stream.destroy();
            cache_stream.destroy();
        });
        params.source_stream.on('close', () => {
            dbg.log0("NamespaceCache.upload_object: closing in read source",
                {bucket: params.bucket, xattr: params.xattr, object_sdk: object_sdk.namespace_nb });
                if (!params.source_stream.readableEnded) {
                    dbg.log0("NamespaceCache.upload_object: closing in read source - NOT readableEnded - Should be error",
                    {bucket: params.bucket, xattr: params.xattr, object_sdk: object_sdk.namespace_nb });
                hub_stream.destroy();
                cache_stream.destroy();
            }
        });
        params.source_stream.pipe(hub_stream);
        params.source_stream.pipe(cache_stream);

        const hub_res1 = await Promise.all([
            this.namespace_hub.upload_object(hub_params, object_sdk),
            this.namespace_nb.upload_object(cache_params, object_sdk),
        ])
        .then(([hub_res, cache_res]) => {
            assert.strictEqual(hub_res.etag, cache_res.etag);
            return hub_res;
        })
        .catch(err => {
            dbg.log0("NamespaceCache.upload_object: error in upload",
                {bucket: params.bucket, xattr: params.xattr, object_sdk: object_sdk.namespace_nb, error: err});
            // If error is from cache, we should probably ignore and let hub upload continue. Change Promise.all to Promise.allSettled?
            throw err;
        });

        return hub_res1;
    }

    //////////////////////
    // MULTIPART UPLOAD //
    //////////////////////

    async create_object_upload(params, object_sdk) {
        return this.namespace_hub.create_object_upload(params, object_sdk);
    }

    async upload_multipart(params, object_sdk) {
        return this.namespace_hub.upload_multipart(params, object_sdk);
    }

    async list_multiparts(params, object_sdk) {
        return this.namespace_hub.list_multiparts(params, object_sdk);
    }

    async complete_object_upload(params, object_sdk) {
        return this.namespace_hub.complete_object_upload(params, object_sdk);
    }

    async abort_object_upload(params, object_sdk) {
        return this.namespace_hub.abort_object_upload(params, object_sdk);
    }

    ///////////////////
    // OBJECT DELETE //
    ///////////////////

    async delete_object(params, object_sdk) {

        /*
        // DELETE CACHE
        try {
            await this.namespace_nb.delete_object(params, object_sdk);
        } catch (err) {
            if (err !== 'NotFound') throw;
        }

        // DELETE HUB
        return this.namespace_hub.delete_object(params, object_sdk);
      */

        const [hub_res, cache_res] = await Promise.allSettled([
            this.namespace_hub.delete_object(params, object_sdk),
            this.namespace_nb.delete_object(params, object_sdk),
        ]);
        if (hub_res.status === 'rejected') {
            throw hub_res.reason;
        }
        if (cache_res.status === 'rejected') {
            if (cache_res.reason.code !== 'NoSuchKey') throw cache_res.reason;
        }
        return hub_res.value;
    }

    async delete_multiple_objects(params, object_sdk) {
        return this.namespace_hub.delete_multiple_objects(params, object_sdk);
    }

    ////////////////////
    // OBJECT TAGGING //
    ////////////////////

    async get_object_tagging(params, object_sdk) {
        return this.namespace_hub.get_object_tagging(params, object_sdk);
    }

    async delete_object_tagging(params, object_sdk) {
        return this.namespace_hub.delete_object_tagging(params, object_sdk);
    }

    async put_object_tagging(params, object_sdk) {
        return this.namespace_hub.put_object_tagging(params, object_sdk);
    }

    //////////////////////////
    // AZURE BLOB MULTIPART //
    //////////////////////////

    async upload_blob_block(params, object_sdk) {
        return this.namespace_hub.upload_blob_block(params, object_sdk);
    }

    async commit_blob_block_list(params, object_sdk) {
        return this.namespace_hub.commit_blob_block_list(params, object_sdk);
    }

    async get_blob_block_lists(params, object_sdk) {
        return this.namespace_hub.get_blob_block_lists(params, object_sdk);
    }

}


module.exports = NamespaceCache;
