/* Copyright (C) 2016 NooBaa */
'use strict';

const { make_array } = require('./js_utils');

const alloc_empty_obj = () => ({});
const noop = () => { /* noop */ };

const rz_policy = Object.freeze({
    NO_RESIZE: 1,
    GROW_WHEN_EMPTY: 2,
    GROW_AND_SHRINK: 3
});

class ObjectPool {
    static get resize_policy() {
        return rz_policy;
    }

    get capacity() {
        return this._items.length;
    }

    get available() {
        return this.capacity - this._next;
    }

    constructor(capacity, options = {}) {
        const {
            allocator,
            initializer,
            empty_value = null,
            resize_policy = rz_policy.GROW_WHEN_EMPTY
        } = options;

        if (!capacity && resize_policy === rz_policy.NO_RESIZE) {
            console.warn('ObjectPool - Invalid operation, cannot create a pool without capacity');
        }

        this._initalize = initializer || noop;
        this._empty_value = empty_value;
        this._resize_policy = resize_policy;
        this._next = 0;

        this._allocate = allocator || alloc_empty_obj;
        this._items = make_array(capacity, this._allocate);
    }

    alloc() {
        if (this._next === this.capacity) {
            if (this._resize_policy === rz_policy.NO_RESIZE) {
                console.warn('ObjectPool - Could not allocate, pool is empty');
                return this._empty_value;
            }

            // Duplicate the pool capacity.
            const old_capacity = this.capacity;
            this._items = make_array(old_capacity * 2, i =>
                (i < old_capacity ? this._items[i] : this._allocate(i))
            );

        }

        const item = this._items[this._next];
        this._items[this._next] = this._empty_value;
        this._next += 1;

        return item;
    }

    release(item) {
        if (this._next === 0) {
            console.warn('ObjectPool - Could not release, pool is full');
            return;
        }

        this._initalize(item);
        this._next -= 1;
        this._items[this._next] = item;

        // The pool will shrink if we are using only a thired of it capacity,
        // in this case we half the pool capacity )
        if (this._resize_policy === rz_policy.GROW_AND_SHRINK &&
            this.capacity > 16 &&
            this._next < Math.floor((1 / 3) * this.capacity)) {

            const new_capacity = Math.floor(this.capacity / 2);
            this._items = make_array(new_capacity, i => this._items[i]);
        }
    }
}

exports.ObjectPool = ObjectPool;
