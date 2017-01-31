/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const stream = require('stream');
const crypto = require('crypto');

const P = require('../util/promise');
const dbg = require('../util/debug_module')(__filename);
const config = require('../../config');
const RpcError = require('../rpc/rpc_error');
const Pipeline = require('../util/pipeline');
const LRUCache = require('../util/lru_cache');
const Semaphore = require('../util/semaphore');
const size_utils = require('../util/size_utils');
const time_utils = require('../util/time_utils');
const range_utils = require('../util/range_utils');
const promise_utils = require('../util/promise_utils');
const dedup_options = require("./dedup_options");

// dbg.set_level(5, 'core');

const PART_ATTRS = [
    'start',
    'end',
    'seq',
    'multipart_id',
];
const CHUNK_ATTRS = [
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
const FRAG_ATTRS = [
    'layer',
    'layer_n',
    'frag',
    'digest_type',
    'digest_b64'
];
const CHUNK_DEFAULTS = {
    digest_type: '',
    digest_b64: '',
    cipher_type: '',
    cipher_key_b64: '',
};
const FRAG_DEFAULTS = {
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

    constructor() {
        this._block_write_sem = new Semaphore(config.IO_WRITE_CONCURRENCY);
        this._block_replicate_sem = new Semaphore(config.IO_REPLICATE_CONCURRENCY);
        this._block_read_sem = new Semaphore(config.IO_READ_CONCURRENCY);

        this._init_object_range_cache();

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
            this.native_core = require('../util/native_core')(); // eslint-disable-line global-require
        }
        let nc = this.native_core;
        // these threadpools are global OS threads used to offload heavy CPU work
        // from the node.js thread so that it will keep processing incoming IO while
        // encoding/decoding the object chunks in high performance native code.
        if (!ObjectIO.dedup_chunker_tpool) {
            ObjectIO.dedup_chunker_tpool = new nc.ThreadPool(1);
        }
        if (!ObjectIO.object_coding_tpool) {
            ObjectIO.object_coding_tpool = new nc.ThreadPool(1);
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
     * upload_object
     *
     * upload the entire source_stream as a new object
     *
     */
    upload_object(params) {
        const create_params = _.pick(params,
            'bucket',
            'key',
            'content_type',
            'xattr',
            'overwrite_ifs',
            'size',
            'md5_b64',
            'sha256_b64'
        );
        const complete_params = _.pick(params,
            'bucket',
            'key'
        );

        dbg.log0('upload_object: start upload', complete_params);
        return P.resolve()
            .then(() => params.client.object.create_object_upload(create_params))
            .then(create_reply => {
                params.upload_id = create_reply.upload_id;
                complete_params.upload_id = create_reply.upload_id;
            })
            .then(() => this._upload_stream(params))
            .then(upload_info => _.assign(complete_params, upload_info))
            .then(() => dbg.log0('upload_object: complete upload', complete_params))
            .then(() => params.client.object.complete_object_upload(complete_params))
            .catch(err => {
                dbg.warn('upload_object: failed upload', complete_params, err);
                if (!params.upload_id) throw err;
                return params.client.object.abort_object_upload(_.pick(params, 'bucket', 'key', 'upload_id'))
                    .then(() => {
                        dbg.log0('upload_object: aborted object upload', complete_params);
                        throw err; // still throw to the calling request
                    })
                    .catch(err2 => {
                        dbg.warn('upload_object: Failed to abort object upload', complete_params, err2);
                        throw err; // throw the original error
                    });
            });
    }

    upload_multipart(params) {
        const create_params = _.pick(params,
            'bucket',
            'key',
            'upload_id',
            'num',
            'size',
            'md5_b64',
            'sha256_b64'
        );
        const complete_params = _.pick(params,
            'bucket',
            'key',
            'upload_id',
            'num'
        );

        dbg.log0('upload_multipart: start upload', complete_params);
        return P.resolve()
            .then(() => params.client.object.create_multipart(create_params))
            .then(multipart_reply => {
                params.multipart_id = multipart_reply.multipart_id;
                complete_params.multipart_id = multipart_reply.multipart_id;
            })
            .then(() => this._upload_stream(params))
            .then(upload_info => _.assign(complete_params, upload_info))
            .then(() => dbg.log0('upload_multipart: complete upload', complete_params))
            .then(() => params.client.object.complete_multipart(complete_params))
            .catch(err => {
                dbg.warn('upload_multipart: failed', complete_params, err);
                // we leave the cleanup of failed multiparts to complete_object_upload or abort_object_upload
                throw err;
            });
    }

    /**
     *
     * _upload_stream
     *
     * upload the source_stream parts to object in upload mode
     * by reading large portions from the stream and call _upload_buffers()
     *
     */
    _upload_stream(params) {
        params.desc = `${params.upload_id}${
            params.num ? '[' + params.num + ']' : ''
        }`;
        dbg.log0('UPLOAD:', params.desc, 'streaming to', params.bucket, params.key);

        // start and seq are set to zero even for multiparts and will be fixed
        // when multiparts are combined to object in complete_object_upload
        params.start = 0;
        params.seq = 0;

        this.lazy_init_natives();
        params.source_stream._readableState.highWaterMark = size_utils.MEGABYTE;
        params.dedup_chunker = new this.native_core.DedupChunker({
            tpool: ObjectIO.dedup_chunker_tpool
        }, this.dedup_config);

        const upload_buffers = buffers => this._upload_buffers(params, buffers);
        const md5 = crypto.createHash('md5');
        const sha256 = params.sha256_b64 ? crypto.createHash('sha256') : null;
        const upload_info = {
            size: 0,
            num_parts: 0,
        };

        return new Pipeline()
            .pipe(params.source_stream)
            .pipe(new stream.Transform({
                objectMode: true,
                allowHalfOpen: false,
                highWaterMark: 1,
                transform(buf, encoding, callback) {
                    md5.update(buf);
                    if (sha256) sha256.update(buf);
                    upload_info.size += buf.length;
                    this.bufs = this.bufs || [];
                    this.bufs.push(buf);
                    this.bytes = (this.bytes || 0) + buf.length;
                    if (this.bytes >= config.IO_STREAM_SPLIT_SIZE) {
                        this.push(this.bufs);
                        this.bufs = [];
                        this.bytes = 0;
                    }
                    return callback();
                },
                flush(callback) {
                    upload_info.md5_b64 = md5.digest('base64');
                    if (sha256) upload_info.sha256_b64 = sha256.digest('base64');
                    if (this.bytes) {
                        this.push(this.bufs);
                        this.bufs = null;
                        this.bytes = 0;
                    }
                    return callback();
                }
            }))
            .pipe(new stream.Transform({
                objectMode: true,
                allowHalfOpen: false,
                highWaterMark: 1,
                transform(input_buffers, encoding, callback) {
                    params.dedup_chunker.push(input_buffers, (err, buffers) => {
                        if (err) return this.emit('error', err);
                        if (buffers && buffers.length) this.push(buffers);
                        return callback();
                    });
                },
                flush(callback) {
                    params.dedup_chunker.flush((err, buffers) => {
                        if (err) return this.emit('error', err);
                        if (buffers && buffers.length) this.push(buffers);
                        return callback();
                    });
                }
            }))
            .pipe(new stream.Transform({
                objectMode: true,
                allowHalfOpen: false,
                highWaterMark: 1,
                transform(buffers, encoding, callback) {
                    upload_buffers(buffers)
                        .then(parts => {
                            upload_info.num_parts += parts.length;
                            for (const part of parts) {
                                dbg.log0('UPLOAD:', params.desc,
                                    'streaming at', range_utils.human_range(part),
                                    'took', time_utils.millitook(part.millistamp));
                                dbg.log_progress(part.end / params.size);
                                if (params.progress) params.progress(part);
                            }
                            return callback();
                        })
                        .catch(err => this.emit('error', err));
                },
            }))
            .promise()
            .return(upload_info);
    }


    /**
     *
     * _upload_buffers
     *
     * upload parts to object in upload mode
     * where data is buffer or array of buffers in memory.
     *
     */
    _upload_buffers(params, buffers) {
        return P.resolve()
            .then(() => this._encode_data(params, buffers))
            .then(parts => this._allocate_parts(params, parts))
            .then(parts => this._write_parts(params, parts))
            .then(parts => this._finalize_parts(params, parts));
    }


    /**
     *
     * _encode_data
     *
     */
    _encode_data(params, buffers) {
        const parts = _.map(buffers, buffer => {
            const part = {
                buffer: buffer,
                millistamp: time_utils.millistamp(),
                bucket: params.bucket,
                key: params.key,
                start: params.start,
                end: params.start + buffer.length,
                seq: params.seq,
                desc: params.desc + '-' + size_utils.human_offset(params.start),
            };
            if (params.multipart_id) part.multipart_id = params.multipart_id;
            params.seq += 1;
            params.start += buffer.length;
            return part;
        });
        return P.map(parts, part => {
            dbg.log2('UPLOAD:', part.desc, 'encode part');
            return P.fromCallback(callback => this.object_coding.encode(
                    ObjectIO.object_coding_tpool, part.buffer, callback
                ))
                .then(chunk => {
                    part.chunk = chunk;
                    part.buffer = null;
                    dbg.log0('UPLOAD:', part.desc, 'encode part took',
                        time_utils.millitook(part.millistamp));
                    return part;
                });
        });
    }

    /**
     *
     * _allocate_parts
     *
     */
    _allocate_parts(params, parts) {
        const millistamp = time_utils.millistamp();
        const range = {
            start: parts[0].start,
            end: parts[parts.length - 1].end
        };
        dbg.log2('UPLOAD:', params.desc,
            'allocate parts', range_utils.human_range(range));
        return params.client.object.allocate_object_parts({
                bucket: params.bucket,
                key: params.key,
                upload_id: params.upload_id,
                parts: _.map(parts, part => {
                    const p = _.pick(part, PART_ATTRS);
                    p.chunk = _.pick(part.chunk, CHUNK_ATTRS);
                    _.defaults(p.chunk, CHUNK_DEFAULTS);
                    p.chunk.frags = _.map(part.chunk.frags, fragment => {
                        const f = _.pick(fragment, FRAG_ATTRS);
                        _.defaults(f, FRAG_DEFAULTS);
                        f.size = fragment.block.length;
                        return f;
                    });
                    return p;
                })
            })
            .then(res => {
                dbg.log1('UPLOAD:', params.desc,
                    'allocate parts', range_utils.human_range(range),
                    'took', time_utils.millitook(millistamp));
                _.each(parts, (part, i) => {
                    part.alloc_part = res.parts[i];
                });
                return parts;
            });
    }

    /**
     *
     * _finalize_parts
     *
     */
    _finalize_parts(params, parts) {
        const millistamp = time_utils.millistamp();
        const range = {
            start: parts[0].start,
            end: parts[parts.length - 1].end
        };
        dbg.log2('UPLOAD:', params.desc,
            'finalize parts', range_utils.human_range(range));
        return params.client.object.finalize_object_parts({
                bucket: params.bucket,
                key: params.key,
                upload_id: params.upload_id,
                parts: _.map(parts, 'alloc_part')
            })
            .then(() => {
                dbg.log1('UPLOAD:', params.desc,
                    'finalize parts', range_utils.human_range(range),
                    'took', time_utils.millitook(millistamp));
                return parts;
            });
    }

    /**
     *
     * _write_parts
     *
     */
    _write_parts(params, parts) {
        const millistamp = time_utils.millistamp();
        const range = {
            start: parts[0].start,
            end: parts[parts.length - 1].end
        };
        dbg.log2('UPLOAD:', params.desc,
            'write parts', range_utils.human_range(range));
        return P.map(parts, part => this._write_part(params, part))
            .then(() => {
                dbg.log1('UPLOAD:', params.desc,
                    'write parts', range_utils.human_range(range),
                    'took', time_utils.millitook(millistamp));
                return parts;
            });
    }

    /**
     *
     * write the allocated part fragments to the storage nodes
     *
     */
    _write_part(params, part) {
        if (!part.millistamp) {
            part.millistamp = time_utils.millistamp();
        }
        if (part.alloc_part.chunk_dedup) {
            dbg.log0('UPLOAD:', part.desc, 'CHUNK DEDUP');
            // nullify the chunk in order to release all the buffer's memory
            // while it's waiting in the finalize queue
            part.chunk = null;
            return;
        }

        const data_frags_map = _.keyBy(part.chunk.frags, get_frag_key);
        return P.map(part.alloc_part.chunk.frags, fragment => {
                const frag_key = get_frag_key(fragment);
                const buffer = data_frags_map[frag_key].block;
                const desc = part.desc + '-' + frag_key;
                return this._write_fragment(params, fragment, buffer, desc);
            })
            .catch(err => {

                // handle errors of part write:
                // we only retry reallocating the entire part
                // since the allocate api is hard to be manipulated
                // to add just missing blocks.

                // limit the retries by time since the part began to write
                if (time_utils.millistamp() - part.millistamp > 10000) {
                    dbg.error('UPLOAD:', part.desc,
                        'write part attempts exhausted', err);
                    throw err;
                }

                dbg.warn('UPLOAD:', part.desc,
                    'write part retry part on ERROR', err);
                return this._allocate_parts(params, [part])
                    .then(() => this._write_part(params, part));
            });
    }

    _write_fragment(params, fragment, buffer, desc) {
        const source_block = fragment.blocks[0];
        const blocks_to_replicate = fragment.blocks.slice(1);

        dbg.log1('UPLOAD:', desc,
            'write fragment num blocks', fragment.blocks.length);

        return P.resolve()
            .then(() => this._retry_write_block(
                params, desc, buffer, source_block))
            .then(() => this._retry_replicate_blocks(
                params, desc, source_block, blocks_to_replicate));
    }

    // retry the write operation
    // once retry exhaust we report and throw an error
    _retry_write_block(params, desc, buffer, source_block) {
        return promise_utils.retry(
                config.IO_WRITE_BLOCK_RETRIES,
                config.IO_WRITE_RETRY_DELAY_MS,
                () => this._write_block(
                    params, buffer, source_block.block_md, desc)
            )
            .catch(err => this._report_error_on_object_upload(
                params, source_block.block_md, 'write', err));
    }

    // retry the replicate operations
    // once any retry exhaust we report and throw an error
    _retry_replicate_blocks(params, desc, source_block, blocks_to_replicate) {
        return P.map(blocks_to_replicate,
            b => promise_utils.retry(
                config.IO_REPLICATE_BLOCK_RETRIES,
                config.IO_REPLICATE_RETRY_DELAY_MS,
                () => this._replicate_block(
                    params, source_block.block_md, b.block_md, desc)
            )
            .catch(err => this._report_error_on_object_upload(
                params, b.block_md, 'replicate', err))
        );
    }

    /**
     *
     * write a block to the storage node
     *
     */
    _write_block(params, buffer, block_md, desc) {
        // IO semaphore to limit concurrency
        return this._block_write_sem.surround(() => {

            dbg.log1('UPLOAD:', desc,
                'write block', block_md.id, block_md.address,
                size_utils.human_size(buffer.length));

            this._error_injection_on_write();

            return params.client.block_store.write_block({
                block_md: block_md,
                data: buffer,
            }, {
                address: block_md.address,
                timeout: config.IO_WRITE_BLOCK_TIMEOUT,
            });
        }).catch(err => {
            dbg.warn('UPLOAD:', desc,
                'write block', block_md.id, block_md.address,
                'ERROR', err);
            throw err;
        });
    }


    _replicate_block(params, source_md, target_md, desc) {
        // IO semaphore to limit concurrency
        return this._block_replicate_sem.surround(() => {

            dbg.log1('UPLOAD:', desc,
                'replicate block', source_md.id, source_md.address,
                'to', target_md.id, target_md.address);

            this._error_injection_on_write();

            return params.client.block_store.replicate_block({
                target: target_md,
                source: source_md,
            }, {
                address: target_md.address,
                timeout: config.IO_REPLICATE_BLOCK_TIMEOUT,
            });
        }).catch(err => {
            dbg.warn('UPLOAD:', desc,
                'replicate block', source_md.id, source_md.address,
                'to', target_md.id, target_md.address,
                'ERROR', err);
            throw err;
        });
    }

    _report_error_on_object_upload(params, block_md, action, err) {
        return params.client.object.report_error_on_object({
                action: 'upload',
                bucket: params.bucket,
                key: params.key,
                upload_id: params.upload_id,
                blocks_report: [{
                    block_md: block_md,
                    action: action,
                    rpc_code: err.rpc_code || '',
                    error_message: err.message || '',
                }]
            })
            .catch(reporting_err => {
                // reporting failed, we don't have much to do with it now
                // so will drop it, and wait for next failure to retry reporting
                dbg.warn('_report_error_on_object_upload:',
                    'will throw original upload error',
                    'and ignore this reporting error -', reporting_err);
            })
            .finally(() => {
                // throw the original read error, for the convinience of the caller
                throw err;
            });
    }

    _error_injection_on_write() {
        if (process.env.ERROR_INJECTON_ON_WRITE &&
            process.env.ERROR_INJECTON_ON_WRITE > Math.random()) {
            throw new RpcError('ERROR_INJECTON_ON_WRITE');
        }
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
            const buffers = [];
            this.open_read_stream(params)
                .on('data', buffer => {
                    dbg.log0('read data', buffer.length);
                    buffers.push(buffer);
                })
                .once('end', () => {
                    const read_buf = Buffer.concat(buffers);
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
        const reader = new stream.Readable({
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
        let pos = Number(params.start) || 0;
        const end = _.isUndefined(params.end) ? Infinity : Number(params.end);
        // implement the stream's Readable._read() function
        reader._read = requested_size => {
            P.fcall(() => {
                    let requested_end = Math.min(end, pos + requested_size);
                    return this.read_object({
                        client: params.client,
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
     *   - client - rpc client with auth info if needed
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
        const promises = [];

        while (pos < params.end && promises.length < config.IO_READ_RANGE_CONCURRENCY) {
            let range = _.clone(params);
            range.start = pos;
            range.end = Math.min(
                params.end,
                range_utils.align_up(pos + 1, config.IO_OBJECT_RANGE_ALIGN)
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
            max_usage: 256 * 1024 * 1024, // 128 MB
            item_usage: (data, params) => (data && data.buffer && data.buffer.length) || 1024,
            make_key: params => {
                let start = range_utils.align_down(
                    params.start, config.IO_OBJECT_RANGE_ALIGN);
                let end = start + config.IO_OBJECT_RANGE_ALIGN;
                return params.bucket + '\0' + params.key + '\0' + start + '\0' + end;
            },
            load: params => {
                let range_params = _.clone(params);
                range_params.start = range_utils.align_down(
                    params.start, config.IO_OBJECT_RANGE_ALIGN);
                range_params.end = range_params.start + config.IO_OBJECT_RANGE_ALIGN;
                dbg.log1('RangesCache: load', range_utils.human_range(range_params), params.key);
                return this._read_object_range(range_params);
            },
            validate: (data, params) => params.client.object.read_object_md({
                    bucket: params.bucket,
                    key: params.key
                })
                .then(object_md => {
                    let validated = object_md.version_id === data.object_md.version_id &&
                        object_md.etag === data.object_md.etag &&
                        object_md.size === data.object_md.size &&
                        object_md.create_time === data.object_md.create_time;
                    if (!validated) {
                        dbg.log0('RangesCache: ValidateFailed:', params.bucket, params.key);
                    }
                    return validated;
                }),
            make_val: (data, params) => {
                let buffer = data.buffer;
                if (!buffer) {
                    dbg.log3('RangesCache: null', range_utils.human_range(params));
                    return buffer;
                }
                let start = range_utils.align_down(
                    params.start, config.IO_OBJECT_RANGE_ALIGN);
                let end = start + config.IO_OBJECT_RANGE_ALIGN;
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
                    'inter', range_utils.human_range(inter), 'buffer', buffer.length);
                return buffer.slice(inter.start - start, inter.end - start);
            },
        });
    }



    /**
     *
     * _read_object_range
     *
     * @return {Promise} buffer - the data. can be shorter than requested if EOF.
     *
     */
    _read_object_range(params) {
        let mappings;

        dbg.log2('_read_object_range:', range_utils.human_range(params));

        // get meta data on object range we want to read
        let map_params = _.omit(params, 'client');
        return params.client.object.read_object_mappings(map_params)
            .then(mappings_arg => {
                mappings = mappings_arg;
                return P.map(mappings.parts, part => this._read_object_part(params, part));
            })
            .then(parts => {
                // once all parts finish we can construct the complete buffer.
                let size = mappings.object_md.size || mappings.object_md.upload_size || 0;
                let end = Math.min(size, params.end);
                return {
                    object_md: mappings.object_md,
                    buffer: combine_parts_buffers_in_range(parts, params.start, end)
                };
            });
    }


    /**
     * read one part of the object.
     */
    _read_object_part(params, part) {
        dbg.log1('_read_object_part:', range_utils.human_range(part));
        this.lazy_init_natives();
        // read the data fragments of the chunk
        let frags_by_layer = _.groupBy(part.chunk.frags, 'layer');
        let data_frags = frags_by_layer.D;
        return P.map(data_frags, fragment => this._read_fragment(params, part, fragment))
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

    _read_fragment(params, part, fragment) {
        const frag_desc = size_utils.human_offset(part.start) + '-' + get_frag_key(fragment);
        dbg.log1('_read_fragment', frag_desc);
        const blocks_results = [];
        blocks_results.length = fragment.blocks.length;
        if (this._verification_mode) {
            // in verification mode we read all the blocks
            // which will also verify their digest
            // and finally we return the first of them.
            let first_block_md = fragment.blocks[0].block_md;
            return P.map(fragment.blocks, block => P.resolve()
                    .then(() => {
                        if (block.block_md.digest_type !== first_block_md.digest_type ||
                            block.block_md.digest_b64 !== first_block_md.digest_b64) {
                            throw new Error('_read_fragment: inconsistent replica digests');
                        }
                    })
                    .then(() => this._read_block(params, block.block_md))
                    .catch(err => this._report_error_on_object_read(
                        params, part, block.block_md, err))
                )
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
        const read_next_block = index => {
            if (index >= fragment.blocks.length) {
                dbg.error('_read_fragment: EXHAUSTED', frag_desc, fragment.blocks);
                throw new Error('_read_fragment: EXHAUSTED');
            }
            const block = fragment.blocks[index];
            return this._read_block(params, block.block_md)
                .then(buffer => {
                    fragment.block = buffer;
                })
                .catch(err => this._report_error_on_object_read(
                    params, part, block.block_md, err))
                .catch(err => read_next_block(index + 1));
        };
        return read_next_block(0);
    }

    /**
     *
     * _read_block
     *
     * read a block from the storage node
     *
     */
    _read_block(params, block_md) {
        // use semaphore to surround the IO
        return this._block_read_sem.surround(() => {

                dbg.log1('_read_block:', block_md.id, 'from', block_md.address);

                this._error_injection_on_read();

                return params.client.block_store.read_block({
                    block_md: block_md
                }, {
                    address: block_md.address,
                    timeout: config.IO_READ_BLOCK_TIMEOUT,
                    auth_token: null // ignore the client options when talking to agents
                });
            })
            .then(res => {
                if (this._verification_mode) {
                    let digest_b64 = crypto.createHash(block_md.digest_type)
                        .update(res.data)
                        .digest('base64');
                    if (digest_b64 !== block_md.digest_b64) {
                        throw new RpcError('TAMPERING',
                            'Block digest varification failed ' + block_md.id);
                    }
                }
                return res.data;
            })
            .catch(err => {
                dbg.error('_read_block: FAILED', block_md.id, 'from', block_md.address, err);
                throw err;
            });
    }

    _report_error_on_object_read(params, part, block_md, err) {
        return params.client.object.report_error_on_object({
                action: 'read',
                bucket: params.bucket,
                key: params.key,
                start: part.start,
                end: part.end,
                blocks_report: [{
                    block_md: block_md,
                    action: 'read',
                    rpc_code: err.rpc_code || '',
                    error_message: err.message || '',
                }]
            })
            .catch(reporting_err => {
                // reporting failed, we don't have much to do with it now
                // so will drop it, and wait for next failure to retry reporting
                dbg.warn('report_error_on_object_read:',
                    'will throw original upload error',
                    'and ignore this reporting error -', reporting_err);
            })
            .finally(() => {
                // throw the original read error, for the convinience of the caller
                throw err;
            });
    }

    _error_injection_on_read() {
        if (process.env.ERROR_INJECTON_ON_READ &&
            process.env.ERROR_INJECTON_ON_READ > Math.random()) {
            throw new RpcError('ERROR_INJECTON_ON_READ');
        }
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
        let read_closer = reason => (
            () => {
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
            }
        );

        // on disconnects close the read stream
        req.on('close', read_closer('request closed'));
        req.on('end', read_closer('request ended'));
        res.on('close', read_closer('response closed'));
        res.on('end', read_closer('response ended'));

        if (!range) {
            dbg.log1('+++ serve_http_stream: send all');
            read_stream = this.open_read_stream(params, config.IO_HTTP_PART_ALIGN);
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
            if (end > start + config.IO_HTTP_PART_ALIGN) {
                end = start + config.IO_HTTP_PART_ALIGN;
            }
            // snap end to the alignment boundary, to make next requests aligned
            end = range_utils.truncate_range_end_to_boundary(
                start, end, config.IO_HTTP_PART_ALIGN);
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
        }, params), config.IO_HTTP_PART_ALIGN);
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
                }, params), eof_len)
                .pipe(new stream.Writable({
                    // a writable sink that ignores the data
                    // just to pump the data through the cache
                    write: function(chunk, encoding, next) {
                        next();
                    }
                }));
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
    return f.layer + f.frag;
}



module.exports = ObjectIO;
