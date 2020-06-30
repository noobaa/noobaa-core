/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const stream = require('stream');
const assert = require('assert');
const dbg = require('../util/debug_module')(__filename);
const P = require('../util/promise');

class NamespaceCache {

    constructor({ namespace_hub, namespace_nb, caching, active_triggers }) {
        this.namespace_hub = namespace_hub;
        this.namespace_nb = namespace_nb;
        this.active_triggers = active_triggers;
        this.caching = caching;
    }

    get_write_resource() {
        return this.namespace_hub;
    }

    async _delete_object_from_cache(params, object_sdk) {
        try {
            const delete_params = _.pick(params, 'bucket', 'key');
            await this.namespace_nb.delete_object(delete_params, object_sdk);
            dbg.log0('NamespaceCache: deleted object from cache', delete_params);
        } catch (err) {
            dbg.warn('NamespaceCache: error in deleting object from cache', params, err);
        }
    }

    async _update_cache_last_valid_time(params, object_sdk) {
        try {
            const update_params = _.pick(_.defaults({ bucket: this.namespace_nb.target_bucket }, params), 'bucket', 'key');
            update_params.cache_last_valid_time = (new Date()).getTime();

            await object_sdk.rpc_client.object.update_object_md(update_params);
            dbg.log0('NamespaceCache: updated cache valid time', update_params);
        } catch (err) {
            dbg.error('NamespaceCache: error in updating cache last valid time', err);
        }
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
        let cache_etag = '';
        try {
            const get_from_cache = params.get_from_cache;
            // Remove get_from_cache if exists for maching RPC schema
            params = _.omit(params, 'get_from_cache');
            object_info_cache = await this.namespace_nb.read_object_md(params, object_sdk);
            if (get_from_cache) {
                dbg.log0('NamespaceCache.read_object_md get_from_cache is enabled', object_info_cache);
                object_info_cache.should_read_from_cache = true;
                return object_info_cache;
            }

            const cache_validation_time = object_info_cache.cache_last_valid_time;
            const time_since_validation = Date.now() - cache_validation_time;

            if ((this.caching.ttl_ms > 0 && time_since_validation <= this.caching.ttl_ms) || this.caching.ttl_ms < 0) {
                object_info_cache.should_read_from_cache = true; // mark it for read_object_stream
                dbg.log0('NamespaceCache.read_object_md use md from cache', object_info_cache);
                return object_info_cache;
            }

            cache_etag = object_info_cache.etag;
        } catch (err) {
            dbg.log0('NamespaceCache.read_object_md: error in cache', err);
        }

        try {
            const object_info_hub = await this.namespace_hub.read_object_md(params, object_sdk);
            if (object_info_hub.etag === cache_etag) {
                dbg.log0('NamespaceCache.read_object_md: same etags: updating cache valid time', object_info_hub);
                setImmediate(() => this._update_cache_last_valid_time(params, object_sdk));
                object_info_cache.should_read_from_cache = true;

                return object_info_cache;

            } else if (cache_etag === '') {
                object_info_hub.should_read_from_cache = false;
            } else {
                dbg.log0('NamespaceCache.read_object_md: etags different',
                    params, {hub_tag: object_info_hub.etag, cache_etag: cache_etag});
            }

            return object_info_hub;

        } catch (err) {
            if (err.code === 'NoSuchKey') {
                if (object_info_cache) {
                    setImmediate(() => this._delete_object_from_cache(params, object_sdk));
                }
            } else {
                dbg.error('NamespaceCache.read_object_md: NOT NoSuchKey in hub', err);
            }
            throw (err);
        }
    }

    async read_object_stream(params, object_sdk) {

        const get_from_cache = params.get_from_cache;
        // Remove get_from_cache if exists for matching RPC schema in later API calls
        params = _.omit(params, 'get_from_cache');

        let read_response;
        if (params.object_md.should_read_from_cache || get_from_cache) {
            try {
                // params.missing_range_handler = async () => {
                //     this._read_from_hub(params, object_sdk);
                // };

                dbg.log0('NamespaceCache.read_object_stream: read from cache', params);
                read_response = await this.namespace_nb.read_object_stream(params, object_sdk);
            } catch (err) {
                dbg.warn('NamespaceCache.read_object_stream: cache error', err);
            }
        }

        read_response = read_response || await this._read_from_hub(params, object_sdk);

        const operation = 'ObjectRead';
        const load_for_trigger = !params.noobaa_trigger_agent &&
            object_sdk.should_run_triggers({ active_triggers: this.active_triggers, operation });
        if (load_for_trigger) {
            object_sdk.dispatch_triggers({ active_triggers: this.active_triggers, operation,
                obj: params.object_md, bucket: params.bucket });
        }

        return read_response;
    }

    async _read_from_hub(params, object_sdk) {
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

        dbg.log0('NamespaceCache.read_object_stream: put to cache',
            _.omit(upload_params, 'source_stream'));


        // PUT MISSING RANGES HERE ----

        this.namespace_nb.upload_object(upload_params, object_sdk);

        return read_stream;
    }

    ///////////////////
    // OBJECT UPLOAD //
    ///////////////////

