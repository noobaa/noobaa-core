/* Copyright (C) 2016 NooBaa */
'use strict';

// const _ = require('lodash');
const P = require('../util/promise');
const LinkedList = require('./linked_list');

class WaitQueue {

    constructor(name) {
        name = name || '';
        this._name = '_wq_' + name;
        this._q = new LinkedList(name);
    }

    /**
     * wait in queue, returns a promise which will be resolved on wakeup.
     * item is optional, and if provided can later be passed to wakeup for
     * a manual wakup (not by queue order).
     */
    wait(item) {
        item = item || {};
        const defer = P.defer();
        item[this._name] = defer;
        this._q.push_back(item);
        return defer.promise;
    }

    /**
     * wakeup the item or first item in queue if item is not supplied.
     * returns the item.
     */
    wakeup(item) {
        item = item || this._q.get_front();
        if (!item) {
            return;
        }
        this._q.remove(item);
        item[this._name].resolve();
        delete item[this._name];
        return item;
    }

    /**
     * read-only queue length property
     */
    get length() {
        return this._q.length;
    }

    /**
     * peeks the next item in queue
     */
    head() {
        return this._q.get_front();
    }

    /**
     * @return waiting items enumerated as string
     */
    enum_items() {
        return this._q.enum_items();
    }

}

module.exports = WaitQueue;
