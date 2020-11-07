/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const P = require('../util/promise');
const LinkedList = require('./linked_list');

class KeysLock {

    constructor() {
        this._keys_map = new Map();
        this._wait_list = new LinkedList('keys_lock');
    }

    // read-only properties
    get length() {
        return this._wait_list.length;
    }

    // TODO: The way that we lock the keys currently means that we will wait on batches
    // If there is a single key in the batch that is locked
    surround_keys(keys, func) {
        if (!_.isArray(keys)) {
            throw new TypeError('Keys should be an array');
        }

        let lock_item = {
            keys: keys,
            locked: false,
        };

        return this._wait(lock_item)
            .then(func)
            .finally(() => this._release(lock_item));
    }

    _wait(lock_item) {
        if (this._can_lock_keys(lock_item.keys)) {
            // Creates unfairness to the items that wait for any of these keys in the list
            // This may cause starvation of tasks in the list
            // We prefer to maximizing the utilization of available resources with the risk of some starvation
            this._lock_keys(lock_item);
            return P.resolve();
        }

        const defer = new P.Defer();
        lock_item.defer = defer;
        this._wait_list.push_back(lock_item);
        return defer.promise;
    }

    _release(lock_item) {
        // Making sure that I will remove from the queue list
        // Currently this is not relevant, only for safety purposes
        this._wait_list.remove(lock_item);
        this._unlock_keys(lock_item);
        this._wakeup_waiters();
    }

    _can_lock_keys(keys) {
        return _.every(keys, key => !this._keys_map.has(key));
    }

    _lock_keys(lock_item) {
        if (lock_item.locked) return;
        lock_item.locked = true;
        _.each(lock_item.keys, key => this._keys_map.set(key, lock_item));
    }

    _unlock_keys(lock_item) {
        if (!lock_item.locked) return;
        lock_item.locked = false;
        _.each(lock_item.keys, key => this._keys_map.delete(key));
    }

    _wakeup_waiters() {
        let item = this._wait_list.get_front();
        while (item) {
            const next_item = this._wait_list.get_next(item);
            if (this._can_lock_keys(item.keys)) {
                this._lock_keys(item);
                item.defer.resolve();
                this._wait_list.remove(item);
            }
            item = next_item;
        }
    }
}

module.exports = KeysLock;
