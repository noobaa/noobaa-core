// module targets: nodejs & browserify
'use strict';

var _ = require('lodash');
var Q = require('q');
var util = require('util');
var stream = require('stream');
var crypto = require('crypto');

module.exports = RandStream;


/**
 *
 * RandStream
 *
 * A readable stream that generates chunks with crypto.pseudoRandomBytes
 *
 */
function RandStream(max_length, options) {
    stream.Readable.call(this, options);
    this.max_length = max_length;
    this.pos = 0;
}

// proper inheritance
util.inherits(RandStream, stream.Readable);


/**
 * implement the stream's Readable._read() function.
 */
RandStream.prototype._read = function(requested_size) {
    var self = this;

    var size = Math.min(requested_size, self.max_length - self.pos);
    if (size <= 0) {
        self.push(null);
        return;
    }

    crypto.pseudoRandomBytes(size, function(err, buf) {
        if (err) {
            self.emit('error', err);
            return;
        }
        self.pos += buf.length;
        self.push(buf);
    });
};
