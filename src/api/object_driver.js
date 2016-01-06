// module targets: nodejs & browserify
'use strict';

var util = require('util');
var Readable = require('stream').Readable;
var _ = require('lodash');
var P = require('../util/promise');
var Semaphore = require('../util/semaphore');
var transformer = require('../util/transformer');
var Pipeline = require('../util/pipeline');
var CoalesceStream = require('../util/coalesce_stream');
var range_utils = require('../util/range_utils');
var size_utils = require('../util/size_utils');
var time_utils = require('../util/time_utils');
var LRUCache = require('../util/lru_cache');
var devnull = require('dev-null');
var config = require('../../config.js');
var dbg = require('../util/debug_module')(__filename);
var native_core = require('../util/native_core');
var dedup_options = require("./dedup_options");

module.exports = ObjectDriver;



/**
 *
 * OBJECT DRIVER
 *
 * the object driver is a "heavy" object with data caches.
 *
 * extends object_api which is plain REST api with logic to provide access
 * to remote object storage, and does the necessary distributed of io.
 * the client functions usually have the signature function(params), and return a promise.
 *
 * this is the client side (web currently) that sends the commands
 * defined in object_api to the web server.
 *
 */
function ObjectDriver(client) {
    var self = this;

    self.client = client;

    // some constants that might be provided as options to the client one day

    self.OBJECT_RANGE_ALIGN = 512 * 1024;
    self.MAP_RANGE_ALIGN = 16 * 1024 * 1024;

    self.READ_CONCURRENCY = config.READ_CONCURRENCY;
    self.WRITE_CONCURRENCY = config.WRITE_CONCURRENCY;

    self.READ_RANGE_CONCURRENCY = config.READ_RANGE_CONCURRENCY;

    self.HTTP_PART_ALIGN = 32 * 1024 * 1024;
    self.HTTP_TRUNCATE_PART_SIZE = false;

    self._block_write_sem = new Semaphore(self.WRITE_CONCURRENCY);
    self._block_read_sem = new Semaphore(self.READ_CONCURRENCY);
    self._finalize_sem = new Semaphore(config.REPLICATE_CONCURRENCY);

    self._init_object_md_cache();
    self._init_object_range_cache();
    self._init_object_map_cache();
    self._init_blocks_cache();
}

