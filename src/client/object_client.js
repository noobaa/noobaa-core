// this module is written for both nodejs, or for client with browserify.
'use strict';

var util = require('util');
var stream = require('stream');
var _ = require('lodash');
var Q = require('q');
var object_api = require('../api/object_api');
var Mapper = require('./mapper');
var Semaphore = require('noobaa-util/semaphore');



// exporting the ObjectClient class
module.exports = ObjectClient;



// ctor of the object client.
// the client provides api access to remote object storage.
// the client API functions have the signature function(params), and return a promise.
//
// client_params (Object): see restful_api.init_client()
//
function ObjectClient(client_params) {
    object_api.Client.call(this, client_params);
    this.read_sem = new Semaphore(20);
    this.write_sem = new Semaphore(20);
}

// in addition to the api functions, the client implements more advanced functions
// for read/write of objects according to the object mapping.
util.inherits(ObjectClient, object_api.Client);



// write_object_part (API)
//
// params (Object):
//   - bucket (String)
//   - key (String)
//   - start (Number) - object start offset
//   - end (Number) - object end offset
//   - buffer (Buffer) - data to write
//
// return (promise)
//
ObjectClient.prototype.write_object_part = function(params) {
    var self = this;
    var buffer = params.buffer;
    console.log('write_object_part', params);

    return self.get_object_mappings(
        _.omit(params, 'buffer')
    ).then(
        function(res) {
            var mappings = res.data;
            return Q.all(_.map(
                mappings.parts,
                function(part) {
                    // return self.read_object_part(part);
                }
            ));
        }
    );
};


// read_object_range (API)
//
// params (Object):
//   - bucket (String)
//   - key (String)
//   - start (Number) - object start offset
//   - end (Number) - object end offset
//
// return: buffer (promise) - the data. can be shorter than requested if EOF.
//
ObjectClient.prototype.read_object_range = function(params) {
    var self = this;
    console.log('read_object_range', params);

    return self.get_object_mappings(params).then(
        function(res) {
            var mappings = res.data;
            return Q.all(_.map(mappings.parts, self.read_object_part, self));
        }
    ).then(
        function(parts_buffers) {
            // once all parts finish we can construct the complete buffer.
            return Buffer.concat(parts_buffers, params.end - params.start);
        }
    );
};


ObjectClient.prototype.read_object_part = function(part) {
    var self = this;
    var block_size = ((part.end - part.start) / part.kblocks) | 0;
    var buffer_per_index = {};
    var next_index = 0;

    console.log('read_object_part', part);

    // TODO support part.chunk_offset
    if (part.chunk_offset) {
        throw new Error('CHUNK_OFFSET SUPPORT NOT IMPLEMENTED YET');
    }

    // advancing the read by taking the next index and return promise to read it.
    // will fail if no more indexes remain, which means the part cannot be served.
    function read_the_next_index() {
        while (next_index < part.indexes.length) {
            var curr_index = next_index;
            var blocks = part.indexes[curr_index];
            next_index += 1;
            if (blocks) {
                return read_index_blocks_chain(blocks, curr_index);
            }
        }
        throw new Error('READ PART EXHAUSTED', part);
    }

    function read_index_blocks_chain(blocks, index) {
        console.log('read_index_blocks_chain', index);
        // chain the blocks of the index with array reduce
        // to handle read failures we create a promise chain such that each block of
        // this index will read and if fails it's promise rejection handler will go
        // to read the next block of the index.
        var add_block_promise_to_chain = function(promise, block) {
            return promise.then(null,
                function(err) {
                    console.error('READ FAILED BLOCK', err);
                    return read_block(block, block_size, self.read_sem);
                }
            );
        };
        // chain_initiator is used to fire the first rejection handler for the head of the chain.
        var chain_initiator = Q.reject(index);
        // reduce the blocks array to create the chain and feed it with the initial promise
        return _.reduce(
            blocks,
            add_block_promise_to_chain,
            chain_initiator
        ).then(
            function(buffer) {
                // when done, just keep the buffer and finish this promise chain
                buffer_per_index[index] = buffer;
            }
        ).then(null,
            function(err) {
                // failed to read this index, try another.
                console.error('READ FAILED INDEX', index, err);
                return read_the_next_index();
            }
        );
    }

    // start reading by queueing the first kblocks
    return Q.all(
        _.times(part.kblocks, read_the_next_index)
    ).then(
        function() {
            return decode_part(part, buffer_per_index);
        }
    );
};


// for now just decode without erasure coding
function decode_part(part, buffer_per_index) {
    var buffers = [];

    for (var i = 0; i < part.kblocks; i++) {
        buffers[i] = buffer_per_index[i];
        if (!buffer_per_index[i]) {
            throw new Error('DECODE FAILED MISSING BLOCK ' + i);
        }
    }

    // TODO what about part.chunk_offset, and adjustments of part.start and part.end ???
    return Buffer.concat(buffers, part.end - part.start);
}


