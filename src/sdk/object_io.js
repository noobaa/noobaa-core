/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const os = require('os');
const util = require('util');
const stream = require('stream');

const dbg = require('../util/debug_module')(__filename);
const config = require('../../config');
const Pipeline = require('../util/pipeline');
const LRUCache = require('../util/lru_cache');
const Semaphore = require('../util/semaphore');
const ChunkCoder = require('../util/chunk_coder');
const range_utils = require('../util/range_utils');
const buffer_utils = require('../util/buffer_utils');
const ChunkSplitter = require('../util/chunk_splitter');
const CoalesceStream = require('../util/coalesce_stream');
const ChunkedContentDecoder = require('../util/chunked_content_decoder');

const { MapClient } = require('./map_client');
const { ChunkAPI } = require('./map_api_types');
const { RpcError } = require('../rpc');

Object.isFrozen(RpcError); // otherwise unused

// dbg.set_level(5, 'core');

/**
 * @typedef {Object} UploadParams
 * @property {Object} client
 * @property {string} bucket
 * @property {string} key
 * @property {number} size
 * @property {stream.Readable} source_stream
 * @property {string} [content_type]
 * @property {number} [num] multipart number
 * @property {string} [md5_b64]
 * @property {string} [sha256_b64]
 * @property {Object} [xattr]
 * @property {Object} [md_conditions]
 * @property {Object} [copy_source]
 * @property {string} [obj_id]
 * @property {string} [tier_id]
 * @property {string} [bucket_id]
 * @property {string} [multipart_id]
 * @property {boolean} [chunked_content]
 * @property {Object} [desc]
 * @property {number} [start]
 * @property {number} [seq]
 * @property {Object} [chunk_split_config]
 * @property {Object} [chunk_coder_config]
 * 
 * @typedef {Object} ReadParams
 * @property {Object} client
 * @property {nb.ObjectInfo} object_md
 * @property {number} [start]
 * @property {number} [end]
 * @property {number} [watermark]
 * 
 * @typedef {Object} CachedRead
 * @property {nb.ObjectInfo} object_md
 * @property {Buffer} buffer
 * 
 * 
 */

class ObjectReadable extends stream.Readable {

    /**
     * 
     * @param {number} [start]
     * @param {(size:number) => void} read
     * @param {number} [watermark]
     */
    constructor(start, read, watermark) {
        super({
            // highWaterMark Number - The maximum number of bytes to store
            // in the internal buffer before ceasing to read
            // from the underlying resource. Default=16kb
            highWaterMark: watermark || config.IO_OBJECT_RANGE_ALIGN,
            // encoding String - If specified, then buffers will be decoded to strings
            // using the specified encoding. Default=null
            encoding: null,
            // objectMode Boolean - Whether this stream should behave as a stream of objects.
            // Meaning that stream.read(n) returns a single value
            // instead of a Buffer of size n. Default=false
            objectMode: false,
        });
        this.pos = start;
        this.pending = [];
        this._read = read;
    }

    // close() is setting a flag to enforce immediate close
    // and avoid more reads made by buffering
    // which can cause many MB of unneeded reads
    close() {
        this.closed = true;
    }
}

/**
 *
 * OBJECT IO
 *
 * the object io is a "heavy" instance with data caches.
 *
 * extends object_api which is plain REST api with logic to provide access
 * to remote object storage, and does the necessary distributed of io.
 * the client functions usually have the signature function(params), and return a promise.
 *
 * this is the client side (web currently) that sends the commands
 * defined in object_api to the web server.
 *
 */
class ObjectIO {

    /**
     * 
     * @param {nb.LocationInfo} [location_info]
     */
    constructor(location_info) {
        this._last_io_bottleneck_report = 0;
        this.location_info = location_info;

        this._io_buffers_sem = new Semaphore(config.IO_SEMAPHORE_CAP, {
            timeout: config.IO_STREAM_SEMAPHORE_TIMEOUT,
            timeout_error_code: 'OBJECT_IO_STREAM_ITEM_TIMEOUT'
        });

        dbg.log0('ObjectIO Configurations:', util.inspect({
            location_info,
            totalmem: os.totalmem(),
            ENDPOINT_FORKS_COUNT: config.ENDPOINT_FORKS_COUNT,
            IO_SEMAPHORE_CAP: config.IO_SEMAPHORE_CAP
        }));

    }

