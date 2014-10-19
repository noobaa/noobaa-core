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


// read_object_data (API)
//
// params (Object):
//   - bucket (String)
//   - key (String)
//   - start (Number) - object start offset
//   - end (Number) - object end offset
//
// return: buffer (promise) - the data. can be shorter than requested if EOF.
//
ObjectClient.prototype.read_object_data = function(params) {
    var self = this;
    console.log('read_object_data', params);

    return self.get_object_mappings(params).then(function(res) {
        var mappings = res.data;
        console.log('mappings', mappings);
        // sort parts by start offset - just in case the server didn't
        // the sorting will allow streaming reads to work well.
        _.sortBy(mappings.parts, 'start');
        return Q.all(_.map(mappings.parts, function(part) {
            return self.read_object_part(part);
        }));
    }).then(function(parts_buffers) {
        // once all parts finish we can construct the complete buffer.
        return Buffer.concat(parts_buffers, params.end - params.start);
    });
};


ObjectClient.prototype.read_object_part = function(part) {
    var self = this;
    console.log('read_object_part', part);

    var num_buffers = 0;
    var buffers_by_index = {};
    var blocks_by_index = _.groupBy(part.blocks, 'index');
    var indexes_arr = _.keys(blocks_by_index).sort();
    var next_index_pos = part.kblocks;
    var start_initial_indexes = _.map(_.first(indexes_arr, part.kblocks), process_index);
    var block_size = ((part.end - part.start) / part.kblocks) | 0;

    function process_index(index) {
        console.log('process_index', index);

        var blocks = blocks_by_index[index];
        // chain the blocks of the index with array reduce
        return _.reduce(blocks, function(promise, block) {
            // chain the next block of the index on the rejection handler
            // so it will be read instead if the previous failed.
            return promise.then(null, function() {
                // use read semaphore to surround the IO
                return self.read_sem.surround(function() {
                    return read_block(block, block_size);
                });
            });
        }, Q.reject('NOT-AN-ERROR')).then(function(buffer) {
            buffers_by_index[index] = buffer;
            num_buffers += 1;
            // when done, just finish the promise chain
        }).then(null, function(err) {
            // failed to read index, try another if remains
            console.error('READ FAILED INDEX', index, err);
            if (next_index_pos >= indexes_arr.length) {
                throw new Error('READ EXHAUSTED', part);
            }
            var next_index = indexes_arr[next_index_pos];
            next_index_pos += 1;
            return process_index(next_index);
        });
    }

    return Q.all(start_initial_indexes).then(function() {
        var buffers = [];
        for (var i = 0; i < part.kblocks; i++) {
            buffers[i] = buffers_by_index[i];
            if (!buffers_by_index[i]) {
                throw new Error('MISSING BLOCK ' + i);
            }
        }
        return Buffer.concat(buffers, part.end - part.start);
    });
};

function read_block(block, block_size) {
    console.log('read_block', block, block_size);
    // TODO read block from node
    var buffer = new Buffer(block_size);
    buffer.fill(0);
    return buffer;
}



// write_object_data (API)
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
ObjectClient.prototype.write_object_data = function(params) {
    var self = this;
    console.log('write_object_data', params);
    return self.get_object_mappings(_.omit(params, 'buffer')).then(function(res) {
        var mappings = res.data;
        var buffer = params.buffer;
        // sort parts by start offset - just in case the server didn't
        // the sorting will allow streaming reads to work well.
        _.sortBy(mappings.parts, 'start');
        return Q.all(_.map(mappings.parts, function(part) {
            // return self.read_object_part(part);
        }));
    });
};





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
    var size = Math.min(Number(requested_size) || READ_SIZE_MARK, params.end - params.start);
    p.end = p.start + size;
    // finish the read if reached the end of the reader range
    if (size <= 0) {
        self.push(null);
        return;
    }
    this._client.read_object_data(p).done(function(buffer) {
        params.start += buffer.length;
        self.push(buffer);
        // when read returns a truncated buffer it means we reached EOF
        if (buffer.length < size) {
            self.push(null);
        }
    }, function(err) {
        self.emit('error', err || 'unknown error');
    });
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
    var size = Math.min(chunk.length, params.end - params.start);
    p.end = p.start + size;
    p.buffer = slice_buffer(chunk, 0, size);
    this._client.write_object_data(p).done(function() {
        params.start += size;
        callback();
    }, function(err) {
        callback(err || 'unknown error');
    });
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
