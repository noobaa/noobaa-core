/* Copyright (C) 2016 NooBaa */
'use strict';

var stream = require('stream');

/**
 *
 * ChunkStream
 *
 * A transforming stream that chunks the input to fixes size chunks.
 *
 */
class ChunkStream extends stream.Transform {

    constructor(chunk_size, options) {
        super(options);
        this.chunk_size = chunk_size;
        this.pending_buffers = [];
        this.pending_bytes = 0;
    }


    /**
     * implement the stream's Transform._transform() function.
     */
    _transform(data, encoding, callback) {
        // console.log('ChunkStream transform', data.length);
        while (data && data.length) {
            let room = this.chunk_size - this.pending_bytes;
            let buf = (room < data.length) ? data.slice(0, room) : data;
            this.pending_buffers.push(buf);
            this.pending_bytes += buf.length;
            if (this.pending_bytes === this.chunk_size) {
                this._flush();
            }
            data = (room < data.length) ? data.slice(room) : null;
        }
        callback();
    }

    /**
     * implement the stream's Transform._flush() function.
     */
    _flush(callback) {
        if (this.pending_buffers.length) {
            // console.log('ChunkStream flush', this.pending_bytes, this.pending_buffers.length);
            this.push(this.pending_buffers);
            this.pending_buffers = [];
            this.pending_bytes = 0;
        }
        if (callback) {
            callback();
        }
    }
}

module.exports = ChunkStream;
