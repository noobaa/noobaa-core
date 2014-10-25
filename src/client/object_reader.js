// this module is written for both nodejs, or for client with browserify.
'use strict';

var util = require('util');
var stream = require('stream');
var _ = require('lodash');
var Q = require('q');


// ObjectReader is a Readable stream for the specified object and range.

module.exports = ObjectReader;

function ObjectReader(client, params) {
    var self = this;

    stream.Readable.call(self, {
        // highWaterMark Number - The maximum number of bytes to store
        // in the internal buffer before ceasing to read
        // from the underlying resource. Default=16kb
        highWaterMark: params.high_water_mark,
        // encoding String - If specified, then buffers will be decoded to strings
        // using the specified encoding. Default=null
        encoding: null,
        // objectMode Boolean - Whether this stream should behave as a stream of objects.
        // Meaning that stream.read(n) returns a single value
        // instead of a Buffer of size n. Default=false
        objectMode: false,
    });

    self._client = client;
    self._bucket = params.bucket;
    self._key = params.key;
    self._pos = Number(params.start) || 0;
    self._end = typeof(params.end) === 'undefined' ? Infinity : Number(params.end);
}

util.inherits(ObjectReader, stream.Readable);

// implement the stream's Readable._read() function.
ObjectReader.prototype._read = function(requested_size) {
    var self = this;
    Q.fcall(
        function() {
            var end = Math.min(self._end, self._pos + requested_size);
            return self._client.read_object_range({
                bucket: self._bucket,
                key: self._key,
                start: self._pos,
                end: end,
            });
        }
    ).done(
        function(buffer) {
            if (buffer) {
                self._pos += buffer.length;
            }
            self.push(buffer);
        },
        function(err) {
            self.emit('error', err || 'unknown error');
        }
    );
};
