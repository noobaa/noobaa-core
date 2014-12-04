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


module.exports = ObjectClient;


/**
 *
 * OBJECT CLIENT
 *
 * extends object_api with logic to provide access to remote object storage.
 * does the necessary distributed io.
 * the client functions have the signature function(params), and return a promise.
 *
 */
function ObjectClient(base) {
    object_api.Client.call(this, base);
    this.read_sem = new Semaphore(16);
    this.write_sem = new Semaphore(16);
}

// proper inheritance
util.inherits(ObjectClient, object_api.Client);

ObjectClient.prototype.events = function() {
    if (!this._events) {
        this._events = new EventEmitter();
    }
    return this._events;
};

// in addition to the api functions, the client implements more advanced functions
// for read/write of objects according to the object mapping.


ObjectClient.prototype.open_read_stream = function(params) {
    return new ObjectReader(this, params);
};
ObjectClient.prototype.open_write_stream = function(params) {
    return new ObjectWriter(this, params);
};



/**
 *
 * WRITE_OBJECT_PART
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
    // console.log('write_object_part', params);

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
                    // use semaphore to surround the IO
                    return self.write_sem.surround(function() {
                        if (self._events) {
                            self._events.emit('send', buffer_per_fragment[fragment].length);
                        }
                        return write_block(block, buffer_per_fragment[fragment]);
                    });
                }));
            }));
        });
};


/**
 *
 * READ_OBJECT_RANGE
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
ObjectClient.prototype.read_object_range = function(params) {
    var self = this;
    var obj_size;

    // console.log('read_object_range', params);
    return self.read_object_mappings(params)
        .then(function(mappings) {
            obj_size = mappings.size;
            return Q.all(_.map(mappings.parts, self.read_object_part, self));
        })
        .then(function(parts) {
            // once all parts finish we can construct the complete buffer.
            var end = Math.min(obj_size, params.end);
            return combine_parts_buffers_in_range(parts, params.start, end);
        });
};

/**
 * read one part of the object.
 */
ObjectClient.prototype.read_object_part = function(part) {
    var self = this;
    var block_size = (part.chunk_size / part.kfrag) | 0;
    var buffer_per_fragment = {};
    var next_fragment = 0;

    // console.log('read_object_part', part);

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
        // console.log('read_fragment_blocks_chain', fragment);

        // chain the blocks of the fragment with array reduce
        // to handle read failures we create a promise chain such that each block of
        // this fragment will read and if fails it's promise rejection handler will go
        // to read the next block of the fragment.
        var add_block_promise_to_chain = function(promise, block) {
            return promise.then(null, function(err) {
                if (err !== chain_init_err) {
                    console.error('READ FAILED BLOCK', err);
                }
                // use semaphore to surround the IO
                return self.read_sem.surround(function() {
                    return read_block(block, block_size);
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
            // TODO cache decoded chunks with lru client
            // cut only the part's relevant range from the chunk

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
 * write a block to the storage node
 */
function write_block(block, buffer) {
    var agent = new agent_api.Client();
    agent.options.set_address('http://' + block.node.ip + ':' + block.node.port);

    console.log('write_block', size_utils.human_size(buffer.length), block.id,
        'to', block.node.ip + ':' + block.node.port);

    return agent.write_block({
        block_id: block.id,
        data: buffer,
    }).then(null, function(err) {
        console.error('FAILED write_block', buffer.length, block.id,
            'from', block.node.ip + ':' + block.node.port);
        throw err;
    });
}


/**
 * read a block from the storage node
 */
function read_block(block, block_size) {
    var agent = new agent_api.Client();
    agent.options.set_address('http://' + block.node.ip + ':' + block.node.port);

    console.log('read_block', size_utils.human_size(block_size), block.id,
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