var object_coding_default_options = {
    digest_type: 'sha384',
    compress_type: 'snappy',
    cipher_type: 'aes-256-gcm',
    frag_digest_type: 'sha1',
    data_frags: 1,
    parity_frags: 0,
    lrc_frags: 0,
    lrc_parity: 0,
};
var PART_ATTRS = [
    'start',
    'end',
    'upload_part_number',
    'part_sequence_number'
];
var CHUNK_ATTRS = [
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
var FRAG_ATTRS = [
    'layer',
    'layer_n',
    'frag',
    'digest_type',
    'digest_b64'
];

var natives_inited;
var DedupChunker;
var dedup_config;
var dedup_chunker_tpool;
var object_coding_tpool;
var object_coding;

function lazy_init_natives() {
    if (natives_inited) return;
    var nc = native_core();
    DedupChunker = nc.DedupChunker;
    dedup_config = new nc.DedupConfig(dedup_options);
    // these threadpools are global OS threads used to offload heavy CPU work
    // from the node.js thread so that it will keep processing incoming IO while
    // encoding/decoding the object chunks in high performance native code.
    dedup_chunker_tpool = new nc.ThreadPool(1);
    object_coding_tpool = new nc.ThreadPool(2);
    object_coding = new nc.ObjectCoding(object_coding_default_options);
    natives_inited = true;
}



// WRITE FLOW /////////////////////////////////////////////////////////////////


/**
 *
 * UPLOAD_STREAM
 *
 */
ObjectDriver.prototype.upload_stream = function(params) {
    var self = this;
    var create_params = _.pick(params, 'bucket', 'key', 'size', 'content_type', 'add_suffix');
    var bucket_key_params = _.pick(params, 'bucket', 'key');

    dbg.log0('upload_stream: start upload', params.key);
    return self.client.object.create_multipart_upload(create_params)
        .then(function(res) {
            if (res.used_key) { //add_suffix was sent and a suffix was added
                params.key = res.used_key;
                bucket_key_params.key = res.used_key;
            }
            return self.upload_stream_parts(params);
        })
        .then(function() {
            dbg.log0('upload_stream: complete upload', params.key);
            return self.client.object.complete_multipart_upload(bucket_key_params);
        }, function(err) {
            dbg.log0('upload_stream: error write stream', params.key, err);
            throw err;
        });
};

/**
 *
 * UPLOAD_STREAM_PART
 *
 */
ObjectDriver.prototype.upload_stream_parts = function(params) {
    var self = this;
    var start = params.start || 0;
    var upload_part_number = params.upload_part_number || 0;
    var part_sequence_number = params.part_sequence_number || 0;
    lazy_init_natives();

    dbg.log0('upload_stream: start', params.key, 'part number', upload_part_number,
        'sequence number', part_sequence_number);
    return P.fcall(function() {
        params.source_stream._readableState.highWaterMark = 1024 * 1024;
        var pipeline = new Pipeline(params.source_stream);

        //////////////////////////////
        // PIPELINE: dedup chunking //
        //////////////////////////////

        pipeline.pipe(transformer({
            options: {
                highWaterMark: 4,
                objectMode: true
            },
            init: function() {
                this.offset = start;
                this.chunker = new DedupChunker({
                    tpool: dedup_chunker_tpool
                }, dedup_config);
            },
            transform: function(data) {
                dbg.log1('upload_stream_parts: chunking', size_utils.human_offset(this.offset));
                this.offset += data.length;
                return P.ninvoke(this.chunker, 'push', data);
            },
            flush: function() {
                return P.ninvoke(this.chunker, 'flush');
            }
        }));

        ///////////////////////////////
        // PIPELINE: object encoding //
        ///////////////////////////////

        pipeline.pipe(transformer({
            options: {
                highWaterMark: 4,
                flatten: true,
                objectMode: true
            },
            init: function() {
                this.offset = start;
            },
            transform_parallel: function(data) {
                var part = {
                    millistamp: time_utils.millistamp(),
                    bucket: params.bucket,
                    key: params.key,
                    start: this.offset,
                    end: this.offset + data.length,
                    upload_part_number: upload_part_number,
                    part_sequence_number: part_sequence_number,
                };
                part_sequence_number += 1;
                this.offset += data.length;
                dbg.log1('upload_stream_parts: encode', range_utils.human_range(part));
                return P.ninvoke(object_coding, 'encode', object_coding_tpool, data)
                    .then(function(chunk) {
                        part.chunk = chunk;
                        dbg.log0('upload_stream_parts: encode', range_utils.human_range(part),
                            'took', time_utils.millitook(part.millistamp));
                        return part;
                    });
            },
        }));

        //////////////////////////////////////
        // PIPELINE: allocate part mappings //
        //////////////////////////////////////

        pipeline.pipe(new CoalesceStream({
            highWaterMark: 4,
            max_length: 20,
            max_wait_ms: 100,
            objectMode: true
        }));

        pipeline.pipe(transformer({
            options: {
                highWaterMark: 4,
                objectMode: true
            },
            transform_parallel: function(parts) {
                var millistamp = time_utils.millistamp();
                var range = {
                    start: parts[0].start,
                    end: parts[parts.length - 1].end
                };
                dbg.log0('upload_stream_parts: allocate', range_utils.human_range(range));
                // send parts to server
                return self.client.object.allocate_object_parts({
                        bucket: params.bucket,
                        key: params.key,
                        parts: _.map(parts, function(part) {
                            var p = _.pick(part, PART_ATTRS);
                            p.chunk = _.pick(part.chunk, CHUNK_ATTRS);
                            p.frags = _.map(part.chunk.frags, function(fragment) {
                                var f = _.pick(fragment, FRAG_ATTRS);
                                f.size = fragment.block.length;
                                return f;
                            });
                            dbg.log3('upload_stream_parts: allocating specific part ul#',
                                p.upload_part_number, 'seq#', p.part_sequence_number);
                            return p;
                        })
                    })
                    .then(function(res) {
                        _.each(parts, function(part, i) {
                            part.dedup = res.parts[i].dedup;
                            part.alloc_part = res.parts[i].part;
                        });
                        dbg.log0('upload_stream_parts: allocate', range_utils.human_range(range),
                            'took', time_utils.millitook(millistamp));
                        return parts;
                    });
            }
        }));

        /////////////////////////////////
        // PIPELINE: write part blocks //
        /////////////////////////////////

        pipeline.pipe(transformer({
            options: {
                highWaterMark: 20,
                flatten: true,
                objectMode: true,
            },
            transform_parallel: function(part) {
                var millistamp = time_utils.millistamp();
                dbg.log1('upload_stream_parts: write', range_utils.human_range(part));
                return P.when(self._write_fragments(part))
                    .then(function() {
                        dbg.log0('upload_stream_parts: write', range_utils.human_range(part),
                            'took', time_utils.millitook(millistamp));
                        return part;
                    });
            }
        }));

        /////////////////////////////
        // PIPELINE: finalize part //
        /////////////////////////////

        pipeline.pipe(new CoalesceStream({
            highWaterMark: 4,
            max_length: 10,
            max_wait_ms: 100,
            objectMode: true
        }));

        pipeline.pipe(transformer({
            options: {
                highWaterMark: 4,
                objectMode: true
            },
            transform_parallel: function(parts) {
                var millistamp = time_utils.millistamp();
                var range = {
                    start: parts[0].start,
                    end: parts[parts.length - 1].end
                };
                dbg.log1('upload_stream_parts: finalize', range_utils.human_range(range));
                // send parts to server
                return self._finalize_sem.surround(function() {
                        return self.client.object.finalize_object_parts({
                            bucket: params.bucket,
                            key: params.key,
                            parts: _.map(parts, function(part) {
                                var p = _.pick(part, PART_ATTRS);
                                if (!part.dedup) {
                                    p.block_ids = _.flatten(_.map(part.alloc_part.frags, function(fragment) {
                                        return _.map(fragment.blocks, function(block) {
                                            return block.block_md.id;
                                        });
                                    }));
                                }
                                return p;
                            })
                        });
                    })
                    .then(function() {
                        dbg.log0('upload_stream_parts: finalize', range_utils.human_range(range),
                            'took', time_utils.millitook(millistamp));
                        return parts;
                    });
            }
        }));

        //////////////////////////////////////////
        // PIPELINE: resolve, reject and notify //
        //////////////////////////////////////////

        pipeline.pipe(transformer({
            options: {
                highWaterMark: 4,
                flatten: true,
                objectMode: true
            },
            transform: function(part) {
                dbg.log1('upload_stream_parts: completed', range_utils.human_range(part),
                    'took', time_utils.millitook(part.millistamp));
                dbg.log_progress(part.end / params.size);
                if (params.progress) {
                    params.progress(part);
                }
            }
        }));

        return pipeline.run();
    });
};



/**
 *
 * _write_fragments
 *
 */
ObjectDriver.prototype._write_fragments = function(part) {
    var self = this;
    if (part.dedup) {
        dbg.log0('_write_fragments: DEDUP', range_utils.human_range(part));
        return;
    }

    var frags_map = _.indexBy(part.chunk.frags, get_frag_key);
    dbg.log1('_write_fragments: part', part, part.alloc_part.frags[0].blocks);

    return P.map(part.alloc_part.frags, function(fragment) {
        var frag_key = get_frag_key(fragment);
        return P.map(fragment.blocks, function(block) {
            return self._attempt_write_block({
                part: part,
                block: block,
                buffer: frags_map[frag_key].block,
                frag_desc: size_utils.human_offset(part.start) + '-' + frag_key,
                remaining_attempts: 20,
            });
        });
    });
};



/**
 *
 * _write_block
 *
 * write a block to the storage node
 *
 */
ObjectDriver.prototype._attempt_write_block = function(params) {
    var self = this;
    var part = params.part;
    var block = params.block;
    var frag_desc = params.frag_desc;
    dbg.log0('_attempt_write_block:', params.block);
    return self._write_block(block.block_md, params.buffer, frag_desc)
        .then(null, function( /*err*/ ) {
            if (params.remaining_attempts <= 0) {
                throw new Error('EXHAUSTED WRITE BLOCK', frag_desc);
            }
            params.remaining_attempts -= 1;
            var bad_block_params = _.extend(
                _.pick(part, 'bucket', 'key', PART_ATTRS), {
                    block_id: block.block_md.id,
                    is_write: true,
                });
            dbg.warn('_attempt_write_block: write failed, report_bad_block.',
                'remaining attempts', params.remaining_attempts, frag_desc, bad_block_params);
            return self.client.object.report_bad_block(bad_block_params)
                .then(function(res) {
                    dbg.log2('write block _attempt_write_block retry with', res.new_block);
                    // NOTE: we update the block itself in the part so
                    // that finalize will see this update as well.
                    block.block_md = res.new_block;
                    return self._attempt_write_block(params);
                });
        });
};

/**
 *
 * _write_block
 *
 * write a block to the storage node
 *
 */
ObjectDriver.prototype._write_block = function(block_md, buffer, desc) {
    var self = this;

    // use semaphore to surround the IO
    return self._block_write_sem.surround(function() {

        dbg.log0('write_block', desc,
            size_utils.human_size(buffer.length), block_md.id,
            'to', block_md.address, 'block:', block_md);

        if (process.env.WRITE_BLOCK_ERROR_INJECTON &&
            process.env.WRITE_BLOCK_ERROR_INJECTON > Math.random()) {
            throw new Error('WRITE_BLOCK_ERROR_INJECTON');
        }

        return self.client.agent.write_block({
            block_md: block_md,
            data: buffer,
        }, {
            address: block_md.address,
            timeout: config.write_block_timeout,
        }).then(null, function(err) {
            console.error('FAILED write_block', desc,
                size_utils.human_size(buffer.length), block_md.id,
                'from', block_md.address);
            throw err;
        });

    });
};




// METADATA FLOW //////////////////////////////////////////////////////////////



/**
 *
 * GET_OBJECT_MD
 *
 * alternative to the default REST api read_object_md to use an MD cache.
 *
 * @param params (Object):
 *   - bucket (String)
 *   - key (String)
 * @param cache_miss (String): pass 'cache_miss' to force read
 */
ObjectDriver.prototype.get_object_md = function(params, cache_miss) {
    return this._object_md_cache.get(params, cache_miss);
};


/**
 *
 * _init_object_md_cache
 *
 */
ObjectDriver.prototype._init_object_md_cache = function() {
    var self = this;
    self._object_md_cache = new LRUCache({
        name: 'MDCache',
        max_length: 1000,
        expiry_ms: 60000, // 1 minute
        make_key: function(params) {
            return params.bucket + ':' + params.key;
        },
        load: function(params) {
            dbg.log1('MDCache: load', params.key, 'bucket', params.bucket);
            return self.client.object.read_object_md(params);
        }
    });
};




// READ FLOW //////////////////////////////////////////////////////////////////



/**
 *
 * OPEN_READ_STREAM
 *
 * returns a readable stream to the object.
 * see ObjectReader.
 *
 */
ObjectDriver.prototype.read_entire_object = function(params) {
    var self = this;
    return new P(function(resolve, reject) {
        var buffers = [];
        self.open_read_stream(params)
            .on('data', function(buffer) {
                console.log('read data', buffer.length);
                buffers.push(buffer);
            })
            .once('end', function() {
                var read_buf = Buffer.concat(buffers);
                console.log('read end', read_buf.length);
                resolve(read_buf);
            })
            .once('error', function(err) {
                console.log('read error', err);
                reject(err);
            });
    });
};



/**
 *
 * OPEN_READ_STREAM
 *
 * returns a readable stream to the object.
 * see ObjectReader.
 *
 */
ObjectDriver.prototype.open_read_stream = function(params, watermark) {
    return new ObjectReader(this, params, watermark || this.OBJECT_RANGE_ALIGN);
};


/**
 *
 * ObjectReader
 *
 * a Readable stream for the specified object and range.
 * params is also used for stream.Readable highWaterMark
 *
 */
function ObjectReader(client, params, watermark) {
    var self = this;
    Readable.call(self, {
        // highWaterMark Number - The maximum number of bytes to store
        // in the internal buffer before ceasing to read
        // from the underlying resource. Default=16kb
        highWaterMark: watermark,
        // encoding String - If specified, then buffers will be decoded to strings
        // using the specified encoding. Default=null
        encoding: null,
        // objectMode Boolean - Whether this stream should behave as a stream of objects.
        // Meaning that stream.read(n) returns a single value
        // instead of a Buffer of size n. Default=false
        objectMode: false,
    });
    self._client = client;
    self._bucket = params.bucket;
    self._key = params.key;
    self._pos = Number(params.start) || 0;
    self._end = typeof(params.end) === 'undefined' ? Infinity : Number(params.end);
}

// proper inheritance
util.inherits(ObjectReader, Readable);


/**
 * close the reader and stop returning anymore data
 */
ObjectReader.prototype.close = function() {
    this._closed = true;
    this.unpipe();
    this.emit('close');
};


/**
 * implement the stream's Readable._read() function.
 */
ObjectReader.prototype._read = function(requested_size) {
    var self = this;
    if (self._closed) {
        console.error('reader closed');
        return;
    }
    P.fcall(function() {
            var end = Math.min(self._end, self._pos + requested_size);
            return self._client.read_object({
                bucket: self._bucket,
                key: self._key,
                start: self._pos,
                end: end,
            });
        })
        .then(function(buffer) {
            if (buffer && buffer.length) {
                self._pos += buffer.length;
                dbg.log0('reader pos', size_utils.human_offset(self._pos));
                self.push(buffer);
            } else {
                dbg.log0('reader finished', size_utils.human_offset(self._pos));
                self.push(null);
            }
        }, function(err) {
            console.error('reader error ' + err.stack);
            self.emit('error', err || 'reader error');
        });
};


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
ObjectDriver.prototype.read_object = function(params) {
    var self = this;

    dbg.log1('read_object: range', range_utils.human_range(params));

    if (params.end <= params.start) {
        // empty read range
        return null;
    }

    var pos = params.start;
    var promises = [];

    while (pos < params.end && promises.length < self.READ_RANGE_CONCURRENCY) {
        var range = _.clone(params);
        range.start = pos;
        range.end = Math.min(
            params.end,
            range_utils.align_up(pos + 1, self.OBJECT_RANGE_ALIGN)
        );
        dbg.log2('read_object: submit concurrent range', range_utils.human_range(range));
        promises.push(self._object_range_cache.get(range));
        pos = range.end;
    }

    return P.all(promises).then(function(buffers) {
        return Buffer.concat(_.compact(buffers));
    });
};


/**
 *
 * _init_object_range_cache
 *
 */
ObjectDriver.prototype._init_object_range_cache = function() {
    var self = this;
    self._object_range_cache = new LRUCache({
        name: 'RangesCache',
        max_length: 128, // total 128 MB
        expiry_ms: 600000, // 10 minutes
        make_key: function(params) {
            var start = range_utils.align_down(
                params.start, self.OBJECT_RANGE_ALIGN);
            var end = start + self.OBJECT_RANGE_ALIGN;
            return params.bucket + ':' + params.key + ':' + start + ':' + end;
        },
        load: function(params) {
            var range_params = _.clone(params);
            range_params.start = range_utils.align_down(
                params.start, self.OBJECT_RANGE_ALIGN);
            range_params.end = range_params.start + self.OBJECT_RANGE_ALIGN;
            dbg.log0('RangesCache: load', range_utils.human_range(range_params), params.key);
            return self._read_object_range(range_params);
        },
        make_val: function(val, params) {
            if (!val) {
                dbg.log3('RangesCache: null', range_utils.human_range(params));
                return val;
            }
            var start = range_utils.align_down(
                params.start, self.OBJECT_RANGE_ALIGN);
            var end = start + self.OBJECT_RANGE_ALIGN;
            var inter = range_utils.intersection(
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
                'inter', range_utils.human_range(inter), 'buffer', val.length);
            return val.slice(inter.start - start, inter.end - start);
        },
    });
};



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
ObjectDriver.prototype._read_object_range = function(params) {
    var self = this;
    var obj_size;

    dbg.log2('_read_object_range:', range_utils.human_range(params));

    return self._object_map_cache.get(params) // get meta data on object range we want to read
        .then(function(mappings) {
            obj_size = mappings.size;
            return P.map(mappings.parts, function(part) {
                return self._read_object_part(part);
            });
        })
        .then(function(parts) {
            // once all parts finish we can construct the complete buffer.
            var end = Math.min(obj_size, params.end);
            return combine_parts_buffers_in_range(parts, params.start, end);
        });
};


/**
 *
 * _init_object_map_cache
 *
 */
ObjectDriver.prototype._init_object_map_cache = function() {
    var self = this;
    self._object_map_cache = new LRUCache({
        name: 'MappingsCache',
        max_length: 1000,
        expiry_ms: 600000, // 10 minutes
        make_key: function(params) {
            var start = range_utils.align_down(
                params.start, self.MAP_RANGE_ALIGN);
            return params.bucket + ':' + params.key + ':' + start;
        },
        load: function(params) {
            var map_params = _.clone(params);
            map_params.start = range_utils.align_down(
                params.start, self.MAP_RANGE_ALIGN);
            map_params.end = map_params.start + self.MAP_RANGE_ALIGN;
            dbg.log1('MappingsCache: load', range_utils.human_range(params),
                'aligned', range_utils.human_range(map_params));
            return self.client.object.read_object_mappings(map_params);
        },
        make_val: function(val, params) {
            var mappings = _.clone(val);
            mappings.parts = _.cloneDeep(_.filter(val.parts, function(part) {
                var inter = range_utils.intersection(
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

};



/**
 * read one part of the object.
 */
ObjectDriver.prototype._read_object_part = function(part) {
    var self = this;
    dbg.log0('_read_object_part:', range_utils.human_range(part));
    lazy_init_natives();
    // read the data fragments of the chunk
    var frags_by_layer = _.groupBy(part.frags, 'layer');
    var data_frags = frags_by_layer.D;
    return P.map(data_frags, function(fragment) {
            return self._read_fragment(part, fragment);
        })
        .then(function() {
            var chunk = _.pick(part.chunk, CHUNK_ATTRS);
            chunk.frags = _.map(part.frags, function(fragment) {
                var f = _.pick(fragment, FRAG_ATTRS, 'block');
                f.layer_n = f.layer_n || 0;
                return f;
            });
            dbg.log2('_read_object_part: decode chunk', chunk);
            return P.ninvoke(object_coding, 'decode', object_coding_tpool, chunk)
                .then(function(decoded_chunk) {
                    part.buffer = decoded_chunk.data;
                    return part;
                }, function(err) {
                    dbg.error('_read_object_part: DECODE CHUNK FAILED', err, part);
                    throw err;
                });
        });
};

ObjectDriver.prototype._read_fragment = function(part, fragment) {
    var self = this;
    var frag_desc = size_utils.human_offset(part.start) + '-' + get_frag_key(fragment);
    dbg.log0('_read_fragment', frag_desc);
    var next_block = 0;
    return read_next_block();

    function read_next_block() {
        if (next_block >= fragment.blocks.length) {
            dbg.error('_read_fragment: EXHAUSTED', frag_desc, fragment.blocks);
            throw new Error('_read_fragment: EXHAUSTED');
        }
        var block = fragment.blocks[next_block];
        next_block += 1;
        return self._blocks_cache.get(block.block_md)
            .then(finish, read_next_block);
    }

    function finish(buffer) {
        fragment.block = buffer;
    }
};

/**
 *
 * _init_blocks_cache
 *
 */
ObjectDriver.prototype._init_blocks_cache = function() {
    var self = this;
    self._blocks_cache = new LRUCache({
        name: 'BlocksCache',
        max_length: self.READ_CONCURRENCY, // very small, just to handle repeated calls
        expiry_ms: 600000, // 10 minutes
        make_key: function(block_md) {
            return block_md.id;
        },
        load: function(block_md) {
            dbg.log1('BlocksCache: load', block_md.id);
            return self._read_block(block_md);
        }
    });

};


/**
 *
 * _read_block
 *
 * read a block from the storage node
 *
 */
ObjectDriver.prototype._read_block = function(block_md) {
    var self = this;
    // use semaphore to surround the IO
    return self._block_read_sem.surround(function() {
        dbg.log0('_read_block:', block_md.id, 'from', block_md.address);
        return self.client.agent.read_block({
                block_md: block_md
            }, {
                address: block_md.address,
                timeout: config.read_block_timeout,
            })
            .then(function(res) {
                return res.data;
            }, function(err) {
                dbg.error('_read_block: FAILED', block_md.id, 'from', block_md.address);
                throw err;
            });
    });
};



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
ObjectDriver.prototype.serve_http_stream = function(req, res, params) {
    var self = this;
    var read_stream;

    // on disconnects close the read stream
    req.on('close', read_closer('request closed'));
    req.on('end', read_closer('request ended'));
    res.on('close', read_closer('response closed'));
    res.on('end', read_closer('response ended'));

    function read_closer(reason) {
        return function() {
            console.log('+++ serve_http_stream:', reason);
            if (read_stream) {
                read_stream.close();
                read_stream = null;
            }
            if (reason === 'request ended') {
                dbg.log('res end after req ended');
                res.status(200).end();
            }
        };
    }


    self.get_object_md(params).then(function(md) {
        res.header('Content-Type', md.content_type);
        res.header('Accept-Ranges', 'bytes');

        // range-parser returns:
        //      undefined (no range)
        //      -2 (invalid syntax)
        //      -1 (unsatisfiable)
        //      array (ranges with type)
        var range = req.range(md.size);

        if (!range) {
            dbg.log0('+++ serve_http_stream: send all');
            res.header('Content-Length', md.size);
            res.status(200);
            read_stream = self.open_read_stream(params, self.HTTP_PART_ALIGN);
            read_stream.pipe(res);
            return;
        }

        // return http 400 Bad Request
        if (range === -2) {
            dbg.log0('+++ serve_http_stream: bad range request', req.get('range'));
            res.status(400).end();
            return;
        }

        // return http 416 Requested Range Not Satisfiable
        if (range === -1 || range.type !== 'bytes' || range.length !== 1) {
            dbg.log0('+++ serve_http_stream: invalid range', range, req.get('range'));
            // let the client know of the relevant range
            res.header('Content-Length', md.size);
            res.header('Content-Range', 'bytes */' + md.size);
            res.status(416).end();
            return;
        }

        // return http 206 Partial Content
        var start = range[0].start;
        var end = range[0].end + 1; // use exclusive end

        // [disabled] truncate a single http request to limited size.
        // the idea was to make the browser fetch the next part of content
        // more quickly and only once it gets to play it, but it actually seems
        // to prevent it from properly keeping a video buffer, so disabled it.
        if (self.HTTP_TRUNCATE_PART_SIZE) {
            if (end > start + self.HTTP_PART_ALIGN) {
                end = start + self.HTTP_PART_ALIGN;
            }
            // snap end to the alignment boundary, to make next requests aligned
            end = range_utils.truncate_range_end_to_boundary(
                start, end, self.HTTP_PART_ALIGN);
        }

        dbg.log0('+++ serve_http_stream: send range',
            range_utils.human_range({
                start: start,
                end: end
            }), range);
        res.header('Content-Range', 'bytes ' + start + '-' + (end - 1) + '/' + md.size);
        res.header('Content-Length', end - start);
        // res.header('Cache-Control', 'max-age=0' || 'no-cache');
        res.status(206);
        read_stream = self.open_read_stream(_.extend({
            start: start,
            end: end,
        }, params), self.HTTP_PART_ALIGN);
        read_stream.pipe(res);

        // when starting to stream also prefrech the last part of the file
        // since some video encodings put a chunk of video metadata in the end
        // and it is often requested once doing a video time seek.
        // see https://trac.ffmpeg.org/wiki/Encode/H.264#faststartforwebvideo
        if (start === 0) {
            dbg.log0('+++ serve_http_stream: prefetch end of file');
            var eof_len = 100;
            self.open_read_stream(_.extend({
                start: md.size > eof_len ? (md.size - eof_len) : 0,
                end: md.size,
            }, params), eof_len).pipe(devnull());
        }

    }, function(err) {
        console.error('+++ serve_http_stream: ERROR', err);
        res.status(500).send(err.message);
    });
};





// INTERNAL ///////////////////////////////////////////////////////////////////



function combine_parts_buffers_in_range(parts, start, end) {
    if (end <= start) {
        // empty read range
        return null;
    }
    if (!parts || !parts.length) {
        console.error('no parts for data', range_utils.human_range({
            start: start,
            end: end
        }));
        throw new Error('no parts for data');
    }
    var pos = start;
    var buffers = _.compact(_.map(parts, function(part) {
        var part_range = range_utils.intersection(part.start, part.end, pos, end);
        if (!part_range) {
            return;
        }
        var buffer_start = part_range.start - part.start;
        var buffer_end = part_range.end - part.start;
        if (part.chunk_offset) {
            buffer_start += part.chunk_offset;
            buffer_end += part.chunk_offset;
        }
        pos = part_range.end;
        return part.buffer.slice(buffer_start, buffer_end);
    }));
    if (pos !== end) {
        console.error('missing parts for data',
            range_utils.human_range({
                start: start,
                end: end
            }), 'pos', size_utils.human_offset(pos), parts);
        throw new Error('missing parts for data');
    }
    var len = end - start;
    var buffer = Buffer.concat(buffers, len);
    if (buffer.length !== len) {
        console.error('short buffer from parts',
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
