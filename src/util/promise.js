/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const util = require('util');
const Semaphore = require('./semaphore');

require('setimmediate'); // shim for the browser

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
        if (timer.unref) timer.unref();
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
 * Deconstruct and reconstruct the object keys after awaiting all its values,
 * after mapping by the given func (optional).
 * 
 * @param {object} obj
 * @param {(val:any, key:string) => Promise<any>} func
 * @returns {Promise<object>}
 */
async function map_values(obj, func = (val, key) => val) {
    return Object.fromEntries(
        await Promise.all(
            Object.entries(obj).map(
                async ([key, val]) => ([key, await func(val, key)])
            )
        )
    );
}

/**
 * Map with limited concurrency.
 * 
 * @template K
 * @template V
 * @param {number} concurrency 
 * @param {Array<K>} arr
 * @param {(key:K) => Promise<V>} func
 * @returns {Promise<Array<V>>}
 */
async function map_with_concurrency(concurrency, arr, func) {
    const sem = new Semaphore(concurrency);
    return Promise.all(arr.map(async key => sem.surround(async () => func(key))));
}

/**
 * map_one_by_one iterates the array and maps its values one by one.
 * 
 * @template K
 * @template V
 * @param {Array<K>} arr
 * @param {(key:K) => Promise<V>} func
 * @returns {Promise<Array<V>>}
 */
async function map_one_by_one(arr, func) {
    const l = arr.length;
    const r = [];
    r.length = l;
    for (let i = 0; i < l; ++i) {
        r[i] = await func(arr[i]);
    }
    return r;
}

/**
 * any returns the result of the first promise to resolve.
 * 
 * @template K
 * @template V
 * @param {Array<K>} arr
 * @param {(key:K) => Promise<V>} func
 * @returns {Promise<V>}
 */
async function map_any(arr, func) {
    return new Promise((resolve, reject) => {
        const make_anti_promise = p => p.then(Promise.reject, Promise.resolve);
        const promises = arr.map(func);
        const anti_promises = promises.map(make_anti_promise);
        const ignore = () => undefined;
        // first promise to succeed will resolve the entire call.
        promises.forEach(p => p.then(resolve, ignore));
        // fail iff all promises failed
        Promise.all(anti_promises).then(
            () => reject(new Error('map_any: all has failed')),
            ignore
        );
    });
}

let next_defer_id = 1;

class Defer {

    constructor() {
        // GGG DEFER DEBUG ----
        this.id = next_defer_id;
        next_defer_id += 1;
        // GGG DEFER DEBUG ----
        this.isPending = true;
        this.isResolved = false;
        this.isRejected = false;
        this.resolve = /** @type {(res?:any) => void} */ (res => {
            throw new Error('defer resolve called before initialized');
        });
        this.reject = /** @type {(err:Error) => void} */ (err => {
            throw err;
        });
        this.promise = new Promise((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
            console.log(`GGG DEFER DEBUG: #${this.id} initialized`);
        });
        this.promise.then(
            res => {
                console.log(`GGG DEFER DEBUG: #${this.id} resolve`, res);
                this.isPending = false;
                this.isResolved = true;
                Object.freeze(this);
            },
            err => {
                console.log(`GGG DEFER DEBUG: #${this.id} reject`, err);
                this.isPending = false;
                this.isRejected = true;
                Object.freeze(this);
            }
        );
        Object.seal(this);
    }
}

function defer() {
    return new Defer();
}

async function fcall(func, ...args) {
    return func(...args);
}

/**
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

class TimeoutError extends Error {
    constructor(msg = 'TimeoutError') {
        super(msg);
    }
}

/**
 * @template T
 * @param {number} millis
 * @param {Promise<T>} promise
 * @param {Error|undefined} [custom_timeout_err]
 * @returns {Promise<T>}
 */
async function timeout(millis, promise, custom_timeout_err = undefined) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            // wish we could let the promise know so it could save some redundant work 
            reject(custom_timeout_err || new TimeoutError());
        }, millis);
        promise.then(res => {
            clearTimeout(timer);
            resolve(res);
        });
        promise.catch(err => {
            clearTimeout(timer);
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

/**
 * 
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
 *
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

exports.resolve = val => Promise.resolve(val);
exports.reject = err => Promise.reject(err);
exports.all = arr => Promise.all(arr);

exports.Defer = Defer;
exports.TimeoutError = TimeoutError;

exports.next_tick = next_tick;
exports.immediate = immediate;
exports.delay = delay;
exports.delay_unblocking = delay_unblocking;

exports.map = map;
exports.map_values = map_values;
exports.map_with_concurrency = map_with_concurrency;
exports.map_one_by_one = map_one_by_one;
exports.map_any = map_any;

exports.defer = defer;
exports.fcall = fcall;
exports.ninvoke = ninvoke;
exports.fromCallback = fromCallback;
exports.timeout = timeout;
exports.retry = retry;
exports.pwhile = pwhile;
exports.wait_until = wait_until;
