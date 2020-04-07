/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const stream = require('stream');
const assert = require('assert');

class NamespaceCache {

    constructor({ namespace_hub, namespace_nb, active_triggers }) {
        this.namespace_hub = namespace_hub;
        this.namespace_nb = namespace_nb;
        this.active_triggers = active_triggers;
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
        try {
            const object_info = await this.namespace_nb.read_object_md(params, object_sdk);

            // TODO this is the wrong condition - object create_time should be preserved 
            // from hub so not the validation time, so we need a custom cache metadata for that.
            const cache_validation_time = object_info.create_time;
            const time_since_validation = Date.now() - cache_validation_time;

            const CACHE_TTL = 60000; // 1 minute
            if (time_since_validation <= CACHE_TTL) {
                object_info.from_cache = true; // mark it for read_object_stream
                console.log('NamespaceCache.read_object_md: from cache', object_info);
                return object_info;
            }

        } catch (err) {
            console.warn('NamespaceCache.read_object_md: cache error', err);
        }

        // TODO do we have any benefit in caching just object mds?
        return this.namespace_hub.read_object_md(params, object_sdk);
    }

    async read_object_stream(params, object_sdk) {

        if (params.object_md.from_cache) {
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

        console.log('NamespaceCache.read_object_stream: put to cache',
            _.omit(upload_params, 'source_stream'));

        this.namespace_nb.upload_object(upload_params, object_sdk);

        return read_stream;
    }

    ///////////////////
    // OBJECT UPLOAD //
    ///////////////////

    async upload_object(params, object_sdk) {

        if (params.size > 1024 * 1024) {
            return this.namespace_hub.upload_object(params, object_sdk);
        }

        const hub_stream = new stream.PassThrough();
        const cache_stream = new stream.PassThrough({
            final(callback) {
                // defer the finalizer of the cache stream until the hub ack
                callback();
            }
        });
        const hub_params = { ...params, source_stream: hub_stream };
        const cache_params = { ...params, source_stream: cache_stream };
        params.source_stream.pipe(hub_stream);
        params.source_stream.pipe(cache_stream);

        // TODO keep last bytes hostage until hub ack
        const [hub_res, cache_res] = await Promise.all([
            this.namespace_hub.upload_object(hub_params, object_sdk),
            this.namespace_nb.upload_object(cache_params, object_sdk),
        ]);

        assert.strictEqual(hub_res.etag, cache_res.etag);

        return hub_res;
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
