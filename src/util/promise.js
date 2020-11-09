/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const util = require('util');
const Semaphore = require('./semaphore');

require('setimmediate'); // shim for the browser

// the basics which are not exposed by node.js yet
const next_tick = util.promisify(process.nextTick);
const immediate = util.promisify(setImmediate);
const delay = util.promisify(setTimeout);

/**
 * promise version of setTimeout using unref() that will not block
 * the event loop from exiting in case there are no other events waiting.
 * see http://nodejs.org/api/timers.html#timers_unref
 * @param {number} delay_ms
 * @returns {Promise<void>}
 */
function delay_unblocking(delay_ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, delay_ms);
        if (timer.unref) timer.unref(); // browsers don't have unref
    });
}

/**
 * Simple array items mapping to async calls per item.
 * 
 * @template K
 * @template V
 * @param {Array<K>} arr
 * @param {(key:K) => Promise<V>} func
 * @returns {Promise<Array<V>>}
 */
async function map(arr, func) {
    return Promise.all(arr.map(func));
}

/**
 * Map with limited concurrency.
 * 
 * @template K
 * @template V
 * @param {number} concurrency 
 * @param {Array<K>} arr
 * @param {(key:K, index?:number) => Promise<V>} func
 * @returns {Promise<Array<V>>}
 */
async function map_with_concurrency(concurrency, arr, func) {
    const sem = new Semaphore(concurrency);
    return Promise.all(arr.map(async (key, index) => sem.surround(async () => func(key, index))));
}

/**
 * map_one_by_one iterates the array and maps its values one by one.
 * 
 * @template K
 * @template V
 * @param {Array<K>} arr
 * @param {(key:K, index?:number) => Promise<V>} func
 * @returns {Promise<Array<V>>}
 */
async function map_one_by_one(arr, func) {
    const l = arr.length;
    const r = [];
    r.length = l;
    for (let i = 0; i < l; ++i) {
        r[i] = await func(arr[i], i);
    }
    return r;
}

/**
 * @see https://stackoverflow.com/questions/48011353/how-to-unwrap-type-of-a-promise
 * @template T
 * @typedef {T extends PromiseLike<infer U> 
 *  ? { 0:P.Unwrap<U>; 1:U }[T extends PromiseLike<any> ? 0 : 1]
 *  : T
 * } P.Unwrap;
 */

/**
 * Return a new object with the same properties of obj
 * after awaiting all its values, concurrently.
 * 
 * Example:
 *          const { buckets, accounts } = await P.map_props({
 *              buckets: this.load_buckets(),
 *              accounts: this.load_accounts(),
 *          });
 * 
 * @template T
 * @param {T} obj
 * @returns {Promise<{[K in keyof T]: P.Unwrap<T[K]>}>}
 */
async function map_props(obj) {
    return Object.fromEntries(
        await Promise.all(
            Object.entries(obj).map(
                async ([key, val]) => ([key, await val])
            )
        )
    );
}

/**
 * any returns the result of the first promise to resolve.
 * first promise to succeed will resolve the entire call and we're done.
 * but if all are settled without anyone resolving, we call reject.
 * 
 * @template K
 * @template V
 * @param {Array<K>} arr
 * @param {(key:K) => Promise<V>} func
 * @returns {Promise<V>}
 */
async function map_any(arr, func) {
    return new Promise((resolve, reject) => {
        Promise.allSettled(arr.map(it => func(it).then(resolve)))
            .then(() => reject(new Error('P.map_any: all failed')));
    });
}


class TimeoutError extends Error {
    constructor(msg = 'TimeoutError') {
        super(msg);
    }
}

const default_create_timeout_err = () => new TimeoutError();

/**
 * When millis is undefined we do NOT set a timeout, and return the provided promise as is.
 * This allows to use it for optional timeout params: P.timeout(options.timeout, promise) 
 * 
 * @template T
 * @param {number|undefined} millis when millis is undefined promise is returned as is
 * @param {Promise<T>} promise
 * @param {() => Error} [create_timeout_err]
 * @returns {Promise<T>}
 */
async function timeout(millis, promise, create_timeout_err = default_create_timeout_err) {
    if (!promise) throw new Error('P.timeout: promise is required');
    if (typeof millis === 'undefined') return promise;
    return new Promise((resolve, reject) => {
        let timer = setTimeout(() => {
            // wish we could let the promise know so it could save some redundant work 
            reject(create_timeout_err());
        }, millis);
        if (timer.unref) timer.unref(); // browsers don't have unref
        promise.then(res => {
            clearTimeout(timer);
            timer = null;
            resolve(res);
        });
        promise.catch(err => {
            clearTimeout(timer);
            timer = null;
            reject(err);
        });
    });
}

/**
 * Retry func on errors as long as the conditions of attempts and delay are met.
 * @template T
 * @param {{
 *  attempts: number, // number of attempts. can be Infinity.
 *  delay_ms: number, // number of milliseconds between retries
 *  func: (attemtpts:number) => Promise<T>, // passing remaining attempts just fyi
 *  error_logger?: (err:Error) => void,
 * }} params
 * @returns {Promise<T>}
 */
