/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const stream = require('stream');
const assert = require('assert');
const dbg = require('../util/debug_module')(__filename);
const cache_config = require('../../config.js').NAMESPACE_CACHING;
const range_utils = require('../util/range_utils');
const RangeStream = require('../util/range_stream');
const P = require('../util/promise');
const buffer_utils = require('../util/buffer_utils');
const stream_utils = require('../util/stream_utils');
const Semaphore = require('../util/semaphore');
const S3Error = require('../endpoint/s3/s3_errors').S3Error;
const s3_utils = require('../endpoint/s3/s3_utils');
const config = require('../../config');
const stats_collector = require('./endpoint_stats_collector');
const size_utils = require('../util/size_utils');

const _global_cache_uploader = new Semaphore(cache_config.UPLOAD_SEMAPHORE_CAP, {
    timeout: cache_config.UPLOAD_SEMAPHORE_TIMEOUT,
    timeout_error_code: 'NAMESPACE_CACHE_UPLOAD_TIMEOUT'
});

/**
 * @implements {nb.Namespace}
 */
class NamespaceCache {

    constructor({ namespace_hub, namespace_nb, caching, active_triggers }) {
        this.namespace_hub = namespace_hub;
        this.namespace_nb = namespace_nb;
        this.active_triggers = active_triggers;
        this.caching = caching;
        this.stats_collector = stats_collector.instance(namespace_hub.rpc_client);
    }

    get_write_resource() {
        return this;
    }

    is_readonly_namespace() {
        if (this.namespace_hub.access_mode && this.namespace_hub.access_mode === 'READ_ONLY') {
            return true;
        }
        return false;
    }

    get_bucket() {
        return this.namespace_hub.get_bucket();
    }

