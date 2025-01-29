/* Copyright (C) 2016 NooBaa */
'use strict';

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

module.exports = Defer; // 13 occurrences
