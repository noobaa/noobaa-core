/* Copyright (C) 2016 NooBaa */
'use strict';

// var _ = require('lodash');
var P = require('./promise');
var LinkedList = require('./linked_list');

const DIRECTION_FIFO = 'FIFO';
const DIRECTION_LIFO = 'LIFO';

class JobQueue {

    constructor(params) {
        this._name = (params && params.name) || '';
        this._concurrency = (params && params.concurrency) || 0;
        this._job_method = (params && params.job_method) || 'run';
        this._direction = (params && params.direction) || DIRECTION_FIFO;
        this._queue = new LinkedList(this._name);
        this._num_running = 0;
        Object.defineProperty(this, 'length', {
            enumerable: true,
            get: function() {
                return this._queue.length;
            }
        });
    }

    // add the given job to the jobs queue
    // which will run it when time comes.
    // job have its method property (by default 'run').
    add(job) {
        if (this._direction === DIRECTION_LIFO) {
            this._queue.push_front(job);
        } else {
            this._queue.push_back(job);
        }
        this.process(true);
    }

    remove(job) {
        return this._queue.remove(job);
    }

    process(check_concurrency) {
        if (check_concurrency && this._num_running >= this._concurrency) return;
        var job = this._queue.pop_front();
        if (!job) return;
        // submit the job to run in background
        // to be able to return here immediately
        this._num_running += 1;
        return P.try(() => job[this._job_method]())
            .finally(() => {
                this._num_running -= 1;
                setImmediate(() => this.process(true));
            });
    }
}


module.exports = JobQueue;
