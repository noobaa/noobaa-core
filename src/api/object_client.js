// module targets: nodejs & browserify
'use strict';

var util = require('util');
var stream = require('stream');
var _ = require('lodash');
var Q = require('q');
var Semaphore = require('noobaa-util/semaphore');
var transformer = require('../util/transformer');
var Pipeline = require('../util/pipeline');
var CoalesceStream = require('../util/coalesce_stream');
var rabin = require('../util/rabin');
var Poly = require('../util/poly');
var chunk_crypto = require('../util/chunk_crypto');
var range_utils = require('../util/range_utils');
var size_utils = require('../util/size_utils');
var LRUCache = require('../util/lru_cache');
var devnull = require('dev-null');
var config = require('../../config.js');
var dbg = require('noobaa-util/debug_module')(__filename);

module.exports = ObjectClient;



/**
 *
 * OBJECT CLIENT
 *
 * extends object_api which is plain REST api with logic to provide access
 * to remote object storage, and does the necessary distributed of io.
 * the client functions usually have the signature function(params), and return a promise.
 *
 *
 * this is the client side (web currently) that sends the commands
 * defined in object_api to the web server.
 *
 */
function ObjectClient(object_rpc_client, agent_rpc_client) {
    var self = this;

    self.object_rpc_client = object_rpc_client;
    self.agent_rpc_client = agent_rpc_client;

    // some constants that might be provided as options to the client one day

    self.OBJECT_RANGE_ALIGN_NBITS = 19; // log2( 512 KB )
    self.OBJECT_RANGE_ALIGN = 1 << self.OBJECT_RANGE_ALIGN_NBITS; // 512 KB

    self.MAP_RANGE_ALIGN_NBITS = 24; // log2( 16 MB )
    self.MAP_RANGE_ALIGN = 1 << self.MAP_RANGE_ALIGN_NBITS; // 16 MB

    self.READ_CONCURRENCY = config.READ_CONCURRENCY;
    self.WRITE_CONCURRENCY = config.WRITE_CONCURRENCY;

    self.READ_RANGE_CONCURRENCY = config.READ_RANGE_CONCURRENCY;

    self.HTTP_PART_ALIGN_NBITS = self.OBJECT_RANGE_ALIGN_NBITS + 6; // log2( 32 MB )
    self.HTTP_PART_ALIGN = 1 << self.HTTP_PART_ALIGN_NBITS; // 32 MB
    self.HTTP_TRUNCATE_PART_SIZE = false;

    self.CRYPT_TYPE = {
        hash_type: 'sha256',
        cipher_type: 'aes256',
    };

    self._block_write_sem = new Semaphore(self.WRITE_CONCURRENCY);
    self._block_read_sem = new Semaphore(self.READ_CONCURRENCY);
    self._finalize_sem = new Semaphore(config.REPLICATE_CONCURRENCY);

    self._init_object_md_cache();
    self._init_object_range_cache();
    self._init_object_map_cache();
    self._init_blocks_cache();
}





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

    dbg.log0('upload_stream: create multipart', params.key);
    return self.object_rpc_client.create_multipart_upload(create_params)
        .then(function() {
            return self.upload_stream_parts(params);
        })
        .then(function() {
            dbg.log0('upload_stream: complete multipart', params.key);
            return self.object_rpc_client.complete_multipart_upload(bucket_key_params);
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
ObjectClient.prototype.upload_stream_parts = function(params) {
    var self = this;
    var start = params.start || 0;
    var upload_part_number = params.upload_part_number || 0;

    dbg.log0('upload_stream: create multipart', params.key);
    return Q.fcall(function() {
        var pipeline = new Pipeline(params.source_stream);

        ////////////////////////////////////////
        // PIPELINE: split to chunks by rabin //
        ////////////////////////////////////////

        pipeline.pipe(new rabin.RabinChunkStream({
            window_length: 128,
            min_chunk_size: ((self.OBJECT_RANGE_ALIGN / 4) | 0) * 3,
            max_chunk_size: ((self.OBJECT_RANGE_ALIGN / 4) | 0) * 6,
            hash_spaces: [{
                poly: new Poly(Poly.PRIMITIVES[31]),
                hash_bits: self.OBJECT_RANGE_ALIGN_NBITS - 1, // 256 KB average chunk
                hash_val: 0x07071070 // hebrew calculator pimp
            }],
        }));

        ////////////////////////////
        // PIPELINE: encrypt part //
        ////////////////////////////

        pipeline.pipe(transformer({
            options: {
                objectMode: true,
            },
            init: function() {
                this._pos = 0;
            },
            transform: function(chunk) {
                var stream = this;
                var crypt = _.clone(self.CRYPT_TYPE);
                return chunk_crypto.encrypt_chunk(chunk, crypt)
                    .then(function(encrypted_chunk) {
                        var part = {
                            start: start + stream._pos,
                            end: start + stream._pos + chunk.length,
                            crypt: crypt,
                            encrypted_chunk: encrypted_chunk
                        };
                        stream._pos += chunk.length;
                        return part;
                    });
            }
        }));

        //////////////////////////////////////
        // PIPELINE: allocate part mappings //
        //////////////////////////////////////

        pipeline.pipe(new CoalesceStream({
            objectMode: true,
            highWaterMark: 30,
            max_length: 10,
            max_wait_ms: 1000,
        }));

        pipeline.pipe(transformer({
            options: {
                objectMode: true,
                highWaterMark: 10
            },
            transform: function(parts) {
                var stream = this;
                dbg.log0('upload_stream: allocating parts', parts.length);
                // send parts to server
                return self.object_rpc_client.allocate_object_parts({
                        bucket: params.bucket,
                        key: params.key,
                        parts: _.map(parts, function(part) {
                            var p = {
                                start: part.start,
                                end: part.end,
                                crypt: part.crypt,
                                chunk_size: part.encrypted_chunk.length,
                                upload_part_number: upload_part_number
                            };
                            return p;
                        })
                    })
                    .then(function(res) {
                        // push parts down the pipe
                        var part;
                        for (var i = 0; i < res.parts.length; i++) {
                            if (res.parts[i].dedup) {
                                part = parts[i];
                                part.dedup = true;
                                dbg.log0('upload_stream: DEDUP part', part.start);
                            } else {
                                part = res.parts[i].part;
                                part.encrypted_chunk = parts[i].encrypted_chunk;
                                dbg.log0('upload_stream: allocated part', part.start);
                            }
                            stream.push(part);
                        }
                    });
            }
        }));

        /////////////////////////////////
        // PIPELINE: write part blocks //
        /////////////////////////////////

        pipeline.pipe(transformer({
            options: {
                objectMode: true,
                highWaterMark: 30
            },
            transform: function(part) {
                if (part.dedup) return;
                return self._write_part_blocks(
                        params.bucket, params.key, part)
                    .thenResolve(part);
            }
        }));

        /////////////////////////////
        // PIPELINE: finalize part //
        /////////////////////////////

        pipeline.pipe(new CoalesceStream({
            objectMode: true,
            highWaterMark: 30,
            max_length: 10,
            max_wait_ms: 1000,
        }));

        pipeline.pipe(transformer({
            options: {
                objectMode: true,
                highWaterMark: 10
            },
            transform: function(parts) {
                var stream = this;
                dbg.log0('upload_stream: finalize parts', parts.length);
                // send parts to server
                return self._finalize_sem.surround(function() {
                        return self.object_rpc_client.finalize_object_parts({
                            bucket: params.bucket,
                            key: params.key,
                            parts: _.map(parts, function(part) {
                                var p = _.pick(part, 'start', 'end');
                                if (!part.dedup) {
                                    p.block_ids = _.flatten(
                                        _.map(part.fragments, function(fragment) {
                                            return _.map(fragment.blocks, function(block) {
                                                return block.address.id;
                                            });
                                        })
                                    );
                                }
                                return p;
                            })
                        }, {
                            timeout: config.client_replicate_timeout,
                            retries: 3
                        });
                    })
                    .then(function() {
                        // push parts down the pipe
                        for (var i = 0; i < parts.length; i++) {
                            var part = parts[i];
                            dbg.log0('upload_stream: finalize part offset', part.start);
                            stream.push(part);
                        }
                    });
            }
        }));

        //////////////////////////////////////////
        // PIPELINE: resolve, reject and notify //
        //////////////////////////////////////////

        pipeline.pipe(transformer({
            options: {
                objectMode: true,
                highWaterMark: 30
            },
            transform: function(part) {
                dbg.log0('upload_stream: completed part offset', part.start);
                dbg.log_progress(part.end / params.size);
                pipeline.notify({
                    event: 'part:after',
                    part: part
                });
            }
        }));

        return pipeline.run();
    });
};



/**
 *
 * _write_part_blocks
 *
 */
ObjectClient.prototype._write_part_blocks = function(bucket, key, part) {
    var self = this;

    if (part.dedup) {
        dbg.log0('DEDUP', range_utils.human_range(part));
        return part;
    }

    dbg.log3('part before', range_utils.human_range(part));
    var block_size = (part.chunk_size / part.kfrag) | 0;
    var buffer_per_fragment = encode_chunk(part.encrypted_chunk, part.kfrag, block_size);

    return Q.all(_.map(part.fragments, function(fragment, fragment_index) {
        return Q.all(_.map(fragment.blocks, function(block) {
            return self._attempt_write_block({
                bucket: bucket,
                key: key,
                start: part.start,
                end: part.end,
                part: part,
                fragment: fragment_index,
                offset: part.start + (fragment_index * block_size),
                block: block,
                buffer: buffer_per_fragment[fragment_index],
                remaining_attempts: 20,
            });
        }));
    }));
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
    dbg.log3('write block _attempt_write_block', params);
    return self._write_block(params.block.address, params.buffer, params.offset)
        .then(null, function(err) {
            if (params.remaining_attempts <= 0) {
                throw new Error('EXHAUSTED WRITE BLOCK', size_utils.human_offset(params.offset));
            }
            params.remaining_attempts -= 1;
            var bad_block_params =
                _.extend(_.pick(params, 'bucket', 'key', 'start', 'end', 'fragment'), {
                    block_id: params.block.address.id,
                    is_write: true
                });
            dbg.log0('write block remaining attempts',
                params.remaining_attempts, 'offset', size_utils.human_offset(params.offset));
            return self.object_rpc_client.report_bad_block(bad_block_params)
                .then(function(res) {
                    dbg.log2('write block _attempt_write_block retry with', res.new_block);
                    // update the block itself in the part so
                    // that finalize will see this update as well.
                    params.block.address = res.new_block;
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
ObjectClient.prototype._write_block = function(block_address, buffer, offset) {
    var self = this;

    // use semaphore to surround the IO
    return self._block_write_sem.surround(function() {

        dbg.log1('write_block', size_utils.human_offset(offset),
            size_utils.human_size(buffer.length), block_address.id,
            'to', block_address.addresses[0]);

        // if (Math.random() < 0.5) throw new Error('testing error');

        return self.agent_rpc_client.write_block({
            block_id: block_address.id,
            data: buffer,
        }, {
            address: block_address.addresses,
            domain: block_address.peer,
            timeout: config.write_timeout,
        }).then(null, function(err) {
            console.error('FAILED write_block', size_utils.human_offset(offset),
                size_utils.human_size(buffer.length), block_address.id,
                'from', block_address.addresses[0]);
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
ObjectClient.prototype.get_object_md = function(params, cache_miss) {
    return this._object_md_cache.get(params, cache_miss);
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
        expiry_ms: 60000, // 1 minute
        make_key: function(params) {
            return params.bucket + ':' + params.key;
        },
        load: function(params) {
            dbg.log1('MDCache: load', params.key, 'bucket', params.bucket);
            return self.object_rpc_client.read_object_md(params);
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
ObjectClient.prototype.read_entire_object = function(params) {
    var self = this;
    return Q.Promise(function(resolve, reject) {
        var buffers = [];
        self.open_read_stream(params)
            .on('data', function(chunk) {
                console.log('read data', chunk.length);
                buffers.push(chunk);
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
ObjectClient.prototype.read_object = function(params) {
    var self = this;

    dbg.log1('read_object1', range_utils.human_range(params));

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
        dbg.log2('read_object2', range_utils.human_range(range));
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

    return self._object_map_cache.get(params) // get meta data on object range we want to read
        .then(function(mappings) {
            obj_size = mappings.size;
            return Q.all(_.map(mappings.parts, self._read_object_part, self)); // get actual data from nodes
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
            return self.object_rpc_client.read_object_mappings(map_params);
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
    var next_fragment_index = 0;

    dbg.log2('_read_object_part', range_utils.human_range(part));

    // advancing the read by taking the next fragment and return promise to read it.
    // will fail if no more fragments remain, which means the part cannot be served.
    function read_the_next_fragment() {
        while (next_fragment_index < part.fragments.length) {
            var curr_fragment_index = next_fragment_index;
            var fragment = part.fragments[curr_fragment_index];
            next_fragment_index += 1;
            if (fragment) {
                return read_fragment_blocks_chain(fragment, curr_fragment_index);
            }
        }
        throw new Error('READ PART EXHAUSTED', part);
    }

    function read_fragment_blocks_chain(fragment, fragment_index) {
        dbg.log3('read_fragment_blocks_chain', range_utils.human_range(part), fragment_index);

        // chain the blocks of the fragment with array reduce
        // to handle read failures we create a promise chain such that each block of
        // this fragment will read and if fails it's promise rejection handler will go
        // to read the next block of the fragment.
        function add_block_promise_to_chain(promise, block) {
            return promise.then(null, function(err) {
                if (err !== chain_init_err) {
                    console.error('READ FAILED BLOCK', err);
                }
                var offset = part.start + (fragment_index * block_size);
                return self._blocks_cache.get({
                    block_address: block.address,
                    block_size: block_size,
                    offset: offset,
                });
            });
        }

        // chain_initiator is used to fire the first rejection handler for the head of the chain.
        var chain_init_err = 'chain_init_err';
        var chain_initiator = Q.reject(chain_init_err);

        // reduce the blocks array to create the chain and feed it with the initial promise
        return _.reduce(fragment.blocks, add_block_promise_to_chain, chain_initiator)
            .then(function(buffer) {
                // when done, just keep the buffer and finish this promise chain
                buffer_per_fragment[fragment_index] = buffer;
            })
            .then(null, function(err) {
                // failed to read this fragment, try another.
                console.error('READ FAILED FRAGMENT', fragment_index, err);
                return read_the_next_fragment();
            });
    }

    // start reading by queueing the first kfrag
    return Q.all(_.times(part.kfrag, read_the_next_fragment))
        .then(function() {
            var encrypted_buffer = decode_chunk(part, buffer_per_fragment);
            dbg.log2('decrypt_chunk', encrypted_buffer.length, part);
            return chunk_crypto.decrypt_chunk(encrypted_buffer, part.crypt);
        }).then(function(chunk) {
            part.buffer = chunk.slice(
                part.chunk_offset,
                part.chunk_offset + part.end - part.start);
            return part;
        }).catch(function(err) {
            console.error('decrypt_chunk FAILED FRAGMENT ' + require('util').inspect(err) + ' ; ' + err.stack);
            throw err;
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
            return params.block_address.id;
        },
        load: function(params) {
            dbg.log1('BlocksCache: load',
                size_utils.human_offset(params.offset),
                params.block_address.id);
            return self._read_block(params.block_address, params.block_size, params.offset);
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
ObjectClient.prototype._read_block = function(block_address, block_size, offset) {
    var self = this;

    // use semaphore to surround the IO
    return self._block_read_sem.surround(function() {

        dbg.log1('read_block', size_utils.human_offset(offset),
            size_utils.human_size(block_size), block_address.id,
            'from', block_address.addresses[0]);

        return self.agent_rpc_client.read_block({
                block_id: block_address.id
            }, {
                address: block_address.addresses,
                domain: block_address.peer,
                timeout: config.read_timeout,
            })
            .then(function(res) {
                var buffer = res.data;
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
                    size_utils.human_size(block_size), block_address.id,
                    'from', block_address.addresses[0]);
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
