'use strict';

const P = require('../util/promise');
const _ = require('lodash');

class KeysLock {

    constructor() {
        this._keys_map = new Map();
        this._wq = [];
    }

    surround_keys(keys, func) {
        let lock_object = {
            keys: keys || [],
            timestamp: Date.now()
        };

        return this._wait(lock_object)
            .then(func)
            .finally(() => this._release(lock_object));
    }

    _wait(lock_object) {
        if (this._can_lock_keys(lock_object.keys)) {
            this._lock_keys(lock_object);
            return P.resolve(false);
        }

        const defer = P.defer();
        lock_object.defer = defer;
        this._wq.push(lock_object);
        return defer.promise;
    }

    _can_lock_keys(keys) {
        return _.every(keys, key => !this._keys_map.has(key));
    }

    _lock_keys(lock_object) {
        _.each(lock_object.keys, key => this._keys_map.set(key, lock_object));
    }

    _unlock_keys(keys) {
        _.each(keys, key => this._keys_map.delete(key));
    }

    _release(lock_object) {
        this._unlock_keys(lock_object.keys);

        this._wq.forEach((item, index) => {
            if (!item.resolved && this._can_lock_keys(item.keys)) {
                this._lock_keys(item);
                this._wq[index].resolved = true;
                item.defer.resolve(true);
            }
        });

        this._wq = _.filter(this._wq, item => !item.resolved);
    }
}

module.exports = KeysLock;
