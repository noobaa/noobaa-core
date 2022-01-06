/* Copyright (C) 2016 NooBaa */
'use strict';

const cluster = require('cluster');

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
        this.min_latency = Infinity;
        this.max_latency = -Infinity;

        this.worker_mode = cluster.isWorker;
    }

    fork(count) {
        if (cluster.isMaster) {
            cluster.on('message', (worker, bytes) => this.update(bytes));
            cluster.on('exit', worker => {
                if (!Object.keys(cluster.workers).length) {
                    this.clear_interval();
                    this.report();
                    // process.exit();
                }
            });
        }
        for (var i = 0; i < count; ++i) {
            const worker = cluster.fork();
            console.warn('Worker start', worker.process.pid);
        }
    }

    update(bytes) {
        this.num_bytes += bytes;
        if (!this.interval) this.set_interval();
    }

    add_op(took_ms) {
        this.num_ops += 1;
        this.sum_latency += took_ms;
        if (took_ms > this.max_latency) this.max_latency = took_ms;
        if (took_ms < this.min_latency) this.min_latency = took_ms;
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
        if (this.worker_mode) {
            process.send(this.num_bytes - this.last_bytes);
        } else {
            const speed = (this.num_bytes - this.last_bytes) /
                Math.max(0.001, now - this.last_time) * 1000 / 1024 / 1024;
            const avg_speed = this.num_bytes /
                Math.max(0.001, now - this.start_time) * 1000 / 1024 / 1024;
            const ops = this.num_ops - this.last_ops;
            const avg_latency = this.sum_latency - this.last_latency;
            console.log(
                this.name + ': ' +
                speed.toFixed(1) + ' MB/sec' +
                ' (average ' + avg_speed.toFixed(1) + ')' +
                (ops ? (
                    ' | OPS: ' + ops +
                    ' min:' + this.min_latency.toFixed(1) + 'ms' +
                    ' max:' + this.max_latency.toFixed(1) + 'ms' +
                    ' avg:' + (avg_latency / ops).toFixed(1) + 'ms'
                ) : '')
            );
        }
        this.last_time = now;
        this.last_bytes = this.num_bytes;
        this.last_ops = this.num_ops;
        this.last_latency = this.sum_latency;
        this.min_latency = Infinity;
        this.max_latency = -Infinity;
    }
}

module.exports = Speedometer;
