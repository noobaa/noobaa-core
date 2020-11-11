/* Copyright (C) 2016 NooBaa */
'use strict';

const mocha = require('mocha');
const assert = require('assert');
const LRUCache = require('../../util/lru_cache');

mocha.describe('lru_cache', function() {

    // this is the data we are "caching" in this test
    const items = {
        a: 1,
        b: 2,
        c: 3,
        d: 4,
    };

    // these counters allow us to verify the cache did what we expected it
    let num_loads = 0;
    let num_validates = 0;

    // Single cache instance for the following test cases
    const cache = new LRUCache({
        max_usage: 3, // using a max_usage to test eviction of "least recently used" items
        make_key({ key }) {
            return key;
        },
        async load({ key }) {
            num_loads += 1;
            return items[key];
        },
        async validate(val, { key }) {
            num_validates += 1;
            return items[key] === val;
        },
    });

    mocha.it('should load when first use of key', async function() {
        assert.strictEqual(await cache.get_with_cache({ key: 'a' }), 1);
        assert.strictEqual(num_loads, 1);
        assert.strictEqual(num_validates, 0);
    });
    mocha.it('should skip load if validated from cache', async function() {
        assert.strictEqual(await cache.get_with_cache({ key: 'a' }), 1);
        assert.strictEqual(num_loads, 1);
        assert.strictEqual(num_validates, 1);
    });
    mocha.it('should reload if validate returns false', async function() {
        items.a = 666;
        assert.strictEqual(await cache.get_with_cache({ key: 'a' }), 666);
        assert.strictEqual(num_loads, 2);
        assert.strictEqual(num_validates, 2);
    });
    mocha.it('should reload after manual invalidate', async function() {
        items.a = 90210;
        cache.invalidate({ key: 'a' });
        assert.strictEqual(await cache.get_with_cache({ key: 'a' }), 90210);
        assert.strictEqual(num_loads, 3);
        assert.strictEqual(num_validates, 2);
    });
    mocha.it('should reload after evicted down the lru', async function() {
        items.a = 1;
        assert.strictEqual(await cache.get_with_cache({ key: 'b' }), 2);
        assert.strictEqual(num_loads, 4);
        assert.strictEqual(num_validates, 2);
        assert.strictEqual(await cache.get_with_cache({ key: 'c' }), 3);
        assert.strictEqual(num_loads, 5);
        assert.strictEqual(num_validates, 2);
        assert.strictEqual(await cache.get_with_cache({ key: 'd' }), 4);
        assert.strictEqual(num_loads, 6);
        assert.strictEqual(num_validates, 2);
        assert.strictEqual(await cache.get_with_cache({ key: 'a' }), 1);
        assert.strictEqual(num_loads, 7);
        assert.strictEqual(num_validates, 2);
        assert.strictEqual(cache.lru.usage, 3);
        assert.strictEqual(cache.peek_cache({ key: 'a' }), 1);
        assert.strictEqual(cache.peek_cache({ key: 'b' }), undefined); // b was evicted because max_usage is 3
        assert.strictEqual(cache.peek_cache({ key: 'c' }), 3);
        assert.strictEqual(cache.peek_cache({ key: 'd' }), 4);
    });

});
