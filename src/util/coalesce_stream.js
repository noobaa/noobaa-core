// module targets: nodejs & browserify
'use strict';

var _ = require('lodash');
var Q = require('q');
var util = require('util');
var stream = require('stream');


module.exports = CoalesceStream;


/**
 *
 * CoalesceStream
 *
 * A transforming stream that coalesces the input (buffers or objects).
 *
 */
function CoalesceStream(options) {
    stream.Transform.call(this, options);
    this._obj = options.objectMode;
    this._max_length = options.max_length;
    this._max_wait_ms = options.max_wait_ms || 0;
    this._pending = this._obj ? [] : new Buffer(0);
    this.flush_me = this._flush.bind(this);
}

// proper inheritance
util.inherits(CoalesceStream, stream.Transform);


/**
 * implement the stream's Transform._transform() function.
 */
CoalesceStream.prototype._transform = function(data, encoding, callback) {

    // append the data
    if (this._obj) {
        this._pending.push(data);
    } else {
        this._pending = Buffer.concat([this._pending, data]);
    }

    // flush if passed threshold, or set a timer to flush
    if (this._pending.length >= this._max_length) {
        this.flush_me();
    } else if (!this._timeout) {
        this._timeout = setTimeout(this.flush_me, this._max_wait_ms);
    }

    // notify i'm ready for more
    callback();
};

/**
 * implement the stream's Transform._flush() function.
 */
CoalesceStream.prototype._flush = function(callback) {

    // clear the timer
    if (this._timeout) {
        clearTimeout(this._timeout);
        this._timeout = null;
    }

    // flush if something remains
    if (this._pending.length) {
        this.push(this._pending);
        this._pending = this._obj ? [] : new Buffer(0);
    }

    // done
    if (callback) {
        callback();
    }
};
