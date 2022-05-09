/* Copyright (C) 2016 NooBaa */
'use strict';

const stream = require('stream');
const dbg = require('./debug_module')(__filename);

const EMPTY_BUFFER = Buffer.allocUnsafeSlow(0);

/**
 * @param {Buffer} buf1
 * @param {Buffer} buf2
 * @returns {boolean}
 */
function eq(buf1, buf2) {
    return buf1 ? buf1.equals(buf2) : !buf2;
}

/**
 * @param {Buffer} buf1
 * @param {Buffer} buf2
 * @returns {boolean}
 */
function neq(buf1, buf2) {
    return !eq(buf1, buf2);
}

/**
 * join() improves Buffer.concat() for a common pathological case
 * where the list has just 1 buffer.
 * In that case we simply return that buffer and avoid a memory copy
 * that concat will always make.
 *
 * @param {Buffer[]} buffers list of buffers to join
 * @param {Number} [total_length] number of bytes to pass to concat
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
 * @param {Buffer[]} buffers array of buffers to update
 * @param {Number} len number of bytes to extract
 * @returns {Buffer[]} array of buffers with total length of len or less
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

/**
 * @param {Buffer[]} buffers
 * @param {number} len
 * @returns {Buffer}
 */
function extract_join(buffers, len) {
    return join(extract(buffers, len), len);
}

/**
 * @param {stream.Readable} readable
 * @returns {Promise<{ buffers:Buffer[], total_length:number }>}
 */
async function read_stream(readable) {
    const res = {
        buffers: [],
        total_length: 0,
    };
    await new Promise((resolve, reject) =>
        readable
        .on('data', data => {
            res.buffers.push(data);
            res.total_length += data.length;
        })
        .once('error', reject)
        .once('end', resolve)
    );
    return res;
}

/**
 * @param {stream.Readable} readable
 * @returns {Promise<Buffer>}
 */
async function read_stream_join(readable) {
    const res = await read_stream(readable);
    return join(res.buffers, res.total_length);
}

/**
 * @param {Buffer} buf
 * @returns {stream.Readable}
 */
function buffer_to_read_stream(buf) {
    return new stream.Readable({
        read(size) {
            if (buf) this.push(buf);
            this.push(null);
        }
    });
}

class WritableBuffers extends stream.Writable {

    constructor() {
        super();
        /** @type {Buffer[]} */
        this.buffers = [];
        this.total_length = 0;
    }

    /**
     * @param {Buffer} data 
     * @param {string|null} encoding 
     * @param {()=>void} callback 
     */
    _write(data, encoding, callback) {
        // copy the buffer because the caller can reuse it after we call the callback
        this.buffers.push(Buffer.from(data));
        this.total_length += data.length;
        callback();
    }

    join() {
        return join(this.buffers, this.total_length);
    }
}

/**
 * @returns {WritableBuffers}
 */
function write_stream() {
    return new WritableBuffers();
}

/**
 * @param {Buffer[]} buffers
 * @returns {number}
 */
function count_length(buffers) {
    var l = 0;
    for (var i = 0; i < buffers.length; ++i) {
        l += buffers[i].length;
    }
    return l;
}

function write_to_stream(writable, buf) {
    return new Promise((resolve, reject) => {
        writable.once('error', reject);
        writable.write(buf, err => {
            if (err) {
                return reject(err);
            }
            return resolve();
        });
    });
}

class BuffersPool {

    constructor({ buf_size, sem, warning_timeout }) {
        this.buf_size = buf_size;
        this.buffers = [];
        this.sem = sem;
        this.warning_timeout = warning_timeout;
    }

    /**
     * @returns {Promise<{
     *  buffer: Buffer,
     *  callback: () => void,
     * }>}
     */
    async get_buffer() {
        dbg.log1('BufferPool.get_buffer: sem value', this.sem._value, 'waiting_value', this.sem._waiting_value, 'buffers length', this.buffers.length);
        let buffer = null;
        let warning_timer;
        // Lazy allocation of buffers pool, first cycle will take up buffers
        // Will cause semaphore to be empty with actual buffers allocated and waiting to be used
        // Any buffer that is in usage (allocated from this.buffers) will be accounted in the semaphore
        await this.sem.wait(this.buf_size);
        if (this.buffers.length) {
            buffer = this.buffers.shift();
        } else {
            buffer = Buffer.allocUnsafeSlow(this.buf_size);
        }
        if (this.warning_timeout) {
            const err = new Error('Warning stuck buffer_pool buffer');
            warning_timer = setTimeout(() => {
                console.error(err.stack);
            }, this.warning_timeout);
            warning_timer.unref();
        }
        const callback = () => {
            if (warning_timer) clearTimeout(warning_timer);
            this.buffers.push(buffer);
            this.sem.release(this.buf_size);
        };
        return { buffer, callback };
    }
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
exports.write_to_stream = write_to_stream;
exports.BuffersPool = BuffersPool;
