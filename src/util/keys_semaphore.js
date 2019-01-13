/* Copyright (C) 2016 NooBaa */
'use strict';

const Semaphore = require('./semaphore');


class KeysSemaphore {

    constructor(initial, params) {
        this._initial = initial;
        this._params = params;
        this._keys_map = new Map();
    }

    /**
     * @template T
     * @param {string} key 
     * @param {() => Promise<T>} func 
     * @returns {Promise<T>}
     */
    async surround_key(key, func) {
        let sem = this._keys_map.get(key);
        if (!sem) {
            sem = new Semaphore(this._initial, this._params);
            this._keys_map.set(key, sem);
        }
        try {
            return await sem.surround(func);
        } finally {
            // once finished, clean the semaphore from the map if it isn't in use
            if (sem.is_empty()) {
                this._keys_map.delete(key);
            }
        }
    }

    has_semaphore(key) {
        return Boolean(this._keys_map.get(key));
    }
}



module.exports = KeysSemaphore;
