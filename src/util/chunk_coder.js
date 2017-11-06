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

    constructor({ watermark, concurrency, coder, chunk_coder_config }) {
        super({
            objectMode: true,
            allowHalfOpen: false,
            highWaterMark: watermark,
        });
        this.concurrency = concurrency;
        this.coder = coder;
        this.chunk_coder_config = chunk_coder_config;
        this.semaphore = new Semaphore(concurrency);
        if (!ChunkCoder.semaphore) {
            ChunkCoder.semaphore = new Semaphore(concurrency);
        }
        this.chunks = [];
    }

    _transform(chunk, encoding, callback) {
        // this is a bit confusing at first sight but bear with me here:
        // after acquiring the semaphores, we immediately flush all completed
        // chunks to the stream, and also immediately call the transform callback
        // which will "release" more incoming chunks to make new _transform calls
        // in concurrency.
        // then we go and process the pending incoming chunk and keep holding
        // the semaphores while processing it, so that any new _transform calls
        // will run in parallel but only up to the concurrency allowed by the semaphores.
        this.semaphore.surround(() =>
                ChunkCoder.semaphore.surround(() => {
                    this._flush_completed_chunks(callback);
                    return this._process_incoming_chunk(chunk);
                })
            )
            .catch(err => this.emit('error', err));
    }

    _flush(callback) {
        // consume all the semaphore to wait for running transforms to complete
        this.semaphore.surround_count(this.concurrency, () => {
                this._flush_completed_chunks(callback);
            })
            .catch(err => this.emit('error', err));
    }

    _flush_completed_chunks(callback) {
        if (this.chunks.length) {
            this.push(this.chunks);
            this.chunks = [];
        }
        return callback();
    }

    _process_incoming_chunk(chunk) {
        chunk.coder = this.coder;
        if (this.chunk_coder_config) chunk.chunk_coder_config = this.chunk_coder_config;
        return P.fromCallback(cb => nb_native().chunk_coder(chunk, cb))
            .then(() => this.chunks.push(chunk));
    }
}

module.exports = ChunkCoder;
