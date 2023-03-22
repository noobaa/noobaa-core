/* Copyright (C) 2023 NooBaa */
'use strict';

// these type hacks are needed because the type info from require('node:cluster') is incorrect
const cluster = /** @type {import('node:cluster').Cluster} */ (
    /** @type {unknown} */ (require('node:cluster'))
);

/**
 * The cluster module allows easy creation of child processes that all share server ports.
 * When count > 0 the primary process will fork worker processes to process incoming http requests.
 * In case of any worker exit, also the entire process group will exit.
 * @see https://nodejs.org/api/cluster.html
 * 
 * @param {number?} count number of workers to start.
 * @returns {boolean} true if workers were started.
 */
function start_workers(count = 0) {

    if (cluster.isPrimary && count > 0) {
        for (let i = 0; i < count; ++i) {
            const worker = cluster.fork();
            console.warn('WORKER started', { id: worker.id, pid: worker.process.pid });
        }

        // We don't want to leave the process with a partial set of workers,
        // so if any worker exits, we exit the primary process and the entire group will be killed.
        // We prefer to rely on the controller that executed this process to recover from such a crash.
        cluster.on('exit', (worker, code, signal) => {
            console.warn('WORKER exit', { id: worker.id, pid: worker.process.pid, code, signal });
            console.error('EXIT ON WORKER ERROR');
            process.exit(1);
        });

        return true;
    }

    return false;
}

exports.cluster = cluster;
exports.start_workers = start_workers;