async function retry({ attempts, delay_ms, func, error_logger }) {
    for (;;) {
        try {
            // call func and catch errors,
            // passing remaining attempts just fyi
            const res = await func(attempts);

            // return when successful
            return res;

        } catch (err) {

            // check attempts
            attempts -= 1;
            if (attempts <= 0 || err.DO_NOT_RETRY) {
                throw err;
            }

            if (error_logger) error_logger(err);

            // delay and retry next attempt
            await delay(delay_ms);
        }
    }
}


/////////////////////////////////////
/////////////////////////////////////
// LEGACY UTILITIES - DEPRECATED ! //
/////////////////////////////////////
/////////////////////////////////////

/**
 * @deprecated LEGACY PROMISE UTILS - DEPRECATED IN FAVOR OF ASYNC-AWAIT
 */
class Defer {

    constructor() {
        this.isPending = true;
        this.isResolved = false;
        this.isRejected = false;
        this.promise = new Promise((resolve, reject) => {
            this._promise_resolve = resolve;
            this._promise_reject = reject;
        });
        Object.seal(this);
    }

    // setting resolve and reject to assert that the current code assumes 
    // the Promise ctor is calling the callback synchronously and not deferring it,
    // otherwise we might have weird cases that we miss the caller's resolve/reject
    // events, so we throw to assert 

    /**
     * @param {any} [res]
     * @returns {void}
     */
    resolve(res) {
        if (!this.isPending) {
            return;
        }
        this.isPending = false;
        this.isResolved = true;
        Object.freeze(this);
        this._promise_resolve(res);
    }

    /**
     * @param {Error} err
     * @returns {void}
     */
    reject(err) {
        if (!this.isPending) {
            return;
        }
        this.isPending = false;
        this.isRejected = true;
        Object.freeze(this);
        this._promise_reject(err);
    }
}

/**
 * Callback is a template typedef to help propagate types correctly
 * when using nodejs callback functions.
 * @template T
 * @typedef {(err?:Error, res?:T) => void} Callback
 */

/**
 * CallbackReceiver is a template typedef to help propagate types correctly
 * when using nodejs callback functions.
 * @template T
 * @typedef {(callback: Callback<T>) => void} CallbackReceiver
 */

/**
 * @deprecated LEGACY PROMISE UTILS - DEPRECATED IN FAVOR OF ASYNC-AWAIT
 */
async function fcall(func, ...args) {
    return func(...args);
}

/**
 * @deprecated LEGACY PROMISE UTILS - DEPRECATED IN FAVOR OF ASYNC-AWAIT
 * @template T
 * @param {object} obj object on which to make the method call
 * @param {string} fn function name
 * @param  {...any} args arguments to pass to the call
 * @returns {Promise<T>}
 */
async function ninvoke(obj, fn, ...args) {
    return new Promise((resolve, reject) => {
        /** @type {Callback<T>} */
        const callback = (err, res) => (err ? reject(err) : resolve(res));
        obj[fn](...args, callback);
    });
}

/**
 * @deprecated LEGACY PROMISE UTILS - DEPRECATED IN FAVOR OF ASYNC-AWAIT
 * @template T
 * @param {CallbackReceiver<T>} receiver
 * @returns {Promise<T>}
 */
async function fromCallback(receiver) {
    return new Promise((resolve, reject) => {
        /** @type {Callback<T>} */
        const callback = (err, res) => (err ? reject(err) : resolve(res));
        receiver(callback);
    });
}


/**
 * @deprecated LEGACY PROMISE UTILS - DEPRECATED IN FAVOR OF ASYNC-AWAIT
 * @param {() => boolean} condition 
 * @param {() => Promise} body 
 */
async function pwhile(condition, body) {
    while (condition()) {
        await body();
    }
}

/**
 * Wait until an async condition is met.
 * @deprecated LEGACY PROMISE UTILS - DEPRECATED IN FAVOR OF ASYNC-AWAIT
 * @param {() => boolean | Promise<boolean>} async_cond an async condition function with a boolean return value.
 * @param {number} [timeout_ms] A timeout to bail out of the loop, will throw timeout error.
 * @param {number} [delay_ms] delay number of milliseconds between invocation of the condition.
 */
async function wait_until(async_cond, timeout_ms, delay_ms = 2500) {
    if (!_.isUndefined(timeout_ms)) {
        return timeout(timeout_ms, wait_until(async_cond, undefined, delay_ms));
    }
    while (!await async_cond()) {
        // TODO how do we stop this loop once the timeout is expired
        await delay(delay_ms);
    }
}


// EXPORTS

// timing
exports.next_tick = next_tick;
exports.immediate = immediate;
exports.delay = delay;
exports.delay_unblocking = delay_unblocking;
// mapping
exports.map = map;
exports.map_with_concurrency = map_with_concurrency;
exports.map_one_by_one = map_one_by_one;
exports.map_props = map_props;
exports.map_any = map_any;
// control flow
exports.timeout = timeout;
exports.TimeoutError = TimeoutError;
exports.retry = retry;
// should we deprecated usage of P.resolve/reject/all ?
exports.resolve = val => Promise.resolve(val);
exports.reject = err => Promise.reject(err);
exports.all = arr => Promise.all(arr);
// deprecated
exports.fromCallback = fromCallback; // 96 occurences
exports.fcall = fcall; // 64 occurences
exports.ninvoke = ninvoke; // 32 occurences
exports.wait_until = wait_until; // 21 occurences
exports.Defer = Defer; // 18 occurences
exports.pwhile = pwhile; // 17 occurences
