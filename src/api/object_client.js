// module targets: nodejs & browserify
'use strict';

var util = require('util');
var stream = require('stream');
var _ = require('lodash');
var Q = require('q');
var object_api = require('./object_api');
var agent_api = require('./agent_api');
var Semaphore = require('noobaa-util/semaphore');
var ObjectReader = require('./object_reader');
var ObjectWriter = require('./object_writer');
var EventEmitter = require('events').EventEmitter;
var crypto = require('crypto');
var range_utils = require('../util/range_utils');
var size_utils = require('../util/size_utils');
var LRUCache = require('../util/lru_cache');
var devnull = require('dev-null');
var dbg = require('../util/dbg')(module);

module.exports = ObjectClient;


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
    self.MAP_RANGE_ALIGN_NBITS = 24; // = log2( 16 MB )
    self.MAP_RANGE_ALIGN = 1 << self.MAP_RANGE_ALIGN_NBITS; // 16 MB
    self.OBJECT_RANGE_ALIGN_NBITS = 20; // = log2( 1 MB )
    self.OBJECT_RANGE_ALIGN = 1 << self.OBJECT_RANGE_ALIGN_NBITS; // 1 MB
    self.READAHEAD_RANGES = 4;
    self.READ_CONCURRENCY = 32;
    self.WRITE_CONCURRENCY = 16;
    self.MAX_HTTP_PART_SIZE = 0; //4 * size_utils.MEGABYTE;

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
 * OPEN_WRITE_STREAM
 *
 * returns a writable stream to the object.
 * see ObjectWriter.
 *
 */
ObjectClient.prototype.open_write_stream = function(params) {
    return new ObjectWriter(this, params);
};



/**
 *
 * WRITE_OBJECT_PART
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
ObjectClient.prototype.write_object_part = function(params) {
    var self = this;
    var upload_params = _.pick(params, 'bucket', 'key', 'start', 'end');
    dbg.log2('write_object_part', params);

    var md5 = crypto.createHash('md5');
    md5.update(params.buffer); // TODO PERF
    upload_params.md5sum = md5.digest('hex');

    return self.allocate_object_part(upload_params)
        .then(function(part) {
            if (self._events) {
                self._events.emit('part', part);
            }
            var block_size = (part.chunk_size / part.kfrag) | 0;
            var buffer_per_fragment = encode_chunk(params.buffer, part.kfrag, block_size);
            return Q.all(_.map(part.fragments, function(blocks, fragment) {
                return Q.all(_.map(blocks, function(block) {
                    if (self._events) {
                        self._events.emit('send', buffer_per_fragment[fragment].length);
                    }
                    return self._write_block(block, buffer_per_fragment[fragment]);
                }));
            }));
        });
};


/**
 *
 * _write_block
 *
 * write a block to the storage node
 *
 */
