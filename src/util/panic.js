/* Copyright (C) 2016 NooBaa */
'use strict';

const child_process = require('child_process');

// catch process uncaught exceptions, and treat as a panic and exit after logging
// since restarting the process is the most stable way of recovery
process.on('uncaughtException', err => panic('process uncaughtException', err));

function panic(message, err) {
    console.error('PANIC:', message, err.stack || err);
    while (process.env.LOOP_ON_PANIC === 'true') {
        console.warn('Encountered an error, holding the process on an infinite loop');
        child_process.execSync('sleep 10');
    }
    process.exit(1);
}

// dump heap with kill -USR2 <pid>
const heapdump = require('heapdump');

const memory_monitor_config = {
    logging_threshold: (1024 + 512) * 1024 * 1024,
    heapdump: null,
};

setInterval(memory_monitor, 10000).unref();

function enable_heapdump(name, next_mb, step_mb) {
    const c = memory_monitor_config;
    c.heapdump = {
        name: name || 'node',
        next: (next_mb || 512) * 1024 * 1024,
        step: (step_mb || 256) * 1024 * 1024,
    };
    return module.exports;
}

function memory_monitor() {
    const m = process.memoryUsage();
    const c = memory_monitor_config;
    const h = c.heapdump;
    const current = m.heapUsed;
    if (c.logging_threshold &&
        c.logging_threshold <= current) {
        const usage = (m.heapUsed / 1024 / 1024).toFixed(0);
        const total = (m.heapTotal / 1024 / 1024).toFixed(0);
        const resident = (m.rss / 1024 / 1024).toFixed(0);
        console.log(`memory_monitor: heap ${usage} MB | total ${total} MB | resident ${resident} MB`);
    }
    if (h && h.next && h.next <= current) {
        const size_mb = (current / 1024 / 1024).toFixed(0);
        const snapshot_name = `heapdump-${h.name}-${process.pid}-${new Date().toISOString()}-${size_mb}MB.heapsnapshot`;
        console.log(`memory_monitor: writing ${snapshot_name}`);
        heapdump.writeSnapshot(snapshot_name);
        const increase = current - h.next;
        const align = h.step - (increase % h.step);
        h.next += increase + align;
    }
}


exports.panic = panic;
exports.memory_monitor = memory_monitor;
exports.enable_heapdump = enable_heapdump;
