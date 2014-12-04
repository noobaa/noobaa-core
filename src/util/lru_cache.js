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
    self.make_val = options.make_val || function(v, params) {
        return v;
    };
    self.disable_negative_cache = options.disable_negative_cache;
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
        if (cache_miss !== 'cache_miss') {
            if (item.promise) {
                return item.promise;
            }
            if (item.negative && !self.disable_negative_cache) {
                return;
            }
            if (item.doc) {
                return self.make_val(item.doc, params);
            }
        }

        // load from the database
        console.log('CACHE MISS', self.name, key, params);
        item.promise = self.load(params);
        return Q.when(item.promise).then(function(doc) {
            item.promise = null;
            if (doc) {
                // update the cache item
                item.doc = doc;
                item.negative = false;
            } else {
                // mark entry as negative - aka negative cache
                item.negative = true;
                item.doc = null;
            }
            return self.make_val(doc, params);
        });
    });
};

/**
 * remove the key from the cache
 */
LRUCache.prototype.invalidate = function(key) {
    var item = this.lru.remove_item(key);
    if (item && item.doc) {
        return item.doc;
    }
};