    set_verification_mode() {
        this._verification_mode = true;
    }

    clear_verification_mode() {
        this._verification_mode = false;
    }



    ////////////////////////////////////////////////////////////////////////////
    // UPLOAD FLOW /////////////////////////////////////////////////////////////
    ////////////////////////////////////////////////////////////////////////////

    /**
     *
     * upload_object
     *
     * upload the entire source_stream as a new object
     *
     * @param {UploadParams} params
     */
    async upload_object(params) {
        const create_params = _.pick(params,
            'bucket',
            'key',
            'content_type',
            'size',
            'md5_b64',
            'sha256_b64',
            'xattr',
            'tagging',
        );
        const complete_params = _.pick(params,
            'obj_id',
            'bucket',
            'key',
            'md_conditions',
        );
        try {
            dbg.log0('upload_object: start upload', create_params);
            const create_reply = await params.client.object.create_object_upload(create_params);
            params.obj_id = create_reply.obj_id;
            params.tier_id = create_reply.tier_id;
            params.bucket_id = create_reply.bucket_id;
            params.chunk_split_config = create_reply.chunk_split_config;
            params.chunk_coder_config = create_reply.chunk_coder_config;
            complete_params.obj_id = create_reply.obj_id;
            if (params.copy_source) {
                await this._upload_copy(params, complete_params);
            } else {
                await this._upload_stream(params, complete_params);
            }
            dbg.log0('upload_object: complete upload', complete_params);
            const complete_result = await params.client.object.complete_object_upload(complete_params);
            if (params.copy_source) {
                complete_result.copy_source = params.copy_source;
            }
            return complete_result;
        } catch (err) {
            dbg.warn('upload_object: failed upload', complete_params, err);
            if (params.obj_id) {
                try {
                    await params.client.object.abort_object_upload(_.pick(params, 'bucket', 'key', 'obj_id'));
                    dbg.log0('upload_object: aborted object upload', complete_params);
                } catch (err2) {
                    dbg.warn('upload_object: Failed to abort object upload', complete_params, err2);
                }
            }
            throw err; // throw the original error
        }
    }

    /**
     * @param {UploadParams} params
     */
    async upload_multipart(params) {
        const create_params = _.pick(params,
            'obj_id',
            'bucket',
            'key',
            'num',
            'size',
            'md5_b64',
            'sha256_b64'
        );
        const complete_params = _.pick(params,
            'multipart_id',
            'obj_id',
            'bucket',
            'key',
            'num',
        );
        try {
            dbg.log0('upload_multipart: start upload', complete_params);
            const multipart_reply = await params.client.object.create_multipart(create_params);
            params.tier_id = multipart_reply.tier_id;
            params.bucket_id = multipart_reply.bucket_id;
            params.multipart_id = multipart_reply.multipart_id;
            params.chunk_split_config = multipart_reply.chunk_split_config;
            params.chunk_coder_config = multipart_reply.chunk_coder_config;
            complete_params.multipart_id = multipart_reply.multipart_id;
            if (params.copy_source) {
                await this._upload_copy(params, complete_params);
            } else {
                await this._upload_stream(params, complete_params);
            }
            dbg.log0('upload_multipart: complete upload', complete_params);
            return params.client.object.complete_multipart(complete_params);
        } catch (err) {
            dbg.warn('upload_multipart: failed', complete_params, err);
            // we leave the cleanup of failed multiparts to complete_object_upload or abort_object_upload
            throw err;
        }
    }

    /**
     * @param {UploadParams} params
     * @param {Object} complete_params
     */
    async _upload_copy(params, complete_params) {
        const { obj_id, bucket, key, version_id, ranges } = params.copy_source;
        if (bucket === params.bucket && !ranges) {
            /** @type {{ object_md: nb.ObjectInfo, num_parts: number }} */
            const { object_md, num_parts } = await params.client.object.copy_object_mapping({
                bucket: params.bucket,
                key: params.key,
                obj_id: params.obj_id,
                multipart_id: params.multipart_id,
                copy_source: { obj_id },
            });
            complete_params.size = object_md.size;
            complete_params.num_parts = num_parts;
            complete_params.md5_b64 = object_md.md5_b64;
            complete_params.sha256_b64 = object_md.sha256_b64;
            complete_params.etag = object_md.etag; // preserve source etag
        } else if (ranges) {
            params.source_stream = this.read_object_stream({
                client: params.client,
                obj_id,
                bucket,
                key,
                version_id,
                start: ranges[0].start,
                end: ranges[0].end,
            });
            return this._upload_stream(params, complete_params);
        } else {
            params.source_stream = this.read_object_stream({
                client: params.client,
                obj_id,
                bucket,
                key,
                version_id,
            });
        }
        return this._upload_stream(params, complete_params);
    }