ObjectClient.prototype._write_block = function(block, buffer) {
    var self = this;

    // use semaphore to surround the IO
    return self._block_write_sem.surround(function() {

        var agent = new agent_api.Client();
        agent.options.set_address('http://' + block.node.ip + ':' + block.node.port);

        dbg.log0('write_block', size_utils.human_size(buffer.length), block.id,
            'to', block.node.ip + ':' + block.node.port);

        return agent.write_block({
            block_id: block.id,
            data: buffer,
        }).then(null, function(err) {
            console.error('FAILED write_block', buffer.length, block.id,
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
ObjectClient.prototype.open_read_stream = function(params) {
    return new ObjectReader(this, params);
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

    dbg.log1('read_object', params.start, params.end);

    if (params.end <= params.start) {
        return null;
    }

    return self._object_range_cache.get(params)
        .then(function(data) {
            if (data && data.length) {
                // submit a readahead
                var pos = range_utils.align_up_bitwise(
                    params.start + data.length, self.OBJECT_RANGE_ALIGN_NBITS);
                _.times(self.READAHEAD_RANGES, function(i) {
                    var readahead_params = _.clone(params);
                    readahead_params.start = pos;
                    pos += self.OBJECT_RANGE_ALIGN;
                    readahead_params.end = pos;
                    self._object_range_cache.get(readahead_params);
                });
            }
            return data;
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
            return self._read_object_range(range_params);
        },
        make_val: function(val, params) {
            if (!val) {
                dbg.log3('RangesCache: null', params.start, params.end);
                return val;
            }
            var start = range_utils.align_down_bitwise(
                params.start, self.OBJECT_RANGE_ALIGN_NBITS);
            var end = start + self.OBJECT_RANGE_ALIGN;
            var inter = range_utils.intersection(
                start, end, params.start, params.end);
            if (!inter) {
                dbg.log3('RangesCache: empty', params.start, params.end, 'align', start, end);
                return null;
            }
            dbg.log3('RangesCache: slice', params.start, params.end, 'inter', inter.start, inter.end);
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

    dbg.log2('_read_object_range', params);

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
            return self.read_object_mappings(map_params);
        },
        make_val: function(val, params) {
            var mappings = _.clone(val);
            mappings.parts = _.cloneDeep(_.filter(val.parts, function(part) {
                var inter = range_utils.intersection(
                    part.start, part.end, params.start, params.end);
                if (!inter) {
                    dbg.log4('MappingsCache: filtered part', part.start, part.end);
                    return false;
                }
                dbg.log3('MappingsCache: part', part.start, part.end,
                    'inter', inter.start, inter.end);
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

    dbg.log2('_read_object_part', _.omit(part, 'buffer'));

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
        dbg.log3('read_fragment_blocks_chain', part.start, fragment);

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

            part.buffer = decode_chunk(part, buffer_per_fragment).slice(
                part.chunk_offset, part.chunk_offset + part.end - part.start);

            var md5 = crypto.createHash('md5');
            md5.update(part.buffer); // TODO PERF
            var md5sum = md5.digest('hex');

            if (md5sum !== part.md5sum) {
                console.error('MD5 CHECKSUM FAILED', md5sum, part);
                throw new Error('md5 checksum failed');
            }

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

        dbg.log0('read_block', offset, size_utils.human_size(block_size), block.id,
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
                console.error('FAILED read_block', block_size, block.id,
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
    self.get_object_md(params).then(function(md) {
        res.header('Content-Type', md.content_type);
        res.header('Accept-Ranges', 'bytes');

        var range_header = req.header('Range');
        if (!range_header) {
            // return 416 'Requested Range Not Satisfiable'.
            dbg.log0('+++ serve_http_stream: send all');
            res.header('Content-Length', md.size);
            res.status(200);
            self.open_read_stream(params).pipe(res);
            return;
        }

        // split regexp examples:
        // input: bytes=100-200 output: [null, 100, 200, null]
        // input: bytes=-200 output: [null, null, 200, null]
        var range_array = range_header.split(/bytes=([0-9]*)-([0-9]*)/);
        var start_arg = range_array[1];
        var end_arg = range_array[2];
        var start = parseInt(start_arg) || 0;
        var end = (parseInt(end_arg) + 1) || md.size;
        if (!start_arg && end_arg) start = md.size - end;
        var valid_range = (start >= 0) && (end <= md.size) && (start <= end);

        if (!valid_range) {
            // return 416 'Requested Range Not Satisfiable'.
            // indicate the acceptable range.
            res.header('Content-Length', md.size);
            res.header('Content-Range', 'bytes */' + md.size);
            dbg.log0('+++ serve_http_stream: invalid range, send all', start, end, range_header);
            res.status(416);
            return;
        }

        // return 206 'Partial Content'

        // limit a single http request to 4 MB of data
        // the reason is to make the browser fetch the next part of content
        // more quickly and only once it gets to play it,
        // which makes it more stable than a long "inifinite" request stream.
        if (self.MAX_HTTP_PART_SIZE && end >= start + self.MAX_HTTP_PART_SIZE) {
            end = start + self.MAX_HTTP_PART_SIZE;
        }

        res.header('Content-Range', 'bytes ' + start + '-' + (end - 1) + '/' + md.size);
        res.header('Content-Length', end - start);
        res.header('Cache-Control', 'no-cache');
        dbg.log0('+++ serve_http_stream: send range', '[', start, ',', end, ']', range_header);
        res.status(206);
        self.open_read_stream(_.extend({
            start: start,
            end: end,
        }, params)).pipe(res);

        // when starting to stream also prefrech the last part of the file
        // since some video encodings put a chunk of video metadata in the end
        // and it is often requested once doing a video time seek.
        // see https://trac.ffmpeg.org/wiki/Encode/H.264#faststartforwebvideo
        if (start === 0) {
            dbg.log0('+++ serve_http_stream: prefetch end of file');
            self.open_read_stream(_.extend({
                start: md.size > 100 ? (md.size - 100) : 0,
                end: md.size,
            }, params)).pipe(devnull());
        }

    }, function(err) {
        console.error('+++ serve_http_stream: ERROR', err);
        res.status(500).send(err.message);
    });
};





// INTERNAL ///////////////////////////////////////////////////////////////////



function combine_parts_buffers_in_range(parts, start, end) {
    if (!parts || !parts.length || end <= start) {
        return null;
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
