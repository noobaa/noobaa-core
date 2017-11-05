/* Copyright (C) 2016 NooBaa */
'use strict';

const stream = require('stream');
const buffer_utils = require('./buffer_utils');

/**
 *
 * CoalesceStream
 *
 * A transforming stream that coalesces the input (buffers or objects).
 *
 */
class CoalesceStream extends stream.Transform {

    constructor(options) {
        super(options);
        this.object_mode = options.objectMode;
        this.max_length = options.max_length;
        this.max_wait_ms = options.max_wait_ms || 0;
        this.items = [];
        this.total_length = 0;
    }

    _transform(data, encoding, callback) {
        this.items.push(data);
        if (this.object_mode) {
            this.total_length += 1;
        } else {
            this.total_length += data.length;
        }
        if (this.total_length >= this.max_length) {
            this._flush();
        } else if (!this.timeout) {
            this.timeout = setTimeout(() => this._flush(), this.max_wait_ms);
        }
        return callback();
    }

    _flush(callback) {

        if (this.timeout) {
            clearTimeout(this.timeout);
            this.timeout = null;
        }

        if (this.items.length) {
            if (this.object_mode) {
                this.push(this.items);
            } else {
                this.push(buffer_utils.join(this.items, this.total_length));
            }
            this.items = [];
            this.total_length = 0;
        }

        if (callback) {
            return callback();
        }
    }
}

module.exports = CoalesceStream;
