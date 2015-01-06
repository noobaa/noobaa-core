// module targets: nodejs & browserify
'use strict';

var util = require('util');
var stream = require('stream');
var _ = require('lodash');
var Q = require('q');
var object_api = require('./object_api');
var agent_api = require('./agent_api');
var Semaphore = require('noobaa-util/semaphore');
var ChunkStream = require('../util/chunk_stream');
var rabin = require('../util/rabin');
var Poly = require('../util/poly');
var EventEmitter = require('events').EventEmitter;
var crypto = require('crypto');
var range_utils = require('../util/range_utils');
var size_utils = require('../util/size_utils');
var LRUCache = require('../util/lru_cache');
var devnull = require('dev-null');
var dbg = require('../util/dbg')(__filename);

module.exports = ObjectClient;

// dbg.log_level = 3;

/**
 *
 * OBJECT CLIENT
 *
 * extends object_api which is plain REST api with logic to provide access
 * to remote object storage, and does the necessary distributed of io.
 * the client functions usually have the signature function(params), and return a promise.
 *
 */
function ObjectClient(base) {
    var self = this;
    object_api.Client.call(self, base);

    // some constants that might be provided as options to the client one day

    self.OBJECT_RANGE_ALIGN_NBITS = 19; // log2( 512 KB )
    self.OBJECT_RANGE_ALIGN = 1 << self.OBJECT_RANGE_ALIGN_NBITS; // 512 KB

    self.MAP_RANGE_ALIGN_NBITS = 24; // log2( 16 MB )
    self.MAP_RANGE_ALIGN = 1 << self.MAP_RANGE_ALIGN_NBITS; // 16 MB

    self.READ_CONCURRENCY = 32;
    self.WRITE_CONCURRENCY = 16;

    self.READ_RANGE_CONCURRENCY = 8;

    self.HTTP_PART_ALIGN_NBITS = self.OBJECT_RANGE_ALIGN_NBITS + 6; // log2( 32 MB )
    self.HTTP_PART_ALIGN = 1 << self.HTTP_PART_ALIGN_NBITS; // 32 MB
    self.HTTP_TRUNCATE_PART_SIZE = false;

    self._block_write_sem = new Semaphore(self.WRITE_CONCURRENCY);
    self._block_read_sem = new Semaphore(self.READ_CONCURRENCY);

    self._init_object_md_cache();
    self._init_object_range_cache();
    self._init_object_map_cache();
    self._init_blocks_cache();
}

// proper inheritance
util.inherits(ObjectClient, object_api.Client);


/**
 * get an event emitter to subscribe for events that give insight
 * to the client's internal flows.
 */
ObjectClient.prototype.events = function() {
    if (!this._events) {
        this._events = new EventEmitter();
    }
    return this._events;
};



// WRITE FLOW /////////////////////////////////////////////////////////////////


/**
 *
 * UPLOAD_STREAM
 *
 */
ObjectClient.prototype.upload_stream = function(params) {
    var self = this;
    var create_params = _.pick(params, 'bucket', 'key', 'size', 'content_type');
    var bucket_key_params = _.pick(params, 'bucket', 'key');

    dbg.log0('create multipart', params.key);
    return self.create_multipart_upload(create_params)
        .then(function() {
            var pos = 0;
            self.events().removeAllListeners('part:after');
            self.events().on('part:after', function(part) {
                var len = part.end - part.start;
                pos += len;
                dbg.log_progress(pos / params.size);
            });
            return Q.Promise(function(resolve, reject) {
                params.source_stream
                    .pipe(new rabin.RabinChunkStream({
                        window_length: 128,
                        min_chunk_size: ((self.OBJECT_RANGE_ALIGN / 4) | 0) * 3,
                        max_chunk_size: ((self.OBJECT_RANGE_ALIGN / 4) | 0) * 6,
                        hash_spaces: [{
                            poly: new Poly(Poly.PRIMITIVES[31]),
                            hash_bits: self.OBJECT_RANGE_ALIGN_NBITS - 1, // 256 KB average chunk
                            hash_val: 0x07071070 // hebrew calculator pimp
                        }],
                    }))
                    .pipe(self.open_write_stream(bucket_key_params))
                    .once('error', function(err) {
                        dbg.log0('error write stream', params.key, err);
                        reject(err);
                    })
                    .once('finish', function() {
                        dbg.log0('finish write stream', params.key);
                        resolve();
                    });
            });
        })
        .then(function() {
            dbg.log0('complete multipart', params.key);
            return self.complete_multipart_upload(bucket_key_params);
        });
};


