/* Copyright (C) 2016 NooBaa */
'use strict';

/** @typedef {import('node:cluster').Cluster} Cluster */
/** @typedef {import('node:cluster').Worker} Worker */
const cluster = /** @type {Cluster} */ (/** @type {unknown} */ (require('node:cluster')));
const WaitQueue = require('./wait_queue');
const sketches = require('@datadog/sketches-js');
// const { setTimeout: delay } = require('node:timers/promises');

/**
 * @typedef {{
 *  bytes: number, 
 *  ops: number,
 *  sum_latency: number,
 *  min_latency: number,
 *  max_latency: number,
 *  latency_sketch: number[],
 * }} Bulk
 *
 * @typedef {'ready' | 'init' | 'run' | 'update' | 'done'} OpType
 *
 * @typedef {{
 *  speedometer?: {
 *      op: OpType,
 *      id?: number,
 *      bulk?: Bulk,
 *      info?: any,
 *  }
 * }} Message
 */

const STATE = Symbol('speedometer-worker-state');

const OP_READY = 'ready';
const OP_INIT = 'init';
const OP_RUN = 'run';
const OP_DONE = 'done';
const OP_UPDATE = 'update';

/**
 * 
 * @param {OpType} op 
 * @returns {Message}
 */
function msg_from_op(op) {
    return Object.freeze({ speedometer: Object.freeze({ op }) });
}
const MSG_READY = msg_from_op(OP_READY);
const MSG_INIT = msg_from_op(OP_INIT);
const MSG_RUN = msg_from_op(OP_RUN);
const MSG_DONE = msg_from_op(OP_DONE);

class Speedometer {

    /**
     * @param {{
     *  name: string,
     *  argv?: any,
     *  num_workers?: number,
     *  primary_init?: () => Promise<any>,
     *  workers_init?: (id: number, info: any) => Promise<void>,
     *  workers_func?: (id: number, info: any) => Promise<void>,
     * }} params
     */
    constructor({ name, argv, num_workers, primary_init, workers_init, workers_func }) {
        this.name = name || 'Speed';
        this.argv = argv;
        this.num_workers = num_workers || 0;
        this.primary_init = primary_init;
        this.workers_init = workers_init;
        this.workers_func = workers_func;
        this._waitqueue = new WaitQueue();
        /** @type {NodeJS.Dict<Worker>} */
        this.workers = undefined;
        this.primary_info = undefined;
        this.worker_info = undefined;
        this.worker_run = false;
        this.num_reports = 0;
        this.reset();
    }

    reset() {
        this.start_time = Date.now();
        this.num_bytes = 0;
        this.num_ops = 0;
        this.sum_latency = 0;
        this.min_latency = -1;
        this.max_latency = -1;
        this.latency_sketch = new sketches.DDSketch({ relativeAccuracy: 0.01 });
        this.last_time = this.start_time;
        this.last_bytes = 0;
        this.last_ops = 0;
        this.last_latency = 0;
    }

    set_interval(delay_ms) {
        delay_ms ||= this.is_primary() ? 1000 : 480;
        this.clear_interval();
        this.interval = setInterval(() => this._on_interval(), delay_ms);
        this.interval.unref();
    }

    clear_interval() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    is_primary() {
        return cluster.isPrimary;
    }

    is_worker() {
        return cluster.isWorker;
    }

    /**
     * @param {() => Promise<number|void>} func 
     */
    async measure(func) {
        const start = process.hrtime.bigint();
        const size = await func();
        const took_ms = Number(process.hrtime.bigint() - start) / 1e6;
        this.update(size || 0, took_ms);
    }

    update(bytes, latency_ms) {
        if (bytes > 0) this.num_bytes += bytes;
        if (latency_ms > 0) {
            this.num_ops += 1;
            this.sum_latency += latency_ms;
            this.latency_sketch.accept(latency_ms);
            if (this.min_latency < 0 || latency_ms < this.min_latency) this.min_latency = latency_ms;
            if (this.max_latency < 0 || latency_ms > this.max_latency) this.max_latency = latency_ms;
        }
        if (!this.interval) this.set_interval();
    }

