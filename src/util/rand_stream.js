// module targets: nodejs & browserify
'use strict';

var util = require('util');
var stream = require('stream');
var crypto = require('crypto');
var chance = require('chance')();

module.exports = RandStream;


/**
 *
 * RandStream
 *
 * A readable stream that generates pseudo random buffers.
 *
 * the focus here is on high stream performance rather than randomness/security,
 * so the fastest way to achieve this is to preallocate a truly random buffer
 * and then just slice buffers from it starting from random offsets.
 *
 */
function RandStream(max_length, options) {
    stream.Readable.call(this, options);
    this.max_length = max_length;
    this.pos = 0;
    var base_len = options && options.highWaterMark || 1024 * 1024;
    this.truly_random_buffer = crypto.randomBytes(4 * base_len);
    this.offset_random_conf = {
        min: 0,
        max: 3 * base_len
    };
}

// proper inheritance
util.inherits(RandStream, stream.Readable);


/**
 * implement the stream's Readable._read() function.
 */
RandStream.prototype._read = function(requested_size) {
    var size = Math.min(requested_size, this.max_length - this.pos);
    if (size <= 0) {
        this.push(null);
        return;
    }
    var offset = chance.integer(this.offset_random_conf);
    var buf = this.truly_random_buffer.slice(offset, offset + size);
    this.pos += buf.length;
    this.push(buf);
};
