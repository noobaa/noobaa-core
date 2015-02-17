var exports = module.exports = {};

var toArrayBuffer = function toArrayBuffer(buffer) {

    if (buffer instanceof ArrayBuffer) {
        return buffer;
    }

    var ab = new ArrayBuffer(buffer.length);
    var view = new Uint8Array(ab);
    for (var i = 0; i < buffer.length; ++i) {
        view[i] = buffer[i];
    }
    return ab;
};
exports.toArrayBuffer = toArrayBuffer;

var toBuffer = function toBuffer(ab) {
    var buffer = new Buffer(ab.byteLength);
    var view = new Uint8Array(ab);
    for (var i = 0; i < buffer.length; ++i) {
        buffer[i] = view[i];
    }
    return buffer;
};
exports.toBuffer = toBuffer;

function chunkToBuffer(chunk) {
    var buffer;

    if (chunk instanceof ArrayBuffer) {
        buffer = toBuffer(chunk);
    } else {
        buffer = (Buffer.isBuffer(chunk)) ?
            chunk :  // already is Buffer use it
            new Buffer(chunk);  // string, convert
    }
    return buffer;
}

var addToBuffer = function addToBuffer(chunk1, chunk2) {
    var buffer1 = chunkToBuffer(chunk1);
    var buffer2 = chunkToBuffer(chunk2);

    // concat to the buffer already there
    return Buffer.concat([buffer1, buffer2]);
};
exports.addToBuffer = addToBuffer;

var isAbv = function isAbv(value) {
    return value && value.buffer instanceof ArrayBuffer && value.byteLength !== undefined;
};
exports.isAbv = isAbv;

var toArrayBufferView = function toArrayBufferView(buffer) {
    var arrBuffer = toArrayBuffer(buffer);
    return new DataView(arrBuffer);
};
exports.toArrayBufferView = toArrayBufferView;