    /**
     *
     * _upload_stream
     *
     * upload the source_stream parts to object in upload mode
     * by reading large portions from the stream and call _upload_chunks()
     *
     * @param {UploadParams} params
     * @param {Object} complete_params
     */
    async _upload_stream(params, complete_params) {
        try {
            const res = await this._io_buffers_sem.surround_count(
                _get_io_semaphore_size(params.size),
                () => this._upload_stream_internal(params, complete_params)
            );
            return res;
        } catch (err) {
            this._handle_semaphore_errors(params.client, err);
            dbg.error('_upload_stream error', err, err.stack);
            throw err;
        }
    }

    /**
     * @param {UploadParams} params
     * @param {Object} complete_params
     */
    async _upload_stream_internal(params, complete_params) {

        params.desc = _.pick(params, 'obj_id', 'num', 'bucket', 'key');
        dbg.log0('UPLOAD:', params.desc, 'streaming to', params.bucket, params.key);

        // start and seq are set to zero even for multiparts and will be fixed
        // when multiparts are combined to object in complete_object_upload
        params.start = 0;
        params.seq = 0;

        complete_params.size = 0;
        complete_params.num_parts = 0;

        // The splitter transformer is responsible for splitting the stream into chunks
        // and also calculating the md5/sha256 of the entire stream as needed for the protocol.
        const splitter = new ChunkSplitter({
            watermark: 100,
            calc_md5: true,
            calc_sha256: Boolean(params.sha256_b64),
            chunk_split_config: params.chunk_split_config,
        });

        // The coder transformer is responsible for digest & compress & encrypt & erasure coding
        const coder = new ChunkCoder({
            watermark: 20,
            concurrency: 20,
            coder: 'enc',
            chunk_coder_config: params.chunk_coder_config,
        });

        const coalescer = new CoalesceStream({
            objectMode: true,
            max_length: 20,
            max_wait_ms: 10,
        });

        // The uploader transformer takes chunks after processed by the coder and uploads them
        // by doing allocate(md) + write(data) + finalize(md).
        const uploader = new stream.Transform({
            objectMode: true,
            allowHalfOpen: false,
            highWaterMark: 1,
            transform: (chunks, encoding, callback) =>
                this._upload_chunks(params, complete_params, chunks, callback)
        });

        const pipeline = new Pipeline(params.source_stream);

        if (params.chunked_content) pipeline.pipe(new ChunkedContentDecoder());
        pipeline.pipe(splitter);
        pipeline.pipe(coder);
        pipeline.pipe(coalescer);
        pipeline.pipe(uploader);
        await pipeline.promise();

        complete_params.md5_b64 = splitter.md5.toString('base64');
        if (splitter.sha256) complete_params.sha256_b64 = splitter.sha256.toString('base64');
    }


    /**
     *
     * _upload_chunks
     *
     * upload parts to object in upload mode
     * where data is buffer or array of buffers in memory.
     * @param {Object} params
     * @param {Object} complete_params
     * @param {nb.ChunkInfo[]} chunks
     * @param {(err?: Error) => void} callback
     */
    async _upload_chunks(params, complete_params, chunks, callback) {
        try {
            params.range = {
                start: params.start,
                end: params.start,
            };
            const map_chunks = chunks.map(chunk_info => {
                /** @type {nb.PartInfo} */
                const part = {
                    obj_id: params.obj_id,
                    chunk_id: undefined,
                    multipart_id: params.multipart_id,
                    start: params.start,
                    end: params.start + chunk_info.size,
                    seq: params.seq,
                    // millistamp: time_utils.millistamp(),
                    // bucket: params.bucket,
                    // key: params.key,
                    // desc: { ...params.desc, start: params.start },
                };
                // nullify the chunk's data to release the memory buffers
                // since we already coded it into the fragments
                chunk_info.data = undefined;
                chunk_info.tier_id = params.tier_id;
                chunk_info.bucket_id = params.bucket_id;
                chunk_info.parts = [part];
                for (const frag of chunk_info.frags) frag.blocks = [];
                const chunk = new ChunkAPI(chunk_info);
                params.seq += 1;
                params.start += chunk.size;
                params.range.end = params.start;
                complete_params.size += chunk.size;
                complete_params.num_parts += 1;
                dbg.log0('UPLOAD: part', part.start, chunk);
                return chunk;
            });
            const mc = new MapClient({
                chunks: map_chunks,
                location_info: params.location_info,
                check_dups: true,
                rpc_client: params.client,
                desc: params.desc,
                report_error: (block_md, action, err) => this._report_error_on_object_upload(params, block_md, action, err),
            });
            await mc.run();
            if (mc.had_errors) throw new Error('Upload map errors');
            return callback();
        } catch (err) {
            dbg.error('UPLOAD: _upload_chunks', err.stack || err);
            return callback(err);
        }
    }

