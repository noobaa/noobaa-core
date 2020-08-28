/* Copyright (C) 2016 NooBaa */
'use strict';

const stream = require('stream');
const range_utils = require('./range_utils');

/**
 *
 * RangeStream
 *
 * A transforming stream that returns range of the input.
 *
 */
class RangeStream extends stream.Transform {

    // The input end is exclusive
    constructor(start, end, options) {
        super(options);
        this._start = start;
        this._end = end;
        this._pos = 0;
    }

    /**
     * implement the stream's Transform._transform() function.
     */
    _transform(data, encoding, callback) {
        const r = range_utils.intersection(this._start - this._pos, this._end - this._pos, 0, data.length);
        if (r) this.push(data.slice(r.start, r.end));
        this._pos += data.length;
        if (this._pos >= this._end) this.push(null);
        return callback();
    }
}

module.exports = RangeStream;
