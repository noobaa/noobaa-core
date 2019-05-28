/* Copyright (C) 2016 NooBaa */
'use strict';

const util = require('util');
const size_utils = require('./size_utils');

class PeriodicReporter {

    constructor(name, enabled = false) {
        this.name = name;
        this.events = [];
        this.enabled = enabled;
    }

    add_event(name, bytes, time) {
        if (this.enabled) {
            this.events.push({ name, bytes, time });
        }
    }

    set_interval(delay_ms = 1000) {
        this.clear_interval();
        this.interval = setInterval(() => this.report(), delay_ms);
        this.interval.unref();
    }

    clear_interval() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    report() {
        const event_map = new Map();
        for (const { name, bytes, time } of this.events) {
            let event = event_map.get(name);
            if (!event) {
                event = { name, count: 0, bytes: { total: 0, min: Infinity, max: -Infinity }, times: [] };
                event_map.set(name, event);
            }
            event.count += 1;
            event.bytes.total += bytes;
            if (bytes < event.bytes.min) event.bytes.min = bytes;
            if (bytes > event.bytes.max) event.bytes.max = bytes;
            event.times.push(time);
        }
        for (const {name, count, bytes, times} of event_map.values()) {
            const len = times.length;
            if (!len) continue;
            times.sort((a, b) => a - b);
            const percentiles = {
                min: times[0],
                med: times[Math.floor(len * 0.50)],
                90: times[Math.floor(len * 0.90)],
                95: times[Math.floor(len * 0.95)],
                99: times[Math.floor(len * 0.99)],
                max: times[len - 1],
            };
            console.log(`PeriodicReporter:: ${this.name}: ${name} count=${count}`,
                `bytes={total:${size_utils.human_size(bytes.total)}, min:${size_utils.human_size(bytes.min)}, max:${size_utils.human_size(bytes.max)}}`,
                `percentiles=${util.inspect(percentiles, { breakLength: Infinity })}`
            );
        }
        this.events = [];
    }
}

module.exports = PeriodicReporter;