    /**
     * @param {Bulk} bulk
     */
    _update_bulk({ bytes, ops, sum_latency, min_latency, max_latency, latency_sketch }) {
        this.num_bytes += bytes;
        this.num_ops += ops;
        this.sum_latency += sum_latency;
        if (min_latency >= 0 && (this.min_latency < 0 || min_latency < this.min_latency)) this.min_latency = min_latency;
        if (max_latency >= 0 && (this.max_latency < 0 || max_latency > this.max_latency)) this.max_latency = max_latency;
        this.latency_sketch.merge(sketches.DDSketch.fromProto(Uint8Array.from(latency_sketch)));
        if (!this.interval) this.set_interval();
    }

    /**
     * @returns {Bulk}
     */
    _get_bulk() {
        const bytes = this.num_bytes;
        const ops = this.num_ops;
        const sum_latency = this.sum_latency;
        const min_latency = this.min_latency;
        const max_latency = this.max_latency;
        const latency_sketch = Array.from(this.latency_sketch.toProto());
        return { bytes, ops, sum_latency, min_latency, max_latency, latency_sketch };
    }

    _on_interval(min_delay_ms) {
        if (cluster.isWorker) {
            /** type {Message} */
            const msg = { speedometer: { op: OP_UPDATE, bulk: this._get_bulk() } };
            process.send(msg);
            this.reset();
        } else {
            this.report();
        }
    }

    /**
     * Start the speedometer, optionally with workers.
     * Use message passing to synchronize all workers on init and run phases.
     */
    async start() {
        let rc = 0;
        try {
            process.on('SIGINT', signal => this._on_signal(signal));
            await this._init_primary();
            await this._start_workers();
            await this._workers_ready();
            await this._init_workers();
            await this._run_workers();
            if (cluster.isPrimary && this.argv) {
                console.log('SPEEDOMETER: Arguments', JSON.stringify(this.argv));
            }
            await this._done_workers();
        } catch (err) {
            console.error('SPEEDOMETER: Error', err);
            rc = 1;
        }
        // cleanup and exit
        this._kill_workers();
        this.clear_interval();
        this.summary();
        process.exit(rc);
    }

    /**
     * Only listen to messages from workers.
     * Used when running inside the endpoint process that already has workers.
     */
    start_lite() {
        if (cluster.isPrimary) {
            cluster.on('message', (worker, msg) => this._on_message_from_worker(worker, msg));
        }
    }

    async _start_workers() {
        if (cluster.isWorker) {
            process.on('message', msg => this._on_message_to_worker(/** @type {Message} */(msg)));
        } else if (cluster.isPrimary && this.num_workers > 1) {
            cluster.on('message', (worker, msg) => this._on_message_from_worker(worker, msg));
            cluster.on('exit', (worker, code, signal) => this._on_worker_exit(worker, code, signal));
            this.workers = {};
            for (let i = 0; i < this.num_workers; ++i) {
                const worker = cluster.fork();
                worker[STATE] = { id: worker.id, worker, ready: false };
                this.workers[worker.id] = worker;
                console.log('SPEEDOMETER: Worker start', worker.id, 'pid', worker.process.pid);
            }
        }
    }

    async _workers_ready() {
        if (cluster.isWorker) {
            console.log('SPEEDOMETER: Worker ready', process.pid);
            process.send(MSG_READY);
        } else if (this.workers) {
            const is_ready = () => Object.values(this.workers).every(w => w[STATE].ready);
            while (!is_ready()) {
                console.log('SPEEDOMETER: Waiting for workers to be ready ...');
                await this._waitqueue.wait();
            }
            console.log('SPEEDOMETER: All workers ready');
        }
    }

    async _init_primary() {
        if (cluster.isPrimary) {
            console.log('SPEEDOMETER: Initializing primary ...');
            this.primary_info = await this.primary_init?.();
        }
    }

    async _init_workers() {
        if (cluster.isWorker) {
            while (!this.worker_init) {
                console.log('SPEEDOMETER: Waiting for primary to send init message ...');
                await this._waitqueue.wait();
            }
            await this.workers_init?.(this.worker_id, this.worker_info);
            console.log('SPEEDOMETER: Ackowledging init message ...');
            process.send(MSG_INIT);
        } else if (this.workers) {
            console.log('SPEEDOMETER: Sending init message to workers ...');
            for (const w of Object.values(this.workers)) {
                /** @type {Message} */
                const msg = { speedometer: { op: OP_INIT, id: w.id, info: this.primary_info } };
                w.send(msg);
            }
            const is_inited = () => Object.values(this.workers).every(w => w[STATE].inited);
            while (!is_inited()) {
                console.log('SPEEDOMETER: Waiting for workers to be inited ...');
                await this._waitqueue.wait();
            }
            console.log('SPEEDOMETER: All workers inited ...');
        } else {
            // init as primary
            await this.workers_init?.(this.worker_id, this.primary_info);
        }
    }

