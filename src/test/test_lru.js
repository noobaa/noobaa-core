// make jshint ignore mocha globals
// /* global describe, it, before, after, beforeEach, afterEach */
/* global describe, it */
'use strict';

// var _ = require('lodash');
var P = require('../util/promise');
var assert = require('assert');
var LRU = require('../util/lru');

describe('lru', function() {

    it('should hit and miss after remove', function() {
        var lru = new LRU();
        var item = lru.find_or_add_item(1);
        item.foo = 'bar';
        item = lru.find_or_add_item(1);
        assert.strictEqual(item.foo, 'bar');
        lru.remove_item(1);
        item = lru.find_or_add_item(1);
        assert.strictEqual(item.foo, undefined);
    });

    it('should remove item to make room', function() {
        var lru = new LRU({
            max_length: 1
        });
        var item = lru.find_or_add_item(1);
        item.foo = 'bar';
        item = lru.find_or_add_item(2);
        item = lru.find_or_add_item(1);
        assert.strictEqual(item.foo, undefined);
    });

    it('should remove expired item', function(done) {
        var lru = new LRU({
            expiry_ms: 10
        });
        var item = lru.find_or_add_item(1);
        item.foo = 'bar';
        P.delay(1).then(function() {
            item = lru.find_or_add_item(1);
            assert.strictEqual(item.foo, 'bar');
        }).delay(20).then(function() {
            item = lru.find_or_add_item(1);
            assert.strictEqual(item.foo, undefined);
        }).nodeify(done);
    });

    it('should return null for missing id', function() {
        var lru = new LRU();
        lru.find_or_add_item(1);
        assert(lru.remove_item(1));
        assert(!lru.remove_item(1));
    });

});
