// module targets: nodejs & browserify
'use strict';

var util = require('util');
var stream = require('stream');
var _ = require('lodash');
var Q = require('q');


module.exports = ObjectWriter;


/**
 *
 * OBJECT WRITER
 *
 * a Writable stream for the specified object and range.
 * params is also used for stream.Writable highWaterMark
 *
 */
function ObjectWriter(client, params) {
    var self = this;
    stream.Writable.call(self, {
        // highWaterMark Number - Buffer level when write() starts returning false. Default=16kb
        highWaterMark: params.highWaterMark || (1024 * 1024),
        // decodeStrings Boolean - Whether or not to decode strings into Buffers
        // before passing them to _write(). Default=true
        decodeStrings: true,
        // objectMode Boolean - Whether or not the write(anyObj) is a valid operation.
        // If set you can write arbitrary data instead of only Buffer / String data. Default=false
        objectMode: false,
    });
    self._client = client;
    self._bucket = params.bucket;
    self._key = params.key;
    self._pos = 0;
}

// proper inheritance
util.inherits(ObjectWriter, stream.Writable);

/**
 * implement the stream's inner Writable._write() function
 */
ObjectWriter.prototype._write = function(chunk, encoding, callback) {
    var self = this;
    Q.fcall(function() {
            return self._client.write_object_part({
                bucket: self._bucket,
                key: self._key,
                start: self._pos,
                end: self._pos + chunk.length,
                buffer: chunk,
            });
        })
        .then(function() {
            self._pos += chunk.length;
        })
        .nodeify(callback);
};