    async _run_workers() {
        if (cluster.isWorker) {
            while (!this.worker_run) {
                console.log('SPEEDOMETER: Waiting for primary to send run message ...');
                await this._waitqueue.wait();
            }
            this.reset();
            await this.workers_func(this.worker_id, this.worker_info);
        } else if (this.workers) {
            console.log('SPEEDOMETER: Sending run message to workers ...');
            this.reset();
            for (const w of Object.values(this.workers)) w.send(MSG_RUN);
        } else {
            // run as primary
            this.reset();
            await this.workers_func(this.worker_id, this.primary_info);
        }
    }

    async _done_workers() {
        if (cluster.isWorker) {
            console.log('SPEEDOMETER: Worker done ...');
            process.send(MSG_DONE);
        } else if (this.workers) {
            const is_done = () => Object.values(cluster.workers).every(w => w[STATE].done);
            while (!is_done()) {
                console.log('SPEEDOMETER: Waiting for workers to be done ...');
                await this._waitqueue.wait();
            }
        } else {
            // done as primary
        }
    }

    /**
     * @param {Worker} worker 
     * @param {Message} message
     */
    _on_message_from_worker(worker, message) {
        const msg = message?.speedometer;
        if (!msg) return;
        // console.log(`SPEEDOMETER: on_message_from_worker ${worker.id} pid ${worker.process.pid} msg`, msg);
        if (msg.op === OP_READY) {
            worker[STATE].ready = true;
            this._waitqueue.wakeup();
        } else if (msg.op === OP_INIT) {
            worker[STATE].inited = true;
            this._waitqueue.wakeup();
        } else if (msg.op === OP_UPDATE) {
            this._update_bulk(msg.bulk);
        } else if (msg.op === OP_DONE) {
            worker[STATE].done = true;
            this._waitqueue.wakeup();
        } else {
            throw new Error(`SPEEDOMETER: Unknown message op ${msg.op} from worker ${worker.id} pid ${worker.process.pid}`);
        }
    }

    /**
     * @param {Message} message 
     */
    _on_message_to_worker(message) {
        const msg = message?.speedometer;
        if (!msg) return;
        // console.log('SPEEDOMETER: on_message_to_worker', msg);
        if (msg.op === OP_INIT) {
            this.worker_id = msg.id;
            this.worker_info = msg.info;
            this.worker_init = true;
            this._waitqueue.wakeup();
        } else if (msg.op === OP_RUN) {
            this.worker_run = true;
            this._waitqueue.wakeup();
        } else {
            throw new Error(`SPEEDOMETER: Unknown message op ${msg.op} received by worker`);
        }
    }

    _on_signal(signal) {
        if (signal === 'SIGINT') { // Ctrl-C
            this.clear_interval();
            if (cluster.isPrimary) {
                this._kill_workers();
                this.summary();
            }
            process.exit(1);
        }
    }

    _kill_workers(signal = 'SIGKILL') {
        if (cluster.workers) {
            for (const w of Object.values(cluster.workers)) {
                w.kill(signal);
            }
        }
    }

    /**
     * @param {Worker} worker 
     * @param {number} code 
     * @param {string} signal 
     */
    _on_worker_exit(worker, code, signal) {
        worker[STATE].exit = true;
        this._waitqueue.wakeup();
        if (code) {
            console.error('SPEEDOMETER: Worker failed', worker.id, 'pid', worker.process.pid, 'code', code);
            process.exit(1);
        }
        // if (!Object.keys(cluster.workers).length) {
        //     this.clear_interval();
        //     this.summary();
        //     process.exit(0);
        // }
    }

