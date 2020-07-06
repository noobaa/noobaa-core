/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

/**
 * @template T
 * @typedef {(a: T, b: T) => -1|1|0} CompareFunc<T>
 */

/**
 * @template T
 * @template K
 * @typedef {(a: T) => K} KeyGetter<T,K>
 */

/**
 * Compare function for arrays with comparable values 
 * such as numbers, booleans, dates, which do not sort well with the default string sort.
 * @template T
 * @param {T} a
 * @param {T} b
 * @returns {-1|1|0}
 * @see https://www.ecma-international.org/ecma-262/#sec-sortcompare
 * @example
 * > [3,2020,1].sort(sort_utils.compare_by_value)
 * [ 1, 3, 2020 ]
 * > [3,2020,1].sort()
 * [ 1, 2020, 3 ]
 */
function compare_by_value(a, b) {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
}

/**
 * Compare function for arrays with comparable values 
 * such as numbers, booleans, dates, which do not sort well with the default string sort.
 * @template T
 * @param {T} a
 * @param {T} b
 * @returns {-1|1|0}
 * @example
 * > [3,2020,1].sort(sort_utils.compare_by_value_reverse)
 * [ 2020, 3, 1 ]
 */
function compare_by_value_reverse(a, b) {
    if (a < b) return 1;
    if (a > b) return -1;
    return 0;
}


/**
 * Returns a compare function from given key_getter function
 * @template T The array item type
 * @template K A comparable key type
 * @param {(item: T) => K} key_getter takes array item and returns a comparable key
 * @param {number} order 1 for ascending order, -1 for decending
 * @returns {CompareFunc<T>}
 * @example
 * > [{a:1,b:9},{a:2,b:1}].sort(sort_utils.compare_by_key(item => item.b))
 * [ { a: 2, b: 1 }, { a: 1, b: 9 } ]
 */
function compare_by_key(key_getter = undefined, order = 1) {
    if (key_getter) {
        return order >= 0 ?
            function compare_by_key_func(a, b) { return compare_by_value(key_getter(a), key_getter(b)); } :
            function compare_by_key_func(a, b) { return compare_by_value_reverse(key_getter(a), key_getter(b)); };
    }
    return order >= 0 ?
        function compare_by_key_func(a, b) { return compare_by_value(a, b); } :
        function compare_by_key_func(a, b) { return compare_by_value_reverse(a, b); };
}

/**
 * @template T
 * @template K
 */
class SortedLimitSplice {

    /**
     * @param {number} limit > 0
     * @param {KeyGetter<T,K>} key_getter
     */
    constructor(limit, key_getter = undefined) {
        this._limit = limit;
        this._key_getter = key_getter;
        this._arr = [];
    }

    /**
     * @param {T} val
     */
    push(val) {
        const arr = this._arr;
        const pos = _.sortedLastIndexBy(arr, val, this._key_getter);
        if (pos < this._limit) {
            arr.splice(pos, 0, val);
            if (arr.length >= this._limit * 2) {
                arr.length = this._limit;
            }
        }
    }

    /**
     * @returns {T[]}
     */
    end() {
        const arr = this._arr;
        if (arr.length > this._limit) {
            arr.length = this._limit;
        }
        return arr;
    }
}

/**
 * @template T
 * @template K
 */
class SortedLimitShift {

    /**
     * @param {number} limit > 0
     * @param {KeyGetter<T,K>} key_getter
     */
    constructor(limit, key_getter = undefined) {
        this._limit = limit;
        this._compare = compare_by_key(key_getter);
        this._pos = 0;
        this._arr = new Array(limit);
    }

    /**
     * @param {T} val
     */
    push(val) {
        const arr = this._arr;
        let i;
        if (this._pos < arr.length) {
            i = this._pos;
            this._pos += 1;
        } else {
            i = arr.length - 1;
            if (this._compare(val, arr[i]) >= 0) return;
        }
        while (i > 0 && this._compare(val, arr[i - 1]) < 0) {
            arr[i] = arr[i - 1];
            i -= 1;
        }
        arr[i] = val;
    }

    /**
     * @returns {T[]}
     */
    end() {
        return this._pos < this._arr.length ?
            this._arr.slice(0, this._pos) :
            this._arr;
    }
}

/**
 * @template T
 * @template K
 */
class SortedLimitEveryBatch {

    /**
     * @param {number} limit > 0
     * @param {KeyGetter<T,K>} key_getter
     */
    constructor(limit, key_getter = undefined) {
        this._limit = limit;
        this._compare = compare_by_key(key_getter);
        this._pos = 0;
        this._arr = new Array(limit * 2);
    }

    /**
     * @param {T} val
     */
    push(val) {
        const arr = this._arr;
        arr[this._pos] = val;
        this._pos += 1;
        if (this._pos < this._limit) {
            return;
        }
        if (this._pos === this._limit) {
            arr.sort(this._compare);
        } else if (this._pos >= arr.length) {
            arr.sort(this._compare);
            this._pos = this._limit;
        } else if (this._compare(val, arr[this._limit - 1]) >= 0) {
            this._pos -= 1;
        }
    }

    /**
     * @returns {T[]}
     */
    end() {
        const arr = this._arr;
        arr.length = this._pos;
        arr.sort(this._compare);
        if (arr.length > this._limit) {
            arr.length = this._limit;
        }
        return arr;
    }
}

/**
 * Simples and slowest.
 * @template T
 * @template K
 */
class SortedLimitEveryPush {

    /**
     * @param {number} limit > 0
     * @param {KeyGetter<T,K>} key_getter
     */
    constructor(limit, key_getter = undefined) {
        this._limit = limit;
        this._compare = compare_by_key(key_getter);
        this._pos = 0;
        this._arr = new Array(limit + 1);
    }

    /**
     * @param {T} val
     */
    push(val) {
        this._arr[this._pos] = val;
        this._arr.sort(this._compare);
        if (this._pos < this._arr.length - 1) {
            this._pos += 1;
        }
    }

    /**
     * @returns {T[]}
     */
    end() {
        this._arr.length = this._pos;
        return this._arr;
    }
}

exports.compare_by_value = compare_by_value;
exports.compare_by_value_reverse = compare_by_value_reverse;
exports.compare_by_key = compare_by_key;

exports.SortedLimitSplice = SortedLimitSplice;
exports.SortedLimitShift = SortedLimitShift;
exports.SortedLimitEveryBatch = SortedLimitEveryBatch;
exports.SortedLimitEveryPush = SortedLimitEveryPush;
