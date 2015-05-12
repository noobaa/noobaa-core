'use strict';

module.exports = {
    toArrayBuffer: toArrayBuffer,
    toBuffer: toBuffer,
    addToBuffer: addToBuffer,
    isAbv: isAbv,
    toArrayBufferView: toArrayBufferView,
};


/**
 *
 * toArrayBuffer
 *
 */
function toArrayBuffer(buffer) {

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
 * toBuffer
 *
 */
function toBuffer(ab) {
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


/**
 *
 * addToBuffer
 *
 */
function addToBuffer(chunk1, chunk2) {
    var buffer1 = toBuffer(chunk1);
    var buffer2 = toBuffer(chunk2);

    // concat to the buffer already there
    return Buffer.concat([buffer1, buffer2]);
}


/**
 *
 * isAbv
 *
 */
function isAbv(value) {
    return value && value.buffer instanceof ArrayBuffer && value.byteLength !== undefined;
}


/**
 *
 * toArrayBufferView
 *
 */
function toArrayBufferView(buffer) {
    var arrBuffer = toArrayBuffer(buffer);
    return new DataView(arrBuffer);
}