    report(min_delay_ms) {
        if (!cluster.isPrimary) return;
        const now = Date.now();
        if (min_delay_ms && now - this.last_time < min_delay_ms) {
            return;
        }

        this.num_reports += 1;
        const report_num = this.num_reports;

        const mb = this.num_bytes / 1024 / 1024;
        const sec = (now - this.start_time) / 1000;
        const avg_speed = mb / sec;
        const avg_ops = this.num_ops / sec;
        const avg_latency = this.sum_latency / this.num_ops;

        const curr_mb = (this.num_bytes - this.last_bytes) / 1024 / 1024;
        const curr_sec = (now - this.last_time) / 1000;
        const curr_speed = curr_mb / curr_sec;
        const curr_ops = (this.num_ops - this.last_ops) / curr_sec;
        const curr_latency = (this.sum_latency - this.last_latency) / (this.num_ops - this.last_ops);

        console.log(
            `[${report_num}] ${this.name}: ${curr_speed.toFixed(1)} MiB/sec` +
            (this.num_ops ? (
                ' ' + curr_ops.toFixed(1) + ' OP/sec' +
                ' ' + curr_latency.toFixed(1) + 'ms avg latency' +
                ' | Total (MiB/s,OP/s,avg,min,p90,p99,max):' +
                ' ' + avg_speed.toFixed(1) +
                ' ' + avg_ops.toFixed(1) +
                ' ' + avg_latency.toFixed(1) +
                ' ' + this.min_latency.toFixed(1) +
                ' ' + this.latency_sketch.getValueAtQuantile(0.90).toFixed(1) +
                ' ' + this.latency_sketch.getValueAtQuantile(0.99).toFixed(1) +
                ' ' + this.max_latency.toFixed(1)
            ) : (
                ' | Total (MiB/s):' + avg_speed.toFixed(1)
            ))
        );

        this.last_time = Date.now();
        this.last_bytes = this.num_bytes;
        this.last_ops = this.num_ops;
        this.last_latency = this.sum_latency;
    }

    summary() {
        if (!cluster.isPrimary) return;
        const mb = this.num_bytes / 1024 / 1024;
        const gb = this.num_bytes / 1024 / 1024 / 1024;
        const sec = (Date.now() - this.start_time) / 1000;
        const avg_speed = mb / sec;
        const avg_ops = this.num_ops / sec;
        const avg_latency = this.sum_latency / this.num_ops;
        console.log('| SPEED SUMMARY | -------------------');
        console.log('| SPEED SUMMARY | Name               :', this.name);
        console.log('| SPEED SUMMARY | Arguments          :', JSON.stringify(this.argv));
        console.log('| SPEED SUMMARY | -------------------');
        console.log('| SPEED SUMMARY | Total time         :', sec.toFixed(1), 'seconds');
        console.log('| SPEED SUMMARY | Total bytes        :', gb.toFixed(1), 'GB');
        console.log('| SPEED SUMMARY | Total ops          :', this.num_ops);
        console.log('| SPEED SUMMARY | -------------------');
        console.log('| SPEED SUMMARY | Average speed      :', avg_speed.toFixed(1), 'MB/sec');
        console.log('| SPEED SUMMARY | Average ops        :', avg_ops.toFixed(1), 'ops/sec');
        console.log('| SPEED SUMMARY | Average latency    :', avg_latency.toFixed(1), 'ms');
        console.log('| SPEED SUMMARY | -------------------');
        console.log('| SPEED SUMMARY | Min latency        :', this.min_latency.toFixed(1), 'ms');
        console.log('| SPEED SUMMARY | Percentile 50%     :', this.latency_sketch.getValueAtQuantile(0.50).toFixed(1), 'ms');
        console.log('| SPEED SUMMARY | Percentile 90%     :', this.latency_sketch.getValueAtQuantile(0.90).toFixed(1), 'ms');
        console.log('| SPEED SUMMARY | Percentile 95%     :', this.latency_sketch.getValueAtQuantile(0.95).toFixed(1), 'ms');
        console.log('| SPEED SUMMARY | Percentile 99%     :', this.latency_sketch.getValueAtQuantile(0.99).toFixed(1), 'ms');
        console.log('| SPEED SUMMARY | Percentile 99.9%   :', this.latency_sketch.getValueAtQuantile(0.999).toFixed(1), 'ms');
        console.log('| SPEED SUMMARY | Max latency        :', this.max_latency.toFixed(1), 'ms');
        console.log('| SPEED SUMMARY | -------------------');
        console.log('| SPEED SUMMARY | Final (MiB/s,OP/s,avg,min,p90,p99,max):' +
            ' ' + avg_speed.toFixed(1) +
            ' ' + avg_ops.toFixed(1) +
            ' ' + avg_latency.toFixed(1) +
            ' ' + this.min_latency.toFixed(1) +
            ' ' + this.latency_sketch.getValueAtQuantile(0.90).toFixed(1) +
            ' ' + this.latency_sketch.getValueAtQuantile(0.99).toFixed(1) +
            ' ' + this.max_latency.toFixed(1));
        console.log('| SPEED SUMMARY | -------------------');
    }

}

module.exports = Speedometer;
