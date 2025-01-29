/* Copyright (C) 2023 NooBaa */
'use strict';

const semaphore = require('./semaphore');

/**
 * DelayedTrigger is used to invoke a batch handling from smaller triggers.
 * For example collecting stats into a variable and sending it all once in a while.
 */
class DelayedTrigger {

    /**
     * @param {{
     *      delay: number;
     *      max_retries?: number;
     *      on_trigger: () => Promise<any>;
     * }} params
     */
    constructor({ delay, on_trigger, max_retries = Infinity }) {
        this._delay = delay;
        this._on_trigger = on_trigger;
        this._max_retries = max_retries;
        this._num_retries = 0;
        this._timer = null;
        this._sem = new semaphore.Semaphore(1);
    }

    trigger() {
        // when the timer is set we already have a trigger in place
        if (this._timer) return;

        // when there are any waiters on the semaphore queue it means we already have a trigger in place
        if (this._sem.length) return;

        // set a timer for the configured delay
        this._timer = setTimeout(async () => {

            // once the timer is called we can immediately unset the timer field before awaiting,
            // to allow any new trigger calls to register a new timer and not miss an update.
            this._timer = null;

            try {
                // if the function call takes too long, a new timer can be called already, 
                // but we don't want multiple functios to be called at the same time,
                // so we serialize the calls with a semaphore.
                await this._sem.surround(this._on_trigger);

                // reset retries count on success
                this._num_retries = 0;

            } catch (err) {

                // check if retries allow retrigger
                this._num_retries += 1;
                if (this._num_retries > this._max_retries) {
                    console.warn(`DelayedTrigger: on error (exhausted all ${this._max_retries} retries)`, err);
                    this._num_retries = 0;
                } else {
                    console.warn(`DelayedTrigger: on error (trigger retry #${this._num_retries} max ${this._max_retries})`, err);
                    this.trigger();
                }
            }

        }, this._delay).unref();
    }

    is_active() {
        return this.is_timer() || this.is_pending() || this.is_running();
    }
    is_timer() {
        return Boolean(this._timer);
    }
    is_pending() {
        return this._sem.length > 0;
    }
    is_running() {
        return this._sem.value !== 1;
    }

}

module.exports = DelayedTrigger;