function read_block(block, block_size, sem) {
    // use read semaphore to surround the IO
    return sem.surround(
        function() {
            console.log('read_block', block, block_size);

            // TODO read block from node
            var buffer = new Buffer(block_size);
            buffer.fill(0);

            // verify the received buffer length must be full size
            if (buffer.length !== block_size) {
                throw new Error('BLOCK SHORT READ', block, block_size, buffer);
            }
            return buffer;
        }
    );
}






ObjectClient.prototype.open_read_stream = function(params) {
    return new Reader(this, params);
};
ObjectClient.prototype.open_write_stream = function(params) {
    return new Writer(this, params);
};



var READ_SIZE_MARK = 128 * 1024;
var WRITE_SIZE_MARK = 128 * 1024;


///////////////
/////////
/////
// Reader is a Readable stream for the specified object and range.

function Reader(client, params) {
    stream.Readable.call(this, {
        // highWaterMark Number - The maximum number of bytes to store
        // in the internal buffer before ceasing to read
        // from the underlying resource. Default=16kb
        highWaterMark: READ_SIZE_MARK,
        // encoding String - If specified, then buffers will be decoded to strings
        // using the specified encoding. Default=null
        encoding: null,
        // objectMode Boolean - Whether this stream should behave as a stream of objects.
        // Meaning that stream.read(n) returns a single value
        // instead of a Buffer of size n. Default=false
        objectMode: false,
    });
    this._client = client;
    var p = _.clone(params);
    p.start = fix_offset_param(p.start, 0);
    p.end = fix_offset_param(p.end, Infinity);
    this._reader_params = p;
}

util.inherits(Reader, stream.Readable);

// implement the stream's Readable._read() function.
Reader.prototype._read = function(requested_size) {
    var self = this;
    // make copy of params for this request range
    var params = this._reader_params;
    var p = _.clone(params);
    // trim if size exceeds the map range
    var size = Math.min(
        Number(requested_size) || READ_SIZE_MARK,
        params.end - params.start
    );
    p.end = p.start + size;
    // finish the read if reached the end of the reader range
    if (size <= 0) {
        self.push(null);
        return;
    }
    this._client.read_object_range(p).done(
        function(buffer) {
            params.start += buffer.length;
            self.push(buffer);
            // when read returns a truncated buffer it means we reached EOF
            if (buffer.length < size) {
                self.push(null);
            }
        },
        function(err) {
            self.emit('error', err || 'unknown error');
        }
    );
};



///////////////
/////////
/////
// Writer is a Writable stream for the specified object and range.


function Writer(client, params) {
    stream.Writable.call(this, {
        // highWaterMark Number - Buffer level when write() starts returning false. Default=16kb
        highWaterMark: WRITE_SIZE_MARK,
        // decodeStrings Boolean - Whether or not to decode strings into Buffers
        // before passing them to _write(). Default=true
        decodeStrings: true,
        // objectMode Boolean - Whether or not the write(anyObj) is a valid operation.
        // If set you can write arbitrary data instead of only Buffer / String data. Default=false
        objectMode: false,
    });
    this._client = client;
    var p = _.clone(params);
    p.start = fix_offset_param(p.start, 0);
    p.end = fix_offset_param(p.end, Infinity);
    this._writer_params = p;
}

util.inherits(Writer, stream.Writable);

// implement the stream's Readable._read() function.
Writer.prototype._write = function(chunk, encoding, callback) {
    // make copy of params for this request range
    var params = this._writer_params;
    var p = _.clone(params);
    // trim if buffer exceeds the map range
    var size = Math.min(
        chunk.length,
        params.end - params.start
    );
    p.end = p.start + size;
    p.buffer = slice_buffer(chunk, 0, size);
    this._client.write_object_part(p).done(
        function() {
            params.start += size;
            callback();
        },
        function(err) {
            callback(err || 'unknown error');
        }
    );
};



// return a fixed positive
function fix_offset_param(offset, default_value) {
    // if undefined assume the default value
    if (typeof(offset) === 'undefined') {
        return default_value;
    }
    // cast to number (numbers->numbers, Infinity->Infinity, null->0, objects->NaN)
    var x = Number(offset);
    // return positive number, negatives are truncated to 0.
    return x <= 0 ? 0 : x;
}

function slice_buffer(buffer, offset, size) {
    if (offset === 0 && buffer.length === size) {
        return buffer;
    }
    if (typeof(buffer.slice) === 'function') {
        return buffer.slice(offset, offset + size);
    }
    throw new Error('Cannot slice buffer');
}
