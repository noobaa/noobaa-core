'use strict';

var _ = require('lodash');
var Q = require('q');
var LRU = require('noobaa-util/lru');

module.exports = DBCache;

/**
 * options (Object):
 * - load - loading function(key). can return a promise.
 * - max_length: lru max length
 * - expiry_ms: time after which the item is considered expired
 */
function DBCache(options) {
    var self = this;
    options = options || {};
    self.key_stringify = options.key_stringify || function(k) {
        return k;
    };
    self.load = options.load;
    self.name = options.name;
    self.lru = new LRU({
        max_length: options.max_length || 100,
        expiry_ms: options.expiry_ms || 60000, // default 1 minute
    });
}

/**
 * get from cache, will load on cache miss, returns a promise.
 *
 * force_miss (String) - pass the literal string 'force_miss' to force fetching.
 *
 */
DBCache.prototype.get = function(key, force_miss) {
    var self = this;
    return Q.fcall(function() {
        var item = self.lru.find_or_add_item(self.key_stringify(key));

        // use cached item when not expired
        if (force_miss !== 'force_miss') {
            if (item.missing) {
                return;
            }
            if (item.doc) {
                return item.doc;
            }
        }

        // load from the database
        console.log('CACHE MISS', self.name, key);
        return self.load(key).then(function(doc) {
            if (doc) {
                // update the cache item
                item.doc = doc;
                item.missing = null;
            } else {
                // mark entry as missing - aka negative cache
                item.missing = true;
                item.doc = null;
            }
            return doc;
        });
    });
};

/**
 * remove the key from the cache
 */
DBCache.prototype.invalidate = function(key) {
    var item = this.lru.remove_item(key);
    if (item && item.doc) {
        return item.doc;
    }
};
