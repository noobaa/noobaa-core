/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const stream = require('stream');

const nb_native = require('./nb_native');

/**
 *
 * ChunkSplitter
 *
 * Split a data stream to chunks using native rabin sliding window hash
 *
 */
class ChunkSplitter extends stream.Transform {

    constructor({ watermark, chunk_split_config: { avg_chunk, delta_chunk }, calc_md5, calc_sha256 }) {
        super({
            objectMode: true,
            allowHalfOpen: false,
            highWaterMark: watermark,
        });
        this.split_batch = avg_chunk;
        this.state = {
            min_chunk: avg_chunk - delta_chunk,
            max_chunk: avg_chunk + delta_chunk,
            avg_chunk_bits: delta_chunk >= 1 ? Math.round(Math.log2(delta_chunk)) : 0,
            calc_md5: Boolean(calc_md5),
            calc_sha256: Boolean(calc_sha256),
        };
        this.pending_split = [];
        this.pending_split_len = 0;
        this.pending_encode = [];
        this.total_size = 0;
        this.num_parts = 0;
        this.pos = 0;
    }

    _transform(buf, encoding, callback) {
        try {
            this.split(buf, callback);
        } catch (err) {
            return callback(err);
        }
    }

    _flush(callback) {
        try {
            this.split(null, err => {
                if (err) return callback(err);
                try {
                    const res = nb_native().chunk_splitter(this.state);
                    this.md5 = res.md5;
                    this.sha256 = res.sha256;
                    return callback();
                } catch (err2) {
                    return callback(err2);
                }
            });
        } catch (err) {
            return callback(err);
        }
    }

    split(input_buf, callback) {
        if (input_buf) {
            this.pending_encode.push(input_buf);
            this.pending_split.push(input_buf);
            this.pending_split_len += input_buf.length;
            if (this.pending_split_len < this.split_batch) {
                return callback();
            }
        }
        nb_native().chunk_splitter(
            this.state,
            this.pending_split,
            (err, split_points) => {
                if (err) return callback(err);
                this.pending_split = input_buf ? [] : null;
                this.pending_split_len = 0;
                var index = 0;
                split_points.forEach(size => {
                    const data = [];
                    var pos = 0;
                    while (pos < size) {
                        const needed = size - pos;
                        const buf = this.pending_encode[index];
                        if (buf.length <= needed) {
                            pos += buf.length;
                            data.push(buf);
                            index += 1;
                        } else {
                            pos += needed;
                            data.push(buf.slice(0, needed));
                            this.pending_encode[index] = buf.slice(needed);
                        }
                    }
                    this.push({ data, size, pos: this.pos });
                    this.pos += size;
                });
                this.pending_encode = this.pending_encode.slice(index);
                if (!input_buf) {
                    const data = this.pending_encode;
                    const size = _.sumBy(data, 'length');
                    this.pending_encode = null;
                    if (size) {
                        this.push({ data, size, pos: this.pos });
                        this.pos += size;
                    }
                }
                return callback();
            }
        );
    }
}

module.exports = ChunkSplitter;