/**
 *
 * OPEN_WRITE_STREAM
 *
 * returns a writable stream to the object.
 * see ObjectWriter.
 *
 */
ObjectClient.prototype.open_write_stream = function(params, watermark) {
    return new ObjectWriter(this, params, watermark || this.OBJECT_RANGE_ALIGN);
};



/**
 *
 * ObjectWriter
 *
 * a Writable stream for the specified object and range.
 * params is also used for stream.Writable highWaterMark
 *
 */
function ObjectWriter(client, params, watermark) {
    var self = this;
    stream.Writable.call(self, {
        // highWaterMark Number - Buffer level when write() starts returning false. Default=16kb
        highWaterMark: watermark,
        // decodeStrings Boolean - Whether or not to decode strings into Buffers
        // before passing them to _write(). Default=true
        decodeStrings: true,
        // objectMode Boolean - Whether or not the write(anyObj) is a valid operation.
        // If set you can write arbitrary data instead of only Buffer / String data. Default=false
        objectMode: false,
    });
    self._client = client;
    self._bucket = params.bucket;
    self._key = params.key;
    self._pos = 0;
}

// proper inheritance
util.inherits(ObjectWriter, stream.Writable);

/**
 * implement the stream's inner Writable._write() function
 */
ObjectWriter.prototype._write = function(chunk, encoding, callback) {
    var self = this;
    Q.fcall(function() {
            return self._client._write_object_part({
                bucket: self._bucket,
                key: self._key,
                start: self._pos,
                end: self._pos + chunk.length,
                buffer: chunk,
            });
        })
        .then(function() {
            self._pos += chunk.length;
            dbg.log3('writer pos', size_utils.human_offset(self._pos));
            callback();
        }, function(err) {
            console.error('writer error', err);
            callback(err || 'writer error');
        });
};


/**
 *
 * _write_object_part
 *
 * write a single object part.
 * the boundary of object parts can decided by the caller,
 * and it affects directly on the object mappings.
 * TODO need to clarify how to define parts.
 *
 * @param {Object} params:
 *   - bucket (String)
 *   - key (String)
 *   - start (Number) - object start offset
 *   - end (Number) - object end offset
 *   - buffer (Buffer) - data to write
 *
 * @return promise
 */
ObjectClient.prototype._write_object_part = function(params) {
    var self = this;
    var part;
    var part_params = _.pick(params, 'bucket', 'key', 'start', 'end');
    var create_part_params = _.clone(part_params);
    create_part_params.crypt = {
        hash_type: 'sha256',
        cipher_type: 'aes256',
    };
    var encrypted_buffer = encrypt_chunk(params.buffer, create_part_params.crypt);
    create_part_params.chunk_size = encrypted_buffer.length;
    dbg.log2('_write_object_part', create_part_params, 'plain length', params.buffer.length);

    return self.allocate_object_part(create_part_params)
        .then(function(res) {
            if (res.dedup) {
                part = part_params;
                console.log('DEDUP', part);
                return;
            }
            part = res.part;
            if (self._events) {
                self._events.emit('part:before', part);
            }
            dbg.log3('part before', range_utils.human_range(part));
            var block_size = (part.chunk_size / part.kfrag) | 0;
            var buffer_per_fragment = encode_chunk(encrypted_buffer, part.kfrag, block_size);
            return Q.all(_.map(part.fragments, function(blocks, fragment) {
                return Q.all(_.map(blocks, function(block) {
                    if (self._events) {
                        self._events.emit('block:before', buffer_per_fragment[fragment].length);
                    }
                    return self._attempt_write_block(_.extend({}, part_params, {
                        part: part,
                        fragment: fragment,
                        offset: part.start + (fragment * block_size),
                        block: block,
                        buffer: buffer_per_fragment[fragment],
                        remaining_attempts: 20,
                    }));
                }));
            }));
        }).then(function() {
            dbg.log3('part after', range_utils.human_range(part));
            if (self._events) {
                self._events.emit('part:after', part);
            }
        });
};


/**
 *
 * _write_block
 *
 * write a block to the storage node
 *
 */
