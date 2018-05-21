/* Copyright (C) 2016 NooBaa */
'use strict';

const P = require('./promise');
const stream = require('stream');

const EMPTY_BUFFER = Buffer.allocUnsafeSlow(0);

function eq(buf1, buf2) {
    return buf1 ? buf1.equals(buf2) : !buf2;
}

function neq(buf1, buf2) {
    return !eq(buf1, buf2);
}

/**
 * join() improves Buffer.concat() for a common pathological case
 * where the list has just 1 buffer.
 * In that case we simply return that buffer and avoid a memory copy
 * that concat will always make.
 *
 * @param {[Buffer]} buffers list of buffers to join
 * @param {Number} total_length number of bytes to pass to concat
 * @returns {Buffer} concatenated buffer
 */
function join(buffers, total_length) {
    if (buffers.length > 1) return Buffer.concat(buffers, total_length);
    return buffers[0] || EMPTY_BUFFER;
}

/**
 * extract() is like Buffer.slice() but for array of buffers
 * Removes len bytes from the beginning of the array, or less if not available
 *
 * @param {[Buffer]} buffers array of buffers to update
 * @param {Number} len number of bytes to extract
 * @returns {[Buffer]} array of buffers with total length of len or less
 */
function extract(buffers, len) {
    const res = [];
    var pos = 0;
    while (pos < len && buffers.length) {
        const b = buffers[0];
        const n = Math.min(b.length, len - pos);
        if (n < b.length) {
            buffers[0] = b.slice(n);
            res.push(b.slice(0, n));
        } else {
            buffers.shift();
            res.push(b);
        }
        pos += n;
    }
    return res;
}

function extract_join(buffers, len) {
    return join(extract(buffers, len), len);
}

function read_stream(readable) {
    const res = {
        buffers: [],
        total_length: 0,
    };
    return new P((resolve, reject) => readable
            .on('data', data => {
                res.buffers.push(data);
                res.total_length += data.length;
            })
            .once('error', reject)
            .once('end', resolve)
        )
        .return(res);
}

function read_stream_join(readable) {
    return read_stream(readable)
        .then(res => join(res.buffers, res.total_length));
}

function buffer_to_read_stream(buf) {
    return new stream.Readable({
        read(size) {
            this.push(buf);
            this.push(null);
        }
    });
}

function write_stream() {
    const writable = new stream.Writable({
        write(data, encoding, callback) {
            this.buffers.push(data);
            this.total_length += data.length;
            callback();
        }
    });
    writable.buffers = [];
    writable.total_length = 0;
    return writable;
}

function count_length(buffers) {
    var l = 0;
    for (var i = 0; i < buffers.length; ++i) {
        l += buffers[i].length;
    }
    return l;
}

exports.eq = eq;
exports.neq = neq;
exports.join = join;
exports.extract = extract;
exports.extract_join = extract_join;
exports.read_stream = read_stream;
exports.read_stream_join = read_stream_join;
exports.write_stream = write_stream;
exports.count_length = count_length;
exports.buffer_to_read_stream = buffer_to_read_stream;
