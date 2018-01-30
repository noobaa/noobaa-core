/* Copyright (C) 2016 NooBaa */
'use strict';

var stream = require('stream');

/**
 * SliceReader is a Readable stream that uses slice on a source object.
 * params is also used for stream.Readable options: highWaterMark, decodeStrings, objectMode, etc.
 */
class SliceReader extends stream.Readable {

    constructor(source, params) {
        params = params || {};
        super(params);
        this._source = source;
        this._pos = Number.isInteger(params.start) ? params.start : 0;
        this._end = Number.isInteger(params.end) ? params.end : Infinity;
    }

    /**
     * implement Readable._read()
     */
    _read(requested_size) {
        try {
            const end = Math.min(this._end, this._pos + requested_size);
            const slice = this._source.slice(this._pos, end);
            if (slice.length) {
                this._pos += slice.length;
                this.push(slice);
            } else {
                this.push(null); // EOF
            }
        } catch (err) {
            this.emit('error', err);
        }
    }

}

module.exports = SliceReader;
