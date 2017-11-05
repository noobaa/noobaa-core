/* Copyright (C) 2016 NooBaa */
'use strict';

const stream = require('stream');

/**
 *
 * FlattenStream
 *
 * A transforming stream that flattens arrays.
 *
 */
class FlattenStream extends stream.Transform {

    constructor() {
        super({
            objectMode: true,
            allowHalfOpen: false,
        });
    }

    _transform(data, encoding, callback) {
        if (Array.isArray(data)) {
            data.forEach(item => this.push(item));
        } else {
            this.push(data);
        }
        return callback();
    }

}

module.exports = FlattenStream;
