'use strict';

// var _ = require('lodash');
var P = require('../util/promise');
var mocha = require('mocha');
var assert = require('assert');
var LRU = require('../util/lru');

mocha.describe('lru', function() {

    mocha.it('should hit and miss after remove', function() {
        var lru = new LRU();
        var item = lru.find_or_add_item(1);
        item.foo = 'bar';
        item = lru.find_or_add_item(1);
        assert.strictEqual(item.foo, 'bar');
        lru.remove_item(1);
        item = lru.find_or_add_item(1);
        assert.strictEqual(item.foo, undefined);
    });

    mocha.it('should remove item to make room', function() {
        var lru = new LRU({
            max_usage: 1
        });
        var item = lru.find_or_add_item(1);
        item.foo = 'bar';
        item = lru.find_or_add_item(2);
        item = lru.find_or_add_item(1);
        assert.strictEqual(item.foo, undefined);
    });

    mocha.it('should remove expired item', function() {
        var lru = new LRU({
            expiry_ms: 100
        });
        var item = lru.find_or_add_item(1);
        item.foo = 'bar';
        return P.delay(1).then(function() {
            item = lru.find_or_add_item(1);
            assert.strictEqual(item.foo, 'bar');
        }).delay(110).then(function() {
            item = lru.find_or_add_item(1);
            assert.strictEqual(item.foo, undefined);
        });
    });

    mocha.it('should return null for missing id', function() {
        var lru = new LRU();
        lru.find_or_add_item(1);
        assert(lru.remove_item(1));
        assert(!lru.remove_item(1));
    });

});