    async upload_object(params, object_sdk) {
        dbg.log0("NamespaceCache.upload_object", _.omit(params, 'source_stream'));
        const operation = 'ObjectCreated';
        const load_for_trigger = object_sdk.should_run_triggers({ active_triggers: this.active_triggers, operation });

        let upload_response;
        let etag;
        if (params.size > 1024 * 1024) {

            setImmediate(() => this._delete_object_from_cache(params, object_sdk));

            upload_response = await this.namespace_hub.upload_object(params, object_sdk);
            etag = upload_response.etag;

        } else {

            // UPLOAD SIMULTANEOUSLY TO BOTH

            const hub_stream = new stream.PassThrough();
            const hub_params = { ...params, source_stream: hub_stream };
            const hub_promise = this.namespace_hub.upload_object(hub_params, object_sdk);

            // defer the final callback of the cache stream until the hub ack
            const cache_finalizer = callback => hub_promise.then(() => callback(), err => callback(err));
            const cache_stream = new stream.PassThrough({ final: cache_finalizer });
            const cache_params = { ...params, source_stream: cache_stream };
            const cache_promise = this.namespace_nb.upload_object(cache_params, object_sdk);

            // One important caveat is that if the Readable stream emits an error during processing,
            // the Writable destination is not closed automatically. If an error occurs, it will be
            // necessary to manually close each stream in order to prevent memory leaks.
            params.source_stream.on('error', err => {
                dbg.log0("NamespaceCache.upload_object: error in read source", {params: _.omit(params, 'source_stream'), error: err});
                hub_stream.destroy();
                cache_stream.destroy();
            });

            params.source_stream.pipe(hub_stream);
            params.source_stream.pipe(cache_stream);

            const [hub_res, cache_res] = await Promise.allSettled([ hub_promise, cache_promise ]);
            const hub_ok = hub_res.status === 'fulfilled';
            const cache_ok = cache_res.status === 'fulfilled';
            if (!hub_ok) {
                dbg.log0("NamespaceCache.upload_object: error in upload", { params: _.omit(params, 'source_stream'), hub_res, cache_res });
                // handling the case where cache succeeded and cleanup.
                // We can also just mark the cache object for re-validation
                // to make sure any read will have to re-validate it,
                // but writes (retries of the upload most likely) will be already in the cache
                // and detected by dedup so we don't need to do anything.
                if (cache_ok) {
                    setImmediate(() => this._delete_object_from_cache(params, object_sdk));
                }
                // fail back to client with the hub reason
                throw hub_res.reason;
            }

            if (cache_ok) {
                assert.strictEqual(hub_res.value.etag, cache_res.value.etag);
            } else {
                // on error from cache, we ignore and let hub upload continue
                dbg.log0("NamespaceCache.upload_object: error in cache upload", { params: _.omit(params, 'source_stream'), hub_res, cache_res });
            }

            upload_response = hub_res.value;
            etag = upload_response.etag;
        }

        if (load_for_trigger) {
            const obj = {
                bucket: params.bucket,
                key: params.key,
                size: params.size,
                content_type: params.content_type,
                etag
            };
            object_sdk.dispatch_triggers({ active_triggers: this.active_triggers, operation, obj, bucket: params.bucket });
        }

        return upload_response;
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

        // TODO: INVALIDATE CACHE
        // await this.namespace_nb.delete_object(TODO);

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
        if (cache_res.status === 'rejected' &&
            cache_res.reason.code !== 'NoSuchKey') {
            throw cache_res.reason;
        }

        const operation = 'ObjectRemoved';
        const load_for_trigger = object_sdk.should_run_triggers({ active_triggers: this.active_triggers, operation });
        if (load_for_trigger) {
            object_sdk.dispatch_triggers({ active_triggers: this.active_triggers, operation,
                obj: params.object_md, bucket: params.bucket });
        }

        return hub_res.value;
    }

    async delete_multiple_objects(params, object_sdk) {
        const deleted_res = await this.namespace_hub.delete_multiple_objects(params, object_sdk);

        const operation = 'ObjectRemoved';
        const load_for_trigger = object_sdk.should_run_triggers({ active_triggers: this.active_triggers, operation });
        if (load_for_trigger) {

            const head_res = await P.map(params.objects, async obj => {
                const request = {
                    bucket: params.bucket,
                    key: obj.key,
                    version_id: obj.version_id
                };
                let obj_md;
                try {
                    obj_md = _.defaults({ key: obj.key }, await this.namespace_hub.read_object_md(request, object_sdk));
                } catch (err) {
                    if (err.rpc_code !== 'NO_SUCH_OBJECT') throw err;
                }
                return obj_md;
            });

            for (let i = 0; i < deleted_res.length; ++i) {
                const deleted_obj = deleted_res[i];
                const head_obj = head_res[i];
                if (_.isUndefined(deleted_obj && deleted_obj.err_code) && head_obj) {
                    object_sdk.dispatch_triggers({ active_triggers: this.active_triggers, operation,
                        obj: head_obj, bucket: params.bucket });
                }
            }
        }

        return deleted_res;
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
