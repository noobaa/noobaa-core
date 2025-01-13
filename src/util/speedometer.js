/* Copyright (C) 2016 NooBaa */
'use strict';

const cluster = /** @type {import('node:cluster').Cluster} */ (
    /** @type {unknown} */ (require('node:cluster'))
);

class Speedometer {

    constructor(name) {
        this.name = name || 'Speed';

        this.start_time = Date.now();
        this.last_time = this.start_time;

        this.num_bytes = 0;
        this.last_bytes = 0;

        this.num_ops = 0;
        this.last_ops = 0;

        this.sum_latency = 0;
        this.last_latency = 0;
        this.min_latency = -1;
        this.max_latency = -1;
    }

    run_workers(count, worker_func, args) {
        if (cluster.isPrimary) {
            console.log('ARGS:', JSON.stringify(args, null, 2));
        }
        if (count > 1 && cluster.isPrimary) {
            this.fork(count);
        } else {
            // primary will run the worker_func as well (if count <= 1 or undefined)
            worker_func();
        }
    }

    fork(count) {
        if (cluster.isWorker) throw new Error('fork should be called only from the primary process');
        cluster.on('message', (worker, { bytes, ops, sum_latency, min_latency, max_latency }) => {
            this.num_bytes += bytes;
            this.num_ops += ops;
            this.sum_latency += sum_latency;
            if (min_latency >= 0 && (this.min_latency < 0 || min_latency < this.min_latency)) this.min_latency = min_latency;
            if (max_latency >= 0 && (this.max_latency < 0 || max_latency > this.max_latency)) this.max_latency = max_latency;
            if (!this.interval) this.set_interval();
        });
        cluster.on('exit', worker => {
            if (!Object.keys(cluster.workers).length) {
                this.clear_interval();
                this.report();
                // process.exit();
            }
        });
        for (let i = 0; i < count; ++i) {
            const worker = cluster.fork();
            console.warn('Worker start', worker.process.pid);
        }
    }

    is_primary() {
        return cluster.isPrimary;
    }

    is_worker() {
        return cluster.isWorker;
    }

    update(bytes) {
        this.num_bytes += bytes;
        if (!this.interval) this.set_interval();
    }

    add_op(took_ms) {
        if (took_ms < 0) throw new Error('Speedometer: negative took_ms ' + took_ms);
        this.num_ops += 1;
        this.sum_latency += took_ms;
        if (this.min_latency < 0 || took_ms < this.min_latency) this.min_latency = took_ms;
        if (this.max_latency < 0 || took_ms > this.max_latency) this.max_latency = took_ms;
        if (!this.interval) this.set_interval();
    }

    set_interval(delay_ms) {
        this.clear_interval();
        this.interval = setInterval(() => this.report(), delay_ms || 1000);
        this.interval.unref();
    }

    clear_interval() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    report(min_delay_ms) {
        const now = Date.now();
        if (min_delay_ms && now - this.last_time < min_delay_ms) {
            return;
        }
        const bytes = this.num_bytes - this.last_bytes;
        const ops = this.num_ops - this.last_ops;
        const sum_latency = this.sum_latency - this.last_latency;
        if (cluster.isWorker) {
            process.send({
                bytes,
                ops,
                sum_latency,
                min_latency: this.min_latency, // Infinity will send as null
                max_latency: this.max_latency, // Infinity will send as null
            });
        } else {
            const speed = bytes /
                Math.max(0.001, now - this.last_time) * 1000 / 1024 / 1024;
            const avg_speed = this.num_bytes /
                Math.max(0.001, now - this.start_time) * 1000 / 1024 / 1024;
            console.log(
                this.name + ': ' +
                speed.toFixed(1) + ' MB/sec' +
                ' (average ' + avg_speed.toFixed(1) + ')' +
                (ops ? (
                    ' | OPS: ' + ops +
                    ' min:' + this.min_latency.toFixed(1) + 'ms' +
                    ' max:' + this.max_latency.toFixed(1) + 'ms' +
                    ' avg:' + (sum_latency / ops).toFixed(1) + 'ms'
                ) : '')
            );
        }
        this.last_time = now;
        this.last_bytes = this.num_bytes;
        this.last_ops = this.num_ops;
        this.last_latency = this.sum_latency;
        this.min_latency = -1;
        this.max_latency = -1;
    }
}

module.exports = Speedometer;
