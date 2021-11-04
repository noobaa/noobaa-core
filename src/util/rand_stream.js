/* Copyright (C) 2016 NooBaa */
'use strict';

let stream = require('stream');
let crypto = require('crypto');

/**
 *
 * RandStream
 *
 * A readable stream that generates pseudo random bytes.
 *
 * WTF:
 *
 * since crypto.randomBytes() is too slow (~50 MB/sec)
 * we need to be creative to get faster rates of random bytes.
 * the focus is on high stream performance rather than randomness/security,
 * but still resist dedup.
 *
 */
class RandStream extends stream.Readable {

    /**
     * 
     * @param {number} max_length when to stop generating random bytes
     * @param {{
     *      highWaterMark?: number;
     *      generator?: 'crypto' | 'cipher' | 'fake' | 'zeros' | 'fill' | 'noinit';
     *      cipher_seed?: Buffer;
     *  }?} options 
     */
    constructor(max_length, options) {
        super(options);
        this.max_length = max_length;
        this.chunk_size = (options && options.highWaterMark) || 1024 * 1024;
        this.generator = this[`generate_${(options && options.generator) || 'cipher'}`];
        this.cipher_seed = options && options.cipher_seed;
        this.pos = 0;
        this.ticks = 0;
    }

    /**
     * generate_crypto:
     *
     * crypto.randomBytes() used to be slow ~50 MB/sec - BUT it is no longer so...
     * 
     * The speed of this mode is ~2000 MB/sec.
     */
    generate_crypto(size) {
        return crypto.randomBytes(size);
    }

    /**
     *
     * generate_cipher:
     *
     * we create a fast block cipher (aes-128-gcm is the fastest
     * HW accelerated cipher currently) and seed it using a random key & IV,
     * and then keep feeding zeros to it, which is guaranteed to return
     * quite unexpected bytes, aka random.
     *
     * From https://en.wikipedia.org/wiki/Galois/Counter_Mode:
     * "For any given key and initialization vector combination,
     * GCM is limited to encrypting (2^39−256) bits of plain text (64 GiB)"
     * This is why we need to recreate the cipher after some bytes.
     *
     * The speed of this mode is ~2500 MB/sec.
     *
     */
    generate_cipher(size) {
        if (!this.cipher || this.cipher_bytes > this.cipher_limit) {
            if (!this.zero_buffer) {
                this.zero_buffer = Buffer.alloc(this.chunk_size);
            }
            this.cipher_bytes = 0;
            this.cipher_limit = 1024 * 1024 * 1024;
            // aes-128-gcm requires 96 bits IV (12 bytes) and 128 bits key (16 bytes)
            const key_len = 16;
            const iv_len = 12;
            if (this.cipher) {
                this.cipher_seed = this.cipher.update(this.zero_buffer.slice(0, key_len + iv_len));
            } else if (!this.cipher_seed) {
                this.cipher_seed = crypto.randomBytes(key_len + iv_len);
            }
            const key = this.cipher_seed.slice(0, key_len);
            const iv = this.cipher_seed.slice(key_len, key_len + iv_len);
            this.cipher = crypto.createCipheriv('aes-128-gcm', key, iv);
        }
        const zero_bytes = size >= this.zero_buffer.length ?
            this.zero_buffer :
            this.zero_buffer.slice(0, size);
        this.cipher_bytes += zero_bytes.length;
        return this.cipher.update(zero_bytes);
    }

    /**
     *
     * generate_fake:
     *
     * we randomize one big buffer and use it multiple times
     * by picking random offsets inside it and slice bytes from that offset.
     *
     * fake_factor limits the bytes a random buffer yields
     * before being regenerated.
     * The larger it gets the less resistent it is against dedup.
     * The overall expected speed can be calculated by:
     * speed = fake_factor * speed(crypto.randomBytes)
     *
     * The speed of this mode is ~4500 MB/sec (with fake_factor=64)
     *
     */
    generate_fake(size) {
        if (!this.fake_buf || this.fake_bytes > this.fake_limit) {
            // The length of the slices returned are fixed and quite small.
            // Setting to small KB to avoid dedup in the scale of 256 KB.
            // The smaller it gets the more impact it imposes on
            // the stream consumer which will need to handle more buffers.
            this.fake_factor = 64;
            this.fake_slice = 16 * 1024;
            this.fake_buf_size = this.fake_factor * this.fake_slice;
            this.fake_offset_range = {
                min: 0,
                max: this.fake_buf_size - this.fake_slice
            };
            this.fake_bytes = 0;
            this.fake_limit = this.fake_factor * this.fake_buf_size;
            this.fake_buf = crypto.randomBytes(this.fake_buf_size);
        }
        const offset = crypto.randomInt(0, this.fake_buf_size - this.fake_slice);
        const buf = this.fake_buf.slice(offset, offset + this.fake_slice);
        this.fake_bytes += buf.length;
        return buf;
    }

    /**
     * generate_zeros:
     * 
     * The speed of this mode is ~7000 MB/sec.
     */
    generate_zeros(size) {
        return Buffer.alloc(size);
    }

    /**
     * generate_fill:
     * 
     * The speed of this mode is ~7000 MB/sec.
     */
    generate_fill(size) {
        return Buffer.alloc(size, crypto.randomInt(0, 256));
    }

    /**
     * generate_noinit:
     * 
     * Just allocates memory, no initialization.
     * Do not use if your process memory might contain sensitive data.
     * 
     * The speed of this mode is ~100,000 MB/sec.
     */
    generate_noinit(size) {
        return Buffer.allocUnsafe(size);
    }

    /**
     * implement the stream's Readable._read() function.
     */
    _read(requested_size) {
        const size = Math.min(requested_size, this.max_length - this.pos);
        if (size <= 0) {
            this.push(null);
            return;
        }
        const buf = this.generator(size);
        this.pos += buf.length;
        // nextTick is efficient, but need to limit the amount of
        // nextTick we use or otherwise if the stream consumer is also
        // a sync function it won't release the cpu.
        this.ticks += 1;
        if (this.ticks < 50) {
            process.nextTick(() => this.push(buf));
        } else {
            setImmediate(() => this.push(buf));
            this.ticks = 0;
        }
    }

}

module.exports = RandStream;
