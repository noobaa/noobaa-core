// module targets: nodejs & browserify
'use strict';

var util = require('util');
var stream = require('stream');
var _ = require('lodash');
var Q = require('q');


module.exports = SliceReader;


/**
 * SliceReader is a Readable stream that uses slice on a source object.
 * params is also used for stream.Readable options: highWaterMark, decodeStrings, objectMode, etc.
 */
function SliceReader(source, params) {
    var self = this;
    params = params || {};
    stream.Readable.call(self, params);
    self._source = source;
    self._pos =
        typeof(params.start) !== 'undefined' && Number(params.start) || 0;
    self._end =
        typeof(params.end) !== 'undefined' && Number(params.end) ||
        typeof(source.size) === 'undefined' && Number(source.size) ||
        Infinity;

    if (params.FileReader) {
        // support for FileReader api
        // we convert the provided array buffer to a buffer (copyless).
        self._fr = new params.FileReader();
        self._fr.onloadend = function(e) {
            var data = e.target.result;
            var buf = new Buffer(new Uint8Array(data));
            if (!buf.length) {
                self.push(null);
            } else {
                self._pos += buf.length;
                self.push(buf);
            }
        };
        self._fr.onerror = function(e) {
            self.emit('error', e.target.error);
        };
    }
}

// proper inheritance
util.inherits(SliceReader, stream.Readable);


/**
 * implement the stream's Readable._read() function.
 */
SliceReader.prototype._read = function(requested_size) {
    try {
        var next = Math.min(this._end, this._pos + requested_size);
        var slice = this._source.slice(this._pos, next);
        if (this._fr) {
            this._fr.readAsArrayBuffer(slice);
            return;
        }
        if (this._pos >= next || !slice.length) {
            this.push(null); // EOF
        } else {
            this._pos = next;
            this.push(slice);
        }
    } catch (err) {
        this.emit('error', err);
    }
};
