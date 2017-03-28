/* Copyright (C) 2016 NooBaa */
'use strict';

const P = require('./promise');

/**
 * concatify returns a single buffer from list of buffers
 * but optimized for the common case of a single buffer to avoid copyful concat
 */
function concatify(buffers) {
    if (!buffers) return new Buffer(0);
    if (buffers.length === 1) return buffers[0];
    return Buffer.concat(buffers);
}

function buffer_from_stream(stream) {
    return buffers_from_stream(stream).then(concatify);
}

function buffers_from_stream(stream) {
    const chunks = [];
    return new P((resolve, reject) => stream
            .on('data', chunk => chunks.push(chunk))
            .once('error', reject)
            .once('end', resolve))
        .return(chunks);
}

/**
 *
 * to_array_buffer
 *
 */
function to_array_buffer(buffer) {

    if (buffer instanceof ArrayBuffer) {
        return buffer;
    }

    // in browserify the buffer can just convert immediately to arraybuffer
    if (buffer.toArrayBuffer) {
        return buffer.toArrayBuffer();
    }

    // TODO support strings? need to convert chars to bytes? with utf8 support or not?

    // slow convert from buffer
    var ab = new ArrayBuffer(buffer.length);
    var bytes_view = new Uint8Array(ab);
    for (var i = 0; i < buffer.length; ++i) {
        bytes_view[i] = buffer[i];
    }
    return ab;
}


/**
 *
 * to_buffer
 *
 */
function to_buffer(b) {
    return Buffer.isBuffer(b) ? b : Buffer.from(b);
}


exports.concatify = concatify;
exports.buffer_from_stream = buffer_from_stream;
exports.buffers_from_stream = buffers_from_stream;
exports.to_array_buffer = to_array_buffer;
exports.to_buffer = to_buffer;
