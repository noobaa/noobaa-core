// module targets: nodejs & browserify
'use strict';

var util = require('util');
var stream = require('stream');


module.exports = ChunkStream;


/**
 *
 * ChunkStream
 *
 * A transforming stream that chunks the input to fixes size chunks.
 *
 */
function ChunkStream(chunk_size, options) {
    stream.Transform.call(this, options);
    this.chunk_size = chunk_size;
    this.pending = new Buffer(0);
}

// proper inheritance
util.inherits(ChunkStream, stream.Transform);


/**
 * implement the stream's Transform._transform() function.
 */
ChunkStream.prototype._transform = function(data, encoding, callback) {
    this.pending = Buffer.concat([this.pending, data]);
    while (this.pending.length >= this.chunk_size) {
        var chunk = this.pending.slice(0, this.chunk_size);
        this.pending = this.pending.slice(this.chunk_size);
        this.push(chunk);
    }
    callback();
};

/**
 * implement the stream's Transform._flush() function.
 */
ChunkStream.prototype._flush = function(callback) {
    if (this.pending.length) {
        this.push(this.pending);
    }
    callback();
};
