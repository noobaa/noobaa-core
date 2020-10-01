/* Copyright (C) 2016 NooBaa */
'use strict';

const stream = require('stream');

const P = require('./promise');
const Semaphore = require('./semaphore');
const nb_native = require('./nb_native');

/**
 *
 * ChunkCoder
 *
 * Transform stream that runs native coding function from ./src/native/coding/
 * Use concurrency to run all chunks in parallel.
 *
 */
class ChunkCoder extends stream.Transform {

    constructor({ watermark, concurrency, coder, chunk_coder_config, cipher_key_b64 }) {
        super({
            objectMode: true,
            allowHalfOpen: false,
            highWaterMark: watermark,
        });
        this.coder = coder;
        this.cipher_key_b64 = cipher_key_b64;
        this.chunk_coder_config = chunk_coder_config;
        this.stream_promise = P.resolve();
        // using both local and global semaphore to avoid one stream overwhelming the global sem
        this.stream_sem = new Semaphore(concurrency);
        ChunkCoder.global_sem = ChunkCoder.global_sem || new Semaphore(concurrency);
    }

    // Our goal here is to process chunks in concurrency.
    // this code is a bit confusing at first sight but bear with me here:
    //
    // We acquire two semaphores:
    // - stream_sem limits the concurrency per stream.
    // - global_sem limits the global concurrency by all streams in the process.
    //
    // The reason we need stream_sem is to avoid starvation by one stream to other streams.
    // 
    // Under the semaphores we do the following:
    // - Submit the chunk for coding.
    // - Wait for the chunk coding and also the previous chunks before pushing down the stream to keep stream order.
    // - We *synchronously* call the transform stream callback because we want to accept more incoming chunks 
    //      from the stream which will call _transform in concurrency - the semaphores will limit it.
    // - We return the chunk coder promise so that the semaphores will wait for it.
    _transform(chunk, encoding, callback) {
        this.stream_sem.surround(() => ChunkCoder.global_sem.surround(() => {
                chunk.chunk_coder_config = chunk.chunk_coder_config || this.chunk_coder_config;
                if (this.cipher_key_b64) chunk.cipher_key_b64 = this.cipher_key_b64;
                const chunk_promise = P.fromCallback(cb => nb_native().chunk_coder(this.coder, chunk, cb));
                // TODO: Need to remove the cipher_key in case of SSE-C
                this.stream_promise = Promise.all([chunk_promise, this.stream_promise]).then(() => this.push(chunk));
                callback();
                return chunk_promise;
            }))
            .catch(err => this.emit('error', err));
    }

    // consume all the semaphore to wait for running transforms to complete
    _flush(callback) {
        this.stream_promise.then(() => callback())
            .catch(err => this.emit('error', err));
    }
}

ChunkCoder.global_sem = undefined;

module.exports = ChunkCoder;
