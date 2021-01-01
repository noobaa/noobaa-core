/* Copyright (C) 2016 NooBaa */
'use strict';

var _ = require('lodash');
var LRU = require('./lru');

/**
 * @template T params
 * @template K key
 * @template V val
 * @typedef LRUCacheItem
 * @property {K} id
 * @property {V} d
 * @property {Promise<void>} p
 */

/**
 * @template T params
 * @template K key
 * @template V val
 */
class LRUCache {

    /**
     * @param {{
     *  name: string,
     *  load: (t: T) => Promise<V>,
     *  validate?: (v: V, t: T) => Promise<boolean>,
     *  make_key?: (t: T) => K,
     *  make_val?: (t: T) => V,
     *  item_usage?: (v: V, t: T) => number,
     *  use_negative_cache?: boolean,
     *  max_usage?: number, // lru max length
     *  expiry_ms?: number, // time after which the item is considered expired
     * }} options
     */
    constructor(options) {
        this.name = options.name;
        this.load = options.load;
        this.validate = options.validate || ((data, params) => true);
        this.make_key = options.make_key || /** @type {(p:any)=>any} */ (params => params);
        this.make_val = options.make_val || ((data, params) => data);
        this.item_usage = options.item_usage;
        this.use_negative_cache = options.use_negative_cache;
        this.lru = new LRU({
            name: this.name,
            max_usage: options.max_usage || 100,
            expiry_ms: options.expiry_ms || 0,
        });
    }

    /**
     * get from cache, will load on cache miss, returns a promise.
     *
     * @param {T} params
     * @param {string} [cache_miss] pass the literal string 'cache_miss' to force fetching.
     * @returns {Promise<V>}
     */
    async get_with_cache(params, cache_miss) {
        const key = this.make_key(params);
        /** @type {LRUCacheItem<T,K,V>} */
        const item = this.lru.find_or_add_item(key);
        let valid = cache_miss !== 'cache_miss' &&
            (this.use_negative_cache ? 'd' in item : Boolean(item.d));
        // use cached item when not forcing cache_miss and still not expired by lru
        // also go to load if data is falsy and negative caching is off
        if (valid) valid = await this.validate(item.d, params);
        if (!valid) {
            // keep the promise in the item to synchronize when getting
            // concurrent get requests that miss the cache
            item.p = item.p || this._load_item(item, params);
            await item.p;
        }
        return this.make_val(item.d, params);
    }

    /**
     * @param {LRUCacheItem<T,K,V>} item
     * @param {T} params
     */
    async _load_item(item, params) {
        try {
            item.d = await this.load(params);
            if (this.item_usage) {
                const usage = this.item_usage(item.d, params);
                this.lru.set_usage(item, usage);
            }
        } finally {
            item.p = null;
        }
    }

    /**
     * peek_cache is returning the item if exists.
     * 
     * NOTE about peek vs. validations - since the validator is an async function and we don't want peek to be async,
     * we do not run validations on peek. The caller should inspect the data in the cache and decide how to use it
     * assuming validations are not called.
     * 
     * @param {T} params
     * @returns {V | undefined}
     */
    peek_cache(params) {
        let key = this.make_key(params);
        let item = this.lru.find_item(key);
        if (item && item.d) {
            return this.make_val(item.d, params);
        }
    }

    /**
     * @param {T} params
     * @param {V} data
     */
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
     * remove multiple items from the cache
     * @param {T[]} params
     */
    multi_invalidate(params) {
        return _.map(params, p => this.invalidate(p));
    }

    /**
     * remove multiple items from the cache
     * @param {K[]} keys
     */
    multi_invalidate_keys(keys) {
        return _.map(keys, key => this.invalidate_key(key));
    }

    /**
     * remove item from the cache
     * @param {T} params
     */
    invalidate(params) {
        var key = this.make_key(params);
        return this.invalidate_key(key);
    }

    /**
     * remove the key from the cache
     * @param {K} key
     */
    invalidate_key(key) {
        var item = this.lru.remove_item(key);
        if (item && item.val) {
            return item.val;
        }
    }

}

module.exports = LRUCache;
