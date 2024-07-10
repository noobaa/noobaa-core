/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const endpoint_stats_collector = require('../../sdk/endpoint_stats_collector').instance();
const { multi_buffer_pool } = require('../../sdk/namespace_fs');

const nsfs_semaphores = {
    "nsfs_l": config.NSFS_BUF_SIZE_L,
    "nsfs_m": config.NSFS_BUF_SIZE_M,
    "nsfs_s": config.NSFS_BUF_SIZE_S,
    "nsfs_xs": config.NSFS_BUF_SIZE_XS,
};
class SemaphoreMonitor {
    /**
     * @param {{
     *   name: string;
     *   object_io: import('../../sdk/object_io'),
     *   report_sample_sizes?: Array<Object>,
     * }} params
     */
    constructor({ name, object_io, report_sample_sizes }) {
        this.name = name;
        this.object_io = object_io;
        this.report_sample_sizes = report_sample_sizes || semaphore_report_sample_sizes();
    }

    async run_batch() {
        if (!this._can_run()) return;
        try {
            this.run_semaphore_monitor();
        } catch (err) {
            dbg.error('semaphore_monitor:', err, err.stack);
        }
        return config.SEMAPHORE_MONITOR_DELAY;
    }

    run_semaphore_monitor() {
        try {
            if (config.ENABLE_OBJECT_IO_SEMAPHORE_MONITOR) this.sample_object_io_semaphore();
            Object.keys(nsfs_semaphores).forEach(s => this.sample_nsfs_semaphore(s));
        } catch (err) {
            dbg.error('semaphore_monitor:', err, err.stack);
        }
    }

    _can_run() {
        if (!this.report_sample_sizes || this.report_sample_sizes.length === 0) {
            dbg.log0('semaphore_monitor: report_sample_sizes do not have valid size', this.report_sample_sizes);
            return false;
        }

        return true;
    }

    sample_object_io_semaphore() {
        if (!this.object_io) {
            dbg.log0('semaphore_monitor: object_io is invalid', this.object_io);
            return;
        }
        try {
            const semaphore_report = {
                timestamp: Date.now(),
                semaphore_state: {
                    semaphore_cap: config.IO_SEMAPHORE_CAP,
                    value: this.object_io._io_buffers_sem.value,
                    waiting_value: this.object_io._io_buffers_sem.waiting_value,
                    waiting_time: this.object_io._io_buffers_sem.waiting_time,
                    waiting_queue: this.object_io._io_buffers_sem._wq.length,
                }
            };
            endpoint_stats_collector.update_semaphore_state(semaphore_report, "object_io", this.report_sample_sizes);
        } catch (err) {
            dbg.error('Could not submit endpoint monitor report, got:', err);
        }
    }

    sample_nsfs_semaphore(name) {
        const buffer_size = nsfs_semaphores[name];
        const buffers_pool_sem = multi_buffer_pool.get_buffers_pool(buffer_size).sem;
        if (!buffers_pool_sem) {
            dbg.log0('semaphore_monitor: buffers_pool_sem is invalid', this.object_io);
            return;
        }
        try {
            const semaphore_report = {
                timestamp: Date.now(),
                semaphore_state: {
                    semaphore_cap: buffers_pool_sem._initial,
                    value: buffers_pool_sem.value,
                    waiting_value: buffers_pool_sem.waiting_value,
                    waiting_time: buffers_pool_sem.waiting_time,
                    waiting_queue: buffers_pool_sem._wq.length,
                }
            };
           endpoint_stats_collector.update_semaphore_state(semaphore_report, name, this.report_sample_sizes);
        } catch (err) {
            dbg.error('Could not submit nsfs endpoint monitor report, got:', err);
        }
    }

}


// Method will return the sampling size for each interval, That means if the interval is 1 minute and the 
// semaphore monitoring delay is 10 seconds then that interval will have 6 samples. And this sample size 
// along with the complete sample array is used to calculate average semaphore values for each interval.
function semaphore_report_sample_sizes() {
    const report_sample_sizes = [];
    for (const interval of config.SEMAPHORE_METRICS_AVERAGE_INTERVALS) {
        const interval_num = parseInt(interval, 10);
        // Convert the interval minute to seconds and divide it with semaphore delay seconds to get the sample size.
        const sample_size = interval_num * 60 * 1000 / config.SEMAPHORE_MONITOR_DELAY;
        report_sample_sizes.push(sample_size);
    }
    return report_sample_sizes;
}

exports.SemaphoreMonitor = SemaphoreMonitor;
