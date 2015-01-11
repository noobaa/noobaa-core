'use strict';

var _ = require('lodash');
var Q = require('q');
var LRU = require('noobaa-util/lru');

module.exports = LRUCache;

/**
 * options (Object):
 * - load - loading function(key). can return a promise.
 * - max_length: lru max length
 * - expiry_ms: time after which the item is considered expired
 */
function LRUCache(options) {
    var self = this;
    options = options || {};
    self.load = options.load;
    self.name = options.name;
    self.make_key = options.make_key || function(k) {
        return k;
    };
    self.make_val = options.make_val || function(data, params) {
        return data;
    };
    self.use_negative_cache = options.use_negative_cache;
    self.lru = new LRU({
        max_length: options.max_length || 100,
        expiry_ms: options.expiry_ms || 60000, // default 1 minute
    });
}

/**
 * get from cache, will load on cache miss, returns a promise.
 *
 * cache_miss (String) - pass the literal string 'cache_miss' to force fetching.
 *
 */
LRUCache.prototype.get = function(params, cache_miss) {
    var self = this;
    return Q.fcall(function() {
            var key = self.make_key(params);
            var item = self.lru.find_or_add_item(key);

            // use cached item when not forcing cache_miss and still not expired by lru
            // also go to load if data is falsy and negative caching is off
            if ('d' in item &&
                (cache_miss !== 'cache_miss') &&
                (self.use_negative_cache || item.d)) {
                return item;
            }

            // keep the promise in the item to synchronize when getting
            // concurrent get requests that miss the cache
            if (!item.p) {
                item.p = Q.when(self.load(params))
                    .then(function(data) {
                        item.p = null;
                        item.d = data;
                        return item;
                    }, function(err) {
                        item.p = null;
                        throw err;
                    });
            }
            return item.p;
        })
        .then(function(item) {
            return self.make_val(item.d, params);
        });
};

/**
 * remove the key from the cache
 */
LRUCache.prototype.invalidate = function(params) {
    var key = this.make_key(params);
    return this.invalidate_key(key);
};

/**
 * remove the key from the cache
 */
LRUCache.prototype.invalidate_key = function(key) {
    var item = this.lru.remove_item(key);
    if (item && item.val) {
        return item.val;
    }
};
