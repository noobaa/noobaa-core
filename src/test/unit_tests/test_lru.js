/* Copyright (C) 2016 NooBaa */
'use strict';

const mocha = require('mocha');
const assert = require('assert');

const P = require('../../util/promise');
const LRU = require('../../util/lru');

mocha.describe('lru', function() {

    mocha.it('should hit and miss after remove', function() {
        const lru = new LRU();
        lru._sanity();

        let item = lru.find_or_add_item(1);
        item.foo = 'bar';
        lru._sanity();

        item = lru.find_or_add_item(1);
        assert.strictEqual(item.foo, 'bar');
        lru._sanity();

        lru.remove_item(1);
        lru._sanity();

        item = lru.find_or_add_item(1);
        assert.strictEqual(item.foo, undefined);
        lru._sanity();
    });

    mocha.it('should remove item to make room', function() {
        const lru = new LRU({
            max_usage: 1
        });
        lru._sanity();

        let item = lru.find_or_add_item(1);
        item.foo = 'bar';
        lru._sanity();

        item = lru.find_or_add_item(2);
        lru._sanity();

        item = lru.find_or_add_item(1);
        assert.strictEqual(item.foo, undefined);
        lru._sanity();
    });

    mocha.it('should remove expired item', async function() {
        const lru = new LRU({
            expiry_ms: 100
        });
        lru._sanity();

        let item = lru.find_or_add_item(1);
        item.foo = 'bar';
        lru._sanity();

        await P.delay(1);

        item = lru.find_or_add_item(1);
        assert.strictEqual(item.foo, 'bar');
        lru._sanity();

        await P.delay(110);

        lru._sanity();
        item = lru.find_or_add_item(1);
        assert.strictEqual(item.foo, undefined);
        lru._sanity();
    });

    mocha.it('should return null for missing id', function() {
        const lru = new LRU();
        lru._sanity();

        lru.find_or_add_item(1);
        assert(lru.remove_item(1));
        assert(!lru.remove_item(1));
        lru._sanity();
    });

    mocha.it('should handle max_usage = 0', function() {
        const lru = new LRU({
            max_usage: 0,
        });
        lru._sanity();

        let item = lru.find_or_add_item(1);
        assert(item);
        assert.strictEqual(lru.usage, 0);
        assert.strictEqual(item.usage, 1);
        lru._sanity();

        lru.set_usage(item, 3);
        assert.strictEqual(item.usage, 3);
        assert.strictEqual(lru.usage, 0);
        lru._sanity();

        let item1 = lru.find_or_add_item(1);
        assert(item1 !== item);
        lru._sanity();
    });

    mocha.it('should respect max_usage', function() {
        const MAX_USAGE = 1000;
        const lru = new LRU({
            max_usage: MAX_USAGE,
        });
        lru._sanity();

        for (let i = 0; i < 1000; ++i) {
            let key = Math.floor(100 * Math.random());
            let item = lru.find_or_add_item(key);
            lru.set_usage(item, Math.floor(MAX_USAGE * Math.random()));
            lru._sanity();
        }
    });

});
