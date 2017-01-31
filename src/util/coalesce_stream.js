/* Copyright (C) 2016 NooBaa */
'use strict';

var _ = require('lodash');
var P = require('../util/promise');
var util = require('util');
var stream = require('stream');
var js_utils = require('./js_utils');

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
    var self = this;
    // console.log('coalesce', self._pending.length, data);
    var data_promise = _.isArray(data) ? P.all(data) : P.resolve(data);
    data_promise.then(function(data_in) {
        // console.log('coalesce', self._pending.length, data_in);
        self._pending = js_utils.append_buffer_or_array(self._pending, data_in);

        // flush if passed threshold, or set a timer to flush
        if (self._pending.length >= self._max_length) {
            self.flush_me();
        } else if (!self._timeout) {
            self._timeout = setTimeout(self.flush_me, self._max_wait_ms);
        }

        // notify i'm ready for more
        callback();
    }, function(err) {
        callback(err);
    });
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
