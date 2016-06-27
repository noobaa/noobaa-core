/**
 *
 * SYSTEM_STORE
 *
 */
'use strict';

const P = require('./promise');
const dbg = require('./debug_module')(__filename);
const promise_utils = require('./promise_utils');

/**
 *
 * SystemStore
 *
 * loads data from the database and keeps in memory optimized way.
 *
 */
class Background_Scheduler {

    static get_instance() {
        Background_Scheduler._instance = Background_Scheduler._instance || new Background_Scheduler();
        return Background_Scheduler._instance;
    }

    constructor() {
        this.workers_by_name_cache = {};
    }

    // for the sake of tests to be able to exit we schedule the worker with unblocking delay
    // so that it won't prevent the process from existing if it's the only timer left
    run_background_worker(worker) {
        var DEFUALT_DELAY = 10000;
        this.workers_by_name_cache[worker.name] = worker;

        function run() {
            let self = Background_Scheduler.get_instance();
            if (self.workers_by_name_cache[worker.name]) {
                P.fcall(function() {
                        return worker.run_batch();
                    })
                    .then(function(delay) {
                        return promise_utils.delay_unblocking(delay || worker.delay || DEFUALT_DELAY);
                    }, function(err) {
                        dbg.log('run_background_worker', worker.name, 'UNCAUGHT ERROR', err, err.stack);
                        return promise_utils.delay_unblocking(worker.delay || DEFUALT_DELAY);
                    })
                    .then(run);
            }
        }
        dbg.log('run_background_worker:', 'INIT', worker.name);
        promise_utils.delay_unblocking(worker.boot_delay || worker.delay || DEFUALT_DELAY).then(run);
        return worker;
    }

    remove_background_worker(worker_name) {
        if (this.workers_by_name_cache[worker_name]) {
            dbg.log('remove_background_worker:', 'WORKER REMOVED', worker_name);
            delete this.workers_by_name_cache[worker_name];
        } else {
            dbg.log('remove_background_worker:', 'NO SUCH WORKER', worker_name);
        }
    }
}

// EXPORTS
exports.Background_Scheduler = Background_Scheduler;
exports.get_instance = Background_Scheduler.get_instance;
