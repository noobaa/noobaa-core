/* Copyright (C) 2023 NooBaa */
'use strict';

// these type hacks are needed because the type info from require('node:cluster') is incorrect
const cluster = /** @type {import('node:cluster').Cluster} */ (
    /** @type {unknown} */ (require('node:cluster'))
);
const dbg = require('../util/debug_module')(__filename);
const prom_reporting = require('../server/analytic_services/prometheus_reporting');


const io_stats = {
    read_count: 0,
    write_count: 0,
    read_bytes: 0,
    write_bytes: 0,
};

const op_stats = {};
/**
 * The cluster module allows easy creation of child processes that all share server ports.
 * When count > 0 the primary process will fork worker processes to process incoming http requests.
 * In case of any worker exit, also the entire process group will exit.
 * @see https://nodejs.org/api/cluster.html
 * 
 * @param {number?} count number of workers to start.
 * @param {number?} metrics_port prometheus metris port.
 * @returns {boolean} true if workers were started.
 */
function start_workers(metrics_port, count = 0) {
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
        for (const id in cluster.workers) {
            if (id) {
                cluster.workers[id].on('message', nsfs_io_state_handler);
            }
        }
        if (metrics_port > 0) {
            dbg.log0('Starting metrics server', metrics_port);
            prom_reporting.start_server(metrics_port, true);
            dbg.log0('Started metrics server successfully');
        }
        return true;
    }

    return false;
}

function nsfs_io_state_handler(msg) {
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
}

function _update_ops_stats(ops_stats) {
    // Predefined op_names
    const op_names = [
        `upload_object`,
        `delete_object`,
        `create_bucket`,
        `list_buckets`,
        `delete_bucket`,
        `list_objects`,
        `head_object`,
        `read_object`,
        `initiate_multipart`,
        `upload_part`,
        `complete_object_upload`,
    ];
    //Go over the op_stats
    for (const op_name of op_names) {
        if (op_name in ops_stats) {
            _set_op_stats(op_name, ops_stats[op_name]);
        }
    }
}

function _set_op_stats(op_name, stats) {
    //In the event of all of the same ops are failing (count = error_count) we will not masseur the op times
    // As this is intended as a timing masseur and not a counter. 
    if (op_stats[op_name]) {
        const count = op_stats[op_name].count + stats.count;
        const error_count = op_stats[op_name].error_count + stats.error_count;
        op_stats[op_name] = {
            count,
            error_count,
        };
    } else if (stats.count > stats.error_count) {
        op_stats[op_name] = {
            count: stats.count,
            error_count: stats.error_count,
        };
    }
}

exports.start_workers = start_workers;
