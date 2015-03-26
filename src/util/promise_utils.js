// module targets: nodejs & browserify
'use strict';

var _ = require('lodash');
var Q = require('q');

module.exports = {
    iterate: iterate,
    loop: loop,
    retry: retry,
    delay_unblocking: delay_unblocking,
    run_background_worker: run_background_worker
};



/**
 *
 * Iterate on an array, accumilate promises and return results of each
 * invocation
 *
 */
function iterate(array, func) {
    var results = [];
    results.length = array.length;
    var i = 0;

    function add_to_promise(promise, item) {
        return promise.then(function() {
            return Q.when(func(item))
                .then(function(res) {
                    results[i++] = res;
                });
        });
    }

    return _.reduce(array, add_to_promise, Q.resolve())
        .thenResolve(results);
}

/**
 *
 * simple promise loop, similar to _.times but ignores the return values,
 * and only returns a promise for completion or failure
 *
 */
function loop(times, func) {
    if (times > 0) {
        return Q.fcall(func)
            .then(function() {
                times = times | 0; // cast to integer
                return loop(times - 1, func);
            });
    }
}


/**
 *
 * simple promise loop, similar to _.times but ignores the return values,
 * and only returns a promise for completion or failure
 *
 * @param attempts number of attempts. can be Infinity.
 * @param delay number of milliseconds between retries
 * @param func with signature function(attempts), passing remaining attempts just fyi
 */
function retry(attempts, delay, func) {

    // call func, passing remaining attempts just fyi
    return Q.fcall(func, attempts)

        // catch errors
        .then(null, function(err) {

            // check attempts
            attempts -= 1;
            if (attempts <= 0) {
                throw err;
            }

            // delay and retry next attempt
            return Q.delay(delay).then(function() {
                return retry(attempts, delay, func);
            });
        });
}


/**
 * create a timeout promise that does not block the event loop from exiting
 * in case there are no other events waiting.
 * see http://nodejs.org/api/timers.html#timers_unref
 */
function delay_unblocking(delay) {
    var defer = Q.defer();
    var timer = setTimeout(defer.resolve, delay);
    timer.unref();
    return defer.promise;
}



// for the sake of tests to be able to exit we schedule the worker with unblocking delay
// so that it won't prevent the process from existing if it's the only timer left
function run_background_worker(worker) {
    var DEFUALT_DELAY = 10000;

    function run() {
        Q.fcall(function() {
                return worker.run_batch();
            })
            .then(function(delay) {
                return delay_unblocking(delay || worker.delay || DEFUALT_DELAY);
            }, function(err) {
                console.log('run_background_worker', worker.name, 'UNCAUGHT ERROR', err, err.stack);
                return delay_unblocking(worker.delay || DEFUALT_DELAY);
            })
            .then(run);
    }
    console.log('run_background_worker:', 'INIT', worker.name);
    delay_unblocking(worker.boot_delay || worker.delay || DEFUALT_DELAY).then(run);
    return worker;
}