    async _report_error_on_object_upload(params, block_md, action, err) {
        try {
            await params.client.object.report_error_on_object({
                action: 'upload',
                obj_id: params.obj_id,
                bucket: params.bucket,
                key: params.key,
                blocks_report: [{
                    block_md: block_md,
                    action: action,
                    rpc_code: err.rpc_code || '',
                    error_message: err.message || '',
                }]
            });
        } catch (reporting_err) {
            // reporting failed, we don't have much to do with it now
            // so will drop it, and wait for next failure to retry reporting
            dbg.warn('_report_error_on_object_upload:',
                'will throw original upload error',
                'and ignore this reporting error -', reporting_err);
        }
    }



    ////////////////////////////////////////////////////////////////////////////
    // READ FLOW ///////////////////////////////////////////////////////////////
    ////////////////////////////////////////////////////////////////////////////


    /**
     *
     * read entire object to memory buffer.
     * for testing.
     * @param {ReadParams} params
     * @returns {Promise<Buffer>}
     */
    async read_entire_object(params) {
        return buffer_utils.read_stream_join(this.read_object_stream(params));
    }


    /**
     *
     * returns a readable stream to the object.
     * see ObjectReader.
     * @param {ReadParams} params
     * @returns {ObjectReadable}
     */
    read_object_stream(params) {
        params.start = Number(params.start) || 0;
        params.end = params.end === undefined ? params.object_md.size : Math.min(params.end, params.object_md.size);
        const reader = new ObjectReadable(params.start, requested_size => {
            if (reader.closed) {
                dbg.log1('READ reader closed', reader.pos);
                reader.push(null);
                return;
            }
            if (reader.pending.length) {
                reader.push(reader.pending.shift());
                return;
            }
            const io_sem_size = _get_io_semaphore_size(requested_size);

            // TODO we dont want to use requested_size as end, because we read entire chunks 
            // and we are better off return the data to the stream buffer
            // instead of getting multiple calls from the stream with small slices to return.

            const requested_end = Math.min(params.end, reader.pos + requested_size);
            this._io_buffers_sem.surround_count(io_sem_size, async () => {
                try {
                    const buffers = await this.read_object_with_cache({
                        ...params,
                        start: reader.pos,
                        end: requested_end,
                    });
                    if (buffers && buffers.length) {
                        for (let i = 0; i < buffers.length; ++i) {
                            reader.pos += buffers[i].length;
                            reader.pending.push(buffers[i]);
                        }
                        dbg.log1('READ reader pos', reader.pos);
                        reader.push(reader.pending.shift());
                    } else {
                        reader.push(null);
                        dbg.log1('READ reader finished', reader.pos);
                    }
                } catch (err) {
                    this._handle_semaphore_errors(params.client, err);
                    dbg.error('READ reader error', err.stack || err);
                    reader.emit('error', err || 'reader error');
                }
            });

            // when starting to stream also prefrech the last part of the file
            // since some video encodings put a chunk of video metadata in the end
            // and it is often requested once doing a video time seek.
            // see https://trac.ffmpeg.org/wiki/Encode/H.264#faststartforwebvideo
            if (!params.start &&
                params.object_md &&
                params.object_md.size > 1024 * 1024 &&
                params.object_md.content_type.startsWith('video') &&
                this._io_buffers_sem.waiting_time < config.VIDEO_READ_STREAM_PRE_FETCH_LOAD_CAP) {
                const tail_io_sem_size = _get_io_semaphore_size(1024);
                setTimeout(async () => {
                    try {
                        await this._io_buffers_sem.surround_count(tail_io_sem_size, async () => {
                            await this.read_object_with_cache({
                                ...params,
                                start: params.object_md.size - 1024,
                                end: params.object_md.size,
                            });
                        });
                    } catch (err) {
                        this._handle_semaphore_errors(params.client, err);
                        dbg.error('READ prefetch end of file error', err);
                    }
                }, 10);
            }
        }, params.watermark);
        return reader;
    }


