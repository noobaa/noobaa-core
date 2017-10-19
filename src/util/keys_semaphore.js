/* Copyright (C) 2016 NooBaa */
'use strict';

const Semaphore = require('./semaphore');


class KeysSemaphore {

    constructor(initial, params) {
        this._initial = initial;
        this._params = params;
        this._keys_map = new Map();
    }

    surround_key(key, func) {
        let sem = this._keys_map.get(key);
        if (!sem) {
            sem = new Semaphore(this._initial, this._params);
            this._keys_map.set(key, sem);
        }
        return sem.surround(func)
            .finally(() => {
                // once finished, clean the semaphore from the map if it isn't in use
                if (sem.is_empty()) {
                    this._keys_map.delete(key);
                }
            });
    }

    get_semaphore(key) {
        return this._keys_map.get(key);
    }
}



module.exports = KeysSemaphore;
