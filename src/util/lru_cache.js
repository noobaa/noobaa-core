'use strict';

var _ = require('lodash');
var P = require('../util/promise');
var LRU = require('./lru');
// var dbg = require('../util/debug_module')(__filename);

class LRUCache {

    /**
     * options (Object):
     * - load - loading function(key). can return a promise.
     * - max_usage: lru max length
     * - expiry_ms: time after which the item is considered expired
     */
    constructor(options) {
        options = options || {};
        this.name = options.name;
        this.load = options.load;
        this.validate = options.validate || function(item) {
            return item;
        };
        this.make_key = options.make_key || function(k) {
            return k;
        };
        this.make_val = options.make_val || function(data, params) {
            return data;
        };
        this.item_usage = options.item_usage;
        this.use_negative_cache = options.use_negative_cache;
        this.lru = new LRU(_.extend({
            max_usage: 100,
            expiry_ms: 60000, // default 1 minute
        }, options));
    }

    /**
     * get from cache, will load on cache miss, returns a promise.
     *
     * cache_miss (String) - pass the literal string 'cache_miss' to force fetching.
     *
     */
    get_with_cache(params, cache_miss) {
        return P.fcall(() => {
                var key = this.make_key(params);
                var item = this.lru.find_or_add_item(key);
                // use cached item when not forcing cache_miss and still not expired by lru
                // also go to load if data is falsy and negative caching is off
                if ('d' in item &&
                    (cache_miss !== 'cache_miss') &&
                    (this.use_negative_cache || item.d)) {
                    return P.when(this.validate(item.d, params))
                        .then(validated => validated ? item : this._load_item(item, params));
                } else {
                    return this._load_item(item, params);
                }
            })
            .then(item => this.make_val(item.d, params));
    }

    put_in_cache(params, data) {
        var key = this.make_key(params);
        var item = this.lru.find_or_add_item(key);
        item.d = data;
        if (this.item_usage) {
            let usage = this.item_usage(data, params);
            this.lru.set_usage(item, usage);
        }
    }

    /**
     * remove multiple keys from the cache
     */
    multi_invalidate(params) {
        return _.map(params, p => this.invalidate(p));
    }

    /**
     * remove the key from the cache
     */
    invalidate(params) {
        var key = this.make_key(params);
        return this.invalidate_key(key);
    }

    /**
     * remove the key from the cache
     */
    invalidate_key(key) {
        var item = this.lru.remove_item(key);
        if (item && item.val) {
            return item.val;
        }
    }

    _load_item(item, params) {
        // keep the promise in the item to synchronize when getting
        // concurrent get requests that miss the cache
        if (!item.p) {
            item.p = P.when(this.load(params))
                .then(data => {
                    item.p = null;
                    item.d = data;
                    if (this.item_usage) {
                        let usage = this.item_usage(data, params);
                        this.lru.set_usage(item, usage);
                    }
                    return item;
                }, err => {
                    item.p = null;
                    throw err;
                });
        }
        return item.p;
    }
}

module.exports = LRUCache;
