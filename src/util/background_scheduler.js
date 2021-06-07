/* Copyright (C) 2016 NooBaa */
/**
 *
 * SYSTEM_STORE
 *
 */
'use strict';

const P = require('./promise');
const dbg = require('./debug_module')(__filename);

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
        const self = this;
        const DEFAULT_DELAY = 10000;
        this.workers_by_name_cache[worker.name] = worker;

        function run() {
            if (self.workers_by_name_cache[worker.name]) {
                P.fcall(function() {
                        return worker.run_batch();
                    })
                    .then(function(delay) {
                        return P.delay_unblocking(delay || worker.delay || DEFAULT_DELAY);
                    }, function(err) {
                        dbg.log('run_background_worker', worker.name, 'UNCAUGHT ERROR', err, err.stack);
                        return P.delay_unblocking(worker.delay || DEFAULT_DELAY);
                    })
                    .then(run);
            }
        }
        dbg.log('run_background_worker:', 'INIT', worker.name);
        let initial_delay = 0;
        if (!worker.run_immediate) {
            initial_delay = worker.boot_delay || worker.delay || DEFAULT_DELAY;
        }
        P.delay_unblocking(initial_delay).then(run);
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

    register_bg_worker(worker, run_batch_function) {
        dbg.log0('Registering', worker.name, 'bg worker');
        if (run_batch_function) {
            worker.run_batch = run_batch_function;
        }
        const isFunction = typeof worker.run_batch;
        if (!worker.name || isFunction !== 'function') {
            console.error('Name and run function must be supplied for registering bg worker', worker.name);
            throw new Error('Name and run function must be supplied for registering bg worker ' + worker.name);
        }
        this.run_background_worker(worker);
    }
}

// EXPORTS
exports.Background_Scheduler = Background_Scheduler;
exports.get_instance = Background_Scheduler.get_instance;
