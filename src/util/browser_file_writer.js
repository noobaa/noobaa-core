// module targets: nodejs & browserify
'use strict';

var util = require('util');
var stream = require('stream');
var _ = require('lodash');
var Q = require('q');


module.exports = BrowserFileWriter;


/**
 * BrowserFileWriter is a Writable stream that writes to html5 file writer.
 * params is also used for stream.Writable options.
 */
function BrowserFileWriter(file_writer, Blob, params) {
    var self = this;
    params = params || {};
    stream.Writable.call(self, params);
    self._file_writer = file_writer;
    self._file_writer.onwritestart = function(e) {
        console.log('onwritestart', e);
    };
    self._file_writer.onerror = function(e) {
        self.emit('error', e.target.error);
    };
    self.Blob = Blob;
    self._pos = 0;
}

// proper inheritance
util.inherits(BrowserFileWriter, stream.Writable);


/**
 * implement the stream's Writable._write() function.
 */
BrowserFileWriter.prototype._write = function(chunk, encoding, callback) {
    var self = this;
    self._file_writer.onwriteend = function(e) {
        console.log('onwriteend');
        self._pos += chunk.length;
        self.emit('progress', self._pos);
        callback();
    };
    console.log('write blob', chunk.length);
    // var blob = chunk.toArrayBuffer();
    var blob = new self.Blob([chunk.toArrayBuffer()]);
    self._file_writer.write(blob);
};
