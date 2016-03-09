'use strict';

let _ = require('lodash');
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

    constructor(params) {
        this.params = _.defaults(_.pick(params, _.keys(DEFAULT_PARAMS)), DEFAULT_PARAMS);
        this.list = new LinkedList(this.params.name);
        this.map = {};
        this.usage = 0;
    }

    // return the item from the LRU cache, create it if missing.
    find_or_add_item(id) {
        let item = this.map[id];
        let now = this.params.expiry_ms ? Date.now() : 0;
        if (item) {
            // check if not expired
            if (!this.params.expiry_ms || (now < item.time + this.params.expiry_ms)) {
                // hit - move to front to mark as recently used
                // fake update the usage - just to keep the length controlled
                this._update_usage(0);
                this.list.remove(item);
                this.list.push_front(item);
                return item;
            }
            // item expired
            this._remove_item(item);
        }
        // miss - insert new item on front
        item = new LRUItem(this, id, now);
        this._add_item(item);
        return item;
    }

    remove_item(id) {
        return this._remove_item(this.map[id]);
    }

    set_usage(item, usage) {
        if (!_.isNumber(usage)) {
            throw new TypeError('LRUItem usage should be a number');
        }
        this._update_usage(usage - item.usage);
        item.usage = usage;
    }

    _update_usage(diff) {
        this.usage += diff;
        while (this.usage > this.params.max_usage) {
            let item = this.list.get_back();
            this._remove_item(item);
        }
    }

    _add_item(item) {
        // make room for 1 new item
        this._update_usage(item.usage);
        this.map[item.id] = item;
        this.list.push_front(item);
    }

    _remove_item(item) {
        if (!item) return;
        this.list.remove(item);
        delete this.map[item.id];
        this._update_usage(-item.usage);
        return item;
    }

}


module.exports = LRU;
