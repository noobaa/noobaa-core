/* Copyright (C) 2016 NooBaa */
'use strict';

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

    constructor(input) {
        this._promise = new P((resolve, reject) => {
            this._resolve = resolve;
            this._reject = reject;
        });
        this._input = input;
        this._pipes = [];
        input.once('close', () => this.close(new Error('INPUT STREAM CLOSED UNEXPECTEDLY')));
        input.on('error', err => this.close(err));
    }

    pipe(next) {
        next.once('close', () => this.close());
        next.on('error', err => this.close(err));
        const prev = this._pipes.length ?
            this._pipes[this._pipes.length - 1] :
            this._input;
        prev.pipe(next);
        this._pipes.push(next);
        return this;
    }

    promise() {
        const last = this._pipes[this._pipes.length - 1];
        if (last instanceof stream.Writable) {
            last.on('finish', () => this._resolve());
        } else if (last instanceof stream.Readable) {
            last.on('end', () => this._resolve());
        }
        return this._promise;
    }

    close(err) {
        if (this._closed) return;
        this._closed = true;
        err = err || new Error('pipeline closed');
        this._reject(err);
        this._pipes.forEach(strm => strm.emit('close'));
    }

}

module.exports = Pipeline;
