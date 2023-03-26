/* Copyright (C) 2023 NooBaa */
'use strict';

const DeleyedTrigger = require('./delayed_trigger');

/**
 * DelayedCollector is a utility used to collect a stream of update information in memory 
 * for some delay before processing it as a combined update.
 * 
 * Notes:
 * - Uses `DelayedTrigger` to implement the delay.
 * - Requires a merge function to reduce two data objects into one (e.g lodash `_.mergeWith()`).
 * - Invokes an async processing function to submit the triggered update.
 * - On processing error will merge the new data back onto the failed data, to avoid missing any updates.
 * 
 * @template {{}} T
 */
class DelayedCollector extends DeleyedTrigger {

    /**
     * @param {{
     *      delay: number;
     *      max_retries?: number;
     *      merge_func: (data: Partial<T>, updates: Partial<T>) => void;
     *      process_func: (data: Partial<T>) => Promise<void>;
     * }} params
     */
    constructor({ delay, merge_func, process_func, max_retries = Infinity }) {
        super({
            delay,
            max_retries,
            on_trigger: () => this._process_data(),
        });
        this._merge_func = merge_func;
        this._process_func = process_func;
        this._data = {};
    }

    /**
     * @param {Partial<T>} updates
     * @param {boolean} [skip_trigger]
     * @returns 
     */
    update(updates, skip_trigger = false) {
        this._merge_func(this._data, updates);
        if (!skip_trigger) this.trigger();
    }

    async _process_data() {
        const data = this._data;
        this._data = {};
        try {
            await this._process_func(data);
        } catch (err) {
            // merge new collected data *onto* the previous data
            // to keep the timeline order of those updates 
            // (in case merge is not commutative)
            this._merge_func(data, this._data);
            this._data = data;
            throw err;
        }
    }

}

module.exports = DelayedCollector;
