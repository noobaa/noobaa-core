// this module is written for both nodejs, or for client with browserify.
'use strict';

var P = require('../util/promise');
var WaitQueue = require('./wait_queue');
var dbg = require('./debug_module')(__filename);

module.exports = Semaphore;

// construct a semaphore with initial count.
function Semaphore(initial, verbose) {
    initial = (typeof(initial) === 'number') ? (initial | 0) : 0;
    this._value = initial;
    this._wq = new WaitQueue();

    // read-only properties
    Object.defineProperty(this, 'length', {
        enumerable: true,
        get: function() {
            return this._wq.length;
        }
    });
    Object.defineProperty(this, 'value', {
        enumerable: true,
        get: function() {
            return this._value;
        }
    });

    if (verbose) {
        this._verbose = true;
    } else {
        this._verbose = false;
    }
}

// wait on the semaphore if count cannot be allocated immediatly.
// the semaphore is fair - so only the first waiter has the right to allocate.
//
// returns undefined if was allocated immediately, or a promise that will be resolved
// once the allocated ammount is available,
Semaphore.prototype.wait = function(count) {
    // if count is not a number (like undefined) or negative, we assume count of 1.
    // if count===0 it will only wait if there are other waiters - which might be
    //    useful in order to "get in the back of the line".
    count = (typeof(count) === 'number' && count >= 0) ? (count | 0) : 1;

    // if the queue is not empty we wait to keep fairness
    if (!this._wq.length && this._value >= count) {
        if (this._verbose) {
            dbg.log2('Semaphore wait updating value ', this._value, ' -> ',
                this._value - count);
        }
        this._value -= count;
        return;
    }

    // push the waiter's count to the wait queue and return a promise
    return this._wq.wait({
        count: count
    });
};

// release count to the semaphore, and wakeup waiters if they can allocate now.
Semaphore.prototype.release = function(count) {
    // if count is not a number (like undefined) or negative, we assume count of 1.
    // if count===0 it will only do wakeups if value is enough for the first waiter.
    count = (typeof(count) === 'number' && count >= 0) ? (count | 0) : 1;

    if (this._verbose) {
        dbg.log2('Semaphore release updating value ', this._value, ' -> ',
            this._value + count);
    }

    this._value += count;

    while (1) {
        // check if the first waiter can be woken up already
        var waiter = this._wq.head();
        if (!waiter || waiter.count > this._value) {
            break;
        }

        if (this._verbose) {
            dbg.log2('Semaphore release waking next worker, updating value ',
                this._value, ' -> ', this._value - waiter.count);
        }

        this._value -= waiter.count;
        this._wq.wakeup(waiter);
    }
};

// surround the function call with a wait(count) and release(count)
// count is optional.
Semaphore.prototype.surround = function(count, func) {
    var self = this;
    if (typeof(func) === 'undefined') {
        func = count;
        count = undefined;
    }
    return P.resolve(self.wait(count)).then(func).finally(function() {
        self.release(count);
    });
};

// Pretty print of Semaphore internals
Semaphore.prototype.print = function() {
    return 'Semaphore: {value: ' + this._value + ', waitq.length:' + this._wq.length +
        '[' + this._wq.enum_items() + ']}';
};
