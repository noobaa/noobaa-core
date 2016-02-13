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
        this.interval = setInterval(() => this.print(), delay_ms || 1000);
    }

    clear_interval() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    print(min_delay_ms) {
        let now = Date.now();
        if (min_delay_ms && now - this.last_time < min_delay_ms) {
            return;
        }
        let speed = (this.num_bytes - this.last_bytes) / (now - this.last_time);
        let avg_speed = this.num_bytes / (now - this.start_time);
        speed *= 1000 / 1024 / 1024;
        avg_speed *= 1000 / 1024 / 1024;
        console.log(this.name + ': ' +
            speed.toFixed(1) + ' MB/sec' +
            ' (average ' + avg_speed.toFixed(1) + ')');
        this.last_bytes = this.num_bytes;
        this.last_time = now;
    }
}

module.exports = Speedometer;
