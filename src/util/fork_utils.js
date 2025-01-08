/* Copyright (C) 2023 NooBaa */
'use strict';

// these type hacks are needed because the type info from require('node:cluster') is incorrect
const cluster = /** @type {import('node:cluster').Cluster} */ (
    /** @type {unknown} */ (require('node:cluster'))
);
const dbg = require('../util/debug_module')(__filename);
const prom_reporting = require('../server/analytic_services/prometheus_reporting');
const NoobaaEvent = require('../manage_nsfs/manage_nsfs_events_utils').NoobaaEvent;
const config = require('../../config');
const stats_collector_utils = require('./stats_collector_utils');


const io_stats = {
    read_count: 0,
    write_count: 0,
    read_bytes: 0,
    write_bytes: 0,
};

const op_stats = {};

const fs_workers_stats = {};
/**
 * The cluster module allows easy creation of child processes that all share server ports.
 * When count > 0 the primary process will fork worker processes to process incoming http requests.
 * In case of any worker exit, also the entire process group will exit.
 * @see https://nodejs.org/api/cluster.html
 * 
 * @param {number} [metrics_port]
 * @param {number} [https_metrics_port]
 * @param {string} [nsfs_config_root] nsfs configuration path
 * @param {number} [count] number of workers to start.
 * @returns {Promise<boolean>} true if workers were started.
 */
async function start_workers(metrics_port, https_metrics_port, nsfs_config_root, count = 0) {
    const exit_events = [];
    if (cluster.isPrimary && count > 0) {
        for (let i = 0; i < count; ++i) {
            const worker = cluster.fork();
            console.warn('WORKER started', { id: worker.id, pid: worker.process.pid });
        }

        // We don't want to leave the process with a partial set of workers,
        // so if any worker exits, we will print an error message in the logs and start a new one.
        cluster.on('exit', (worker, code, signal) => {
            console.warn('WORKER exit', { id: worker.id, pid: worker.process.pid, code, signal });
            new NoobaaEvent(NoobaaEvent.FORK_EXIT).create_event(undefined, { id: worker.id, pid: worker.process.pid,
                code: code, signal: signal}, undefined);
            // This code part will check if we got too many exit events on forks being killed
            // if we get more than NSFS_MAX_EXIT_EVENTS_PER_TIME_FRAME in a time frame of NSFS_MAX_EXIT_EVENTS_PER_TIME_FRAME
            // we will kill the main process and stop creating new forks.
            const now = Date.now();
            // This while will take out all the events that happened outside of the time frame
            while (exit_events.length && now - exit_events[0] > config.NSFS_EXIT_EVENTS_TIME_FRAME_MIN * 60 * 1000) {
                exit_events.shift();
            }
            exit_events.push(now); // adding the new exit event that just happened
            if (exit_events.length > config.NSFS_MAX_EXIT_EVENTS_PER_TIME_FRAME) {
                const error = `too many forks exited: ${exit_events.length} in a given time frame: ${config.NSFS_EXIT_EVENTS_TIME_FRAME_MIN} minutes`;
                console.error('EXIT ON WORKER ERROR - ', error);
                new NoobaaEvent(NoobaaEvent.ENDPOINT_CRASHED).create_event(undefined, undefined, error);
                process.exit(1);
            }
            console.warn(`${exit_events.length} exit events in the last ${config.NSFS_EXIT_EVENTS_TIME_FRAME_MIN} minutes,` +
                ` max allowed are: ${config.NSFS_MAX_EXIT_EVENTS_PER_TIME_FRAME}`);
            const new_worker = cluster.fork();
            console.warn('WORKER re-started', { id: new_worker.id, pid: new_worker.process.pid });
        });
        for (const id in cluster.workers) {
            if (id) {
                cluster.workers[id].on('message', nsfs_io_stats_handler);
            }
        }
        if (metrics_port > 0 || https_metrics_port > 0) {
            dbg.log0('Starting metrics server', metrics_port);
            await prom_reporting.start_server(metrics_port, https_metrics_port, true, nsfs_config_root);
            dbg.log0('Started metrics server successfully');
        }
        return true;
    }

    return false;
}

function nsfs_io_stats_handler(msg) {
    if (msg.io_stats) {
        for (const [key, value] of Object.entries(msg.io_stats)) {
            io_stats[key] += value;
        }
        prom_reporting.set_io_stats(io_stats);
    }
    if (msg.op_stats) {
        _update_ops_stats(msg.op_stats);
        prom_reporting.set_ops_stats(op_stats);
    }
    if (msg.fs_workers_stats) {
        _update_fs_stats(msg.fs_workers_stats);
        prom_reporting.set_fs_worker_stats(fs_workers_stats);
    }
}

function _update_ops_stats(stats) {
    //Go over the op_stats
    for (const op_name of stats_collector_utils.op_names) {
        if (op_name in stats) {
            stats_collector_utils.update_nsfs_stats(op_name, op_stats, stats[op_name]);
        }
    }
}

function _update_fs_stats(fs_stats) {
    //Go over the fs_stats
    for (const [fsworker_name, stat] of Object.entries(fs_stats)) {
        stats_collector_utils.update_nsfs_stats(fsworker_name, fs_workers_stats, stat);
    }
}

exports.start_workers = start_workers;
exports.cluster = cluster;
