'use strict';

module.exports = {
    to_array_buffer: to_array_buffer,
    to_buffer: to_buffer,
    get_single: get_single,
};


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
function to_buffer(ab) {
    if (Buffer.isBuffer(ab)) {
        return ab;
    }

    // for strings or anything other than arraybuffer the class buffer can convert
    if (!(ab instanceof ArrayBuffer)) {
        return new Buffer(ab);
    }

    var bytes_view = new Uint8Array(ab);

    // in browserify the buffer can just convert immediately to arraybuffer
    if (Buffer.TYPED_ARRAY_SUPPORT) {
        return new Buffer(bytes_view);
    }

    // slow convert
    var buffer = new Buffer(ab.byteLength);
    for (var i = 0; i < buffer.length; ++i) {
        buffer[i] = bytes_view[i];
    }
    return buffer;
}


function get_single(buffers) {
    if (!buffers) return null;
    if (buffers.length === 1) return buffers[0];
    return Buffer.concat(buffers);
}
