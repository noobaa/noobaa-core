// this module is written for both nodejs, or for client with browserify.
'use strict';

// var _ = require('lodash');
var P = require('../util/promise');
var LinkedList = require('./linked_list');


module.exports = WaitQueue;

// construct a wait queue.
function WaitQueue(name) {
    name = name || '';
    this._name = '_wq_' + name;
    this._q = new LinkedList(name);

    // read-only properties
    Object.defineProperty(this, 'length', {
        enumerable: true,
        get: function() {
            return this._q.length;
        }
    });
}

// wait in queue, returns a promise which will be resolved on wakeup.
// item is optional, and if provided can later be passed to wakeup for
// a manual wakup (not by queue order).
WaitQueue.prototype.wait = function(item) {
    item = item || {};
    var defer = P.defer();
    item[this._name] = defer;
    this._q.push_back(item);
    return defer.promise;
};

// wakeup the item or first item in queue if item is not supplied.
// returns the item.
WaitQueue.prototype.wakeup = function(item) {
    item = item || this._q.get_front();
    if (!item) {
        return;
    }
    this._q.remove(item);
    item[this._name].resolve();
    delete item[this._name];
    return item;
};

// peeks the next item in queue
WaitQueue.prototype.head = function() {
    return this._q.get_front();
};

// return waiting items enumerated as string
WaitQueue.prototype.enum_items = function() {
    return this._q.enum_items();
};
