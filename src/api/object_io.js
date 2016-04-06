// module targets: nodejs & browserify
'use strict';

let Readable = require('stream').Readable;
let _ = require('lodash');
let P = require('../util/promise');
let crypto = require('crypto');
let Semaphore = require('../util/semaphore');
let transformer = require('../util/transformer');
let Pipeline = require('../util/pipeline');
let range_utils = require('../util/range_utils');
let size_utils = require('../util/size_utils');
let time_utils = require('../util/time_utils');
let js_utils = require('../util/js_utils');
let LRUCache = require('../util/lru_cache');
let devnull = require('dev-null');
let config = require('../../config.js');
let dbg = require('../util/debug_module')(__filename);
let dedup_options = require("./dedup_options");
let MD5Stream = require('../util/md5_stream');
let ChunkStream = require('../util/chunk_stream');
// dbg.set_level(5, 'core');


let PART_ATTRS = [
    'start',
    'end',
    'upload_part_number',
    'part_sequence_number'
];
let CHUNK_ATTRS = [
    'size',
    'digest_type',
    'compress_type',
    'compress_size',
    'cipher_type',
    'data_frags',
    'lrc_frags',
    'digest_b64',
    'cipher_key_b64',
    'cipher_iv_b64',
    'cipher_auth_tag_b64'
];
let FRAG_ATTRS = [
    'layer',
    'layer_n',
    'frag',
    'digest_type',
    'digest_b64'
];
let CHUNK_DEFAULTS = {
    digest_type: '',
    digest_b64: '',
    cipher_type: '',
    cipher_key_b64: '',
};
let FRAG_DEFAULTS = {
    digest_type: '',
    digest_b64: '',
};


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

    constructor(client) {
        this.client = client;

        // some constants that might be provided as options to the client one day

        this.OBJECT_RANGE_ALIGN = 64 * 1024 * 1024;
        this.MAP_RANGE_ALIGN = 128 * 1024 * 1024;

        this.READ_CONCURRENCY = config.READ_CONCURRENCY;
        this.WRITE_CONCURRENCY = config.WRITE_CONCURRENCY;

        this.READ_RANGE_CONCURRENCY = config.READ_RANGE_CONCURRENCY;

        this.HTTP_PART_ALIGN = 32 * 1024 * 1024;
        this.HTTP_TRUNCATE_PART_SIZE = false;

        this._block_write_sem = new Semaphore(this.WRITE_CONCURRENCY);
        this._block_read_sem = new Semaphore(this.READ_CONCURRENCY);

        this._init_object_md_cache();
        this._init_object_range_cache();
        this._init_object_map_cache();
        this._init_blocks_cache();

        this.object_coding_default_options = {
            digest_type: 'sha384',
            compress_type: 'snappy',
            cipher_type: 'aes-256-gcm',
            frag_digest_type: 'sha1',
            data_frags: 1,
            parity_frags: 0,
            lrc_frags: 0,
            lrc_parity: 0,
        };
    }

    lazy_init_natives() {
        if (!this.native_core) {
            this.native_core = require('../util/native_core')();
        }
        let nc = this.native_core;
        // these threadpools are global OS threads used to offload heavy CPU work
        // from the node.js thread so that it will keep processing incoming IO while
        // encoding/decoding the object chunks in high performance native code.
        if (!ObjectIO.dedup_chunker_tpool) {
            ObjectIO.dedup_chunker_tpool = new nc.ThreadPool(1);
        }
        if (!ObjectIO.object_coding_tpool) {
            ObjectIO.object_coding_tpool = new nc.ThreadPool(2);
        }
        if (!this.dedup_config) {
            this.dedup_config = new nc.DedupConfig(dedup_options);
        }
        if (!this.object_coding) {
            this.object_coding = new nc.ObjectCoding(this.object_coding_default_options);
        }
    }


    set_verification_mode() {
        this._verification_mode = true;
    }



    ////////////////////////////////////////////////////////////////////////////
    // UPLOAD FLOW /////////////////////////////////////////////////////////////
    ////////////////////////////////////////////////////////////////////////////

    /**
     *
     * upload_stream
     *
     * upload the entire source_stream as a new object
     *
     */
    upload_stream(params) {
        let create_params = _.pick(params,
            'bucket',
            'key',
            'size',
            'content_type',
            'xattr',
            'overwrite_ifs'
        );

        dbg.log0('upload_stream: start upload', params.key);
        return this.client.object.create_object_upload(create_params)
            .then(create_reply => {
                params.upload_id = create_reply.upload_id;
                return this.upload_stream_parts(params);
            })
            .then(md5_digest => {
                let complete_params = _.pick(params, 'bucket', 'key', 'upload_id');
                if (md5_digest) {
                    complete_params.etag = md5_digest.toString('hex');
                }
                dbg.log0('upload_stream: complete upload', complete_params.key, complete_params.etag);
                return this.client.object.complete_object_upload(complete_params)
                    .return(md5_digest);
            }, err => {
                dbg.log0('upload_stream: error write stream', params.key, err);
                throw err;
            });
    }

    /**
     *
     * upload_stream_parts
     *
     * upload the source_stream parts to object in upload mode
     * by reading large portions from the stream and call upload_data_parts()
     *
     */
    upload_stream_parts(params) {
        params.start = params.start || 0;
        params.upload_part_number = params.upload_part_number || 0;
        params.part_sequence_number = params.part_sequence_number || 0;

        let md5_stream;
        let source_stream = params.source_stream;
        source_stream._readableState.highWaterMark = 1024 * 1024;
        if (params.calculate_md5) {
            md5_stream = new MD5Stream({
                highWaterMark: 1024 * 1024
            });
            source_stream.pipe(md5_stream);
            source_stream = md5_stream;
        }

        dbg.log0('upload_stream: start', params.key,
            'part number', params.upload_part_number,
            'sequence number', params.part_sequence_number);

        this.lazy_init_natives();
        params.dedup_chunker = new this.native_core.DedupChunker({
            tpool: ObjectIO.dedup_chunker_tpool
        }, this.dedup_config);

        let pipeline = new Pipeline(source_stream);

        pipeline.pipe(new ChunkStream(128 * 1024 * 1024, {
            highWaterMark: 1,
            objectMode: true
        }));

        if (true) {
            pipeline.pipe(transformer({
                options: {
                    highWaterMark: 1,
                    objectMode: true
                },
                transform: (t, data) => this.upload_data_parts(params, data)
            }));
        } else {
            pipeline.pipe(transformer({
                options: {
                    highWaterMark: 1,
                    objectMode: true
                },
                transform: (t, data) => this._chunk_and_encode_data(params, data)
            }));
            pipeline.pipe(transformer({
                options: {
                    highWaterMark: 1,
                    objectMode: true
                },
                transform_parallel: (t, parts) => this._allocate_parts(params, parts)
            }));
            pipeline.pipe(transformer({
                options: {
                    highWaterMark: 1,
                    objectMode: true,
                },
                transform_parallel: (t, parts) => this._write_parts(params, parts)
            }));
            pipeline.pipe(transformer({
                options: {
                    highWaterMark: 1,
                    objectMode: true
                },
                transform_parallel: (t, parts) => this._finalize_parts(params, parts)
            }));
        }

        pipeline.pipe(transformer({
            options: {
                highWaterMark: 1,
                flatten: true,
                objectMode: true
            },
            transform: (t, part) => {
                dbg.log1('upload_stream_parts: completed',
                    range_utils.human_range(part),
                    'took', time_utils.millitook(part.millistamp));
                dbg.log_progress(part.end / params.size);
                if (params.progress) {
                    params.progress(part);
                }
            }
        }));

        return pipeline.run()
            .then(() => md5_stream && md5_stream.wait_digest());
    }

    /**
     *
     * upload_data_parts
     *
     * upload parts to object in upload mode
     * where data is buffer or array of buffers in memory.
     *
     */
    upload_data_parts(params, data) {
        return P.fcall(() => this._chunk_and_encode_data(params, data))
            .then(parts => this._allocate_parts(params, parts))
            .then(parts => this._write_parts(params, parts))
            .then(parts => this._finalize_parts(params, parts));
    }


    /**
     *
     * _chunk_and_encode_data
     *
     */
    _chunk_and_encode_data(params, data) {
        return P.fcall(() => P.ninvoke(params.dedup_chunker, 'push', data))
            .then(buffers => P.ninvoke(params.dedup_chunker, 'flush')
                .then(last_bufs => js_utils.array_push_all(buffers, last_bufs)))
            .then(buffers => {
                let parts = _.map(buffers, buffer => {
                    let part = {
                        buffer: buffer,
                        millistamp: time_utils.millistamp(),
                        bucket: params.bucket,
                        key: params.key,
                        start: params.start,
                        end: params.start + buffer.length,
                        upload_part_number: params.upload_part_number,
                        part_sequence_number: params.part_sequence_number,
                    };
                    params.part_sequence_number += 1;
                    params.start += buffer.length;
                    return part;
                });
                return P.map(parts, part => {
                    dbg.log2('upload_stream_parts: encode', range_utils.human_range(part));
                    return P.ninvoke(this.object_coding, 'encode',
                            ObjectIO.object_coding_tpool, part.buffer)
                        .then(chunk => {
                            part.chunk = chunk;
                            part.buffer = null;
                            dbg.log1('upload_stream_parts: encode',
                                range_utils.human_range(part),
                                'took', time_utils.millitook(part.millistamp));
                            return part;
                        });
                });
            });
    }

    /**
     *
     * _allocate_parts
     *
     */
    _allocate_parts(params, parts) {
        let millistamp = time_utils.millistamp();
        let range = {
            start: parts[0].start,
            end: parts[parts.length - 1].end
        };
        dbg.log2('_allocate_parts:', range_utils.human_range(range));
        return this.client.object.allocate_object_parts({
                bucket: params.bucket,
                key: params.key,
                upload_id: params.upload_id,
                parts: _.map(parts, part => {
                    let p = _.pick(part, PART_ATTRS);
                    p.chunk = _.pick(part.chunk, CHUNK_ATTRS);
                    _.defaults(p.chunk, CHUNK_DEFAULTS);
                    p.chunk.frags = _.map(part.chunk.frags, fragment => {
                        let f = _.pick(fragment, FRAG_ATTRS);
                        _.defaults(f, FRAG_DEFAULTS);
                        f.size = fragment.block.length;
                        return f;
                    });
                    return p;
                })
            })
            .then(res => {
                dbg.log1('_allocate_parts: done', range_utils.human_range(range),
                    'took', time_utils.millitook(millistamp));
                _.each(parts, (part, i) => part.alloc_part = res.parts[i]);
                return parts;
            });
    }

    /**
     *
     * _write_parts
     *
     */
    _write_parts(params, parts) {
        let millistamp = time_utils.millistamp();
        let range = {
            start: parts[0].start,
            end: parts[parts.length - 1].end
        };
        dbg.log2('_write_parts: ', range_utils.human_range(range));
        return P.map(parts, part => this._write_fragments(part))
            .then(() => {
                dbg.log1('_write_parts: done', range_utils.human_range(range),
                    'took', time_utils.millitook(millistamp));
                return parts;
            });
    }

    /**
     *
     * _finalize_parts
     *
     */
    _finalize_parts(params, parts) {
        let millistamp = time_utils.millistamp();
        let range = {
            start: parts[0].start,
            end: parts[parts.length - 1].end
        };
        dbg.log2('_finalize_parts:', range_utils.human_range(range));
        return this.client.object.finalize_object_parts({
                bucket: params.bucket,
                key: params.key,
                upload_id: params.upload_id,
                parts: _.map(parts, 'alloc_part')
            })
            .then(() => {
                dbg.log1('_finalize_parts: done', range_utils.human_range(range),
                    'took', time_utils.millitook(millistamp));
                return parts;
            });
    }

    /**
     *
     * write the allocated part fragments to the storage nodes
     *
     */
    _write_fragments(part, source_part) {
        if (part.alloc_part.chunk_dedup) {
            dbg.log0('_write_fragments: DEDUP', range_utils.human_range(part));
            // nullify the chunk in order to release all the buffer's memory
            // while it's waiting in the finalize queue
            part.chunk = null;
            return;
        }

        let data_frags_map = _.keyBy(part.chunk.frags, get_frag_key);
        dbg.log1('_write_fragments: part', part, 'FRAGS', part.alloc_part.chunk.frags);

        return P.map(part.alloc_part.chunk.frags, fragment => {
            let frag_key = get_frag_key(fragment);
            let buffer = data_frags_map[frag_key].block;
            let block_to_write = fragment.blocks[0];
            let blocks_to_replicate = fragment.blocks.slice(1);
            return this._attempt_write_block({
                remaining_attempts: 5,
                block: block_to_write,
                buffer: buffer,
                part: part.alloc_part,
                desc: size_utils.human_offset(part.start) + '-' + frag_key,
            }).then(() => P.map(blocks_to_replicate, block => this._replicate_block({
                target: block,
                source: block_to_write,
                desc: size_utils.human_offset(part.start) + '-' + frag_key,
            })));
        });
    }

    /**
     *
     * attempt to write a block to the storage node with retries
     * and bad block reporting.
     *
     */
    _attempt_write_block(params) {
        return this._write_block(params)
            .catch(err => {
                if (params.remaining_attempts <= 0) {
                    throw new Error('EXHAUSTED WRITE BLOCK ' + params.desc);
                }
                params.remaining_attempts -= 1;
                return P.delay(100).then(() => this._attempt_write_block(params));
                /*
                let part = params.part;
                let block = params.block;
                let bad_block_params = _.extend(
                    _.pick(part, 'bucket', 'key', PART_ATTRS), {
                        block_id: block.block_md.id,
                        is_write: true,
                    });
                dbg.warn('_attempt_write_block: write failed, report_bad_block.',
                    params.desc, 'remaining attempts', params.remaining_attempts,
                    bad_block_params);
                return this.client.object.report_bad_block(bad_block_params)
                    .then(res => {
                        dbg.log2('_attempt_write_block retry with', res.new_block);
                        // NOTE: we update the block itself in the part so
                        // that finalize will see this update as well.
                        block.block_md = res.new_block;
                        return this._attempt_write_block(params);
                    });
                */
            });
    }

    /**
     *
     * write a block to the storage node
     *
     */
    _write_block(params) {
        let block_md = params.block.block_md;
        let buffer = params.buffer;

        // use semaphore to surround the IO
        return this._block_write_sem.surround(() => {

            dbg.log1('write_block', params.desc,
                size_utils.human_size(buffer.length),
                block_md.id, block_md.address);

            if (process.env.WRITE_BLOCK_ERROR_INJECTON &&
                process.env.WRITE_BLOCK_ERROR_INJECTON > Math.random()) {
                throw new Error('WRITE_BLOCK_ERROR_INJECTON');
            }

            // TODO GGG
            // return P.delay(1 + (1 * Math.random()));

            return this.client.agent.write_block({
                block_md: block_md,
                data: buffer,
            }, {
                address: block_md.address,
                timeout: config.write_block_timeout,
            }).catch(err => {
                dbg.error('write_block FAILED', params.desc,
                    size_utils.human_size(buffer.length),
                    block_md.id, block_md.address);
                throw err;
            });
        });
    }


    _replicate_block(params) {
        let target_md = params.target.block_md;
        let source_md = params.source.block_md;
        dbg.log1('replicate_block', params.desc,
            'target', target_md.id, target_md.address,
            'source', source_md.id, source_md.address);

        return this.client.agent.replicate_block({
            target: target_md,
            source: source_md,
        }, {
            address: target_md.address,
            timeout: config.write_block_timeout,
        }).catch(err => {
            dbg.error('replicate_block FAILED', params.desc,
                'target', target_md.id, target_md.address,
                'source', source_md.id, source_md.address);
            throw err;
        });
    }




    // METADATA FLOW //////////////////////////////////////////////////////////////



    /**
     *
     * get_object_md
     *
     * alternative to the default REST api read_object_md to use an MD cache.
     *
     * @param params (Object):
     *   - bucket (String)
     *   - key (String)
     * @param cache_miss (String): pass 'cache_miss' to force read
     */
    get_object_md(params, cache_miss) {
        return this._object_md_cache.get_with_cache(params, cache_miss);
    }


    _init_object_md_cache() {
        this._object_md_cache = new LRUCache({
            name: 'MDCache',
            // max_usage: 0,
            max_usage: 1000,
            expiry_ms: 60000, // 1 minute
            make_key: params => params.bucket + '\0' + params.key,
            load: params => {
                dbg.log1('MDCache: load', params.key, 'bucket', params.bucket);
                return this.client.object.read_object_md(params);
            }
        });
    }




    ////////////////////////////////////////////////////////////////////////////
    // READ FLOW ///////////////////////////////////////////////////////////////
    ////////////////////////////////////////////////////////////////////////////


    /**
     *
     * read entire object to memory buffer.
     * for testing.
     *
     */
    read_entire_object(params) {
        return new P((resolve, reject) => {
            let buffers = [];
            this.open_read_stream(params)
                .on('data', buffer => {
                    dbg.log0('read data', buffer.length);
                    buffers.push(buffer);
                })
                .once('end', () => {
                    let read_buf = Buffer.concat(buffers);
                    dbg.log0('read end', read_buf.length);
                    resolve(read_buf);
                })
                .once('error', err => {
                    dbg.log0('read error', err);
                    reject(err);
                });
        });
    }


    /**
     *
     * returns a readable stream to the object.
     * see ObjectReader.
     *
     */
    open_read_stream(params, watermark) {
        let reader = new Readable({
            // highWaterMark Number - The maximum number of bytes to store
            // in the internal buffer before ceasing to read
            // from the underlying resource. Default=16kb
            highWaterMark: watermark || this.OBJECT_RANGE_ALIGN,
            // encoding String - If specified, then buffers will be decoded to strings
            // using the specified encoding. Default=null
            encoding: null,
            // objectMode Boolean - Whether this stream should behave as a stream of objects.
            // Meaning that stream.read(n) returns a single value
            // instead of a Buffer of size n. Default=false
            objectMode: false,
        });
        let pos = Number(params.start) || 0;
        let end = _.isUndefined(params.end) ? Infinity : Number(params.end);
        // implement the stream's Readable._read() function
        reader._read = requested_size => {
            P.fcall(() => {
                    let requested_end = Math.min(end, pos + requested_size);
                    return this.read_object({
                        bucket: params.bucket,
                        key: params.key,
                        start: pos,
                        end: requested_end,
                    });
                })
                .then(buffer => {
                    if (buffer && buffer.length) {
                        pos += buffer.length;
                        dbg.log1('reader pos', size_utils.human_offset(pos));
                        reader.push(buffer);
                    } else {
                        dbg.log1('reader finished', size_utils.human_offset(pos));
                        reader.push(null);
                    }
                })
                .catch(err => {
                    dbg.error('reader error', err.stack || err);
                    reader.emit('error', err || 'reader error');
                });
        };
        return reader;
    }


    /**
     *
     * READ_OBJECT
     *
     * @param params (Object):
     *   - bucket (String)
     *   - key (String)
     *   - start (Number) - object start offset
     *   - end (Number) - object end offset
     *
     * @return buffer (Promise to Buffer) - a portion of data.
     *      this is mostly likely shorter than requested, and the reader should repeat.
     *      null is returned on empty range or EOF.
     *
     */
    read_object(params) {
        dbg.log1('read_object: range', range_utils.human_range(params));

        if (params.end <= params.start) {
            // empty read range
            return null;
        }

        let pos = params.start;
        let promises = [];

        while (pos < params.end && promises.length < this.READ_RANGE_CONCURRENCY) {
            let range = _.clone(params);
            range.start = pos;
            range.end = Math.min(
                params.end,
                range_utils.align_up(pos + 1, this.OBJECT_RANGE_ALIGN)
            );
            dbg.log2('read_object: submit concurrent range', range_utils.human_range(range));
            promises.push(this._object_range_cache.get_with_cache(range));
            pos = range.end;
        }

        return P.all(promises)
            .then(buffers => Buffer.concat(_.compact(buffers)));
    }


    /**
     *
     * _init_object_range_cache
     *
     */
    _init_object_range_cache() {
        this._object_range_cache = new LRUCache({
            name: 'RangesCache',
            // max_usage: 0,
            max_usage: 128 * 1024 * 1024, // 128 MB
            // item_usage: (data, params) => data ? data.length : 1024,
            expiry_ms: 600000, // 10 minutes
            make_key: params => {
                let start = range_utils.align_down(
                    params.start, this.OBJECT_RANGE_ALIGN);
                let end = start + this.OBJECT_RANGE_ALIGN;
                return params.bucket + '\0' + params.key + '\0' + start + '\0' + end;
            },
            load: params => {
                let range_params = _.clone(params);
                range_params.start = range_utils.align_down(
                    params.start, this.OBJECT_RANGE_ALIGN);
                range_params.end = range_params.start + this.OBJECT_RANGE_ALIGN;
                dbg.log1('RangesCache: load', range_utils.human_range(range_params), params.key);
                return this._read_object_range(range_params);
            },
            make_val: (data, params) => {
                if (!data) {
                    dbg.log3('RangesCache: null', range_utils.human_range(params));
                    return data;
                }
                let start = range_utils.align_down(
                    params.start, this.OBJECT_RANGE_ALIGN);
                let end = start + this.OBJECT_RANGE_ALIGN;
                let inter = range_utils.intersection(
                    start, end, params.start, params.end);
                if (!inter) {
                    dbg.log3('RangesCache: empty', range_utils.human_range(params),
                        'align', range_utils.human_range({
                            start: start,
                            end: end
                        }));
                    return null;
                }
                dbg.log3('RangesCache: slice', range_utils.human_range(params),
                    'inter', range_utils.human_range(inter), 'buffer', data.length);
                return data.slice(inter.start - start, inter.end - start);
            },
        });
    }



    /**
     *
     * _read_object_range
     *
     * @param {Object} params:
     *   - bucket (String)
     *   - key (String)
     *   - start (Number) - object start offset
     *   - end (Number) - object end offset
     *
     * @return {Promise} buffer - the data. can be shorter than requested if EOF.
     *
     */
    _read_object_range(params) {
        let obj_size;

        dbg.log2('_read_object_range:', range_utils.human_range(params));

        // get meta data on object range we want to read
        return this._object_map_cache.get_with_cache(params)
            .then(mappings => {
                obj_size = mappings.size;
                return P.map(mappings.parts, part => this._read_object_part(part));
            })
            .then(parts => {
                // once all parts finish we can construct the complete buffer.
                let end = Math.min(obj_size, params.end);
                return combine_parts_buffers_in_range(parts, params.start, end);
            });
    }


    /**
     *
     * _init_object_map_cache
     *
     */
    _init_object_map_cache() {
        this._object_map_cache = new LRUCache({
            name: 'MappingsCache',
            // max_usage: 0,
            max_usage: 1000,
            expiry_ms: 600000, // 10 minutes
            make_key: params => {
                let start = range_utils.align_down(
                    params.start, this.MAP_RANGE_ALIGN);
                return params.bucket + '\0' + params.key + '\0' + start;
            },
            load: params => {
                let map_params = _.clone(params);
                map_params.start = range_utils.align_down(
                    params.start, this.MAP_RANGE_ALIGN);
                map_params.end = map_params.start + this.MAP_RANGE_ALIGN;
                dbg.log1('MappingsCache: load', range_utils.human_range(params),
                    'aligned', range_utils.human_range(map_params));
                return this.client.object.read_object_mappings(map_params);
            },
            make_val: (val, params) => {
                let mappings = _.clone(val);
                mappings.parts = _.cloneDeep(_.filter(val.parts, part => {
                    let inter = range_utils.intersection(
                        part.start, part.end, params.start, params.end);
                    if (!inter) {
                        dbg.log4('MappingsCache: filtered', range_utils.human_range(params),
                            'part', range_utils.human_range(part));
                        return false;
                    }
                    dbg.log3('MappingsCache: map', range_utils.human_range(params),
                        'part', range_utils.human_range(part));
                    return true;
                }));
                return mappings;
            },
        });
    }



    /**
     * read one part of the object.
     */
    _read_object_part(part) {
        dbg.log1('_read_object_part:', range_utils.human_range(part));
        this.lazy_init_natives();
        // read the data fragments of the chunk
        let frags_by_layer = _.groupBy(part.chunk.frags, 'layer');
        let data_frags = frags_by_layer.D;
        return P.map(data_frags, fragment => this._read_fragment(part, fragment))
            .then(() => {
                let chunk = _.pick(part.chunk, CHUNK_ATTRS);
                chunk.frags = _.map(part.chunk.frags, fragment => {
                    let f = _.pick(fragment, FRAG_ATTRS, 'block');
                    f.layer_n = f.layer_n || 0;
                    return f;
                });
                dbg.log2('_read_object_part: decode chunk', chunk);
                return P.ninvoke(this.object_coding, 'decode',
                        ObjectIO.object_coding_tpool, chunk)
                    .then(decoded_chunk => {
                        part.buffer = decoded_chunk.data;
                        return part;
                    }, err => {
                        dbg.error('_read_object_part: DECODE CHUNK FAILED', err, part);
                        throw err;
                    });
            });
    }

    _read_fragment(part, fragment) {
        let frag_desc = size_utils.human_offset(part.start) + '-' + get_frag_key(fragment);
        dbg.log1('_read_fragment', frag_desc);
        let next_block = 0;
        if (this._verification_mode) {
            // in verification mode we read all the blocks
            // which will also verify their digest
            // and finally we return the first of them.
            return P.map(fragment.blocks,
                    block => this._blocks_cache.get_with_cache(block.block_md))
                .then(buffers => {
                    if (!fragment.blocks.length ||
                        _.compact(buffers).length !== fragment.blocks.length) {
                        dbg.error('_read_fragment: verification EXHAUSTED',
                            frag_desc, fragment.blocks);
                        throw new Error('_read_fragment: verification EXHAUSTED');
                    }
                    fragment.block = buffers[0];
                });
        }
        let finish = buffer => {
            fragment.block = buffer;
        };
        let read_next_block = () => {
            if (next_block >= fragment.blocks.length) {
                dbg.error('_read_fragment: EXHAUSTED', frag_desc, fragment.blocks);
                throw new Error('_read_fragment: EXHAUSTED');
            }
            let block = fragment.blocks[next_block];
            next_block += 1;
            return this._blocks_cache.get_with_cache(block.block_md)
                .then(finish, read_next_block);
        };
        return read_next_block();
    }

    /**
     *
     * _init_blocks_cache
     *
     */
    _init_blocks_cache() {
        this._blocks_cache = new LRUCache({
            name: 'BlocksCache',
            // quite small cache, just to handle repeated calls
            max_usage: this.READ_CONCURRENCY * 1024 * 1024,
            item_usage: (data, params) => data.length,
            expiry_ms: 600000, // 10 minutes
            make_key: block_md => block_md.id,
            load: block_md => {
                dbg.log1('BlocksCache: load', block_md.id);
                return this._read_block(block_md);
            }
        });
    }


    /**
     *
     * _read_block
     *
     * read a block from the storage node
     *
     */
    _read_block(block_md) {
        // use semaphore to surround the IO
        return this._block_read_sem.surround(() => {
            dbg.log1('_read_block:', block_md.id, 'from', block_md.address);
            return this.client.agent.read_block({
                    block_md: block_md
                }, {
                    address: block_md.address,
                    timeout: config.read_block_timeout,
                })
                .then(res => {
                    if (this._verification_mode) {
                        let digest_b64 = crypto.createHash(block_md.digest_type)
                            .update(res.data)
                            .digest('base64');
                        if (digest_b64 !== block_md.digest_b64) {
                            dbg.error('_read_block: FAILED digest verification', block_md);
                            throw new Error('_read_block: FAILED digest verification');
                        }
                    }
                    return res.data;
                })
                .catch(err => {
                    dbg.error('_read_block: FAILED', block_md.id, 'from', block_md.address, err);
                    throw err;
                });
        });
    }



    // HTTP FLOW //////////////////////////////////////////////////////////////////



    /**
     *
     * SERVE_HTTP_STREAM
     *
     * @param req: express request object
     * @param res: express response object
     * @param params (Object):
     *  - bucket (String)
     *  - key (String)
     */
    serve_http_stream(req, res, params, object_md) {
        // range-parser returns:
        //      undefined (no range)
        //      -2 (invalid syntax)
        //      -1 (unsatisfiable)
        //      array (ranges with type)
        let range = req.range(object_md.size);

        // return http 400 Bad Request
        if (range === -2) {
            dbg.log1('+++ serve_http_stream: bad range request',
                req.get('range'), object_md);
            return 400;
        }

        // return http 416 Requested Range Not Satisfiable
        if (range && (
                range === -1 ||
                range.type !== 'bytes' ||
                range.length !== 1)) {
            dbg.warn('+++ serve_http_stream: invalid range',
                range, req.get('range'), object_md);
            // let the client know of the relevant range
            res.setHeader('Content-Range', 'bytes */' + object_md.size);
            return 416;
        }

        let read_stream;
        let read_closer = reason => {
            return () => {
                dbg.log0('+++ serve_http_stream:', reason);
                if (read_stream) {
                    read_stream.pause();
                    read_stream.unpipe(res);
                    read_stream = null;
                }
                if (reason === 'request ended') {
                    dbg.log('res end after req ended');
                    res.status(200).end();
                }
            };
        };

        // on disconnects close the read stream
        req.on('close', read_closer('request closed'));
        req.on('end', read_closer('request ended'));
        res.on('close', read_closer('response closed'));
        res.on('end', read_closer('response ended'));

        if (!range) {
            dbg.log1('+++ serve_http_stream: send all');
            read_stream = this.open_read_stream(params, this.HTTP_PART_ALIGN);
            read_stream.pipe(res);
            return 200;
        }

        // return http 206 Partial Content
        let start = range[0].start;
        let end = range[0].end + 1; // use exclusive end

        // [disabled] truncate a single http request to limited size.
        // the idea was to make the browser fetch the next part of content
        // more quickly and only once it gets to play it, but it actually seems
        // to prevent it from properly keeping a video buffer, so disabled it.
        if (this.HTTP_TRUNCATE_PART_SIZE) {
            if (end > start + this.HTTP_PART_ALIGN) {
                end = start + this.HTTP_PART_ALIGN;
            }
            // snap end to the alignment boundary, to make next requests aligned
            end = range_utils.truncate_range_end_to_boundary(
                start, end, this.HTTP_PART_ALIGN);
        }

        dbg.log1('+++ serve_http_stream: send range',
            range_utils.human_range({
                start: start,
                end: end
            }), range);
        res.setHeader('Content-Range', 'bytes ' + start + '-' + (end - 1) + '/' + object_md.size);
        res.setHeader('Content-Length', end - start);
        // res.header('Cache-Control', 'max-age=0' || 'no-cache');
        read_stream = this.open_read_stream(_.extend({
            start: start,
            end: end,
        }, params), this.HTTP_PART_ALIGN);
        read_stream.pipe(res);

        // when starting to stream also prefrech the last part of the file
        // since some video encodings put a chunk of video metadata in the end
        // and it is often requested once doing a video time seek.
        // see https://trac.ffmpeg.org/wiki/Encode/H.264#faststartforwebvideo
        if (start === 0) {
            dbg.log1('+++ serve_http_stream: prefetch end of file');
            let eof_len = 100;
            this.open_read_stream(_.extend({
                start: object_md.size > eof_len ? (object_md.size - eof_len) : 0,
                end: object_md.size,
            }, params), eof_len).pipe(devnull());
        }

        return 206;
    }
}



