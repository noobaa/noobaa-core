/* Copyright (C) 2016 NooBaa */
'use strict';

const P = require('../util/promise');
const WaitQueue = require('./wait_queue');
const dbg = require('./debug_module')(__filename);

class Semaphore {

    /**
     * construct a semaphore with initial count
     * params: Includes several parameters for the semaphore that could be:
     * timeout - The timeout for items in the waiting queue (on timeout error will be thrown and items released)
     * Note that when we have a timeout on items in the queue they don't run and just get thrown out
     * timeout_error_code - The error code that we are interested to throw (used in order to distinguish errors)
     * verbose - Flag which will perform additional debugging prints
     */
    constructor(initial, params) {
        this._value = to_sem_count(initial);
        this._waiting_value = 0;
        this._wq = new WaitQueue();
        if (params) {
            this._verbose = Boolean(params && params.verbose);
            if (params.timeout) {
                this._timeout = params.timeout;
            }
            this._timeout_error_code = params.timeout_error_code || 'SEMAPHORE_TIMEOUT';
        }
    }

    /**
     * surround the function call with a wait() and release()
     */
    surround(func) {
        return P.resolve()
            .then(() => this.wait())
            .then(() =>
                // Release should be called only when the wait was successful
                // If the item did not take any "resources"/value from the semaphore
                // Then we should not release it because it will just increase our semaphore value
                P.try(func).finally(() => this.release())
            );
    }

    /**
     * surround the function call with a wait(count) and release(count)
     */
    surround_count(count, func) {
        return P.resolve()
            .then(() => this.wait(count))
            .then(() =>
                // Release should be called only when the wait was successful
                // If the item did not take any "resources"/value from the semaphore
                // Then we should not release it because it will just increase our semaphore value
                P.try(func).finally(() => this.release(count))
            );
    }

    // read-only properties
    get length() {
        return this._wq.length;
    }

    get value() {
        return this._value;
    }

    // This property allows us to know what is the aggregated value of items in the waiting queue
    // Note that this is not the number of items in the waiting queue
    get waiting_value() {
        return this._waiting_value;
    }

    // This property allows us to know how much time the oldest item in the waiting queue been waiting
    // We are using this value in order to know the stress on the system
    get waiting_time() {
        const waiter = this._wq.head();
        return waiter ? Date.now() - waiter.time : 0;
    }

    /**
     *
     * wait on the semaphore if count cannot be allocated immediatly.
     * the semaphore is fair - so only the first waiter has the right to allocate.
     *
     * if count is not a number (like undefined) or negative, we assume count of 1.
     * if count===0 it will only wait if there are other waiters - which might be
     * useful in order to "get in the back of the line".
     *
     * returns undefined if was allocated immediately, or a promise that will be resolved
     * once the allocated ammount is available.
     *
     */
    wait(count) {
        count = to_sem_count(count);

        // if the queue is not empty we wait to keep fairness
        if (!this._wq.length && this._value >= count) {
            if (this._verbose) {
                dbg.log2('Semaphore wait updating value ', this._value, ' -> ',
                    this._value - count);
            }
            this._value -= count;
            return;
        }

        if (this._timeout && !this._timer) {
            this._timer = setTimeout(
                () => this._on_timeout(),
                this._timeout
            );
        }

        this._waiting_value += count;

        // push the waiter's count to the wait queue and return a promise
        const waiter = {
            count: count,
            time: Date.now(),
        };

        return this._wq.wait(waiter);
    }

    /**
     *
     * release count to the semaphore, and wakeup waiters if they can allocate now.
     *
     * if count is not a number (like undefined) or negative, we assume count of 1.
     * if count===0 it will only do wakeups if value is enough for the first waiter.
     *
     */
    release(count) {
        count = to_sem_count(count);

        if (this._verbose) {
            dbg.log2('Semaphore release updating value ', this._value, ' -> ',
                this._value + count);
        }

        this._value += count;

        while (this._value > 0) {
            // check if the first waiter can be woken up already
            const waiter = this._wq.head();
            if (!waiter || waiter.count > this._value) {
                break;
            }

            if (this._verbose) {
                dbg.log2('Semaphore release waking next worker, updating value ',
                    this._value, ' -> ', this._value - waiter.count);
            }

            this._value -= waiter.count;
            this._waiting_value -= waiter.count;
            this._wq.wakeup(waiter);
        }
    }

    _on_timeout() {
        const now = Date.now();

        clearTimeout(this._timer);
        this._timer = null;

        while (this._wq.head()) {
            // check if the first waiter should timeout
            const waiter = this._wq.head();
            const remaining = waiter.time + this._timeout - now;
            if (remaining > 0) {
                this._timer = setTimeout(() => this._on_timeout(), remaining);
                break;
            }

            const err = new Error('Semaphore Timeout');
            err.code = this._timeout_error_code;
            this._waiting_value -= waiter.count;
            this._wq.wakeup(waiter, err);
        }
    }

    /**
     * Pretty print of Semaphore internals
     */
    print() {
        return 'Semaphore: {value: ' + this._value + ', waitq.length:' + this._wq.length +
            '[' + this._wq.enum_items() + ']}';
    }

}

// if count is not a number (like undefined) or negative, we assume count of 1.
// NOTE that count===0 is a special case for wait/release - see comments above.
function to_sem_count(count) {
    return (typeof(count) === 'number' && count >= 0) ? (count | 0) : 1;
}

module.exports = Semaphore;
