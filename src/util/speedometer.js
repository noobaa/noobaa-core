'use strict';

class Speedometer {

    constructor(name) {
        this.name = name || 'Speed';
        this.num_bytes = 0;
        this.last_bytes = 0;
        this.start_time = Date.now();
        this.last_time = this.start_time;
        this.set_interval();
    }

    update(bytes) {
        this.num_bytes += bytes;
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
        let now = Date.now();
        if (min_delay_ms && now - this.last_time < min_delay_ms) {
            return;
        }
        if (this.worker_mode) {
            process.send(this.num_bytes - this.last_bytes);
        } else {
            let speed = (this.num_bytes - this.last_bytes) / (now - this.last_time);
            let avg_speed = this.num_bytes / (now - this.start_time);
            speed *= 1000 / 1024 / 1024;
            avg_speed *= 1000 / 1024 / 1024;
            console.log(this.name + ': ' +
                speed.toFixed(1) + ' MB/sec' +
                ' (average ' + avg_speed.toFixed(1) + ')');
        }
        this.last_bytes = this.num_bytes;
        this.last_time = now;
    }

    enable_cluster() {
        let cluster = require('cluster');
        let _ = require('lodash');
        if (cluster.isMaster) {
            cluster.on('message', bytes => this.update(bytes));
            cluster.on('exit', worker => {
                if (_.isEmpty(cluster.workers)) {
                    this.clear_interval();
                }
            });
        } else {
            this.worker_mode = true;
        }
    }
}

module.exports = Speedometer;