// INTERNAL ///////////////////////////////////////////////////////////////////



function combine_parts_buffers_in_range(parts, start, end) {
    if (end <= start) {
        // empty read range
        return null;
    }
    if (!parts || !parts.length) {
        dbg.error('no parts for data', range_utils.human_range({
            start: start,
            end: end
        }));
        throw new Error('no parts for data');
    }
    let pos = start;
    let buffers = _.compact(_.map(parts, function(part) {
        let part_range = range_utils.intersection(part.start, part.end, pos, end);
        if (!part_range) {
            return;
        }
        let buffer_start = part_range.start - part.start;
        let buffer_end = part_range.end - part.start;
        if (part.chunk_offset) {
            buffer_start += part.chunk_offset;
            buffer_end += part.chunk_offset;
        }
        pos = part_range.end;
        return part.buffer.slice(buffer_start, buffer_end);
    }));
    if (pos !== end) {
        dbg.error('missing parts for data',
            range_utils.human_range({
                start: start,
                end: end
            }), 'pos', size_utils.human_offset(pos), parts);
        throw new Error('missing parts for data');
    }
    let len = end - start;
    let buffer = Buffer.concat(buffers, len);
    if (buffer.length !== len) {
        dbg.error('short buffer from parts',
            range_utils.human_range({
                start: start,
                end: end
            }), 'pos', size_utils.human_offset(pos), parts);
        throw new Error('short buffer from parts');
    }
    return buffer;
}

function get_frag_key(f) {
    return f.layer + '-' + f.frag;
}



module.exports = ObjectIO;
