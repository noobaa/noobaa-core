// this module is written for both nodejs, or for client with browserify.
'use strict';

var util = require('util');
var stream = require('stream');
var _ = require('lodash');
var Q = require('q');


// ObjectWriter is a Writable stream for the specified object and range.

module.exports = ObjectWriter;


function ObjectWriter(client, params) {
    var self = this;

    stream.Writable.call(self, {
        // highWaterMark Number - Buffer level when write() starts returning false. Default=16kb
        highWaterMark: params.high_water_mark,
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

    // on finish send complete_multipart_upload for the server to finalize the object meta-data
    self.once('finish', function(callback) {
        Q.fcall(
            function() {
                return self._client.complete_multipart_upload({
                    bucket: self._bucket,
                    key: self._key,
                    size: self._pos,
                    // md5sum: '', // TODO
                });
            }
        ).nodeify(callback);
    });

    // on error send abort_multipart_upload for the server to discard the current upload
    self.once('error', function(callback) {
        Q.fcall(
            function() {
                return self._client.abort_multipart_upload({
                    bucket: self._bucket,
                    key: self._key,
                });
            }
        ).nodeify(callback);
    });
}

util.inherits(ObjectWriter, stream.Writable);

// implement the stream's inner Writable._write() function
ObjectWriter.prototype._write = function(chunk, encoding, callback) {
    var self = this;
    Q.fcall(
        function() {
            return self._client.write_object_part({
                bucket: self._bucket,
                key: self._key,
                start: self._pos,
                end: self._pos + chunk.length,
                buffer: chunk,
            });
        }
    ).then(
        function() {
            self._pos += chunk.length;
        }
    ).nodeify(callback);
};