    is_server_side_copy(other, params) {
        return other instanceof NamespaceCache &&
            this.namespace_hub === other.namespace_hub &&
            this.namespace_nb === other.namespace_nb;
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

    async _get_bucket_free_space_bytes(params, object_sdk) {
        if (cache_config.DISABLE_BUCKET_FREE_SPACE_CHECK) {
            dbg.error('NamespaceCache: getting bucket free space is disabled');
            return cache_config.DEFAULT_MAX_CACHE_OBJECT_SIZE;
        }

        try {
            const bucket_usage = await object_sdk.read_bucket_usage_info(params.bucket);
            const bucket_free_space_bytes = Math.floor(size_utils.bigint_to_bytes(bucket_usage.free) *
                cache_config.CACHE_USAGE_PERCENTAGE_HIGH_THRESHOLD / 100);
            dbg.log0('NamespaceCache: bucket usage', { bucket_free_space_bytes, bucket_usage });
            return bucket_free_space_bytes;
        } catch (err) {
            dbg.error('NamespaceCache: error in read bucket usage', err);
            return cache_config.DEFAULT_MAX_CACHE_OBJECT_SIZE;
        }
    }

    async _get_cached_range_parts_info(params, object_sdk) {
        const read_mapping_params = _.pick(params, ['bucket', 'key', 'obj_id']);
        read_mapping_params.obj_id = params.object_md.obj_id;
        const object_mapping = await object_sdk.rpc_client.object.read_object_mapping(read_mapping_params);
        const parts = [];
        for (const chunk of object_mapping.chunks) {
            for (const part of chunk.parts) {
                parts.push(part);
            }
        }
        parts.sort((p1, p2) => p1.start - p2.start);
        const num_parts = parts.length;
        const deduped_parts = range_utils.dedup_ranges(parts);
        const total_cached_size = _.sumBy(deduped_parts, part => part.end - part.start);

        return { num_parts, num_deduped_parts: deduped_parts.length, total_cached_size };
    }

    // Return block info (start and end block index) for range in read
    // Return undefined if non range read
    _get_range_block_idx(params) {
        const { start, end } = params;
        if (start === undefined) return;
        if (params.read_size === params.object_md.size) return;

        const block_size = cache_config.DEFAULT_BLOCK_SIZE;
        const start_block_idx = start / block_size;
        const end_block_idx = end / block_size;
        return { start_block_idx, end_block_idx };
    }

    _should_cache_entire_object(params) {
        return params.object_md.size <= cache_config.DEFAULT_BLOCK_SIZE;
    }

    // Determine whether range read should be performed on hub by checking various factors.
    // Return true if range reads will be performed
    // Return false if entire object read will be performed
    async _range_read_hub_check(params, object_sdk) {

        const block_info = this._get_range_block_idx(params);
        if (block_info) {
            // s3 read is range read
            const block_size = cache_config.DEFAULT_BLOCK_SIZE;
            // If object is small (i.e. <= block size), we would like to read entire object.
            if (this._should_cache_entire_object(params)) return false;
            if (params.object_md.size <= params.bucket_free_space_bytes) {
                const part_size = (block_info.end_block_idx - block_info.start_block_idx + 1) * block_size;
                const read_percentage = _.divide(part_size, params.object_md.size) * 100;

                // If the size of data to be read is large enough in terms of object size and
                // we don't have enough data cached, we would like to read entire object from hub.
                // Otherwise, we will perform range read on hub.
                if (params.object_md.should_read_from_cache &&
                    read_percentage > cache_config.CACHED_PERCENTAGE_HIGH_THRESHOLD) {
                    const { total_cached_size } = await this._get_cached_range_parts_info(params, object_sdk);
                    const cached_data_percentage = _.divide(total_cached_size, params.object_md.size) * 100;
                    if (cached_data_percentage <= cache_config.CACHED_PERCENTAGE_LOW_THRESHOLD) {
                        // Read entire object from hub
                        return false;
                    }
                }
            }

            return true;

        } else if (params.object_md.should_read_from_cache && params.read_size > params.max_cache_obj_size) {
            // For entire read, iff large object is partially cache, check to see whether we should
            // read cached parts from cache and non cached from hub, or read entire object from hub.
            const { total_cached_size, num_deduped_parts } = await this._get_cached_range_parts_info(params, object_sdk);
            const cached_data_percentage = _.divide(total_cached_size, params.object_md.size) * 100;
            // If large object has many disjoint cache parts or small amount of cached data,
            // we would like to read entire object from hub because of overhead in hub reads.
            if (cached_data_percentage <= cache_config.CACHED_PERCENTAGE_LOW_THRESHOLD &&
                num_deduped_parts <= cache_config.PART_COUNT_HIGH_THRESHOLD) {
                // We will read cached parts and non-cached from hub
                return true;
            }
        }

        return false;
    }

    /////////////////
    // OBJECT LIST //
    /////////////////

    async list_objects(params, object_sdk) {
        const get_from_cache = params.get_from_cache;
        params = _.omit(params, 'get_from_cache');
        if (get_from_cache) {
            return this.namespace_nb.list_objects(params, object_sdk);
        }
        return this.namespace_hub.list_objects(params, object_sdk);
    }

    async list_uploads(params, object_sdk) {
        const get_from_cache = params.get_from_cache;
        params = _.omit(params, 'get_from_cache');
        if (get_from_cache) {
            return this.namespace_nb.list_uploads(params, object_sdk);
        }
        return this.namespace_hub.list_uploads(params, object_sdk);
    }

    async list_object_versions(params, object_sdk) {
        const get_from_cache = params.get_from_cache;
        params = _.omit(params, 'get_from_cache');
        if (get_from_cache) {
            return this.namespace_nb.list_objects(params, object_sdk);
        }
        return this.list_object_versions(params, object_sdk);
    }

    /////////////////
    // OBJECT READ //
    /////////////////

    async read_object_md(params, object_sdk) {
        let object_info_cache = null;
        let cache_etag = '';
        const get_from_cache = params.get_from_cache;
        // part_number is set to the query parameter partNumber in s3 request. If set,
        // it should be a positive integer between 1 and 10,000. We will bypass cache
        // and proxy request to hub.
        if (!params.part_number) {
            // partNumber is not set
            try {
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
                if (get_from_cache) throw err;
            }
        }
        try {
            const object_info_hub = await this.namespace_hub.read_object_md(params, object_sdk);
            if (object_info_hub.etag === cache_etag) {
                dbg.log0('NamespaceCache.read_object_md: same etags: updating cache valid time', object_info_hub);
                setImmediate(() => this._update_cache_last_valid_time(params, object_sdk));
                object_info_cache.should_read_from_cache = true;

                return object_info_cache;

            } else if (object_info_hub.first_range_data && object_info_hub.size <= object_info_hub.first_range_data.length) {
                // If the inline read covers entire object, we will submit it to cache.
                _global_cache_uploader.submit_background(
                    object_info_hub.size,
                    async () => {
                        const upload_params = {
                            source_stream: buffer_utils.buffer_to_read_stream(object_info_hub.first_range_data),
                            bucket: params.bucket,
                            key: params.key,
                            size: object_info_hub.size,
                            content_type: params.content_type,
                            xattr: object_info_hub.xattr,
                            last_modified_time: (new Date(object_info_hub.create_time)).getTime(),
                            upload_chunks_hook: this.update_cache_stats_hook(params.bucket)
                        };

                        const start_time = process.hrtime.bigint();
                        const upload_res = await this.namespace_nb.upload_object(upload_params, object_sdk);

                        this.stats_collector.update_cache_latency_stats({
                            bucket_name: params.bucket,
                            cache_write_latency: Number(process.hrtime.bigint() - start_time) / 1e6,
                        });

                        return upload_res;
                    }
                );
            } else if (cache_etag === '') {
                object_info_hub.should_read_from_cache = false;
            } else {
                dbg.log0('NamespaceCache.read_object_md: etags different: removing object from cache', { params, hub_tag: object_info_hub.etag, cache_etag: cache_etag });
                setImmediate(() => this._delete_object_from_cache(params, object_sdk));
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

    // If object is not cached,
    //   - it creates partial object and uploads part to cache if range read is performed on hub
    //   - it uploads entire object to cache if entire read is performed on hub.
    //
    // If entire or partial object is cached,
    //   - if entire read is performed on hub and cache does not have all the data,
    //     it uploads entire object to cache .
    //   - otherwise, it reads data from cache by providing missing_part_getter to
    //     cache's read_object_stream.
    async _read_object_stream(params, object_sdk) {
        dbg.log0('NamespaceCache._read_object_stream', { params: params });

        params.bucket_free_space_bytes = await this._get_bucket_free_space_bytes(params, object_sdk);
        const range_hub_read = await this._range_read_hub_check(params, object_sdk);
        if (!params.object_md.should_read_from_cache) {
            // Object not in cache
            if (range_hub_read && params.read_size <= params.bucket_free_space_bytes) {
                const create_params = _.pick(params,
                    'bucket',
                    'key',
                    'content_type',
                    // The following fields are actually NOT set in the input "params".
                    // Picking them is for the purpose of type validations in IDE such as VS Code,
                    // so that IDE does not complain about undefined field.
                    'size',
                    'etag',
                    'xattr',
                    'complete_upload',
                    'last_modified_time',
                );
                create_params.size = params.object_md.size;
                create_params.etag = params.object_md.etag;
                create_params.xattr = params.object_md.xattr;
                create_params.last_modified_time = (new Date(params.object_md.create_time)).getTime();
                create_params.complete_upload = true;
                // Create partial object md
                const create_reply = await object_sdk.rpc_client.object.create_object_upload(create_params);
                params.object_md.obj_id = create_reply.obj_id;

                dbg.log0('NamespaceCache._read_object_stream: partial object created:', create_reply.obj_id);
            }

            return this._read_hub_object_stream(params, object_sdk,
                range_hub_read ? { start: params.start, end: params.end } : undefined);
        }

        params.missing_part_getter = async (missing_part_start, missing_part_end) => {
            dbg.log0('NamespaceCache._read_object_stream: missing_part_getter', { params: params, missing_part_start, missing_part_end });

            const read_params = _.omit(params, ['start', 'end']);
            read_params.start = missing_part_start;
            read_params.end = missing_part_end;

            const read_stream = await this._read_hub_object_stream(
                read_params, object_sdk, { start: missing_part_start, end: missing_part_end });

            return buffer_utils.read_stream_join(read_stream);
        };

        try {
            const start_time = process.hrtime.bigint();
            const cache_read_stream = await this.namespace_nb.read_object_stream(params, object_sdk);

            // update latency stats on 'end'
            cache_read_stream.once('end', () => {
                this.stats_collector.update_cache_latency_stats({
                    bucket_name: params.bucket,
                    cache_read_latency: Number(process.hrtime.bigint() - start_time) / 1e6,
                });
                this.stats_collector.update_cache_stats({
                    bucket_name: params.bucket,
                    hit_count: 1,
                    range_op: (params.start || params.end)
                });
            });

            // update bytes stats on 'data' events but with a tap stream
            const tap_stream = stream_utils.get_tap_stream(data => {
                this.stats_collector.update_cache_stats({
                    bucket_name: params.bucket,
                    read_bytes: data.length,
                });
            });
            cache_read_stream.pipe(tap_stream);
            return tap_stream;
        } catch (err) {
            dbg.error('NamespaceCache.hub_range_read: fallback to hub after error in reading cache', err);
            return this._read_hub_object_stream(params, object_sdk, range_hub_read ? { start: params.start, end: params.end } : undefined);
        }
    }

    /*
     * It performs read operation on hub.
     * If hub_read_range is provided, it performs range read from hub.
     * Otherwise, perform entire object read from hub.
     *
     *                     |-- (if read size is <= configured max cached object size) --> cache_upload_stream
     * hub_read_stream --> |
     *                     |-- (if range read) --> range_stream
     *
     * Returns range_stream if range read; otherwise, hub_read_stream
     */
    async _read_hub_object_stream(params, object_sdk, hub_read_range) {
        dbg.log0('NamespaceCache._read_hub_object_stream', { params: params, hub_read_range });

        let hub_read_size = params.read_size;
        // Omit the original start and end set by s3 client
        const hub_read_params = _.omit(params, ['start', 'end']);

        if (hub_read_range) {
            // Align hub read range
            const block_size = cache_config.DEFAULT_BLOCK_SIZE;
            hub_read_range.start = range_utils.align_down(hub_read_range.start, block_size);
            const aligned_read_end = range_utils.align_up(hub_read_range.end, block_size);
            hub_read_range.end = Math.min(params.object_md.size, aligned_read_end);

            // Set the actual start and end in range read on hub
            hub_read_params.start = hub_read_range.start;
            // range end in namespace_s3 is exclusive
            hub_read_params.end = hub_read_range.end;

            hub_read_size = hub_read_range.end - hub_read_range.start;
        }

        let hub_read_stream;
        try {
            if (!hub_read_params.md_conditions) {
                hub_read_params.md_conditions = { if_match_etag: params.object_md.etag };
            }
            const start_time = process.hrtime.bigint();
            hub_read_stream = await this.namespace_hub.read_object_stream(hub_read_params, object_sdk);
            // update latency stats on 'end'
            hub_read_stream.once('end', () => {
                this.stats_collector.update_cache_latency_stats({
                    bucket_name: params.bucket,
                    hub_read_latency: Number(process.hrtime.bigint() - start_time) / 1e6,
                });
            });
        } catch (err) {
            if (err.rpc_code === 'IF_MATCH_ETAG') {
                await this._delete_object_from_cache(params, object_sdk);
            }
            throw err;
        }

        let range_stream;
        if (params.start || params.end) {
            let start = params.start;
            let end = params.end;
            if (hub_read_range) {
                start -= hub_read_range.start;
                end -= hub_read_range.start;
            }
            // Since range in hub read is aligned and most likely not the same as set by s3 client,
            // we use RangeStream to return the range set by s3 client.
            range_stream = new RangeStream(start, end);
            hub_read_stream.pipe(range_stream);
        }

        // Object or part will only be uploaded to cache if size is not too big and
        // the preconditions (if-match header etc.) are not set.
        if (hub_read_size <= params.bucket_free_space_bytes) {
            // We use pass through stream here because we have to start piping immediately
            // and the cache upload does not pipe immediately (only after creating the object_md).
            const cache_upload_stream = new stream.PassThrough();
            hub_read_stream.pipe(cache_upload_stream);

            const upload_params = {
                source_stream: cache_upload_stream,
                bucket: params.bucket,
                key: params.key,
                size: params.object_md.size,
                content_type: params.content_type,
                xattr: params.object_md.xattr,
            };
            if (hub_read_range) {
                if (params.md_conditions === undefined ||
                    params.md_conditions.if_match_etag === params.object_md.etag) {

                    upload_params.start = hub_read_range.start;
                    upload_params.end = hub_read_range.end;
                    // Set object ID since partial object has been created before
                    upload_params.obj_id = params.object_md.obj_id;

                    _global_cache_uploader.submit_background(
                        hub_read_size,
                        async () => {
                            const start_time = process.hrtime.bigint();
                            const upload_res = await object_sdk.object_io.upload_object_range(
                                _.defaults({
                                    client: object_sdk.rpc_client,
                                    bucket: this.namespace_nb.target_bucket,
                                }, upload_params));

                            this.stats_collector.update_cache_latency_stats({
                                bucket_name: params.bucket,
                                cache_write_latency: Number(process.hrtime.bigint() - start_time) / 1e6,
                            });

                            return upload_res;
                        }
                    );
                    dbg.log0('NamespaceCache._read_hub_object_stream: started uploading part to cache', params.object_md);
                } else {
                    dbg.log0('NamespaceCache._read_hub_object_stream: etags are different or non if-match preconditions, skip uploading part to cache', { md_conditions: params.md_conditions, cache_object_md: params.object_md });
                }

                this.stats_collector.update_cache_stats({
                    bucket_name: params.bucket,
                    miss_count: 1,
                    range_op: true,
                });
            } else {
                upload_params.last_modified_time = (new Date(params.object_md.create_time)).getTime();
                upload_params.upload_chunks_hook = this.update_cache_stats_hook(params.bucket);

                _global_cache_uploader.submit_background(
                    params.object_md.size,
                    async () => {
                        const start_time = process.hrtime.bigint();
                        const upload_res = await this.namespace_nb.upload_object(upload_params, object_sdk);

                        this.stats_collector.update_cache_latency_stats({
                            bucket_name: params.bucket,
                            cache_write_latency: Number(process.hrtime.bigint() - start_time) / 1e6,
                        });

                        return upload_res;
                    }
                );

                this.stats_collector.update_cache_stats({
                    bucket_name: params.bucket,
                    range_op: false,
                    miss_count: 1,
                });
            }
        }

        const ret_stream = range_stream ? range_stream : hub_read_stream;
        return ret_stream;
    }


    async read_object_stream(params, object_sdk) {
        // part_number is set to the query parameter partNumber in request. If set,
        // it should be a positive integer between 1 and 10,000. We will perform a 'ranged'
        // GET request for the part specified.
        if (params.part_number) {
            // If the query parameter partNumber is set, the object was most likely
            // created by the multipart upload. Since we don't support MP in cache,
            // we proxy the read to hub.
            return this.namespace_hub.read_object_stream(params, object_sdk);
        }

        const get_from_cache = params.get_from_cache;
        // Remove get_from_cache if exists for matching RPC schema
        params = _.omit(params, 'get_from_cache');

        params.read_size = params.object_md.size;
        let range_op = false;
        if (params.start || params.end) {
            params.read_size = params.end - params.start;
            range_op = true;
        }

        let read_response;
        let tap_stream;
        if (get_from_cache) {
            // For testing purpose: get_from_cache query parameter is on
            try {
                dbg.log0('NamespaceCache.read_object_stream: get_from_cache is on: read object from cache', params);
                const start_time = process.hrtime.bigint();
                read_response = await this.namespace_nb.read_object_stream(params, object_sdk);
                // update latency stats on 'end'
                read_response.once('end', () => {
                    this.stats_collector.update_cache_latency_stats({
                        bucket_name: params.bucket,
                        cache_read_latency: Number(process.hrtime.bigint() - start_time) / 1e6,
                    });
                    this.stats_collector.update_cache_stats({
                        bucket_name: params.bucket,
                        hit_count: 1,
                        range_op
                    });
                });

                // update bytes stats on 'data' events but with a tap stream
                tap_stream = stream_utils.get_tap_stream(data => {
                    this.stats_collector.update_cache_stats({
                        bucket_name: params.bucket,
                        read_bytes: data.length,
                    });
                });
                read_response.pipe(tap_stream);
            } catch (err) {
                dbg.warn('NamespaceCache.read_object_stream: cache read error', err);
            }
        }

        tap_stream = tap_stream || await this._read_object_stream(params, object_sdk);

        this.stats_collector.update_cache_stats({
            bucket_name: params.bucket,
            range_op,
            read_count: 1,
        });

        const operation = 'ObjectRead';
        const load_for_trigger = !params.noobaa_trigger_agent &&
            object_sdk.should_run_triggers({ active_triggers: this.active_triggers, operation });
        if (load_for_trigger) {
            object_sdk.dispatch_triggers({
                active_triggers: this.active_triggers,
                operation,
                obj: params.object_md,
                bucket: params.bucket
            });
        }

        return tap_stream;
    }

    ///////////////////
    // OBJECT UPLOAD //
    ///////////////////

    async upload_object(params, object_sdk) {
        dbg.log0("NamespaceCache.upload_object", _.omit(params, 'source_stream'));
        const operation = 'ObjectCreated';
        const load_for_trigger = object_sdk.should_run_triggers({ active_triggers: this.active_triggers, operation });

        const bucket_free_space_bytes = await this._get_bucket_free_space_bytes(params, object_sdk);
        let upload_response;
        let etag;
        if (params.size > bucket_free_space_bytes) {
            dbg.log0("NamespaceCache.upload_object: object is too big, skip caching");

            setImmediate(() => this._delete_object_from_cache(params, object_sdk));
            const start_time = process.hrtime.bigint();
            upload_response = await this.namespace_hub.upload_object(params, object_sdk);

            this.stats_collector.update_cache_latency_stats({
                bucket_name: params.bucket,
                hub_write_latency: Number(process.hrtime.bigint() - start_time) / 1e6,
            });

            etag = upload_response.etag;

        } else {

            // UPLOAD SIMULTANEOUSLY TO BOTH

            const hub_stream = new stream.PassThrough();
            const hub_params = { ...params, source_stream: hub_stream };
            const start_time = process.hrtime.bigint();
            const hub_promise = this.namespace_hub.upload_object(hub_params, object_sdk);
            // update latency stats on 'end'
            hub_promise.then(() => this.stats_collector.update_hub_latency_stats({
                bucket_name: params.bucket,
                hub_write_latency: Number(process.hrtime.bigint() - start_time) / 1e6,
            }));

            const cache_finalizer = callback => hub_promise.then(() => callback(), err => callback(err));

            const cache_stream = new stream.PassThrough({ final: cache_finalizer });
            const cache_params = {
                ...params,
                source_stream: cache_stream,
                async_get_last_modified_time: async () => {
                    const upload_res = await hub_promise;
                    const last_modified_time = (new Date(upload_res.last_modified_time)).getTime();
                    return last_modified_time;
                },
                upload_chunks_hook: this.update_cache_stats_hook(params.bucket),
            };
            const cache_promise = _global_cache_uploader.surround_count(
                params.size,
                async () => this.namespace_nb.upload_object(cache_params, object_sdk)
            );
            // update latency stats on 'end'
            cache_promise.then(() => this.stats_collector.update_cache_latency_stats({
                bucket_name: params.bucket,
                cache_write_latency: Number(process.hrtime.bigint() - start_time) / 1e6,
            }));

            // One important caveat is that if the Readable stream emits an error during processing,
            // the Writable destination is not closed automatically. If an error occurs, it will be
            // necessary to manually close each stream in order to prevent memory leaks.
            params.source_stream.on('error', err => {
                dbg.log0("NamespaceCache.upload_object: error in read source", { params: _.omit(params, 'source_stream'), error: err });
                hub_stream.destroy();
                cache_stream.destroy();
            });

            params.source_stream.pipe(hub_stream);
            params.source_stream.pipe(cache_stream);

            const [hub_res, cache_res] = await Promise.allSettled([hub_promise, cache_promise]);
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
                // Invalidate cache in case we have old object
                setImmediate(() => this._delete_object_from_cache(params, object_sdk));
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
        const operation = 'ObjectCreated';
        const load_for_trigger = object_sdk.should_run_triggers({ active_triggers: this.active_triggers, operation });

        const res = await this.namespace_hub.complete_object_upload(params, object_sdk);
        if (load_for_trigger) {
            const head_res = await this.read_object_md(params, object_sdk);
            const obj = {
                bucket: params.bucket,
                key: params.key,
                size: head_res.size,
                content_type: head_res.content_type,
                etag: head_res.etag
            };
            object_sdk.dispatch_triggers({ active_triggers: this.active_triggers, operation, obj, bucket: params.bucket });
        }
        await this._delete_object_from_cache(params, object_sdk);
        return res;
    }

    async abort_object_upload(params, object_sdk) {
        return this.namespace_hub.abort_object_upload(params, object_sdk);
    }

    ///////////////////
    // OBJECT DELETE //
    ///////////////////

    async delete_object(params, object_sdk) {

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
            object_sdk.dispatch_triggers({
                active_triggers: this.active_triggers,
                operation,
                obj: params.object_md,
                bucket: params.bucket
            });
        }

        return hub_res.value;
    }

    async delete_multiple_objects(params, object_sdk) {
        const operation = 'ObjectRemoved';
        const objects = params.objects.filter(obj => obj.version_id);
        if (objects.length > 0) {
            dbg.error('S3 Version request not (NotImplemented) for s3_post_bucket_delete', params);
            throw new S3Error(S3Error.NotImplemented);
        }
        const load_for_trigger = object_sdk.should_run_triggers({ active_triggers: this.active_triggers, operation });
        const head_res = load_for_trigger && await P.map(params.objects, async obj => {
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

        const [hub_res, cache_res] = await Promise.allSettled([
            this.namespace_hub.delete_multiple_objects(params, object_sdk),
            this.namespace_nb.delete_multiple_objects(params, object_sdk),
        ]);
        if (hub_res.status === 'rejected') {
            throw hub_res.reason;
        }
        if (cache_res.status === 'rejected') {
            throw cache_res.reason;
        }

        if (load_for_trigger) {
            for (let i = 0; i < hub_res.value.length; ++i) {
                const deleted_obj = hub_res.value[i];
                const head_obj = head_res[i];
                if (_.isUndefined(deleted_obj && deleted_obj.err_code) && head_obj) {
                    object_sdk.dispatch_triggers({
                        active_triggers: this.active_triggers,
                        operation,
                        obj: head_obj,
                        bucket: params.bucket
                    });
                }
            }
        }

        return hub_res.value;
    }

    update_cache_stats_hook(bucket_name) {
        return write_bytes => this.stats_collector.update_cache_stats({ bucket_name, write_bytes });
    }

    ////////////////////
    // OBJECT TAGGING //
    ////////////////////

    async get_object_tagging(params, object_sdk) {

        const object_md = await this.read_object_md(params, object_sdk);
        if (object_md.should_read_from_cache) {
            return this.namespace_nb.get_object_tagging(params, object_sdk);
        }

        return this.namespace_hub.get_object_tagging(params, object_sdk);
    }

    async delete_object_tagging(params, object_sdk) {

        const res = this.namespace_hub.delete_object_tagging(params, object_sdk);
        try {
            await this.namespace_nb.delete_object_tagging(params, object_sdk);
        } catch (err) {
            dbg.log0('failed to delete tags in cache', { params: _.omit(params, 'source_stream') });
        }
        return res;
    }

    async put_object_tagging(params, object_sdk) {

        const res = await this.namespace_hub.put_object_tagging(params, object_sdk);
        try {
            await this.namespace_nb.put_object_tagging(params, object_sdk);
        } catch (err) {
            dbg.log0('failed to store tags in cache', { params: _.omit(params, 'source_stream') });
        }
        return res;
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

    //////////
    // ACLs //
    //////////

    async get_object_acl(params, object_sdk) {
        if (config.NAMESPACE_CACHING.ACL_HANDLING === "reject") {
            throw new S3Error(S3Error.AccessDenied);
        }

        if (config.NAMESPACE_CACHING.ACL_HANDLING === "pass-through") {
            return this.namespace_hub.get_object_acl(params, object_sdk);
        }

        await this.read_object_md(params, object_sdk);
        return s3_utils.DEFAULT_OBJECT_ACL;
    }

    async put_object_acl(params, object_sdk) {
        if (config.NAMESPACE_CACHING.ACL_HANDLING === "reject") {
            throw new S3Error(S3Error.AccessDenied);
        }

        if (config.NAMESPACE_CACHING.ACL_HANDLING === "pass-through") {
            return this.namespace_hub.put_object_acl(params, object_sdk);
        }

        await this.read_object_md(params, object_sdk);
    }

    ///////////////////
    //  OBJECT LOCK  //
    ///////////////////

    async get_object_legal_hold() {
        throw new Error('TODO');
    }
    async put_object_legal_hold() {
        throw new Error('TODO');
    }
    async get_object_retention() {
        throw new Error('TODO');
    }
    async put_object_retention() {
        throw new Error('TODO');
    }

    ///////////////////
    //      ULS      //
    ///////////////////

    async create_uls() {
        throw new Error('TODO');
    }
    async delete_uls() {
        throw new Error('TODO');
    }
}


module.exports = NamespaceCache;
