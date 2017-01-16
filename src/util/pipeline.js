/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const P = require('../util/promise');
const stream = require('stream');

/**
 *
 * Pipeline
 *
 * Create a pipeline of transforming streams
 *
 */
class Pipeline {

    constructor() {
        this._line = [];
        this._promise = new P((resolve, reject) => {
            this._resolve = resolve;
            this._reject = reject;
        });
    }

    pipe(next) {
        next.once('close', () => this.close());
        next.on('error', err => this.close(err));
        const last = _.last(this._line);
        if (last) last.pipe(next);
        this._line.push(next);
        return this;
    }

    promise() {
        const last = _.last(this._line);
        if (last instanceof stream.Writable) {
            last.on('finish', () => this._resolve());
        } else if (last instanceof stream.Readable) {
            last.on('end', () => this._resolve());
        }
        return this._promise;
    }

    close(err) {
        err = err || new Error('pipeline closed');
        this._reject(err);
        _.each(this._line, strm => strm.emit('close'));
    }

}

module.exports = Pipeline;
