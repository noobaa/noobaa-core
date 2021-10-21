/* Copyright (C) 2016 NooBaa */
'use strict';

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
        this._initial = to_sem_count(initial);
        this._value = this._initial;
        this._waiting_value = 0;
        this._wq = new WaitQueue();
        if (params) {
            this._verbose = Boolean(params && params.verbose);
            if (params.timeout) {
                this._timeout = params.timeout;
                this._timeout_error_code = params.timeout_error_code || 'SEMAPHORE_TIMEOUT';
            }
            if (params.work_timeout) {
                this._work_timeout = params.work_timeout;
                this._work_timeout_error_code = params.work_timeout_error_code || 'SEMAPHORE_WORKER_TIMEOUT';
            }
            if (params.warning_timeout) {
                this._warning_timeout = params.warning_timeout;
            }
        }
    }

    async _work_cap() {
        return new Promise((resolve, reject) => {
            const err = new Error('Semaphore Worker Timeout');
            err.code = this._work_timeout_error_code;
            const t = setTimeout(() => reject(err), this._work_timeout);
            t.unref();
        });
    }

    /**
     * surround the function call with a wait() and release()
     * @template T
     * @param {() => Promise<T>} func
     * @returns {Promise<T>}
     */
    async surround(func) {
        let warning_timer;
        await this.wait();
        try {
            if (this._warning_timeout) {
                // Capture the stack trace of the caller before registering the timer to identify the code that called it
                const err = new Error('Warning stuck surround item');
                warning_timer = setTimeout(() => console.error(err.stack), this._warning_timeout).unref();
            }
            // May lead to unaccounted work in the background on timeout
            return this._work_timeout ? Promise.race([func(), this._work_cap()]) : await func();
        } finally {
            if (warning_timer) clearTimeout(warning_timer);
            // Release should be called only when the wait was successful
            // If the item did not take any "resources"/value from the semaphore
            // Then we should not release it because it will just increase our semaphore value
            this.release();
        }
    }

    /**
     * surround the function call with a wait(count) and release(count)
     * @template T
     * @param {number} count
     * @param {() => Promise<T>} func
     * @returns {Promise<T>}
     */
    async surround_count(count, func) {
        let warning_timer;
        await this.wait(count);
        try {
            if (this._warning_timeout) {
                // Capture the stack trace of the caller before registering the timer to identify the code that called it
                const err = new Error('Warning stuck surround_count item');
                warning_timer = setTimeout(() => console.error(err.stack), this._warning_timeout).unref();
            }
            // May lead to unaccounted work in the background on timeout
            return this._work_timeout ? Promise.race([func(), this._work_cap()]) : await func();
        } finally {
            if (warning_timer) clearTimeout(warning_timer);
            // Release should be called only when the wait was successful
            // If the item did not take any "resources"/value from the semaphore
            // Then we should not release it because it will just increase our semaphore value
            this.release(count);
        }
    }

    /**
     * submit function without blocking only if there  is enough count.
     * @param {*} count
     * @param {*} func
     */
    submit_background(count, func) {
        if (!this.try_acquire_nonblocking(count)) return;

        setImmediate(async () => {
            try {
                await func();
            } finally {
                this.release(count);
            }
        });
    }

    /**
     * opportunistic acquire, only if no waiters and enough value.
     * @returns {boolean} true only if we actually managed to acquire the count from the semaphore value.
     */
    try_acquire_nonblocking(count) {
        count = to_sem_count(count);

        // if the queue is not empty we wait to keep fairness
        if (this._wq.length) return false;
        if (this._value < count) return false;
        if (this._verbose) {
            dbg.log2('Semaphore updating value ', this._value, ' -> ', this._value - count);
        }
        this._value -= count;
        return true;
    }

    is_empty() {
        return this._value === this._initial && !this._wq.length;
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
    async wait(count) {
        if (this.try_acquire_nonblocking(count)) return;

        count = to_sem_count(count);

        if (this._timeout && !this._timer) {
            this._timer = setTimeout(
                () => this._on_timeout(),
                this._timeout
            );
            this._timer.unref();
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
    return (typeof(count) === 'number' && count >= 0) ? Math.floor(count) : 1;
}

module.exports = Semaphore;
