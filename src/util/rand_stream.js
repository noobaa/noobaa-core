'use strict';

let stream = require('stream');
let crypto = require('crypto');
let chance = require('chance')();

const BYTE_CHANCE = {
    min: 0,
    max: 255
};
const SECTION_CHANCE = {
    min: 0,
    max: 16 * 1024
};

/**
 *
 * RandStream
 *
 * A readable stream that generates pseudo random buffers.
 *
 * the focus here is on high stream performance rather than randomness/security,
 * so the fastest way to achieve this is to preallocate a truly random buffer
 * and then just slice buffers from it starting from random offsets.
 *
 */
class RandStream extends stream.Readable {

    constructor(max_length, options) {
        super(options);
        this.max_length = max_length;
        this.pos = 0;
        this.heavy_crypto = options.heavy_crypto;
        if (!this.heavy_crypto) {
            // WTF:
            //
            // since crypto.randBytes() is soooo slow (~50 MB/sec)
            // we need to be creative here to get faster rates of random bytes.
            //
            // we randomize a big buffer, and for most calls we only randomize
            // an offset inside it and slice bytes from that offset.
            // once in a while we randomize the entire buffer.
            //
            // depending on the max number of usages this gives very high speeds
            // while providing quite random data - random enough against dedup.
            // the best proof for it's randomness is to try a compress it.
            // see in tools/rand_speed.js
            this.randbuf_chunk_size = options && options.highWaterMark || 1024 * 1024;
            this.randbuf_use_count = 0;
            this.randbuf_max_usage = options.randbuf_max_usage || 10000;
            this.randbuf = crypto.randomBytes(4 * this.randbuf_chunk_size);
            this.randbuf_offset_chance = {
                min: 0,
                max: 3 * this.randbuf_chunk_size
            };
        }
    }

    /**
     * implement the stream's Readable._read() function.
     */
    _read(requested_size) {
        let size = Math.min(requested_size, this.max_length - this.pos);
        if (size <= 0) {
            this.push(null);
            return;
        }
        let buf;
        if (this.heavy_crypto) {
            buf = crypto.randomBytes(size);
        } else {
            this.randbuf_use_count += 1;
            if (this.randbuf_use_count > this.randbuf_max_usage) {
                this.randbuf_use_count = 0;
                this.randbuf = crypto.randomBytes(4 * this.randbuf_chunk_size);
            }
            let offset = chance.integer(this.randbuf_offset_chance);
            buf = this.randbuf.slice(offset, offset + size);
            // add random changes in every small section of the buffer.
            // TODO: maybe we should copy the buffer instead of changing randbuf inplace
            // this might backfire because we are changing a buffer that
            // we already returned to previous caller,
            // but copying adds significant overhead...
            for (let i = 0; i < buf.length; i += SECTION_CHANCE.max) {
                let pos = chance.integer(SECTION_CHANCE);
                buf[i + pos] = chance.integer(BYTE_CHANCE);
            }
        }
        this.pos += buf.length;
        setImmediate(() => this.push(buf));
    }

}

module.exports = RandStream;
