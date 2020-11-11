/* Copyright (C) 2016 NooBaa */
'use strict';

var _ = require('lodash');
var P = require('../util/promise');

module.exports = Barrier;

/**
 *
 * Barrier
 *
 * barrier is a concurrency synchronization technique:
 * a) collect concurrent calls up to max_length or expiry_ms time.
 * b) run a batch process() to handle all the items together.
 * c) resolve each caller with relevant value.
 *
 * options (Object):
 * - max_length: lru max length
 * - expiry_ms: time after which the item is considered expired
 * - process - function that takes list of collected items,
 *      and returns list of results, can return a promise.
 *
 */
function Barrier(options) {
    var self = this;
    options = options || {};
    self.max_length = options.max_length || 100;
    self.expiry_ms = options.expiry_ms || 1000; // default 1 second
    self.process = options.process;
    self.barrier = {
        items: [],
        defers: [],
    };
}

/**
 *
 * call
 *
 * join to the pending barrier and wait for it to resolve.
 *
 * @returns a promise that will be resolved once all the barrier is resolved.
 *
 */
Barrier.prototype.call = function(item) {
    var self = this;
    return P.fcall(function() {

        // add the item to the pending barrier and assign a defer
        // that will be resolved/rejected per this item.
        var defer = new P.Defer();
        self.barrier.items.push(item);
        self.barrier.defers.push(defer);

        if (self.barrier.items.length >= self.max_length) {

            // release barrier when max length is reached
            self.release();

        } else if (self.expiry_ms >= 0 && !self.barrier.timeout) {

            // schedule a timeout to release the barrier
            self.barrier.timeout = setTimeout(self.release.bind(self), self.expiry_ms);
        }

        return defer.promise;
    });
};

/**
 *
 * release
 *
 * immediately start processing the pending barrier,
 * and reset a new pending barrier for new joins to use.
 *
 */
Barrier.prototype.release = function() {
    var self = this;
    var barrier = self.barrier;
    clearTimeout(barrier.timeout);

    // reset a new pending barrier
    self.barrier = {
        items: [],
        defers: [],
    };

    // call the process function with the items list
    P.fcall(self.process, barrier.items)
        .then(function(res) {
            res = res || [];
            _.each(barrier.defers, function(defer, index) {
                defer.resolve(res[index]);
            });
        })
        .catch(function(err) {
            _.each(barrier.defers, function(defer, index) {
                defer.reject(err);
            });
        });
};
