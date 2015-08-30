'use strict';

var _ = require('lodash');
var LinkedList = require('./linked_list');

module.exports = JobQueue;

// 'concurrency' with positive integer will do auto process with given concurrency level.
// use concurrency 0 for manual processing.
// 'delay' is number of milli-seconds between auto processing.
// name is optional in case multiple job queues (or linked lists)
// are used on the same elements.
var DEFAULT_PARAMS = {
    timeout: setTimeout,
    concurrency: 1,
    delay: 0,
    method: 'run',
    name: '',
};

function JobQueue(params) {
    this.params = _.defaults(_.pick(params, _.keys(DEFAULT_PARAMS)), DEFAULT_PARAMS);
    this._queue = new LinkedList(this.params.name);
    this._num_running = 0;
    Object.defineProperty(this, 'length', {
        enumerable: true,
        get: function() {
            return this._queue.length;
        }
    });
}

// add the given function to the jobs queue
// which will run it when time comes.
// job have its method property (by default 'run').
JobQueue.prototype.add = function(job) {
    this._queue.push_back(job);
    this.process(true);
};

JobQueue.prototype.remove = function(job) {
    return this._queue.remove(job);
};

JobQueue.prototype.process = function(check_concurrency) {
    var self = this;
    if (check_concurrency && self._num_running >= self.params.concurrency) {
        return;
    }
    var job = self._queue.pop_front();
    if (!job) {
        return;
    }
    self._num_running++;
    var ended = false;
    var end = function() {
        if (!ended) {
            self._num_running--;
            ended = true;
        }
        self.process(true);
    };
    // submit the job to run in background
    // to be able to return here immediately
    self.params.timeout(function() {
        try {
            var promise = job[self.params.method]();
            if (!promise || !promise.then) {
                end();
            } else {
                promise.then(end, end);
            }
        } catch (err) {
            console.error('UNCAUGHT EXCEPTION', err, err.stack);
            end();
        }
    }, self.params.delay);
};