    /**
     *
     * read_object_with_cache
     *
     * @param {ReadParams} params
     * @returns {Promise<Buffer[]>} a portion of data.
     *      this is mostly likely shorter than requested, and the reader should repeat.
     *      null is returned on empty range or EOF.
     */
    async read_object_with_cache(params) {
        dbg.log1('READ read_object_with_cache: range', range_utils.human_range(params));

        if (params.end <= params.start) {
            // empty read range
            return null;
        }

        const mc = new MapClient({
            object_md: params.object_md,
            read_start: params.start,
            read_end: params.end,
            location_info: this.location_info,
            rpc_client: params.client,
            report_error: (block_md, action, err) => this._report_error_on_object_read(params, block_md, err),
        });
        await mc.run_object();
        if (mc.had_errors) throw new Error('Read map errors');

        return slice_buffers_in_range(mc.chunks, params.start, params.end);

        // let pos = params.start;
        // const promises = [];

        // while (pos < params.end && promises.length < config.IO_READ_RANGE_CONCURRENCY) {
        //     const start = pos;
        //     const end = Math.min(
        //         params.end,
        //         range_utils.align_up(pos + 1, config.IO_OBJECT_RANGE_ALIGN)
        //     );
        //     dbg.log2('READ read_object_with_cache: submit concurrent range', range_utils.human_range({ start, end }));
        //     promises.push(this._read_cache.get_with_cache({ ...params, start, end }));
        //     pos = end;
        // }

        // /** @type {Buffer[]} */
        // const buffers = await Promise.all(promises);
        // return buffers.filter(b => b && b.length);
    }


    /**
     *
     * _init_read_cache
     *
     */
    _init_read_cache() {
        this._read_cache = new LRUCache({
            name: 'ReadCache',
            max_usage: 256 * 1024 * 1024, // 128 MB
            /**
             * @param {CachedRead} data
             * @param {ReadParams} params
             * @returns {number}
             */
            item_usage(data, params) {
                return (data && data.buffer && data.buffer.length) || 1024;
            },
            /**
             * @param {ReadParams} params
             * @returns {string}
             */
            make_key(params) {
                const aligned_start = range_utils.align_down(params.start, config.IO_OBJECT_RANGE_ALIGN);
                const aligned_end = aligned_start + config.IO_OBJECT_RANGE_ALIGN;
                return params.object_md.obj_id + '\0' + aligned_start + '\0' + aligned_end;
            },
            /**
             * @param {ReadParams} params
             * @returns {Promise<CachedRead>}
             */
            async load(params) {
                const aligned_start = range_utils.align_down(params.start, config.IO_OBJECT_RANGE_ALIGN);
                const aligned_end = aligned_start + config.IO_OBJECT_RANGE_ALIGN;
                const buffer = await this.read_object({ ...params, start: aligned_start, end: aligned_end });
                return { object_md: params.object_md, buffer };
            },
            /**
             * @param {CachedRead} data
             * @param {ReadParams} params
             * @returns {Buffer}
             */
            make_val(data, params) {
                const buffer = data.buffer;
                if (!buffer) {
                    dbg.log3('READ ReadCache: null', range_utils.human_range(params));
                    return buffer;
                }
                const start = range_utils.align_down(
                    params.start, config.IO_OBJECT_RANGE_ALIGN);
                const end = start + config.IO_OBJECT_RANGE_ALIGN;
                const inter = range_utils.intersection(
                    start, end, params.start, params.end);
                if (!inter) {
                    dbg.log3('READ ReadCache: empty', range_utils.human_range(params),
                        'align', range_utils.human_range({
                            start: start,
                            end: end
                        }));
                    return null;
                }
                dbg.log3('READ ReadCache: slice', range_utils.human_range(params),
                    'inter', range_utils.human_range(inter), 'buffer', buffer.length);
                return buffer.slice(inter.start - start, inter.end - start);
            },
        });
    }