ObjectClient.prototype._attempt_write_block = function(params) {
    var self = this;

    return self._write_block(params.block, params.buffer, params.offset)
        .then(null, function(err) {
            if (params.remaining_attempts <= 0) {
                throw new Error('EXHAUSTED WRITE BLOCK', size_utils.human_offset(params.offset));
            }
            params.remaining_attempts -= 1;
            var bad_block_params =
                _.extend(_.pick(params, 'bucket', 'key', 'start', 'end', 'fragment'), {
                    block_id: params.block.id,
                    is_write: true,
                });
            dbg.log0('write block remaining attempts',
                params.remaining_attempts, 'offset', size_utils.human_offset(params.offset));
            return self.report_bad_block(bad_block_params)
                .then(function(res) {
                    params.block = res.new_block;
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
ObjectClient.prototype._write_block = function(block, buffer, offset) {
    var self = this;

    // use semaphore to surround the IO
    return self._block_write_sem.surround(function() {

        var agent = new agent_api.Client();
        agent.options.set_address('http://' + block.node.ip + ':' + block.node.port);
        agent.options.set_timeout(30000);

        dbg.log1('write_block', size_utils.human_offset(offset),
            size_utils.human_size(buffer.length), block.id,
            'to', block.node.ip + ':' + block.node.port);

        // if (Math.random() < 0.5) throw new Error('testing error');

        return agent.write_block({
            block_id: block.id,
            data: buffer,
        }).then(null, function(err) {
            console.error('FAILED write_block', size_utils.human_offset(offset),
                size_utils.human_size(buffer.length), block.id,
                'from', block.node.ip + ':' + block.node.port);
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
 *
 */
ObjectClient.prototype.get_object_md = function(params) {
    return this._object_md_cache.get(params);
};


/**
 *
 * _init_object_md_cache
 *
 */
ObjectClient.prototype._init_object_md_cache = function() {
    var self = this;
    self._object_md_cache = new LRUCache({
        name: 'MDCache',
        max_length: 1000,
        expiry_ms: 600000, // 10 minutes
        make_key: function(params) {
            return params.bucket + ':' + params.key;
        },
        load: function(params) {
            dbg.log1('MDCache: load', params.key, 'bucket', params.bucket);
            return self.read_object_md(params);
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
ObjectClient.prototype.open_read_stream = function(params, watermark) {
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
    stream.Readable.call(self, {
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
util.inherits(ObjectReader, stream.Readable);


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
    Q.fcall(function() {
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
            console.error('reader error', err);
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
ObjectClient.prototype.read_object = function(params) {
    var self = this;

    dbg.log1('read_object', range_utils.human_range(params));

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
            range_utils.align_up_bitwise(pos + 1, self.OBJECT_RANGE_ALIGN_NBITS)
        );
        dbg.log2('read_object', range_utils.human_range(range));
        promises.push(self._object_range_cache.get(range));
        pos = range.end;
    }

    return Q.all(promises).then(function(buffers) {
        return Buffer.concat(_.compact(buffers));
    });
};


/**
 *
 * _init_object_range_cache
 *
 */
ObjectClient.prototype._init_object_range_cache = function() {
    var self = this;
    self._object_range_cache = new LRUCache({
        name: 'RangesCache',
        max_length: 128, // total 128 MB
        expiry_ms: 600000, // 10 minutes
        make_key: function(params) {
            var start = range_utils.align_down_bitwise(
                params.start, self.OBJECT_RANGE_ALIGN_NBITS);
            var end = start + self.OBJECT_RANGE_ALIGN;
            return params.bucket + ':' + params.key + ':' + start + ':' + end;
        },
        load: function(params) {
            var range_params = _.clone(params);
            range_params.start = range_utils.align_down_bitwise(
                params.start, self.OBJECT_RANGE_ALIGN_NBITS);
            range_params.end = range_params.start + self.OBJECT_RANGE_ALIGN;
            dbg.log0('RangesCache: load', range_utils.human_range(range_params), params.key);
            return self._read_object_range(range_params);
        },
        make_val: function(val, params) {
            if (!val) {
                dbg.log3('RangesCache: null', range_utils.human_range(params));
                return val;
            }
            var start = range_utils.align_down_bitwise(
                params.start, self.OBJECT_RANGE_ALIGN_NBITS);
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
                'inter', range_utils.human_range(inter));
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
ObjectClient.prototype._read_object_range = function(params) {
    var self = this;
    var obj_size;

    dbg.log2('_read_object_range', range_utils.human_range(params));

    return self._object_map_cache.get(params)
        .then(function(mappings) {
            obj_size = mappings.size;
            return Q.all(_.map(mappings.parts, self._read_object_part, self));
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
ObjectClient.prototype._init_object_map_cache = function() {
    var self = this;
    self._object_map_cache = new LRUCache({
        name: 'MappingsCache',
        max_length: 1000,
        expiry_ms: 600000, // 10 minutes
        make_key: function(params) {
            var start = range_utils.align_down_bitwise(
                params.start, self.MAP_RANGE_ALIGN_NBITS);
            return params.bucket + ':' + params.key + ':' + start;
        },
        load: function(params) {
            var map_params = _.clone(params);
            map_params.start = range_utils.align_down_bitwise(
                params.start, self.MAP_RANGE_ALIGN_NBITS);
            map_params.end = map_params.start + self.MAP_RANGE_ALIGN;
            dbg.log1('MappingsCache: load', range_utils.human_range(params),
                'aligned', range_utils.human_range(map_params));
            return self.read_object_mappings(map_params);
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
ObjectClient.prototype._read_object_part = function(part) {
    var self = this;
    var block_size = (part.chunk_size / part.kfrag) | 0;
    var buffer_per_fragment = {};
    var next_fragment = 0;

    dbg.log2('_read_object_part', range_utils.human_range(part));

    // advancing the read by taking the next fragment and return promise to read it.
    // will fail if no more fragments remain, which means the part cannot be served.
    function read_the_next_fragment() {
        while (next_fragment < part.fragments.length) {
            var curr_fragment = next_fragment;
            var blocks = part.fragments[curr_fragment];
            next_fragment += 1;
            if (blocks) {
                return read_fragment_blocks_chain(blocks, curr_fragment);
            }
        }
        throw new Error('READ PART EXHAUSTED', part);
    }

    function read_fragment_blocks_chain(blocks, fragment) {
        dbg.log3('read_fragment_blocks_chain', range_utils.human_range(part), fragment);

        // chain the blocks of the fragment with array reduce
        // to handle read failures we create a promise chain such that each block of
        // this fragment will read and if fails it's promise rejection handler will go
        // to read the next block of the fragment.
        var add_block_promise_to_chain = function(promise, block) {
            return promise.then(null, function(err) {
                if (err !== chain_init_err) {
                    console.error('READ FAILED BLOCK', err);
                }
                var offset = part.start + (fragment * block_size);
                return self._blocks_cache.get({
                    block: block,
                    block_size: block_size,
                    offset: offset,
                });
            });
        };

        // chain_initiator is used to fire the first rejection handler for the head of the chain.
        var chain_init_err = {};
        var chain_initiator = Q.reject(chain_init_err);

        // reduce the blocks array to create the chain and feed it with the initial promise
        return _.reduce(blocks, add_block_promise_to_chain, chain_initiator)
            .then(function(buffer) {
                // when done, just keep the buffer and finish this promise chain
                buffer_per_fragment[fragment] = buffer;
            })
            .then(null, function(err) {
                // failed to read this fragment, try another.
                console.error('READ FAILED FRAGMENT', fragment, err);
                return read_the_next_fragment();
            });
    }

    // start reading by queueing the first kfrag
    return Q.all(_.times(part.kfrag, read_the_next_fragment))
        .then(function() {
            var encrypted_buffer = decode_chunk(part, buffer_per_fragment);
            dbg.log2('decrypt_chunk', encrypted_buffer.length, part);
            var chunk = decrypt_chunk(encrypted_buffer, part.crypt);
            part.buffer = chunk.slice(part.chunk_offset, part.chunk_offset + part.end - part.start);
            return part;
        });
};


/**
 *
 * _init_blocks_cache
 *
 */
ObjectClient.prototype._init_blocks_cache = function() {
    var self = this;
    self._blocks_cache = new LRUCache({
        name: 'BlocksCache',
        max_length: self.READ_CONCURRENCY, // very small, just to handle repeated calls
        expiry_ms: 600000, // 10 minutes
        make_key: function(params) {
            return params.block.id;
        },
        load: function(params) {
            dbg.log1('BlocksCache: load', size_utils.human_offset(params.offset), params.block.id);
            return self._read_block(params.block, params.block_size, params.offset);
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
ObjectClient.prototype._read_block = function(block, block_size, offset) {
    var self = this;

    // use semaphore to surround the IO
    return self._block_read_sem.surround(function() {

        var agent = new agent_api.Client();
        agent.options.set_address('http://' + block.node.ip + ':' + block.node.port);
        agent.options.set_timeout(30000);

        dbg.log1('read_block', size_utils.human_offset(offset),
            size_utils.human_size(block_size), block.id,
            'from', block.node.ip + ':' + block.node.port);

        return agent.read_block({
                block_id: block.id
            })
            .then(function(buffer) {
                // verify the received buffer length must be full size
                if (!Buffer.isBuffer(buffer)) {
                    throw new Error('NOT A BUFFER ' + typeof(buffer));
                }
                if (buffer.length !== block_size) {
                    throw new Error('BLOCK SHORT READ ' + buffer.length + ' / ' + block_size);
                }
                return buffer;
            }, function(err) {
                console.error('FAILED read_block', size_utils.human_offset(offset),
                    size_utils.human_size(block_size), block.id,
                    'from', block.node.ip + ':' + block.node.port);
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
ObjectClient.prototype.serve_http_stream = function(req, res, params) {
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
            res.status(400);
            return;
        }

        // return http 416 Requested Range Not Satisfiable
        if (range === -1 || range.type !== 'bytes' || range.length !== 1) {
            dbg.log0('+++ serve_http_stream: invalid range', range, req.get('range'));
            // let the client know of the relevant range
            res.header('Content-Length', md.size);
            res.header('Content-Range', 'bytes */' + md.size);
            res.status(416);
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
            end = range_utils.truncate_range_end_to_boundary_bitwise(
                start, end, self.HTTP_PART_ALIGN_NBITS);
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
        var offset = part.chunk_offset + part_range.start - part.start;
        pos = part_range.end;
        return part.buffer.slice(offset, pos);
    }));
    if (pos !== end) {
        console.error('missing parts for data',
            range_utils.human_range({
                start: start,
                end: end
            }), 'pos', size_utils.human_offset(pos), parts);
        throw new Error('missing parts for data');
    }
    return Buffer.concat(buffers, end - start);
}


/**
 * for now just encode without erasure coding
 */
function encode_chunk(buffer, kfrag, block_size) {
    var buffer_per_fragment = [];
    for (var i = 0, pos = 0; i < kfrag; i++, pos += block_size) {
        var b = buffer.slice(pos, pos + block_size);
        if (b.length !== block_size) {
            var pad = new Buffer(block_size - b.length);
            pad.fill(0);
            b = Buffer.concat([b, pad]);
            if (b.length !== block_size) {
                throw new Error('incorrect padding');
            }
        }
        buffer_per_fragment[i] = b;
    }
    return buffer_per_fragment;
}


/**
 * for now just decode without erasure coding
 */
function decode_chunk(part, buffer_per_fragment) {
    var buffers = [];
    for (var i = 0; i < part.kfrag; i++) {
        buffers[i] = buffer_per_fragment[i];
        if (!buffers[i]) {
            throw new Error('DECODE FAILED MISSING BLOCK ' + i);
        }
    }
    return Buffer.concat(buffers, part.chunk_size);
}


/**
 *
 * encrypt_chunk
 *
 */
function encrypt_chunk(plain_buffer, crypt_info) {
    var hasher = crypto.createHash(crypt_info.hash_type);
    hasher.update(plain_buffer);
    crypt_info.hash_val = hasher.digest('base64');

    // convergent encryption - use data hash as cipher key
    crypt_info.cipher_val = crypt_info.hash_val;

    var cipher = crypto.createCipher(crypt_info.cipher_type, crypt_info.cipher_val);
    var encrypted_buffer = cipher.update(plain_buffer);
    var cipher_final = cipher.final();
    if (cipher_final && cipher_final.length) {
        encrypted_buffer = Buffer.concat([encrypted_buffer, cipher_final]);
    }

    return encrypted_buffer;
}


/**
 *
 * decrypt_chunk
 *
 */
function decrypt_chunk(encrypted_buffer, crypt_info) {
    var decipher = crypto.createDecipher(crypt_info.cipher_type, crypt_info.cipher_val);
    var plain_buffer = decipher.update(encrypted_buffer);
    var decipher_final = decipher.final();
    if (decipher_final && decipher_final.length) {
        plain_buffer = Buffer.concat([plain_buffer, decipher_final]);
    }

    var hasher = crypto.createHash(crypt_info.hash_type);
    hasher.update(plain_buffer);
    var hash_val = hasher.digest('base64');

    if (hash_val !== crypt_info.hash_val) {
        console.error('HASH CHECKSUM FAILED', hash_val, crypt_info);
        throw new Error('hash checksum failed');
    }

    return plain_buffer;
}
