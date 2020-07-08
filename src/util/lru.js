/* Copyright (C) 2016 NooBaa */
'use strict';

let _ = require('lodash');
let assert = require('assert');
let LinkedList = require('./linked_list');

let DEFAULT_PARAMS = {
    max_usage: 32,
    expiry_ms: 0,
    name: '',
};

class LRUItem {

    constructor(lru, id, time) {
        this.lru = lru;
        this.id = id;
        this.time = time;
        this.usage = 1;
    }

}

class LRU {

    /**
     * @param {{
     *  max_usage?: number,
     *  expiry_ms?: number,
     *  name?: string,
     * }} params
     */
    constructor(params) {
        this.params = _.defaults(_.pick(params, _.keys(DEFAULT_PARAMS)), DEFAULT_PARAMS);
        this.list = new LinkedList(this.params.name);
        this.map = new Map();
        this.usage = 0;
    }

    // return the item from the LRU cache, create it if missing.
    find_or_add_item(id) {
        let item = this.find_item(id);
        if (!item) {
            // miss - insert new item on front
            let now = this.params.expiry_ms ? Date.now() : 0;
            item = new LRUItem(this, id, now);
            this._add_item(item);
        }
        return item;
    }

    // return the item from the LRU cache, create it if missing.
    find_item(id) {
        let item = this.map.get(id);
        let now = this.params.expiry_ms ? Date.now() : 0;
        if (item) {
            // check if not expired
            if (!this.params.expiry_ms || (now < item.time + this.params.expiry_ms)) {
                // hit - move to front to mark as recently used
                if (this.list.remove(item)) {
                    this.list.push_front(item);
                }
                // fake update the usage - just to keep the length controlled
                this._update_usage(0);
                return item;
            }
            // item expired
            this._remove_item(item);
        }
    }

    remove_item(id) {
        return this._remove_item(this.map.get(id));
    }

    set_usage(item, usage) {
        if (!_.isNumber(usage)) {
            throw new TypeError('LRUItem usage should be a number');
        }
        // setting the item usage before updating
        // so that if the update will decides to discard this
        // current item it will be able to account it.
        let diff = usage - item.usage;
        item.usage = usage;
        if (this.list.is_linked(item)) {
            this._update_usage(diff);
        }
    }

    is_linked(item) {
        return this.list.is_linked(item);
    }

    _update_usage(diff) {
        this.usage += diff;
        while (this.usage > this.params.max_usage && this.list.length) {
            let item = this.list.get_back();
            this._remove_item(item);
        }
    }

    _add_item(item) {
        // make room for 1 new item
        this.map.set(item.id, item);
        this.list.push_front(item);
        this._update_usage(item.usage);
    }

    _remove_item(item) {
        if (!item) return;
        this.list.remove(item);
        this.map.delete(item.id);
        this._update_usage(-item.usage);
        return item;
    }

    _sanity() {
        // now count the real usage
        let usage = 0;
        let item = this.list.get_front();
        while (item) {
            usage += item.usage;
            assert.strictEqual(this.map.get(item.id), item);
            item = this.list.get_next(item);
        }
        assert.strictEqual(this.usage, usage);
        assert(usage <= this.params.max_usage);
    }

}


module.exports = LRU;
