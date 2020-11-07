/* Copyright (C) 2016 NooBaa */
'use strict';

const LinkedList = require('../util/linked_list');


/**
 * Prefetch loads and keeps items in memory.
 * once items are fetched it will prefetch more.
 * @template T
 */
class Prefetch {

    /**
     * @param {{
     *  low_length?: number, // length under which we prefetch more
     *  high_length?: number, // length over which we stop prefetching
     *  expiry_ms?: number // time after which items will be removed
     *  load: (count:number)=>Promise<T[]>, // returns list of items,
     * }} options
     */
    constructor(options) {
        options = options || {};
        this.low_length = options.low_length || 100;
        this.high_length = options.high_length || 200;
        this.expiry_ms = options.expiry_ms; // default is no expiry
        this.load = options.load;
        this._length = 0;
        this._groups = new LinkedList();
        this._trigger_prefetch();
    }

    get length() {
        return this._length;
    }

    /**
     * fetch will wait for min_count items to be available.
     * will return no more than max_count items.
     * @param {number} [min_count]
     * @param {number} [max_count]
     * @returns {Promise<T|T[]>} a promise to an array of items or single item.
     */
    async fetch(min_count, max_count) {
        const items = [];
        min_count = min_count || 1;
        max_count = max_count || min_count;
        await this._fetch(items, min_count, max_count);
        return items.length > 1 ? items : items[0];
    }


    /**
     * _fetch adds items to the provided array, and waits for prefetch if needed.
     * @param {T[]} items array to fill
     * @param {number} target_length stop when items array reaches this length
     */
    async _fetch(items, min_count, max_count) {
        this._pop_items(items, max_count);
        // while min_count is not available call prefetch and repeat
        while (items.length < min_count) {
            await this._prefetch();
            this._pop_items(items, max_count);
        }
    }


    /**
     * _pop_items
     *
     * pop prefetched items and add to the provided items array
     * uses existing items only, without prefetching more,
     * so may return with less item than target.
     *
     * @param {T[]} items array to fill
     * @param {number} target_length stop when items array reaches this length
     */
    _pop_items(items, target_length) {
        let group = this._groups.get_front();
        if (!group) return;
        while (items.length < target_length) {
            items.push(group.items.pop());
            this._length -= 1;
            if (!group.items.length) {
                this._remove_group(group);
                group = this._groups.get_front();
                if (!group) return;
            }
        }
        this._trigger_prefetch();
    }

    _remove_group(group) {
        clearTimeout(group.timeout);
        group.timeout = null;
        this._length -= group.items.length;
        this._groups.remove(group);
    }

    _expire_group(group) {
        this._remove_group(group);
        this._trigger_prefetch();
    }

    _trigger_prefetch() {
        if (this._length < this.low_length) {
            setImmediate(() => this._prefetch());
        }
    }

    /**
     * _prefetch
     * @returns {Promise<T[]> array of items.
     */
    async _prefetch() {
        if (this._prefetch_promise) return this._prefetch_promise;
        this._prefetch_promise = (async () => {
            try {
                const items = await this.load(this.high_length - this._length);
                // keep loaded items as a group
                // in order to use array.pop() instead of array.shift()
                // we reverse the returned order of items.
                const group = { items: items.slice().reverse() };
                if (this.expiry_ms) {
                    group.timeout = setTimeout(
                        this._remove_group.bind(this, group), this.expiry_ms);
                }
                this._length += items.length;
                this._groups.push_back(group);
            } catch (err) {
                console.error('PREFETCH ERROR', err);
            } finally {
                // keep triggering if needed
                // we don't wait for _trigger_prefetch in order for
                // fetch() to try popping asap and release the caller
                // (need to nullify promise before recursion)
                this._prefetch_promise = null;
                this._trigger_prefetch();
            }
        })();
        return this._prefetch_promise;
    }

}

module.exports = Prefetch;