    /**
     * @param {ReadParams} params
     * @return {Promise<Buffer[]>} buffer - the data. can be shorter than requested if EOF.
     */
    async read_object(params) {
        dbg.log2('READ read_object:', range_utils.human_range(params));

        const mc = new MapClient({
            object_md: params.object_md,
            read_start: params.start,
            read_end: params.end,
            location_info: this.location_info,
            rpc_client: params.client,
            report_error: (block_md, action, err) => this._report_error_on_object_read(params, block_md, err),
        });
        await mc.run_object();
        if (mc.had_errors) throw new Error('Read map errors');

        return slice_buffers_in_range(mc.chunks, params.start, params.end);
    }

    /**
     * @param {ReadParams} params
     * @param {nb.BlockMD} block_md 
     * @param {Error} err 
     */
    async _report_error_on_object_read(params, block_md, err) {
        try {
            await params.client.object.report_error_on_object({
                action: 'read',
                bucket: params.object_md.bucket,
                key: params.object_md.key,
                start: params.start,
                end: params.end,
                blocks_report: [{
                    block_md: block_md,
                    action: 'read',
                    rpc_code: /** @type {RpcError} */ (err).rpc_code || '',
                    error_message: err.message || '',
                }]
            });
        } catch (reporting_err) {
            // reporting failed, we don't have much to do with it now
            // so will drop it, and wait for next failure to retry reporting
            dbg.warn('report_error_on_object_read:',
                'will throw original upload error',
                'and ignore this reporting error -', reporting_err);
        }
    }

    _handle_semaphore_errors(client, err) {
        if (err.code !== 'OBJECT_IO_STREAM_ITEM_TIMEOUT') return;
        const curr_date = Date.now();
        const HOUR_IN_MILI = 3600000;
        if (curr_date - this._last_io_bottleneck_report < HOUR_IN_MILI) return;
        this._last_io_bottleneck_report = curr_date;
        // Not interested in waiting for the response in order to not choke the upload
        setImmediate(async () => {
            try {
                await client.object.report_endpoint_problems({
                    problem: 'STRESS',
                    node_id: this.location_info && this.location_info.node_id,
                    host_id: this.location_info && this.location_info.host_id,
                });
            } catch (reporting_err) {
                dbg.error('_handle_semaphore_errors: had an error', reporting_err);
            }
        });
    }

}



// INTERNAL ///////////////////////////////////////////////////////////////////


/**
 * 
 * @param {nb.Chunk[]} chunks 
 * @param {number} start 
 * @param {number} end
 * @return {Buffer[]}
 */
function slice_buffers_in_range(chunks, start, end) {
    if (end <= start) {
        // empty read range
        return null;
    }
    if (!chunks || !chunks.length) {
        dbg.error('no chunks for data', range_utils.human_range({ start, end }));
        throw new Error('no chunks for data');
    }
    let pos = start;
    /** @type {Buffer[]} */
    const buffers = [];
    for (const chunk of chunks) {
        const part = chunk.parts[0];
        let part_range = range_utils.intersection(part.start, part.end, pos, end);
        if (!part_range) continue;
        let buffer_start = part_range.start - part.start;
        let buffer_end = part_range.end - part.start;
        if (part.chunk_offset) {
            buffer_start += part.chunk_offset;
            buffer_end += part.chunk_offset;
        }
        pos = part_range.end;
        buffers.push(chunk.data.slice(buffer_start, buffer_end));
    }
    if (pos !== end) {
        dbg.error('missing parts for data',
            range_utils.human_range({ start, end }),
            'pos', pos, chunks
        );
        throw new Error('missing parts for data');
    }
    // const buffer = buffer_utils.join(buffers);
    // if (buffer.length !== end - start) {
    //     dbg.error('short buffer from parts',
    //         range_utils.human_range({ start, end }),
    //         'pos', pos, chunks
    //     );
    //     throw new Error('short buffer from parts');
    // }
    return buffers;
}

function _get_io_semaphore_size(size) {
    // TODO: Currently we have a gap regarding chunked uploads
    // We assume that the chunked upload will take 1MB
    // This is done as a temporary quick fix and is not a good one
    return _.isNumber(size) ? Math.min(config.IO_STREAM_SEMAPHORE_SIZE_CAP, size) :
        config.IO_STREAM_MINIMAL_SIZE_LOCK;
}

module.exports = ObjectIO;
