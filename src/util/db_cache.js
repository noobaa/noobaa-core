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
 * bypass (String) - pass the literal string 'bypass' to force fetching.
 *
 */
DBCache.prototype.get = function(key, bypass) {
    var self = this;
    return Q.fcall(
        function() {
            var item = self.lru.find_or_add_item(key);

            // use cached item when not expired
            if (bypass !== 'bypass') {
                if (item.missing) {
                    return;
                }
                if (item.doc) {
                    return item.doc;
                }
            }

            // load from the database
            console.log('CACHE MISS', self.name, key);
            return self.load(key).then(
                function(doc) {
                    if (doc) {
                        // update the cache item
                        item.doc = doc;
                        delete item.missing;
                    } else {
                        // mark entry as missing - aka negative cache
                        item.missing = true;
                        delete item.doc;
                    }
                    return doc;
                }
            );
        }
    );
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
